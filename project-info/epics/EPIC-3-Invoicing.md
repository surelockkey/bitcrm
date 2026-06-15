# EPIC 3: Invoicing, Estimates, Products & Payments

---

## Overview

This epic covers the complete financial management system for handling estimates, invoicing, product/service catalogs, and payment processing. The system enables dispatchers and technicians to create professional estimates and invoices, manage billable items, process diverse payment methods, and automate late payment fees.

---

## Business Objectives

1. **Estimate Workflow:** Clients can approve estimates digitally with e-signature and make deposits
2. **Invoice Accuracy:** Professional PDF invoices matching company branding
3. **Cost Tracking:** Accurate part costs for commission and profit calculations
4. **Digital Signatures:** Clients sign invoices directly on technician's mobile device
5. **Multi-Payment Support:** Cash, card, ACH, checks, and installment plans
6. **Late Fee Automation:** Automatic calculation and application of late payment fees

---

## Key User Personas

### Technician
- **Goals:** Create invoices quickly on-site, collect signatures and payment
- **Pains:** A lot of manual actions needed
- **Needs:** Mobile invoice generation, digital signature capture, simple price entry

### Dispatcher
- **Goals:** Generate estimates for client approval, track estimate status
- **Pains:** Approval tracking is manual
- **Needs:** Estimate management interface, auto-sync to invoice, client approval tracking

### Finance Manager
- **Goals:** Ensure accurate billing, manage late payments, reconcile invoices
- **Pains:** Late payment tracking is manual, fee calculations inconsistent
- **Needs:** Automated late fee calculation, payment status dashboard, financial reports

### Client
- **Goals:** Receive clear cost estimate, approve work, understand final charges
- **Pains:** Surprise charges, unclear pricing, manual approval process
- **Needs:** Professional estimate document, digital approval mechanism, transparent pricing

---

## Core Concepts

### Product Catalog Structure

```
Products/Services
│
├── Services (Non-Stock Items)
│   ├── Labor (by hour)
│   ├── Service Call Fee
│   ├── Dispatch Fee
│   └── Emergency Fee
│
└── Products (Stock-Managed Items)
    ├── Locks
    ├── Keys
    ├── Hardware
    └── Tools
```

**Three-Tier Pricing:**
```
Example: Kwikset Deadbolt

Cost Company: $15.00    ← Wholesale cost (hidden from tech)
Cost for Tech: $18.00   ← Used in commission calculations
Price Client: $45.00    ← Customer-facing sale price
```

> **📘 Technical Details:** Three-tier pricing configuration is detailed in **[Story 5.01: Product Catalog Configuration](../stories/5.01-inventory-product-catalog.md)**. Commission calculations using "Cost for Tech" are covered in **[Epic 7: Reporting & Analytics](EPIC-7-Reporting.md)**.

### Estimate Lifecycle

```
Step 1: Create Estimate
  → Dispatcher or Technician initiates
  → Selects items/services
  → Calculates total with tax
  → Status: PENDING

Step 2: Client Approval
  → Client receives estimate link
  → Reviews items and pricing
  → Signs digitally (e-signature) ← See Story 10.02 for signature implementation
  → Optionally pays deposit ← See Epic 10 for payment processing
  → Status: APPROVED

Step 3: Estimate → Invoice
  → Items auto-sync to Deal
  → Technician creates Invoice
  → Maintains approved pricing
```

### Invoice to Payment Flow

```
Technician creates Invoice
  ↓
System adds items (from estimate or manual)
  ↓
Calculate totals:
  - Subtotal (items + tax)
  - Service Fee (if card payment)
  ↓
Client reviews & approves (signature on mobile)
  ↓
Client selects payment method
  ↓
Process payment (card, ACH, cash, check) ← See Epic 10 for all payment methods
  ↓
Deal status updates to "Paid"
  ↓
Receipt generated & delivered (email/SMS)
```

---

## Core Workflows

### 1. Estimate Creation & Approval

```
Dispatcher opens Deal
  ↓
Clicks "Create Estimate"
  ↓
System generates estimate document:
  - Client details
  - Service description
  - Line items with prices
  - Subtotal + tax
  - Professional formatting
  ↓
Client receives approval link (SMS/email)
  ↓
Client reviews in browser
  ↓
Client signs estimate digitally (signature capture)
> See **[Story 10.02: Digital Signature Collection](../stories/10.02-payment-signature-collection.md)** for signature capture implementation
  ↓
Optional: Client pays deposit
> See **[Epic 10: Payment Gateway Integration](EPIC-10-Payments.md)** for deposit payment processing
  ↓
Status: APPROVED
Items automatically added to Deal
```

### 2. Invoice Generation (Technician)

```
Technician completes work
  ↓
Opens Deal in mobile app
  ↓
Clicks "Create Invoice"
  ↓
System shows items:
  - From approved estimate (if applicable)
  - Or manually added products
  ↓
Technician can:
  - Verify quantities
  - Adjust prices (within limits)
  - Add additional items
  ↓
System calculates:
  - Subtotal
  - Tax (by location)
  - Service Fee (if card payment selected)
  - Final total
  ↓
Presents to client with signature line
  ↓
Client signs on mobile device
> See **[Story 10.02: Digital Signature Collection](../stories/10.02-payment-signature-collection.md)** for signature implementation
  ↓
Payment processing begins
> See **[Epic 10: Payment Gateway Integration](EPIC-10-Payments.md)** for all payment processing workflows
```

### 3. Late Payment Fee Automation

> **📘 Technical Details:** Complete late payment fee implementation is covered in **[Story 10.05: Late Payment Fee Processing](../stories/10.05-payment-late-fees.md)**, including configurable fee rates by state and automated calculation logic.

```
Invoice created: Net-30 payment terms
  ↓
30 days pass, payment not received
  ↓
Automated job runs (daily):
  Check each overdue invoice
  Calculate late fee:
    Fee % = config value (varies by state)
    Days overdue = today - due date
    Late Fee = (invoice total) × (% per day) × days
  ↓
Add late fee to invoice
  ↓
Update Deal timeline
  ↓
Send payment reminder notification
```

---

## Integration Points

### Integration with Deal Management (Epic 2)

- Estimate items auto-sync to Deal products
- Invoice tracking within Deal timeline
- Payment status updates Deal stage

### Integration with Inventory (Epic 5)

- Product catalog linked to inventory → **[Story 5.01: Product Catalog Configuration](../stories/5.01-inventory-product-catalog.md)**
- Item prices pulled from catalog (three-tier pricing model)
- Parts deducted from technician's container when added to Deal → **[Story 5.03: Container Management](../stories/5.03-inventory-container-management.md)**

### Integration with Commission Report (Epic 7)

- Parts cost affects profit calculation → **[Epic 7: Reporting & Analytics](EPIC-7-Reporting.md)** uses "Cost for Tech" from three-tier pricing
- Service fees deducted from technician commission
- Invoice totals feed into financial reports

### Integration with Payments (Epic 10)

- Stripe webhook updates payment status → **[Story 10.01: Stripe Payment Processing](../stories/10.01-payment-stripe-integration.md)**
- Service fee calculation (3.5% on cards) → **[Story 10.04: Service Fee Management](../stories/10.04-payment-service-fees.md)**
- Refund processing workflow → **[Story 10.03: Refund Processing](../stories/10.03-payment-refunds.md)**
- Digital signature collection → **[Story 10.02: Digital Signature Collection](../stories/10.02-payment-signature-collection.md)**
- Late payment fees → **[Story 10.05: Late Payment Fee Processing](../stories/10.05-payment-late-fees.md)**

---

## User Stories Breakdown

This epic is broken down into the following user stories:

1. **[Story 3.01: Product Catalog Management](../stories/3.01-invoicing-product-catalog.md)**
   - Create/edit products and services
   - Three-tier pricing configuration
   - Bulk import from CSV
   - Price validation rules

2. **[Story 3.02: Estimate Workflow](../stories/3.02-invoicing-estimates.md)**
   - Create estimate from Deal
   - Generate professional estimate PDF
   - Client approval via portal link
   - Digital signature capture
   - Deposit payment option

3. **[Story 3.03: Invoice Generation](../stories/3.03-invoicing-invoice-generation.md)**
   - Create invoice from Deal or estimate
   - Mobile-friendly invoice interface
   - Professional PDF template
   - Digital signature on mobile device
   - Email delivery

4. **[Story 3.04: Tax Calculation](../stories/3.04-invoicing-tax-calculation.md)**
   - Location-based tax rates (by state/metro area)
   - Automatic tax calculation on taxable items
   - Tax exempt customer support
   - Configurable tax rate management
   - Tax configuration stored in **[Epic 2: Deal Management](EPIC-2-Deal-Management.md)** system settings

5. **[Story 3.05: Late Payment Fees](../stories/3.05-invoicing-late-fees.md)**
   - Configurable late fee % by state
   - Automatic daily fee calculation
   - Overdue tracking and notifications
   - Payment reminder workflows

6. **[Story 3.06: Multiple Payment Methods](../stories/3.06-invoicing-payment-methods.md)**
   - Record card, ACH, cash, check payments
   - Sunbit financing integration
   - Manual payment entry workflows
   - Payment confirmation tracking

---

## Technical Architecture

### Database Schema

```sql
-- Estimates
b_invoicing_estimate
  ID
  DEAL_ID
  STATUS (pending, approved, rejected)
  CREATED_BY
  CLIENT_SIGNATURE (blob)
  DATE_CREATE
  DATE_APPROVED

-- Estimate Line Items
b_invoicing_estimate_item
  ID
  ESTIMATE_ID
  PRODUCT_ID
  QUANTITY
  PRICE (as shown to client)
  TAX_RATE

-- Invoices
b_invoicing_invoice
  ID
  DEAL_ID
  INVOICE_NUMBER
  STATUS (pending, signed, paid, overdue, refunded)
  SUBTOTAL
  TAX_AMOUNT
  SERVICE_FEE
  TOTAL
  DUE_DATE
  CLIENT_SIGNATURE (blob)
  CREATED_BY
  DATE_CREATE
  DATE_PAID

-- Invoice Line Items
b_invoicing_invoice_item
  ID
  INVOICE_ID
  PRODUCT_ID
  QUANTITY
  PRICE (as charged to client)
  COST (for commission)

-- Late Fees
b_invoicing_late_fee
  ID
  INVOICE_ID
  DAILY_RATE
  DAYS_OVERDUE
  AMOUNT
  DATE_CALCULATED
```

### API Endpoints

```
POST /api/invoicing/estimate/create
  - Create new estimate from Deal

GET /api/invoicing/estimate/{id}
  - Retrieve estimate details

POST /api/invoicing/estimate/approve
  - Submit digital signature and approval

POST /api/invoicing/invoice/create
  - Create invoice from Deal or estimate

GET /api/invoicing/invoice/{id}/pdf
  - Generate invoice PDF

POST /api/invoicing/invoice/sign
  - Capture digital signature

GET /api/invoicing/late-fees/calculate
  - Calculate overdue late fees
```

---

## Success Criteria

### Functional Requirements

- ✅ Estimate creation with items from product catalog
- ✅ Client approval with digital e-signature
- ✅ Deposit payment on invoice
- ✅ Automatic sync of estimate items to Deal
- ✅ Invoice generation from Deal (mobile + web)
- ✅ Professional PDF invoice matching template
- ✅ Digital signature capture on technician mobile device
- ✅ Tax calculation by state/metro area
- ✅ Late payment fees calculated automatically
- ✅ Multiple payment methods recorded
- ✅ Service fees added for card payments
- ✅ Refund processing with invoice status updates

### Financial Requirements

- ✅ Tax rates accurate by state
- ✅ Late fee calculations consistent with policy
- ✅ Service fees captured for payment processors

---

## Dependencies

**Technical Dependencies:**
- Bitrix24 Enterprise plan (for invoicing module)
- PDF generation library
- Digital signature library (e-SignLive or similar)
- Payment gateway integration (Stripe)

**Business Dependencies:**
- Tax rate data for all states
- Invoice template approval
- Payment terms policy
- Late fee policy by state

**Integration Dependencies:**
- Deal Management (Epic 2) must be implemented
- Inventory (Epic 5) for product catalog
- Payment Processing (Epic 10) for payment methods
- Commission Report (Epic 7) for cost tracking

---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/prd.md)
- [Technical Requirements - Workiz Migration](../00_drafts/TR-Workiz.md)
- Deal Management Epic (Epic 2)
- Inventory Management Epic (Epic 5)
- Payment Gateway Integration Epic (Epic 10)
- Commission Report Epic (Epic 7)
