"""
Stage 2 Automated Integration Test Suite
Validates Normalizer, CSV Extractor, Password-Protected PDF Extractor,
Multi-line Narration Stitching, Balance Verification, and Ingestion APIs.
"""
import io
import pytest
import pypdf
from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject
from fastapi.testclient import TestClient

from app.services.normalizer import parse_date, parse_amount, clean_descriptor, detect_rail
from app.services.extractors.csv_extractor import extract_transactions_from_csv
from app.services.extractors.pdf_extractor import extract_transactions_from_pdf
from main import app

def generate_mock_pdf_statement(password: str = None) -> bytes:
    """Generates an encrypted or unencrypted mock bank statement PDF with multi-line rows."""
    writer = pypdf.PdfWriter()
    page = writer.add_blank_page(width=612, height=792)

    font_dict = DictionaryObject({
        NameObject('/Type'): NameObject('/Font'),
        NameObject('/Subtype'): NameObject('/Type1'),
        NameObject('/BaseFont'): NameObject('/Helvetica')
    })
    res_dict = DictionaryObject({
        NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font_dict)})
    })
    page[NameObject('/Resources')] = writer._add_object(res_dict)

    # Content includes Opening Balance, 3 transactions (one with multi-line text), and Closing Balance
    content_text = """BT
/F1 11 Tf
50 720 Td (HDFC BANK STATEMENT FOR ACCOUNT NO: *******4821) Tj
0 -20 Td (OPENING BALANCE: 25000.00) Tj
0 -25 Td (15/01/2026 GOOGLE*YOUTUBE G.CO/HELPPAY 129.00 Dr) Tj
0 -25 Td (15/01/2026 NETFLIX.COM DIGITAL SUBSCRIPTION) Tj
0 -12 Td (MONTHLY PLAN MUMBAI IN REF#482910 499.00 Dr) Tj
0 -25 Td (15/02/2026 GOOGLE*YOUTUBE G.CO/HELPPAY 129.00 Dr) Tj
0 -25 Td (CLOSING BALANCE: 24243.00) Tj
ET"""
    stream = DecodedStreamObject()
    stream.set_data(content_text.encode('latin1'))
    page[NameObject('/Contents')] = writer._add_object(stream)

    if password:
        writer.encrypt(password)

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()

def test_normalizer():
    assert parse_date("15/01/2026") == "2026-01-15"
    assert parse_date("15-Jan-2026") == "2026-01-15"
    assert parse_date("2026-01-15") == "2026-01-15"
    
    amt, dir_val = parse_amount("1,499.00 Dr")
    assert amt == 1499.0 and dir_val == "DEBIT"
    
    rail = detect_rail("UPI/CR/49210/SWIGGY/PAYTM")
    assert rail == "UPI_AUTOPAY"

def test_csv_extractor():
    sample_csv = b"""Transaction Date,Narration,Withdrawal,Ref No\n15/01/2026,AMZN PRIME IN*849204,1499.00,REF49201\n15/01/2026,SPOTIFY INDIA,119.00,REF49202"""
    txs = extract_transactions_from_csv(sample_csv)
    assert len(txs) == 2
    assert txs[0]["amount"] == 1499.0
    assert txs[0]["payment_rail"] == "DIRECT_MERCHANT" or txs[0]["payment_rail"] == "CARD_SI"

def test_pdf_extractor_with_password_and_multiline():
    password = "HDFC_DOB_1990"
    pdf_bytes = generate_mock_pdf_statement(password=password)
    
    res = extract_transactions_from_pdf(pdf_bytes, password=password)
    assert res["success"] is True
    assert res["total_extracted"] == 3
    
    txs = res["transactions"]
    # Check multi-line stitching on Netflix
    netflix_tx = next((t for t in txs if "NETFLIX" in t["descriptor"].upper()), None)
    assert netflix_tx is not None
    assert "MONTHLY PLAN MUMBAI" in netflix_tx["descriptor"].upper()
    assert netflix_tx["amount"] == 499.0
    
    # Check balance verification (25000 - 129 - 499 - 129 = 24243)
    b = res["balance_verification"]
    assert b["opening_balance"] == 25000.0
    assert b["closing_balance"] == 24243.0
    assert b["is_balanced"] is True

def test_ingest_api():
    client = TestClient(app)
    
    # Test PDF Upload
    pdf_bytes = generate_mock_pdf_statement(password="HDFC_DOB_1990")
    files = {"file": ("statement.pdf", pdf_bytes, "application/pdf")}
    data = {"password": "HDFC_DOB_1990"}
    
    from app.services.auth_service import create_access_token
    from app.core.db import init_db, get_db
    from app.models.user import User
    init_db()
    session = next(get_db())
    u = session.query(User).filter(User.id == "test_user_stage2").first()
    if not u:
        u = User(id="test_user_stage2", email="test_stage2@example.com", password_hash="hash", full_name="Stage2 User", is_active=True)
        session.add(u)
        session.commit()
    token = create_access_token({"sub": "test_user_stage2", "email": "test_stage2@example.com"})
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/api/v1/ingest/upload-pdf", files=files, data=data, headers=headers)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["rows_parsed"] == 3
    assert res_data["balance_verification"]["is_balanced"] is True
    assert "hero_metrics" in res_data
    
    # Test Ingest Logs API
    logs_res = client.get("/api/v1/ingest/logs", headers=headers)
    assert logs_res.status_code == 200
    logs = logs_res.json()
    assert len(logs) > 0
    assert logs[0]["source_type"] == "STATEMENT_PDF"

if __name__ == "__main__":
    test_normalizer()
    print("Normalizer: OK")
    test_csv_extractor()
    print("CSV Extractor: OK")
    test_pdf_extractor_with_password_and_multiline()
    print("PDF Extractor (Decryption, Multi-line Stitching, Balance Verification): OK")
    test_ingest_api()
    print("Ingestion API Endpoints: OK")
    print("STAGE 2 VERIFICATION COMPLETE: ALL TESTS PASSED!")

