"""
Stage 4 Automated Integration Test Suite
Validates Statistical Cadence Detection, Missed Cycle Recovery,
Variable Metered Bill Rejection, Anomaly Detection, and Analytics APIs.
"""
from datetime import date, timedelta
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from fastapi.testclient import TestClient

from app.services.cadence_detector import CadenceDetector
from main import app

def test_monthly_cadence_detection():
    # 6 consecutive monthly payments
    base_date = date(2026, 1, 15)
    dates = [base_date + timedelta(days=30 * i) for i in range(6)]
    amounts = [499.0] * 6
    desc = "NETFLIX MUMBAI IN"
    
    is_rec, mandate, rej = CadenceDetector.evaluate_series(dates, amounts, desc)
    assert is_rec is True
    assert mandate["cadence"] == "MONTHLY"
    assert mandate["annual_committed_cost"] == 499.0 * 12.0
    assert mandate["flag"] == "HEALTHY"
    assert mandate["confidence_score"] >= 0.90

def test_missed_cycle_recovery():
    # Monthly series with one missed payment (gap = 60 days between month 2 and month 4)
    dates = [
        date(2026, 1, 15),
        date(2026, 2, 14),
        date(2026, 4, 15), # Missed March payment!
        date(2026, 5, 15),
        date(2026, 6, 15)
    ]
    amounts = [149.0] * 5
    desc = "GOOGLE*YOUTUBE G.CO/HELPPAY"
    
    is_rec, mandate, rej = CadenceDetector.evaluate_series(dates, amounts, desc)
    assert is_rec is True
    assert mandate["cadence"] == "MONTHLY"
    assert mandate["missed_cycles"] == 1
    assert "skipped billing cycle" in mandate["flag_reason"]

def test_rapid_order_rejection():
    # Weekly groceries every 5-7 days
    base_date = date(2026, 1, 1)
    dates = [base_date + timedelta(days=6 * i) for i in range(8)]
    amounts = [350.0, 420.0, 290.0, 510.0, 380.0, 490.0, 310.0, 450.0]
    desc = "ZEPTO CONSUMER DELIVERY BLR"
    
    is_rec, mandate, rej = CadenceDetector.evaluate_series(dates, amounts, desc)
    assert is_rec is False
    assert rej is not None
    assert "rapid non-subscription" in rej["reason"].lower()

def test_variable_utility_rejection():
    # Monthly dates but fluctuating amounts on utility bill
    dates = [
        date(2026, 1, 10),
        date(2026, 2, 10),
        date(2026, 3, 10),
        date(2026, 4, 10)
    ]
    amounts = [1250.0, 1840.0, 2100.0, 1450.0] # High swings >3%
    desc = "BESCOM ELECTRICITY BILL BANGALORE"
    
    is_rec, mandate, rej = CadenceDetector.evaluate_series(dates, amounts, desc)
    assert is_rec is False
    assert rej is not None
    assert "variable usage-based" in rej["reason"].lower()

def test_price_hike_and_trial_detection():
    # 1. Price hike
    dates = [date(2026, 1, 15) + timedelta(days=30*i) for i in range(5)]
    amounts = [129.0, 129.0, 129.0, 149.0, 149.0] # 129 -> 149 (+15.5%)
    is_rec, mandate, _ = CadenceDetector.evaluate_series(dates, amounts, "YOUTUBE PREMIUM")
    assert is_rec is True
    assert mandate["flag"] == "PRICE_HIKE"
    assert "Silent price increase" in mandate["flag_reason"]
    
    # 2. Trial conversion
    dates = [date(2026, 1, 15) + timedelta(days=30*i) for i in range(4)]
    amounts = [2.0, 119.0, 119.0, 119.0] # 2 -> 119 (59.5x)
    is_rec, mandate, _ = CadenceDetector.evaluate_series(dates, amounts, "SPOTIFY INDIA")
    assert is_rec is True
    assert mandate["flag"] == "TRIAL_CONVERTED"
    assert "Trial conversion trap" in mandate["flag_reason"]

def test_analytics_api():
    from app.core.db import SessionLocal
    from app.models.user import User
    from app.services.auth_service import create_access_token

    client = TestClient(app)
    
    # 0. Unauthenticated access returns 401
    unauth_res = client.get("/api/v1/analytics/recurring")
    assert unauth_res.status_code == 401

    db = SessionLocal()
    try:
        user = db.query(User).first()
        if not user:
            user = User(id="stage4_user", email="stage4@example.com", password_hash="test", full_name="Stage 4 User")
            db.add(user)
            db.commit()
        user_id = user.id
    finally:
        db.close()

    token = create_access_token({"sub": user_id})
    headers = {"Authorization": f"Bearer {token}"}

    # Test recurring analytics endpoint
    res = client.get("/api/v1/analytics/recurring", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "mandates" in data
    assert "rejected_transactions" in data
    assert "financial_summary" in data
    assert data["metrics"]["total_transactions"] > 0
    assert data["metrics"]["mandates_found"] > 0
    
    # Test anomalies endpoint
    anom_res = client.get("/api/v1/analytics/anomalies", headers=headers)
    assert anom_res.status_code == 200
    anom_data = anom_res.json()
    assert anom_data["count"] > 0
    assert any(a["flag"] == "PRICE_HIKE" for a in anom_data["anomalies"])

if __name__ == "__main__":
    test_monthly_cadence_detection()
    print("Cadence (Monthly): OK")
    test_missed_cycle_recovery()
    print("Cadence (Missed Cycle Recovery): OK")
    test_rapid_order_rejection()
    print("Cadence (Rapid Retail Rejection): OK")
    test_variable_utility_rejection()
    print("Cadence (Variable Metered Bill Rejection): OK")
    test_price_hike_and_trial_detection()
    print("Cadence (Price Creep & Trial Trap Detection): OK")
    test_analytics_api()
    print("Analytics API Endpoints: OK")
    print("STAGE 4 VERIFICATION COMPLETE: ALL TESTS PASSED!")

