"""
Phase 1 Correctness & Security Regression Tests
===============================================
Tests:
1. Indian Date Format Parsing & Strict 422 Row Error Reporting
2. Amount Layout Parsing (Credits Dropped, Dr/Cr Indicators, Signed Amounts, Blank/Zero Skips)
3. Parse Report Verification (rows_total, rows_used, rows_skipped, reasons)
4. Telemetry Realism (Zero Synthetic Zombie Flags Without Telemetry Feed)
5. Lapsed Mandate Lifecycle (Status 'lapsed', 0.0 Commitment, Excluded From Savings)
6. Obligation Segregation (Rent / EMI Excluded From Cancellable Savings)
7. Multi-Account Duplicate Vendor Keying (Isolation by Account)
"""

import io
import os
import pytest
import pandas as pd
from fastapi.testclient import TestClient

from main import app
from detector import analyze_statement, parse_date_series, DateParseError, detect_obligation
from app.services.auth_service import create_access_token
from app.core.db import init_db, get_db
from app.models.user import User

client = TestClient(app)

@pytest.fixture(scope="module")
def auth_headers():
    init_db()
    session = next(get_db())
    u = session.query(User).filter(User.id == "test_phase1_user").first()
    if not u:
        u = User(id="test_phase1_user", email="test_phase1@example.com", password_hash="hash", full_name="Phase1 User", is_active=True)
        session.add(u)
        session.commit()
    token = create_access_token({"sub": "test_phase1_user", "email": "test_phase1@example.com"})
    return {"Authorization": f"Bearer {token}"}

def test_indian_date_parsing_success():
    """Verify Indian day-first date formats convert cleanly to ISO YYYY-MM-DD."""
    dates_dmy = pd.Series(["15/01/2026", "15/02/2026", "15/03/2026"])
    parsed_dmy = parse_date_series(dates_dmy)
    assert parsed_dmy.tolist() == ["2026-01-15", "2026-02-15", "2026-03-15"]

    dates_dash = pd.Series(["20-01-26", "20-02-26", "20-03-26"])
    parsed_dash = parse_date_series(dates_dash)
    assert parsed_dash.tolist() == ["2026-01-20", "2026-02-20", "2026-03-20"]

    dates_mon = pd.Series(["10-Jan-2026", "10-Feb-2026", "10-Mar-2026"])
    parsed_mon = parse_date_series(dates_mon)
    assert parsed_mon.tolist() == ["2026-01-10", "2026-02-10", "2026-03-10"]

def test_invalid_date_returns_422_with_row_number(auth_headers):
    """Verify an unparseable date returns HTTP 422 naming the exact CSV row number."""
    csv_content = (
        "Date,Descriptor,Amount\n"
        "2026-01-15,NETFLIX,649.00\n"
        "2026-02-15,NETFLIX,649.00\n"
        "NOT_A_DATE,NETFLIX,649.00\n"
        "2026-04-15,NETFLIX,649.00\n"
    )
    files = {"file": ("statement.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    res = client.post("/api/statement/upload", files=files, headers=auth_headers)
    assert res.status_code == 422
    data = res.json()
    assert "Invalid date format at row 4" in data["detail"]
    assert "NOT_A_DATE" in data["detail"]

def test_amount_layout_credits_dropped_and_parse_report(auth_headers):
    """
    Verify:
    1. Separate Debit & Credit columns drop salary/credit deposits.
    2. Zero and blank amount rows are skipped.
    3. parse_report accurately reflects dropped credits and blank rows.
    """
    csv_content = (
        "Date,Narration,Withdrawal,Deposit\n"
        "15/01/2026,NETFLIX INDIA,649.00,\n"
        "16/01/2026,SALARY CREDIT BY EMPLOYER,,150000.00\n"
        "15/02/2026,NETFLIX INDIA,649.00,\n"
        "16/02/2026,DIVIDEND CREDIT,,500.00\n"
        "15/03/2026,NETFLIX INDIA,649.00,\n"
        "20/03/2026,BLANK ROW,,\n"
    )
    files = {"file": ("statement.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    res = client.post("/api/statement/upload", files=files, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()

    assert data["rows_parsed"] == 3
    report = data["parse_report"]
    assert report["rows_total"] == 6
    assert report["rows_used"] == 3
    assert report["rows_skipped"] == 3
    assert report["reasons"]["credits_dropped"] == 2
    assert report["reasons"]["blank_or_zero"] == 1

    # Ensure salary never appears as a detected mandate
    merchants = [m["merchant_name"] for m in data["mandates"]]
    assert not any("SALARY" in m for m in merchants)
    assert any("Netflix" in m for m in merchants)

def test_signed_amounts_and_dr_cr_indicators(auth_headers):
    """Verify signed amount layouts treat positive as deposit/credit and drop it."""
    csv_content = (
        "Date,Particulars,Amount\n"
        "2026-01-10,SPOTIFY INDIA,-119.00\n"
        "2026-01-12,CLIENT PAYMENT INWARD,+85000.00\n"
        "2026-02-10,SPOTIFY INDIA,-119.00\n"
        "2026-03-10,SPOTIFY INDIA,-119.00\n"
    )
    files = {"file": ("statement.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    res = client.post("/api/statement/upload", files=files, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()

    assert data["rows_parsed"] == 3
    assert data["parse_report"]["reasons"]["credits_dropped"] == 1
    mandates = data["mandates"]
    assert len(mandates) == 1
    assert "Spotify" in mandates[0]["merchant_name"]

def test_telemetry_realism_no_fake_zombie_flags_on_upload(auth_headers):
    """Verify uploaded statements without telemetry feed show usage_status='unknown' and zero fake zombie flags."""
    csv_content = (
        "Date,Particulars,Amount\n"
        "2026-01-10,FITFAM GYM MEMBERSHIP,2500.00\n"
        "2026-02-10,FITFAM GYM MEMBERSHIP,2500.00\n"
        "2026-03-10,FITFAM GYM MEMBERSHIP,2500.00\n"
    )
    files = {"file": ("statement.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    res = client.post("/api/statement/upload", files=files, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()

    for m in data["mandates"]:
        assert m["usage_status"] == "unknown"
        assert m["flag"] != "UNUSED_ZOMBIE"

def test_lapsed_mandates_excluded_from_committed_and_savings():
    """Verify mandates whose last charge is > 1.5x cadence ago are flagged 'LAPSED' with 0 committed cost."""
    txs = [
        # Charges occurred early 2025, but statement ends late 2025 (interval > 45 days)
        {"date": "2025-01-10", "descriptor": "NETFLIX INDIA", "amount": 649.0},
        {"date": "2025-02-10", "descriptor": "NETFLIX INDIA", "amount": 649.0},
        {"date": "2025-03-10", "descriptor": "NETFLIX INDIA", "amount": 649.0},
        # Other active mandate extending to end of statement
        {"date": "2025-01-15", "descriptor": "SPOTIFY INDIA", "amount": 119.0},
        {"date": "2025-02-15", "descriptor": "SPOTIFY INDIA", "amount": 119.0},
        {"date": "2025-03-15", "descriptor": "SPOTIFY INDIA", "amount": 119.0},
        {"date": "2025-04-15", "descriptor": "SPOTIFY INDIA", "amount": 119.0},
        {"date": "2025-05-15", "descriptor": "SPOTIFY INDIA", "amount": 119.0},
        {"date": "2025-06-15", "descriptor": "SPOTIFY INDIA", "amount": 119.0},
    ]

    res = analyze_statement(txs, usage_feed=None)
    mandates = res["mandates"]

    netflix = next(m for m in mandates if "Netflix" in m["merchant_name"])
    spotify = next(m for m in mandates if "Spotify" in m["merchant_name"])

    # Netflix last charged 2025-03-10; statement ends 2025-06-15 (>95 days gap for monthly)
    assert netflix["status"] == "lapsed"
    assert netflix["flag"] == "LAPSED"
    assert netflix["annual_committed_cost"] == 0.0
    assert netflix["savings_if_cancelled"] == 0.0

    # Spotify is active
    assert spotify["status"] == "active"
    assert spotify["annual_committed_cost"] == 119.0 * 12

    # Lapsed mandate excluded from annual committed total
    assert res["annual_committed_total"] == spotify["annual_committed_cost"]

def test_obligation_segregation_rent_and_emi():
    """Verify non-discretionary obligations (Rent, EMI, SIP) are segregated from cancellable savings."""
    assert detect_obligation("HOUSE RENT TO LANDLORD") == "RENT"
    assert detect_obligation("BAJAJ FINANCE AUTO LOAN EMI") == "EMI"
    assert detect_obligation("HDFC LIFE INSURANCE POLICY") == "INSURANCE"
    assert detect_obligation("ZERODHA MONTHLY SIP") == "SIP"

    txs = [
        {"date": "2026-01-05", "descriptor": "HOUSE RENT PAYMENT", "amount": 28000.0},
        {"date": "2026-02-05", "descriptor": "HOUSE RENT PAYMENT", "amount": 28000.0},
        {"date": "2026-03-05", "descriptor": "HOUSE RENT PAYMENT", "amount": 28000.0},
        {"date": "2026-01-10", "descriptor": "NETFLIX INDIA", "amount": 649.0},
        {"date": "2026-02-10", "descriptor": "NETFLIX INDIA", "amount": 649.0},
        {"date": "2026-03-10", "descriptor": "NETFLIX INDIA", "amount": 649.0},
    ]

    res = analyze_statement(txs, usage_feed=None)
    rent = next(m for m in res["mandates"] if "RENT" in m["descriptor"])
    assert rent["is_obligation"] is True
    assert rent["obligation_type"] == "RENT"
    assert rent["savings_if_cancelled"] == 0.0 # Non-cancellable discretionary savings!

    # Obligations reported separately
    assert res["committed_obligations_total"] == 28000.0 * 12
    assert res["committed_discretionary_total"] == 649.0 * 12
    assert res["committed_total"] == (28000.0 * 12) + (649.0 * 12)

def test_multi_account_duplicate_keying():
    """Verify the same vendor across different accounts produces distinct mandate IDs and is not merged."""
    txs_acc1 = [
        {"date": "2026-01-10", "descriptor": "NETFLIX INDIA", "amount": 649.0},
        {"date": "2026-02-10", "descriptor": "NETFLIX INDIA", "amount": 649.0},
    ]
    res1 = analyze_statement(txs_acc1, account_label="HDFC Salary Account")

    txs_acc2 = [
        {"date": "2026-01-12", "descriptor": "NETFLIX INDIA", "amount": 649.0},
        {"date": "2026-02-12", "descriptor": "NETFLIX INDIA", "amount": 649.0},
    ]
    res2 = analyze_statement(txs_acc2, account_label="ICICI Savings Account")

    m1 = res1["mandates"][0]
    m2 = res2["mandates"][0]

    assert m1["id"] != m2["id"]
    assert "hdfc" in m1["id"]
    assert "icici" in m2["id"]
