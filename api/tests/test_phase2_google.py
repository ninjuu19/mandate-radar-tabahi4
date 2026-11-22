"""
Phase 2 Acceptance Test Suite: Real Google Sign-in Verification
Validates:
1. Posting raw {email, full_name} without credential returns 401.
2. Posting bad/tampered credential returns 401.
3. Successfully verifies valid token structure and returns JWT only from verified claims.
4. Demo account arun.sharma@example.com is rejected with 403 on Google sign-in.
"""
import pytest
import sys
import os
from unittest.mock import patch
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.db import init_db
from main import app

@pytest.fixture(scope="module")
def client():
    init_db()
    with TestClient(app) as c:
        yield c

def test_google_missing_credential_returns_401(client):
    # Attempting old bypass of submitting raw email and name
    resp = client.post("/api/v1/auth/google", json={
        "email": "attacker@example.com",
        "full_name": "Malicious User"
    })
    assert resp.status_code == 401
    assert "credential is required" in resp.json()["detail"].lower()

def test_google_bad_credential_returns_401(client):
    # Submitting an invalid/fake Google JWT string
    resp = client.post("/api/v1/auth/google", json={
        "credential": "fake_google_jwt_token_123456"
    })
    assert resp.status_code == 401
    assert "invalid or expired token" in resp.json()["detail"].lower() or "google authentication failed" in resp.json()["detail"].lower()

def test_google_unverified_email_returns_401(client):
    with patch("google.oauth2.id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = {
            "email": "unverified@gmail.com",
            "email_verified": False,
            "name": "Unverified User"
        }
        resp = client.post("/api/v1/auth/google", json={"credential": "mock_id_token"})
        assert resp.status_code == 401
        assert "not verified" in resp.json()["detail"].lower()

def test_google_demo_account_blocked(client):
    with patch("google.oauth2.id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = {
            "email": "arun.sharma@example.com",
            "email_verified": True,
            "name": "Arun Sharma"
        }
        resp = client.post("/api/v1/auth/google", json={"credential": "mock_id_token"})
        assert resp.status_code == 403
        assert "demo account" in resp.json()["detail"].lower()

def test_google_valid_credential_creates_user_and_jwt(client):
    with patch("google.oauth2.id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = {
            "email": "google.verified.user@gmail.com",
            "email_verified": True,
            "name": "Verified Google User",
            "sub": "google_sub_123456789"
        }
        resp = client.post("/api/v1/auth/google", json={"credential": "mock_valid_id_token"})
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["email"] == "google.verified.user@gmail.com"
        assert data["full_name"] == "Verified Google User"
