"""
Firebase Admin Auth Integration for Phone Authentication
Strictly verifies Firebase ID tokens emitted by Firebase Phone Auth.
"""
import os
from typing import Optional, Dict, Any
from app.core.config import settings

try:
    import firebase_admin
    from firebase_admin import credentials, auth as firebase_auth
    HAS_FIREBASE = True
except Exception:
    HAS_FIREBASE = False
    firebase_admin = None
    credentials = None
    firebase_auth = None

_firebase_initialized = False

def ensure_firebase_initialized():
    global _firebase_initialized
    if not HAS_FIREBASE:
        return
    if not _firebase_initialized:
        svc_account = settings.FIREBASE_SERVICE_ACCOUNT
        if svc_account and os.path.exists(svc_account):
            cred = credentials.Certificate(svc_account)
            firebase_admin.initialize_app(cred)
        else:
            if not getattr(firebase_admin, "_apps", None):
                try:
                    firebase_admin.initialize_app()
                except Exception:
                    pass
        _firebase_initialized = True

def verify_firebase_id_token(id_token_str: str) -> Dict[str, Any]:
    """
    Verifies Firebase ID token and extracts verified claims.
    Raises ValueError / AuthError if token is invalid or expired.
    """
    if not HAS_FIREBASE:
        raise ValueError("Firebase Admin SDK is not available in current environment.")
    ensure_firebase_initialized()
    return firebase_auth.verify_id_token(id_token_str)
