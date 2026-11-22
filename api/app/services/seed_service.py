"""
Database Seeding Service
Loads the 76 reference merchants, provisions default user 'Arun Sharma',
and seeds verified initial mandates and transactions into the relational database.
"""
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.user import User
from app.models.account import Account
from app.models.merchant import Merchant
from app.models.mandate import Mandate
from app.models.transaction import Transaction
from app.services.auth_service import hash_password

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from reference_data import REFERENCE_MERCHANTS, PAYMENT_MECHANISMS
from synthetic_data import generate_synthetic_statement, generate_usage_telemetry
from detector import analyze_statement

DEFAULT_USER_EMAIL = "arun.sharma@example.com"
DEFAULT_USER_NAME = "Arun Sharma"

def seed_database(db: Session) -> dict:
    """Seeds merchants, primary user, accounts, mandates, and transactions."""
    counts = {"merchants": 0, "users": 0, "accounts": 0, "mandates": 0, "transactions": 0}

    # 1. Seed Merchants
    for m in REFERENCE_MERCHANTS:
        existing_m = db.query(Merchant).filter(Merchant.id == m["id"]).first()
        if not existing_m:
            merchant = Merchant(
                id=m["id"],
                brand_name=m["name"],
                legal_name=m.get("parent"),
                domain=m.get("official_website"),
                category=m.get("category", "General"),
                parent_company=m.get("parent"),
                default_mechanism=m.get("default_mechanism", "CARD_SI"),
                support_email=m.get("support_email"),
                grievance_email=m.get("grievance_email"),
                cancellation_pitfall=m.get("cancellation_pitfall"),
                descriptor_regexes=m.get("descriptors", [])
            )
            db.add(merchant)
            counts["merchants"] += 1
    db.commit()

    # 2. Seed Default User
    user = db.query(User).filter(User.email == DEFAULT_USER_EMAIL).first()
    if not user:
        user = User(
            id="user_primary",
            email=DEFAULT_USER_EMAIL,
            full_name=DEFAULT_USER_NAME,
            password_hash=hash_password("MandateRadar2026!"),
            is_active=True
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        counts["users"] += 1

    # 3. Seed Default Primary Account
    account = db.query(Account).filter(Account.user_id == user.id).first()
    if not account:
        account = Account(
            user_id=user.id,
            account_type="SAVINGS",
            bank_name="HDFC Bank",
            account_mask="**4821",
            currency="INR",
            virtual_balance=85420.50,
            is_active=True
        )
        db.add(account)
        db.commit()
        db.refresh(account)
        counts["accounts"] += 1

    # 4. Seed Initial Statement Mandates & Transactions
    existing_mandates_count = db.query(Mandate).filter(Mandate.user_id == user.id).count()
    if existing_mandates_count == 0:
        raw_txs = generate_synthetic_statement()
        usage_feed = generate_usage_telemetry()
        analysis = analyze_statement(raw_txs, usage_feed)

        # Map and insert transactions
        for tx in raw_txs:
            t_obj = Transaction(
                user_id=user.id,
                account_id=account.id,
                transaction_type="DEBIT",
                amount=float(tx["amount"]),
                currency="INR",
                transaction_date=datetime.strptime(tx["date"][:10], "%Y-%m-%d").date(),
                raw_descriptor=tx.get("descriptor", ""),
                cleaned_descriptor=tx.get("descriptor", "").upper(),
                ref_number=tx.get("ref", ""),
                payment_rail="UPI_AUTOPAY" if "UPI" in tx.get("descriptor", "").upper() else "CARD_SI"
            )
            db.add(t_obj)
            counts["transactions"] += 1
        db.commit()

        # Map and insert detected mandates
        for m in analysis.get("mandates", []):
            mand_obj = Mandate(
                id=m["id"],
                user_id=user.id,
                account_id=account.id,
                merchant_id=m.get("merchant_id"),
                merchant_name=m["merchant_name"],
                category=m.get("category", "Uncategorized Subscription"),
                parent_name=m.get("parent_name", "Independent / Unmapped"),
                descriptor=m["descriptor"],
                mandate_type=m.get("mechanism", "INFERRED_RECURRING"),
                cadence=m["cadence"],
                latest_amount=float(m["latest_amount"]),
                initial_amount=float(m.get("initial_amount", m["latest_amount"])),
                annual_committed_cost=float(m["annual_committed_cost"]),
                charge_count=float(m.get("charge_count", 1.0)),
                flag=m.get("flag", "HEALTHY"),
                flag_reason=m.get("flag_reason"),
                confidence_score=float(m.get("confidence_score", 0.95)),
                status="ACTIVE",
                first_seen=datetime.strptime(m["first_seen"][:10], "%Y-%m-%d").date(),
                last_charged=datetime.strptime(m["last_charged"][:10], "%Y-%m-%d").date(),
                cancellation_steps=m.get("cancellation_steps", []),
                pitfall=m.get("pitfall", ""),
                support_email=m.get("support_email", ""),
                grievance_email=m.get("grievance_email", ""),
                official_website=m.get("official_website", "")
            )
            db.add(mand_obj)
            counts["mandates"] += 1
        db.commit()

    return counts

