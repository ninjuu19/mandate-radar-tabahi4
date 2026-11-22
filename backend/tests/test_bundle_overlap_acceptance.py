"""
MANDATE RADAR: NEO4J BUNDLE INCLUSIONS & RECONCILIATION ACCEPTANCE SUITE
Validates all 7 steps of the mentor-defending Neo4j graph lifecycle:
1. Ingest statement CSV with bundle overlap (YouTube Premium + YouTube Music).
2. Deterministic mandate extraction.
3. Variable-length path Cypher query (:Merchant)-[:INCLUDES*1..4]->(:Merchant).
4. User confirmation of overlap choices and status transitions ('keep_confirmed', 'suggested_cancel').
5. Mechanism-specific cancellation confirmation ('cancel_confirmed_by_user').
6. Post-cancellation reconciliation with 3-day grace window detecting post-cancel auto-debits ('still_charging').
7. Post-period reconciliation confirming zero debits ('verified_cancelled').
"""

import os
import sys
import pytest
from fastapi.testclient import TestClient

# Ensure backend root is on Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app, neo4j_graph
from bundle_reference import CURATED_BUNDLES
from app.core.db import init_db, get_db
from app.models.user import User
from app.services.auth_service import create_access_token

client = TestClient(app)

CSV_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_csvs"))

def test_acceptance_bundle_overlap_and_reconciliation_lifecycle():
    init_db()
    session = next(get_db())
    primary_user = session.query(User).filter(User.id == "user_primary").first()
    if not primary_user:
        primary_user = User(
            id="user_primary",
            email="primary@example.com",
            password_hash="mock_hash_primary",
            full_name="Primary User",
            is_active=True
        )
        session.add(primary_user)
        session.commit()

    token = create_access_token({"sub": "user_primary", "email": "primary@example.com"})
    auth_headers = {"Authorization": f"Bearer {token}"}

    print("\n--- STEP 1 & 2: INGEST STATEMENT 1 & EXTRACT MANDATES ---")
    csv_1_path = os.path.join(CSV_DIR, "statement_1_overlap.csv")
    assert os.path.exists(csv_1_path), "statement_1_overlap.csv missing!"

    with open(csv_1_path, "rb") as f:
        res1 = client.post("/api/upload-csv", files={"file": ("statement_1_overlap.csv", f, "text/csv")}, headers=auth_headers)
    assert res1.status_code == 200, f"Upload 1 failed: {res1.text}"
    data1 = res1.json()

    assert data1["rows_parsed"] == 9, "Expected 9 rows in statement 1"
    mandates = data1["mandates"]
    mandate_merchants = [m.get("merchant_id") for m in mandates]
    print(f"Detected mandates: {mandate_merchants}")
    assert "youtube_premium" in mandate_merchants, "YouTube Premium mandate not detected"
    assert "youtube_music" in mandate_merchants, "YouTube Music mandate not detected"

    yt_premium = next(m for m in mandates if m["merchant_id"] == "youtube_premium")
    yt_music = next(m for m in mandates if m["merchant_id"] == "youtube_music")

    assert yt_premium["latest_amount"] == 129.0
    assert yt_music["latest_amount"] == 119.0
    assert yt_music["annual_committed_cost"] == 1428.0

    print("\n--- STEP 3: NEO4J BUNDLE OVERLAP TRAVERSAL ((a)-[:INCLUDES*1..4]->(b)) ---")
    res_overlaps = client.get("/api/overlaps?uid=user_primary", headers=auth_headers)
    assert res_overlaps.status_code == 200
    ov_data = res_overlaps.json()
    print(f"Identified overlaps: {ov_data}")
    assert ov_data["overlap_count"] >= 1, "Expected at least 1 bundle overlap in Neo4j"

    ov = next((o for o in ov_data["overlaps"] if "YouTube" in o["parent_service"] and "Music" in o["included_service"]), None)
    assert ov is not None, "YouTube Premium -> YouTube Music overlap not found in Cypher traversal!"
    assert ov["potential_annual_saving"] == 1428.0, "Redundant YouTube Music savings mismatch"
    assert ov["confidence"] == "confirmed_public"
    assert "TODO" in ov["source_url"]

    # Verify Cypher query workbench execution
    cypher_check = client.post("/api/graph/cypher", json={
        "query": "MATCH (p:Person)-[:HAS_MANDATE]->(ma)-[:FOR]->(a), (p)-[:HAS_MANDATE]->(mb)-[:FOR]->(b) MATCH path = (a)-[:INCLUDES*1..4]->(b) RETURN ma, mb, path"
    }, headers=auth_headers)
    assert cypher_check.status_code == 200
    assert cypher_check.json()["count"] >= 1

    print("\n--- STEP 4: RECORD OVERLAP DECISION (KEEP PREMIUM, CANCEL MUSIC) ---")
    res_decision = client.post("/api/overlaps/decision", json={
        "user_id": "user_primary",
        "kept_mandate_ids": [yt_premium["id"]],
        "cancel_mandate_ids": [yt_music["id"]]
    }, headers=auth_headers)
    assert res_decision.status_code == 200
    assert res_decision.json()["status"] == "SUCCESS"

    # Verify portfolio statuses updated
    portfolio = client.get("/api/mandates?uid=user_primary", headers=auth_headers).json()["mandates"]
    p_premium = next(m for m in portfolio if m["id"] == yt_premium["id"])
    p_music = next(m for m in portfolio if m["id"] == yt_music["id"])
    assert p_premium["status"] == "keep_confirmed", f"Expected keep_confirmed, got {p_premium['status']}"
    assert p_music["status"] == "suggested_cancel", f"Expected suggested_cancel, got {p_music['status']}"

    print("\n--- STEP 5: CONFIRM MANDATE CANCELLATION ---")
    res_cancel_conf = client.post(f"/api/mandates/{yt_music['id']}/cancel-confirm", json={
        "user_id": "user_primary",
        "cancel_date": "2026-03-10 10:00:00"
    }, headers=auth_headers)
    assert res_cancel_conf.status_code == 200
    assert res_cancel_conf.json()["status"] in ["cancel_confirmed_by_user", "marked_cancelled"]

    portfolio = client.get("/api/mandates?uid=user_primary", headers=auth_headers).json()["mandates"]
    p_music = next(m for m in portfolio if m["id"] == yt_music["id"])
    assert p_music["status"] in ["cancel_confirmed_by_user", "marked_cancelled"]
    assert "2026-03-10" in str(p_music["cancel_confirmed_at"])

    print("\n--- STEP 6: STATEMENT 2 STILL CHARGING ALERT (BEYOND 3-DAY GRACE) ---")
    csv_2_path = os.path.join(CSV_DIR, "statement_2_still_charging.csv")
    with open(csv_2_path, "rb") as f:
        res2 = client.post("/api/upload-csv", files={"file": ("statement_2_still_charging.csv", f, "text/csv")}, headers=auth_headers)
    assert res2.status_code == 200
    data2 = res2.json()

    reconciliation2 = data2["reconciliation"]
    print(f"Reconciliation 2 report: {reconciliation2}")
    still_charging_ids = [sc["mandate_id"] for sc in reconciliation2["still_charging"]]
    assert yt_music["id"] in still_charging_ids, "Expected YouTube Music in still_charging reconciliation!"

    portfolio = client.get("/api/mandates?uid=user_primary", headers=auth_headers).json()["mandates"]
    p_music = next(m for m in portfolio if m["id"] == yt_music["id"])
    assert p_music["status"] == "still_charging", f"Expected still_charging, got {p_music['status']}"
    assert p_music["reminder_count"] >= 1
    assert p_music["last_seen_charge_date"] == "2026-04-08"

    print("\n--- STEP 7: STATEMENT 3 VERIFIED CANCELLED (POST-PERIOD ZERO CHARGES) ---")
    # User confirms cancellation again on 2026-04-10
    client.post(f"/api/mandates/{yt_music['id']}/cancel-confirm", json={
        "user_id": "user_primary",
        "cancel_date": "2026-04-10 10:00:00"
    }, headers=auth_headers)

    csv_3_path = os.path.join(CSV_DIR, "statement_3_verified_cancelled.csv")
    with open(csv_3_path, "rb") as f:
        res3 = client.post("/api/upload-csv", files={"file": ("statement_3_verified_cancelled.csv", f, "text/csv")}, headers=auth_headers)
    assert res3.status_code == 200
    data3 = res3.json()

    reconciliation3 = data3["reconciliation"]
    print(f"Reconciliation 3 report: {reconciliation3}")
    verified_ids = [vc["mandate_id"] for vc in reconciliation3["verified_cancelled"]]
    assert yt_music["id"] in verified_ids, "Expected YouTube Music in verified_cancelled!"

    portfolio = client.get("/api/mandates?uid=user_primary", headers=auth_headers).json()["mandates"]
    p_music = next(m for m in portfolio if m["id"] == yt_music["id"])
    assert p_music["status"] == "verified_cancelled", f"Expected verified_cancelled, got {p_music['status']}"
    print("ALL 7 ACCEPTANCE CRITERIA VERIFIED SUCCESSFULLY!")

if __name__ == "__main__":
    pytest.main(["-s", __file__])
