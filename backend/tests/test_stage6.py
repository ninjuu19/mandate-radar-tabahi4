"""
Stage 6 Automated Integration Test Suite
Validates Mandate Token Extraction (UMN / UMRN), Mandate Tier Classification,
Lifecycle Transitions (Pause / Resume / Revoke), Pre-Debit Notification Matching, and Mandate APIs.
"""
from fastapi.testclient import TestClient

from app.models.mandate import Mandate
from app.services.mandate_tracker import MandateTracker
from app.services.pre_debit_matcher import PreDebitMatcher
from main import app

def test_token_extraction():
    # 1. UPI AutoPay UMN (32-character hex)
    text_upi = "AutoPay mandate registered with UMN: 4a8f9c2d1e0b3a4f8c9d2e1b0a3f4c8d for YouTube"
    tokens_upi = MandateTracker.extract_mandate_tokens(text_upi)
    assert tokens_upi["umn"] is not None
    assert len(tokens_upi["umn"]) == 32

    # 2. NACH UMRN (Bank code + 16 alphanumeric)
    text_nach = "NACH Mandate approved. UMRN: HDFC0000000012345678 for LIC Premium"
    tokens_nach = MandateTracker.extract_mandate_tokens(text_nach)
    assert tokens_nach["umrn"] is not None
    assert tokens_nach["umrn"].startswith("HDFC")

def test_mandate_tier_classification():
    # A. Verified UPI AutoPay
    tier_a, conf_a, token_a = MandateTracker.classify_mandate_tier(
        descriptor="UPI/CR/948201/YOUTUBE",
        ref_str="UMN: 4A8F9C2D1E0B3A4F8C9D2E1B0A3F4C8D",
        is_recognized_merchant=True
    )
    assert tier_a == "VERIFIED_UPI_AUTOPAY"
    assert conf_a >= 0.95
    assert token_a is not None

    # B. Inferred Subscription (Known merchant, no legal mandate token)
    tier_b, conf_b, token_b = MandateTracker.classify_mandate_tier(
        descriptor="NETFLIX.COM MUMBAI",
        ref_str="",
        is_recognized_merchant=True
    )
    assert tier_b == "INFERRED_SUBSCRIPTION"
    assert conf_b == 0.85
    assert token_b is None

    # C. Inferred Recurring (Unknown merchant repetition)
    tier_c, conf_c, _ = MandateTracker.classify_mandate_tier(
        descriptor="ACME SAAS SERVICES #482",
        ref_str="",
        is_recognized_merchant=False
    )
    assert tier_c == "INFERRED_RECURRING"
    assert conf_c == 0.65

def test_lifecycle_transitions():
    m = Mandate(id="m_test", merchant_name="Test Service", status="ACTIVE")
    
    # 1. Active -> Paused
    MandateTracker.transition_status(m, "PAUSED")
    assert m.status == "PAUSED"
    
    # 2. Paused -> Active
    MandateTracker.transition_status(m, "ACTIVE")
    assert m.status == "ACTIVE"
    
    # 3. Active -> Revoked
    MandateTracker.transition_status(m, "REVOKED")
    assert m.status == "REVOKED"

def test_pre_debit_matching():
    # Create mock mandate
    cult_mandate = Mandate(
        id="mand_cult_fit",
        merchant_name="Cult.fit (Cultpass)",
        descriptor="CUREFIT HEALTHCARE",
        latest_amount=1450.0,
        flag="UNUSED_ZOMBIE",
        status="ACTIVE",
        cancellation_steps=["Revoke in Cult app", "Revoke UPI AutoPay in GPay"]
    )
    
    alert_sms = "Pre-debit alert: ₹1450.00 will be debited on 2026-11-23 from your account for Cult.fit (Cultpass) mandate. Ref: CUREFIT."
    match_res = PreDebitMatcher.match_and_audit(alert_sms, [cult_mandate])
    
    assert match_res["matched"] is True
    assert match_res["is_safe_to_execute"] is False
    assert any(a["type"] == "DORMANT_SUBSCRIPTION_DEBIT" for a in match_res["risk_alerts"])

def test_mandate_api_lifecycle():
    from app.core.db import SessionLocal
    from app.models.user import User
    from app.services.auth_service import create_access_token

    client = TestClient(app)
    
    # 0. Unauthenticated access returns 401
    unauth_res = client.get("/api/v1/mandates")
    assert unauth_res.status_code == 401

    db = SessionLocal()
    try:
        user = db.query(User).first()
        if not user:
            user = User(id="stage6_user", email="stage6@example.com", password_hash="test", full_name="Stage 6 User")
            db.add(user)
            db.commit()
        user_id = user.id
    finally:
        db.close()

    token = create_access_token({"sub": user_id})
    headers = {"Authorization": f"Bearer {token}"}

    # Fetch mandates
    res = client.get("/api/v1/mandates", headers=headers)
    assert res.status_code == 200
    mandates = res.json()
    assert len(mandates) > 0
    target_id = mandates[0]["id"]
    
    # 1. Pause mandate
    pause_res = client.post(f"/api/v1/mandates/{target_id}/pause", headers=headers)
    assert pause_res.status_code == 200
    assert pause_res.json()["status"] == "PAUSED"
    
    # 2. Resume mandate
    resume_res = client.post(f"/api/v1/mandates/{target_id}/resume", headers=headers)
    assert resume_res.status_code == 200
    assert resume_res.json()["status"] == "ACTIVE"
    
    # 3. Attach token & verify
    verify_res = client.post(f"/api/v1/mandates/{target_id}/verify?token=4A8F9C2D1E0B3A4F8C9D2E1B0A3F4C8D", headers=headers)
    assert verify_res.status_code == 200
    assert verify_res.json()["mandate_type"] == "VERIFIED_UPI_AUTOPAY"
    
    # 4. Pre-debit alert endpoint
    alert_res = client.post("/api/v1/mandates/pre-debit-alert", json={
        "alert_text": "Alert: Rs 149.00 scheduled on 2026-11-25 for YouTube Premium auto-debit."
    }, headers=headers)
    assert alert_res.status_code == 200
    assert alert_res.json()["matched"] is True

if __name__ == "__main__":
    test_token_extraction()
    print("Mandate Token Extraction (UMN / UMRN): OK")
    test_mandate_tier_classification()
    print("Mandate Tier Classification (Verified vs Inferred): OK")
    test_lifecycle_transitions()
    print("Mandate Lifecycle Transitions (Active/Paused/Revoked): OK")
    test_pre_debit_matching()
    print("Pre-Debit Alert Matching & Impending Charge Warnings: OK")
    test_mandate_api_lifecycle()
    print("Mandate Lifecycle API Endpoints: OK")
    print("STAGE 6 VERIFICATION COMPLETE: ALL TESTS PASSED!")

