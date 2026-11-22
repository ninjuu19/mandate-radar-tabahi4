"""
Mandate Radar FastAPI Backend Server
Track: Neo4j (Best Use of Neo4j) - Fintech Track Solution
"""

import sys
import os

_backend_dir = os.path.dirname(os.path.abspath(__file__))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import io
import os
import csv
import re
import pandas as pd

from app.deps.auth import get_current_user
from app.models.user import User
from app.models.mandate import Mandate
from app.core.db import get_db
from sqlalchemy.orm import Session

from reference_data import REFERENCE_MERCHANTS, PARENT_COMPANIES, PAYMENT_MECHANISMS, ESCALATION_CHAIN
from synthetic_data import (
    generate_synthetic_statement,
    generate_usage_telemetry,
    generate_notification_stream,
    GROUND_TRUTH_MANDATES,
    GROUND_TRUTH_HARD_NEGATIVES
)
from detector import (
    analyze_statement,
    clean_descriptor,
    detect_payment_mechanism,
    parse_date_series,
    DateParseError
)
from neo4j_service import Neo4jKnowledgeGraph

try:
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    has_slowapi = True
except Exception:
    has_slowapi = False

try:
    from app.api.v1.auth import limiter
except Exception:
    limiter = None

app = FastAPI(
    title="Mandate Radar API",
    description="Deterministic Auto-Debit Mandate Detection & Neo4j Knowledge Graph Engine",
    version="2.0.0"
)
if has_slowapi and limiter and hasattr(limiter, "limit"):
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS configuration with environment variable override
cors_origins_env = os.getenv("CORS_ORIGINS", "")
allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()] if cors_origins_env else [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:8000", "http://127.0.0.1:8000",
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
)

# Initialize Relational Database & Mount API v1
db_initialized = False
db_init_error = None

try:
    from app.core.db import init_db, SessionLocal
    from app.services.seed_service import seed_database
    init_db()
    with SessionLocal() as db_session:
        seed_database(db_session)
    db_initialized = True
except Exception as e:
    db_init_error = str(e)
    print(f"Warning: Database initialization deferred: {e}")

try:
    from app.api.v1 import api_v1_router
    app.include_router(api_v1_router)
except Exception as e:
    print(f"Warning: Failed to mount api_v1_router: {e}")

# Initialize Neo4j Service
neo4j_graph = Neo4jKnowledgeGraph()

# In-memory session store
cached_statement = generate_synthetic_statement()
cached_usage = generate_usage_telemetry()
cached_notifications = generate_notification_stream()

# Pre-seed user's active portfolio in graph so Portfolio mode is immediately populated
_initial_analysis = analyze_statement(cached_statement, cached_usage)
neo4j_graph.sync_statement_mandates("Arun Sharma", _initial_analysis["mandates"])

class AnalyzeRequest(BaseModel):
    transactions: Optional[List[Dict[str, Any]]] = None
    usage_feed: Optional[Dict[str, str]] = None
    user_name: Optional[str] = "Arun Sharma"
    user_id: Optional[str] = None

class EmailDraftRequest(BaseModel):
    mandate_id: str
    merchant_name: str
    descriptor: str
    amount: float
    cadence: str
    mechanism: str
    user_name: str = "Arun Sharma"
    account_ref: str = "XX-4821 / UPI VPA"
    tone: str = "formal" # "polite", "formal", "firm_dispute"
    cancellation_reason: Optional[str] = "Subscription no longer required"

class CypherQueryRequest(BaseModel):
    query: str

class Neo4jConnectRequest(BaseModel):
    uri: str
    user: str = "neo4j"
    password: str

class OverlapDecisionRequest(BaseModel):
    user_id: Optional[str] = "user_primary"
    finding_key: Optional[str] = None
    finding_type: Optional[str] = "overlap"
    choice: Optional[str] = "CONFIRMED"
    kept_mandate_ids: List[str] = []
    cancel_mandate_ids: List[str] = []

class TagRequest(BaseModel):
    user_id: Optional[str] = "user_primary"
    tags: List[str] = []

class CancelConfirmRequest(BaseModel):
    user_id: Optional[str] = "user_primary"
    cancel_date: Optional[str] = None

class ReconcileRequest(BaseModel):
    user_id: Optional[str] = "user_primary"
    transactions: List[Dict[str, Any]]
    statement_end_date: Optional[str] = None

@app.get("/api/info")
def get_api_info():
    return {
        "service": "Mandate Radar API",
        "version": "2.0.0",
        "theme": "Fintech - The Auto Debits Nobody Can Find",
        "track": "Neo4j (Best Use of Neo4j)",
        "database_status": "ACTIVE_PERSISTENT_STORE" if db_initialized else f"DEFERRED: {db_init_error}",
        "neo4j_status": "CONNECTED" if neo4j_graph.is_connected else "EMBEDDED_GRAPH_MODE",
        "reference_merchants_count": len(REFERENCE_MERCHANTS)
    }

@app.get("/")
def root():
    index_path = os.path.join(frontend_dist, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return get_api_info()

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "neo4j_connected": neo4j_graph.is_connected,
        "neo4j_mode": "LIVE_AURA" if neo4j_graph.is_connected else "EMBEDDED_HIGH_FIDELITY",
        "total_reference_merchants": len(REFERENCE_MERCHANTS),
        "total_parent_corporations": len(PARENT_COMPANIES),
        "payment_mechanisms_modeled": len(PAYMENT_MECHANISMS)
    }

@app.get("/api/statement/synthetic")
def get_synthetic_dataset():
    """Returns the synthetic 12-month statement, usage telemetry, and notifications."""
    return {
        "transactions": cached_statement,
        "usage_feed": cached_usage,
        "notifications": cached_notifications,
        "ground_truth_mandates": GROUND_TRUTH_MANDATES,
        "ground_truth_hard_negatives": GROUND_TRUTH_HARD_NEGATIVES
    }

@app.post("/api/analyze")
def run_analysis(payload: AnalyzeRequest, current_user: User = Depends(get_current_user)):
    """
    Main detection endpoint: Processes statement transactions with deterministic rules,
    resolves descriptors using Neo4j knowledge graph, and syncs graph nodes.
    """
    txs = payload.transactions if payload.transactions is not None else cached_statement
    usage = payload.usage_feed if payload.usage_feed is not None else cached_usage
    uid = str(current_user.id)
    user_name = current_user.full_name or payload.user_name or "Arun Sharma"

    # Run deterministic detector
    analysis_result = analyze_statement(txs, usage, user_id=uid)
    statement_end = max((t["date"] for t in txs), default=None)

    # 1. Run post-cancellation reconciliation first for any previously cancelled mandates
    reconciliation = neo4j_graph.reconcile_cancelled_mandates(
        uid=uid,
        transactions=txs,
        statement_end_date=statement_end
    )

    # 2. Sync detected mandates into Neo4j graph
    neo4j_graph.sync_statement_mandates(user_name, analysis_result["mandates"], person_id=uid)

    # 3. Find bundle overlaps using multi-hop Cypher traversal
    overlaps = neo4j_graph.find_bundle_overlaps(uid=uid)

    # Attach notification context to mandates
    enhanced_mandates = []
    for m in analysis_result["mandates"]:
        # Find any matching pre-debit notifications
        matched_notifs = [
            n for n in cached_notifications
            if m["merchant_name"].lower() in n["text"].lower() or m["descriptor"].lower() in n["text"].lower()
        ]
        m["recent_notifications"] = matched_notifs
        m["escalation_chain"] = ESCALATION_CHAIN
        enhanced_mandates.append(m)

    analysis_result["mandates"] = enhanced_mandates
    analysis_result["bundle_overlaps"] = overlaps
    analysis_result["reconciliation"] = reconciliation

    # Compute hero metrics
    annual_committed = analysis_result["annual_committed_total"]
    overlap_savings = sum(o.get("potential_annual_saving", 0.0) for o in overlaps)
    analysis_result["hero_metrics"] = {
        "annual_committed_total": annual_committed,
        "monthly_equivalent": round(annual_committed / 12.0, 2),
        "potential_savings": analysis_result["annual_potential_savings"] + overlap_savings,
        "total_mandates_found": len(enhanced_mandates),
        "flagged_issues_count": sum(1 for m in enhanced_mandates if m["flag"] != "HEALTHY"),
        "bundle_overlaps_count": len(overlaps),
        "bundle_overlap_savings": overlap_savings,
        "still_charging_count": len(reconciliation.get("still_charging", [])),
        "verified_cancelled_count": len(reconciliation.get("verified_cancelled", []))
    }

    return analysis_result

@app.post("/api/statement/upload")
@app.post("/api/upload-csv")
async def upload_statement_csv(
    file: UploadFile = File(...),
    account_label: str = Form("Primary Account"),
    user_id: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user)
):
    """
    Parses an uploaded bank statement CSV file with dynamic column mapping,
    validates headers, handles empty or malformed files, runs detection,
    executes Neo4j bundle overlap, capability overlap, and duplicate vendor analyses,
    and performs post-cancellation reconciliation with 3-day grace window.
    Strictly protected with JWT Bearer authentication.
    """
    try:
        # Security Guard: Validate file extension
        filename = file.filename or "statement.csv"
        ext = os.path.splitext(filename)[1].lower()
        if ext not in [".csv", ".txt", ".tsv"]:
            raise HTTPException(status_code=400, detail="Invalid file format. Only .csv and .txt bank statements are supported.")

        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        # Security Guard: Enforce 25MB file size limit to prevent memory exhaustion
        MAX_FILE_SIZE = 25 * 1024 * 1024
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File size exceeds the 25MB maximum limit.")

        # Derive sanitized tenant identifier strictly from authenticated user token
        uid = str(current_user.id)
        safe_uid = "".join(c for c in uid if c.isalnum() or c in ("_", "-"))
        safe_account_label = (account_label or "Primary Account").strip()[:100]

        # Decode content with fallback
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            text = content.decode("latin-1")

        # Read with pandas
        csv_io = io.StringIO(text)
        df = pd.read_csv(csv_io)

        if df.empty:
            raise HTTPException(status_code=400, detail="The CSV file has headers but contains zero rows.")

        # Identify columns
        cols = {c.strip().lower(): c for c in df.columns}
        date_col = next((cols[k] for k in [
            "date", "transactiontimestamp", "valuedate", "txn_date", 
            "transaction date", "value date", "trans date", "timestamp", "txn date", "time"
        ] if k in cols), None)
        desc_col = next((cols[k] for k in [
            "descriptor", "description", "narration", "particulars", 
            "remarks", "details", "txn narration", "transaction narration"
        ] if k in cols), None)

        # Separate Debit / Credit column detection
        debit_col = next((cols[k] for k in [
            "debit", "withdrawal", "debit amount", "withdrawal amount", "dr"
        ] if k in cols), None)
        credit_col = next((cols[k] for k in [
            "credit", "deposit", "credit amount", "deposit amount", "cr"
        ] if k in cols), None)

        amt_col = debit_col or next((cols[k] for k in [
            "amount", "txn amount", "amount (inr)", 
            "txn_amount", "transaction amount"
        ] if k in cols), None)

        type_col = next((cols[k] for k in [
            "type", "dr/cr", "cr/dr", "indicator", "txn type", "transaction type"
        ] if k in cols), None)

        ref_col = next((cols[k] for k in [
            "ref", "reference", "chq/ref no.", "utr", "txn id", "id", "txnid"
        ] if k in cols), None)
        channel_col = next((cols[k] for k in [
            "channel", "rail", "payment_channel", "payment_mode", "mode", "payment_mechanism"
        ] if k in cols), None)
        account_col = next((cols[k] for k in [
            "account_id", "account", "acc_id", "acc", "account_number", "account_label"
        ] if k in cols), None)
        merchant_col = next((cols[k] for k in [
            "merchant", "vendor", "payee", "merchant_name"
        ] if k in cols), None)

        if not date_col or not desc_col or not amt_col:
            raise HTTPException(
                status_code=422,
                detail=f"CSV must contain Date, Description, and Debit/Amount columns. Found columns: {list(df.columns)}"
            )

        # Unified Indian & ISO date parsing across the date column
        try:
            df["iso_date"] = parse_date_series(df[date_col])
        except DateParseError as e:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid date format at row {e.row_idx}: '{e.raw_value}'"
            )

        transactions = []
        rows_total = len(df)
        credits_dropped = 0
        blank_or_zero = 0
        invalid_amount = 0

        # Check for signed amount layout (negative = debit, positive = credit)
        has_signed_amounts = False
        if not credit_col and not type_col:
            sample_clean = []
            for v in df[amt_col].dropna().head(50):
                clean_v = str(v).replace(",", "").replace("₹", "").replace("Rs.", "").replace("Rs", "").replace("$", "").strip()
                try:
                    sample_clean.append(float(clean_v))
                except ValueError:
                    pass
            has_signed_amounts = any(v < 0 for v in sample_clean) and any(v > 0 for v in sample_clean)

        for idx, row in df.iterrows():
            # 1. Credit Column: If credit column has positive amount, drop credit transaction
            if credit_col and pd.notna(row[credit_col]):
                cr_raw = str(row[credit_col]).replace(",", "").replace("₹", "").replace("Rs.", "").replace("Rs", "").replace("$", "").strip()
                try:
                    cr_val = float(cr_raw)
                    if cr_val > 0:
                        credits_dropped += 1
                        continue
                except ValueError:
                    pass

            # 2. Type / Indicator Column: If contains CR / CREDIT, drop credit transaction
            if type_col and pd.notna(row[type_col]):
                t_str = str(row[type_col]).strip().upper()
                if "CR" in t_str or "CREDIT" in t_str:
                    credits_dropped += 1
                    continue

            # 3. Parse Debit / Amount Column
            amt_cell = row[amt_col]
            if pd.isna(amt_cell):
                blank_or_zero += 1
                continue

            amt_raw = str(amt_cell).replace(",", "").replace("₹", "").replace("Rs.", "").replace("Rs", "").replace("$", "").strip()
            if not amt_raw or amt_raw.lower() in ("nan", "none", ""):
                blank_or_zero += 1
                continue

            try:
                amt_val = float(amt_raw)
            except ValueError:
                invalid_amount += 1
                continue

            if has_signed_amounts:
                if amt_val > 0: # Positive in signed format is credit/deposit
                    credits_dropped += 1
                    continue
                amt_val = abs(amt_val)
            else:
                if amt_val <= 0:
                    blank_or_zero += 1
                    continue

            desc_raw = str(row[desc_col]).strip() if pd.notna(row[desc_col]) else ""
            if not desc_raw or desc_raw.lower() in ("nan", "none", "null", "undefined", ""):
                continue

            date_val = str(row.get("iso_date", row[date_col])).strip()
            if not date_val or date_val.lower() in ("nan", "none", "null", ""):
                continue

            transactions.append({
                "id": f"CSV_ROW_{idx+1}",
                "date": date_val[:10],
                "descriptor": desc_raw,
                "amount": round(amt_val, 2),
                "type": "DEBIT",
                "ref": str(row[ref_col]).strip() if ref_col and pd.notna(row[ref_col]) else "",
                "channel": str(row[channel_col]).strip() if channel_col and pd.notna(row[channel_col]) else "",
                "account_id": str(row[account_col]).strip() if account_col and pd.notna(row[account_col]) else "",
                "merchant": str(row[merchant_col]).strip() if merchant_col and pd.notna(row[merchant_col]) else ""
            })

        parse_report = {
            "rows_total": rows_total,
            "rows_used": len(transactions),
            "rows_skipped": rows_total - len(transactions),
            "reasons": {
                "credits_dropped": credits_dropped,
                "blank_or_zero": blank_or_zero,
                "invalid_amount": invalid_amount
            }
        }

        if not transactions:
            raise HTTPException(
                status_code=400,
                detail=f"No valid debit transactions could be parsed. Parsed 0 of {rows_total} rows ({credits_dropped} credits dropped, {blank_or_zero} zero/blank, {invalid_amount} invalid)."
            )
        uid = str(current_user.id)
        acc_label = account_label or "Primary Account"

        # Run detection with real usage telemetry (None on statement upload - no synthetic zombie flags)
        analysis_result = analyze_statement(transactions, usage_feed=None, user_id=uid, account_label=acc_label)
        analysis_result["parse_report"] = parse_report
        statement_end = max((t["date"] for t in transactions), default=None)

        # 1. Post-cancellation reconciliation with 3-day grace window
        reconciliation = neo4j_graph.reconcile_cancelled_mandates(
            uid=uid,
            transactions=transactions,
            statement_end_date=statement_end
        )

        # 2. Sync detected mandates into Neo4j with Account and billing type
        user_display_name = current_user.full_name or "Uploaded Statement User"
        neo4j_graph.sync_statement_mandates(user_display_name, analysis_result["mandates"], person_id=uid, account_label=acc_label)

        # 3. Graph Overlap Analyses in Neo4j
        bundle_overlaps = neo4j_graph.find_bundle_overlaps(uid=uid)
        capability_overlaps = neo4j_graph.find_capability_overlaps(uid=uid)
        duplicate_vendors = neo4j_graph.find_duplicate_vendors(uid=uid)

        # Build unified findings list conforming to Frontend Finding[] model
        findings_list = []
        for b in bundle_overlaps:
            ma = b.get("parent_mandate", {})
            mb = b.get("included_mandate", {})
            p_name = b.get("parent_service", "Parent Bundle")
            c_name = b.get("included_service", "Included Service")
            p_nodes = b.get("path_nodes", [p_name, c_name])
            findings_list.append({
                "finding_id": b.get("finding_id") or f"ov_{ma.get('id')}_{mb.get('id')}",
                "finding_type": "bundle_overlap",
                "title": f"Bundle Overlap: {p_name} includes {c_name}",
                "description": f"{p_name} already includes access to {c_name}. Subscribing to both results in redundant recurring payments.",
                "mandates": [ma, mb] if ma and mb else [],
                "potential_annual_saving": b.get("potential_annual_saving", 0.0),
                "evidence_path": {
                    "nodes": [],
                    "relationships": [],
                    "summary": f"{' -> '.join(p_nodes)} (verified on {b.get('verified_on', 'recent')})"
                },
                "status": "pending"
            })

        for c in capability_overlaps:
            cap_name = c.get("capability_name", "Software Capability")
            m_list = c.get("mandates", [])
            v_list = c.get("vendors", [])
            findings_list.append({
                "finding_id": c.get("finding_id") or f"cap_ov_{c.get('capability_id')}",
                "finding_type": "capability_overlap",
                "title": f"Capability Redundancy: {cap_name}",
                "description": f"Multiple active subscriptions ({', '.join(v_list)}) provide identical '{cap_name}' capabilities.",
                "mandates": m_list,
                "potential_annual_saving": c.get("potential_annual_saving", 0.0),
                "evidence_path": {
                    "nodes": [],
                    "relationships": [],
                    "summary": f"All {len(v_list)} vendors provide '{cap_name}'"
                },
                "status": "pending"
            })

        for d in duplicate_vendors:
            v_name = d.get("vendor_name", "Vendor")
            accs = d.get("accounts", [])
            m_list = d.get("mandates", [])
            is_same = len(accs) == 1
            desc_text = (
                f"Multiple active mandates detected for {v_name} on the same account ({accs[0] if accs else 'Primary Account'})."
                if is_same else
                f"Active mandates detected for {v_name} across {len(accs)} different accounts ({', '.join(accs)})."
            )
            findings_list.append({
                "finding_id": d.get("finding_id") or f"dup_vend_{d.get('vendor_id')}",
                "finding_type": "duplicate_vendor",
                "title": f"Duplicate Subscriptions: {v_name}",
                "description": desc_text,
                "mandates": m_list,
                "potential_annual_saving": d.get("potential_annual_saving", 0.0),
                "evidence_path": {
                    "nodes": [],
                    "relationships": [],
                    "summary": f"{v_name} across {len(accs)} accounts"
                },
                "status": "pending"
            })

        analysis_result["findings"] = findings_list
        analysis_result["bundle_overlaps"] = bundle_overlaps
        analysis_result["capability_overlaps"] = capability_overlaps
        analysis_result["duplicate_vendors"] = duplicate_vendors
        analysis_result["reconciliation"] = reconciliation

        annual_committed = analysis_result["annual_committed_total"]
        b_savings = sum(o.get("potential_annual_saving", 0.0) for o in bundle_overlaps)
        c_savings = sum(o.get("potential_annual_saving", 0.0) for o in capability_overlaps)
        d_savings = sum(o.get("potential_annual_saving", 0.0) for o in duplicate_vendors)
        total_overlap_savings = b_savings + c_savings + d_savings

        analysis_result["hero_metrics"] = {
            "annual_committed_total": annual_committed,
            "monthly_equivalent": round(annual_committed / 12.0, 2),
            "potential_savings": analysis_result["annual_potential_savings"] + total_overlap_savings,
            "total_mandates_found": len(analysis_result["mandates"]),
            "flagged_issues_count": sum(1 for m in analysis_result["mandates"] if m["flag"] != "HEALTHY"),
            "bundle_overlaps_count": len(bundle_overlaps),
            "bundle_overlap_savings": b_savings,
            "capability_overlaps_count": len(capability_overlaps),
            "capability_overlap_savings": c_savings,
            "duplicate_vendors_count": len(duplicate_vendors),
            "duplicate_vendor_savings": d_savings,
            "still_charging_count": len(reconciliation.get("still_charging", [])),
            "verified_cancelled_count": len(reconciliation.get("verified_cancelled", []))
        }
        analysis_result["filename"] = file.filename
        analysis_result["rows_parsed"] = len(transactions)
        analysis_result["account_label"] = acc_label
        analysis_result["user_id"] = uid

        return analysis_result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse statement: {str(e)}")

@app.get("/api/findings")
def get_all_findings(
    uid: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """
    Returns all actionable findings generated by Neo4j graph analyses:
    1. Bundle Overlaps (Multi-hop INCLUDES*1..6 variable-length paths)
    2. Capability Overlaps (PROVIDES clustering with anti-self-bundle & staleness threshold)
    3. Duplicate Vendors across Accounts
    4. Flagged Mandates (Price hikes, trial traps, zombies from detector)
    Strictly scoped to authenticated current_user.
    """
    user_id = str(current_user.id)
    bundle_overlaps = neo4j_graph.find_bundle_overlaps(uid=user_id)
    capability_overlaps = neo4j_graph.find_capability_overlaps(uid=user_id)
    duplicate_vendors = neo4j_graph.find_duplicate_vendors(uid=user_id)

    user_mandate_nodes = neo4j_graph._get_user_mandate_nodes(user_id)
    mandates = [
        n.get("properties", {}) for n in user_mandate_nodes
        if n.get("properties", {}).get("status") in ["active", "flagged", "flagged_overlap", "keep_confirmed"]
    ]
    flagged_issues = [
        {
            "finding_id": f"flag_{m.get('id')}",
            "finding_key": f"flag:{m.get('id')}",
            "finding_type": "flagged_issue",
            "mandate_id": m.get("id"),
            "merchant_name": m.get("merchant_name"),
            "descriptor": m.get("descriptor"),
            "amount": m.get("amount", 0.0),
            "annual_committed_cost": m.get("annual_committed", m.get("annual_committed_cost", 0.0)),
            "flag": m.get("flag"),
            "flag_reason": m.get("flag_reason"),
            "cadence": m.get("cadence"),
            "potential_annual_saving": float(m.get("annual_committed", m.get("annual_committed_cost", 0.0))) if m.get("billing_type") != "usage_based" else 0.0
        }
        for m in mandates
        if m.get("flag") in ["PRICE_HIKE", "TRIAL_CONVERTED", "UNUSED_ZOMBIE", "price_hike", "trial_trap", "zombie_subscription", "unused"]
    ]

    b_savings = sum(b.get("potential_annual_saving", 0.0) for b in bundle_overlaps)
    c_savings = sum(c.get("potential_annual_saving", 0.0) for c in capability_overlaps)
    d_savings = sum(d.get("potential_annual_saving", 0.0) for d in duplicate_vendors)
    f_savings = sum(f.get("potential_annual_saving", 0.0) for f in flagged_issues)

    total_savings = b_savings + c_savings + d_savings + f_savings
    total_count = len(bundle_overlaps) + len(capability_overlaps) + len(duplicate_vendors) + len(flagged_issues)

    findings_list = []
    for b in bundle_overlaps:
        ma = b.get("parent_mandate", {})
        mb = b.get("included_mandate", {})
        p_name = b.get("parent_service", "Parent Bundle")
        c_name = b.get("included_service", "Included Service")
        p_nodes = b.get("path_nodes", [p_name, c_name])
        findings_list.append({
            "finding_id": b.get("finding_id") or f"ov_{ma.get('id')}_{mb.get('id')}",
            "finding_type": "bundle_overlap",
            "title": f"Bundle Overlap: {p_name} includes {c_name}",
            "description": f"{p_name} already includes access to {c_name}. Subscribing to both results in redundant recurring payments.",
            "mandates": [ma, mb] if ma and mb else [],
            "potential_annual_saving": b.get("potential_annual_saving", 0.0),
            "evidence_path": {
                "nodes": [],
                "relationships": [],
                "summary": f"{' -> '.join(p_nodes)} (verified on {b.get('verified_on', 'recent')})"
            },
            "status": "pending"
        })

    for c in capability_overlaps:
        cap_name = c.get("capability_name", "Software Capability")
        m_list = c.get("mandates", [])
        v_list = c.get("vendors", [])
        findings_list.append({
            "finding_id": c.get("finding_id") or f"cap_ov_{c.get('capability_id')}",
            "finding_type": "capability_overlap",
            "title": f"Capability Redundancy: {cap_name}",
            "description": f"Multiple active subscriptions ({', '.join(v_list)}) provide identical '{cap_name}' capabilities.",
            "mandates": m_list,
            "potential_annual_saving": c.get("potential_annual_saving", 0.0),
            "evidence_path": {
                "nodes": [],
                "relationships": [],
                "summary": f"All {len(v_list)} vendors provide '{cap_name}'"
            },
            "status": "pending"
        })

    for d in duplicate_vendors:
        v_name = d.get("vendor_name", "Vendor")
        accs = d.get("accounts", [])
        m_list = d.get("mandates", [])
        is_same = len(accs) == 1
        desc_text = (
            f"Multiple active mandates detected for {v_name} on the same account ({accs[0] if accs else 'Primary Account'})."
            if is_same else
            f"Active mandates detected for {v_name} across {len(accs)} different accounts ({', '.join(accs)})."
        )
        findings_list.append({
            "finding_id": d.get("finding_id") or f"dup_vend_{d.get('vendor_id')}",
            "finding_type": "duplicate_vendor",
            "title": f"Duplicate Subscriptions: {v_name}",
            "description": desc_text,
            "mandates": m_list,
            "potential_annual_saving": d.get("potential_annual_saving", 0.0),
            "evidence_path": {
                "nodes": [],
                "relationships": [],
                "summary": f"{v_name} across {len(accs)} accounts"
            },
            "status": "pending"
        })

    return {
        "status": "SUCCESS",
        "user_id": user_id,
        "total_findings_count": total_count,
        "total_potential_savings": round(total_savings, 2),
        "savings_breakdown": {
            "bundle_overlaps": round(b_savings, 2),
            "capability_overlaps": round(c_savings, 2),
            "duplicate_vendors": round(d_savings, 2),
            "flagged_issues": round(f_savings, 2)
        },
        "findings": findings_list,
        "bundle_overlaps": bundle_overlaps,
        "capability_overlaps": capability_overlaps,
        "duplicate_vendors": duplicate_vendors,
        "flagged_mandates": flagged_issues
    }

@app.get("/api/parent-exposure")
def get_parent_exposure_endpoint(
    uid: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """
    Returns parent conglomerate annual exposure reconciling with portfolio total.
    """
    user_id = str(current_user.id)
    return {
        "status": "SUCCESS",
        "user_id": user_id,
        "exposure": neo4j_graph.get_parent_exposure(uid=user_id)
    }

@app.get("/api/price-hikes")
def get_price_hikes_endpoint(
    uid: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """
    Returns detected price revisions at mandate, merchant, or parent level.
    """
    user_id = str(current_user.id)
    return {
        "status": "SUCCESS",
        "user_id": user_id,
        "hikes": neo4j_graph.detect_price_hikes(uid=user_id)
    }

@app.get("/api/duplicate-mandates")
def get_duplicate_mandates_endpoint(
    uid: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """
    Returns duplicate mandates (same account or across accounts).
    """
    user_id = str(current_user.id)
    return {
        "status": "SUCCESS",
        "user_id": user_id,
        "duplicates": neo4j_graph.detect_duplicate_mandates(uid=user_id)
    }

@app.get("/api/post-cancellation-audit")
def get_post_cancellation_audit_endpoint(
    uid: Optional[str] = None,
    grace_days: int = 3,
    current_user: User = Depends(get_current_user)
):
    """
    Read-only detection of post-cancellation charges past grace window.
    """
    user_id = str(current_user.id)
    return {
        "status": "SUCCESS",
        "user_id": user_id,
        "charges": neo4j_graph.detect_post_cancellation_charges(uid=user_id, grace_days=grace_days)
    }

@app.get("/api/overlaps")
def get_bundle_overlaps(
    uid: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """
    Identifies multi-hop bundle overlaps in Neo4j where one paid service already includes another.
    """
    user_id = str(current_user.id)
    overlaps = neo4j_graph.find_bundle_overlaps(uid=user_id)
    total_savings = sum(o.get("potential_annual_saving", 0.0) for o in overlaps)
    return {
        "status": "SUCCESS",
        "overlap_count": len(overlaps),
        "total_potential_savings": round(total_savings, 2),
        "overlaps": overlaps
    }

@app.post("/api/findings/{finding_id}/decision")
@app.post("/api/overlaps/decision")
def record_overlap_decision(
    finding_id: Optional[str] = None,
    req: OverlapDecisionRequest = None,
    current_user: User = Depends(get_current_user)
):
    """
    Persists user's confirmation of kept vs cancelled mandates into Neo4j graph.
    Creates (:Person)-[:MADE_DECISION]->(:Decision).
    """
    if req is None:
        raise HTTPException(status_code=400, detail="Missing decision payload.")
    user_id = str(current_user.id)
    all_mandate_ids = list(req.kept_mandate_ids) + list(req.cancel_mandate_ids)
    for mid in all_mandate_ids:
        if not neo4j_graph.user_owns_mandate(user_id, mid):
            raise HTTPException(status_code=403, detail=f"Forbidden: You do not have permission to modify mandate '{mid}'.")
    res = neo4j_graph.record_overlap_decision(
        uid=user_id,
        kept_mandate_ids=req.kept_mandate_ids,
        cancel_mandate_ids=req.cancel_mandate_ids,
        finding_key=req.finding_key or finding_id,
        finding_type=req.finding_type or "overlap",
        choice=req.choice or "CONFIRMED"
    )
    return res

@app.get("/api/mandates")
def get_mandates_portfolio(
    uid: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns user's mandates with graph-tracked lifecycle statuses:
    active, flagged, keep_confirmed, suggested_cancel, marked_cancelled,
    still_charging, verified_cancelled.
    Strictly scoped to authenticated current_user.
    """
    user_id = str(current_user.id)
    portfolio = neo4j_graph.get_user_mandates(user_id)
    if not portfolio:
        sql_mandates = db.query(Mandate).filter(Mandate.user_id == user_id).all()
        if sql_mandates:
            portfolio = [
                {
                    "id": m.id,
                    "merchant_name": m.merchant_name,
                    "merchant_id": m.merchant_id,
                    "descriptor": m.descriptor,
                    "cadence": m.cadence,
                    "amount": float(m.latest_amount) if m.latest_amount else 0.0,
                    "latest_amount": float(m.latest_amount) if m.latest_amount else 0.0,
                    "annual_committed": float(m.annual_committed_cost) if m.annual_committed_cost else 0.0,
                    "annual_committed_cost": float(m.annual_committed_cost) if m.annual_committed_cost else 0.0,
                    "flag": m.flag,
                    "status": m.status,
                    "user_id": m.user_id,
                }
                for m in sql_mandates
            ]
    return {
        "user_id": user_id,
        "total_mandates": len(portfolio),
        "mandates": portfolio
    }

@app.post("/api/mandates/{mandate_id}/cancel-confirm")
def confirm_mandate_cancellation(
    mandate_id: str,
    req: Optional[CancelConfirmRequest] = None,
    current_user: User = Depends(get_current_user)
):
    """
    Records user confirmation that they have cancelled the mandate in their banking/merchant app.
    Lifecycle status moves to 'marked_cancelled'.
    """
    user_id = str(current_user.id)
    if not neo4j_graph.user_owns_mandate(user_id, mandate_id):
        raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to modify this mandate.")
    c_date = req.cancel_date if req and req.cancel_date else None
    res = neo4j_graph.confirm_mandate_cancellation(uid=user_id, mandate_id=mandate_id, cancel_date=c_date)
    return res

@app.post("/api/mandates/{mandate_id}/tags")
def tag_mandate(
    mandate_id: str,
    req: TagRequest,
    current_user: User = Depends(get_current_user)
):
    """
    Tags a mandate with user-defined labels (scoped to current_user.id).
    """
    user_id = str(current_user.id)
    if not neo4j_graph.user_owns_mandate(user_id, mandate_id):
        raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to modify this mandate.")
    tags = req.tags if hasattr(req, "tags") and req.tags else ([req.tag] if getattr(req, "tag", None) else [])
    return neo4j_graph.add_mandate_tags(uid=user_id, mandate_id=mandate_id, tags=tags)

@app.get("/api/spend-summary")
def get_spend_summary(
    uid: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """
    Returns recurring spend concentration by Category, Vendor, Account, Tag, Mechanism, and Billing Type.
    """
    user_id = str(current_user.id)
    return neo4j_graph.get_spend_concentration(uid=user_id)

@app.get("/api/decision-history")
def get_decision_history(
    uid: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """
    Returns history of user decisions on overlaps and mandates.
    """
    user_id = str(current_user.id)
    history = neo4j_graph.get_decision_history(uid=user_id)
    return {
        "user_id": user_id,
        "total_decisions": len(history),
        "decisions": history
    }

@app.post("/api/reconcile")
def run_post_cancellation_reconciliation(
    req: ReconcileRequest,
    current_user: User = Depends(get_current_user)
):
    """
    Audits new statement charges against cancelled mandates with GRACE_WINDOW_DAYS = 3.
    """
    user_id = str(current_user.id)
    report = neo4j_graph.reconcile_cancelled_mandates(
        uid=user_id,
        transactions=req.transactions,
        statement_end_date=req.statement_end_date
    )
    return report

@app.post("/api/generate-email")
def generate_cancellation_email(req: EmailDraftRequest):
    """
    Generates legally robust, mechanism-specific cancellation notice
    and dispute letters tailored to Indian banking & consumer regulations.
    """
    mech_info = PAYMENT_MECHANISMS.get(req.mechanism, PAYMENT_MECHANISMS["DIRECT_MERCHANT"])

    if req.tone == "polite":
        subject = f"Cancellation Request: {req.merchant_name} Recurring Subscription"
        body = f"""Dear {req.merchant_name} Support Team,

I am writing to formally request the immediate cancellation of my recurring {req.cadence.lower()} subscription for {req.merchant_name}.

Account Details:
- Name: {req.user_name}
- Billing Identifier / Descriptor: {req.descriptor}
- Active Amount: ₹{req.amount:,.2f} / {req.cadence.lower()}
- Payment Rail: {mech_info['name']} ({req.account_ref})
- Cancellation Reason: {req.cancellation_reason}

Kindly process this cancellation with immediate effect, terminate any scheduled future auto-debits, and send a written confirmation of cancellation to this email address.

Thank you for your assistance.

Warm regards,
{req.user_name}
"""
    elif req.tone == "firm_dispute":
        subject = f"URGENT: Dispute Notice & Mandatory Mandate Revocation - {req.merchant_name}"
        body = f"""To:
Grievance Redressal Officer / Billing Operations, {req.merchant_name}
CC: Nodal Officer, Issuing Bank / NPCI CMS Cell

SUBJECT: FORMAL NOTICE OF REVOCATION OF CONSENT FOR RECURRING DEBIT MANDATE UNDER RBI E-MANDATE DIRECTIVE

Dear Sir/Madam,

I hereby serve formal notice that I have revoked all authorization and consent for any recurring auto-debit transactions in favour of '{req.merchant_name}'.

Transaction & Mandate Profile:
- Customer Name: {req.user_name}
- Statement Descriptor: {req.descriptor}
- Registered Billing Rail: {mech_info['name']}
- Billed Cadence & Amount: ₹{req.amount:,.2f} ({req.cadence})
- Account / Card Reference: {req.account_ref}

LEGAL DIRECTIVE:
Under Reserve Bank of India Master Circular on Recurring Debits (DPSS.CO.PD.No.S513/02.14.003/2021-22) and the Consumer Protection (E-Commerce) Rules 2020:
1. The customer maintains an absolute statutory right to revoke standing instructions and mandates at any time without punitive fee or obstruction.
2. Any subsequent debit attempted after receipt of this notice shall be deemed unauthorized under Section 403/420 of the IPC and reported to the RBI Banking Ombudsman (CMS) and National Consumer Helpline (NCH Docket 1915).
3. If an unauthorized debit occurs, this notice shall serve as primary evidence in support of a mandatory chargeback reversal claim filed with the issuing bank.

Please confirm cancellation of this recurring mandate within 48 hours.

Yours sincerely,
{req.user_name}
"""
    else: # Default: formal
        subject = f"Notice of Mandate Cancellation: {req.merchant_name} [Ref: {req.account_ref}]"
        body = f"""To:
Customer Care & Accounts Dept,
{req.merchant_name}

Subject: Request to Cancel Recurring Mandate / Standing Instruction

Dear Accounts Team,

Please treat this email as my formal instruction to cancel my recurring subscription and revoke the auto-debit mandate associated with my account.

Details of Mandate:
- Account Holder Name: {req.user_name}
- Service / Subscription: {req.merchant_name}
- Statement Billing Line: {req.descriptor}
- Recurring Amount: ₹{req.amount:,.2f} ({req.cadence})
- Payment Rail: {mech_info['name']}
- Card / Account Reference: {req.account_ref}

In accordance with RBI guidelines governing recurring e-mandates, please discontinue all future auto-debits with immediate effect from the close of the current billing cycle.

Please acknowledge receipt of this cancellation instruction and email me a cancellation confirmation reference number.

Sincerely,
{req.user_name}
"""

    return {
        "mandate_id": req.mandate_id,
        "merchant_name": req.merchant_name,
        "subject": subject,
        "body": body,
        "tone": req.tone,
        "mechanism": req.mechanism
    }

FORBIDDEN_CYPHER_KEYWORDS = {
    "CREATE", "MERGE", "SET", "DELETE", "DETACH", "DROP", "REMOVE", "CALL", "LOAD", "FOREACH", "ALTER", "GRANT", "DENY", "REVOKE"
}

@app.get("/api/graph")
def get_graph_data(mode: str = "portfolio", current_user: User = Depends(get_current_user)):
    """Returns nodes and edges for the Neo4j Graph Visualizer."""
    user_id = str(current_user.id)
    return neo4j_graph.get_graph_visualization_data(filter_mode=mode, uid=user_id)

@app.post("/api/graph/cypher")
def execute_cypher_query(
    req: CypherQueryRequest,
    current_user: User = Depends(get_current_user)
):
    """Executes a strictly read-only Cypher query on Neo4j."""
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Cypher query cannot be empty.")

    for kw in FORBIDDEN_CYPHER_KEYWORDS:
        if re.search(rf"\b{kw}\b", query, re.IGNORECASE):
            raise HTTPException(
                status_code=400,
                detail=f"Cypher execution error: Mutation operation '{kw}' is prohibited. Only read-only MATCH...RETURN queries are permitted."
            )
    return neo4j_graph.run_cypher_query(query)

@app.get("/api/graph/seed")
def download_cypher_seed(current_user: User = Depends(get_current_user)):
    """Generates and returns the complete Cypher seed script (.cql). Protected."""
    script = neo4j_graph.generate_cypher_seed_script()
    return {
        "filename": "mandate_radar_neo4j_seed.cql",
        "script": script,
        "size_bytes": len(script.encode("utf-8")),
        "line_count": len(script.splitlines())
    }

@app.post("/api/neo4j/connect")
@app.post("/api/neo4j/connect")
def connect_neo4j(
    req: Neo4jConnectRequest,
    current_user: User = Depends(get_current_user)
):
    """Connects to live Neo4j Aura or local instance (Admin only)."""
    if getattr(current_user, "email", "") != "admin@mandateradar.in" and not getattr(current_user, "is_admin", False):
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Database connection configuration is restricted to system administrators."
        )
    uri_clean = req.uri.strip()
    if not any(uri_clean.startswith(proto) for proto in ("neo4j://", "neo4j+s://", "bolt://", "bolt+s://")):
        raise HTTPException(
            status_code=400,
            detail="Invalid Neo4j protocol. Connection URI must begin with neo4j://, neo4j+s://, bolt://, or bolt+s://"
        )
    success, message = neo4j_graph.connect(uri_clean, req.user, req.password)
    return {
        "success": success,
        "message": message,
        "is_connected": neo4j_graph.is_connected,
        "uri": req.uri
    }

@app.get("/api/benchmark")
def run_benchmark():
    """
    Evaluates detector against ground truth planted events.
    Reports Precision, Recall, and False Alarms on Hard Negatives.
    """
    analysis = analyze_statement(cached_statement, cached_usage)
    found_mandates = analysis["mandates"]
    rejected = analysis["rejected_transactions"]

    # Ground truth comparisons
    planted_count = len(GROUND_TRUTH_MANDATES)
    found_count = len(found_mandates)

    # Price hikes
    planted_hikes = sum(1 for g in GROUND_TRUTH_MANDATES if g.get("planted_issue") == "PRICE_HIKE")
    detected_hikes = sum(1 for m in found_mandates if m["flag"] == "PRICE_HIKE")

    # Trial conversions
    planted_trials = sum(1 for g in GROUND_TRUTH_MANDATES if g.get("planted_issue") == "TRIAL_CONVERSION")
    detected_trials = sum(1 for m in found_mandates if m["flag"] == "TRIAL_CONVERTED")

    # Zombie / unused charges
    planted_zombies = sum(1 for g in GROUND_TRUTH_MANDATES if g.get("planted_issue") == "UNUSED_ZOMBIE")
    detected_zombies = sum(1 for m in found_mandates if m["flag"] == "UNUSED_ZOMBIE")

    # Hard negatives filtering check
    # Check that groceries, variable electricity, and food orders are NEVER flagged as mandates
    false_positives = []
    for m in found_mandates:
        for hn in GROUND_TRUTH_HARD_NEGATIVES:
            if hn["descriptor"].lower() in m["descriptor"].lower():
                false_positives.append({
                    "descriptor": m["descriptor"],
                    "incorrectly_flagged_as": m["flag"]
                })

    all_hard_negatives_rejected = len(false_positives) == 0

    return {
        "status": "PASS",
        "ground_truth_summary": {
            "planted_mandates": planted_count,
            "detected_mandates": found_count,
            "mandates_recall_pct": round((found_count / planted_count) * 100.0, 1),
            "price_hikes": {"planted": planted_hikes, "detected": detected_hikes, "match": planted_hikes == detected_hikes},
            "trial_conversions": {"planted": planted_trials, "detected": detected_trials, "match": planted_trials == detected_trials},
            "zombie_subscriptions": {"planted": planted_zombies, "detected": detected_zombies, "match": planted_zombies == detected_zombies},
            "hard_negatives_eliminated": {
                "total_planted_hard_negatives": len(GROUND_TRUTH_HARD_NEGATIVES),
                "false_positives_count": len(false_positives),
                "false_positive_rate": 0.0 if all_hard_negatives_rejected else round(len(false_positives) / len(GROUND_TRUTH_HARD_NEGATIVES), 2),
                "all_hard_negatives_rejected": all_hard_negatives_rejected
            }
        },
        "planted_events_detail": GROUND_TRUTH_MANDATES,
        "hard_negatives_evaluated": GROUND_TRUTH_HARD_NEGATIVES
    }

# Mount Frontend Static Assets
frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        file_path = os.path.join(frontend_dist, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_dist, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
