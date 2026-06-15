# Phase 1 — Core Platform Features

---

## 1. Users & Permissions

### User Management

Every person in the system has a user account with one of five roles:

- **Super Admin** — full access to everything across all departments
- **Admin** — full access within the system, can manage users
- **Department Manager** — manages their department's team, deals, and inventory
- **Dispatcher** — creates and manages deals, assigns technicians, handles clients
- **Technician** — sees only their own assigned deals, updates job status, uses inventory from their container

Admins create users by entering email, name, role, and department. The user receives an email invitation with a temporary password, sets their own password, and can log in immediately.

Users can be deactivated — they lose access instantly but their history (deals, timeline entries, assignments) stays intact.

### Role-Based Access

Every action in the system is restricted by role:

- **Who can see what:**
  - Technicians see only deals assigned to them and contacts linked to those deals
  - Department managers see everything within their department
  - Dispatchers, admins, super admins see everything

- **Who can do what:**
  - Only admins+ can create/edit/deactivate users
  - Only admins+ can delete contacts or deals
  - Only managers+ can approve technician skills
  - Dispatchers can create deals, assign techs, manage contacts — but can't delete anything
  - Technicians can update deal status (within allowed transitions), add products from their container, and edit their own profile

- **Deal stage transitions are role-restricted** (see Deals section below)

### Departments

Users belong to a department (e.g., "Locksmith East", "Locksmith West"). Department managers only see and manage users and deals within their own department. Super admins and admins see across all departments.

---

## 2. Technicians

### Profile

Every technician has an extended profile on top of their user account:

- **Home address** — where they start the day (with coordinates for distance calculation)
- **Skills** — what jobs they can do: Lockout, Rekey, Installation, Safe Opening, etc.
- **Service areas** — geographic regions they cover: "Atlanta Metro", "North GA", etc.
- **Commission config** — labor cost per hour, commission rate %, credit card fee rate %
- **Inventory container** — a virtual "warehouse" representing their van (see Inventory section)

### Skill Approval

Technicians propose their own skills and service areas. These start in "pending" status. A department manager reviews and approves or rejects them. Only technicians with approved skills appear in deal assignment suggestions.

This prevents unqualified techs from being assigned to jobs they can't handle.

### Location

The system calculates each technician's current location without GPS tracking:

- **If the tech has no jobs assigned today** → their location is their **home address**
- **If the tech has jobs assigned today** → their location is the address of their **last assigned job of the day**

This location is used to calculate distance to a new deal's address when dispatchers are deciding who to assign. Distance is shown in miles.

Example:
> Tech John has 3 jobs today. His last job is at 123 Peachtree St.
> A new deal comes in at 456 Oak Ave, which is 4.2 miles from Peachtree St.
> The dispatcher sees "John — 4.2 mi (from last job)" in the assignment panel.

---

## 3. Clients

### Contacts (People)

Every client is a contact with:

- Name, one or more phone numbers, email(s)
- Client type: residential, commercial, or government
- Address
- Optional link to a company
- Source (how they found us), notes

Phone numbers are the primary identifier. All phones are stored in a standardized format for reliable search and deduplication.

### Companies

Companies are separate entities linked to contacts:

- Company name, address, phone, email
- One company can have multiple linked contacts (employees, managers, etc.)
- Deals can be associated with both a contact and their company

### Auto-Create from Deal

When a dispatcher creates a new deal, they enter a phone number. The system searches for an existing contact:

- **Found** → the existing contact is linked to the deal
- **Not found** → a new contact is automatically created with the provided name and phone, then linked to the deal

This eliminates the extra step of "go create client first, then come back and create a deal."

### Duplicate Detection

When a new contact is created, the system checks if the phone number already exists. If it does, the pair is flagged as a potential duplicate. Managers can review flagged duplicates and either:

- **Merge** — pick the primary contact, combine phones/emails/deals from both, archive the duplicate
- **Dismiss** — mark as "not a duplicate" (e.g., two people sharing a business phone)

---

## 4. Deals

### What a Deal Represents

A deal is a single service job — a lockout, a rekey, an installation, etc. It's the core unit of work in the system.

Every deal has:

- **Client** — linked contact (and optionally company)
- **Job type** — Lockout, Rekey, Installation, Safe Opening, etc.
- **Address** — where the job happens (with coordinates for distance calculation)
- **Service area** — geographic region (Atlanta Metro, North GA, etc.)
- **Schedule** — date and time slot
- **Assigned technician** — who's doing the job
- **Assigned dispatcher** — who booked it
- **Pipeline stage** — current status (see below)
- **Priority** — normal or urgent
- **Tags** — custom labels for filtering
- **Products** — inventory items used on the job (see below)
- **Notes** — internal notes and client-facing notes

### Pipeline Stages

Every deal moves through stages grouped into four categories:

**Submitted** (new work coming in):
- New Lead — just received, not yet reviewed
- Estimate Sent — client was given a price
- Approved — client said yes

**In Progress** (active work):
- Assigned — tech has been assigned
- En Route — tech is driving to the job
- On Site — tech arrived
- Work In Progress — tech is doing the work

**Pending** (waiting on something):
- Pending Payment — work done, waiting for payment
- Pending Parts — need parts that aren't available
- Follow Up — need to call back later
- On Hold — paused for any reason

**Closed** (terminal — cannot be reopened):
- Completed — job done and paid
- Canceled — job canceled (requires a reason)

### Stage Transition Rules

Not everyone can move a deal to any stage:

**Technicians** (own assigned deals only):
- Can progress through: Assigned → En Route → On Site → Work In Progress → Pending Payment
- Can move to Pending Parts from Work In Progress
- Cannot set Completed, Canceled, or any Submitted stage

**Dispatchers:**
- Can change all Submitted and Pending stages
- Can cancel any deal (must provide a reason)
- Cannot set Completed

**Managers / Admins / Super Admins:**
- Unrestricted — can move any deal to any stage

### Activity Timeline

Every deal has a chronological timeline that auto-records:

- Deal created (by whom, when)
- Stage changed (from → to, by whom)
- Technician assigned or reassigned
- Any field updated (what changed, old → new)
- Products added or removed
- Notes added
- Tags added or removed
- Contact linked

Each entry shows who did it and when. The timeline cannot be edited or deleted — it's an audit trail.

Dispatchers and managers can add manual notes to the timeline.

### Deal Assignment

When a dispatcher needs to assign a technician to a deal, the system shows a ranked list of qualified techs:

**Filtering:**
1. Tech's skills must include the deal's job type (e.g., tech knows "Lockout")
2. Tech's service areas must include the deal's area (e.g., tech covers "Atlanta Metro")
3. Tech's skills must be approved (not pending)

**Enrichment — for each qualifying tech, the system shows:**
- **Distance** — miles from tech's current location to the deal address, plus whether the location is "from home" or "from last job"
- **Current job count** — how many deals the tech already has today
- **Inventory availability** — does the tech's container have the items this job might need? Shows "has all items" or lists what's missing

**Sorting:**
- First by fewest jobs today (balance workload)
- Then by shortest distance (minimize drive time)

The dispatcher can also see ALL technicians (not just qualified ones) with clear indicators of why each tech doesn't qualify (missing skill, wrong area, etc.) — useful for manual override when needed.

**One-click assignment:** dispatcher picks a tech, deal moves to "Assigned" stage automatically, timeline records the assignment.

### Adding Inventory to a Deal

While working a job, the technician adds products they use:

1. Tech selects a product (by name, SKU, or barcode scan)
2. System checks: is the product in this tech's container? Is there enough stock?
3. If yes: product is added to the deal, stock is deducted from the tech's container
4. Timeline logs: "Product added: Kwikset Deadbolt ×1 ($45.00)"

The deal shows a line items list with three price tiers:
- **Company cost** — what the company paid the supplier (locked, from catalog)
- **Tech cost** — used for commission calculation (locked, from catalog)
- **Client price** — what the client pays (editable within ±50% of catalog price)

If a product is removed from the deal, stock is restored to the tech's container.

---

## 5. Inventory

### Product Catalog

Central catalog of all products and services the company offers:

- **Name, SKU, barcode** — every product has a unique SKU and scannable barcode
- **Category** — hierarchical (e.g., "Locks > Residential > Deadbolts")
- **Type** — "product" (physical item, tracked in stock) or "service" (labor, no stock tracking)
- **Three-tier pricing:**
  - Cost (Company) — what the company pays the supplier
  - Cost (For Tech) — deducted from tech's commission pool
  - Price (Client) — default client-facing price
- **Supplier, photo, serial tracking flag, minimum stock level**

Products can be imported in bulk via CSV.

### Warehouses

Physical storage locations (e.g., "Atlanta Main Warehouse", "Orlando Storage"):

- Each warehouse tracks quantity per product
- Admins can receive new stock into a warehouse (e.g., supplier shipment arrives)
- Stock can be transferred from warehouse to technician containers

### Technician Containers

Every technician gets a virtual "container" — represents their van or toolbox:

- One container per technician, auto-created when the tech is activated
- Shows what products and quantities the tech currently has
- **Only the tech can use items from their own container** (by adding products to their assigned deals)
- Managers/admins can transfer stock into or out of a tech's container

### Stock Operations

**Receive** — new stock arrives from a supplier:
- Admin selects a warehouse, scans/selects products, enters quantities
- Stock levels increase

**Transfer** — move stock between locations:
- Warehouse → tech container (restocking a van)
- Tech container → warehouse (returning unused parts)
- Tech container → tech container (tech-to-tech handoff)
- Transfers are immediate — no approval workflow in Phase 1

**Deduct** — happens automatically when a tech adds a product to a deal:
- Stock decreases in the tech's container
- If removed from the deal, stock is restored

### Inventory Visibility by Role

- **Super Admin / Admin** — see all warehouses, all containers, all stock levels, can do any operation
- **Department Manager** — same as admin within their department
- **Dispatcher** — can view stock levels (for awareness during assignment) but cannot modify
- **Technician** — sees only their own container contents, can only use items by adding to their deals
