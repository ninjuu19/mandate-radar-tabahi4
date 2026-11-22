/**
 * Shared API & Network Utilities for Mandate Radar Frontend
 */

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

/**
 * Safely executes fetch and parses JSON responses.
 * Handles empty bodies (0-byte), non-JSON content types, and server errors
 * without throwing unhandled browser DOMException/SyntaxError.
 */
export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(input, init);
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let data: T | null = null;

    if (text && text.trim().length > 0) {
      if (
        contentType.includes('application/json') ||
        text.trim().startsWith('{') ||
        text.trim().startsWith('[')
      ) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
    }

    if (!res.ok) {
      if (res.status === 401) {
        try {
          const userStr = localStorage.getItem('mandate_radar_user');
          const isDemo = userStr ? JSON.parse(userStr)?.isDemo : false;
          if (!isDemo) {
            localStorage.removeItem('mandate_radar_token');
            localStorage.removeItem('mandate_radar_user');
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('mandate_radar:unauthorized'));
              window.dispatchEvent(new CustomEvent('mandate_radar_auth_expired'));
            }
          }
        } catch {}
      }
      const serverMsg =
        (data as any)?.detail ||
        (data as any)?.message ||
        (data as any)?.error;
      const error =
        serverMsg ||
        (res.status === 401
          ? 'Authentication required or session expired (401).'
          : res.status === 403
          ? 'Access forbidden (403).'
          : res.status === 404
          ? 'Service endpoint not found (404).'
          : res.status >= 500
          ? 'Server error (5xx). Please try again shortly.'
          : `Request failed with status ${res.status}`);
      return { ok: false, status: res.status, data, error };
    }

    return { ok: true, status: res.status, data };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error:
        'Server unreachable. Please verify backend connection and try again.'
    };
  }
}

/**
 * Authenticated API call helper: Automatically attaches Bearer token from localStorage.
 */
export async function authFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<ApiResponse<T>> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mandate_radar_token') : null;
  const headers = new Headers(init?.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return safeFetchJson<T>(input, {
    ...init,
    headers
  });
}

/**
 * Mandate Radar Authenticated Fetch Utility
 * Automatically attaches Authorization: Bearer <token> from localStorage.
 * On 401 Unauthorized, clears credentials and signals session expiration.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mandate_radar_token') : null;

  const headers = new Headers(init.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(input, {
    ...init,
    headers
  });

  if (res.status === 401) {
    try {
      const userStr = localStorage.getItem('mandate_radar_user');
      const isDemo = userStr ? JSON.parse(userStr)?.isDemo : false;
      if (!isDemo) {
        localStorage.removeItem('mandate_radar_token');
        localStorage.removeItem('mandate_radar_user');
        window.dispatchEvent(new CustomEvent('mandate_radar_auth_expired'));
        window.dispatchEvent(new CustomEvent('mandate_radar:unauthorized'));
      }
    } catch {}
  }

  return res;
}
