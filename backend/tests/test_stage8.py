"""
Stage 8 Verification Test Suite: Financial Analytics & Forward Predictions
"""
import sys
import os
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.predictor import PaymentPredictor
from app.services.graph_analytics import GraphAnalyticsService
from app.core.db import SessionLocal
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_payment_predictor_logic():
    print("Testing PaymentPredictor Logic...")
    
    # 1. Monthly cadence addition
    base_date = date(2026, 1, 15)
    next_m = PaymentPredictor.calculate_next_date(base_date, "MONTHLY", "UPI")
    assert next_m == date(2026, 2, 15)
    print("  Monthly Cadence Calculation: OK")

    # 2. Quarterly cadence addition
    next_q = PaymentPredictor.calculate_next_date(base_date, "QUARTERLY", "UPI")
    assert next_q == date(2026, 4, 15)
    print("  Quarterly Cadence Calculation: OK")

    # 3. Annual cadence addition
    next_y = PaymentPredictor.calculate_next_date(base_date, "ANNUAL", "UPI")
    assert next_y == date(2027, 1, 15)
    print("  Annual Cadence Calculation: OK")

    # 4. NACH Sunday Rollover to Monday
    # 2026-03-01 is a Sunday
    sunday_date = date(2026, 3, 1)
    assert sunday_date.weekday() == 6 # Sunday
    assert PaymentPredictor.is_banking_business_day(sunday_date) is False
    
    # Under UPI: Stays Sunday (24x7)
    upi_res = PaymentPredictor.adjust_for_banking_rail(sunday_date, "UPI_AUTOPAY")
    assert upi_res == sunday_date

    # Under NACH: Rolls over to Monday (2026-03-02)
    nach_res = PaymentPredictor.adjust_for_banking_rail(sunday_date, "BANK_NACH")
    assert nach_res == date(2026, 3, 2)
    assert PaymentPredictor.is_banking_business_day(nach_res) is True
    print("  NACH Sunday Rollover to Business Monday: OK")

    # 5. Upcoming Schedule Generation
    test_mandates = [
        {
            "id": "m1",
            "merchant_name": "Netflix India",
            "latest_amount": 649.0,
            "cadence": "MONTHLY",
            "payment_rail": "UPI",
            "last_execution_date": "2026-11-01",
            "status": "ACTIVE"
        },
        {
            "id": "m2",
            "merchant_name": "Spotify Premium",
            "latest_amount": 149.0,
            "cadence": "MONTHLY",
            "payment_rail": "UPI",
            "last_execution_date": "2026-11-05",
            "status": "ACTIVE"
        }
    ]
    ref_d = date(2026, 11, 15)
    sched = PaymentPredictor.predict_upcoming_schedule(test_mandates, days_forward=30, from_date=ref_d)
    assert len(sched) >= 2
    assert all("predicted_date" in s for s in sched)
    print("  Upcoming Schedule Projection: OK")

    # 6. Cashflow simulation & Liquidity Shortfall Warning
    # Starting balance 500, but debits total 798 -> should trigger warning
    flow = PaymentPredictor.forecast_cashflow(test_mandates, starting_balance=500.0, days_forward=30)
    assert flow["liquidity_risk"] is True
    assert flow["liquidity_warning"] is not None
    assert flow["liquidity_warning"]["alert"] == "POTENTIAL_BOUNCE_RISK"
    print("  Cashflow Runway & Liquidity Risk Detection: OK")

def test_graph_analytics_logic():
    print("Testing Graph Analytics Logic...")

    test_mandates = [
        {"merchant_name": "Google Workspace", "latest_amount": 1650.0, "cadence": "MONTHLY", "payment_rail": "CARD"},
        {"merchant_name": "YouTube Premium", "latest_amount": 149.0, "cadence": "MONTHLY", "payment_rail": "UPI"},
        {"merchant_name": "Netflix", "latest_amount": 649.0, "cadence": "MONTHLY", "payment_rail": "UPI"},
        {"merchant_name": "Disney+ Hotstar", "latest_amount": 299.0, "cadence": "MONTHLY", "payment_rail": "CARD"},
        {"merchant_name": "HDFC Home Loan NACH", "latest_amount": 35000.0, "cadence": "MONTHLY", "payment_rail": "BANK_NACH"}
    ]

    # 1. Corporate Footprint
    footprint = GraphAnalyticsService.analyze_corporate_footprint(test_mandates)
    alphabet_entry = next((f for f in footprint if "Alphabet" in f["parent_company"]), None)
    assert alphabet_entry is not None
    assert alphabet_entry["service_count"] == 2
    assert alphabet_entry["total_monthly_spend"] == (1650.0 + 149.0)
    assert alphabet_entry["consolidation_tip"] is not None
    print("  Corporate Parent Footprint Aggregation: OK")

    # 2. Functional Redundancies
    redundancies = GraphAnalyticsService.detect_functional_redundancies(test_mandates)
    ott_red = next((r for r in redundancies if r["category"] == "Video OTT Streaming"), None)
    assert ott_red is not None
    assert ott_red["service_count"] == 2
    assert "Netflix" in ott_red["services"]
    assert "Disney+ Hotstar" in ott_red["services"]
    print("  Functional Redundancy Detection: OK")

    # 3. Vulnerability Index
    vuln = GraphAnalyticsService.calculate_vulnerability_index(test_mandates)
    assert vuln["portfolio_vulnerability_score"] > 0
    nach_audit = next((b for b in vuln["breakdown"] if "NACH" in b["payment_rail"]), None)
    assert nach_audit is not None
    assert nach_audit["friction_score"] == 85
    print("  Portfolio Vulnerability & Friction Scoring: OK")

def test_analytics_api_endpoints():
    from app.core.db import SessionLocal
    from app.models.user import User
    from app.services.auth_service import create_access_token

    print("Testing Stage 8 Analytics API Endpoints...")
    
    # 0. Unauthenticated access returns 401
    unauth_r1 = client.get("/api/v1/analytics/upcoming-debits?days=30")
    assert unauth_r1.status_code == 401

    db = SessionLocal()
    try:
        user = db.query(User).first()
        if not user:
            user = User(id="stage8_user", email="stage8@example.com", password_hash="test", full_name="Stage 8 User")
            db.add(user)
            db.commit()
        user_id = user.id
    finally:
        db.close()

    token = create_access_token({"sub": user_id})
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Upcoming Debits
    r1 = client.get("/api/v1/analytics/upcoming-debits?days=30", headers=headers)
    assert r1.status_code == 200
    d1 = r1.json()
    assert "schedule" in d1
    assert "total_projected_outflow" in d1
    print("  GET /api/v1/analytics/upcoming-debits: OK")

    # 2. Cashflow Forecast
    r2 = client.get("/api/v1/analytics/cashflow-forecast?days=30&balance=50000", headers=headers)
    assert r2.status_code == 200
    d2 = r2.json()
    assert "starting_balance" in d2
    assert "projected_ending_balance" in d2
    assert "timeline" in d2
    print("  GET /api/v1/analytics/cashflow-forecast: OK")

    # 3. Corporate Footprint
    r3 = client.get("/api/v1/analytics/corporate-footprint", headers=headers)
    assert r3.status_code == 200
    d3 = r3.json()
    assert "footprint" in d3
    assert "functional_redundancies" in d3
    assert "vulnerability_audit" in d3
    print("  GET /api/v1/analytics/corporate-footprint: OK")

if __name__ == "__main__":
    test_payment_predictor_logic()
    test_graph_analytics_logic()
    test_analytics_api_endpoints()
    print("STAGE 8 VERIFICATION COMPLETE: ALL TESTS PASSED!")
