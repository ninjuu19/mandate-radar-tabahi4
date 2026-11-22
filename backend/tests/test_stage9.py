"""
Stage 9 Verification Test Suite: AI Financial Assistant
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.ai_assistant import AIAssistantService
from app.core.db import SessionLocal
from app.models.user import User
from app.models.mandate import Mandate
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_ai_assistant_intents():
    print("Testing AI Assistant Direct Engine...")
    db = SessionLocal()
    try:
        user = db.query(User).first()
        assert user is not None
        user_id = user.id

        # 1. Spend Summary Intent
        res1 = AIAssistantService.process_query("How much do I spend on subscriptions?", user_id, db)
        assert res1["intent"] == "SPEND_SUMMARY"
        assert res1["structured_data"]["monthly_spend"] > 0
        assert "₹" in res1["answer"]
        print("  Query [Spend Summary]: OK")

        # 2. Upcoming Debits Intent
        res2 = AIAssistantService.process_query("What payments are due next month?", user_id, db)
        assert res2["intent"] == "UPCOMING_DEBITS"
        assert "schedule" in res2["structured_data"]
        print("  Query [Upcoming Debits]: OK")

        # 3. Price Increases Intent
        res3 = AIAssistantService.process_query("Which subscriptions have increased in price?", user_id, db)
        assert res3["intent"] == "PRICE_INCREASES"
        assert "price_hikes_count" in res3["structured_data"]
        print("  Query [Price Increases]: OK")

        # 4. Amount Threshold Intent
        res4 = AIAssistantService.process_query("Show all recurring payments above ₹500", user_id, db)
        assert res4["intent"] == "THRESHOLD_FILTER"
        assert res4["structured_data"]["threshold"] == 500.0
        assert all(m["latest_amount"] >= 500.0 for m in res4["structured_data"]["matches"])
        print("  Query [Threshold Filter]: OK")

        # 5. Forgotten / Zombie Subscriptions
        res5 = AIAssistantService.process_query("Which subscriptions might I have forgotten?", user_id, db)
        assert res5["intent"] == "DORMANT_SUBSCRIPTIONS"
        assert "zombie_count" in res5["structured_data"]
        print("  Query [Dormant / Forgotten]: OK")

        # 6. Duplicate Payments
        res6 = AIAssistantService.process_query("Identify potentially duplicate payments", user_id, db)
        assert res6["intent"] == "DUPLICATE_PAYMENTS"
        assert "redundancies" in res6["structured_data"]
        print("  Query [Duplicate Subscriptions]: OK")

        # 7. Cancellation Guide
        res7 = AIAssistantService.process_query("How do I cancel Netflix?", user_id, db)
        assert res7["intent"] == "CANCELLATION_GUIDE"
        assert "Netflix" in res7["answer"]
        print("  Query [Cancellation Guide]: OK")

    finally:
        db.close()

def test_assistant_api_endpoints():
    from app.core.db import SessionLocal
    from app.models.user import User
    from app.services.auth_service import create_access_token

    print("Testing Assistant API Endpoints...")
    
    # 0. Unauthenticated chat returns 401
    unauth_chat = client.post("/api/v1/assistant/chat", json={"message": "How much do I spend?"})
    assert unauth_chat.status_code == 401

    db = SessionLocal()
    try:
        user = db.query(User).first()
        if not user:
            user = User(id="stage9_user", email="stage9@example.com", password_hash="test", full_name="Stage 9 User")
            db.add(user)
            db.commit()
        user_id = user.id
    finally:
        db.close()

    token = create_access_token({"sub": user_id})
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Suggested Prompts
    r_prompts = client.get("/api/v1/assistant/suggested-prompts", headers=headers)
    assert r_prompts.status_code == 200
    prompts = r_prompts.json()["prompts"]
    assert len(prompts) >= 5
    print("  GET /api/v1/assistant/suggested-prompts: OK")

    # 2. Chat Endpoint
    chat_payload = {"message": "How much do I spend on subscriptions?"}
    r_chat = client.post("/api/v1/assistant/chat", json=chat_payload, headers=headers)
    assert r_chat.status_code == 200
    data = r_chat.json()
    assert data["intent"] == "SPEND_SUMMARY"
    assert "structured_data" in data
    assert len(data["citations"]) > 0
    print("  POST /api/v1/assistant/chat: OK")

if __name__ == "__main__":
    test_ai_assistant_intents()
    test_assistant_api_endpoints()
    print("STAGE 9 VERIFICATION COMPLETE: ALL TESTS PASSED!")

