# EPIC 2: Deal Management and Lifecycle

---

## Overview

Complete replication of Workiz job management workflow within Bitrix24 Deals module. The system manages the entire job lifecycle from initial submission through completion, with strict role-based access controls and comprehensive custom fields.

---

## Business Objectives

1. **Exact Replication:** Preserve existing Workiz logic for statuses, data structure, and workflows
2. **Access Control:** Enforce strict role-based stage and field permissions
3. **Operational Continuity:** Zero disruption to daily operations during migration
4. **Future Automation:** Design structure to support robots/triggers in future phases
5. **Data Integrity:** Maintain complete audit trail and prevent unauthorized changes

---

## Key User Personas

### Dispatcher
- **Goals:** Create Deals from calls, update statuses, manage pending jobs
- **Pains:** Need quick access to client history, frequent status changes
- **Needs:** Full access to Submitted and Pending stages, tag filtering

### Technician
- **Goals:** Update job progress, add photos, mark jobs complete
- **Pains:** Need user-friendly and easy-to-use interface
- **Needs:** Access only to assigned jobs in In Progress stages

### Shift Manager
- **Goals:** Oversee all operations, move jobs through pipeline, cancel jobs
- **Pains:** Need visibility across all deals and stages
- **Needs:** Full access to all stages, ability to cancel deals with reasons

---

## Core Concepts

### Pipeline Structure

**Single Pipeline with Logical Groups:**

```
SUBMITTED (Initial)
  └─ Submitted (new jobs)

IN PROGRESS (Technician Stages)
  ├─ Job Accepted
  ├─ In Progress
  └─ Job Done

PENDING (Dispatcher/Manager Stages)
  ├─ No Answer
  ├─ Will Call Back Follow Up
  ├─ Quote Follow Up
  ├─ Waiting for Parts → See Story 5.07 for parts ordering
  ├─ Waiting for Approval
  ├─ Waiting for an Estimate → See Story 3.02 for estimate workflow
  └─ Canceled-Check (pre-cancellation review)

CLOSED (Terminal Stages)
  ├─ Done (Won) - service rendered, payment received → See Epic 10 for payment processing
  └─ Canceled (Lost) - with mandatory Loss Reason
```

**Loss Reasons (for Canceled stage):**
- Will call back
- Can't do
- Not relevant
- Customer resolved
- Went with a different company
- Lead
- No tech
- Out of area
- Because of the office
- High price

---

## Deal Card Fields

### Client Block
- First Name, Last Name
- Company name
- Phone, Ext
- Additional Phone, Additional Ext
- Email
- Service area (Dropdown)
- Address

### Schedule Block
- Schedule Toggle (Yes/No)
- Starts (Date/Time)
- Ends (Date/Time)
- All-day event (Checkbox)

> **📘 Integration:** Scheduling workflow is detailed in **[Epic 4: Scheduling & Dispatch](EPIC-4-Scheduling.md)**

### Job Block
- Job type (Dropdown)
- Job source (Dropdown, linked to telephony) → **[Epic 1: Telephony](EPIC-1-Telephony.md)** - gclid tracking from ad campaigns
- External company (Dropdown)
- Description (Multiline Text)

### Custom Info Blocks
- Jobs Dispatch (List)
- Dispatchers ID UA/GE (List)
- Additional number
- Manager Note (Multiline Text)
- Tech Parts cost (Number) → Auto-calculated from **[Story 5.03: Container Management](../stories/5.03-inventory-container-management.md)**
- Company Parts cost (Number) → Tracked separately in **[Story 5.01: Product Catalog](../stories/5.01-inventory-product-catalog.md)**
- Vendor N, C PO, VPO
- WO SERVICE DESCRIPTION
- Work Order Link
- Item to be ordered, Quantity

### File Upload Fields
- Check Image Front/Back
- Parts Image
- After Job Image
- Before Job Image
- WO File

---

## Access Permissions

> **📘 Technical Details:** Complete role definitions and permission matrix are covered in **[Epic 11: User Roles & Permissions](EPIC-11-Permissions.md)**

### Stage Permissions

**Dispatcher Role:**
- Can create Deals
- Can move through: Submitted, all Pending stages
- Cannot access: In Progress stages, Closed stages

**Technician Role:**
- Can only move between: Job Accepted, In Progress, Job Done
- Cannot see: Other techs' deals, Pending stages, Closed deals
- Can only view/edit: Assigned deals in open statuses

**Shift Manager Role:**
- Full access to all stages
- Can move from Canceled-Check → Canceled (Lost)
- Can select Loss Reason

### Field Permissions

All roles can view/edit all fields (no field-level restrictions)


---

## Tags System

**Requirements:**
- Flexible multi-tag system per Deal
- Dispatchers/Managers can add/remove tags
- **Critical:** Deal list view must have functional tag filter (search by one or more tags)

---

## Integration Points

### Integration with Telephony (Epic 1)
- Deal auto-creation from inbound calls → **[Story 1.01: Inbound Call Routing](../stories/1.01-telephony-inbound-calls.md)**
- Job Source field populated from call metadata (gclid) → Advertising source tracking
- Call recordings attached to Deal timeline → **[Story 1.04: Call Recording & Monitoring](../stories/1.04-telephony-call-recording-monitoring.md)**

### Integration with Inventory (Epic 5)
- Tech Parts cost auto-calculated from container deductions → **[Story 5.03: Container Management](../stories/5.03-inventory-container-management.md)**
- Company Parts cost tracked separately → **[Story 5.01: Product Catalog](../stories/5.01-inventory-product-catalog.md)** (three-tier pricing)

### Integration with Payments (Epic 10)
- Payment status updates Deal stage → **[Story 10.01: Stripe Payment Processing](../stories/10.01-payment-stripe-integration.md)** (webhook integration)
- Invoice linked to Deal → **[Epic 3: Invoicing](EPIC-3-Invoicing.md)** - estimate and invoice workflow

### Integration with Invoicing (Epic 3)
- Estimate items auto-sync to Deal → **[Story 3.02: Estimate Workflow](../stories/3.02-invoicing-estimates.md)**
- Invoice generation from Deal → **[Story 3.03: Invoice Generation](../stories/3.03-invoicing-invoice-generation.md)**
- Tax calculation by service area → **[Story 3.04: Tax Calculation](../stories/3.04-invoicing-tax-calculation.md)**

### Integration with Reporting (Epic 7)
- Deal data feeds commission reports → **[Epic 7: Reporting & Analytics](EPIC-7-Reporting.md)**
- Parts cost used in profit calculations

---

## Technical Architecture

### Custom Fields

**Field Types Required:**
- Text (single-line)
- Multiline Text
- Phone
- Email
- Date/Time
- Dropdown (single-select)
- List (multi-select)
- Checkbox (Yes/No)
- Number
- Money
- File (multiple)
- Address

### Pipeline Configuration

```
b_crm_deal_stage
  - ID
  - CATEGORY_ID (pipeline)
  - STATUS_ID (stage code)
  - NAME (stage display name)
  - SORT (order)
  - SEMANTICS (process/success/fail)
```

### Permission Rules

```
Stage Access Matrix:
┌──────────────┬────────────┬────────────┬──────────┐
│ Stage        │ Dispatcher │ Technician │ Manager  │
├──────────────┼────────────┼────────────┼──────────┤
│ Submitted    │ ✅ Edit    │ ❌         │ ✅ Edit  │
│ In Progress  │ ✅ Edit    │ ✅ Edit    │ ✅ Edit  │
│ Pending      │ ✅ Edit    │ ❌         │ ✅ Edit  │
│ Closed       │ ✅ Edit    │ ❌         │ ✅ Edit  │
└──────────────┴────────────┴────────────┴──────────┘
```

---

## Success Criteria

### Functional Requirements

- ✅ Pipeline matches Workiz stages exactly
- ✅ All 50+ custom fields created and grouped logically
- ✅ Role-based stage permissions enforce correctly
- ✅ Tag filtering works in Deal list view
- ✅ Loss reasons mandatory when moving to Canceled
- ✅ Technicians see only their assigned open deals
- ✅ Dispatchers can access all deals

### Migration Requirements

- ✅ All historical deals migrated with preserved statuses
- ✅ Custom field data mapped correctly
- ✅ Tags migrated and associated with deals

---

## Dependencies

**Technical Dependencies:**
- Bitrix24 plan with custom fields support
- Permission system (Enterprise plan recommended)
- Tag module enabled

**Business Dependencies:**
- Complete Workiz field mapping document
- Deal export from Workiz
- User roles defined in Bitrix24

**Integration Dependencies:**
- Telephony (Epic 1) for Deal creation from calls
- Inventory (Epic 5) for parts cost tracking
- Payments (Epic 10) for status updates

---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/prd.md)
- [Technical Requirements - Block 2](../00_drafts/TR-Workiz.md#block-2-deal-management-and-lifecycle)
- Telephony Epic (Epic 1)
- Inventory Epic (Epic 5)
- Payments Epic (Epic 10)
