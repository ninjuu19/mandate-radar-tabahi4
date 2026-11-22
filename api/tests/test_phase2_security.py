"""
Phase 2 Security & Tenant Isolation Tests
Verifies:
1. Strict 401 Unauthorized on unauthenticated requests and invalid tokens.
2. Cross-tenant isolation: User A's mandates and findings are invisible to User B.
3. Cross-tenant modification protection: User B cannot cancel or tag User A's mandates (403 Forbidden).
4. Dangerous endpoints hardened: Cypher mutation attempts blocked (400), neo4j/connect restricted (403).
5. Enterprise auth hygiene: Bcrypt password hashing, 3-attempt OTP invalidation, server-side Google token checks.
"""
import pytest
import os
import io
import time
from fastapi.testclient import TestClient

from main import app
from app.services.auth_service import create_access_token, hash_password, verify_password
from app.api.v1.auth import OTP_CACHE

client = TestClient(app)

def test_bcrypt_hashing_and_verification():
    """Verify passwords are secure bcrypt hashes starting with $2b$ or $2a$."""
    password = "SuperSecretPassword2026!"
    hashed = hash_password(password)
    assert hashed.startswith(("$2b$", "$2a$")), f"Expected bcrypt hash prefix, got {hashed[:5]}"
    assert verify_password(password, hashed) is True
    assert verify_password("WrongPassword!", hashed) is False

def test_otp_attempt_limit_and_invalidation():
    """Verify OTP expires after 3 failed attempts."""
    phone = "9876543210"
    send_res = client.post("/api/v1/auth/otp/send", json={"phone": phone, "full_name": "Test User"})
    assert send_res.status_code == 200
    generated_otp = send_res.json()["otp"]
    assert send_res.json()["expires_in"] == 300

    # Attempt 1: Wrong code -> 400 (2 attempts remaining)
    r1 = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "otp": "000000"})
    assert r1.status_code == 400
    assert "2 attempt(s) remaining" in r1.json()["detail"]

    # Attempt 2: Wrong code -> 400 (1 attempt remaining)
    r2 = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "otp": "000001"})
    assert r2.status_code == 400
    assert "1 attempt(s) remaining" in r2.json()["detail"]

    # Attempt 3: Wrong code -> 400 (0 attempts remaining)
    r3 = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "otp": "000002"})
    assert r3.status_code == 400
    assert "0 attempt(s) remaining" in r3.json()["detail"]

    # Attempt 4: Exceeded 3 attempts -> Invalidation error
    r4 = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "otp": generated_otp})
    assert r4.status_code == 400
    assert "Too many failed attempts" in r4.json()["detail"] or "No active verification code" in r4.json()["detail"]

def test_google_id_token_server_verification():
    """Verify server-side Google ID token validation."""
    # Test valid mock token
    res_valid = client.post("/api/v1/auth/google", json={"email": "test.google@example.com", "id_token": "valid_google_token"})
    assert res_valid.status_code == 200
    assert "access_token" in res_valid.json()

    # Test invalid token
    res_invalid = client.post("/api/v1/auth/google", json={"email": "test.google@example.com", "id_token": "malformed_token_xyz"})
    assert res_invalid.status_code == 400
    assert "Invalid Google ID token" in res_invalid.json()["detail"]

def test_unauthenticated_requests_rejected_with_401(monkeypatch):
    """Verify endpoints reject requests with missing or invalid tokens when strict auth is enabled."""
    monkeypatch.setenv("TESTING_STRICT_AUTH", "1")

    # Missing token -> 401
    r_no_auth = client.get("/api/mandates")
    assert r_no_auth.status_code == 401
    assert "Authorization token required" in r_no_auth.json()["detail"]

    # Bad token -> 401
    r_bad_auth = client.get("/api/mandates", headers={"Authorization": "Bearer bad.token.here"})
    assert r_bad_auth.status_code == 401
    assert "Token is invalid or has expired" in r_bad_auth.json()["detail"]

def test_cross_tenant_isolation_user_a_and_user_b():
    """Verify User B cannot see User A's mandates or findings."""
    token_a = create_access_token({"sub": "usr_tenant_alice", "email": "alice@example.com", "full_name": "Alice Tenant"})
    token_b = create_access_token({"sub": "usr_tenant_bob", "email": "bob@example.com", "full_name": "Bob Tenant"})

    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # User A uploads a statement with 3 recurring debits
    csv_alice = (
        "Date,Description,Amount,Type\n"
        "2026-01-05,NETFLIX INDIA MUMBAI,649.00,DEBIT\n"
        "2026-02-05,NETFLIX INDIA MUMBAI,649.00,DEBIT\n"
        "2026-03-05,NETFLIX INDIA MUMBAI,649.00,DEBIT\n"
    )
    up_res = client.post(
        "/api/statement/upload",
        files={"file": ("alice_statement.csv", io.BytesIO(csv_alice.encode("utf-8")), "text/csv")},
        data={"account_label": "Alice HDFC"},
        headers=headers_a
    )
    assert up_res.status_code == 200
    alice_mandates = up_res.json()["mandates"]
    assert len(alice_mandates) >= 1
    alice_mid = alice_mandates[0]["id"]

    # User A verifies their mandates portfolio
    res_a = client.get("/api/mandates", headers=headers_a)
    assert res_a.status_code == 200
    assert any(m["id"] == alice_mid for m in res_a.json()["mandates"])

    # User B requests /api/mandates: MUST NOT see User A's mandates!
    res_b = client.get("/api/mandates", headers=headers_b)
    assert res_b.status_code == 200
    bob_mandates = res_b.json()["mandates"]
    assert not any(m["id"] == alice_mid for m in bob_mandates), "Security breach: User B saw User A's mandate!"

    # User B tries to cancel User A's mandate -> 403 Forbidden!
    cancel_res = client.post(f"/api/mandates/{alice_mid}/cancel-confirm", headers=headers_b)
    assert cancel_res.status_code == 403, f"Expected 403 Forbidden, got {cancel_res.status_code}"
    assert "Forbidden" in cancel_res.json()["detail"]

    # User B tries to tag User A's mandate -> 403 Forbidden!
    tag_res = client.post(f"/api/mandates/{alice_mid}/tags", json={"tags": ["malicious_tag"]}, headers=headers_b)
    assert tag_res.status_code == 403, f"Expected 403 Forbidden, got {tag_res.status_code}"

def test_dangerous_endpoints_blocked():
    """Verify /api/graph/cypher blocks destructive write queries and /api/neo4j/connect restricts non-admins."""
    token_user = create_access_token({"sub": "usr_normal", "email": "normal@example.com", "full_name": "Normal User"})
    headers_user = {"Authorization": f"Bearer {token_user}"}

    # Test 1: Destructive Cypher queries blocked with 400
    write_queries = [
        "MATCH (n) DETACH DELETE n",
        "CREATE (m:Mandate {name: 'Injected'}) RETURN m",
        "MATCH (m:Mandate) SET m.amount = 0 RETURN m",
        "DROP INDEX ON :Mandate(id)"
    ]
    for q in write_queries:
        r = client.post("/api/graph/cypher", json={"query": q}, headers=headers_user)
        assert r.status_code == 400, f"Expected 400 for mutation query '{q}', got {r.status_code}"
        assert "prohibited" in r.json()["detail"].lower()

    # Read-only Cypher query permitted
    read_q = "MATCH (m:Mandate) RETURN m.name LIMIT 5"
    r_read = client.post("/api/graph/cypher", json={"query": read_q}, headers=headers_user)
    assert r_read.status_code == 200

    # Test 2: Neo4j connect without admin privileges rejected with 403
    r_conn = client.post("/api/neo4j/connect", json={"uri": "neo4j+s://test.databases.neo4j.io", "password": "pass"}, headers=headers_user)
    assert r_conn.status_code == 403
    assert "Forbidden" in r_conn.json()["detail"]
