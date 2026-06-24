# EPIC 10: Payment Gateway Integration

---

## Overview

This epic covers the complete integration of payment processing capabilities with Bitrix24 CRM. The system supports multiple payment methods (card, ACH, cash, check, financing), automatic service fee calculation, refund/dispute management, and Tap to Pay mobile functionality. Primary provider: **Stripe** with **Sunbit** for installment financing.

---

## Business Objectives

1. **Payment Flexibility:** Accept all common payment methods (card, ACH, cash, check, installments)
2. **Revenue Optimization:** Automatic 3.5% service fee on credit card payments
3. **Mobile Payments:** Tap to Pay capability for technicians to accept cards on-site using mobile device
4. **Dispute Management:** Automated chargeback detection and dispute workflow
5. **Financial Accuracy:** Automatic Deal status updates based on payment success/failure
6. **Cost Control:** Acquiring fee ≤3% per transaction

---

## Key User Personas

### Technician
- **Goals:** Collect payment on-site quickly, accept card payments without dedicated terminal
- **Pains:** Carrying physical card terminal is cumbersome, manual receipt entry
- **Needs:** Tap to Pay on mobile device, automatic invoice generation, digital signature capture

### Dispatcher
- **Goals:** Process phone payments, send payment links to clients, track payment status
- **Pains:** Manual payment entry, client callbacks for payment issues
- **Needs:** Click-to-pay links, real-time payment status in CRM, automated status updates

### Finance Manager
- **Goals:** Reconcile payments, manage refunds, handle disputes, track late payments
- **Pains:** Disputes require manual investigation, refund process is cumbersome
- **Needs:** Automated dispute pipeline, one-click refunds, late payment fee automation

### Executive/Owner
- **Goals:** Minimize transaction fees, maximize collections, track payment performance
- **Pains:** High acquiring fees (currently X%), service fees not captured
- **Needs:** Service fee automation (3.5% on cards), acquiring fee ≤3%, payment analytics

---

## Core Concepts

### Payment Methods

```
┌─────────────────────────────────────────────────────┐
│           Supported Payment Methods                  │
└─────────────────────────────────────────────────────┘

1. Credit/Debit Card
   - Manual entry (web/mobile)
   - Apple Pay / Google Pay
   - Tap to Pay (mobile device as terminal)
   - Payment link (SMS/email)
   Service Fee: 3.5% added to invoice total

2. ACH (Bank Transfer)
   - Client provides bank details
   - 3-5 business days processing
   Service Fee: None

3. Cash
   - Technician collects on-site
   - Manual entry in mobile app
   Service Fee: None

4. Check
   - Technician collects on-site
   - Photo capture of check
   Service Fee: None

5. Sunbit Financing (Installments)
   - For high-value jobs ($1,000+)
   - Client applies via Sunbit portal
   - Approval/denial workflow
   Service Fee: None (Sunbit handles fees)
```

### Three-Tier Pricing Model

**Every catalog item has three prices:**

```
Example: Kwikset Deadbolt Lock

Cost Company: $15.00    ← Wholesale/procurement cost
Cost for Tech: $18.00   ← Used in commission calculations
Price Client: $45.00    ← Customer-facing sales price

When added to Deal:
  - Cost Company: Hidden from technician, visible to managers
  - Cost for Tech: Used in Commission Report
  - Price Client: Shown to technician (editable within limits)

If paid by credit card:
  - Invoice Total: $45.00
  - Service Fee (3.5%): $1.58
  - Client pays: $46.58
  - Commission calculated on: $45.00 - $18.00 = $27.00 profit
```

### Service Fee Automation

**Business Rule:** Add 3.5% surcharge ONLY on credit card payments

```
┌──────────────────────────────────────────────────────┐
│         Service Fee Calculation Flow                 │
└──────────────────────────────────────────────────────┘

Technician completes job → Creates invoice in mobile app
                                    ↓
                    Invoice Total: $350.00 (parts + labor)
                                    ↓
            Client selects payment method:
                ↓                       ↓                   ↓
        💳 Credit Card             🏦 ACH               💵 Cash
                ↓                       ↓                   ↓
    Calculate service fee        No service fee       No service fee
    $350 × 3.5% = $12.25
                ↓
    Invoice Total: $362.25
                ↓
    Stripe charges card: $362.25
    Stripe fee (3%): $10.87
    Net received: $351.38
                ↓
    Deal status: "Paid"
    Payment logged in Deal timeline
```

### Stripe Webhook Integration

**Real-Time Payment Status Updates:**

```
┌──────────────────────────────────────────────────────┐
│            Stripe Webhook Events                     │
└──────────────────────────────────────────────────────┘

Stripe Event: payment_intent.succeeded
        ↓
Bitrix24 receives webhook
        ↓
Update Deal status: "In Progress - Paid"
Log payment in Deal timeline
Send confirmation email to client
        ↓

Stripe Event: charge.dispute.created (Chargeback!)
        ↓
Bitrix24 receives webhook
        ↓
Create new Deal in "Dispute" pipeline
Status: "New Dispute"
Assign task to Finance Manager
Copy original Deal details to dispute
        ↓

Stripe Event: refund.created
        ↓
Bitrix24 receives webhook
        ↓
Update original Deal status: "Refunded"
Log refund amount and reason in timeline
Adjust Commission Report (if applicable)
```

---

## Core Workflows

### 1. Tap to Pay (Mobile Payment)

**Technician collects payment on-site:**

```
Step 1: Technician Completes Job
  → Opens Deal in mobile app
  → Clicks "Create Invoice"
  → Reviews line items (parts + labor)
  → Client approves estimate digitally

Step 2: Select Payment Method
  → "How would you like to pay?"
  → [💳 Tap Card] [🏦 ACH] [💵 Cash] [Check]

Step 3: Client Selects "Tap Card"
  → System calculates:
      Subtotal: $350.00
      Tax (8%): $28.00
      Service Fee (3.5%): $13.23
      Total: $391.23
  → "Client will pay $391.23"
  → [Proceed]

Step 4: Tap to Pay Screen
  → "Hold card near device"
  → NFC reader activates
  → Client taps card on phone
  → Processing... (2-3 seconds)
  → ✅ "Payment Successful"

Step 5: Digital Receipt
  → Generate PDF invoice
  → Email/SMS to client immediately
  → Update Deal status: "Paid"
  → Deduct parts from technician's inventory
```

### 2. Payment Link (Remote Payment)

**Dispatcher sends payment link:**

```
Step 1: Dispatcher Opens Deal
  → Deal status: "In Progress - Invoice Sent"
  → Client hasn't paid yet

Step 2: Click "Send Payment Link"
  → System generates unique Stripe payment link
  → Link includes:
      - Invoice PDF
      - Amount due
      - Expiration (72 hours)
  → Send via SMS or Email

Step 3: Client Receives Link
  → Client clicks link on their device
  → Stripe hosted payment page opens
  → Client enters card details
  → Submits payment

Step 4: Automatic Status Update
  → Stripe webhook: payment_intent.succeeded
  → Bitrix24 updates Deal status: "Paid"
  → Notification sent to dispatcher and technician
  → Invoice marked as paid
```

### 3. Sunbit Financing

**High-value job ($1,000+) with installment option:**

```
Step 1: Technician Presents Estimate
  → Total: $2,500
  → "Would you like to pay over time?"
  → Client: "Yes"

Step 2: Technician Initiates Sunbit Application
  → Clicks "Sunbit Financing" in mobile app
  → Enters client's email/phone
  → Sunbit sends application link to client

Step 3: Client Completes Application
  → Client opens link on their phone
  → Provides: SSN, income, bank details
  → Sunbit instant decision: Approved ✅

Step 4: Finalize Financing
  → Sunbit sends webhook to Bitrix24
  → Deal status: "In Progress - Financed (Sunbit)"
  → Technician completes job
  → Sunbit pays company (minus fees)
  → Client makes monthly payments to Sunbit
```

### 4. Refund Processing

**Manager issues refund:**

```
Step 1: Manager Reviews Refund Request
  → Client dispute or service issue
  → Manager opens Deal
  → Reviews original payment: $391.23 (card)

Step 2: Initiate Refund in Bitrix24
  → Click "Issue Refund"
  → Select amount: [Full] [Partial: $___]
  → Reason: [Quality Issue ▼]
  → Notes: "Client unhappy with lock installation"
  → [Submit Refund]

Step 3: Bitrix24 → Stripe API
  → POST /v1/refunds
  → Stripe processes refund (3-5 business days to card)
  → Stripe webhook: refund.created

Step 4: Update Deal
  → Deal status: "Closed - Refunded"
  → Original payment marked: "Refunded"
  → Commission Report: Deduct from technician's earnings
  → Inventory: Return parts to technician's container (optional)
```

### 5. Dispute Management

**Automated chargeback handling:**

```
Step 1: Client Files Chargeback with Bank
  → Bank notifies Stripe
  → Stripe webhook: charge.dispute.created

Step 2: Bitrix24 Auto-Creates Dispute Deal
  → New pipeline: "Disputes"
  → Status: "New Dispute"
  → Deal fields populated:
      - Original Deal ID
      - Dispute amount
      - Dispute reason
      - Due date for response
  → Task assigned to Finance Manager

Step 3: Manager Gathers Evidence
  → Opens dispute Deal
  → Reviews:
      - Signed invoice
      - Call recording
      - GPS location (proof of service)
      - Photos of completed work
  → Uploads evidence to Stripe dashboard

Step 4: Submit Response
  → Manager clicks "Submit to Stripe"
  → Bitrix24 uploads evidence via Stripe API
  → Deal status: "Response Sent"

Step 5: Stripe Decision
  → Stripe/Bank reviews evidence
  → Webhook: charge.dispute.closed
  → Outcome: [Won ✅] or [Lost ❌]
  → Deal status updated accordingly
```

---

## Integration Points

### Integration with Invoicing (Block 3)

**Invoice Generation:**
- Technician creates invoice from Deal
- Invoice template matches provided sample (download.pdf)
- Service fee automatically calculated if card payment
- Digital signature captured and embedded in PDF

**Payment Status:**
- Invoice linked to payment transaction
- Real-time status: Pending → Processing → Paid → Refunded

### Integration with Commission Report (Block 7)

**Technician CC Fee:**
- Configurable % deducted from tech commission (NOT visible to client)
- Example:
  ```
  Deal Total: $350
  Service Fee: $12.25 (client pays)
  Tech CC Fee: 2% × $350 = $7.00 (deducted from tech commission)

  Commission calculation:
    Profit: $350 - $28 (tax) - $45 (parts cost) = $277
    Tech share (40%): $277 × 40% = $110.80
    Tech CC Fee: -$7.00
    Net tech payout: $103.80
  ```

### Integration with Deal Management (Block 2)

**Automatic Status Updates:**
```
Payment Received → Deal status: "In Progress - Paid"
Refund Issued → Deal status: "Closed - Refunded"
Chargeback Filed → Create Dispute Deal
```

---

## User Stories Breakdown

This epic is broken down into the following user stories:

1. **[Story 10.01: Stripe Core Setup](../stories/10.01-payment-stripe-core-setup.md)**
   - Stripe account configuration
   - Webhook architecture and endpoint security
   - API key management
   - Test mode and production mode

2. **[Story 10.02: Invoice Generation](../stories/10.02-payment-invoice-generation.md)**
   - Invoice template matching sample (download.pdf)
   - Digital signature capture on mobile device
   - PDF generation and email delivery
   - Service fee inclusion logic

3. **[Story 10.03: Service Fee Automation](../stories/10.03-payment-service-fee-automation.md)**
   - 3.5% surcharge on card payments only
   - Calculation logic and display
   - Invoice line item presentation
   - Commission Report integration

4. **[Story 10.04: Refunds & Disputes](../stories/10.04-payment-refunds-disputes.md)**
   - Refund initiation (full and partial)
   - Dispute pipeline creation
   - Evidence gathering and submission
   - Automated status updates via webhooks

5. **[Story 10.05: Late Payment Fees](../stories/10.05-payment-late-fees.md)**
   - Auto-calculation of late fees (configurable % per day overdue, varies by state)
   - Overdue tracking
   - Payment reminders
   - Collection workflow

6. **[Story 10.06: Sunbit Financing](../stories/10.06-payment-sunbit-financing.md)**
   - Sunbit integration and account setup
   - Application workflow from mobile app
   - Approval/denial handling
   - Payment tracking as separate method

7. **[Story 10.07: Tap to Pay](../stories/10.07-payment-tap-to-pay.md)**
   - Mobile device as NFC terminal
   - Stripe Terminal SDK integration
   - In-person payment workflow
   - Receipt generation and delivery

---

## Technical Architecture

### Stripe Integration

**API Version:** Latest stable (2023-10+)

**Key Endpoints:**
```
POST /v1/payment_intents
  - Create payment intent for card payment

POST /v1/charges
  - Charge credit card (legacy, use payment_intents preferred)

POST /v1/refunds
  - Issue full or partial refund

POST /v1/customers
  - Create Stripe customer for repeat billing

GET /v1/charges/{charge_id}
  - Retrieve payment details

POST /v1/disputes/{dispute_id}/submit
  - Submit evidence for chargeback dispute
```

**Webhook Events:**
```
payment_intent.succeeded → Update Deal status to "Paid"
payment_intent.payment_failed → Update Deal status to "Payment Failed"
charge.refunded → Update Deal status to "Refunded"
charge.dispute.created → Create Dispute Deal
charge.dispute.closed → Update Dispute Deal with outcome
```

### Database Schema

```sql
-- Payment Transactions
b_payment_transaction
  ID
  DEAL_ID (link to Deal)
  STRIPE_PAYMENT_INTENT_ID
  AMOUNT (decimal)
  CURRENCY (USD)
  PAYMENT_METHOD (enum: 'card', 'ach', 'cash', 'check', 'sunbit')
  STATUS (enum: 'pending', 'succeeded', 'failed', 'refunded')
  SERVICE_FEE (decimal, if applicable)
  CREATED_BY (user ID)
  DATE_CREATE
  DATE_COMPLETE

-- Refunds
b_payment_refund
  ID
  TRANSACTION_ID
  STRIPE_REFUND_ID
  AMOUNT
  REASON
  NOTES
  CREATED_BY
  DATE_CREATE

-- Disputes
b_payment_dispute
  ID
  ORIGINAL_DEAL_ID
  STRIPE_DISPUTE_ID
  AMOUNT
  REASON
  STATUS (enum: 'new', 'evidence_submitted', 'won', 'lost')
  DUE_DATE (for evidence submission)
  OUTCOME
  DATE_CREATE
  DATE_CLOSE
```

---

## Success Criteria

### Functional Requirements

- ✅ All payment methods supported (card, ACH, cash, check, Sunbit)
- ✅ Service fee automatically calculated (3.5% on card payments only)
- ✅ Tap to Pay works on iOS and Android mobile devices
- ✅ Stripe webhooks update Deal status in real-time (<10 seconds)
- ✅ Refunds process successfully (full and partial)
- ✅ Dispute pipeline auto-creates from chargeback webhooks
- ✅ Payment links expire after 72 hours
- ✅ Digital signatures embedded in invoice PDFs

### Performance Requirements

- ✅ Payment processing time: <5 seconds
- ✅ Webhook processing: <10 seconds from Stripe event to Deal update
- ✅ Invoice PDF generation: <3 seconds
- ✅ Tap to Pay NFC read: <2 seconds

### Financial Requirements

- ✅ Acquiring fee ≤3% per transaction
- ✅ Service fee revenue captured: $X,XXX/month (estimated)

---

## Risks & Mitigation

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| **Stripe API downtime** | High - cannot process payments | - Fallback to manual entry<br>- Queue failed webhooks for retry<br>- Monitor Stripe status page |
| **Tap to Pay device compatibility** | Medium - limits mobile payment | - Test on variety of devices<br>- Provide external reader backup<br>- Document supported devices |
| **Chargeback fraud** | Medium - financial loss | - Collect digital signatures<br>- GPS tracking proof<br>- Photo documentation |
| **Service fee legality** | High - compliance risk | - Verify state regulations<br>- Display fee clearly on invoice<br>- Legal review |
| **Webhook security** | High - data integrity | - Verify webhook signatures<br>- HTTPS endpoint only<br>- IP allowlist for Stripe |

---

## Implementation Phases

### Phase 1: Stripe Core (Weeks 1-2)
- Stripe account setup (test + production)
- Webhook endpoint creation
- Payment intent API integration
- Basic card payment (web)

### Phase 2: Service Fees & Invoicing (Weeks 3-4)
- Service fee calculation logic
- Invoice template implementation
- Digital signature capture
- PDF generation

### Phase 3: Tap to Pay (Weeks 5-6)
- Stripe Terminal SDK integration
- Mobile NFC payment flow
- Receipt generation
- Device compatibility testing

### Phase 4: Advanced Features (Weeks 7-8)
- Refund workflows
- Dispute pipeline automation
- Sunbit integration
- Late payment fee automation

---

## Dependencies

**Technical Dependencies:**
- Stripe account (business verification required)
- SSL certificate for webhook endpoint
- Mobile app with NFC capability (for Tap to Pay)
- Sunbit merchant account (for financing)

**Business Dependencies:**
- State-by-state service fee legality review
- Late payment fee policy (varies by state)
- Invoice template approval
- Commission Report calculation logic finalized

**Integration Dependencies:**
- Deal Management (Epic 2) for status updates
- Invoicing (Block 3) for invoice generation
- Commission Report (Epic 7) for tech CC fee integration

---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/prd.md)
- [Technical Requirements - Workiz Migration](../00_drafts/TR-Workiz.md)
- Deal Management Epic (Epic 2)
- Invoicing Epic (Epic 3)
- Commission Report Epic (Epic 7)
