"""
API v1 External Integrations Endpoints (SMS & Gmail)
Full OAuth 2.0 lifecycle, incremental sync, Android device pairing, and encrypted token management.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Header, Body
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import uuid
import random
import os

from app.core.db import get_db
from app.services.integrations.sms_receiver import SMSReceiver
from app.services.integrations.gmail_sync import GmailSyncService
from app.services.integrations.gmail_client import GmailClient
from app.services.pre_debit_matcher import PreDebitMatcher
from app.services.merchant_resolver import MerchantResolver
from app.services.deduplication import TransactionDeduplicator
from app.api.v1.auth import get_current_user
from app.models.transaction import Transaction
from app.models.account import Account
from app.models.user import User
from app.models.mandate import Mandate
from app.models.outbox import OutboxEvent
from app.models.integration_credential import IntegrationCredential

router = APIRouter(prefix="/integrations", tags=["Integrations"])

# ---------------------------------------------------------
# Request / Response Schemas
# ---------------------------------------------------------
class SMSItem(BaseModel):
    sender: str = Field(..., description="DLT Telecom Sender ID e.g. AX-HDFCBK or Bank App Name")
    body: str = Field(..., description="Raw SMS text or status bar notification text")
    timestamp: Optional[datetime] = None

class SMSBatchRequest(BaseModel):
    messages: List[SMSItem]
    device_id: Optional[str] = None

class EmailItem(BaseModel):
    subject: str
    sender: str
    body: str
    received_at: Optional[datetime] = None

class EmailBatchRequest(BaseModel):
    messages: List[EmailItem]

class PairVerifyRequest(BaseModel):
    pin: str
    device_id: str
    device_name: str

# ---------------------------------------------------------
# Status & Telemetry
# ---------------------------------------------------------
@router.get("/status")
def get_integrations_status(db: Session = Depends(get_db)):
    """
    Returns real-time status of connected Gmail accounts, paired Android devices, and metrics.
    """
    user = db.query(User).first()
    user_id = user.id if user else "user_default"

    gmail_cred = db.query(IntegrationCredential).filter(
        IntegrationCredential.user_id == user_id,
        IntegrationCredential.provider == "GMAIL",
        IntegrationCredential.is_active == True
    ).first()

    sms_cred = db.query(IntegrationCredential).filter(
        IntegrationCredential.user_id == user_id,
        IntegrationCredential.provider == "ANDROID_SMS",
        IntegrationCredential.is_active == True
    ).first()

    # Aggregate metrics
    metrics = {
        "total_emails_scanned": gmail_cred.metrics.get("total_scanned", 0) if gmail_cred else 0,
        "total_sms_scanned": sms_cred.metrics.get("total_scanned", 0) if sms_cred else 0,
        "total_transactions_ingested": (
            (gmail_cred.metrics.get("ingested_txns", 0) if gmail_cred else 0) +
            (sms_cred.metrics.get("ingested_txns", 0) if sms_cred else 0)
        ),
        "total_duplicates_filtered": (
            (gmail_cred.metrics.get("duplicates_filtered", 0) if gmail_cred else 0) +
            (sms_cred.metrics.get("duplicates_filtered", 0) if sms_cred else 0)
        ),
        "pre_debit_alerts": sms_cred.metrics.get("pre_debit_alerts", 0) if sms_cred else 0
    }

    return {
        "status": "HEALTHY",
        "channels": {
            "gmail": {
                "connected": gmail_cred is not None,
                "email": gmail_cred.account_email if gmail_cred else None,
                "scope": "https://www.googleapis.com/auth/gmail.readonly",
                "last_sync": gmail_cred.last_sync_at.isoformat() if (gmail_cred and gmail_cred.last_sync_at) else None,
                "sync_status": gmail_cred.sync_status if gmail_cred else "DISCONNECTED"
            },
            "android_sms": {
                "paired": sms_cred is not None and sms_cred.pairing_token is not None,
                "device_name": sms_cred.device_name if sms_cred else None,
                "device_id": sms_cred.device_id if sms_cred else None,
                "last_sync": sms_cred.last_sync_at.isoformat() if (sms_cred and sms_cred.last_sync_at) else None,
                "dlt_filtering": True,
                "notification_listener_ready": True
            },
            "sms_receiver": {
                "active": True,
                "paired": sms_cred is not None and sms_cred.pairing_token is not None,
                "last_sync": sms_cred.last_sync_at.isoformat() if (sms_cred and sms_cred.last_sync_at) else None
            }
        },
        "metrics": metrics
    }

# ---------------------------------------------------------
# Gmail OAuth 2.0 Endpoints
# ---------------------------------------------------------
@router.get("/gmail/auth-url")
def get_gmail_auth_url():
    """
    Generates the official Google OAuth consent URL requesting read-only financial access.
    """
    state_nonce = f"state_{uuid.uuid4().hex[:16]}"
    auth_url = GmailClient.generate_authorization_url(state=state_nonce)
    return {
        "auth_url": auth_url,
        "state": state_nonce,
        "scope": "https://www.googleapis.com/auth/gmail.readonly"
    }

@router.get("/gmail/callback")
def handle_gmail_oauth_callback(
    code: str = Query(..., description="Google Authorization Code"),
    state: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Exchanges OAuth code for access & refresh tokens, encrypts them at rest,
    and runs initial financial invoice scan.
    """
    user = db.query(User).first()
    if not user:
        raise HTTPException(status_code=400, detail="Default user not initialized")

    tokens = GmailClient.exchange_code_for_tokens(code)
    access_token = tokens["access_token"]
    refresh_token = tokens.get("refresh_token")
    expires_in = tokens.get("expires_in", 3600)

    # Get profile to identify email
    profile = GmailClient.get_user_profile(access_token)
    email_addr = profile.get("emailAddress", "user@gmail.com")
    history_id = profile.get("historyId", "1")

    # Upsert IntegrationCredential
    cred = db.query(IntegrationCredential).filter(
        IntegrationCredential.user_id == user.id,
        IntegrationCredential.provider == "GMAIL"
    ).first()

    if not cred:
        cred = IntegrationCredential(
            id=f"cred_gmail_{uuid.uuid4().hex[:12]}",
            user_id=user.id,
            provider="GMAIL",
            account_email=email_addr,
            last_history_id=history_id,
            metrics={"total_scanned": 0, "ingested_txns": 0, "duplicates_filtered": 0}
        )
        db.add(cred)

    cred.account_email = email_addr
    cred.last_history_id = history_id
    cred.is_active = True
    cred.sync_status = "CONNECTED"
    cred.set_tokens(
        access_token=access_token,
        refresh_token=refresh_token,
        expiry=datetime.utcnow() + timedelta(seconds=expires_in)
    )
    db.commit()

    # Trigger Initial Financial Ingestion
    sync_res = _execute_gmail_ingestion(cred, access_token, db, start_history_id=None)

    return {
        "success": True,
        "message": f"Successfully connected Gmail ({email_addr})",
        "initial_sync": sync_res
    }

@router.post("/gmail/sync")
def sync_gmail_mock(payload: Dict[str, Any] = Body(...)):
    """
    Direct parsing endpoint for email message batches (used for testing and direct integrations).
    """
    msgs = payload.get("messages", [])
    receipts = []
    for msg in msgs:
        parsed = GmailSyncService.parse_email(
            subject=msg.get("subject", ""),
            sender=msg.get("sender", ""),
            body=msg.get("body", "")
        )
        if parsed.get("is_financial"):
            receipts.append(parsed)
    return {
        "status": "SUCCESS",
        "total_messages": len(msgs),
        "financial_receipts_found": len(receipts),
        "receipts": receipts
    }

@router.post("/gmail/sync-now")
def trigger_gmail_sync_now(db: Session = Depends(get_db)):
    """
    Manually triggers incremental financial invoice synchronization using stored refresh token.
    """
    user = db.query(User).first()
    cred = db.query(IntegrationCredential).filter(
        IntegrationCredential.user_id == user.id,
        IntegrationCredential.provider == "GMAIL",
        IntegrationCredential.is_active == True
    ).first()

    if not cred:
        raise HTTPException(status_code=400, detail="Gmail is not connected. Connect via OAuth first.")

    # Refresh access token
    refresh_token = cred.get_refresh_token()
    if not refresh_token:
        # Fall back to access token if in mock mode
        access_token = cred.get_access_token() or "ya29.mock_access_default"
    else:
        new_tokens = GmailClient.refresh_access_token(refresh_token)
        access_token = new_tokens["access_token"]
        cred.set_tokens(access_token)

    sync_res = _execute_gmail_ingestion(cred, access_token, db, start_history_id=cred.last_history_id)
    return sync_res

@router.post("/gmail/disconnect")
def disconnect_gmail(db: Session = Depends(get_db)):
    """
    Revokes OAuth token on Google's servers and disables Gmail sync.
    """
    user = db.query(User).first()
    cred = db.query(IntegrationCredential).filter(
        IntegrationCredential.user_id == user.id,
        IntegrationCredential.provider == "GMAIL"
    ).first()

    if cred:
        token = cred.get_refresh_token() or cred.get_access_token()
        if token:
            GmailClient.revoke_token(token)
        cred.is_active = False
        cred.sync_status = "DISCONNECTED"
        cred.encrypted_access_token = None
        cred.encrypted_refresh_token = None
        db.commit()

    return {"success": True, "message": "Gmail account disconnected and tokens revoked."}

def _execute_gmail_ingestion(
    cred: IntegrationCredential,
    access_token: str,
    db: Session,
    start_history_id: Optional[str] = None
) -> Dict[str, Any]:
    """Helper that runs Gmail API extraction and records transactions into the ledger."""
    account = db.query(Account).filter(Account.user_id == cred.user_id).first()
    account_id = account.id if account else None

    # Fetch existing transactions for deduplication
    existing_txns = db.query(Transaction).filter(
        Transaction.user_id == cred.user_id
    ).order_by(Transaction.transaction_date.desc()).limit(150).all()

    sync_result = GmailClient.sync_financial_emails(
        access_token=access_token,
        start_history_id=start_history_id,
        max_messages=50
    )

    ingested = 0
    duplicates = 0

    for item in sync_result.get("financial_records", []):
        parsed_d = datetime.strptime(item["date"][:10], "%Y-%m-%d").date() if len(item["date"]) >= 10 else datetime.now().date()
        
        # Deduplication check
        candidate = {
            "amount": item["amount"],
            "date": parsed_d,
            "ref": item.get("invoice_number") or item.get("mandate_token") or "",
            "descriptor": f"{item['merchant_name']} {item.get('subject', '')}"
        }
        is_dup, _, _, _ = TransactionDeduplicator.is_duplicate(candidate, existing_txns)
        if is_dup:
            duplicates += 1
            continue

        resolved = MerchantResolver.resolve(item["merchant_name"])
        merchant_id = resolved.get("id") if resolved else None

        txn_id = f"tx_em_{uuid.uuid4().hex[:12]}"
        new_txn = Transaction(
            id=txn_id,
            user_id=cred.user_id,
            account_id=account_id,
            merchant_id=merchant_id,
            transaction_type="DEBIT",
            amount=item["amount"],
            currency=item.get("currency", "INR"),
            transaction_date=parsed_d,
            raw_descriptor=f"Email Invoice: {item.get('subject', '')[:100]}",
            cleaned_descriptor=resolved.get("canonical_name", item["merchant_name"]),
            ref_number=item.get("invoice_number") or f"INV-{uuid.uuid4().hex[:8].upper()}",
            payment_rail="DIRECT_MERCHANT"
        )
        db.add(new_txn)

        outbox = OutboxEvent(
            id=f"evt_{uuid.uuid4().hex[:12]}",
            event_type="TRANSACTION_RECORDED",
            aggregate_id=txn_id,
            payload={"id": txn_id, "amount": item["amount"], "source": "GMAIL"}
        )
        db.add(outbox)
        ingested += 1

    # Update credential state
    cred.last_history_id = sync_result.get("latest_history_id", cred.last_history_id)
    cred.last_sync_at = datetime.utcnow()
    m = dict(cred.metrics or {})
    m["total_scanned"] = m.get("total_scanned", 0) + sync_result.get("messages_scanned", 0)
    m["ingested_txns"] = m.get("ingested_txns", 0) + ingested
    m["duplicates_filtered"] = m.get("duplicates_filtered", 0) + duplicates
    cred.metrics = m
    db.commit()

    return {
        "sync_mode": sync_result.get("sync_mode"),
        "messages_scanned": sync_result.get("messages_scanned", 0),
        "ingested_transactions": ingested,
        "duplicates_filtered": duplicates,
        "latest_history_id": cred.last_history_id
    }

# ---------------------------------------------------------
# Android Companion Pairing & Webhook Endpoints
# ---------------------------------------------------------
@router.post("/sms/pair-request")
def request_android_pairing_pin(db: Session = Depends(get_db)):
    """
    Generates a 6-digit one-time PIN (valid for 10 minutes) to pair the Android companion app.
    """
    user = db.query(User).first()
    pin = f"{random.randint(100000, 999999)}"
    expires_at = datetime.utcnow() + timedelta(minutes=10)

    cred = db.query(IntegrationCredential).filter(
        IntegrationCredential.user_id == user.id,
        IntegrationCredential.provider == "ANDROID_SMS"
    ).first()

    if not cred:
        cred = IntegrationCredential(
            id=f"cred_sms_{uuid.uuid4().hex[:12]}",
            user_id=user.id,
            provider="ANDROID_SMS",
            metrics={"total_scanned": 0, "ingested_txns": 0, "duplicates_filtered": 0, "pre_debit_alerts": 0}
        )
        db.add(cred)

    cred.pairing_pin = pin
    cred.pairing_pin_expires_at = expires_at
    cred.is_active = True
    db.commit()

    return {
        "pairing_pin": pin,
        "expires_in_seconds": 600,
        "instructions": "Enter this 6-digit PIN in the Mandate Radar Android Companion App to link your device."
    }

@router.post("/sms/pair-verify")
def verify_android_pairing(payload: PairVerifyRequest, db: Session = Depends(get_db)):
    """
    Companion app submits the 6-digit PIN and device details to establish authenticated link.
    """
    cred = db.query(IntegrationCredential).filter(
        IntegrationCredential.pairing_pin == payload.pin.strip(),
        IntegrationCredential.pairing_pin_expires_at > datetime.utcnow()
    ).first()

    if not cred:
        raise HTTPException(status_code=400, detail="Invalid or expired pairing PIN. Request a new PIN on the dashboard.")

    # Generate persistent device token
    dev_token = f"dev_tok_{uuid.uuid4().hex}"
    cred.device_id = payload.device_id
    cred.device_name = payload.device_name
    cred.pairing_token = dev_token
    cred.pairing_pin = None # Clear pin
    cred.sync_status = "CONNECTED"
    cred.last_sync_at = datetime.utcnow()
    db.commit()

    return {
        "success": True,
        "pairing_token": dev_token,
        "message": f"Successfully paired device '{payload.device_name}' with Mandate Radar."
    }

@router.post("/sms/disconnect")
def disconnect_android_device(db: Session = Depends(get_db)):
    """
    Unlinks paired Android companion device and invalidates device token.
    """
    user = db.query(User).first()
    cred = db.query(IntegrationCredential).filter(
        IntegrationCredential.user_id == user.id,
        IntegrationCredential.provider == "ANDROID_SMS"
    ).first()

    if cred:
        cred.pairing_token = None
        cred.device_id = None
        cred.sync_status = "DISCONNECTED"
        db.commit()

    return {"success": True, "message": "Android companion device unlinked successfully."}

@router.post("/sms")
def ingest_sms_messages(payload: SMSBatchRequest, db: Session = Depends(get_db)):
    """
    Ingest a batch of SMS messages or notifications from paired Android companion or test console.
    """
    results = []
    pre_debit_alerts = []
    ingested_txns = 0
    discarded_otps = 0
    duplicates_filtered = 0

    user = db.query(User).first()
    user_id = user.id if user else "user_default"

    account = db.query(Account).filter(Account.user_id == user_id).first()
    account_id = account.id if account else None

    # Fetch existing transactions for deduplication
    existing_txns = db.query(Transaction).filter(
        Transaction.user_id == user_id
    ).order_by(Transaction.transaction_date.desc()).limit(150).all()

    user_mandates = db.query(Mandate).filter(Mandate.user_id == user_id).all()

    for item in payload.messages:
        parsed = SMSReceiver.parse_sms(item.body, sender=item.sender, timestamp=item.timestamp)
        
        if parsed.get("is_otp"):
            discarded_otps += 1
            results.append({
                "status": "DISCARDED",
                "reason": "Security: OTP / authentication secret discarded",
                "is_otp": True
            })
            continue

        if not parsed.get("is_valid"):
            results.append({
                "status": "SKIPPED",
                "reason": parsed.get("reason", "Non-financial message")
            })
            continue

        # If pre-debit notification
        if parsed.get("is_pre_debit_alert"):
            alert_audit = PreDebitMatcher.match_and_audit(
                alert_text=item.body,
                user_mandates=user_mandates
            )
            pre_debit_alerts.append(alert_audit)
            results.append({
                "status": "PROCESSED_PRE_DEBIT_ALERT",
                "alert": alert_audit
            })
            continue

        # If completed debit/credit transaction
        if parsed.get("is_transaction"):
            candidate = {
                "amount": parsed["amount"],
                "date": datetime.now().date(),
                "ref": parsed.get("reference_number") or "",
                "descriptor": item.body
            }
            is_dup, matched_rec, score, reason = TransactionDeduplicator.is_duplicate(candidate, existing_txns)
            if is_dup:
                duplicates_filtered += 1
                results.append({
                    "status": "DUPLICATE",
                    "reason": f"Deduplication: {reason}",
                    "amount": parsed["amount"]
                })
                continue

            resolved_merch = MerchantResolver.resolve(parsed.get("merchant_raw") or item.body)
            merchant_id = resolved_merch.get("id") if resolved_merch else None

            txn_id = f"tx_sms_{uuid.uuid4().hex[:12]}"
            new_txn = Transaction(
                id=txn_id,
                user_id=user_id,
                account_id=account_id,
                merchant_id=merchant_id,
                transaction_type=parsed["direction"],
                amount=parsed["amount"],
                currency=parsed["currency"],
                transaction_date=datetime.now().date(),
                raw_descriptor=item.body[:255],
                cleaned_descriptor=resolved_merch.get("canonical_name", parsed.get("merchant_raw", "SMS Txn")),
                ref_number=parsed.get("reference_number") or f"SMS-{uuid.uuid4().hex[:8].upper()}",
                payment_rail="UPI" if "upi" in item.body.lower() else "DIRECT_MERCHANT"
            )
            db.add(new_txn)

            outbox = OutboxEvent(
                id=f"evt_{uuid.uuid4().hex[:12]}",
                event_type="TRANSACTION_RECORDED",
                aggregate_id=txn_id,
                payload={"id": txn_id, "amount": parsed["amount"], "source": "SMS"}
            )
            db.add(outbox)
            ingested_txns += 1
            results.append({
                "status": "INGESTED",
                "transaction_id": txn_id,
                "merchant": resolved_merch.get("canonical_name") if resolved_merch else "Unknown",
                "amount": parsed["amount"]
            })

    # Update SMS telemetry metrics
    cred_sms = db.query(IntegrationCredential).filter(
        IntegrationCredential.user_id == user_id,
        IntegrationCredential.provider == "ANDROID_SMS"
    ).first()
    if cred_sms:
        cred_sms.last_sync_at = datetime.utcnow()
        sm = dict(cred_sms.metrics or {})
        sm["total_scanned"] = sm.get("total_scanned", 0) + len(payload.messages)
        sm["ingested_txns"] = sm.get("ingested_txns", 0) + ingested_txns
        sm["duplicates_filtered"] = sm.get("duplicates_filtered", 0) + duplicates_filtered
        sm["pre_debit_alerts"] = sm.get("pre_debit_alerts", 0) + len(pre_debit_alerts)
        cred_sms.metrics = sm

    db.commit()

    return {
        "summary": {
            "total_processed": len(payload.messages),
            "ingested_transactions": ingested_txns,
            "pre_debit_alerts": len(pre_debit_alerts),
            "duplicates_filtered": duplicates_filtered,
            "discarded_otps": discarded_otps
        },
        "results": results
    }
