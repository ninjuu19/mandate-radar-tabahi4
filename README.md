# ⚡ Mandate Radar
### The Auto Debits Nobody Can Find

**Fintech Solution | Neo4j Knowledge Graph**

[![Live Demo](https://img.shields.io/badge/Live_Demo-Vercel-black?logo=vercel&logoColor=white)](https://mandate-radar-tabahi4.vercel.app/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Neo4j](https://img.shields.io/badge/Neo4j-Graph_Database-008CC1?logo=neo4j)](https://neo4j.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 🌐 **Live Web Application:** [https://mandate-radar-tabahi4.vercel.app/](https://mandate-radar-tabahi4.vercel.app/)

**Mandate Radar** is a fintech solution designed to bring visibility and control to recurring payments and automatic bank debits.

It analyzes bank statement transactions, identifies recurring mandates, resolves unfamiliar transaction descriptions using a Neo4j-powered knowledge graph, detects suspicious subscription patterns, and provides mechanism-specific cancellation guidance.

The goal is simple: help users understand where their money goes, identify unnecessary recurring expenses, and make informed decisions about their subscriptions.

---

## 📌 The Problem

Recurring payments are easy to activate but often difficult to track and cancel.

Users frequently encounter problems such as:

- Unrecognized transaction descriptions on bank statements.
- Forgotten subscriptions and recurring commitments.
- Unexpected increases in subscription prices.
- Free trials converting into paid subscriptions.
- Continued payments for services that are no longer being used.
- Confusion about where and how to revoke an automatic payment mandate.

Traditional banking interfaces do not always provide a unified view of these commitments.

Mandate Radar addresses this problem by combining transaction analysis, merchant intelligence, graph-based relationships, and actionable cancellation guidance.

---

## 💡 Key Features

### 1. Recurring Payment Detection
Identifies recurring transactions even when billing dates or amounts are not perfectly consistent.

Supports:
- Monthly subscriptions.
- Quarterly payments.
- Annual commitments.
- Irregular billing dates.
- Recurring payments with changing amounts.

### 2. Intelligent Merchant Identification
Converts unfamiliar bank statement descriptors into understandable merchant identities.

The knowledge graph connects:
- Transaction descriptors.
- Merchants.
- Parent companies.
- Payment mechanisms.
- Cancellation procedures.

Unknown merchants are identified without blindly assigning an unverified identity.

### 3. Subscription Anomaly Detection

**Silent Price Creep**

Detects increases in recurring subscription amounts and calculates the additional annual expense.

**Trial Conversion Traps**

Identifies small initial verification or trial charges that subsequently increase into substantially higher recurring payments.

**Dormant / Zombie Subscriptions**

Highlights active recurring payments associated with extended periods of inactivity, using available service-usage information.

### 4. Mechanism-Specific Cancellation Guidance

Provides cancellation walkthroughs based on the payment mechanism, including:

- UPI AutoPay.
- Card Standing Instructions (e-Mandate).
- Bank NACH / eNACH.
- Google Play Store subscriptions.
- Apple App Store subscriptions.

### 5. Legal Escalation Guidance

Provides structured escalation information for situations where cancellation requests are not addressed.

Includes:
- Merchant grievance channels.
- Bank-side revocation guidance.
- RBI Integrated Ombudsman information.
- National Consumer Helpline information.
- Customizable revocation notice generation.

### 6. Tick-To-Cancel Savings Simulator

Highlights the annual amount committed to recurring payments and provides an interactive savings simulator to help users understand the potential impact of cancelling selected subscriptions.

---

## 🕸️ Why Neo4j?

Merchant identification and mandate management involve interconnected relationships.

A transaction descriptor may refer to different merchants or payment mechanisms depending on the billing arrangement.

A relational lookup alone can become difficult to maintain when these relationships grow.

Mandate Radar uses Neo4j to represent these connections through a knowledge graph.

### Knowledge Graph Structure

```cypher
(:Descriptor)-[:RESOLVES_TO]->(:Merchant)
(:Merchant)-[:OWNED_BY]->(:Parent)
(:Merchant)-[:BILLED_VIA]->(:Mechanism)
(:Mechanism)-[:CANCELLED_BY]->(:CancellationPath)
(:CancellationPath)-[:ESCALATES_TO]->(:EscalationStep)

(:Person)-[:HAS_MANDATE]->(:Mandate)
(:Mandate)-[:FOR]->(:Merchant)
(:Mandate)-[:VIA_MECHANISM]->(:Mechanism)
(:Mandate)-[:HAD_CHARGE]->(:Charge)
```

### Advantages of the Graph Approach

| Capability | Benefit |
|---|---|
| Merchant Resolution | Connects raw transaction descriptors to merchants. |
| Corporate Relationships | Identifies subscriptions belonging to the same parent company. |
| Payment Mechanism Mapping | Determines the appropriate cancellation route. |
| Escalation Relationships | Connects cancellation procedures with relevant escalation steps. |
| Extensibility | Allows new merchants and relationships to be added without redesigning the entire data model. |

---

## 📚 Merchant Reference Knowledge Base

The project includes a hand-built reference knowledge base covering **76 Indian and international merchants** across multiple categories.

| Category | Examples |
|---|---|
| Technology | Google, Microsoft, Apple |
| Entertainment | Netflix, Spotify, Disney+ Hotstar, Sony LIV |
| E-commerce | Amazon Prime, Audible |
| Food & Quick Commerce | Swiggy One, Zomato Gold |
| Health & Fitness | Cult.fit, Fittr, Apollo 24/7 |
| Productivity & SaaS | OpenAI, Claude, Canva, Notion, Zoom, Figma, Slack |
| Insurance & Finance | ICICI Lombard, HDFC ERGO, Bajaj Finserv |

The reference knowledge base also maintains relationships between merchants, parent companies, and payment mechanisms.

---

## ⚙️ Detection Engine

The detection engine uses deterministic Python and Pandas logic to analyze transaction dates, amounts, and descriptors.

### 1. Interval Inference

| Payment Frequency | Detection Range |
|---|---|
| Monthly | 24–36 days |
| Quarterly | 80–100 days |
| Annual | 350–380 days |

### 2. Silent Price Increase Detection

- Detects step increases greater than 3% in otherwise stable recurring payment patterns.
- Calculates the percentage increase.
- Estimates the additional annual expense.

### 3. Trial Conversion Detection

- Identifies nominal initial charges between ₹1 and ₹5.
- Detects subsequent increases of at least 10 times the initial amount.

### 4. Dormant Subscription Detection

- Identifies active mandates with at least 75 days of zero recorded usage.
- Requires at least two cleared recurring charges.
- Uses available service telemetry to identify inactivity.

### 5. Hard Negative Filtering

The system is designed to distinguish genuine recurring mandates from unrelated transactions.

Examples include:

- Weekly grocery purchases.
- Variable electricity bills.
- Irregular food delivery orders.
- Recurring transactions from unidentified merchants.

---

## 📊 Benchmark Results

The project includes a benchmark endpoint:

`GET /api/benchmark`

Reported results from the existing benchmark dataset:

| Metric | Result |
|---|---|
| Planted Mandates Recall | 100% (10/10 detected) |
| Silent Price Creep | 100% caught |
| Trial Conversion Detection | 100% caught |
| Dormant Subscription Detection | 100% caught |
| Hard Negatives | 3/3 correctly rejected |
| False Positive Rate | 0% |

**Note:** These figures represent results from the project's benchmark dataset and should not be interpreted as guaranteed performance on arbitrary real-world bank statements.

---

## ⚖️ Cancellation & Escalation Workflow

Mandate Radar provides guidance according to the payment mechanism.

| Payment Mechanism | Cancellation Guidance |
|---|---|
| UPI AutoPay | Revocation through the relevant UPI application. |
| Card e-Mandate | Merchant cancellation and bank-side standing instruction revocation. |
| NACH / eNACH | Formal mandate revocation using the relevant mandate reference. |
| Play Store | Subscription management through Google Play. |
| App Store | Subscription management through Apple account settings. |

### Escalation Framework

The project incorporates a four-tier escalation framework:

1. **Merchant Support:** Submit a written revocation request to the merchant.
2. **Issuing Bank:** Request assistance with standing instruction revocation.
3. **RBI Ombudsman:** Explore the RBI Integrated Ombudsman complaint mechanism where applicable.
4. **Consumer Protection:** Refer unresolved consumer grievances to the National Consumer Helpline.

*The guidance is informational and does not replace official banking instructions or professional legal advice. Applicable procedures and timelines should be independently verified.*

---

## 🛠️ Technology Stack

| Component | Technology |
|---|---|
| Backend | Python, FastAPI |
| Data Processing | Pandas |
| Database / Knowledge Graph | Neo4j |
| Frontend | React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| API Server | Uvicorn |

---

## 🚀 Getting Started

Follow these instructions to run the project locally.

### Prerequisites

- Python 3.10 or higher.
- pip package manager.
- Node.js 18+ (optional, for frontend development).

### 1. Clone the Repository

```bash
git clone https://github.com/ninjuu19/mandate-radar-tabahi4.git

cd mandate-radar-tabahi4
```

### 2. Install Backend Dependencies

```bash
pip install -r backend/requirements.txt
```

### 3. Run the Application

```bash
python run.py
```

### 4. Open the Application

Visit the following address in your browser:

```text
http://127.0.0.1:8000
```

The root launcher starts the FastAPI server and serves the application through the unified interface.

### Optional: Frontend Development

To work on the frontend separately:

```bash
cd frontend
npm install
npm run dev
```

To generate a production frontend build:

```bash
npm run build
```

---

## 🔗 Neo4j Aura Configuration

Mandate Radar supports an embedded graph engine for local execution and an optional live Neo4j Aura connection.

To configure Neo4j Aura:

1. Open the application.
2. Navigate to **Neo4j Aura Config**.
3. Enter your Neo4j Bolt URI.
4. Provide your database username and password.
5. Select **Test & Sync**.

Example URI format:

```text
neo4j+s://your-instance.databases.neo4j.io
```

Never commit database credentials or sensitive connection information to the repository.

---

## 📁 Project Structure

```text
mandate-radar-tabahi4/
│
├── backend/
│   ├── main.py                  # FastAPI application with REST endpoints
│   ├── detector.py              # Deterministic detection & SHA-256 charge hashing
│   ├── neo4j_service.py         # Neo4j Aura Cypher traversals & embedded engine
│   ├── reference_data.py        # Verified merchants & 8 functional capabilities
│   ├── bundle_reference.py      # Curated bundle tiers & child inclusions
│   ├── telecom_bundles.py       # User-confirmed telecom & card bundle placeholders
│   ├── synthetic_data.py        # 12-month synthetic benchmark statement generator
│   ├── requirements.txt         # Backend Python dependencies
│   ├── app/                     # Domain-driven backend modules & services
│   └── tests/                   # 11-step Acceptance test suite & synthetic CSVs
│       ├── test_all_11_acceptance_criteria.py
│       └── test_csvs/
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Main React application & view router
│   │   ├── components/          # Luxury Fernwood components & radar visualizer
│   │   ├── lib/                 # Types, API client, and sample datasets
│   │   └── style.css            # Fernwood Sand Beige & Forest Green theme
│   ├── dist/                    # Compiled production bundle
│   └── package.json
│
├── api/                         # Vercel serverless deployment adapter
├── README.md
└── run.py
```

---

## 🧭 The End-to-End User Flow & Cypher Graph Intelligence

Mandate Radar is designed for CEOs, startup administration heads, and individuals managing recurring spend. The flow is strictly scoped to the authenticated user ID (`user_id`).

### Step 1: Statement Ingest with Multi-Account Support
- Users upload one or more bank statement CSV files (`POST /api/statement/upload`).
- Statements can be tagged with an optional account label (e.g., *HDFC Salary Card*, *ICICI Current Account*).
- High-value business transactions (e.g. ₹85,000 AWS invoices) and personal micro-debits are handled uniformly.

### Step 2: Idempotent Detection & Honest Billing Classification
- Charges are deterministically hashed via SHA-256 using `date + amount + descriptor + account + user_id + row_index`. Re-uploading statements produces **0 duplicate charges**.
- Recurring charges with monthly coefficient of variation > 10% are classified as `usage_based` (e.g. AWS, Twilio, OpenAI API) vs `fixed`.
- **Honest Savings Math**: `usage_based` mandates are strictly excluded from fixed contractual savings calculations to prevent misleading estimates.

### Step 3: Multi-Hop Neo4j Graph Analyses (All in Cypher)
1. **Bundle Overlaps (Multi-hop Variable-Length Traversal)**:
   - Evaluates `(a:Vendor)-[:OFFERS|INCLUDES*1..6]->(b:Vendor)` where user pays for both a bundle and its child service separately (e.g., YouTube Premium + YouTube Music, Apple One + Apple Music).
2. **Capability / Functional Overlaps (PROVIDES Clustering)**:
   - Groups mandates where multiple vendors provide the same capability (e.g. Slack Pro + Microsoft 365 providing `team_chat`), with anti-self-bundle checks and 6-month reference staleness thresholds.
3. **Duplicate Vendors across Multiple Accounts**:
   - Detects when the same vendor is charged across multiple corporate cards or bank accounts as a consolidation candidate.
4. **Flagged Mandates**:
   - Detects silent price creep, trial conversion traps, and dormant/zombie subscriptions.
5. **Spend Concentration via Graph Aggregation**:
   - Aggregates annual commitments across Category, Vendor, Account, Tag, Mechanism, and Billing Type.

### Step 4: User Confirmation & Decision Anti-Join
- User reviews findings in the confirmation interface (`POST /api/findings/{id}/decision`).
- Kept payments become `keep_confirmed`; redundant mandates are marked `suggested_cancel`.
- Every choice is persisted as a `(:Decision {finding_key})` node linked to `(:Person)`, guaranteeing confirmed choices are **never re-prompted**.

### Step 5: Cancellation Guidance & "Marked Cancelled" Status
- Clicking "Cancel this mandate" displays mechanism-specific guidance (UPI AutoPay, Card SI, NACH, Play Store, App Store).
- User confirms cancellation, setting the mandate status to **Marked cancelled** (`marked_cancelled` / `cancel_confirmed_by_user`).

### Step 6: Automated Reconciliation on Subsequent Statements
- **3-Day In-Flight Grace Window**: Charges appearing within 3 days of cancellation confirmation are recognized as in-flight debits and do not trigger alerts.
- **Still Charging Rogue Debit Alerts**: Charges appearing after the 3-day grace window transition the mandate to `still_charging`, increment `reminder_count`, and alert the user with the exact debit date, amount, and escalation instructions.
- **Verified Cancelled**: When a subsequent statement covers the billing cycle past `expected_next_charge_date` with zero debits, the mandate transitions to **Verified cancelled** (`verified_cancelled`).

---

## 🧪 Running the 11 Acceptance Checks

A dedicated acceptance suite validates all 11 hackathon criteria against synthetic CSV statements:

```bash
python backend/tests/test_all_11_acceptance_criteria.py
```

Criteria verified:
1. Capability overlap with annual savings calculation
2. Bundle overlap with graph path evidence
3. Same vendor charged across two accounts
4. Decision persistence (not re-flagged after 'keep both')
5. Marked cancelled status transition
6. Second statement with post-grace charge returns `still_charging` alert
7. Second statement with zero charges confirms `verified_cancelled`
8. Re-uploading statement creates 0 duplicate charge nodes (idempotency)
9. Tenant isolation across Person, Mandate, Account, and Charge nodes
10. Analyses 1-3 execute as Cypher queries
11. Large statement with high-value transactions runs identically

---

## 🔮 Future Scope

Potential areas for further development include:

- Direct integration with banking APIs for real-time mandate visibility.
- Expanded merchant and descriptor reference coverage.
- Improved transaction classification for complex billing patterns.
- More comprehensive subscription usage analytics.
- Automated notifications for upcoming recurring payments.
- Enhanced graph-based merchant relationship discovery.

---

## 📜 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Mandate Radar**

*Making recurring payments visible, understandable, and easier to control.*

Built with Python, React, FastAPI, and Neo4j.

</div>