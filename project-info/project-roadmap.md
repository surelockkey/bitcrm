# Locksmith Business Platform — Project Roadmap

**Complete custom platform replacing Workiz — built for multi-state locksmith operations**

**Total Duration: 6 Months**

---

```
  Month 1        Month 2        Month 3        Month 4        Month 5        Month 6
 ┌──────────────────────────┬───────────────────────┬────────────────┬────────────────┬─────────┐
 │       PHASE 1            │       PHASE 2         │    PHASE 3     │    PHASE 4     │ PHASE 5 │
 │     Core Platform        │   Extended Features   │ First Live Tests│Migration & Tools│ Rollout│
 │       8 weeks            │       6 weeks         │    4 weeks     │    4 weeks     │  2 wk+  │
 └──────────────────────────┴───────────────────────┴────────────────┴────────────────┴─────────┘
          ▲                          ▲                      ▲                ▲              ▲
     Internal Demo           Full Dispatch Flow      First Real Jobs   Data Migrated   Workiz Off
```

---

## Phase 1 — Core Platform

**Duration:** 8 weeks (Month 1 — Month 2)

> Build the foundation — user accounts, client management, deal pipeline, technician management, and inventory system. The core of daily operations.

### Deliverables

**1. Users & Permissions**
- 5 roles: Super Admin, Admin, Department Manager, Dispatcher, Technician
- Department-based access control — managers see only their department
- Technicians see only their own assigned deals
- User creation via email invitation, deactivation without data loss

**2. Client Management (CRM)**
- Contacts (people) and Companies with linking
- Phone-based search and lookup
- Auto-create client when creating a deal with a new phone number
- Duplicate detection with merge/dismiss workflow

**3. Deal Pipeline**
- Full deal lifecycle with 13 stages across 4 groups (Submitted → In Progress → Pending → Closed)
- Role-based stage transitions — technicians can only update their own job progress
- Activity timeline — auto-logs every change (who did what, when)
- Priority levels, tags, internal and client-facing notes

**4. Smart Technician Assignment**
- Shows qualified techs ranked by distance and availability
- Filters by skill match and service area
- Shows inventory availability — does the tech have the needed parts?
- One-click assignment with automatic stage update

**5. Technician Profiles**
- Home address and location calculation (home or last job of the day)
- Skills with manager approval workflow
- Service areas, commission configuration
- Personal inventory container (their van)

**6. Inventory System**
- Product catalog with 3-tier pricing (company cost, tech cost, client price)
- Central warehouses and per-technician containers
- Stock receive, transfer between locations
- Auto-deduct when tech adds products to a deal

> **Milestone:** Internal demo — complete deal flow from client call to job completion

---

## Phase 2 — Extended Features

**Duration:** 6 weeks (Month 3 — Month 4)

> Add telephony, mobile access for technicians in the field, and a live dispatch map — the tools that make real-time operations possible.

### Deliverables

**1. Telephony**
- Inbound and outbound calls via integrated phone system
- Call recording and call log history
- IVR routing — automatic call distribution to the right department
- Auto-popup of client info when a known number calls
- Call logs linked directly to deals and client profiles

**2. Mobile App (Technician)**
- View assigned jobs for the day in order
- Update job status (En Route → On Site → Work In Progress → etc.)
- Add products to deal via barcode scan
- Navigate to job address with one tap
- View job history and past notes

**3. Dispatch Map**
- Live map showing all technician locations and open deals
- Visual assignment — see who's closest and available
- Route visualization between tech and deal
- Area coverage view by service zone

> **Milestone:** Full dispatch workflow — call comes in, deal created, tech assigned on map, tech completes via mobile app

---

## Phase 3 — First Live Tests

**Duration:** 4 weeks (Month 4 — Month 5)

> Enable payments, invoicing, scheduling, and premium service flows. Run first real operations on the platform with a pilot team.

### Deliverables

**1. Invoices & Payments**
- Auto-generate invoices from deal products and services
- Payment terms and tracking
- Stripe integration for card payments
- Support for other payment methods (cash, check, financing)

**2. Scheduling**
- Calendar view per technician
- Time slot management and conflict detection
- Drag-to-reschedule with automatic notifications
- Recurring job support

**3. Platinum Flows**
- Premium service workflows for priority customers
- Membership plan management
- Priority routing and automated follow-ups

**4. Pilot Testing**
- One department runs live operations on the new platform
- Real-time bug fixes and performance tuning
- UX refinements based on actual dispatcher and technician feedback

> **Milestone:** First real jobs processed end-to-end on the new platform

---

## Phase 4 — Migration & Internal Tools

**Duration:** 4 weeks (Month 5 — Month 6)

> Migrate all historical data from Workiz, build internal communication and analytics tools. Prepare for full company switch.

### Deliverables

**1. Workiz Data Migration**
- Full export: clients, deals, job history, invoices, inventory records
- Data cleaning and mapping to new system structure
- Validation reports — verify every record migrated correctly
- Reconciliation: totals match between old and new system

**2. Internal Communication**
- In-app messaging between dispatchers and technicians
- Deal-linked conversations — discussion threads attached to specific jobs
- Push notifications for assignments, status updates, messages

**3. Analytics & Reports**
- Revenue dashboards — daily, weekly, monthly
- Technician performance — jobs completed, ratings, response times
- Deal conversion rates by source, job type, area
- Inventory usage reports and stock level alerts

**4. Admin Tools**
- System configuration and customization
- Audit logs — track all admin actions
- Custom fields for deals and contacts

> **Milestone:** All Workiz data migrated and verified, all departments trained

---

## Phase 5 — Full Rollout & Support

**Duration:** 2 weeks transition + ongoing support (Month 6 →)

> Complete company migration — all departments switch from Workiz to the new platform. Ongoing support, monitoring, and iterative improvements.

### Deliverables

**1. Company-Wide Rollout**
- Department-by-department go-live schedule
- Parallel running period — both systems active for safety
- Final cutover from Workiz

**2. Training & Onboarding**
- Role-specific training sessions (dispatcher, technician, manager, admin)
- Documentation and quick-reference guides
- Video walkthroughs for common workflows

**3. Ongoing Support & Maintenance**
- Bug fixes and performance optimization
- Feature refinements based on live usage feedback
- System monitoring and uptime guarantees

> **Milestone:** Workiz fully decommissioned — all operations running on the new platform

---

## Project Summary

| | |
|---|---|
| **Total Duration** | 6 months |
| **Phases** | 5 |
| **Major Deliverables** | 19 |
| **Key Milestones** | 5 |

---

### Milestone Timeline

```
 Month 1   Month 2   Month 3   Month 4   Month 5   Month 6
   │         │         │         │         │         │
   │         ◆─────────│─────────│─────────│─────────│── Internal Demo
   │         │         │    ◆────│─────────│─────────│── Full Dispatch Flow
   │         │         │         │    ◆────│─────────│── First Real Jobs Live
   │         │         │         │         │    ◆────│── Data Migrated
   │         │         │         │         │         ◆── Workiz Decommissioned
```

---

*Confidential — Locksmith Business Platform Project Roadmap*
