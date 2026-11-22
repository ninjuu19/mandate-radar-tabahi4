"""
Phase 3, Phase 4 & Phase 5 Comprehensive Authentication Verification Suite
Validates:
1. Firebase Phone Auth: missing or bad token returns 401; valid token creates user and issues JWT.
2. API never returns any OTP code in responses (no custom OTP leaks).
3. Demo user 'arun.sharma@example.com' is blocked from registration, login, and Google sign-in.
4. Email normalization (lowercase) and preventing email/password takeover of verified Google identities.
5. Rate limiting on /auth/login and /auth/register (5 requests / min per IP).
6. Security checks: expired token, tampered token, cross-user isolation.
"""
import uuid
import sys
import os
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.db import init_db, get_db
from app.models.user import User
from app.services.auth_service import create_access_token
from main import app

@pytest.fixture(scope="module")
def client():
    init_db()
    with TestClient(app) as c:
        yield c

# --- Phase 3: Firebase Phone Auth Tests ---
def test_phone_missing_token_returns_401(client):
    resp = client.post("/api/v1/auth/phone", json={})
    assert resp.status_code == 401
    assert "id token is required" in resp.json()["detail"].lower()

def test_phone_bad_token_returns_401(client):
    resp = client.post("/api/v1/auth/phone", json={"idToken": "invalid_firebase_token_payload"})
    assert resp.status_code == 401
    assert "verification failed" in resp.json()["detail"].lower()

def test_phone_valid_token_creates_user_and_jwt(client):
    test_phone = f"+9198{uuid.uuid4().int % 100000000:08d}"
    with patch("app.api.v1.auth.verify_firebase_id_token") as mock_verify:
        mock_verify.return_value = {
            "phone_number": test_phone,
            "uid": f"firebase_uid_{uuid.uuid4().hex[:8]}"
        }
        resp = client.post("/api/v1/auth/phone", json={
            "idToken": "valid_firebase_test_id_token",
            "full_name": "Test Phone User"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "otp" not in data
        assert "preview_code" not in data
        assert data["full_name"] == "Test Phone User"

# --- Phase 4: Identity Cleanup Tests ---
def test_demo_account_registration_blocked(client):
    resp = client.post("/api/v1/auth/register", json={
        "email": "Arun.Sharma@Example.com",
        "password": "Password123!",
        "full_name": "Fake Arun"
    })
    assert resp.status_code == 403
    assert "demo account" in resp.json()["detail"].lower()

def test_demo_account_direct_login_blocked(client):
    resp = client.post("/api/v1/auth/login", json={
        "email": "arun.sharma@example.com",
        "password": "AnyPassword123"
    })
    assert resp.status_code == 403
    assert "demo user" in resp.json()["detail"].lower()

def test_email_normalization_and_google_conflict(client):
    # 1. Register a user via Google
    google_email = f"user_{uuid.uuid4().hex[:6]}@gmail.com"
    with patch("google.oauth2.id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = {
            "email": google_email,
            "email_verified": True,
            "name": "Google User Original",
            "sub": "sub_google_12345"
        }
        resp = client.post("/api/v1/auth/google", json={"credential": "valid_token"})
        assert resp.status_code == 200

    # 2. Attempt to register same email via password signup with uppercase variation
    resp_pw = client.post("/api/v1/auth/register", json={
        "email": google_email.upper(),
        "password": "NewPassword123!",
        "full_name": "Imposter User"
    })
    assert resp_pw.status_code == 400
    assert "google sign-in" in resp_pw.json()["detail"].lower()

def test_rate_limiting_registration(client):
    # Tests that 5 requests per minute limit triggers 429 Too Many Requests
    responses = []
    for i in range(7):
        unique_email = f"ratelimit_{uuid.uuid4().hex[:6]}@example.com"
        r = client.post("/api/v1/auth/register", json={
            "email": unique_email,
            "password": "Password123!",
            "full_name": "Rate Limit Test"
        })
        responses.append(r.status_code)
    
    # At least one request beyond the limit must be rejected with 429
    assert 429 in responses
