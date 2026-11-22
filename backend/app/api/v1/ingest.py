"""
Ingestion API Router (v1)
Handles multi-channel file intake: Password-Protected PDFs & CSVs,
records audit logs, persists ledger transactions, and triggers detection.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session
from typing import Optional, List, Dict, Any
from datetime import datetime

from app.core.db import get_db
from app.models.user import User
from app.models.account import Account
from app.models.transaction import Transaction
from app.models.mandate import Mandate
from app.models.raw_ingest import RawIngestLog
from app.api.v1.auth import get_current_user
from app.services.extractors.pdf_extractor import extract_transactions_from_pdf, PDFExtractionError
from app.services.extractors.csv_extractor import extract_transactions_from_csv, CSVExtractionError
from app.services.deduplication import DeduplicationService

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
from detector import analyze_statement

router = APIRouter(prefix="/ingest", tags=["Ingestion"])

@router.post("/upload-pdf")
async def ingest_bank_statement_pdf(
    file: UploadFile = File(...),
    password: Optional[str] = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Parses password-protected bank statement PDF, extracts tabular rows,
    stitching multi-line text, verifies ledger balance, and updates mandate radar.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files (.pdf) are supported at this endpoint.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded PDF file is empty.")

    # 1. Parse PDF
    try:
        extraction_res = extract_transactions_from_pdf(content, password=password)
    except PDFExtractionError as e:
        # Record failed audit log
        log = RawIngestLog(
            user_id=user.id,
            source_type="STATEMENT_PDF",
            filename=file.filename,
            raw_payload={"error": str(e), "size_bytes": len(content)},
            records_extracted=0,
            processing_status="FAILED",
            error_message=str(e)
        )
        db.add(log)
        db.commit()
        raise HTTPException(status_code=422, detail=str(e))

    transactions_data = extraction_res["transactions"]
    if not transactions_data:
        raise HTTPException(status_code=400, detail="No valid transactions could be parsed from the PDF.")

    # 2. Record Success Ingest Audit Log
    ingest_log = RawIngestLog(
        user_id=user.id,
        source_type="STATEMENT_PDF",
        filename=file.filename,
        raw_payload={
            "pages": extraction_res["pages_parsed"],
            "balance_verification": extraction_res["balance_verification"]
        },
        records_extracted=len(transactions_data),
        processing_status="COMPLETED"
    )
    db.add(ingest_log)
    db.commit()

    # 3. Resolve user's primary account
    account = db.query(Account).filter(Account.user_id == user.id).first()
    if not account:
        account = Account(
            user_id=user.id,
            account_type="SAVINGS",
            bank_name="Imported Account",
            account_mask="**PDF",
            currency="INR"
        )
        db.add(account)
        db.commit()
        db.refresh(account)

    # 4. Deduplicate against user's existing ledger & Persist Unique Transactions
    existing_records = db.query(Transaction).filter(Transaction.user_id == user.id).all()
    unique_txs, duplicate_txs = DeduplicationService.filter_unique_transactions(transactions_data, existing_records)

    for tx in unique_txs:
        t_record = Transaction(
            user_id=user.id,
            account_id=account.id,
            transaction_type=tx.get("type", "DEBIT"),
            amount=tx["amount"],
            currency="INR",
            transaction_date=datetime.strptime(tx["date"], "%Y-%m-%d").date(),
            raw_descriptor=tx["descriptor"],
            cleaned_descriptor=tx.get("cleaned_descriptor", tx["descriptor"]),
            ref_number=tx.get("ref", ""),
            payment_rail=tx.get("payment_rail", "DIRECT_MERCHANT")
        )
        db.add(t_record)
    db.commit()

    # 5. Run Mandate & Anomaly Detection on unique transactions
    all_user_txs = db.query(Transaction).filter(Transaction.user_id == user.id).order_by(Transaction.transaction_date.asc()).all()
    all_txs_data = [
        {
            "id": t.id,
            "date": t.transaction_date.isoformat(),
            "amount": float(t.amount),
            "descriptor": t.raw_descriptor,
            "ref": t.ref_number or ""
        }
        for t in all_user_txs
    ]
    analysis = analyze_statement(all_txs_data)

    # 6. Upsert Detected Mandates in Database
    for m in analysis.get("mandates", []):
        mand_pk = f"{user.id}_{m['id']}" if not m['id'].startswith(f"{user.id}_") else m['id']
        existing_mand = db.query(Mandate).filter(Mandate.id == mand_pk).first()

        if existing_mand:
            existing_mand.latest_amount = float(m["latest_amount"])
            existing_mand.annual_committed_cost = float(m["annual_committed_cost"])
            existing_mand.flag = m.get("flag", "HEALTHY")
            existing_mand.flag_reason = m.get("flag_reason")
            existing_mand.last_charged = datetime.strptime(m["last_charged"][:10], "%Y-%m-%d").date()
        else:
            new_mand = Mandate(
                id=mand_pk,
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
            db.add(new_mand)
    db.commit()

    annual_committed = analysis["annual_committed_total"]
    analysis["hero_metrics"] = {
        "annual_committed_total": annual_committed,
        "monthly_equivalent": round(annual_committed / 12.0, 2),
        "potential_savings": analysis["annual_potential_savings"],
        "total_mandates_found": len(analysis["mandates"]),
        "flagged_issues_count": sum(1 for m in analysis["mandates"] if m["flag"] != "HEALTHY")
    }
    analysis["filename"] = file.filename
    analysis["pages_parsed"] = extraction_res["pages_parsed"]
    analysis["rows_parsed"] = len(transactions_data)
    analysis["duplicates_detected"] = len(duplicate_txs)
    analysis["new_transactions_inserted"] = len(unique_txs)
    analysis["balance_verification"] = extraction_res["balance_verification"]

    return analysis

@router.post("/upload-csv")
async def ingest_bank_statement_csv(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Parses CSV statement with auto-dialect detection and persists records in database."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        transactions_data = extract_transactions_from_csv(content)
    except CSVExtractionError as e:
        log = RawIngestLog(
            user_id=user.id,
            source_type="STATEMENT_CSV",
            filename=file.filename,
            raw_payload={"error": str(e)},
            records_extracted=0,
            processing_status="FAILED",
            error_message=str(e)
        )
        db.add(log)
        db.commit()
        raise HTTPException(status_code=422, detail=str(e))

    # Audit log
    db.add(RawIngestLog(
        user_id=user.id,
        source_type="STATEMENT_CSV",
        filename=file.filename,
        raw_payload={"rows": len(transactions_data)},
        records_extracted=len(transactions_data),
        processing_status="COMPLETED"
    ))
    db.commit()

    account = db.query(Account).filter(Account.user_id == user.id).first()
    if not account:
        account = Account(user_id=user.id, account_type="SAVINGS", bank_name="CSV Account", account_mask="**CSV")
        db.add(account)
        db.commit()
        db.refresh(account)

    # Deduplicate against existing transactions
    existing_records = db.query(Transaction).filter(Transaction.user_id == user.id).all()
    unique_txs, duplicate_txs = DeduplicationService.filter_unique_transactions(transactions_data, existing_records)

    for tx in unique_txs:
        db.add(Transaction(
            user_id=user.id,
            account_id=account.id,
            transaction_type=tx.get("type", "DEBIT"),
            amount=tx["amount"],
            currency="INR",
            transaction_date=datetime.strptime(tx["date"], "%Y-%m-%d").date(),
            raw_descriptor=tx["descriptor"],
            cleaned_descriptor=tx.get("cleaned_descriptor", tx["descriptor"]),
            ref_number=tx.get("ref", ""),
            payment_rail=tx.get("payment_rail", "DIRECT_MERCHANT")
        ))
    db.commit()

    all_user_txs = db.query(Transaction).filter(Transaction.user_id == user.id).order_by(Transaction.transaction_date.asc()).all()
    all_txs_data = [
        {
            "id": t.id,
            "date": t.transaction_date.isoformat(),
            "amount": float(t.amount),
            "descriptor": t.raw_descriptor,
            "ref": t.ref_number or ""
        }
        for t in all_user_txs
    ]
    analysis = analyze_statement(all_txs_data)
    annual_committed = analysis["annual_committed_total"]
    analysis["hero_metrics"] = {
        "annual_committed_total": annual_committed,
        "monthly_equivalent": round(annual_committed / 12.0, 2),
        "potential_savings": analysis["annual_potential_savings"],
        "total_mandates_found": len(analysis["mandates"]),
        "flagged_issues_count": sum(1 for m in analysis["mandates"] if m["flag"] != "HEALTHY")
    }
    analysis["filename"] = file.filename
    analysis["rows_parsed"] = len(transactions_data)
    analysis["duplicates_detected"] = len(duplicate_txs)
    analysis["new_transactions_inserted"] = len(unique_txs)

    return analysis

@router.get("/logs")
def get_ingestion_logs(
    limit: int = 20,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves audit logs of past file uploads and document ingestion."""
    logs = db.query(RawIngestLog).filter(
        RawIngestLog.user_id == user.id
    ).order_by(RawIngestLog.created_at.desc()).limit(limit).all()

    return [
        {
            "id": l.id,
            "source_type": l.source_type,
            "filename": l.filename,
            "records_extracted": l.records_extracted,
            "status": l.processing_status,
            "error": l.error_message,
            "created_at": l.created_at.isoformat()
        }
        for l in logs
    ]

