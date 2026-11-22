"""
Mandate Radar: Neo4j Schema & Overlap Regression Tests
Validates the Cypher queries, constraints, and data reconciliation:
1. CloudStore returns 1 merchant, 3 mandates, ₹7,164/yr (same account duplicate).
2. Parent exposure totals sum to the portfolio's annual exposure.
3. StreamPlus returns one hike (+₹3,600/yr), and FitFam, CloudStore, GymPro return none.
4. Post-cancellation charge past grace window triggers reminder (read-only detection).
5. Narration constraint on normalized alias lookup.
"""

import pytest
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from neo4j_service import Neo4jKnowledgeGraph
from detector import normalize_narration

def test_narration_normalization():
    raw_samples = [
        ("UPI/P2M/491823/SPOTIFY", "spotify"),
        ("UPI/P2M/987654/SPOTIFY", "spotify"),
        ("POS DEBIT 839201 NETFLIX", "netflix"),
        ("NACH/ACH/481920/AMAZON PAY", "amazon pay"),
        ("CARD-SI *4821 CLOUDSTORE", "cloudstore")
    ]
    for raw, expected in raw_samples:
        norm = normalize_narration(raw)
        assert expected in norm, f"Expected '{expected}' in normalized '{norm}' for raw '{raw}'"

def test_cloudstore_duplicate_and_parent_exposure():
    graph = Neo4jKnowledgeGraph()
    test_mandates = [
        {
            "id": "cloudstore_1",
            "merchant_id": "cloudstore",
            "merchant_name": "CloudStore Storage",
            "cadence": "MONTHLY",
            "latest_amount": 199.0,
            "annual_committed_cost": 2388.0,
            "account_label": "ACC1",
            "mechanism": "CARD_SI",
            "status": "active"
        },
        {
            "id": "cloudstore_2",
            "merchant_id": "cloudstore",
            "merchant_name": "CloudStore Storage",
            "cadence": "MONTHLY",
            "latest_amount": 199.0,
            "annual_committed_cost": 2388.0,
            "account_label": "ACC1",
            "mechanism": "CARD_SI",
            "status": "active"
        },
        {
            "id": "cloudstore_3",
            "merchant_id": "cloudstore",
            "merchant_name": "CloudStore Storage",
            "cadence": "MONTHLY",
            "latest_amount": 199.0,
            "annual_committed_cost": 2388.0,
            "account_label": "ACC1",
            "mechanism": "CARD_SI",
            "status": "active"
        },
        {
            "id": "elec_bill",
            "merchant_id": "electricity_co",
            "merchant_name": "ElectricityCo",
            "cadence": "MONTHLY",
            "latest_amount": 2500.0,
            "annual_committed_cost": 30000.0,
            "account_label": "ACC1",
            "mechanism": "BANK_NACH",
            "status": "active"
        }
    ]

    graph.sync_statement_mandates("Test User", test_mandates, person_id="user_test", account_label="ACC1")

    # 1. CloudStore duplicate detection check
    duplicates = graph.detect_duplicate_mandates(uid="user_test")
    cloud_dup = next((d for d in duplicates if d["merchant_id"] == "cloudstore"), None)
    assert cloud_dup is not None, "CloudStore duplicate must be caught"
    assert cloud_dup["mandateCount"] == 3, f"Expected 3 mandates, got {cloud_dup['mandateCount']}"
    assert cloud_dup["annualTotal"] == 7164.0, f"Expected ₹7,164/yr, got {cloud_dup['annualTotal']}"
    assert cloud_dup["warning_type"] == "same_account", "Should be flagged as same_account warning"

    # 2. Parent exposure reconciliation check
    parent_exposure = graph.get_parent_exposure(uid="user_test")
    total_exposure = sum(p["annualExposure"] for p in parent_exposure)
    expected_total = sum(m["annual_committed_cost"] for m in test_mandates)
    assert round(total_exposure, 2) == round(expected_total, 2), (
        f"Parent exposure sum (₹{total_exposure}) must reconcile with portfolio total (₹{expected_total})"
    )
    # Ensure unparented merchant (ElectricityCo) was not dropped
    elec_entry = next((p for p in parent_exposure if "ElectricityCo" in p["owner"] or "ElectricityCo" in p["services"]), None)
    assert elec_entry is not None, "Unparented merchants like ElectricityCo must not be dropped"

def test_price_hike_query_streamplus_vs_others():
    graph = Neo4jKnowledgeGraph()
    mandates = [
        {
            "id": "mand_streamplus",
            "merchant_id": "streamplus",
            "merchant_name": "StreamPlus Video",
            "cadence": "MONTHLY",
            "latest_amount": 1299.0,
            "annual_committed_cost": 15588.0,
            "status": "active"
        },
        {
            "id": "mand_fitfam",
            "merchant_id": "fitfam",
            "merchant_name": "FitFam Gym",
            "cadence": "MONTHLY",
            "latest_amount": 1500.0,
            "annual_committed_cost": 18000.0,
            "status": "active"
        },
        {
            "id": "mand_gympro",
            "merchant_id": "gympro",
            "merchant_name": "GymPro Pass",
            "cadence": "MONTHLY",
            "latest_amount": 2000.0,
            "annual_committed_cost": 24000.0,
            "status": "active"
        }
    ]
    graph.sync_statement_mandates("Price User", mandates, person_id="user_price")

    hikes = graph.detect_price_hikes(uid="user_price", min_pct=5.0)
    stream_hike = next((h for h in hikes if h["mandateId"] == "mand_streamplus"), None)
    assert stream_hike is not None, "StreamPlus must be flagged for price hike"
    assert stream_hike["extraPerYear"] == 3600.0, f"Expected +₹3,600/yr for StreamPlus, got {stream_hike['extraPerYear']}"

    # Verify FitFam and GymPro return none
    fitfam_hike = next((h for h in hikes if h["mandateId"] == "mand_fitfam"), None)
    gympro_hike = next((h for h in hikes if h["mandateId"] == "mand_gympro"), None)
    assert fitfam_hike is None, "FitFam must not return false positive price hike"
    assert gympro_hike is None, "GymPro must not return false positive price hike"

def test_post_cancellation_detection_read_only():
    graph = Neo4jKnowledgeGraph()
    mandate = {
        "id": "mand_cancelled_test",
        "merchant_id": "test_service",
        "merchant_name": "Test Service",
        "cadence": "MONTHLY",
        "latest_amount": 499.0,
        "annual_committed_cost": 5988.0,
        "status": "marked_cancelled",
        "cancel_confirmed_at": "2026-03-01 10:00:00",
        "history": [
            {"date": "2026-02-01", "amount": 499.0, "descriptor": "TEST SERVICE", "ref": "TX1"},
            # In flight charge (within 3 day grace window)
            {"date": "2026-03-02", "amount": 499.0, "descriptor": "TEST SERVICE", "ref": "TX2"},
            # Subsequent charge past grace window (outside 3 days)
            {"date": "2026-04-01", "amount": 499.0, "descriptor": "TEST SERVICE", "ref": "TX3"}
        ]
    }
    graph.sync_statement_mandates("Cancel User", [mandate], person_id="user_cancel")

    flagged = graph.detect_post_cancellation_charges(uid="user_cancel", grace_days=3)
    assert len(flagged) == 1, f"Expected 1 violation charge past grace window, got {len(flagged)}"
    assert flagged[0]["chargeDate"] == "2026-04-01", "Should catch the April 1 charge outside grace window"
    assert flagged[0]["amount"] == 499.0

if __name__ == "__main__":
    test_narration_normalization()
    test_cloudstore_duplicate_and_parent_exposure()
    test_price_hike_query_streamplus_vs_others()
    test_post_cancellation_detection_read_only()
    print("All regression tests passed successfully!")
