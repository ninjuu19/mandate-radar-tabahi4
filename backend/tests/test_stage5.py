"""
Stage 5 Automated Integration Test Suite
Validates Subscription Intelligence, Anomaly Engine, Category Breakdown,
Corporate Footprint Exposure, and Subscriptions API.
"""
from datetime import date, timedelta
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from fastapi.testclient import TestClient

from app.services.anomaly_engine import AnomalyEngine
from app.services.subscription_manager import SubscriptionManager
from app.models.mandate import Mandate
from main import app

def test_anomaly_engine_price_creep():
    amounts = [129.0] * 8 + [149.0] * 4 # 129 -> 149
    creep = AnomalyEngine.audit_price_creep(amounts, cadence_multiplier=12.0)
    assert creep is not None
    assert creep["flag"] == "PRICE_HIKE"
    assert creep["old_amount"] == 129.0
    assert creep["new_amount"] == 149.0
    assert creep["pct_increase"] == 15.5
    assert creep["annual_leakage"] == 240.0

def test_anomaly_engine_trial_conversion():
    trial = AnomalyEngine.audit_trial_conversion(initial_amount=2.0, latest_amount=119.0, charge_count=6)
    assert trial is not None
    assert trial["flag"] == "TRIAL_CONVERTED"
    assert trial["jump_ratio"] == 59.5

def test_anomaly_engine_zombie_dormancy():
    last_act = date(2026, 1, 1)
    ref_date = date(2026, 4, 15) # 104 days later
    zombie = AnomalyEngine.audit_zombie_dormancy(
        last_activity_date=last_act,
        charges_since_activity=3,
        wasted_amount=4350.0,
        reference_date=ref_date
    )
    assert zombie is not None
    assert zombie["flag"] == "UNUSED_ZOMBIE"
    assert zombie["days_inactive"] == 104
    assert zombie["wasted_amount"] == 4350.0

def test_duplicate_subscription_detection():
    m1 = Mandate(id="m_1", merchant_id="disney_hotstar", merchant_name="Disney+ Hotstar", annual_committed_cost=1196.0, status="ACTIVE")
    m2 = Mandate(id="m_2", merchant_id="disney_hotstar", merchant_name="Disney+ Hotstar", annual_committed_cost=1196.0, status="ACTIVE")
    
    dupes = AnomalyEngine.detect_duplicate_subscriptions([m1, m2])
    assert len(dupes) == 1
    assert dupes[0]["duplicate_count"] == 2
    assert dupes[0]["potential_savings"] == 1196.0

def test_subscriptions_api():
    from app.core.db import SessionLocal
    from app.models.user import User
    from app.services.auth_service import create_access_token

    client = TestClient(app)
    
    # 0. Unauthenticated access returns 401
    unauth_res = client.get("/api/v1/subscriptions/overview")
    assert unauth_res.status_code == 401

    from app.models.mandate import Mandate

    db = SessionLocal()
    try:
        mandate = db.query(Mandate).first()
        if mandate:
            user_id = mandate.user_id
            # Ensure this mandate has a flag to test anomaly listing & dismissal
            mandate.flag = "PRICE_HIKE"
            mandate.flag_reason = "Test price hike anomaly"
            mandate.status = "ACTIVE"
            db.commit()
        else:
            user = db.query(User).first()
            if not user:
                user = User(id="stage5_user", email="stage5@example.com", password_hash="test", full_name="Stage 5 User")
                db.add(user)
                db.commit()
            user_id = user.id
    finally:
        db.close()

    token = create_access_token({"sub": user_id})
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Overview endpoint
    res = client.get("/api/v1/subscriptions/overview", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "hero_metrics" in data
    assert "category_breakdown" in data
    assert "corporate_footprint" in data
    assert data["hero_metrics"]["total_active_mandates"] > 0
    assert len(data["category_breakdown"]) > 0
    
    # Check that Alphabet or Amazon appears in corporate footprint
    parents = [p["parent"] for p in data["corporate_footprint"]]
    assert any("Alphabet" in p or "Amazon" in p or "Netflix" in p for p in parents)
    
    # 2. Anomalies endpoint
    anom_res = client.get("/api/v1/subscriptions/anomalies", headers=headers)
    assert anom_res.status_code == 200
    anom_data = anom_res.json()
    assert anom_data["count"] > 0
    
    # 3. Dismiss flag endpoint
    mandate_to_dismiss = anom_data["anomalies"][0]["mandate_id"]
    dismiss_res = client.post(f"/api/v1/subscriptions/{mandate_to_dismiss}/dismiss-flag", headers=headers)
    assert dismiss_res.status_code == 200
    assert dismiss_res.json()["flag"] == "HEALTHY"

if __name__ == "__main__":
    test_anomaly_engine_price_creep()
    print("Anomaly Engine (Silent Price Creep): OK")
    test_anomaly_engine_trial_conversion()
    print("Anomaly Engine (Trial Conversion Trap): OK")
    test_anomaly_engine_zombie_dormancy()
    print("Anomaly Engine (Zombie Dormancy): OK")
    test_duplicate_subscription_detection()
    print("Anomaly Engine (Duplicate Subscriptions): OK")
    test_subscriptions_api()
    print("Subscriptions API Endpoints: OK")
    print("STAGE 5 VERIFICATION COMPLETE: ALL TESTS PASSED!")

