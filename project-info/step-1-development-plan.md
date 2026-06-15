# Development Plan — Core Platform

**Duration:** ~6 weeks
**Goal:** Users, Clients, Deals (with assignment + inventory), Technicians, Inventory — all working locally.

---

## What Gets Built

```
1. Users & Permissions      — CRUD, 5 roles, role-based access enforcement
2. Technicians              — profile, skills + approval, location (home / last job of day)
3. Clients                  — Person + Company, auto-create from deal, phone search, basic dedup
4. Deals                    — CRUD, 13 pipeline stages, role-based transitions, timeline,
                              assignment (tech distance + inventory check), add inventory items
5. Inventory                — product catalog (3-tier pricing), warehouses, tech containers,
                              receive, transfer, deduct on deal
```

**NOT in scope:** Telephony, Payments, Invoicing PDF, Commission Report, Mobile App, Dispatch Map (Google Maps), GPS tracking, SMS, Email integration, Stocktaking, Transfer approvals.

---

## Infra

### Local dev

```
docker-compose.yml:
  dynamodb-local     port 8000
  redis              port 6379

Services (tsx watch):
  user-service       port 4001
  crm-service        port 4002
  deal-service       port 4003
  inventory-service  port 4004

Frontend:
  next dev           port 3000
```

### AWS Cognito (auth — runs in cloud even during dev)

Cognito User Pool is the **single source of truth** for authentication. Used from day one — no mock auth.

**Setup:**

```
Cognito User Pool: {project}-dev
  Sign-in:           email
  Password policy:   8+ chars, upper + lower + number
  App client:        {project}-api (no secret — SPA)
  Token validity:    access 1hr, refresh 30d

Custom attributes on each user:
  custom:role           "super_admin" | "admin" | "dept_manager" | "dispatcher" | "technician"
  custom:department     "locksmith-east" | "locksmith-west" | ...
  custom:user_id        internal user ID (matches DynamoDB USER#<id>)
```

**How it works:**

```
Frontend                          Cognito                         Backend
────────                          ───────                         ───────
Login form
  email + password ──────────►  Cognito authenticates
                                  ◄─── returns tokens
                                  (access + id + refresh)

API call with
  Authorization: Bearer <token> ──────────────────────────────►  auth middleware:
                                                                   1. verify JWT signature (aws-jwt-verify)
                                                                   2. extract: sub, email, custom:role,
                                                                      custom:department, custom:user_id
                                                                   3. set req.user
                                                                   4. continue to handler
```

**User creation flow:**

```
Admin creates user via user-service:
  POST /api/users { email, firstName, lastName, role, department }

user-service:
  1. Create Cognito user (AdminCreateUser API)
     → sets custom:role, custom:department, custom:user_id
     → Cognito sends invitation email with temp password
  2. Create user record in DynamoDB Users table
  3. Return user

User receives email → sets password → logs in → gets JWT with role in claims
```

**Updating role/department:**

```
Admin changes role via user-service:
  PUT /api/users/:id { role: "dispatcher" }

user-service:
  1. Update DynamoDB user record
  2. Update Cognito custom attributes (AdminUpdateUserAttributes)
  3. Next login → new JWT has updated role
```

**Deactivating user:**

```
DELETE /api/users/:id

user-service:
  1. Set DynamoDB status: inactive
  2. Disable Cognito user (AdminDisableUser)
  3. User can't log in anymore
```

**Frontend auth (Next.js):**

```
Use: aws-amplify/auth (lightweight, just the auth module)
  - Amplify.configure({ Auth: { userPoolId, userPoolClientId, region } })
  - signIn(email, password) → tokens stored in memory/localStorage
  - fetchAuthSession() → get current access token
  - Auto-refresh before expiry using refresh token
  - signOut() → clear tokens

Every API call:
  headers: { Authorization: `Bearer ${accessToken}` }
```

**Packages:**

```
Backend:  aws-jwt-verify           (verify Cognito JWT, ~50KB, zero deps)
          @aws-sdk/client-cognito-identity-provider  (create/update/disable users)

Frontend: aws-amplify/auth         (sign in/out, token management)
```

**Terraform (minimal — just Cognito):**

```
infra/
  ├── modules/
  │   └── cognito/          user pool + app client + custom attributes
  ├── dev/
  │   └── main.tf           just cognito module
  └── backend.tf            S3 state (or even local state for dev)
```

This is the only cloud resource needed for dev. DynamoDB and Redis run locally via Docker.

---

## Repo Structure

```
backend/
  ├── services/
  │   ├── user/
  │   │   ├── src/
  │   │   │   ├── routes/        (Express routers)
  │   │   │   ├── handlers/      (thin — validate, call service, respond)
  │   │   │   ├── services/      (business logic, DynamoDB queries)
  │   │   │   ├── types/
  │   │   │   └── app.ts
  │   │   └── tests/
  │   ├── crm/                   (same structure)
  │   ├── deal/
  │   └── inventory/
  ├── packages/
  │   └── shared/
  │       ├── dynamodb.ts        DynamoDBDocumentClient singleton + helpers
  │       ├── redis.ts           ioredis client + cache helpers
  │       ├── auth.ts            middleware: verify Cognito JWT (aws-jwt-verify), extract role/dept/userId
  │       ├── permissions.ts     requireRole(), requireOwnership(), permission matrix
  │       ├── errors.ts          AppError, NotFoundError, ValidationError, ForbiddenError
  │       ├── response.ts        success(), paginated(), error()
  │       ├── geo.ts             distanceMiles() — Haversine formula
  │       └── types/             shared interfaces (User, Contact, Deal, Product, etc.)
  ├── scripts/
  │   ├── setup-local-db.ts      creates all DynamoDB tables + GSIs
  │   └── seed.ts                sample users, contacts, deals, products, stock
  ├── docker-compose.yml
  ├── Dockerfile
  ├── package.json
  └── turbo.json

frontend/                        Next.js + v0 components
```

Every service follows the same pattern: `routes/ → handlers/ → services/`. Handlers are thin (validate input, call service function, format response). Business logic lives in `services/`.

---

## DynamoDB Tables

### Users table

```
PK                    SK                    Purpose
USER#<id>             METADATA              User record (name, email, role, dept, status)
USER#<id>             TECH_PROFILE          Technician extended data (only for techs)

GSI1: ROLE#<role>           USER#<id>       List users by role
GSI2: DEPT#<department>     USER#<id>       List users by department
```

### CRM table

```
PK                    SK                    Purpose
CONTACT#<id>          METADATA              Contact record
CONTACT#<id>          PHONE#<number>        Phone entry
COMPANY#<id>          METADATA              Company record
COMPANY#<id>          CONTACT#<id>          Company→Contact link

GSI1: PHONE#<number>        CONTACT#<id>    Reverse phone lookup
```

### Deals table

```
PK                    SK                    Purpose
DEAL#<id>             METADATA              Deal record
DEAL#<id>             TIMELINE#<ts>#<uuid>  Activity timeline entry
DEAL#<id>             PRODUCT#<productId>   Line item (inventory product on deal)

GSI1: STATUS#<stage>         <date>#DEAL#<id>       Pipeline view by stage
GSI2: TECH#<userId>          <date>#DEAL#<id>       Tech's deals
GSI3: DISPATCHER#<userId>    <date>#DEAL#<id>       Dispatcher's deals
GSI4: CONTACT#<contactId>    DEAL#<id>              Deals by contact
```

### Inventory table

```
PK                    SK                    Purpose
PRODUCT#<id>          METADATA              Product record (name, SKU, barcode, prices)
WAREHOUSE#<id>        METADATA              Warehouse record
WAREHOUSE#<id>        PRODUCT#<productId>   Stock level at warehouse
CONTAINER#<id>        METADATA              Tech container record
CONTAINER#<id>        PRODUCT#<productId>   Stock level in container
TRANSFER#<id>        METADATA               Transfer record

GSI1: BARCODE#<code>         PRODUCT#<id>   Barcode → product lookup
GSI2: TECH#<techId>          CONTAINER#<id> Tech → container mapping
```

---

## Redis

```
Cache:
  contact:{id}           contact data (TTL 5min)
  contact:phone:{phone}  contact by phone (TTL 5min)
  deal:{id}              deal data (TTL 5min)
  tech:location:{id}     tech calculated location (TTL 1min)
  tech:locations:all     all tech locations (TTL 1min)

Pub/Sub:
  channel:deal-updates   deal create/update/assign events → frontend WebSocket
```

No BullMQ queues needed yet — dedup nightly scan can be a simple cron endpoint for dev.

---

## 1. Users & Permissions

### What it does

- CRUD users with 5 roles: `super_admin`, `admin`, `dept_manager`, `dispatcher`, `technician`
- Creates/updates/disables users in **both DynamoDB and Cognito** (Cognito is auth source, DynamoDB stores business data)
- Every API call validates Cognito JWT → extracts role from `custom:role` claim
- Technicians auto-filtered to see only own assigned deals
- Department managers scoped to their department

### user-service endpoints

```
POST   /api/users                    Create user → creates in Cognito + DynamoDB (admin+)
GET    /api/users                    List (filter by role, department) — from DynamoDB
GET    /api/users/:id                Get user — from DynamoDB
PUT    /api/users/:id                Update → updates DynamoDB + Cognito custom attributes (admin+)
DELETE /api/users/:id                Deactivate → disables in Cognito + sets inactive in DynamoDB (admin+)
```

### Permission matrix (enforced in shared middleware)

```
                  super_admin  admin  dept_manager  dispatcher  technician
Users: manage     ✓            ✓      ✗             ✗           ✗
Contacts: view    all          all    all           all         own deals only
Contacts: create  ✓            ✓      ✓             ✓           ✗
Contacts: delete  ✓            ✓      ✗             ✗           ✗
Deals: view       all          all    department    all         own assigned
Deals: create     ✓            ✓      ✓             ✓           ✗
Deals: delete     ✓            ✓      ✗             ✗           ✗
Deals: stage      all          all    all           limited     limited
Inventory: view   all          all    all           all         own container
Inventory: manage ✓            ✓      ✓             ✗           ✗
Inventory: use    ✗            ✗      ✗             ✗           own container
```

### User model

```typescript
interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  phone?: string
  role: 'super_admin' | 'admin' | 'dept_manager' | 'dispatcher' | 'technician'
  department: string
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}
```

---

## 2. Technicians

### What it does

- Extended profile on top of User (home address, skills, service areas, commission config)
- Skill proposal + manager approval workflow
- Location calculation: **home address** if no jobs today, **last assigned job's address** if has jobs

### user-service endpoints (technician-specific)

```
GET    /api/technicians                        List all techs (with profile summary)
GET    /api/technicians/:id                    Full tech profile
PUT    /api/technicians/me/profile             Tech updates own profile
GET    /api/technicians/pending-approvals      Techs with pending skills (manager+)
POST   /api/technicians/:id/skills/approve     Approve skills (manager+)
POST   /api/technicians/:id/skills/reject      Reject skills (manager+)
PUT    /api/technicians/:id/commission         Set commission config (manager+)
GET    /api/technicians/locations              All tech locations (with distance to ?lat=&lng=)
GET    /api/technicians/:id/location           Single tech location
```

### Technician profile model

```typescript
interface TechnicianProfile {
  userId: string
  homeAddress: Address              // with lat/lng — geocoded on save
  skills: string[]                  // ["Lockout", "Rekey", "Installation"]
  skillsStatus: 'pending' | 'approved'
  serviceAreas: string[]            // ["Atlanta", "North GA"]
  areasStatus: 'pending' | 'approved'
  laborCostHour: number             // set by manager
  commissionRate: number            // e.g. 40 (%)
  ccFeeRate: number                 // e.g. 3 (%)
  containerId?: string              // auto-created inventory container
  onboardingStatus: 'pending' | 'active' | 'inactive'
}
```

### Location logic

```
getTechLocation(techId, date):
  1. Query Deals table: GSI2 TECH#<techId>, filter scheduledDate = today, status != canceled/completed
  2. Sort by scheduledTime or sequenceNumber descending
  3. If jobs found → return LAST job's address lat/lng (type: "last_job")
  4. If no jobs → return tech's homeAddress lat/lng (type: "home")

Distance:
  Haversine(techLat, techLng, dealLat, dealLng) → miles
```

### Skill approval flow

```
Tech proposes skills → skillsStatus = "pending"
Manager sees in /pending-approvals
Manager approves → skillsStatus = "approved"
Only "approved" techs show up in deal assignment filtering
```

---

## 3. Clients (Person / Company)

### What it does

- Contact CRUD with phone search (E.164 normalization, DynamoDB GSI)
- Company CRUD with contact linking (Company → many Contacts)
- Auto-create contact when creating a deal with unknown phone
- Basic duplicate detection (exact phone match) + merge

### crm-service endpoints

```
POST   /api/crm/contacts                              Create
GET    /api/crm/contacts/:id                           Get
PUT    /api/crm/contacts/:id                           Update
GET    /api/crm/contacts                               List (paginated)
GET    /api/crm/contacts/search?phone=&name=           Search
DELETE /api/crm/contacts/:id                           Archive (admin+)

POST   /api/crm/companies                              Create
GET    /api/crm/companies/:id                           Get (with linked contacts)
PUT    /api/crm/companies/:id                           Update
GET    /api/crm/companies                               List
POST   /api/crm/companies/:id/contacts/:contactId       Link
DELETE /api/crm/companies/:id/contacts/:contactId       Unlink

GET    /api/crm/duplicates                              Duplicate pairs (manager+)
POST   /api/crm/duplicates/:id/dismiss                  Not a duplicate
POST   /api/crm/contacts/merge                          Merge two contacts (admin+)
```

### Contact model

```typescript
interface Contact {
  id: string
  firstName: string
  lastName: string
  phones: { number: string; type: string; isPrimary: boolean }[]  // E.164
  emails: string[]
  clientType: 'residential' | 'commercial' | 'government'
  companyId?: string
  address?: Address
  source?: string
  notes?: string
  status: 'active' | 'archived'
  createdBy: string
  createdAt: string
}
```

### Auto-create from deal

```
Deal creation receives: phone + firstName + lastName (no contactId)
  → crm-service: search by phone
  → Found? Return existing contact
  → Not found? Create contact with defaults (residential, source: manual)
  → Link contactId to deal
```

### Duplicate detection

- On contact create: if phone already exists → store duplicate pair
- Merge: pick primary, move phones/emails/deals to primary, archive secondary

---

## 4. Deals

### What it does

- Full CRUD with 13 pipeline stages across 4 groups
- Role-based stage transitions (tech can only move within In Progress stages)
- Activity timeline — auto-logs every change
- Assignment: shows qualified techs (skill + area match) with **distance** and **inventory availability**
- Add inventory items to deal (deducts from tech's container)

### deal-service endpoints

```
POST   /api/deals                              Create deal
GET    /api/deals/:id                          Get (+ timeline + products)
PUT    /api/deals/:id                          Update fields
GET    /api/deals                              List (filters: stage, tech, dispatcher, tag, jobType, date, contact)
DELETE /api/deals/:id                          Soft delete (admin+)

PUT    /api/deals/:id/stage                    Change stage (role-validated)
POST   /api/deals/:id/notes                    Add manual note to timeline
GET    /api/deals/:id/timeline                 Timeline (paginated)

GET    /api/deals/:id/qualified-techs          Qualified techs with distance + inventory
GET    /api/deals/:id/all-techs                All techs with match/mismatch reasons
POST   /api/deals/:id/assign                   Assign tech
POST   /api/deals/:id/unassign                 Remove assignment
POST   /api/deals/:id/reorder                  Reorder tech's job sequence

POST   /api/deals/:id/products                 Add product (deducts from container)
DELETE /api/deals/:id/products/:productId      Remove product (restores to container)
```

### Deal model

```typescript
interface Deal {
  id: string
  dealNumber: number                // auto-increment

  // Client
  contactId: string
  companyId?: string
  clientType: 'residential' | 'commercial' | 'government'

  // Schedule
  scheduledDate?: string
  scheduledTimeSlot?: string
  serviceArea: string               // "Atlanta Metro"

  // Location
  address: Address                  // with lat/lng

  // Job
  jobType: string                   // "Lockout", "Rekey", etc.
  stage: string                     // current pipeline stage
  assignedTechId?: string
  assignedDispatcherId?: string
  sequenceNumber?: number           // tech's job order [1][2][3]
  priority: 'normal' | 'urgent'
  tags: string[]

  // Info
  source?: string
  notes?: string
  internalNotes?: string
  cancellationReason?: string

  // Inventory
  products: DealProduct[]           // line items from inventory

  status: 'active' | 'deleted'
  createdBy: string
  createdAt: string
  updatedAt: string
}

interface DealProduct {
  productId: string
  name: string
  sku: string
  quantity: number
  costCompany: number               // company's cost
  costForTech: number               // for commission calc
  priceClient: number               // client-facing
  addedBy: string
  addedAt: string
}
```

### Pipeline stages

```
SUBMITTED:          New Lead (default), Estimate Sent, Approved
IN PROGRESS:        Assigned, En Route, On Site, Work In Progress
PENDING:            Pending Payment, Pending Parts, Follow Up, On Hold
CLOSED:             Completed (terminal), Canceled (terminal, requires reason)
```

### Stage transition rules

```
Technician (own deals only):
  Assigned → En Route → On Site → Work In Progress → Pending Payment
  Work In Progress → Pending Parts
  Cannot: Completed, Canceled, any Submitted stage

Dispatcher:
  All Submitted stages. All Pending stages. Any → Canceled (with reason)
  Cannot: Completed

Manager / Admin / Super Admin:
  Any → Any (unrestricted)
```

### Assignment logic

```
GET /api/deals/:id/qualified-techs

1. Get deal: jobType, serviceArea, address (lat/lng), required items (if any)
2. Get all techs where skillsStatus = "approved"
3. FILTER: tech.skills includes deal.jobType       → exclude if not
4. FILTER: tech.serviceAreas includes deal.serviceArea → exclude if not
5. ENRICH: calculate distance (tech location → deal address)
6. ENRICH: check inventory (tech's container has required items?)
7. SORT: by currentJobCount ASC, then distanceMiles ASC

Response per tech:
  - name, skills, areas
  - distanceMiles + location type (home/last_job)
  - currentJobCount
  - inventory: { hasRequired: bool, missing: string[] }
```

### Adding inventory to deal

```
POST /api/deals/:id/products { sku, quantity }

1. Resolve product by SKU (calls inventory-service)
2. Check: is requester the assigned tech? Is the product in THEIR container?
3. Check: enough stock?
4. Deduct from container (calls inventory-service /deduct)
5. Add DealProduct record to deal (PK=DEAL#<id>, SK=PRODUCT#<productId>)
6. Timeline entry: "Product added: Kwikset Deadbolt x1 ($45.00)"

Price rules:
  - costCompany and costForTech: locked from catalog
  - priceClient: editable within ±50% of catalog price
```

### Timeline

Auto-generated on every mutation:

```
deal.created, stage.changed, field.updated, tech.assigned, tech.reassigned,
product.added, product.removed, note.added, contact.linked, tag.added, tag.removed
```

Each entry: `{ type, message, userId, timestamp }`

---

## 5. Inventory

### What it does

- Product catalog with SKU, barcode, three-tier pricing (costCompany / costForTech / priceClient)
- Warehouses (central stock) and Containers (one per tech, represents their van)
- Receive stock into any location
- Transfer stock between locations (immediate, no approval in this phase)
- Deduct/restore when products added/removed from deals

### inventory-service endpoints

```
POST   /api/inventory/products                         Create product (admin+)
GET    /api/inventory/products/:id                     Get
PUT    /api/inventory/products/:id                     Update
GET    /api/inventory/products                          List (filter by category, type)
GET    /api/inventory/products/scan/:barcode            Lookup by barcode
POST   /api/inventory/products/import                   Bulk CSV import

POST   /api/inventory/warehouses                        Create (admin+)
GET    /api/inventory/warehouses                         List
GET    /api/inventory/warehouses/:id                     Get (with stock levels)

POST   /api/inventory/containers                        Create for tech (admin+)
GET    /api/inventory/containers                         List
GET    /api/inventory/containers/:id                     Get (with stock)
GET    /api/inventory/containers/tech/:techId             Get tech's container
GET    /api/inventory/containers/:id/check?skus=A,B      Check if has items

POST   /api/inventory/receive                            Receive stock
POST   /api/inventory/transfers                          Transfer (immediate)
GET    /api/inventory/transfers                           Transfer history

POST   /api/inventory/deduct                             Deduct from container (called by deal-service)
POST   /api/inventory/restore                            Restore to container (called by deal-service)
```

### Product model

```typescript
interface Product {
  id: string
  sku: string                      // unique
  barcode: string                  // unique, scannable
  name: string
  category: string                 // "Locks > Residential"
  type: 'product' | 'service'     // services don't track stock
  costCompany: number              // what company pays supplier
  costForTech: number              // what tech "pays" (for commission calc)
  priceClient: number              // client-facing default price
  photo?: string
  supplier?: string
  serialTracking: boolean
  minStockLevel?: number
  status: 'active' | 'inactive'
}
```

### Three-tier pricing

```
costCompany    = $15    what the company paid for the part
costForTech    = $20    deducted from tech's commission pool
priceClient    = $45    what the client sees on the invoice

Commission formula (future):
  profit = revenue - costForTech - tax
  techShare = profit × commissionRate%
  netPayout = techShare - ccFee
```

### Warehouse vs Container

```
Warehouse: physical location (e.g., "Atlanta Main Warehouse")
  - Managed by admin/logistics
  - Source for transfers to tech containers

Container: virtual warehouse per tech (e.g., "John's Van")
  - One per technician, auto-created when tech activated
  - Tech can only use items from their own container
  - Deduction happens when product added to deal
```

### Transfers

```
POST /api/inventory/transfers
  { sourceId, destId, items: [{ productId, quantity }] }

Executes immediately:
  1. Check source has enough stock
  2. DynamoDB TransactWriteItems: decrement source, increment dest
  3. Log movement record

Types: warehouse → container, container → warehouse, container → container
```

---

## Frontend Pages

All built with Next.js + v0 generated components.

| Page | Who sees it | What it shows |
|------|-------------|---------------|
| **Login** | Everyone | Email + password via Cognito (aws-amplify/auth). Token stored, auto-refreshed |
| **Deal Pipeline** | Dispatcher, Manager, Admin | Kanban board by stage group. Cards: deal#, client, job type, city, tech, tags. Filters. Table toggle |
| **Deal Detail** | Everyone (role-filtered) | Header, stage change dropdown (role-restricted), fields, products list, assign tech panel, timeline |
| **Create Deal** | Dispatcher+ | Phone search → select/create contact. Job type, area, address, tags, assign tech (optional) |
| **Contacts** | Dispatcher+ | Table + search. Detail: fields, linked company, linked deals |
| **Companies** | Manager+ | Table + search. Detail: info, linked contacts, all deals |
| **Duplicates** | Manager+ | Pair list, side-by-side compare, merge/dismiss |
| **Product Catalog** | Admin | Table: name, SKU, barcode, 3 prices. Create/edit. Bulk import |
| **Warehouses/Containers** | Admin | List with stock summary. Detail: products + quantities. Receive + Transfer forms |
| **Technicians** | Admin, Manager | List: name, skills, areas, status, job count. Profile: approve skills, set commission |
| **Pending Approvals** | Manager+ | Techs with pending skill proposals. Approve/reject |
| **Users** | Admin | Table: name, email, role, dept. Create/edit/deactivate |
| **My Deals** | Technician | Own assigned deals only. Status updates. Add products |
| **My Profile** | Technician | Edit own profile fields, view skills status |

---

## Service Communication

Services call each other via HTTP (localhost in dev, Cloud Map in prod):

```
deal-service → crm-service:
  - Search contact by phone (on deal create)
  - Create contact (auto-create)

deal-service → inventory-service:
  - Check tech's container for items (on assignment)
  - Deduct product from container (on add to deal)
  - Restore product to container (on remove from deal)

deal-service → user-service:
  - Get qualified techs (on assignment)
  - Get tech locations (for distance calc)

Frontend → all services via path routing:
  /api/users/*      → user-service
  /api/crm/*        → crm-service
  /api/deals/*      → deal-service
  /api/inventory/*  → inventory-service
```

In local dev, frontend Next.js `rewrites` in `next.config.js` proxies to each service port.

---

## Week Plan

```
Week 1:  Users + Permissions + Contact/Company CRUD + local infra setup
Week 2:  Technician profiles + location + skill approval + auto-create contact
Week 3:  Deal CRUD + pipeline stages + timeline
Week 4:  Deal assignment (distance + inventory check) + tags
Week 5:  Inventory (catalog, warehouses, containers, receive, transfer)
Week 6:  Add products to deal (integration) + frontend polish + testing
```
