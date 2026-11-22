"""
Bank Statement PDF Extractor
Handles password decryption (DOB / PAN), multi-line transaction continuation stitching,
and mathematical balance verification.
"""
import io
import re
from typing import Optional, List, Dict, Any, Tuple
try:
    import pypdf
except ImportError:
    pypdf = None
from app.services.normalizer import parse_date, parse_amount, clean_descriptor, detect_rail

class PDFExtractionError(Exception):
    pass

def decrypt_pdf(reader: Any, password: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """Attempts to decrypt an encrypted PDF using provided password or standard empty/fallback."""
    if not reader.is_encrypted:
        return True, None

    passwords_to_try = []
    if password:
        passwords_to_try.extend([
            password.strip(),
            password.strip().upper(),
            password.strip().lower()
        ])
    passwords_to_try.append("") # Some statements have empty owner passwords

    for pw in passwords_to_try:
        try:
            status = reader.decrypt(pw)
            if status != 0: # 0 indicates failure in pypdf
                return True, None
        except Exception:
            continue

    return False, "PDF is password protected. Please provide your password (DOB DDMMYYYY or PAN)."

def extract_transactions_from_pdf(
    pdf_bytes: bytes,
    password: Optional[str] = None
) -> Dict[str, Any]:
    """
    Parses bank statement PDF bytes into normalized transaction records.
    Stitches multi-line transaction narrations and verifies ledger balances.
    """
    if pypdf is None:
        raise PDFExtractionError("pypdf package is not installed on this server.")
    try:
        pdf_io = io.BytesIO(pdf_bytes)
        reader = pypdf.PdfReader(pdf_io)
    except Exception as e:
        raise PDFExtractionError(f"Malformed or corrupt PDF file: {str(e)}")

    is_decrypted, err = decrypt_pdf(reader, password)
    if not is_decrypted:
        raise PDFExtractionError(err)

    pages_count = len(reader.pages)
    if pages_count == 0:
        raise PDFExtractionError("PDF contains zero pages.")

    all_lines: List[str] = []
    for idx, page in enumerate(reader.pages):
        try:
            text = page.extract_text()
            if text:
                all_lines.extend(text.splitlines())
        except Exception:
            continue

    if not all_lines:
        raise PDFExtractionError("No readable text could be extracted from PDF (document may be a scanned image).")

    # Regular expressions for transaction row detection
    # Common date prefixes: DD/MM/YYYY, DD-MM-YYYY, DD Mon YYYY
    date_regex = re.compile(
        r"^(?:\d{1,4}[-/\.]\d{1,2}[-/\.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}|\d{1,2}-[A-Za-z]{3}-\d{2,4})"
    )
    
    # Amount tokens (e.g., 1,499.00 or 120.00 Cr)
    amount_token_regex = re.compile(r"[-+]?(?:INR|RS\.?|₹)?\s*[\d,]+\.\d{2}(?:\s*(?:DR|CR))?", re.IGNORECASE)

    raw_rows: List[Dict[str, Any]] = []
    current_tx: Optional[Dict[str, Any]] = None

    opening_balance: Optional[float] = None
    closing_balance: Optional[float] = None

    for line in all_lines:
        cleaned_line = line.strip()
        if not cleaned_line:
            continue

        # Check for opening/closing balance indicators in header/footer
        if "OPENING BALANCE" in cleaned_line.upper():
            amts = amount_token_regex.findall(cleaned_line)
            if amts:
                val, _ = parse_amount(amts[-1])
                opening_balance = val

        if "CLOSING BALANCE" in cleaned_line.upper():
            amts = amount_token_regex.findall(cleaned_line)
            if amts:
                val, _ = parse_amount(amts[-1])
                closing_balance = val

        # Check if line begins with a transaction date
        date_match = date_regex.match(cleaned_line)
        if date_match:
            raw_date_str = date_match.group(0)
            iso_date = parse_date(raw_date_str)

            if iso_date:
                # Flush previous transaction if complete
                if current_tx and current_tx.get("amount") is not None and current_tx.get("amount") > 0:
                    raw_rows.append(current_tx)

                # Find amounts in line
                amounts = amount_token_regex.findall(cleaned_line)
                remainder_text = cleaned_line[len(raw_date_str):].strip()

                tx_amt = None
                tx_type = "DEBIT"
                if amounts:
                    # Usually: [Debit, Credit, Balance] or [Amount, Balance]
                    amt_val, dir_val = parse_amount(amounts[0])
                    tx_amt = amt_val
                    tx_type = dir_val

                # Remove parsed amounts from narration
                for a in amounts:
                    remainder_text = remainder_text.replace(a, " ")

                current_tx = {
                    "date": iso_date,
                    "descriptor": re.sub(r"\s+", " ", remainder_text).strip(),
                    "amount": tx_amt,
                    "type": tx_type,
                    "ref": ""
                }
                continue

        # Line does not start with date: Multi-line narration continuation
        if current_tx is not None:
            # Check if this continuation line has the amount if not found on date line
            if current_tx.get("amount") is None:
                amounts = amount_token_regex.findall(cleaned_line)
                if amounts:
                    amt_val, dir_val = parse_amount(amounts[0])
                    current_tx["amount"] = amt_val
                    current_tx["type"] = dir_val
                    for a in amounts:
                        cleaned_line = cleaned_line.replace(a, " ")

            # Append text to existing transaction descriptor
            current_tx["descriptor"] += " " + cleaned_line

    # Flush final transaction
    if current_tx and current_tx.get("amount") is not None and current_tx.get("amount") > 0:
        raw_rows.append(current_tx)

    # Format into normalized transactions
    transactions = []
    total_debits = 0.0
    total_credits = 0.0

    for idx, r in enumerate(raw_rows):
        desc = re.sub(r"\s+", " ", r["descriptor"]).strip()
        amt = float(r["amount"]) if r.get("amount") else 0.0
        if amt <= 0 or not desc:
            continue

        tx_type = r.get("type", "DEBIT")
        if tx_type == "DEBIT":
            total_debits += amt
        else:
            total_credits += amt

        transactions.append({
            "id": f"PDF_TX_{idx+1}",
            "date": r["date"],
            "descriptor": desc,
            "cleaned_descriptor": clean_descriptor(desc),
            "amount": amt,
            "type": tx_type,
            "ref": r.get("ref", ""),
            "payment_rail": detect_rail(desc)
        })

    # Balance Verification
    balance_check = {
        "opening_balance": opening_balance,
        "closing_balance": closing_balance,
        "total_debits": round(total_debits, 2),
        "total_credits": round(total_credits, 2),
        "is_balanced": True
    }

    if opening_balance is not None and closing_balance is not None:
        expected_closing = round(opening_balance - total_debits + total_credits, 2)
        diff = abs(expected_closing - closing_balance)
        balance_check["expected_closing"] = expected_closing
        balance_check["discrepancy"] = round(diff, 2)
        balance_check["is_balanced"] = diff < 2.0 # tolerance for fractional charges/interest

    return {
        "success": True,
        "transactions": transactions,
        "pages_parsed": pages_count,
        "total_extracted": len(transactions),
        "balance_verification": balance_check
    }

