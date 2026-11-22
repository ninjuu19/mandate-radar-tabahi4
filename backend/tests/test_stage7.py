"""
Stage 7 Verification Test Suite: External Integrations (SMS & Gmail)
"""
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.integrations.sms_receiver import SMSReceiver
from app.services.integrations.gmail_sync import GmailSyncService
from app.core.db import SessionLocal
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_sms_receiver():
    print("Testing SMS Receiver...")

    # 1. Standard HDFC Debit SMS
    hdfc_sms = "Dear Customer, Your A/c **4821 is debited for Rs 649.00 on 21-Nov-26 at NETFLIX ENTERTAINMENT. Ref 429104829102. Avl Bal Rs 52,140.00"
    parsed1 = SMSReceiver.parse_sms(hdfc_sms, sender="AX-HDFCBK")
    assert parsed1["is_valid"] is True
    assert parsed1["is_transaction"] is True
    assert parsed1["direction"] == "DEBIT"
    assert parsed1["amount"] == 649.0
    assert parsed1["account_last4"] == "4821"
    assert parsed1["reference_number"] == "429104829102"
    assert "NETFLIX" in parsed1["merchant_raw"]
    print("  Standard Debit SMS: OK")

    # 2. Strict OTP Discard
    otp_sms = "492019 is your SECRET OTP for transaction of Rs 1,499.00 on your HDFC Card. Do not share your OTP with anyone. Valid for 10 mins."
    parsed2 = SMSReceiver.parse_sms(otp_sms, sender="AX-HDFCBK")
    assert parsed2["is_otp"] is True
    assert parsed2["is_valid"] is False
    print("  Strict OTP Discard Protocol: OK")

    # 3. UPI AutoPay Pre-Debit Notice with UMN
    autopay_sms = "Pre-debit alert: UPI AutoPay mandate for Rs. 149.00 will be debited on 24-Nov-2026 for Spotify India. Mandate UMN 9b1deb4d3b7d4e899b82142a781d4512"
    parsed3 = SMSReceiver.parse_sms(autopay_sms, sender="VM-SBIINB")
    assert parsed3["is_valid"] is True
    assert parsed3["is_pre_debit_alert"] is True
    assert parsed3["amount"] == 149.0
    assert parsed3["mandate_token"] == "9b1deb4d3b7d4e899b82142a781d4512"
    assert parsed3["token_type"] == "UMN"
    print("  UPI AutoPay Pre-Debit Alert Extraction: OK")

    # 4. Bank NACH Mandate Alert with UMRN
    nach_sms = "Scheduled for debit: Standing instruction NACH mandate of Rs 3,500.00 on Account **9012 for HDFC Life Insurance on 28-Nov-2026. UMRN HDFC0000000000019284"
    parsed4 = SMSReceiver.parse_sms(nach_sms, sender="AD-ICICIB")
    assert parsed4["is_valid"] is True
    assert parsed4["is_pre_debit_alert"] is True
    assert parsed4["amount"] == 3500.0
    assert parsed4["mandate_token"] == "HDFC0000000000019284"
    assert parsed4["token_type"] == "UMRN"
    print("  Bank NACH Mandate Pre-Debit Alert Extraction: OK")

    # 5. Non-Financial SMS Rejection
    promo_sms = "Enjoy up to 50% off on your favorite meals this weekend with Code FEST50. Tap now to order!"
    parsed5 = SMSReceiver.parse_sms(promo_sms, sender="JM-SWIGGY")
    assert parsed5["is_valid"] is False
    assert parsed5["is_transaction"] is False
    print("  Non-Financial SMS Rejection: OK")

def test_gmail_sync():
    print("Testing Gmail Sync Parser...")
    
    # 1. Netflix Invoice
    netflix_body = """
    Hi Arun,
    Thank you for being a Netflix member.
    Summary of your subscription:
    Plan: Premium Ultra HD
    Date: 15-Nov-2026
    Total for this month: ₹649.00
    Payment method: UPI AutoPay (UMN 9b1deb4d3b7d4e899b82142a781d4512)
    Invoice ID: INV-NET-99182374
    """
    res1 = GmailSyncService.parse_email(
        subject="Fwd: Your Netflix Invoice for November 2026",
        sender="info@mailer.netflix.com",
        body=netflix_body
    )
    assert res1["is_financial"] is True
    assert res1["merchant_name"] == "Netflix Entertainment Services"
    assert res1["amount"] == 649.0
    assert res1["invoice_number"] == "INV-NET-99182374"
    assert res1["mandate_token"] == "9b1deb4d3b7d4e899b82142a781d4512"
    print("  Netflix Email Invoice Parsing: OK")

    # 2. Spotify Invoice
    spotify_body = """
    Your Spotify Premium receipt.
    Receipt Number: 9812401824
    Total amount: ₹149.00
    Billed on: 2026-11-10
    Enjoy unlimited music ad-free!
    """
    res2 = GmailSyncService.parse_email(
        subject="Your Spotify Receipt",
        sender="no-reply@spotify.com",
        body=spotify_body
    )
    assert res2["is_financial"] is True
    assert res2["merchant_name"] == "Spotify India"
    assert res2["amount"] == 149.0
    print("  Spotify Email Receipt Parsing: OK")

def test_integrations_api():
    print("Testing Integrations API Endpoints...")
    
    # Status
    res_status = client.get("/api/v1/integrations/status")
    assert res_status.status_code == 200
    assert "android_sms" in res_status.json()["channels"] or "sms_receiver" in res_status.json()["channels"]
    print("  GET /api/v1/integrations/status: OK")

    # SMS Ingestion Batch
    payload = {
        "messages": [
            {
                "sender": "AX-HDFCBK",
                "body": "Dear Customer, Your A/c **4821 is debited for Rs 199.00 on 21-Nov-26 at HOTSTAR BLR. Ref 429104829999.",
                "timestamp": datetime.now().isoformat()
            },
            {
                "sender": "VM-SBIINB",
                "body": "Pre-debit alert: UPI AutoPay mandate for Rs. 649.00 will be debited on 24-Nov-2026 for Netflix Entertainment. Mandate UMN 9b1deb4d3b7d4e899b82142a781d4512",
                "timestamp": datetime.now().isoformat()
            },
            {
                "sender": "AX-HDFCBK",
                "body": "Your OTP is 882910 for txn of Rs 5,000. Never share your OTP.",
                "timestamp": datetime.now().isoformat()
            }
        ]
    }
    res_sms = client.post("/api/v1/integrations/sms", json=payload)
    assert res_sms.status_code == 200
    data = res_sms.json()
    assert data["summary"]["total_processed"] == 3
    assert data["summary"]["discarded_otps"] == 1
    assert data["summary"]["pre_debit_alerts"] == 1
    assert data["summary"]["ingested_transactions"] >= 0
    print("  POST /api/v1/integrations/sms (Batch Ingest): OK")

    # Gmail Batch Ingest
    email_payload = {
        "messages": [
            {
                "subject": "Google Workspace Monthly Invoice",
                "sender": "payments-noreply@google.com",
                "body": "Amount debited: ₹1,650.00 on 12-Nov-2026. Invoice ID: GOOG-WS-881239"
            }
        ]
    }
    res_email = client.post("/api/v1/integrations/gmail/sync", json=email_payload)
    assert res_email.status_code == 200
    email_data = res_email.json()
    assert email_data["financial_receipts_found"] == 1
    assert email_data["receipts"][0]["amount"] == 1650.0
    print("  POST /api/v1/integrations/gmail/sync: OK")

if __name__ == "__main__":
    test_sms_receiver()
    test_gmail_sync()
    test_integrations_api()
    print("STAGE 7 VERIFICATION COMPLETE: ALL TESTS PASSED!")

