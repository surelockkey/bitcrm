# EPIC 9: Platinum Client Workflow (Work Orders)

---

## Overview

This epic covers specialized functionality for processing orders from "Platinum" clients (commercial and government). The system supports deal creation from calls or emails (with or without Work Orders), manages client-specific financial terms, handles documentation (W-9, COI), and maintains a centralized Work Order registry for easy searchability and compliance.

---

## Business Objectives

1. **Multi-Channel Deal Creation:** Accept requests via calls, emails, and Work Order documents
2. **Financial Terms Management:** Configure payment terms (Net-30, Net-60) and tax exemptions per client
3. **Compliance Documentation:** Store and manage W-9 and COI certificates
4. **Work Order Tracking:** Centralized registry for all Work Orders
5. **Email Integration:** Process emails with or without attachments seamlessly
6. **Professional Communication:** Send documents (estimates, invoices) as PDF via email

---

## Key User Personas

### Account Manager (Platinum)
- **Goals:** Manage premium client relationships, process orders quickly, track compliance docs
- **Pains:** Work Orders scattered across emails, payment terms easily forgotten
- **Needs:** Centralized WO tracking, quick compliance doc access, deal creation from email

### Dispatcher
- **Goals:** Create deals from various channels, ensure proper setup
- **Pains:** Work Orders attached to emails require manual tracking, unsure of payment terms
- **Needs:** Clear Work Order intake, automatic payment term application, quick deal creation

### Finance Manager
- **Goals:** Ensure accurate billing per contract, collect compliance docs, track receivables
- **Pains:** Payment term discrepancies, missing W-9/COI docs, manual receivables tracking
- **Needs:** Automatic payment term application, compliance doc checklist, AR aging report

### Platinum Client
- **Goals:** Streamlined ordering, professional communication, compliance tracking
- **Pains:** Unclear approval process, invoices sent via email scattered
- **Needs:** Professional estimate/invoice documents, clear approval workflow

---

## Core Concepts

### Platinum Client Company Card Extensions

```
┌────────────────────────────────────────────────────┐
│        PLATINUM CLIENT COMPANY PROFILE             │
├────────────────────────────────────────────────────┤
│
│ STANDARD FIELDS (from Epic 8)
│ ├─ Company Name
│ ├─ Client Type: Commercial or Government
│ ├─ Phone, Email, Address
│ └─ Website
│
│ FINANCIAL TERMS (NEW)
│ ├─ Terms of Payment: [Net-30 ▼]
│ │  Options: Cash, Net-15, Net-30, Net-60, Custom
│ ├─ Tax Exempt: [☐ Yes] ☑ No
│ └─ Primary Contact: [John Smith ▼]
│
│ COMPLIANCE DOCUMENTATION
│ ├─ W-9 Form: [w9_abc_supply.pdf] ✅ Valid
│ ├─ COI Insurance: [coi_abc_supply.pdf] ✅ Valid
│ └─ Compliance Checklist:
│    ✅ W-9 on file
│    ✅ COI on file (current within 30 days)
│    ✅ Financial terms documented
│    ⚠️ PO number required per contract
│
│ NOTES (CLIENT-LEVEL)
│ ├─ Contact ABC Supply ordering dept: 404-555-5555
│ ├─ All invoices must reference PO
│ └─ Bill to address different from service address
│
└────────────────────────────────────────────────────┘
```

### Work Order Lifecycle

```
Work Order Received:
  Email with attachment: "WO-2025-11-001.pdf"
  ↓
Step 1: Upload/Link WO
  Admin uploads to centralized WO registry
  System extracts metadata:
    - WO Number: 2025-11-001
    - Client: ABC Supply Co.
    - Description: Door replacement services
    - Date: 2025-11-01
    - Amount: $5,000
  ↓
Step 2: Create Deal
  Dispatcher opens email with WO
  Clicks "Create Deal from Email"
  System pre-fills:
    - Company: ABC Supply Co.
    - Description: [from WO]
    - Deal Amount: [from WO if present]
    - WO attachment linked to Deal
  ↓
Step 3: Configure Deal
  Dispatcher adds:
    - Service address
    - Job type
    - Required technician skills
    - Assignment
  ↓
Step 4: Process & Complete
  Technician completes work
  Invoices created (respecting Net-30 terms)
  Payment tracked per configured terms
```

### Work Order Registry

```
┌─────────────────────────────────────────────────────────────┐
│        WORK ORDER REGISTRY (Centralized List)              │
├─────────────────────────────────────────────────────────────┤
│
│ Filter By: Client [ABC Supply ▼] Status [Open ▼] Date [All ▼]
│
│ WO Number  │ Client          │ Date       │ Amount   │ Status │
│────────────┼─────────────────┼────────────┼──────────┼────────│
│ 2025-11-05 │ ABC Supply Co.  │ 2025-11-05 │ $5,000   │ In Prog│
│ 2025-11-02 │ City of Atlanta │ 2025-11-02 │ $12,500  │ Closed │
│ 2025-11-01 │ ABC Supply Co.  │ 2025-11-01 │ $3,200   │ Closed │
│ 2025-10-28 │ Federal Agency  │ 2025-10-28 │ $8,750   │ Open   │
│
│ Quick Actions:
│ - [Search by WO #] [Search by Client]
│ - [View WO] [Create Deal] [Archive]
│
└─────────────────────────────────────────────────────────────┘
```

---

## Core Workflows

### 1. Deal Creation from Email with Work Order

```
STEP 1: Email Arrives
  From: ordering@abcsupply.com
  Subject: "WO-2025-11-005: Door replacement 123 Main St"
  Attachment: WO-2025-11-005.pdf

STEP 2: Dispatcher Links Email
  Opens email in Bitrix24
  Clicks "Link to Client"
  Selects "ABC Supply Co."
  System associates email with company

STEP 3: Review Work Order
  Attachment shows:
    - Work description: "Replace entry doors, lock installation"
    - Quantity: 4 doors
    - Specification: Commercial grade
    - PO reference required: Yes

STEP 4: Create Deal
  Dispatcher clicks "Create Deal from Email"
  System generates:
    DEAL:
      - Company: ABC Supply Co.
      - Contact: Default contact (John Smith)
      - Description: [from WO]
      - WO Number: 2025-11-005 (auto-detected)
      - WO Attachment: [linked]
      - Payment Terms: Net-30 (from company profile)
      - Tax Exempt: [checked per company profile]

STEP 5: Deal Ready
  Dispatcher can edit job details
  Deal assigned to technician
  WO automatically added to central registry
  Work proceeds with compliance details tracked
```

### 2. Deal Creation from Call

```
STEP 1: Call from ABC Supply
  Phone: 404-555-5555
  "We have a Work Order for door replacement at 123 Main"

STEP 2: Dispatcher Creates Deal
  Standard call flow from Epic 1
  Creates deal with ABC Supply Co.

STEP 3: Link Work Order
  During Deal creation, dispatcher can:
  - Upload WO document directly
  - Select WO from existing registry
  - Reference WO number in Deal

STEP 4: Automatic Configuration
  Deal inherits:
    - Payment Terms: Net-30
    - Tax Exempt: Yes (if applicable)
    - Billing address: Company default
  All set automatically from company profile
```

### 3. Sending Professional Documents

```
SCENARIO: Dispatcher needs to send estimate to Platinum client

STEP 1: Estimate Created
  Dispatcher creates estimate on Deal

STEP 2: Email Estimate
  Clicks "Email Estimate"
  System shows:
    - To: ordering@abcsupply.com
    - Document: Estimate PDF
    - Optional: Message text

STEP 3: Professional Formatting
  Estimate PDF includes:
    ✅ Company letterhead
    ✅ Client details (ABC Supply Co.)
    ✅ Line items with quantities
    ✅ Total with or without tax (per profile)
    ✅ Company payment terms reference
    ✅ PO number field (if required per WO)

STEP 4: Send
  Email delivered with PDF attachment
  Sent record logged in Deal timeline
  Client can respond

SAME WORKFLOW for Invoices:
  - Invoice respects tax exempt status
  - Includes PO reference if from WO
  - Due date calculated per payment terms
```

### 4. Work Order Registry Search

```
Finance Manager needs to find all open WOs from ABC Supply

Manager opens "Work Order Registry"
  ↓
Filters:
  - Client: "ABC Supply Co." (select)
  - Status: "Open" (select)
  ↓
Results:
  WO-2025-11-05: $5,000 - In Progress
  WO-2025-11-03: $2,500 - Open (not yet started)
  ↓
Manager clicks WO-2025-11-05
  ↓
Displays:
  - Work Order document (PDF)
  - Associated Deal #12345
  - Deal status: In Progress
  - Technicians assigned
  - Estimated completion date
  ↓
Manager can:
  - View/download WO
  - Jump to Deal
  - Create follow-up Deal if needed
  - Archive WO
```

---

## Integration Points

### Integration with Deal Management (Epic 2)

- Deal pipeline configuration (may be same or separate for Platinum)
- WO reference stored in Deal
- Tax exempt status affects invoice generation

### Integration with Invoicing (Epic 3)

- Tax calculation respects tax exempt setting
- Invoice respects payment terms (due date)
- Invoice formatting for professional clients

### Integration with Email Integration

- Email linking to Platinum clients
- Email attachment extraction (WO documents)
- Document sending from Deal card

### Integration with CRM (Epic 8)

- Company card extended with financial terms
- Compliance doc fields (W-9, COI)
- Client-level notes stored

---

## User Stories Breakdown

This epic is broken down into the following user stories:

1. **[Story 9.01: Company Card Extensions](../stories/9.01-platinum-company-extensions.md)**
   - Payment terms field (Net-15, Net-30, Net-60, Custom)
   - Tax exempt checkbox
   - Primary contact selection
   - Client-level notes field

2. **[Story 9.02: Compliance Documentation](../stories/9.02-platinum-compliance-docs.md)**
   - W-9 form upload
   - COI insurance certificate upload
   - Document expiration tracking
   - Compliance checklist widget

3. **[Story 9.03: Work Order Management](../stories/9.03-platinum-work-order-management.md)**
   - Work Order document upload
   - Metadata extraction (WO #, client, amount, date)
   - Link WO to Deal
   - Archive WO

4. **[Story 9.04: Work Order Registry](../stories/9.04-platinum-work-order-registry.md)**
   - Centralized WO list
   - Search and filter capabilities
   - Quick access to associated Deal
   - WO document viewing

5. **[Story 9.05: Email Deal Creation](../stories/9.05-platinum-email-deal-creation.md)**
   - Create Deal from email
   - Auto-populate from WO (if attached)
   - Link WO document
   - Inherit company payment terms

6. **[Story 9.06: Professional Document Delivery](../stories/9.06-platinum-document-delivery.md)**
   - Send estimates as PDF email
   - Send invoices as PDF email
   - Professional formatting
   - Delivery tracking

---

## Technical Architecture

### Database Schema (Extensions to Epic 8)

```sql
-- Company Extensions (for Platinum)
b_crm_company (extended)
  UF_PAYMENT_TERMS (enum: cash, net15, net30, net60, custom)
  UF_CUSTOM_TERMS_DAYS (integer, for custom terms)
  UF_TAX_EXEMPT (bool)
  UF_W9_DOCUMENT (file)
  UF_COI_DOCUMENT (file)
  UF_COI_EXPIRATION (date)
  UF_COMPANY_NOTES (text)
  UF_PO_REQUIRED (bool)

-- Work Order Registry
b_work_order
  ID
  WO_NUMBER (unique)
  COMPANY_ID
  WO_DATE
  WO_AMOUNT
  WO_DESCRIPTION
  DOCUMENT_FILE (attachment)
  DEAL_ID (link to associated deal)
  STATUS (open, in_progress, closed, archived)
  CREATED_BY
  DATE_CREATED
  DATE_ARCHIVED

-- Deal-WO Link
b_deal (extended)
  UF_WORK_ORDER_ID
  UF_WO_REFERENCE_NUMBER
  UF_PO_NUMBER (for company PO reference)
```

### API Endpoints

```
POST /api/platinum/work-order/upload
  - Upload WO document

GET /api/platinum/work-order/registry
  - List all work orders (with filters)

POST /api/platinum/deal/from-email
  - Create deal from email with optional WO

POST /api/platinum/document/send
  - Send estimate or invoice via email
```

---

## Success Criteria

### Functional Requirements

- ✅ Company card stores payment terms and tax exempt status
- ✅ W-9 and COI documents uploadable and tracked
- ✅ Work Order registry centralized and searchable
- ✅ Deal creation from email works seamlessly
- ✅ Deal auto-inherits company payment terms
- ✅ Estimates and invoices respect tax exempt status
- ✅ Documents sent via email as professional PDFs
- ✅ WO metadata extracted and searchable

### Compliance Requirements

- ✅ Tax exempt status honored (zero tax on invoice)
- ✅ Payment terms reflected in due dates
- ✅ W-9 and COI documents accessible
- ✅ Compliance checklist tracks document validity

---

## Risks & Mitigation

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| **Tax exempt status error** | Critical - compliance | - Clear UI indicator on invoice<br>- Confirmation dialog on creation<br>- Tax calculation unit tests<br>- Finance review before send |
| **WO document loss** | High - compliance issue | - Backup all WO documents<br>- Archive strategy<br>- Retention policy<br>- Version control for changes |
| **Payment terms misconfiguration** | High - cash flow impact | - Auto-apply from company profile<br>- Validation at Deal level<br>- Due date calculation testing<br>- Finance team review |
| **Email attachment processing** | Medium - workflow issues | - Handle missing attachments gracefully<br>- Fallback to manual upload<br>- Detailed error messages<br>- Support team training |
| **Document format compatibility** | Medium - usability | - Support PDF and image formats<br>- Document preview capability<br>- OCR for text extraction (optional)<br>- User education on formats |

---

## Dependencies

**Integration Dependencies:**
- CRM Client Base (Epic 8) must be implemented
- Deal Management (Epic 2) for deal fields
- Invoicing (Epic 3) for tax exempt handling
- Email Integration (Google Workspace)

---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/prd.md)
- [Technical Requirements - Workiz Migration](../00_drafts/TR-Workiz.md)
- CRM Client Base Management Epic (Epic 8)
- Deal Management Epic (Epic 2)
- Invoicing Epic (Epic 3)
- Google Workspace Integration
