"""
Stage 10 Verification Test Suite: Legal Cancellation Assistance & Statutory Workflows
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.cancellation_service import CancellationService
from app.core.db import SessionLocal
from app.models.mandate import Mandate
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_cancellation_service():
    print("Testing Cancellation Service Logic...")
    db = SessionLocal()
    try:
        mandate = db.query(Mandate).first()
        assert mandate is not None

        # 1. Generate Legal Notice
        notice = CancellationService.generate_legal_notice(
            mandate=mandate,
            user_name="Arun Sharma",
            account_mask="**4821",
            reason="Unannounced price hike"
        )
        assert notice["mandate_id"] == mandate.id
        assert "merchant_notice" in notice
        assert "bank_instruction" in notice
        assert "RBI/2020-21/74" in notice["merchant_notice"]["body"]
        assert "Digital Personal Data Protection Act, 2023" in notice["merchant_notice"]["body"]
        assert "Consumer Protection" in notice["merchant_notice"]["body"]
        assert "Arun Sharma" in notice["merchant_notice"]["body"]
        print("  Statutory Legal Notice & Email Generation: OK")

        # 2. Build Revocation Deep-links
        deeplinks = CancellationService.build_revocation_deeplinks(mandate)
        assert "type" in deeplinks
        assert "instructions" in deeplinks
        print("  Revocation Deep-links Generation: OK")

        # 3. Escalation Pathway
        tree = CancellationService.get_escalation_pathway(mandate)
        assert len(tree) == 4
        assert tree[0]["tier"] == 1 # Merchant Grievance
        assert tree[3]["tier"] == 4 # RBI Ombudsman
        print("  4-Tier Statutory Escalation Tree: OK")

    finally:
        db.close()

def test_cancellation_api_endpoints():
    print("Testing Cancellation API Endpoints...")
    db = SessionLocal()
    try:
        mandate = db.query(Mandate).first()
        assert mandate is not None
        mandate_id = mandate.id

        # 0. Unauthenticated access returns 401
        unauth_notice = client.post(f"/api/v1/mandates/{mandate_id}/cancellation-notice", json={"reason": "test"})
        assert unauth_notice.status_code == 401

        from app.services.auth_service import create_access_token
        token = create_access_token({"sub": mandate.user_id})
        headers = {"Authorization": f"Bearer {token}"}

        # 1. POST Cancellation Notice
        payload = {
            "reason": "Found cheaper alternative service",
            "account_mask": "**4821"
        }
        res_notice = client.post(f"/api/v1/mandates/{mandate_id}/cancellation-notice", json=payload, headers=headers)
        assert res_notice.status_code == 200
        data_notice = res_notice.json()
        assert data_notice["mandate_id"] == mandate_id
        assert "legal_notice" in data_notice
        assert "deeplinks" in data_notice
        assert len(data_notice["escalation_tree"]) == 4
        print("  POST /api/v1/mandates/{id}/cancellation-notice: OK")

        # 2. GET Escalation Tree
        res_tree = client.get(f"/api/v1/mandates/{mandate_id}/escalation-tree", headers=headers)
        assert res_tree.status_code == 200
        data_tree = res_tree.json()
        assert len(data_tree["escalation_tree"]) == 4
        print("  GET /api/v1/mandates/{id}/escalation-tree: OK")

    finally:
        db.close()

if __name__ == "__main__":
    test_cancellation_service()
    test_cancellation_api_endpoints()
    print("STAGE 10 VERIFICATION COMPLETE: ALL TESTS PASSED!")

