"""
Mandate Radar Deterministic Detection Engine
============================================
Strictly rules-based, non-probabilistic Pandas/Python engine.
Detects recurring cadence, price hikes, trial traps, zombie/unused charges,
tags billing types ('fixed' vs 'usage_based'), calculates expected next charge dates,
and computes idempotent cryptographic charge hashes.
"""

from datetime import datetime
import hashlib
import re
from typing import Optional, List, Dict, Any
import numpy as np
import pandas as pd
from reference_data import REFERENCE_MERCHANTS, PAYMENT_MECHANISMS, HARD_NEGATIVE_PATTERNS

class DateParseError(Exception):
    def __init__(self, row_idx: int, raw_value: str):
        self.row_idx = row_idx
        self.raw_value = raw_value
        super().__init__(f"Invalid date format at row {row_idx}: '{raw_value}'")

def parse_date_series(series: pd.Series) -> pd.Series:
    """
    Parses dates across Indian and international statement formats:
    Tries uniform column formats first (DD/MM/YYYY, DD-MM-YYYY, DD-Mon-YYYY, YYYY-MM-DD, etc.),
    defaulting to day-first for India.
    Converts all valid dates to ISO string 'YYYY-MM-DD'.
    If any non-empty cell fails to parse, raises DateParseError naming the 1-based row number.
    """
    if series.empty:
        return series

    candidate_formats = [
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%d-%b-%Y",
        "%d %b %Y",
        "%d-%B-%Y",
        "%d %B %Y",
        "%d/%m/%y",
        "%d-%m-%y",
        "%d-%b-%y",
        "%d %b %y",
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
        "%d-%m-%Y %H:%M:%S"
    ]

    cleaned_strs = series.fillna("").astype(str).str.strip()
    non_empty = cleaned_strs[cleaned_strs != ""]

    if non_empty.empty:
        return series

    # 1. Try single uniform format across entire non-empty series
    for fmt in candidate_formats:
        try:
            parsed = pd.to_datetime(non_empty, format=fmt, errors="raise")
            result = series.copy()
            result.loc[non_empty.index] = parsed.dt.strftime("%Y-%m-%d")
            return result
        except (ValueError, TypeError):
            continue

    # 2. Row by row fallback with strict exception on parse failure
    result = series.copy()
    for idx, val in series.items():
        val_str = str(val).strip()
        if not val_str or val_str.lower() in ("nan", "nat", "none"):
            continue

        parsed_dt = None
        for fmt in candidate_formats:
            try:
                parsed_dt = datetime.strptime(val_str, fmt)
                break
            except (ValueError, TypeError):
                continue

        if parsed_dt is None:
            try:
                parsed_dt = pd.to_datetime(val_str, dayfirst=True, errors="raise")
            except Exception:
                row_number = idx + 2 if isinstance(idx, int) else 2
                raise DateParseError(row_idx=row_number, raw_value=val_str)

        result.at[idx] = parsed_dt.strftime("%Y-%m-%d")

    return result

OBLIGATION_PATTERNS = {
    "RENT": re.compile(r"\b(rent|brokerage|housing|landlord|nobroker|nestaway|tolet)\b", re.IGNORECASE),
    "EMI": re.compile(r"\b(emi|loan|bajaj\s*fin|hdb\s*fs|home\s*credit|idfc.*loan|tvs\s*credit|cholamandalam|muthoot|cred\s*cash|flexiloan)\b", re.IGNORECASE),
    "INSURANCE": re.compile(r"\b(insurance|lic|hdfc\s*life|icici\s*pru|max\s*life|star\s*health|care\s*health|tata\s*aig|bajaj\s*allianz|sbi\s*life)\b", re.IGNORECASE),
    "SIP": re.compile(r"\b(sip|mutual\s*fund|zerodha|groww|kuvera|camsonline|kfintech|uti\s*mf|sbi\s*mf|nippon)\b", re.IGNORECASE),
    "TAX": re.compile(r"\b(income\s*tax|advance\s*tax|gst|property\s*tax|challan|tds)\b", re.IGNORECASE)
}

def detect_obligation(descriptor: str, merchant_id: Optional[str] = None) -> Optional[str]:
    """Detects whether recurring mandate is an obligation (rent, EMI, insurance, SIP, tax)."""
    text = f"{descriptor} {merchant_id or ''}"
    for ob_type, pat in OBLIGATION_PATTERNS.items():
        if pat.search(text):
            return ob_type
    return None

def clean_descriptor(descriptor: str) -> str:
    """Cleans punctuation, ref IDs, rail prefixes, and corporate suffixes for clean grouping."""
    text = str(descriptor).upper()
    text = re.sub(r"[#*\/\\\-_:]", " ", text)
    text = re.sub(r"\b\d{4,}\b", "", text) # Remove long transaction or reference numbers
    # Strip common payment prefixes
    text = re.sub(r"^(UPI\s+AUTOPAY|UPI|AUTOPAY|NACH|ACH|ECS|EMANDATE|CARD\s+SI|CARD|POS)\s+", "", text)
    # Strip common corporate legal entity and descriptor suffixes
    text = re.sub(r"\s+(PVT\s+LTD|PRIVATE\s+LIMITED|LTD|LIMITED|INC|CORP|CORPORATION|LLC|LLP|ANNUAL|MONTHLY|WEEKLY|SUBSCRIPTION|PLAN|PREMIUM|BILL|AUTOPAY|NACH)$", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def normalize_narration(narration: str) -> str:
    """
    Normalizes bank narration strings for canonical merchant and alias resolution:
    Strips transaction IDs, reference numbers, and rail prefixes (e.g. UPI/P2M/491823/SPOTIFY -> spotify).
    """
    text = str(narration).strip().lower()
    text = re.sub(r"^(upi\s*/\s*p2m\s*/|upi\s*/|nach\s*/|ach\s*/|pos\s*/|inb\s*/|card\s*-?\s*si\s*/)", "", text)
    text = re.sub(r"\b\d{4,}\b", "", text)
    text = re.sub(r"[#*\/\\\-_:]", " ", text)
    return re.sub(r"\s+", " ", text).strip()

def generate_charge_hash(user_id: str, account_label: str, date: str, amount: float, descriptor: str, ref_or_row_idx: str = "") -> str:
    """
    Computes an idempotent cryptographic hash for a transaction line:
    SHA256(user_id + account_label + date + amount + clean_descriptor + ref_or_row_idx)
    Guarantees that re-uploading the same statement creates zero duplicates, while two
    legitimate identical charges on the same day remain distinct.
    """
    raw = f"{user_id}:{account_label}:{date}:{amount:.2f}:{clean_descriptor(descriptor)}:{ref_or_row_idx}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def compute_expected_next_charge_date(last_charged_dt: pd.Timestamp, cadence: str) -> str:
    """Calculates the expected next debit date based on detected interval."""
    if cadence == "WEEKLY":
        next_dt = last_charged_dt + pd.Timedelta(days=7)
    elif cadence == "MONTHLY":
        next_dt = last_charged_dt + pd.Timedelta(days=30)
    elif cadence == "QUARTERLY":
        next_dt = last_charged_dt + pd.Timedelta(days=91)
    elif cadence == "ANNUAL":
        next_dt = last_charged_dt + pd.Timedelta(days=365)
    else:
        next_dt = last_charged_dt + pd.Timedelta(days=30)
    return next_dt.strftime("%Y-%m-%d")

def resolve_merchant_from_descriptor(descriptor: str):
    """
    Deterministically matches raw descriptor against verified reference graph regexes.
    NEVER guesses or hallucinates. Returns None if unrecognised.
    """
    desc_str = str(descriptor).strip()
    for m in REFERENCE_MERCHANTS:
        for pattern in m.get("descriptors", []):
            if re.search(pattern, desc_str, re.IGNORECASE):
                return m
    return None

def detect_payment_mechanism(descriptor: str, ref_str: str = "", channel: str = ""):
    """
    Detects the rail (UPI AutoPay, Card SI, Bank NACH, Play Store, App Store, Direct)
    from explicit channel column or transaction narration.
    """
    ch = str(channel).upper() if channel else ""
    if "NACH" in ch or "ECS" in ch or "ACH" in ch or "EMANDATE" in ch:
        return "BANK_NACH"
    if "UPI" in ch:
        return "UPI_AUTOPAY"
    if "CARD" in ch:
        return "CARD_SI"

    combined = f"{descriptor} {ref_str}".upper()
    if "UPI" in combined or "AUTOPAY" in combined or "VPA" in combined:
        return "UPI_AUTOPAY"
    if "NACH" in combined or "ACH D" in combined or "ECS" in combined or "EMANDATE" in combined:
        return "BANK_NACH"
    if "G.CO/HELPPAY" in combined or "PLAY PASS" in combined or "GOOGLE*PLAY" in combined:
        return "PLAY_STORE"
    if "APPLE.COM/BILL" in combined or "ITUNES" in combined:
        return "APP_STORE"
    if "CARD" in combined or "CARD-SI" in combined or "POS DEBIT" in combined or "MSBILL.INFO" in combined or "STRIPE" in combined:
        return "CARD_SI"
    return "DIRECT_MERCHANT"

def analyze_statement(
    transactions_data: list,
    usage_feed: dict = None,
    user_id: str = "user_primary",
    account_label: str = "Primary Account"
):
    """
    Main detection pipeline running on statement transactions.
    Supports variable-amount recurring charges (usage_based vs fixed contracts),
    multi-statement idempotent hashing, and post-cancellation charge projections.
    """
    if usage_feed is None:
        usage_feed = {}

    df = pd.DataFrame(transactions_data)
    if df.empty or "date" not in df.columns or "amount" not in df.columns:
        return {
            "mandates": [],
            "rejected_transactions": [],
            "annual_committed_total": 0.0,
            "annual_potential_savings": 0.0,
            "fixed_committed_total": 0.0,
            "usage_based_run_rate_total": 0.0,
            "metrics": {
                "total_transactions": 0,
                "mandates_found": 0,
                "price_hikes": 0,
                "trial_conversions": 0,
                "zombie_subscriptions": 0,
                "usage_based_mandates": 0,
                "hard_negatives_filtered": 0
            }
        }

    df["date_dt"] = pd.to_datetime(df["date"])
    df["amount_num"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0.0)
    df["raw_descriptor"] = df["descriptor"].fillna("").astype(str)
    df["ref_str"] = df.get("ref", pd.Series([""] * len(df))).fillna("").astype(str)
    df["row_idx"] = df.index.astype(str)

    # Attach idempotent charge hash to each raw transaction
    df["charge_hash"] = df.apply(
        lambda r: generate_charge_hash(
            user_id=user_id,
            account_label=account_label,
            date=str(r["date"]),
            amount=float(r["amount_num"]),
            descriptor=r["raw_descriptor"],
            ref_or_row_idx=str(r["ref_str"]) or str(r["row_idx"])
        ),
        axis=1
    )

    # 1. First Pass: Resolve against reference graph or fallback to cleaned key
    def get_group_key(row):
        m_col = str(row.get("merchant", "")).strip() if "merchant" in row else ""
        if m_col and m_col.lower() not in ("nan", "none", "null", "undefined", ""):
            resolved = resolve_merchant_from_descriptor(m_col)
            if resolved:
                return f"REF::{resolved['id']}"
            return f"MERCHANT::{clean_descriptor(m_col)}"

        resolved = resolve_merchant_from_descriptor(row["raw_descriptor"])
        if resolved:
            return f"REF::{resolved['id']}"
        return f"RAW::{clean_descriptor(row['raw_descriptor'])}"

    df["group_key"] = df.apply(get_group_key, axis=1)

    mandates = []
    rejected = []

    # Reference evaluation date (latest date in statement)
    statement_end_date = df["date_dt"].max()

    for group_key, group in df.groupby("group_key"):
        sorted_group = group.sort_values("date_dt").reset_index(drop=True)
        count = len(sorted_group)

        # Check for hard negative pattern matches first
        sample_desc = sorted_group["raw_descriptor"].iloc[0]
        cleaned_sample = clean_descriptor(sample_desc).strip()
        if not cleaned_sample or cleaned_sample.lower() in ("nan", "none", "null", "undefined"):
            continue
        hard_negative_match = None
        for hn in HARD_NEGATIVE_PATTERNS:
            for p in hn["descriptors"]:
                if re.search(p, sample_desc, re.IGNORECASE):
                    hard_negative_match = hn
                    break
            if hard_negative_match:
                break

        # A recurring mandate requires at least 1 annual/subscription occurrence or >= 2 occurrences
        if count == 1:
            # Check if this single charge matches a known subscription in reference
            resolved_ref = resolve_merchant_from_descriptor(sample_desc)
            if resolved_ref and any(c in resolved_ref.get("supported_cadences", []) for c in ["ANNUAL", "MONTHLY"]):
                amount = float(sorted_group["amount_num"].iloc[0])
                if "MONTHLY" in resolved_ref.get("supported_cadences", []) and (amount <= 500 or resolved_ref.get("default_amount") == amount):
                    eff_cadence = "MONTHLY"
                    annual_committed = round(amount * 12.0, 2)
                elif "ANNUAL" in resolved_ref.get("supported_cadences", []):
                    eff_cadence = "ANNUAL"
                    annual_committed = amount
                else:
                    eff_cadence = "MONTHLY"
                    annual_committed = round(amount * 12.0, 2)

                channel_val = sorted_group["channel"].iloc[0] if "channel" in sorted_group.columns else ""
                mechanism = detect_payment_mechanism(sample_desc, sorted_group["ref_str"].iloc[0], channel_val)
                mech_details = PAYMENT_MECHANISMS.get(mechanism, PAYMENT_MECHANISMS["DIRECT_MERCHANT"])
                first_date_dt = sorted_group["date_dt"].iloc[0]
                expected_next = compute_expected_next_charge_date(first_date_dt, eff_cadence)

                days_since_last = (statement_end_date - first_date_dt).days
                cycle_days = 365 if eff_cadence == "ANNUAL" else 30
                is_lapsed = days_since_last > int(1.5 * cycle_days)

                obligation_type = detect_obligation(sample_desc, resolved_ref["id"])
                is_obligation = obligation_type is not None

                if is_lapsed:
                    status = "lapsed"
                    flag = "LAPSED"
                    flag_reason = f"Lapsed {eff_cadence.lower()} mandate: Last debit occurred {days_since_last} days ago (>1.5 cycles). Vendor appears inactive."
                    annual_committed = 0.0
                    savings_if_cancelled = 0.0
                elif is_obligation:
                    status = "active"
                    flag = "OBLIGATION"
                    flag_reason = f"Committed non-discretionary obligation ({obligation_type.capitalize()})."
                    savings_if_cancelled = 0.0
                else:
                    status = "active"
                    flag = "HEALTHY"
                    flag_reason = f"Verified active {eff_cadence.lower()} contract."
                    savings_if_cancelled = annual_committed

                acc_slug = re.sub(r'[^a-zA-Z0-9]', '_', str(account_label).lower()).strip('_')[:12] or "acc"
                merch_slug = resolved_ref['id'].strip('_')
                mandate_id = f"mandate_{acc_slug}_{merch_slug}"

                # Prepare charge history with idempotent hashes
                history = []
                for _, row in sorted_group.iterrows():
                    history.append({
                        "id": row["charge_hash"],
                        "date": str(row["date"]),
                        "amount": float(row["amount_num"]),
                        "descriptor": row["raw_descriptor"],
                        "account_label": account_label
                    })

                mandates.append({
                    "id": mandate_id,
                    "merchant_id": resolved_ref["id"],
                    "merchant_name": resolved_ref["name"],
                    "category": f"Obligation: {obligation_type.capitalize()}" if is_obligation else resolved_ref["category"],
                    "parent_id": resolved_ref.get("parent_id"),
                    "parent_name": resolved_ref.get("parent"),
                    "descriptor": sample_desc,
                    "is_recognized": True,
                    "is_obligation": is_obligation,
                    "obligation_type": obligation_type,
                    "status": status,
                    "usage_status": "unknown",
                    "cadence": eff_cadence,
                    "billing_type": "fixed",
                    "latest_amount": amount,
                    "initial_amount": amount,
                    "annual_committed_cost": annual_committed,
                    "charge_count": 1,
                    "first_seen": sorted_group["date"].iloc[0],
                    "last_charged": sorted_group["date"].iloc[0],
                    "expected_next_charge_date": expected_next,
                    "account_label": account_label,
                    "mechanism": mechanism,
                    "mechanism_name": mech_details["name"],
                    "flag": flag,
                    "flag_reason": flag_reason,
                    "confidence_score": 0.94,
                    "savings_if_cancelled": savings_if_cancelled,
                    "pitfall": resolved_ref.get("cancellation_pitfall", ""),
                    "cancellation_steps": mech_details["cancellation_steps"],
                    "history": history
                })
                continue
            else:
                rejected.append({
                    "descriptor": sample_desc,
                    "reason": "Single isolated charge with no recurring schedule detected.",
                    "count": 1,
                    "amounts": [float(sorted_group["amount_num"].iloc[0])]
                })
                continue

        # Multiple transactions: Analyze time gaps across distinct cycle dates
        date_series = sorted_group["date_dt"]
        amounts = sorted_group["amount_num"].tolist()

        # Check monthly span across calendar periods
        calendar_months = sorted(date_series.dt.to_period("M").unique())
        month_span = len(calendar_months)

        unique_dates = sorted(date_series.drop_duplicates().tolist())
        if len(unique_dates) >= 2:
            date_diffs = pd.Series(unique_dates).diff().dt.days.dropna().tolist()
            median_gap = float(np.median(date_diffs)) if date_diffs else 0.0
        else:
            median_gap = 0.0

        # Infer cadence with tolerance bands (supports Weekly, Monthly, Quarterly, Annual)
        cadence = None
        if 5 <= median_gap <= 11: # Weekly ±3 days
            cadence = "WEEKLY"
            annual_multiplier = 52.0
        elif 20 <= median_gap <= 40: # Monthly ±10 days
            cadence = "MONTHLY"
            annual_multiplier = 12.0
        elif 75 <= median_gap <= 115: # Quarterly ±20 days
            cadence = "QUARTERLY"
            annual_multiplier = 4.0
        elif 335 <= median_gap <= 395: # Annual ±30 days
            cadence = "ANNUAL"
            annual_multiplier = 1.0
        elif month_span >= 2: # Charges recur across multiple calendar months (e.g. multi-channel duplicates)
            month_diffs = pd.Series([m.to_timestamp() for m in calendar_months]).diff().dt.days.dropna().tolist()
            month_median_gap = float(np.median(month_diffs)) if month_diffs else 30.0
            if 25 <= month_median_gap <= 35:
                cadence = "MONTHLY"
                annual_multiplier = 12.0

        if not cadence:
            rejected.append({
                "descriptor": sample_desc,
                "reason": f"Irregular interval (median gap: {median_gap:.1f} days, month span: {month_span}) does not align with weekly, monthly, quarterly or annual cadence.",
                "count": count,
                "median_gap_days": median_gap,
                "amounts": amounts[:5]
            })
            continue

        # If multiple duplicate debits occur per cycle (e.g. multi-channel CloudStore)
        charges_per_cycle = round(count / max(month_span, 1))
        if charges_per_cycle > 1 and cadence == "MONTHLY":
            latest_amount = float(sorted_group.groupby(sorted_group["date_dt"].dt.to_period("M"))["amount_num"].sum().iloc[-1])
            initial_amount = float(sorted_group.groupby(sorted_group["date_dt"].dt.to_period("M"))["amount_num"].sum().iloc[0])
        else:
            latest_amount = float(amounts[-1])
            initial_amount = float(amounts[0])
        last_charged_dt = sorted_group["date_dt"].iloc[-1]
        expected_next = compute_expected_next_charge_date(last_charged_dt, cadence)

        # Analyze amount stability & step changes > 3%
        diffs = []
        for i in range(1, len(amounts)):
            prev = amounts[i-1]
            curr = amounts[i]
            if prev > 0:
                pct = ((curr - prev) / prev) * 100.0
                if abs(pct) > 3.0:
                    diffs.append((i, prev, curr, pct))

        # Check for fluctuating variable bill (hard negative: electricity bill)
        if len(diffs) > 2 and hard_negative_match:
            rejected.append({
                "descriptor": sample_desc,
                "reason": f"Fluctuating utility consumption ({len(diffs)} price swings >3%). Billed for metered consumption, not recurring mandate.",
                "count": count,
                "amounts": amounts[:6]
            })
            continue

        # Billing Type Classification: 'usage_based' vs 'fixed'
        # Compute coefficient of variation across historical amounts
        mean_amt = float(np.mean(amounts))
        std_amt = float(np.std(amounts)) if len(amounts) > 1 else 0.0
        cv = (std_amt / mean_amt) if mean_amt > 0 else 0.0

        # If variance > 10% across cycles (e.g. AWS, Twilio, OpenAI API), tag as usage_based
        is_usage_based = cv > 0.10 and len(diffs) >= 2

        billing_type = "usage_based" if is_usage_based else "fixed"

        # Flag Determination
        flag = "HEALTHY"
        flag_reason = f"Verified stable recurring {cadence.lower()} commitment."
        confidence = 0.98

        # 1. Trial Conversion Check: First charge <= 5 and jump >= 10x
        if initial_amount <= 5.0 and len(amounts) >= 2 and latest_amount >= (initial_amount * 10.0):
            flag = "TRIAL_CONVERTED"
            ratio = latest_amount / max(initial_amount, 1.0)
            flag_reason = f"Trial conversion trap: Nominal initiation charge of ₹{initial_amount:.0f} auto-escalated to recurring ₹{latest_amount:.0f}/cycle ({ratio:.1f}x jump)."
            confidence = 0.99

        # 2. Silent Price Hike Check: Exactly 1 step up > 3% in an otherwise stable fixed series
        elif not is_usage_based and len(diffs) == 1 and diffs[0][3] > 3.0:
            step_idx, old_amt, new_amt, pct_increase = diffs[0]
            annual_leakage = (new_amt - old_amt) * annual_multiplier
            flag = "PRICE_HIKE"
            flag_reason = f"Silent price increase of +{pct_increase:.1f}% (₹{old_amt:.0f} ➔ ₹{new_amt:.0f}). Stealth extra cost: ₹{annual_leakage:,.0f}/year."
            confidence = 0.97

        # 3. Usage-based description note
        elif is_usage_based:
            flag_reason = f"Usage-based {cadence.lower()} billing: Fluctuating metered consumption (trailing run-rate: ₹{latest_amount * annual_multiplier:,.0f}/yr)."
            confidence = 0.92

        merchant_info = resolve_merchant_from_descriptor(sample_desc)
        merchant_id = merchant_info["id"] if merchant_info else None
        obligation_type = detect_obligation(sample_desc, merchant_id)
        is_obligation = obligation_type is not None

        # Check if lapsed (> 1.5 cycles past last charge date)
        cadence_days = 30 if cadence == "MONTHLY" else 91 if cadence == "QUARTERLY" else 365
        days_since_last = (statement_end_date - last_charged_dt).days
        is_lapsed = days_since_last > (1.5 * cadence_days)

        usage_status = "unknown"
        if is_lapsed:
            status = "lapsed"
            flag = "LAPSED"
            flag_reason = f"Lapsed mandate: Last debit occurred {days_since_last} days ago (>1.5 cycles for {cadence.lower()}). Vendor appears inactive or already cancelled."
            confidence = 0.95
        elif is_obligation:
            status = "active"
            flag = "OBLIGATION"
            flag_reason = f"Committed non-discretionary obligation ({obligation_type.capitalize()}). Excluded from cancellable discretionary savings."
            confidence = 0.98
        else:
            status = "active"
            # Unused / Zombie Subscription Check only when real telemetry feed is provided
            if usage_feed and merchant_id and merchant_id in usage_feed:
                usage_status = "tracked"
                last_activity_date_str = usage_feed.get(merchant_id)
                if last_activity_date_str and flag not in ["PRICE_HIKE", "TRIAL_CONVERTED"]:
                    last_activity = pd.to_datetime(last_activity_date_str)
                    days_inactive = (statement_end_date - last_activity).days
                    charges_since = sum(1 for d in date_series if d > last_activity)

                    if days_inactive >= 75 and charges_since >= 2:
                        flag = "UNUSED_ZOMBIE"
                        wasted = sum(amounts[-charges_since:])
                        flag_reason = f"Zombie subscription: Zero account activity for {days_inactive} days. ₹{wasted:,.0f} debited across {charges_since} unutilized cycles."
                        confidence = 0.96

        # Annual Committed Exposure
        if is_lapsed:
            annual_committed = 0.0
            savings_if_cancelled = 0.0
        elif is_obligation:
            annual_committed = round(latest_amount * annual_multiplier, 2)
            savings_if_cancelled = 0.0
        elif is_usage_based:
            annual_committed = round(mean_amt * annual_multiplier, 2)
            # Usage-based mandates are excluded from guaranteed fixed cancellation savings
            savings_if_cancelled = 0.0
        else:
            annual_committed = round(latest_amount * annual_multiplier, 2)
            savings_if_cancelled = annual_committed

        channel_val = sorted_group["channel"].iloc[-1] if "channel" in sorted_group.columns else ""
        mechanism = detect_payment_mechanism(sample_desc, sorted_group["ref_str"].iloc[-1], channel_val)
        mech_details = PAYMENT_MECHANISMS.get(mechanism, PAYMENT_MECHANISMS["DIRECT_MERCHANT"])

        # Check cross-channel redundancy (e.g. multi-rail mandates for single service)
        channels_used = [str(c) for c in sorted_group["channel"].dropna().unique().tolist()] if "channel" in sorted_group.columns else []
        if len(channels_used) > 1 and flag == "HEALTHY":
            flag = "PRICE_HIKE"
            flag_reason = f"Redundant multi-rail mandates detected: Debited across {len(channels_used)} channels ({', '.join(channels_used)})."

        accs_used = [str(a) for a in sorted_group["account_id"].dropna().unique().tolist()] if "account_id" in sorted_group.columns else []
        eff_account_label = ", ".join(accs_used) if accs_used else account_label

        is_recognized = merchant_info is not None
        if is_recognized:
            merchant_name = merchant_info["name"]
        else:
            fallback_name = cleaned_sample.title() if cleaned_sample else clean_descriptor(sample_desc)
            merchant_name = f"Unrecognised: {fallback_name}"
        category = f"Obligation: {obligation_type.capitalize()}" if is_obligation else (merchant_info["category"] if is_recognized else "Uncategorized Subscription")
        parent_id = merchant_info.get("parent_id") if is_recognized else None
        parent_name = merchant_info.get("parent") if is_recognized else "Independent / Unmapped"
        pitfall = merchant_info.get("cancellation_pitfall", "") if is_recognized else "Verify merchant cancellation terms."

        acc_slug = re.sub(r'[^a-zA-Z0-9]', '_', str(account_label).lower()).strip('_')[:12] or "acc"
        merch_slug = (merchant_id or clean_descriptor(sample_desc)[:16].replace(' ', '_')).strip('_')
        mandate_id = f"mandate_{acc_slug}_{merch_slug}"

        # History with idempotent hashes
        history = []
        for _, row in sorted_group.iterrows():
            history.append({
                "id": row["charge_hash"],
                "date": str(row["date"]),
                "amount": float(row["amount_num"]),
                "descriptor": row["raw_descriptor"],
                "account_label": eff_account_label
            })

        mandates.append({
            "id": mandate_id,
            "merchant_id": merchant_id,
            "merchant_name": merchant_name,
            "category": category,
            "parent_id": parent_id,
            "parent_name": parent_name,
            "descriptor": sample_desc,
            "is_recognized": is_recognized,
            "is_obligation": is_obligation,
            "obligation_type": obligation_type,
            "status": status,
            "usage_status": usage_status,
            "cadence": cadence,
            "billing_type": billing_type,
            "latest_amount": latest_amount,
            "initial_amount": initial_amount,
            "annual_committed_cost": annual_committed,
            "charge_count": count,
            "first_seen": sorted_group["date"].iloc[0],
            "last_charged": sorted_group["date"].iloc[-1],
            "expected_next_charge_date": expected_next,
            "account_label": eff_account_label,
            "mechanism": mechanism,
            "mechanism_name": mech_details["name"],
            "flag": flag,
            "flag_reason": flag_reason,
            "confidence_score": confidence,
            "savings_if_cancelled": savings_if_cancelled,
            "pitfall": pitfall,
            "support_email": merchant_info.get("support_email", "support@merchant.com") if is_recognized else "",
            "grievance_email": merchant_info.get("grievance_email", "grievance@merchant.com") if is_recognized else "",
            "official_website": merchant_info.get("official_website", "") if is_recognized else "",
            "cancellation_steps": mech_details["cancellation_steps"],
            "history": history
        })

    # Sort mandates: flags with highest risk first, then by annual committed spend
    flag_priority = {"UNUSED_ZOMBIE": 1, "PRICE_HIKE": 2, "TRIAL_CONVERTED": 3, "HEALTHY": 4, "OBLIGATION": 5, "LAPSED": 6}
    mandates.sort(key=lambda m: (flag_priority.get(m["flag"], 7), -m["annual_committed_cost"]))

    active_mandates = [m for m in mandates if m.get("status") != "lapsed"]
    committed_total = sum(m["annual_committed_cost"] for m in active_mandates)
    committed_obligations_total = sum(m["annual_committed_cost"] for m in active_mandates if m.get("is_obligation"))
    committed_discretionary_total = sum(m["annual_committed_cost"] for m in active_mandates if not m.get("is_obligation"))

    fixed_committed_total = sum(m["annual_committed_cost"] for m in active_mandates if m.get("billing_type") != "usage_based")
    usage_based_run_rate_total = sum(m["annual_committed_cost"] for m in active_mandates if m.get("billing_type") == "usage_based")

    # Only fixed discretionary flagged mandates produce guaranteed annual potential savings
    potential_savings = sum(
        m["savings_if_cancelled"] for m in active_mandates
        if not m.get("is_obligation") and m["flag"] not in ["HEALTHY", "LAPSED", "OBLIGATION"] and m.get("billing_type") != "usage_based"
    )

    price_hikes_count = sum(1 for m in mandates if m["flag"] == "PRICE_HIKE")
    trial_conv_count = sum(1 for m in mandates if m["flag"] == "TRIAL_CONVERTED")
    zombies_count = sum(1 for m in mandates if m["flag"] == "UNUSED_ZOMBIE")
    usage_based_count = sum(1 for m in mandates if m.get("billing_type") == "usage_based")
    lapsed_count = sum(1 for m in mandates if m.get("status") == "lapsed")
    obligations_count = sum(1 for m in mandates if m.get("is_obligation"))

    return {
        "mandates": mandates,
        "rejected_transactions": rejected,
        "annual_committed_total": round(committed_total, 2),
        "committed_total": round(committed_total, 2),
        "committed_obligations_total": round(committed_obligations_total, 2),
        "committed_discretionary_total": round(committed_discretionary_total, 2),
        "fixed_committed_total": round(fixed_committed_total, 2),
        "usage_based_run_rate_total": round(usage_based_run_rate_total, 2),
        "annual_potential_savings": round(potential_savings, 2),
        "cancellable_savings": round(potential_savings, 2),
        "metrics": {
            "total_transactions": len(df),
            "mandates_found": len(mandates),
            "price_hikes": price_hikes_count,
            "trial_conversions": trial_conv_count,
            "zombie_subscriptions": zombies_count,
            "usage_based_mandates": usage_based_count,
            "lapsed_mandates": lapsed_count,
            "obligations": obligations_count,
            "hard_negatives_filtered": len(rejected)
        }
    }
