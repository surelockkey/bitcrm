# EPIC 7: Reporting & Analytics

---

## Overview

This epic covers the implementation of a comprehensive reporting module with a critical custom "Commission Report" for technician payouts, plus standard base reports for KPI monitoring across all business areas. The system provides exportable reports, custom filtering, and integrated dashboards for decision-making.

---

## Business Objectives

1. **Accurate Commission Reporting:** Reliable technician settlement calculations
2. **Financial Transparency:** Clear profit analysis and cost tracking
3. **Performance Monitoring:** KPI dashboards for management visibility
4. **Operational Insights:** Call effectiveness, technician utilization, revenue trends
5. **Compliance & Audit:** Complete audit logs and data traceability
6. **Export Capability:** CSV/XLSX export for external analysis and accounting

---

## Key User Personas

### Finance Manager
- **Goals:** Calculate technician payouts accurately, reconcile revenue
- **Pains:** Manual commission calculation is error-prone, profit tracking unclear
- **Needs:** Automated commission calculations, profit breakdowns, export to accounting system

### Shift Manager
- **Goals:** Monitor team performance, identify top performers, improve operations
- **Pains:** Limited visibility into who's generating revenue, route efficiency unknown
- **Needs:** Performance dashboards, call-to-deal conversion, technician utilization

### Technician
- **Goals:** Understand earnings, see commissions earned
- **Pains:** Commission calculations opaque, settlement disputes common
- **Needs:** Personal earnings statement, job-by-job breakdown, transparent fees

### Owner/Executive
- **Goals:** Monitor business health, identify trends, control costs
- **Pains:** Limited visibility into profitability by service type or area
- **Needs:** Executive dashboards, trend analysis, cost control reports

---

## Core Concepts

### Commission Report Structure

```
┌─────────────────────────────────────────────────────────────────┐
│              COMMISSION REPORT                                  │
│              (Technician: John Smith)                          │
│              (Period: Nov 1-30, 2025)                          │
├─────────────────────────────────────────────────────────────────┤
│
│  SUMMARY
│  ├─ Total Deals: 45
│  ├─ Total Revenue: $15,750.00
│  ├─ Total Parts Cost: $3,450.00
│  ├─ Total Tax: $1,260.00
│  ├─ Credit Card Fees: $552.50
│  ├─ Profit Pool: $10,487.50
│  ├─ Tech Commission (40%): $4,195.00
│  └─ Company Profit: $6,292.50
│
│  PAYMENT BREAKDOWN
│  ├─ Cash: $6,250.00
│  ├─ Credit Card: $7,500.00
│  ├─ ACH: $2,000.00
│  └─ Check: $0.00
│
│  DEDUCTIONS
│  ├─ Credit Card Fee (3%): -$225.00
│  ├─ Check Fee: -$0.00
│  └─ Net After Deductions: $3,970.00
│
│  BALANCE
│  ├─ Gross Earnings: $4,195.00
│  ├─ Fees & Deductions: -$225.00
│  ├─ Net Amount Due: $3,970.00
│  └─ Payment Status: Paid (2025-12-05)
│
└─────────────────────────────────────────────────────────────────┘
```

### Commission Calculation Logic

```
For each Deal in "Done" status:

  Deal Total: $350.00
  Tax: $28.00
  Parts Cost (Tech): $45.00
  Company Parts: $0.00

  Profit Pool = $350 - $28 - $45 - $0 = $277.00
  Tech Commission (40%): $277.00 × 40% = $110.80
  Company Profit: $277.00 - $110.80 = $166.20

  Tech CC Fee (3% on card payments): $350 × 3% = $10.50

  Final Tech Payout: $110.80 - $10.50 = $100.30
```

### Report Data Sources

```
All reports based on:
  - Deals in "Done" status only
  - Invoice amounts and payment status
  - Technician assignments and base rates
  - Parts cost from product catalog
  - Commission fee deductions (3% credit card, 0% ACH)
```

---

## Core Workflows

### 1. Commission Report Generation

```
STEP 1: Select Parameters
  Date Range: "2025-11-01 to 2025-11-30"
  Filter By: [Technician: All ▼] [Job Type: All ▼] [Area: All ▼]
  View Type: [Manager View ▼] (or Technician View)

STEP 2: Generate Report
  System queries all Done deals in date range
  Filters by selected parameters
  Applies commission calculation formula
  Generates detailed row-by-row breakdown

STEP 3: Review Report
  View columns: Job ID, Tech, Created, Scheduled, Closed, Job Type, Address,
               Total, Cash, Credit, Billing, Check, Tech Share (%), Tip Amount,
               Parts, Company Parts, Tech Profit, Company Profit, Tax

STEP 4: Export
  Click [Export to CSV] or [Export to Excel]
  File downloads for accounting system import

STEP 5: Approve & Settle
  Manager reviews totals
  Clicks [Approve Commission]
  Creates payroll batch for technician
  Payment processed (weekly, bi-weekly, monthly)
```

### 2. Performance Analysis Report

```
REPORT: Technician Performance (Monthly)

Technician: Sarah Jones
├─ Completed Deals: 52
├─ Total Revenue: $18,500
├─ Average Deal Value: $355.77
├─ Avg Deal Duration: 1.5 hours
├─ Revenue per Hour: $237
├─ On-Time Completion: 98%
└─ Customer Rating (avg): 4.8/5

TREND ANALYSIS
├─ Month-over-month growth: +12%
├─ Peak performance day: Friday
└─ Most common job type: Lock Installation (35%)
```

### 3. Source Effectiveness Report

```
REPORT: Call & Source Analysis

Source: Google Ads - Emergency Lockout
├─ Calls Received: 234
├─ Calls → Deals Converted: 187 (80%)
├─ Total Revenue from Source: $45,200
├─ Avg Deal Value: $242
├─ Conversion Cost (Ad Spend): $3,400
├─ ROI: 1,229%

Comparison (sorted by ROI):
  1. Referral Programs: 2,400% ROI
  2. Google Ads - Emergencies: 1,229% ROI
  3. Yelp Reviews: 456% ROI
  4. Google Ads - Services: 234% ROI
```

---

## Integration Points

### Integration with Deal Management (Epic 2)

- Reports filtered by Deal status (Done, Canceled)
- Loss reasons tracked for canceled deal analysis
- Deal creation date and close date tracked

### Integration with Invoicing (Epic 3)

- Invoice totals feed into commission calculations
- Tax amounts deducted from profit
- Payment status tracked for revenue recognition

### Integration with Technician Profiles (Epic 6)

- Technician base rates applied
- Fee deductions configured per technician (3% credit card, 0% ACH)
- Commission calculations accurate and transparent

### Integration with Inventory (Epic 5)

- Parts costs from product catalog
- Inventory movements tracked
- Cost accuracy critical for commission calculations

### Integration with Payments (Epic 10)

- Payment method breakdown (cash, card, ACH, check)
- Credit card fees and service fees tracked
- Refunds and disputes recorded

---

## Key Features

This epic includes the following key features:

### 1. Commission Report Core
- Commission calculation engine with 40% base rate
- Fee deductions (3% credit card, 0% ACH)
- Multi-technician reporting
- Date range filtering
- Manager vs. Technician views
- Detailed row-by-row breakdown with columns matching Workiz structure:
  - Job ID, Tech, Created, Scheduled, Closed, Job Type, Address
  - Total, Cash, Credit, Billing, Check
  - Tech Share (%), Tip Amount, Parts, Company Parts
  - Tech Profit, Company Profit, Tax

### 2. Commission Report Export
- CSV export functionality
- Excel export with formatting
- Accounting system compatibility
- Archive previous reports
- Batch export for multiple technicians

### 3. Performance Analytics
- Technician performance metrics
- Revenue and deal count tracking
- Month-over-month comparisons
- Top performer identification
- Average deal value and duration
- Customer ratings integration

### 4. Source Analysis Reports
- Call source effectiveness tracking
- Conversion rate by source
- Revenue by ad source
- ROI calculations
- Marketing campaign performance

### 5. Financial Reports
- Tax summary by state
- Accounts receivable aging
- Payment method distribution
- Profitability by service type
- Cost analysis and profit margins

### 6. Audit Log & Compliance
- User action tracking (who, what, when)
- Deal status change history
- Commission calculation changes
- Export audit trail
- Compliance reporting

### 7. Dashboards
- Executive dashboard (high-level KPIs)
- Technician dashboard (personal earnings)
- Manager dashboard (team performance)
- Real-time data updates
- Customizable widgets

### 8. Payment Report
- All payment transactions with detailed breakdown
- Filter by date range, payment method, status, technician
- Columns matching Workiz structure:
  - ID, Amount, Payment date, Status, Type, Confirmation #
  - Description, Client name, Tip, Card (last 4 digits)
  - Technician, Transaction ID, Collected by, Job Type
- Payment method breakdown (Cash, Credit, ACH, Check)
- Tip tracking and reporting
- Export to CSV/Excel for accounting
- Integration with payment gateway data

### 9. Inventory Usage Report
- Detailed parts usage tracking per job
- Filter by date range, technician, item, client
- Columns matching Workiz structure:
  - Item, SKU, Job/Invoice, Client, Job date
  - Techs (assigned technicians), Qty, Price, Cost, Total
- Cost vs. Price analysis
- Total calculations (quantity, revenue, cost, profit)
- Integration with inventory deduction logs
- Export functionality for accounting
- Parts usage trends and analytics

### 10. Jobs Report (Master Report)
- Comprehensive job listing with all statuses
- Advanced filtering capabilities:
  - Date range, Status, Job Type, Metro Area
  - Technician, Client, Tags, Source
  - Custom field filters
- Columns matching Workiz structure:
  - Job #, Client, Tags, Type, Job Created, Scheduled, End
  - Phone, Status, Tech, Address, City, State, Zip code
  - Metro Area, Total, Source
- Supports all job statuses (Submitted, Assigned, In Progress, Done, Canceled, etc.)
- Tag-based filtering and grouping
- Export with customizable column selection
- Bulk operations support

### 11. Custom Report Builder
- Drag-and-drop report designer
- Field selection from all available data sources:
  - Deals, Contacts, Products, Payments, Inventory
  - Technicians, Schedules, Custom fields
- Advanced filtering engine:
  - Multiple filter conditions (AND/OR logic)
  - Date range selectors
  - Dropdown filters for predefined values
  - Text search and pattern matching
- Grouping and aggregation:
  - Group by any field
  - Sum, Count, Average, Min, Max functions
  - Subtotals and grand totals
- Sorting and ordering options
- Save custom reports for reuse
- Share reports with team members
- Schedule automatic report generation
- Export in multiple formats (CSV, Excel, PDF)

---

## Technical Architecture

### Database Schema

```sql
-- Commission Report (calculated, can be cached)
b_report_commission
  ID
  TECHNICIAN_ID
  REPORT_PERIOD_START
  REPORT_PERIOD_END
  TOTAL_DEALS
  TOTAL_REVENUE
  TOTAL_PARTS_COST
  TOTAL_TAX
  TOTAL_CREDIT_FEES
  PROFIT_POOL
  TECH_COMMISSION
  COMPANY_PROFIT
  STATUS (draft, approved, paid)
  GENERATED_BY
  APPROVED_BY
  DATE_CREATED
  DATE_APPROVED

-- Commission Report Details
b_report_commission_item
  ID
  REPORT_ID
  DEAL_ID
  JOB_ID
  TECH_ID
  CREATED_DATE
  SCHEDULED_DATE
  CLOSED_DATE
  JOB_TYPE
  ADDRESS
  DEAL_TOTAL
  PAYMENT_METHOD
  CASH_AMOUNT
  CREDIT_AMOUNT
  BILLING_AMOUNT
  CHECK_AMOUNT
  TAX_AMOUNT
  PARTS_COST
  COMPANY_PARTS
  TECH_SHARE_PERCENT
  TIP_AMOUNT
  TECH_PROFIT
  COMPANY_PROFIT

-- Report Audit Log
b_report_audit_log
  ID
  REPORT_TYPE
  REPORT_ID
  USER_ID
  ACTION (create, generate, export, approve)
  DETAIL (JSON)
  DATE_ACTION

-- Payment Report Data (aggregated from transactions)
b_report_payment
  ID
  TRANSACTION_ID
  DEAL_ID
  AMOUNT
  PAYMENT_DATE
  STATUS
  TYPE (card, ach, cash, check, sunbit)
  CONFIRMATION_NUMBER
  DESCRIPTION
  CLIENT_NAME
  TIP_AMOUNT
  CARD_LAST4
  TECHNICIAN_ID
  COLLECTED_BY
  JOB_TYPE

-- Inventory Usage Report (aggregated from movements)
b_report_inventory_usage
  ID
  ITEM_ID
  SKU
  ITEM_NAME
  DEAL_ID
  JOB_NUMBER
  CLIENT_NAME
  JOB_DATE
  TECHNICIAN_ID
  QUANTITY
  PRICE
  COST
  TOTAL

-- Jobs Report (master view of all deals)
-- Uses existing b_crm_deal with custom filters

-- Custom Report Definitions
b_report_custom
  ID
  NAME
  DESCRIPTION
  CREATED_BY
  DATA_SOURCES (JSON - selected tables/entities)
  FIELDS (JSON - selected columns)
  FILTERS (JSON - filter configuration)
  GROUPING (JSON - group by fields)
  SORTING (JSON - sort configuration)
  SCHEDULE (JSON - auto-generation settings)
  SHARED_WITH (JSON - user/team IDs)
  DATE_CREATED
  DATE_MODIFIED
```

### API Endpoints

```
POST /api/reporting/commission/generate
  - Generate commission report for date range

GET /api/reporting/commission/{report_id}
  - Retrieve commission report details

POST /api/reporting/commission/{report_id}/export
  - Export report to CSV or Excel

GET /api/reporting/performance/{technician_id}
  - Get performance metrics for technician

GET /api/reporting/source-analysis
  - Get source effectiveness report

GET /api/reporting/audit-log
  - Retrieve audit trail with filters

POST /api/reporting/payment/generate
  - Generate payment report for date range

GET /api/reporting/payment/export
  - Export payment report to CSV/Excel

POST /api/reporting/inventory-usage/generate
  - Generate inventory usage report

GET /api/reporting/inventory-usage/export
  - Export inventory usage report

POST /api/reporting/jobs/generate
  - Generate jobs report with filters

GET /api/reporting/jobs/export
  - Export jobs report

POST /api/reporting/custom/create
  - Create custom report definition

POST /api/reporting/custom/{report_id}/generate
  - Generate custom report

GET /api/reporting/custom/{report_id}/export
  - Export custom report

PUT /api/reporting/custom/{report_id}/schedule
  - Set up automatic report generation

POST /api/reporting/custom/{report_id}/share
  - Share custom report with users/teams
```

---

## Success Criteria

### Functional Requirements

- ✅ Commission calculations accurate per formula (3% credit card fee, 0% ACH)
- ✅ Multi-technician reports generate correctly
- ✅ Report columns match Workiz structure exactly
- ✅ Filters work for date, technician, job type, area
- ✅ Export to CSV and Excel working
- ✅ Manager and Technician views differ appropriately
- ✅ Audit log captures all report actions
- ✅ Dashboards update in real-time
- ✅ Payment report shows all transactions with accurate breakdowns
- ✅ Inventory usage report tracks parts usage per job
- ✅ Jobs report supports all statuses and advanced filtering
- ✅ Custom report builder allows drag-and-drop field selection
- ✅ Custom reports can be saved, shared, and scheduled

---

## Risks & Mitigation

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| **Commission calculation errors** | Critical - financial | - Implement automated testing<br>- Manual verification for first month<br>- Formula version control<br>- Audit trail of changes |
| **Large report timeouts** | Medium - performance | - Implement caching<br>- Optimize database queries<br>- Pagination for large reports<br>- Async generation for exports |
| **Data inconsistency** | High - reporting accuracy | - Transaction integrity for deal updates<br>- Nightly reconciliation job<br>- Variance alerts<br>- Regular audits |
| **Sensitive data exposure** | High - privacy/compliance | - Restrict report access by role<br>- Technician sees own data only<br>- Manager sees all<br>- Audit log access logging |
| **Fee calculation errors** | High - calculation errors | - Fixed fee structure (3% credit card, 0% ACH)<br>- Thorough testing<br>- Manual verification for first month<br>- Audit trail of calculations |

---

## Dependencies

**Integration Dependencies:**
- Deal Management (Epic 2) for deal data
- Invoicing (Epic 3) for invoice totals
- Technician Profiles (Epic 6) for commission rates
- Inventory (Epic 5) for parts costs
- Payments (Epic 10) for payment method tracking

---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/prd.md)
- [Technical Requirements - Workiz Migration](../00_drafts/TR-Workiz.md)
- Deal Management Epic (Epic 2)
- Invoicing Epic (Epic 3)
- Technician Onboarding Epic (Epic 6)
- Inventory Management Epic (Epic 5)
- Payment Gateway Integration Epic (Epic 10)
