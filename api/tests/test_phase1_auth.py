"""
Phase 1 Acceptance Test Suite: JWT Protected API Routes & Tenant Isolation
Validates:
1. Missing token returns 401 on protected endpoints (upload, mandates, graph).
2. Invalid or tampered token returns 401.
3. Expired token returns 401.
4. User A's token scopes data strictly to User A; User B never sees User A's data.
"""
import io
import uuid
import sys
import os
from datetime import timedelta
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.db import get_db, Base, engine, init_db
from app.models.user import User
from app.models.mandate import Mandate
from app.services.auth_service import create_access_token
from main import app

@pytest.fixture(scope="module")
def client():
    # Ensure tables exist and migrations are applied
    init_db()
    with TestClient(app) as c:
        yield c

@pytest.fixture(scope="module")
def setup_users():
    session = next(get_db())
    # Create User A
    user_a_id = f"test_user_a_{uuid.uuid4().hex[:8]}"
    user_a = User(
        id=user_a_id,
        email=f"{user_a_id}@example.com",
        password_hash="test_hash_a",
        full_name="User Alpha",
        is_active=True
    )
    # Create User B
    user_b_id = f"test_user_b_{uuid.uuid4().hex[:8]}"
    user_b = User(
        id=user_b_id,
        email=f"{user_b_id}@example.com",
        password_hash="test_hash_b",
        full_name="User Beta",
        is_active=True
    )
    session.add(user_a)
    session.add(user_b)
    session.commit()

    token_a = create_access_token({"sub": user_a.id, "email": user_a.email})
    token_b = create_access_token({"sub": user_b.id, "email": user_b.email})
    
    yield {
        "user_a": user_a,
        "token_a": token_a,
        "user_b": user_b,
        "token_b": token_b
    }

def test_missing_token_returns_401(client):
    # GET /api/mandates without Authorization header
    resp = client.get("/api/mandates")
    assert resp.status_code == 401
    assert "detail" in resp.json()

    # POST /api/statement/upload without Authorization header
    mock_csv = "Date,Description,Amount\n2026-01-01,Netflix,499.00\n"
    files = {"file": ("statement.csv", io.BytesIO(mock_csv.encode("utf-8")), "text/csv")}
    resp = client.post("/api/statement/upload", files=files)
    assert resp.status_code == 401

    # POST /api/graph/cypher without Authorization header
    resp = client.post("/api/graph/cypher", json={"query": "MATCH (n) RETURN n LIMIT 1"})
    assert resp.status_code == 401

def test_invalid_and_tampered_token_returns_401(client):
    headers = {"Authorization": "Bearer invalid.token.payload"}
    resp = client.get("/api/mandates", headers=headers)
    assert resp.status_code == 401

    # Tampered signature
    valid_token = create_access_token({"sub": "random_user"})
    parts = valid_token.split(".")
    tampered_token = f"{parts[0]}.{parts[1]}.tamperedSignature123"
    resp = client.get("/api/mandates", headers={"Authorization": f"Bearer {tampered_token}"})
    assert resp.status_code == 401

def test_expired_token_returns_401(client):
    expired_token = create_access_token(
        {"sub": "test_expired_user"},
        expires_delta=timedelta(minutes=-10)
    )
    headers = {"Authorization": f"Bearer {expired_token}"}
    resp = client.get("/api/mandates", headers=headers)
    assert resp.status_code == 401

def test_tenant_isolation_user_a_and_b(client, setup_users):
    user_a = setup_users["user_a"]
    token_a = setup_users["token_a"]
    user_b = setup_users["user_b"]
    token_b = setup_users["token_b"]

    session = next(get_db())
    from datetime import date
    # Create a Mandate owned strictly by User A
    mandate_a = Mandate(
        id=f"man_a_{uuid.uuid4().hex[:8]}",
        user_id=user_a.id,
        merchant_name="Netflix Alpha Stream",
        descriptor="NETFLIX.COM DIGITAL",
        cadence="MONTHLY",
        latest_amount=649.0,
        annual_committed_cost=7788.0,
        first_seen=date(2026, 1, 1),
        last_charged=date(2026, 2, 1),
        mandate_type="UPI_AUTOPAY",
        status="ACTIVE"
    )
    session.add(mandate_a)
    session.commit()

    # User A requests /api/mandates
    resp_a = client.get("/api/mandates", headers={"Authorization": f"Bearer {token_a}"})
    assert resp_a.status_code == 200
    data_a = resp_a.json()
    items_a = data_a.get("mandates", data_a if isinstance(data_a, list) else [])
    # User A must see their own mandate
    assert any(m["merchant_name"] == "Netflix Alpha Stream" for m in items_a)

    # User B requests /api/mandates
    resp_b = client.get("/api/mandates", headers={"Authorization": f"Bearer {token_b}"})
    assert resp_b.status_code == 200
    data_b = resp_b.json()
    items_b = data_b.get("mandates", data_b if isinstance(data_b, list) else [])
    # User B must NEVER see User A's mandate
    assert not any(m["merchant_name"] == "Netflix Alpha Stream" for m in items_b)
