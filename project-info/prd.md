# Product Requirements Document: Workiz to Bitrix24 Migration

## Document Information

**Version:** 1.0
**Last Updated:** 2025-11-04
**Document Status:** Draft
**Project Type:** Brownfield Migration
**Target Audience:** Integration Partners, Solution Architects, Project Managers

---

## Executive Summary

This document outlines the comprehensive requirements for migrating a multi-state locksmith service business from Workiz to Bitrix24. The project encompasses a complete digital transformation of business operations, including CRM, telephony, inventory management, payment processing, scheduling, and internal communications.

**Primary Business Goal:** To consolidate multiple disparate systems (Workiz, Flock, WhatsApp, Google Workspace) into a unified Bitrix24 platform that supports operational excellence, scalability, and enhanced customer service delivery.

**Key Success Metrics:**
- 100% migration of active customer data and operational history
- Zero disruption to daily business operations during transition
- Improved dispatcher efficiency through unified interface
- Enhanced technician mobility and real-time communication
- Complete audit trail for compliance and quality assurance

---

## Table of Contents

1. [Business Context](#business-context)
2. [Current State Analysis](#current-state-analysis)
3. [System Architecture Overview](#system-architecture-overview)
4. [Core Functional Blocks](#core-functional-blocks)
5. [Integration Requirements](#integration-requirements)
6. [Migration Strategy](#migration-strategy)
7. [Success Criteria](#success-criteria)
8. [Project Constraints](#project-constraints)
9. [Next Steps](#next-steps)

---

## Business Context

### Company Overview

We operate a professional locksmith services business serving residential, commercial, and government clients across multiple U.S. states. Our operations involve:

- **Geographic Coverage:** Multi-state operations with distinct metro areas
- **Organizational Structure:** Three-office international operation
  - **USA Office:** Field operations
    - Field Technicians (mobile service delivery)
    - Field Management (direct technician supervision)
  - **Ukraine Office:** Primary back-office headquarters
    - Customer Service (CS) Department: Dispatchers, Shift Managers
    - IT Department
    - Logistics Department
    - Finance Department
    - Marketing Department
    - Executive
  - **Georgia Office:** Support operations
    - Customer Service (CS)
    - Technical Support
- **Service Model:** On-demand emergency services and scheduled commercial work
- **Client Segments:**
  - Residential customers (emergency lockouts, rekeying)
  - Commercial clients (access control systems, master key systems)
  - Government contracts (work order-based projects)

### Business Challenges

**Current Pain Points:**
1. **Fragmented Systems:** Multiple tools for different functions (Workiz for jobs, Flock for internal chat, WhatsApp for US team, Google Workspace for email)
2. **Compliance Risks:** Incomplete audit trails and data retention on employee devices
3. **Data Silos:** Information scattered across platforms, hindering reporting and analysis
4. **Cost Inefficiency:** Multiple paid subscriptions for overlapping functionality
5. **Process Gaps:** Manual workarounds for dispatching (Google Sheets + Google Maps)


### Strategic Objectives

**Short-term (0-3 months):**
- Achieve feature parity with current Workiz functionality
- Migrate all active customer data and operational history
- Train team on new unified platform
- Eliminate redundant tool subscriptions

**Long-term (3-24 months):**
- Implement advanced automation and workflow optimization
- Scale operations to additional states/metro areas
- Leverage AI capabilities for call transcription and quality scoring
- Build comprehensive business intelligence dashboards

---

## Current State Analysis

### Technology Stack

**Primary Systems:**
- **Workiz:** CRM, job management, scheduling, invoicing, inventory, payments, telephony
- **Communication:**
  - Flock (Ukraine and Georgia offices - internal communications)
  - WhatsApp (US field team communications)
  - Gmail (client communications across all offices)
- **Productivity:** Google Workspace (Calendar, Drive, Meet, Docs, Sheets)

### Data Estate

**Critical Data for Migration:**
- **Customers:** ~XXX,XXX active clients (residential, commercial, government)
- **Jobs History:** Historical deal records with full lifecycle data
- **Inventory:** Product catalog, current stock levels across technician vans
- **Communications:** Selected chat histories from Flock and WhatsApp
- **Documents:** Templates, work orders, signed contracts, photos

### Current Workflows

**Typical Job Lifecycle:**
1. **Inbound Call** → Dispatcher answers, creates job in Workiz
2. **Job Assignment** → Manual assignment using map + technician availability
3. **Technician Dispatch** → Tech receives job, navigates to location
4. **On-Site Service** → Tech performs work, adds items from van inventory
5. **Invoice & Payment** → Tech generates invoice, collects payment (card/cash)
6. **Job Completion** → Status update, inventory deduction, commission calculation

**Pain Points in Current Process:**
- Manual dispatch decisions using multiple tools
- No automatic routing based on skills/location/availability
- Limited real-time visibility of technician location
- Cumbersome inventory tracking across multiple vans
- Manual commission calculations and reconciliation

---

## System Architecture Overview

### Target Platform: Bitrix24

**Selected Edition:** [To be determined based on requirements analysis]

**Deployment Model:** On-Premise (self-hosted)

**Core Modules to Implement:**
- CRM (Contacts, Companies, Deals)
- Telephony (VoIP integration)
- Communication (Internal messenger, email client)
- Inventory Management
- Tasks & Projects
- Reports & Analytics
- Mobile Application

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     External Integrations                    │
├─────────────────────────────────────────────────────────────┤
│  Telephony Provider  │  Payment Gateway  │  Google Workspace │
└──────────┬───────────┴─────────┬─────────┴──────────┬───────┘
           │                     │                    │
           ▼                     ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                       Bitrix24 Core                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   CRM    │  │Telephony │  │Inventory │  │ Payments │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │Messenger │  │ Calendar │  │ Reports  │  │   API    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                               │
└───────────┬─────────────────────────────────────┬───────────┘
            │                                     │
            ▼                                     ▼
    ┌──────────────┐                     ┌──────────────┐
    │ Web Interface│                     │Mobile App    │
    │              │                     │(Technicians) │
    └──────────────┘                     └──────────────┘
```

---

## Core Functional Blocks

The complete system is organized into 12 major functional blocks. Each block corresponds to an Epic with associated user stories (technical requirements).

**Documentation Structure:**
- **Block** = High-level functional area (described in this PRD)
- **Epic** = Detailed implementation plan with workflows, personas, architecture (see [docs/epics/](docs/epics/))
- **Story** = Specific technical requirement for development (see [docs/stories/](docs/stories/))

### Block 1: Telephony and Call Processing → [EPIC 1](docs/epics/EPIC-1-Telephony.md)

**Overview:** Comprehensive IP telephony solution deeply integrated with CRM for call routing, logging, and source tracking.

**Key Capabilities:**
- Multi-line inbound call routing to active dispatchers
- Pop-up caller identification with CRM data
- Automatic Deal creation with source tracking (gclid)
- Deal draft auto-save - system saves incomplete Deal data during active call to prevent data loss
- 100% call recording with hybrid storage strategy (hot storage: 90 days cloud, cold archive)
- Call quality monitoring (whisper mode for managers)
- Missed call management interface with persistent notifications
- SMS Integration - two-way SMS messaging tied to Deals, auto-logging to timeline
- Extension-based call masking - technicians receive unique extension per Deal for masked communication

**Critical Requirements:**
- Stable call quality and minimal dropped calls
- Real-time call analytics and reporting
- Integration with advertising source tracking
- Call routing algorithm: round-robin to dispatchers marked as "Available" based on work schedule or online status
- Outbound caller ID: automatic selection based on Deal's metro area
- Recording retention: 90-day cloud hot storage + local cold archive (for cost-savings)

**Reference:** Detailed requirements in [docs/tr/](docs/tr/) - Stories 1.01-1.06
- Story 1.01: [Inbound Call Routing](docs/tr/1.01-telephony-inbound-calls.md) - Call distribution, CRM pop-up, Deal creation, draft auto-save
- Story 1.02: [Outbound Calls & Masking](docs/tr/1.02-telephony-outbound-calls-masking.md) - Extension-based masking, caller ID by metro area
- Story 1.03: [SMS Integration](docs/tr/1.03-telephony-sms-integration.md) - Two-way SMS, Deal timeline logging
- Story 1.04: [Call Recording & Monitoring](docs/tr/1.04-telephony-call-recording-monitoring.md) - Hybrid storage, whisper mode, AI transcription
- Story 1.05: [Missed Calls Interface](docs/tr/1.05-telephony-missed-calls-interface.md) - Persistent notifications, callback workflows
- Story 1.06: [Call Control & Log](docs/tr/1.06-telephony-call-control-call-log.md) - Transfer, conference, hold, call log filtering

---

### Block 2: Deal Management and Lifecycle → [EPIC 2](docs/epics/EPIC-2-Deal-Management.md)

**Overview:** Replication of complete job management workflow from Workiz using Bitrix24 Deals module.

**Key Capabilities:**
- Custom pipeline with grouped stages (Submitted, In Progress, Pending, Closed)
- Comprehensive Deal card with 50+ custom fields
- Role-based stage permissions (Dispatcher, Technician, Manager)
- Flexible tagging system with filter capabilities
- Structured cancellation reasons for lost deals

**Critical Requirements:**
- Exact replication of current Workiz data structure
- Strict access controls by role and stage
- Support for future automation (robots/triggers)

**Reference:** See Block 2 in [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md)

---

### Block 3: Invoicing, Estimates, Products & Payments → [EPIC 3](docs/epics/EPIC-3-Invoicing.md)

**Overview:** Complete financial management from estimate to payment within Deal card.

**Key Capabilities:**
- Three-tier pricing model for every catalog item:
  - Cost Company - wholesale/procurement cost (base for margin calculations)
  - Cost for Tech - internal technician cost (used in commission calculations)
  - Price Client - customer-facing sales price (editable by tech within limits)
- Unified product/service catalog with cost and price fields
- Estimate creation with client approval and digital signature
- Invoice generation (web and mobile) matching specific template
- Multiple payment methods (card, cash, ACH, check, installments)
- Automatic late payment fee calculation (configurable % per day overdue, varies by state)
- Location-based tax calculation (automatic rate lookup by service area/address)

**Critical Requirements:**
- Price validation rules: technician cannot set Price Client >50% above or <20% below recommended price without manager approval
- Auto-sync approved estimates to Deal products
- Digital signature capture on mobile device (embedded in final invoice PDF)
- Payment gateway integration with auto-status updates
- Invoice template: must precisely match provided sample (download.pdf)
- Estimate workflow: Pending → Approved (with signature) → Auto-transfer to Deal products

**Reference:** See Block 3 in [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md)
- Story 10.02: [Invoice Generation](docs/tr/10.02-payment-invoice-generation.md) - Invoice template and template requirements
- Story 10.03: [Service Fee Automation](docs/tr/10.03-payment-service-fee-automation.md) - See Block 10 for full payment integration

---

### Block 4: Scheduling & Dispatching → [EPIC 4](docs/epics/EPIC-4-Scheduling.md)

**Overview:** Map-centric dispatch interface replacing manual Google Sheets workflow.

**Key Capabilities:**
- Interactive map showing unassigned jobs and technician locations
- Real-time GPS tracking of field technicians
- Visual job assignment with color-coding and sequence numbers
- Smart technician filtering (skills + service area matching)
- Calendar integration for availability management

**Critical Requirements:**
- Map-first interface (not calendar-based)
- Drag-and-drop job assignment
- Integration with technician calendars for availability
- Real-time location updates via mobile app

**Note:** This is a highly custom requirement requiring specialized development or marketplace app integration.

**Reference:** See Block 4 in [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md)

---

### Block 5: Inventory Management → [EPIC 5](docs/epics/EPIC-5-Inventory-Management.md)

**Overview:** Advanced barcode-driven multi-warehouse inventory system.

**Two-Catalog Architecture:**
- **Products Catalog** - physical stock-managed items (locks, keys, batteries, doors)
  - Inventory tracking enabled
  - Barcode/SKU required
  - Organized: Tools (programmers, machines) vs. Job Supplies (hierarchical categories)
  - Serial number tracking for Tools category
- **Services Catalog** - non-stock items (labor, service call fees, consultations)
  - No inventory tracking
  - Used for billing only

**Warehouse Structure:**
- **Central Warehouses** - physical locations for stock receiving and storage
- **Technician Containers** - virtual warehouses representing each technician's van inventory
- **Access Control** - technicians can ONLY see and use items from their assigned container

**Key Capabilities:**
- Bulk import and price update capabilities (CSV/XLSX import, filter-based price updates)
- **Barcode-driven workflows**:
  - **Receiving**: scan items to add to warehouse/container
  - **Job usage**: scan to auto-deduct from container and add to Deal
  - **Transfers**: scan to move between warehouses and containers
- **Transfer order types** with approval workflows:
  - Warehouse → Container (requires manager approval)
  - Container → Warehouse (returns)
  - Container → Container (tech-to-tech transfers)
- **Blind stocktaking process**:
  1. Manager initiates count for specific container
  2. System freezes inventory movements and saves snapshot
  3. Technician scans all physical items from zero (blind count)
  4. System generates variance report (System Qty vs Actual Qty)
- Kitting/bundling support for Tool items

**Critical Requirements:**
- Technicians can only use items from their assigned container
- Real-time visibility of all technician inventory levels for managers/dispatchers
- Barcode scanning mandatory for all inventory transactions (receiving, transfers, job usage)
- Comprehensive movement history and audit trail per SKU
- Manager-only permission for manual inventory adjustments

**Reference:** Detailed requirements in [docs/tr/](docs/tr/) - Stories 5.01-5.08
- Story 5.01: [Product Catalog](docs/tr/5.01-inventory-product-catalog.md) - Two-catalog architecture (Products vs Services), hierarchical categories, bulk import
- Story 5.02: [Warehouse Setup](docs/tr/5.02-inventory-warehouse-setup.md) - Multi-warehouse structure, technician containers, access controls
- Story 5.03: [Receiving Workflows](docs/tr/5.03-inventory-receiving.md) - Barcode-driven receiving, direct-to-tech shipments
- Story 5.04: [Transfer Orders](docs/tr/5.04-inventory-transfers.md) - Warehouse↔Container, Container↔Container, approval workflows
- Story 5.05: [Deal Integration](docs/tr/5.05-inventory-deal-integration.md) - Barcode deduction from jobs, three-tier pricing enforcement
- Story 5.06: [Stocktaking](docs/tr/5.06-inventory-stocktaking.md) - Blind count process, variance reporting, inventory freeze
- Story 5.07: [Mobile Workflows](docs/tr/5.07-inventory-mobile-workflows.md) - Mobile barcode scanning, technician app workflows
- Story 5.08: [Inventory Reporting](docs/tr/5.08-inventory-reporting.md) - Movement history, stock levels, usage reports, sales velocity

---

### Block 6: Technician Onboarding & Profile Management → [EPIC 6](docs/epics/EPIC-6-Technician-Onboarding.md)

**Overview:** Complete technician lifecycle management from onboarding to commission tracking.

**Key Capabilities:**
- Secure collection of sensitive employee data
- Skills and service area assignment
- Custom commission rate configuration per technician
- Individual inventory container setup
- Mobile app configuration (GPS, notifications)

**Critical Requirements:**
- Call masking enabled for all technicians
- Configurable commission rules (by job type, by amount)
- Fee tracking (credit card fees, check fees)

**Reference:** See Block 6 in [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md)

---

### Block 7: Reporting & Analytics → [EPIC 7](docs/epics/EPIC-7-Reporting.md)

**Overview:** Custom Commission Report plus standard operational reports.

**Key Capabilities:**
- **Commission Report** (highest priority):
  - Manager view (full financial detail)
  - Technician view (personal earnings only)
  - Complex calculation logic for profit sharing
  - Configurable credit card fee percentage
- Standard reports for performance, sources, financials
- Global audit log for all user actions
- Exportable to CSV/XLSX

**Critical Requirements:**
- Commission calculation must match exact formula
- Date range filtering (by Created or Closed date)
- Real-time accuracy (no manual reconciliation)

**Reference:** See Block 7 in [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md)

---

### Block 8: CRM Client Base Management → [EPIC 8](docs/epics/EPIC-8-CRM.md)

**Overview:** Structured client database with segmentation and data integrity controls.

**Key Capabilities:**
- Company and Contact entities with hierarchy
- Client type classification (Residential, Commercial, Government)
- Duplicate merging (Manager role only)
- Delete protection (prevent deletion if deals exist)
- Email integration for entity linking and deal creation

**Critical Requirements:**
- Auto-creation of clients from first call
- Dispatcher/Manager can edit; Technicians cannot
- Seamless Gmail integration for client identification

**Reference:** See Block 8 in [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md)

---

### Block 9: "Platinum" Client Workflow (Work Orders) → [EPIC 9](docs/epics/EPIC-9-Platinum-Clients.md)

**Overview:** Specialized functionality for commercial and government clients.

**Key Capabilities:**
- Deal creation from calls and emails (with/without Work Order)
- Client-specific fields (payment terms, tax exempt status)
- W-9 and COI document storage
- Centralized Work Order registry
- PDF email delivery of documents

**Critical Requirements:**
- Tax-exempt status automatically applied to invoices
- Work Order attachment to Deal
- Searchable/filterable WO registry

**Reference:** See Block 9 in [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md)

---

### Block 10: Payment Gateway Integration → [EPIC 10](docs/epics/EPIC-10-Payments.md)

**Overview:** Payment processing integration supporting multiple payment types.

**Provider:** Stripe, Sunbit (only for installments)

**Key Capabilities:**
- **Card payments**: Apple/Google Pay, Tap to Pay (mobile device as terminal), manual entry, payment link
- **ACH direct bank transfer** (client provides bank details for payment)
- **Sunbit financing integration** - installment payment plans for high-value jobs ($1,000+)
  - Client applies via Sunbit portal from invoice
  - Approval workflow integrated with Deal status
  - Payment tracked as separate payment method
- Refund processing (full and partial via Stripe dashboard)
- Transaction logging and reporting (all operations logged with search/filter)
- **Automatic service fee addition** - 3% surcharge on credit card payments only (NOT on cash/ACH)
- **Dispute management pipeline**:
  - Auto-detect chargeback notifications from Stripe webhook
  - Auto-create Deal in "Dispute" pipeline
  - Stages: New Dispute → Gathering Evidence → Response Sent → Won/Lost
  - Auto-assign task to responsible manager

**Critical Requirements:**
- Acquiring fee ≤3% per transaction
- Flexible payout configuration (instant settlement or scheduled weekly payouts)
- Auto-creation of dispute deals with manager assignment
- **Internal "Technician CC Fee"** - configurable % deducted from tech commission (not visible to client, used only in Commission Report calculations)
- **Stripe webhook integration** for:
  - Payment success/failure status updates in Deal
  - Chargeback/dispute notifications
  - Refund confirmations

**Reference:** Detailed requirements in [docs/tr/](docs/tr/) - Stories 10.01-10.07
- Story 10.01: [Stripe Core Setup](docs/tr/10.01-payment-stripe-core-setup.md) - Stripe account configuration, webhook architecture, API integration
- Story 10.02: [Invoice Generation](docs/tr/10.02-payment-invoice-generation.md) - Invoice template, digital signature, PDF generation (see Block 3)
- Story 10.03: [Service Fee Automation](docs/tr/10.03-payment-service-fee-automation.md) - 3.5% surcharge on card payments, calculation logic
- Story 10.04: [Refunds & Disputes](docs/tr/10.04-payment-refunds-disputes.md) - Refund workflows, dispute pipeline, chargeback handling
- Story 10.05: [Late Payment Fees](docs/tr/10.05-payment-late-fees.md) - Auto-calculation, state-based rates, overdue tracking
- Story 10.06: [Sunbit Financing](docs/tr/10.06-payment-sunbit-financing.md) - Installment payment integration, approval workflow
- Story 10.07: [Tap to Pay](docs/tr/10.07-payment-tap-to-pay.md) - Mobile device as terminal, in-person payment workflows

---

### Block 11: User Roles & Permissions → [EPIC 11](docs/epics/EPIC-11-Permissions.md)

**Overview:** Hierarchical role-based access control system.

**Key Capabilities:**
- Five-tier role hierarchy (Super Admin → Admin → Department Manager → Standard → Technician)
- Entity-level, stage-level, and field-level permissions
- Technician restrictions (own deals only, no closed deals)
- Dispatcher access (all deals, edit until closed)
- Manager full access (all stages, all data)

**Critical Requirements:**
- Maximum flexibility for future granular permission configuration
- Bitrix24 plan must support field-level permissions
- Role-based visibility of reports

**Reference:** See Block 11 in [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md)

---

### Block 12: Internal Communications Migration → [EPIC 12](docs/epics/EPIC-12-Communications.md)

**Overview:** Consolidation of Flock and WhatsApp into Bitrix24 messenger.

**Key Capabilities:**
- Full data export from Flock (via API) and WhatsApp
- Selective chat migration with client approval
- Private and group chats with pinning capability
- Audio/video calls with automatic recording
- Task creation from chat messages
- Centralized cloud storage (no local caching)

**Critical Requirements:**
- Preserve message authorship and timestamps on import
- Admin-only group chat creation
- Call recording stored in Bitrix24 cloud
- File directory per chat

**Reference:** See "Migration of Corporate Messengers" in [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md)

---

## Integration Requirements

### Google Workspace Integration

**Priority:** High

**Scope:**
- **Gmail:** Deep CRM integration for selective email linking, Lead/Deal creation from email
- **Calendar:** Two-way sync with Bitrix24 calendars, auto-generate Google Meet links
- **Drive:** Cloud storage integration, auto-save Deal files to Drive folders
- **Gemini:** Embedded AI chat interface in Bitrix24
- **Docs/Sheets/Forms:** Seamless file handling and creation from Bitrix24

**Critical Decision Point:** Integrator to propose optimal Gmail integration approach:
- Option A: Email client inside Bitrix24
- Option B: Bitrix24 widget inside Gmail interface

**Reference:** See "Google Workspace Integration" in [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md)

---

### Telephony Provider Integration

**Priority:** Critical

**Scope:**
- Multi-line inbound call routing
- Outbound caller ID management (by metro area)
- Call masking for technician-client communication
- 100% call recording
- Real-time call monitoring (whisper mode)
- AI transcription and summarization

**Options to Evaluate:**
- Twilio (custom integration) - see [docs/tr/01-06-telephony-*.md](docs/tr/)
- Native Bitrix24 telephony providers
- Hybrid approach

**Decision Criteria:**
- Call quality and stability
- Feature completeness (especially call masking)
- Cost per minute/call
- AI capabilities availability

---

### Payment Gateway Integration

**Priority:** Critical

**Scope:**
- Multiple payment methods (card, ACH, cash, check, installments)
- Tap to Pay via mobile device
- Automatic payment status updates in Deals
- Refund and dispute handling
- Configurable service fees and late payment fees

**Recommended Providers:**
- Stripe (preferred for feature completeness)
- Braintree
- Other proposals welcome

**Reference:** Detailed requirements in [docs/tr/10-16-payment-*.md](docs/tr/)

---

## Migration Strategy

### Phased Approach

**Phase 1: Foundation (Weeks 1-4)**
- Bitrix24 instance setup and configuration
- User account creation and role assignment
- Core CRM structure (Contacts, Companies, Deals pipeline)
- Basic telephony integration (call routing only)

**Phase 2: Core Operations (Weeks 5-10)**
- Complete Deal card customization (all fields)
- Product catalog and inventory structure setup
- Invoice/Estimate templates configuration
- Payment gateway integration
- Data migration from Workiz (clients, products, historical deals)

**Phase 3: Advanced Features (Weeks 11-14)**
- Interactive dispatch map implementation
- Advanced telephony features (call masking, AI transcription)
- Inventory barcode workflows
- Commission report development
- Google Workspace integration

**Phase 4: Communications & Training (Weeks 15-16)**
- Flock/WhatsApp data migration
- Internal messenger setup
- User training (role-specific sessions)
- Parallel running with Workiz

**Phase 5: Go-Live & Optimization (Week 17+)**
- Full cutover from Workiz
- Hypercare support period
- Issue resolution and optimization
- Decommission legacy systems

### Data Migration Plan

**Data Extraction:**
- Export all entities from Workiz (API or CSV export)
- Flock API export (messages, files, users)
- WhatsApp export (method TBD by integrator)

**Data Transformation:**
- Map Workiz fields to Bitrix24 custom fields
- Normalize phone numbers and addresses
- Filter and clean historical data

**Data Loading:**
- Import clients (Companies and Contacts)
- Import product catalog
- Import historical deals (preserve statuses and dates)
- Import selected chat histories

**Validation:**
- Record count reconciliation
- Spot-check critical customer records
- Verify relationship preservation (Company → Contacts → Deals)

### Risk Mitigation

**Risk:** Data loss during migration
**Mitigation:** Full backup before migration, phased migration with validation checkpoints

**Risk:** User adoption resistance
**Mitigation:** Role-specific training, super-user identification, extensive documentation

**Risk:** Business disruption during cutover
**Mitigation:** Weekend go-live, parallel running period, rollback plan

**Risk:** Integration failures (telephony, payments)
**Mitigation:** Sandbox testing, phased rollout, vendor SLA agreements

---

## Success Criteria

### Functional Acceptance Criteria

**Telephony:**
- [ ] All inbound calls route correctly to available dispatchers
- [ ] Pop-up displays caller information and source data
- [ ] Call recording capture rate ≥99%
- [ ] Call masking works for all technician-client communications

**Deal Management:**
- [ ] Deal pipeline matches Workiz stages exactly
- [ ] All custom fields display and save correctly
- [ ] Role-based permissions enforce correctly (tested per role)
- [ ] Tag filtering works in Deal list view

**Invoicing & Payments:**
- [ ] Invoice PDF matches provided template
- [ ] Digital signature captures on mobile device
- [ ] Payment gateway processes all payment types
- [ ] Tax calculation applies correct rates by service area

**Inventory:**
- [ ] Barcode scanning adds items to Deal and deducts from container
- [ ] Transfer orders move inventory correctly
- [ ] Stocktaking variance report generates accurately
- [ ] Real-time inventory visibility for all managers

**Dispatch:**
- [ ] Map displays all unassigned jobs and technician locations
- [ ] Job assignment updates technician's schedule
- [ ] GPS tracking updates in real-time (≤2 minute delay)
- [ ] Smart filtering shows only qualified technicians

**Reporting:**
- [ ] Commission Report calculations match provided formula
- [ ] Report exports to CSV/XLSX without data loss
- [ ] Technician view hides sensitive company financial data

**Communications:**
- [ ] Migrated chat histories searchable and complete
- [ ] Audio/video calls record and save to cloud
- [ ] Gmail integration allows Deal creation from email

### Performance Metrics

- Page load time: <3 seconds for Deal card
- Mobile app responsiveness: <2 seconds for actions
- Call connection time: <5 seconds
- GPS location update frequency: ≤2 minutes
- Report generation time: <10 seconds for standard reports

### Migration Success Metrics

- Data migration accuracy: 100% of active clients
- Historical deal migration: ≥95% of last 24 months
- User account creation: 100% of active employees
- Training completion: 100% of users by role

---

## Project Constraints

### Technical Constraints

- Must use Bitrix24 on-premise (self-hosted) deployment
- Requires dedicated server infrastructure or cloud hosting (AWS/Azure/GCP)
- Must maintain compatibility with Google Workspace
- Mobile app must work on iOS and Android
- Must support US-based payment gateways
- Must comply with US data privacy regulations (PCI-DSS for payments)
- Server infrastructure must support multi-office access (USA, Ukraine, Georgia)

### Business Constraints

- Zero downtime for customer-facing operations
- No increase in per-job processing time for technicians
- Budget: [To be defined in RFP]
- Timeline: Target 16-20 week implementation
- Language support: English (US), Ukrainian, Georgian (for internal team)

### Scope Exclusions (for Initial Phase)

- ❌ Advanced workflow automation (robots/triggers)
- ❌ Custom mobile app development (use native Bitrix24 app)
- ❌ Predictive analytics and AI recommendations
- ❌ Customer self-service portal
- ❌ Integration with accounting systems (QuickBooks, etc.)

**Note:** Excluded items may be considered for future phases.

---

## Next Steps

### For Integration Partners

**1. Review Detailed Technical Requirements**
   - Read all documents in [docs/tr/](docs/tr/) for module-specific requirements
   - Review complete Block descriptions in [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md)

**2. Prepare Questions and Clarifications**
   - Submit questions in writing for discovery session
   - Identify any ambiguous or conflicting requirements

**3. Conduct Discovery Session**
   - Schedule 2-3 hour session with stakeholders
   - Demonstrate understanding through system walkthroughs
   - Validate proposed technical approach

**4. Submit Proposal**
   - Detailed implementation plan with timeline
   - Bitrix24 plan/edition recommendation with justification
   - Integration approach for telephony and payment gateway
   - Data migration strategy
   - Pricing breakdown by phase/block
   - Team composition and key personnel CVs
   - Reference implementations (similar projects)

**5. Proof of Concept (optional)**
   - If requested, prepare POC for critical features:
     - Interactive dispatch map
     - Call masking workflow
     - Commission report calculation

### For Internal Team

**1. Prepare for Discovery**
   - Compile current system access credentials
   - Export sample data from Workiz
   - Identify super-users for each functional area
   - Document any undocumented workflows

**2. Stakeholder Alignment**
   - Review and approve PRD with all department heads
   - Identify change champions in each role (Dispatcher, Technician, Manager)
   - Define success metrics and KPIs

**3. Infrastructure Preparation**
   - Confirm Google Workspace admin access
   - Prepare list of current integrations and API keys
   - Identify test users for UAT

---

## Appendices

### Appendix A: Glossary

- **Deal:** Bitrix24 entity representing a job/service request
- **Container:** Virtual warehouse representing technician's van inventory
- **Call Masking:** Proxy number system to hide client phone numbers from technicians
- **Metro Area:** Geographic service region (used for routing and tax calculation)
- **Job Source:** Advertising source/campaign that generated the lead
- **Work Order (WO):** Formal job request document from commercial/government clients
- **Platinum Client:** High-value commercial or government client with special workflow

### Appendix B: Technical Requirements Documentation

This PRD provides high-level business requirements and system architecture. Detailed technical specifications for implementation are provided in separate documents organized by functional area.

**Master Requirements Document:**
- [docs/00_drafts/TR-Workiz.md](docs/00_drafts/TR-Workiz.md) - Complete technical requirements for all 12 blocks

**Detailed Technical Specifications (21 files):**

**Epic 1: Telephony Integration** - 6 stories:
1. [Story 1.01: Inbound Call Routing](docs/tr/1.01-telephony-inbound-calls.md) - Call distribution, CRM pop-up, Deal creation, draft auto-save
2. [Story 1.02: Outbound Calls & Masking](docs/tr/1.02-telephony-outbound-calls-masking.md) - Extension-based masking, caller ID by metro area
3. [Story 1.03: SMS Integration](docs/tr/1.03-telephony-sms-integration.md) - Two-way SMS, Deal timeline logging, metro-based routing
4. [Story 1.04: Call Recording & Monitoring](docs/tr/1.04-telephony-call-recording-monitoring.md) - Hybrid storage strategy, whisper mode, AI transcription
5. [Story 1.05: Missed Calls Interface](docs/tr/1.05-telephony-missed-calls-interface.md) - Persistent notifications, callback workflows
6. [Story 1.06: Call Control & Log](docs/tr/1.06-telephony-call-control-call-log.md) - Transfer, conference, hold, call log filtering

**Epic 5: Inventory Management** - 8 stories:
1. [Story 5.01: Product Catalog](docs/tr/5.01-inventory-product-catalog.md) - Two-catalog architecture (Products vs Services), hierarchical categories, bulk import
2. [Story 5.02: Warehouse Setup](docs/tr/5.02-inventory-warehouse-setup.md) - Multi-warehouse structure, technician containers, access controls
3. [Story 5.03: Receiving Workflows](docs/tr/5.03-inventory-receiving.md) - Barcode-driven receiving, direct-to-tech shipments
4. [Story 5.04: Transfer Orders](docs/tr/5.04-inventory-transfers.md) - Warehouse↔Container, Container↔Container, approval workflows
5. [Story 5.05: Deal Integration](docs/tr/5.05-inventory-deal-integration.md) - Barcode deduction from jobs, three-tier pricing enforcement
6. [Story 5.06: Stocktaking](docs/tr/5.06-inventory-stocktaking.md) - Blind count process, variance reporting, inventory freeze
7. [Story 5.07: Mobile Workflows](docs/tr/5.07-inventory-mobile-workflows.md) - Mobile barcode scanning, technician app workflows
8. [Story 5.08: Inventory Reporting](docs/tr/5.08-inventory-reporting.md) - Movement history, stock levels, usage reports, sales velocity

**Epic 10: Payment Gateway Integration** - 7 stories:
1. [Story 10.01: Stripe Core Setup](docs/tr/10.01-payment-stripe-core-setup.md) - Stripe account configuration, webhook architecture, API integration
2. [Story 10.02: Invoice Generation](docs/tr/10.02-payment-invoice-generation.md) - Invoice template, digital signature, PDF generation
3. [Story 10.03: Service Fee Automation](docs/tr/10.03-payment-service-fee-automation.md) - 3.5% surcharge on card payments, calculation logic
4. [Story 10.04: Refunds & Disputes](docs/tr/10.04-payment-refunds-disputes.md) - Refund workflows, dispute pipeline, chargeback handling
5. [Story 10.05: Late Payment Fees](docs/tr/10.05-payment-late-fees.md) - Auto-calculation, state-based rates, overdue tracking
6. [Story 10.06: Sunbit Financing](docs/tr/10.06-payment-sunbit-financing.md) - Installment payment integration, approval workflow
7. [Story 10.07: Tap to Pay](docs/tr/10.07-payment-tap-to-pay.md) - Mobile device as terminal, in-person payment workflows

**Usage Instructions for Integrators:**
- Read this PRD first for business context and system overview
- Reference TR-Workiz.md for complete block-by-block requirements
- Each Block = Epic, each Epic contains Stories (technical requirement files)
- Story numbering: Epic#.Story# (e.g., 1.01 = Epic 1, Story 1)
- Each Story file includes: technical requirements, data models, workflows, API specifications, and acceptance criteria

### Appendix C: Contact Information

**Project Sponsor:** [To be added]
**Technical Lead:** [To be added]
**Workiz Super-User:** [To be added]
**Integration Partner Contact:** [To be provided]

---

## Document Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Business Owner | | | |
| Project Sponsor | | | |
| Technical Lead | | | |
| Operations Manager | | | |

---

**End of Document**

*This PRD is a living document and will be updated as requirements are refined during discovery and implementation phases.*
