# Step 1: MVP — "Manage Deals Without Calls"

**Duration:** 4 weeks
**Goal:** Dispatchers create and manage deals in the new system. Calls stay on Workiz.
**Team:** Tech Lead + 1-2 Backend + 1 Frontend
**Depends on:** Step 0 complete (ECS, DynamoDB, Redis, Cognito, CI/CD all working)

---

## What gets built

```
CRM Service          Deal Service          Frontend (Vercel)
───────────          ────────────          ─────────────────
Contacts CRUD        Deal CRUD             Deal list (pipeline view)
Companies CRUD       Pipeline stages       Deal detail page
Phone search         50+ custom fields     Create Deal form
Client types         Timeline              Contact search
Company→Contact      Tags                  Filters (status, tag, date, tech)
  hierarchy          Cancellation reasons   Activity timeline
Duplicate detection  Stage permissions      Contact/Company views
Delete protection
```

**NOT in Step 1:** Email integration (Step 4), dispatch map (Step 2), call widgets (Step 3), invoicing (Step 2), mobile app (Step 2), advanced merge with rollback (Step 5), field-level permissions (Step 4), automation/robots.

---

## EPIC 1.1 — CRM Service: Contacts

**Duration:** ~4 days
**Owner:** Backend

### Story 1.1.1 — Contact CRUD

**As a** dispatcher
**I want** to create, view, edit, and search contacts
**So that** I can manage client information and link them to deals

**API endpoints:**

```
POST   /api/crm/contacts              Create contact
GET    /api/crm/contacts/:id          Get contact by ID
PUT    /api/crm/contacts/:id          Update contact
GET    /api/crm/contacts              List contacts (paginated, with filters)
GET    /api/crm/contacts/search       Search by phone or name
DELETE /api/crm/contacts/:id          Soft delete (archive)
```

**Tasks:**

| Task | Done when |
|------|-----------|
| Contact data model (TypeScript types) | Interface with all fields defined |
| Create contact handler | POST creates item in DynamoDB CRM table. Returns created contact |
| Phone normalization to E.164 | All phones stored as `+1XXXXXXXXXX`. Util in shared package |
| Phone uniqueness check on create | If phone exists (GSI lookup) → return existing contact, don't create duplicate |
| Get contact by ID | Returns full contact record |
| Update contact | PUT updates fields. Cannot change phone to one that already exists on another contact |
| List contacts (paginated) | DynamoDB scan with pagination cursor. Default sort: created date desc. Limit 25 |
| Search by phone | GSI query `PHONE#<normalized>` → returns matching contacts. Partial match: starts-with |
| Search by name | Query with `begins_with` on name field. Case-insensitive (store lowercase copy) |
| Soft delete (archive) | Sets `status: archived`. Archived contacts excluded from search/list by default |
| Delete protection | Only `admin` / `super_admin` can archive. Contacts linked to active deals cannot be archived |
| Redis cache on read | Cache contact by ID (TTL 5min). Invalidate on update |
| Unit tests | CRUD operations, phone normalization, duplicate check, delete protection |

**Contact data model:**

```typescript
interface Contact {
  id: string;                    // UUID
  firstName: string;             // required
  lastName: string;              // required
  phones: Phone[];               // at least 1 required
  emails: string[];              // optional
  clientType: 'residential' | 'commercial' | 'government';
  companyId?: string;            // link to company
  address?: Address;
  source?: string;               // "Google Ads", "Referral", "Walk-in", etc.
  notes?: string;
  status: 'active' | 'archived';
  createdBy: string;             // user ID
  createdAt: string;             // ISO
  updatedAt: string;
}

interface Phone {
  number: string;                // E.164: +12025551234
  type: 'mobile' | 'home' | 'work' | 'other';
  isPrimary: boolean;
}
```

**DynamoDB access patterns:**

```
Create contact:     PutItem  PK=CONTACT#<id>, SK=METADATA
                    PutItem  PK=CONTACT#<id>, SK=PHONE#<number>  (for each phone)
                    PutItem  GSI1: PK=PHONE#<number>, SK=CONTACT#<id>  (reverse lookup)

Get by ID:          GetItem  PK=CONTACT#<id>, SK=METADATA

Search by phone:    Query    GSI1: PK=PHONE#<number>

List contacts:      Scan with filter (or GSI if filtered by specific attribute)

Link to company:    PutItem  PK=COMPANY#<companyId>, SK=CONTACT#<id>
```

---

### Story 1.1.2 — Client Type Classification

**As a** dispatcher
**I want** to classify contacts as Residential, Commercial, or Government
**So that** pricing and workflows can differ by client type

**Tasks:**

| Task | Done when |
|------|-----------|
| `clientType` field on contact model | Enum: `residential`, `commercial`, `government`. Default: `residential` |
| Set on create / update | Dropdown in API request body |
| Filter contacts by client type | Query parameter `?clientType=commercial` |
| Commercial/Government → require company link | Validation: if `commercial` or `government`, `companyId` must be set |

---

### Story 1.1.3 — Auto-Create Contact from Deal Form

**As a** dispatcher
**I want** a contact to be auto-created when I type a new phone number in the Deal form
**So that** I don't have to manually create contacts before creating deals

**Tasks:**

| Task | Done when |
|------|-----------|
| Phone search in Deal form | Frontend: as dispatcher types phone → debounced search `/api/crm/contacts/search?phone=...` |
| Existing contact found → auto-link | If match → show contact name, allow select. Pre-fill address from contact |
| No match → inline create | Show inline fields: First Name, Last Name (required). On Deal save → create contact first, then link to deal |
| Created contact defaults | `clientType: residential`, `source: 'manual'`, `status: active` |

---

## EPIC 1.2 — CRM Service: Companies

**Duration:** ~2 days
**Owner:** Backend

### Story 1.2.1 — Company CRUD

**As a** manager
**I want** to manage company records with linked contacts
**So that** commercial and government clients have proper organizational structure

**API endpoints:**

```
POST   /api/crm/companies             Create company
GET    /api/crm/companies/:id         Get company (with linked contacts)
PUT    /api/crm/companies/:id         Update company
GET    /api/crm/companies             List companies (paginated)
GET    /api/crm/companies/search      Search by name
POST   /api/crm/companies/:id/contacts/:contactId   Link contact to company
DELETE /api/crm/companies/:id/contacts/:contactId   Unlink contact
DELETE /api/crm/companies/:id         Soft delete
```

**Tasks:**

| Task | Done when |
|------|-----------|
| Company data model | Name (required), address, phone, email, type, tax ID, notes |
| Create company | PutItem in CRM table. PK=COMPANY#<id>, SK=METADATA |
| Get company with contacts | GetItem company + Query PK=COMPANY#<id>, SK=begins_with(CONTACT#) |
| Link contact to company | PutItem PK=COMPANY#<id>, SK=CONTACT#<contactId>. Update contact's `companyId` |
| Unlink contact | DeleteItem relationship. Clear contact's `companyId` |
| Search by company name | Scan with filter (or secondary index if volume justifies it) |
| Soft delete company | Only if no active deals linked to any of its contacts. Admin+ only |
| Unit tests | CRUD, link/unlink, delete protection |

**Company data model:**

```typescript
interface Company {
  id: string;
  name: string;                  // required
  phone?: string;
  email?: string;
  address?: Address;
  type: 'commercial' | 'government';
  taxId?: string;                // for tax-exempt (Platinum, Step 4)
  notes?: string;
  status: 'active' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## EPIC 1.3 — CRM Service: Duplicate Detection

**Duration:** ~2 days
**Owner:** Backend

### Story 1.3.1 — Duplicate Detection (Basic)

**As a** manager
**I want** to see potential duplicate contacts
**So that** I can keep the CRM clean

Simplified for Step 1 — no auto-merge, no rollback. Just detection + manual merge.

**API endpoints:**

```
GET    /api/crm/duplicates                   List potential duplicates (paginated)
POST   /api/crm/duplicates/:id/dismiss       Dismiss a duplicate pair (not a duplicate)
POST   /api/crm/contacts/merge               Merge two contacts (admin+ only)
```

**Tasks:**

| Task | Done when |
|------|-----------|
| Duplicate detection on contact create | When creating contact: check phone match (exact). If found → return warning + existing contact ID. Don't block create |
| Nightly duplicate scan job (BullMQ) | Scheduled job: scan all contacts, find exact phone matches across different contact records. Store results in DynamoDB |
| Duplicate pair data model | `PK=DUPLICATE#<id>`, `SK=METADATA`. Fields: `contactA`, `contactB`, `matchType` (phone/email), `confidence` (high/medium), `status` (pending/dismissed/merged) |
| List duplicates endpoint | Returns pending duplicate pairs for manager review |
| Dismiss duplicate | Manager marks a pair as "not a duplicate" → status: dismissed |
| Merge contacts (basic) | Admin picks primary contact. Secondary contact's phones/emails added to primary. All deals re-linked to primary. Secondary archived. No rollback in Step 1 |
| Unit tests | Detection logic, merge, re-linking deals |

**What's deferred to Step 5:**
- Fuzzy name matching (Levenshtein)
- Confidence scoring (medium/low)
- 30-day rollback
- Bulk merge

---

## EPIC 1.4 — Permissions

**Duration:** ~2 days
**Owner:** Backend (shared middleware + deal/crm validation)

### Story 1.4.1 — Role-Based Access Control

**As a** admin
**I want** each user to have appropriate access based on their role
**So that** technicians can't see other people's deals and dispatchers can't delete records

Already partially done in Step 0 (Cognito custom claims + auth middleware). Step 1 adds the enforcement logic in CRM and Deal services.

**Tasks:**

| Task | Done when |
|------|-----------|
| User management API | `POST /api/users` (super_admin only) — creates Cognito user with role. `GET /api/users` — list users. `PUT /api/users/:id` — update role/department. `DELETE /api/users/:id` — disable user |
| Role enforcement in CRM | Contacts: everyone can view. Create: dispatcher+. Edit: dispatcher+. Archive: admin+. Merge: admin+ |
| Role enforcement in Deals | See Story 1.5.5 (deal stage permissions) |
| Technician data isolation | When `role=technician`: all deal queries auto-filter by `TECH#<userId>` GSI. Cannot see other techs' deals |
| Department scoping (basic) | Department managers see deals within their department only. Filter by `custom:department` claim |

**Permission matrix (Step 1):**

```
                     Super Admin   Admin   Dept Manager   Dispatcher   Technician
─────────────────────────────────────────────────────────────────────────────────
Contacts: View       ✓             ✓       ✓              ✓            own deals only
Contacts: Create     ✓             ✓       ✓              ✓            ✗
Contacts: Edit       ✓             ✓       ✓              ✓            ✗
Contacts: Archive    ✓             ✓       ✗              ✗            ✗
Contacts: Merge      ✓             ✓       ✗              ✗            ✗

Companies: View      ✓             ✓       ✓              ✓            ✗
Companies: Create    ✓             ✓       ✓              ✗            ✗
Companies: Edit      ✓             ✓       ✓              ✗            ✗

Deals: View          all           all     department     all          own only
Deals: Create        ✓             ✓       ✓              ✓            ✗
Deals: Edit          ✓             ✓       ✓              ✓            own only
Deals: Change Stage  all stages    all     all            all          limited
Deals: Delete        ✓             ✓       ✗              ✗            ✗

Users: Manage        ✓             ✗       ✗              ✗            ✗
```

---

## EPIC 1.5 — Deal Service

**Duration:** ~6 days
**Owner:** Backend

### Story 1.5.1 — Deal CRUD

**As a** dispatcher
**I want** to create, view, edit, and manage deals
**So that** I can track every job from start to finish

**API endpoints:**

```
POST   /api/deals                     Create deal
GET    /api/deals/:id                 Get deal (full detail + timeline)
PUT    /api/deals/:id                 Update deal fields
GET    /api/deals                     List deals (paginated, filtered)
DELETE /api/deals/:id                 Soft delete (admin+ only)
```

**Tasks:**

| Task | Done when |
|------|-----------|
| Deal data model (TypeScript) | All 50+ fields defined as interface (see below) |
| Create deal | PutItem in Deals table. Auto-set stage to first stage ("New Lead"). Add timeline entry "Deal created" |
| Link contact on create | Required: `contactId`. Validate contact exists in CRM service (internal HTTP call via Cloud Map) |
| Auto-create contact if new | If `contactId` not provided but `phone` + `firstName` + `lastName` given → call CRM service to create, then link |
| Get deal by ID | Returns deal metadata + timeline (Query PK=DEAL#<id>, SK=begins_with(METADATA) and SK=begins_with(TIMELINE#)) |
| Update deal fields | Partial update (only changed fields). Add timeline entry "Field X changed from A to B" |
| List deals (pipeline view) | Query GSI1 by status. Support filters: `?status=`, `?techId=`, `?dispatcherId=`, `?tag=`, `?dateFrom=`, `?dateTo=`, `?jobType=` |
| Pagination | DynamoDB cursor-based. Return `cursor` + `hasMore` |
| Soft delete | Sets `status: deleted`. Admin+ only. Add timeline entry |
| Redis cache on read | Cache deal by ID (TTL 5min). Invalidate on update |
| Unit tests | CRUD, filters, pagination, contact linking |

**Deal data model:**

```typescript
interface Deal {
  id: string;
  dealNumber: number;               // auto-increment (atomic counter in DynamoDB)

  // Client block
  contactId: string;                 // required — link to CRM contact
  companyId?: string;                // if commercial/government
  clientType: 'residential' | 'commercial' | 'government';

  // Schedule block
  scheduledDate?: string;            // ISO date
  scheduledTimeSlot?: string;        // "9:00-12:00", "12:00-15:00", etc.
  serviceArea: string;               // "Atlanta Metro", "Miami-Dade", etc.
  address: Address;

  // Job block
  jobType: string;                   // "Lockout", "Rekey", "Lock Installation", etc.
  stage: string;                     // current pipeline stage
  assignedTechId?: string;
  assignedDispatcherId?: string;
  priority: 'normal' | 'urgent';
  tags: string[];                    // ["VIP", "Callback", "Warranty", etc.]

  // Custom info
  source?: string;                   // "Google Ads", "Referral", "Yelp", etc.
  notes?: string;
  internalNotes?: string;            // not visible to technician
  cancellationReason?: string;       // required when moving to canceled stage

  // Financial (read-only in Step 1, populated in Step 2)
  estimatedTotal?: number;
  actualTotal?: number;
  paymentStatus?: string;

  // Metadata
  status: 'active' | 'deleted';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Address {
  street: string;
  unit?: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
}
```

---

### Story 1.5.2 — Pipeline & Stages

**As a** dispatcher
**I want** deals organized in a pipeline with logical stage groups
**So that** I can see the status of all jobs at a glance

**Tasks:**

| Task | Done when |
|------|-----------|
| Define pipeline stages | Stored in DynamoDB (or hardcoded config). Grouped into 4 categories |
| Stage transition validation | Service validates: can only move to allowed next stages (not skip arbitrarily) |
| Stage change → timeline entry | "Stage changed from X to Y by User at timestamp" |
| Cancellation requires reason | Moving to "Canceled" stage requires `cancellationReason` field |
| Closed stages are terminal | Once in "Completed" or "Canceled" — cannot move back (except admin override) |

**Pipeline stages:**

```
SUBMITTED (group):
  ├── New Lead                (initial — auto-assigned on deal create)
  ├── Estimate Sent           (dispatcher sent estimate)
  └── Approved                (client approved, ready for scheduling)

IN PROGRESS (group):
  ├── Assigned                (technician assigned)
  ├── En Route                (tech on the way)
  ├── On Site                 (tech arrived)
  └── Work In Progress        (tech doing the job)

PENDING (group):
  ├── Pending Payment         (work done, waiting for payment)
  ├── Pending Parts           (needs parts, paused)
  ├── Follow Up               (needs follow-up call/visit)
  └── On Hold                 (paused for other reason)

CLOSED (group):
  ├── Completed               (done, paid) — terminal
  └── Canceled                (canceled, requires reason) — terminal
```

**Allowed transitions (simplified):**

```
New Lead → Estimate Sent, Approved, Assigned, Canceled
Estimate Sent → Approved, Canceled, Follow Up
Approved → Assigned, Canceled
Assigned → En Route, On Hold, Canceled
En Route → On Site, Canceled
On Site → Work In Progress, Pending Parts, Canceled
Work In Progress → Pending Payment, Pending Parts, Follow Up, Completed
Pending Payment → Completed, Follow Up
Pending Parts → Assigned (when parts arrive)
Follow Up → any non-terminal
On Hold → any non-terminal
Admin → can move between any stages
```

---

### Story 1.5.3 — Deal Tags

**As a** dispatcher
**I want** to tag deals with labels
**So that** I can filter and organize deals by category

**Tasks:**

| Task | Done when |
|------|-----------|
| Tags field on deal model | Array of strings: `["VIP", "Callback", "Warranty"]` |
| Add/remove tags via deal update | PUT request with updated tags array |
| Filter deals by tag | `GET /api/deals?tag=VIP` — filters deals containing this tag |
| Predefined tag list | Stored in config. Dispatchers select from predefined list. Admins can add new tags |
| Multiple tags per deal | A deal can have multiple tags |

**Default tags:**

```
VIP, Callback, Warranty, Repeat Customer, Emergency,
Insurance Claim, Commercial, Residential, Government,
Complaint, Follow Up Required
```

---

### Story 1.5.4 — Activity Timeline

**As a** dispatcher
**I want** to see a chronological log of everything that happened on a deal
**So that** I can understand the full history

**Tasks:**

| Task | Done when |
|------|-----------|
| Timeline data model | PK=DEAL#<id>, SK=TIMELINE#<iso-timestamp>#<uuid>. Fields: `type`, `message`, `userId`, `meta` |
| Auto-add on deal create | "Deal created by {user}" |
| Auto-add on stage change | "Stage changed: {old} → {new} by {user}" |
| Auto-add on field edit | "Field '{field}' updated by {user}" (no old/new values for simplicity) |
| Auto-add on tech assignment | "Assigned to {tech name} by {user}" |
| Manual note | POST `/api/deals/:id/notes` — user adds text note to timeline |
| Get timeline | Included in `GET /api/deals/:id` response. Sorted by timestamp desc |
| Pagination for timeline | If deal has >50 entries → paginate. `GET /api/deals/:id/timeline?cursor=` |

**Timeline entry types:**

```
created, stage_changed, field_updated, tech_assigned,
note_added, contact_linked, tag_added, tag_removed
```

Step 2+ adds: `invoice_created`, `payment_received`, `sms_sent`, `call_recorded`, etc.

---

### Story 1.5.5 — Deal Stage Permissions

**As a** admin
**I want** deal stage transitions restricted by role
**So that** technicians can only update their own deals to certain stages

**Tasks:**

| Task | Done when |
|------|-----------|
| Stage permission config | Map of `role → allowed stage transitions` |
| Validate on stage change | Before updating stage → check user role against allowed transitions |
| Technician restrictions | Can only move own deals: `Assigned → En Route → On Site → Work In Progress → Pending Payment`. Cannot move to Completed or Canceled |
| Dispatcher permissions | Can move to all stages except can't reopen Completed deals |
| Admin override | Admin/Super Admin can move between any stages |
| 403 on unauthorized transition | Clear error: "Technicians cannot move deals to Completed stage" |

---

### Story 1.5.6 — Deal Assignment

**As a** dispatcher
**I want** to assign a technician to a deal
**So that** the tech knows which jobs to do

**Tasks:**

| Task | Done when |
|------|-----------|
| Assign tech endpoint | `PUT /api/deals/:id` with `assignedTechId`. Or dedicated `POST /api/deals/:id/assign` |
| Validate tech exists | Check Cognito user exists and has `role=technician` |
| Auto-move to "Assigned" stage | If deal is in Submitted group and tech is assigned → auto-move to "Assigned" |
| Timeline entry | "Assigned to {tech name} by {dispatcher}" |
| Reassign | Changing `assignedTechId` → timeline: "Reassigned from {old} to {new}" |
| DynamoDB GSI update | Deal appears in tech's GSI3 query results |
| Redis pub/sub | Publish deal update event on `channel:deal-updates` |

---

## EPIC 1.6 — Data Migration (Workiz Import)

**Duration:** ~3 days
**Owner:** Backend + Tech Lead

### Story 1.6.1 — Import Contacts from Workiz

**As a** admin
**I want** all existing contacts imported from Workiz
**So that** dispatchers don't have to re-enter client data

**Tasks:**

| Task | Done when |
|------|-----------|
| Export contacts from Workiz | CSV/JSON export of all clients |
| Write migration script | Node.js script: reads export → transforms → batch writes to DynamoDB CRM table |
| Phone normalization | All phones converted to E.164 during import |
| Client type mapping | Map Workiz client types → our enum |
| Dedup during import | Skip if phone already exists in DynamoDB |
| Company creation | Group commercial clients by company name → create Company records → link contacts |
| Validation report | Script outputs: total imported, skipped (duplicates), errors, with line numbers |
| Dry run mode | `--dry-run` flag → validates without writing |

### Story 1.6.2 — Import Deals from Workiz

**As a** admin
**I want** historical deals imported
**So that** dispatchers have context on past jobs

**Tasks:**

| Task | Done when |
|------|-----------|
| Export deals from Workiz | CSV/JSON export of deals (last 24 months) |
| Field mapping document | Spreadsheet: Workiz field name → our field name. Signed off by business |
| Write migration script | Reads export → maps fields → links to imported contacts (by phone) → batch writes to DynamoDB Deals table |
| Stage mapping | Map Workiz job statuses → our pipeline stages |
| Tag mapping | Map Workiz categories/labels → our tags |
| Contact linking | Match deal's client phone → find contact in CRM table → set `contactId` |
| Validation report | Total imported, unlinked (no matching contact), field mapping errors |
| Dry run mode | Validate without writing |

### Story 1.6.3 — Migration Verification

| Task | Done when |
|------|-----------|
| Record count comparison | Workiz contact count ≈ DynamoDB contact count (±5% for dedup) |
| Spot check 20 random deals | All fields mapped correctly, correct contact linked, correct stage |
| GSI queries work | Pipeline view returns expected deal counts per stage |
| Phone search works | Search for 10 known phones → correct contacts found |

---

## EPIC 1.7 — Frontend: Dispatcher Dashboard

**Duration:** ~8 days (parallel with backend)
**Owner:** Frontend

### Story 1.7.1 — Auth & Layout

**As a** dispatcher
**I want** to log in and see the main dashboard
**So that** I can start managing deals

**Tasks:**

| Task | Done when |
|------|-----------|
| Cognito login page | Email + password form → Cognito auth → store tokens |
| Token refresh | Auto-refresh access token using refresh token before expiry |
| Main layout shell | Sidebar navigation + top bar with user info + role badge |
| Sidebar nav items | Deals (active), Contacts, Companies. More items added in future Steps |
| Logout | Clear tokens, redirect to login |
| Role-based nav | Technicians see limited nav (only "My Deals") |

### Story 1.7.2 — Deal List (Pipeline View)

**As a** dispatcher
**I want** to see all deals organized by pipeline stage
**So that** I can quickly find and manage jobs

**Tasks:**

| Task | Done when |
|------|-----------|
| Pipeline board view | Columns: one per stage group (Submitted, In Progress, Pending, Closed). Show deal count per column |
| Deal card in list | Shows: deal #, client name, job type, address (city), assigned tech, tags (as badges), date |
| Click deal card → deal detail page | Navigation to `/deals/:id` |
| List view toggle | Switch between pipeline (kanban) view and table (list) view |
| Filters bar | Dropdowns: Status/Stage, Job Type, Assigned Tech, Tags, Date range. Apply → re-query API |
| Pagination | "Load more" button or infinite scroll. Uses cursor from API |
| Real-time updates | Subscribe to Redis pub/sub via WebSocket. When a deal updates → refresh card in list without full reload |

### Story 1.7.3 — Deal Detail Page

**As a** dispatcher
**I want** to see all information about a deal on one page
**So that** I can manage the job effectively

**Tasks:**

| Task | Done when |
|------|-----------|
| Deal header | Deal #, stage badge (colored), client name + phone (clickable → contact page), assigned tech |
| Stage change control | Dropdown or buttons showing allowed next stages (based on current stage + user role). Click → API call → update |
| Field sections | Organized in collapsible blocks: Client Info, Schedule, Job Details, Custom Info. All 50+ fields displayed |
| Edit mode | Click "Edit" → fields become editable. Save → PUT request. Cancel → revert |
| Tags management | Display tags as badges. Add/remove tags inline |
| Assign technician | Dropdown of technicians. Select → assign. Show current assignment |
| Activity timeline | Chronological list of all timeline entries. Most recent first. Manual "Add Note" form at top |
| Linked contact card | Show contact info (name, phones, type, company) with link to contact detail page |

### Story 1.7.4 — Create Deal Form

**As a** dispatcher
**I want** to create a new deal with client search
**So that** I can log a job quickly after taking a call in Workiz

**Tasks:**

| Task | Done when |
|------|-----------|
| "New Deal" button | Prominent button in top bar. Opens full-page form or modal |
| Client search | Phone input → debounced search (300ms) → show matching contacts. Click to select |
| New client inline create | If no match → show inline fields: First Name, Last Name. Auto-creates contact on deal save |
| Required fields | Job Type (dropdown), Service Area (dropdown), Address (street, city, state, zip) |
| Optional fields | Scheduled date/time, Priority, Source, Notes, Tags |
| Assign tech (optional) | Dropdown of technicians. Can leave unassigned |
| Submit | Creates deal → redirects to deal detail page |
| Validation | Client-side: required fields check. Server-side: 400 with field errors |

### Story 1.7.5 — Contact & Company Pages

**As a** dispatcher
**I want** to view and manage contacts and companies
**So that** I can update client information

**Tasks:**

| Task | Done when |
|------|-----------|
| Contact list page | Table: Name, Phone, Client Type, Company, # of Deals. Search bar. Paginated |
| Contact detail page | All fields, linked company (clickable), list of linked deals (clickable) |
| Contact edit | Inline edit of fields. Save → PUT |
| Company list page | Table: Name, Type, Phone, # of Contacts. Search bar |
| Company detail page | Company info + list of linked contacts + deals across all contacts |
| Link/unlink contact to company | From company detail page: "Add Contact" search → link. "Remove" → unlink |

### Story 1.7.6 — Duplicate Review Page (Manager)

**As a** manager
**I want** to review and resolve duplicate contacts
**So that** the CRM stays clean

**Tasks:**

| Task | Done when |
|------|-----------|
| Duplicates page (manager+ only) | List of duplicate pairs with match type and confidence |
| Side-by-side comparison | Show both contacts with all fields. Highlight matching fields |
| "Not a Duplicate" button | Dismisses the pair |
| "Merge" button | Pick primary → merge → secondary archived |
| Merge confirmation | Summary of what will happen: "X deals will be re-linked, Y phones will be added" |

---

## EPIC 1.8 — WebSocket Real-Time Updates

**Duration:** ~2 days
**Owner:** Backend + Frontend

### Story 1.8.1 — WebSocket Connection

**As a** dispatcher
**I want** deal updates to appear in real-time without refreshing
**So that** I always see the latest status

**Tasks:**

| Task | Done when |
|------|-----------|
| WebSocket endpoint on deal-service | `/ws` endpoint using `ws` library. Authenticate via Cognito token in query param |
| Connection management | Track connected clients in Redis SET. Clean up on disconnect |
| Redis pub/sub listener | Deal service subscribes to `channel:deal-updates`. On message → broadcast to connected clients |
| Publish on deal change | On create/update/delete/stage-change → publish event to Redis `channel:deal-updates` |
| Frontend WebSocket client | Connect on login. Reconnect on disconnect (exponential backoff) |
| Handle deal update event | If deal is visible in current view → update card/detail in place. Show subtle notification |
| Handle new deal event | If in pipeline view → add new card to appropriate column |

**Events:**

```typescript
// Server → Client
{ type: 'deal.updated', dealId: string, changes: { stage?, assignedTechId?, ... } }
{ type: 'deal.created', deal: DealSummary }
{ type: 'deal.deleted', dealId: string }
```

---

## Week-by-Week Breakdown

```
WEEK 1
──────
Backend:   EPIC 1.1 (Contacts) + EPIC 1.2 (Companies) + start EPIC 1.4 (Permissions middleware)
Frontend:  EPIC 1.7 Story 1.7.1 (Auth + Layout) + Story 1.7.5 (Contact/Company pages)

WEEK 2
──────
Backend:   EPIC 1.5 Stories 1.5.1-1.5.4 (Deal CRUD, Pipeline, Tags, Timeline)
Frontend:  EPIC 1.7 Stories 1.7.2, 1.7.3 (Deal List + Deal Detail page)

WEEK 3
──────
Backend:   EPIC 1.5 Stories 1.5.5-1.5.6 (Stage permissions, Assignment) + EPIC 1.3 (Dedup) + EPIC 1.8 (WebSocket)
Frontend:  EPIC 1.7 Stories 1.7.4, 1.7.6 (Create Deal form + Duplicates page) + WebSocket integration

WEEK 4
──────
Backend:   EPIC 1.6 (Data migration — import contacts + deals from Workiz)
Frontend:  Polish, bug fixes, responsive design, loading/error states
Everyone:  End-to-end testing, migration verification, UAT with dispatchers
```

---

## Done Criteria — Step 1 Complete

| # | Check |
|---|-------|
| 1 | Dispatcher can log in and see deal pipeline |
| 2 | Dispatcher can create a deal with phone search → auto-create or link contact |
| 3 | Deal moves through pipeline stages with role-based restrictions |
| 4 | Technician sees only their own assigned deals |
| 5 | Manager can see all deals, change stages, reassign techs |
| 6 | Activity timeline shows all changes on a deal |
| 7 | Contact and Company CRUD works with proper permissions |
| 8 | Duplicate contacts detected and mergeable by admin |
| 9 | Deal list filterable by status, job type, tech, tags, date |
| 10 | Real-time updates via WebSocket (deal changes appear without refresh) |
| 11 | Workiz contacts and deals (24 months) imported and verified |
| 12 | All API endpoints have unit tests |

## Out of Scope for Step 1

| What | When |
|------|------|
| Dispatch map | Step 2 |
| Inventory / barcode scanning | Step 2 |
| Invoicing / estimates | Step 2 |
| Payments (Stripe) | Step 2 |
| Mobile app | Step 2 |
| Commission report | Step 2 |
| GPS tracking | Step 2 |
| Telephony / calls / SMS | Step 3 |
| Email integration (Gmail) | Step 4 |
| Field-level permissions | Step 4 |
| Advanced merge with rollback | Step 5 |
| Full-text search (OpenSearch) | Step 5 |
| Deal automation / robots | Step 6 |
