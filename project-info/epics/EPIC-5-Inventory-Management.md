# EPIC: Inventory Management System

---

## Overview

This epic covers the complete implementation of a barcode-driven, multi-warehouse inventory management system within Bitrix24. The system manages the entire lifecycle of inventory items from procurement and receiving to final sale and deduction from mobile technician inventory.

---

## Business Objectives

1. **Real-Time Visibility:** Provide dispatchers and managers with instant access to stock levels across all warehouses and technician vans
2. **Accuracy & Automation:** Minimize manual data entry errors through barcode-driven workflows
3. **Mobile-First:** Enable technicians to manage their van inventory entirely through mobile devices
4. **Accountability:** Track every inventory movement with complete audit trails
5. **Cost Control:** Accurate tracking of parts costs for profit calculations and commission reports

---

## Key User Personas

### Logistics Manager
- **Goals:** Maintain accurate inventory levels, plan purchases, manage transfers between warehouses and technicians
- **Pains:** Currently no real-time visibility into technician van inventory, manual stock tracking prone to errors
- **Needs:** Dashboard showing all inventory locations, transfer management tools, variance reports

### Technician
- **Goals:** Quickly add parts to jobs, maintain accurate van inventory, perform stocktakes efficiently
- **Pains:** Manual part selection is slow, inventory discrepancies cause settlement issues
- **Needs:** Barcode scanning for all operations, simple mobile interface, offline capability

### Dispatcher
- **Goals:** Assign jobs based on technician inventory availability, ensure technicians have necessary parts
- **Pains:** No visibility into what parts technicians currently have in their vans
- **Needs:** Real-time view of technician inventory when assigning jobs

### Administrator/Owner
- **Goals:** Accurate financial reporting, minimize inventory shrinkage, control costs
- **Pains:** Inventory discrepancies affect profit calculations, manual reconciliation is time-consuming
- **Needs:** Automated reports, audit trails, integration with commission calculations

---

## Core Concepts

### Multi-Warehouse Structure

```
┌─────────────────────────────────────────────────────────┐
│                    Central Warehouse                     │
│                  (Main Stock Location)                   │
└─────────────────────┬───────────────────────────────────┘
                      │
          ┌───────────┴───────────┬───────────────┐
          ▼                       ▼               ▼
    ┌──────────┐           ┌──────────┐    ┌──────────┐
    │Container │           │Container │    │Container │
    │ Tech #1  │           │ Tech #2  │    │ Tech #3  │
    │(Van Inv) │           │(Van Inv) │    │(Van Inv) │
    └──────────┘           └──────────┘    └──────────┘
```

**Central Warehouse:**
- Physical location where bulk inventory is received and stored
- Managed by Logistics department
- Source for transfers to technician containers

**Technician Container:**
- Virtual warehouse representing stock in a technician's van
- One container per technician
- Technicians can only use inventory from their own container
- Mobile-managed through Bitrix24 app

### Product Catalog Structure

```
Products (Catalog)
│
├── Services (Non-Stock Items)
│   ├── Labor
│   ├── Service Call Fee
│   └── Emergency Fee
│
└── Products (Stock-Managed Items)
    │
    ├── Tools (Serial Number Tracked)
    │   ├── Key Programmers
    │   ├── Cutting Machines
    │   └── Installation Tools
    │
    └── Job Supplies (Quantity Tracked)
        ├── Locks
        │   ├── Residential Deadbolts
        │   ├── Commercial Locks
        │   └── Smart Locks
        ├── Keys
        │   ├── Blank Keys
        │   └── Pre-Cut Keys
        ├── Doors & Hardware
        ├── Batteries & Electronics
        └── Consumables
```

### Item Attributes

Each product must have:

| Attribute | Description | Required | Example |
|-----------|-------------|----------|---------|
| **SKU** | Unique identifier | ✅ | `LOCK-RES-DEA-001` |
| **Barcode** | Scannable code | ✅ | `123456789012` |
| **Name** | Display name | ✅ | `Kwikset Residential Deadbolt` |
| **Category** | Hierarchical category | ✅ | `Job Supplies > Locks > Residential` |
| **Type** | Product or Service | ✅ | `Product` |
| **Cost** | Company's cost (internal) | ✅ | `$15.00` |
| **Price** | Default sales price | ✅ | `$45.00` |
| **Photo** | Product image | Recommended | `[image.jpg]` |
| **Supplier** | Primary supplier | Optional | `ABC Supply Co.` |
| **Serial Tracking** | Yes/No | ✅ | `No` (Yes for Tools) |
| **Min Stock Level** | Reorder threshold | Optional | `10 units` |

### Barcode System

**Barcode Types Supported:**
- Manufacturer barcodes (UPC, EAN)
- Custom company barcodes (for items without manufacturer codes)

**Barcode Usage:**
- ✅ Receiving stock (scan to add)
- ✅ Transferring stock (scan to select items)
- ✅ Adding to Deal/Invoice (scan to bill)
- ✅ Stocktaking (scan to count)

**Barcode Generation:**
For items without manufacturer barcodes, system must:
1. Generate unique barcode based on SKU
2. Allow printing barcode labels
3. Support QR codes as alternative

---

## Core Workflows

### 1. Receiving Stock

**Scenario A: Receiving at Central Warehouse**

```
Supplier delivers → Logistics creates "Receive Order"
                                    ↓
                    Scan each item with mobile app
                                    ↓
                    System adds quantity to Central Warehouse
                                    ↓
                    Receipt document generated
```

**Scenario B: Direct Delivery to Technician**

```
Package delivered → Technician receives SMS notification
to technician             ↓
                    Opens "Receive Stock" in mobile app
                                    ↓
                    Scans each item
                                    ↓
                    System adds quantity directly to Technician Container
                                    ↓
                    Manager approves receipt (optional)
```

### 2. Transfer Orders

**Purpose:** Document and execute inventory movements between locations

**Types:**
1. **Warehouse → Container** (Stock technician van)
2. **Container → Warehouse** (Return unused stock)
3. **Container → Container** (Technician-to-technician transfer)

**Workflow:**

```
Step 1: Create Transfer Order
  → Source location: [Central Warehouse ▼]
  → Destination: [Tech #5 Container ▼]
  → Status: DRAFT

Step 2: Add Items (by scanning or manual selection)
  → Scan barcode OR select from list
  → Enter quantity
  → Items added to transfer list

Step 3: Confirm Transfer
  → Status: PENDING
  → Notification sent to receiving party

Step 4: Receiving Party Confirms
  → Technician opens transfer in mobile app
  → Scans each item to confirm receipt
  → System updates inventory in both locations
  → Status: COMPLETED

Step 5: Automatic Inventory Adjustment
  → Deduct from source warehouse
  → Add to destination warehouse
  → Log transaction with timestamp and user
```

### 3. Using Inventory in Deals

**Technician Adds Part to Job:**

```
Technician working on job → Opens Deal in mobile app
                                    ↓
                    Clicks "Add Product/Service"
                                    ↓
                    Scans item barcode
                                    ↓
    System checks: Is item in THIS technician's container?
                    ↓                                 ↓
                 ✅ YES                            ❌ NO
                    ↓                                 ↓
    Item added to Deal                    Error: "Item not in your van"
    - Default Price shown                 "Add to container or choose
    - Price editable (within limits)       another item"
    - Quantity = 1 (default)
                    ↓
    System IMMEDIATELY deducts from container
    (not waiting for invoice or payment)
```

**Important Rules:**
- ✅ Deduction happens when item is added to Deal (not when invoiced)
- ✅ Technician can only select items from their own container
- ✅ System shows warning if inventory quantity is insufficient
- ✅ Cost is locked (from catalog), Price is editable within limits

### 4. Stocktaking (Physical Inventory Count)

**Purpose:** Reconcile physical inventory with system quantities to identify variances

**Process:**

```
Step 1: Manager Initiates Stocktake
  → Selects container: [Tech #3 ▼]
  → Clicks "Start Inventory Count"
  → System creates snapshot of current system quantities
  → Status: IN PROGRESS
  → All inventory movements for this container are FROZEN

Step 2: Technician Performs Physical Count
  → Receives notification: "Stocktake Required"
  → Opens "Inventory Count Mode" in mobile app
  → Interface shows: "Scanned: 0 items"
  → Technician scans EVERY item in van (blind count)
  → System tracks: SKU + Quantity for each scanned item
  → No system quantities are shown (blind count)

Step 3: Technician Finalizes Count
  → Clicks "Complete Count"
  → System unlocks inventory movements
  → Status: PENDING REVIEW

Step 4: System Generates Variance Report

  Variance Report for Tech #3 Container:
  ┌──────────────┬──────────┬──────────┬──────────┬─────────┐
  │ SKU          │ System   │ Physical │ Variance │ Value   │
  │              │ Qty      │ Count    │          │ Impact  │
  ├──────────────┼──────────┼──────────┼──────────┼─────────┤
  │ LOCK-RES-001 │ 5        │ 5        │ 0        │ $0      │
  │ LOCK-COM-045 │ 3        │ 2        │ -1 ❌    │ -$25    │
  │ KEY-BLK-789  │ 50       │ 48       │ -2 ❌    │ -$4     │
  │ BATT-CR2032  │ 0        │ 3        │ +3 ✅    │ +$6     │
  └──────────────┴──────────┴──────────┴──────────┴─────────┘

  Summary:
  - Items with no variance: 15
  - Items with shortages: 2 (total -$29)
  - Items with overages: 1 (total +$6)
  - Net variance: -$23

Step 5: Manager Reviews & Adjusts
  → Reviews variance report
  → Investigates discrepancies if significant
  → Clicks "Approve & Adjust"
  → System updates container quantities to match physical count
  → Status: COMPLETED
  → Variance logged in technician's history
```

**Important Notes:**
- Blind count methodology prevents technician from "adjusting" to match system
- Inventory movements frozen during count to prevent confusion
- Variance reports help identify theft, loss, or systematic data entry errors
- Large variances can trigger investigations or penalties

---

## Integration Points

### Integration with Deal Management

**When Creating Deal:**
- System should show warning if job requires parts that technician doesn't have
- Dispatcher can see technician's current inventory before assignment

**When Invoicing:**
- Parts already deducted when added to Deal
- Invoice shows Cost (for internal) and Price (for client)
- Both values feed into Commission Report calculations

### Integration with Dispatch Map

**Intelligent Assignment Logic:**

When dispatcher selects unassigned job, system suggests technicians based on:
1. ✅ Skills (Job Type match)
2. ✅ Service Area
3. ✅ Availability (Calendar)
4. ✅ **Inventory** ← NEW!

**Example:**

```
Job: Lock Installation - Kwikset Deadbolt
Location: Atlanta, GA

System checks:
┌─────────────────────────────────────────────────────┐
│ Technician  Skills  Area    Avail   Inventory       │
├─────────────────────────────────────────────────────┤
│ Tech #1     ✅      ✅      ✅      ✅ Has required  │ ← BEST MATCH
│                                     lock in van     │
├─────────────────────────────────────────────────────┤
│ Tech #2     ✅      ✅      ✅      ⚠️  Lock in      │
│                                     warehouse only  │
├─────────────────────────────────────────────────────┤
│ Tech #3     ✅      ❌      ✅      ✅ Has lock      │
│                  (wrong area)                       │
└─────────────────────────────────────────────────────┘

Recommendation: Assign to Tech #1 (has inventory, can start immediately)
```

### Integration with Commission Report

**Parts Cost Tracking:**

Commission Report requires accurate parts cost for profit calculation:

```
Deal #12345:
  Total: $350
  Tax: $28
  Parts (technician's cost): $45  ← From inventory Cost field
  Company Parts: $0
  Credit Card Fee: $10.50 (3%)
  Tech Share: 40%

Calculation:
  Profit Pool = $350 - $28 - $45 - $0 - $10.50 = $266.50
  Tech Profit = $266.50 × 40% = $106.60
  Company Profit = $266.50 - $106.60 = $159.90
```

**Data Flow:**

```
Product Catalog (Cost: $15)
        ↓
Technician adds to Deal
        ↓
Deal stores: UF_TECH_PARTS_COST = $15
        ↓
Commission Report reads UF_TECH_PARTS_COST
        ↓
Accurate profit calculation
```

---

## User Stories Breakdown

This epic is broken down into the following user stories:

1. **[Story 5.01: Product Catalog Setup](../stories/5.01-inventory-product-catalog.md)**
   - Product catalog structure (Products vs Services)
   - Item attributes and categorization
   - Three-tier pricing model (Cost Company / Cost for Tech / Price Client)
   - Barcode generation and management
   - Bulk import and price updates

2. **[Story 5.02: Multi-Warehouse Configuration](../stories/5.02-inventory-warehouse-setup.md)**
   - Central warehouse setup
   - Technician container creation
   - Warehouse permissions and access control
   - Real-time stock level visibility

3. **[Story 5.03: Receiving Stock](../stories/5.03-inventory-receiving.md)**
   - Receiving at central warehouse
   - Direct delivery to technicians
   - Barcode scanning workflow
   - Receipt documentation

4. **[Story 5.04: Transfer Orders](../stories/5.04-inventory-transfers.md)**
   - Transfer order creation
   - Barcode-driven transfer process
   - Multi-directional transfers (warehouse ↔ container ↔ container)
   - Transfer approval and confirmation

5. **[Story 5.05: Using Items in Deals](../stories/5.05-inventory-deal-integration.md)**
   - Adding products to deals via barcode
   - Container restriction logic
   - Automatic inventory deduction
   - Three-tier pricing enforcement in Deal

6. **[Story 5.06: Stocktaking (Physical Count)](../stories/5.06-inventory-stocktaking.md)**
   - Blind count methodology
   - Mobile app count interface
   - Variance report generation
   - Inventory adjustment approval

7. **[Story 5.07: Mobile App Workflows](../stories/5.07-inventory-mobile-workflows.md)**
   - Mobile barcode scanning interface
   - Offline capability
   - Van inventory visibility
   - Quick actions for technicians

8. **[Story 5.08: Reporting & Analytics](../stories/5.08-inventory-reporting.md)**
   - Current stock levels report
   - Item movement history
   - Inventory usage analysis
   - Sales velocity report
   - Low stock alerts

---

## Technical Architecture

### Database Schema

**Main Tables:**

```sql
-- Product Catalog
b_iblock_element (standard Bitrix catalog)
  + UF_BARCODE (string)
  + UF_COST (decimal)
  + UF_SERIAL_TRACKING (bool)
  + UF_MIN_STOCK (integer)
  + UF_SUPPLIER (string)

-- Warehouse/Container Definitions
b_catalog_store
  ID
  TITLE (e.g., "Central Warehouse", "Tech #5 Container")
  ACTIVE
  USER_ID (for containers - linked to technician user)
  TYPE (enum: 'warehouse', 'container')

-- Stock Levels (standard Bitrix)
b_catalog_store_product
  STORE_ID
  PRODUCT_ID
  AMOUNT (quantity)

-- Transfer Orders (custom table)
b_inventory_transfer
  ID
  SOURCE_STORE_ID
  DEST_STORE_ID
  STATUS (enum: 'draft', 'pending', 'completed', 'cancelled')
  CREATED_BY
  DATE_CREATE
  DATE_COMPLETE
  NOTES

-- Transfer Items
b_inventory_transfer_item
  TRANSFER_ID
  PRODUCT_ID
  QUANTITY
  SERIAL_NUMBER (if applicable)
  SCANNED (bool - for receiving confirmation)

-- Inventory Count
b_inventory_count
  ID
  STORE_ID (container being counted)
  STATUS (enum: 'in_progress', 'pending_review', 'completed')
  SNAPSHOT (JSON - system quantities at start)
  COUNTED_DATA (JSON - physical count results)
  VARIANCE_DATA (JSON - calculated differences)
  INITIATED_BY
  COUNTED_BY
  DATE_START
  DATE_COMPLETE

-- Audit Log
b_inventory_movement_log
  ID
  PRODUCT_ID
  STORE_FROM
  STORE_TO
  QUANTITY
  MOVEMENT_TYPE (enum: 'receive', 'transfer', 'deal_use', 'adjustment')
  REFERENCE_ID (Deal ID, Transfer ID, etc.)
  USER_ID
  DATE_CREATE
```

### API Endpoints

**For Mobile App:**

```
POST /api/inventory/scan
  - Scan barcode and return product info

POST /api/inventory/receive
  - Receive stock into container

POST /api/inventory/transfer/create
  - Create transfer order

POST /api/inventory/transfer/confirm
  - Confirm receipt of transfer

POST /api/inventory/count/start
  - Start stocktake

POST /api/inventory/count/scan
  - Add item to count

POST /api/inventory/count/complete
  - Finalize count

GET /api/inventory/container/{user_id}
  - Get technician's current inventory

POST /api/inventory/deal/add-product
  - Add product to deal (with deduction)
```

---

## Success Criteria

### Functional Requirements

- ✅ Multi-warehouse system supports central warehouses + technician containers
- ✅ All key workflows support barcode scanning as primary input method
- ✅ Technicians can only access inventory from their own container
- ✅ Real-time visibility into all inventory locations for managers
- ✅ Stocktaking produces accurate variance reports
- ✅ All inventory movements logged with complete audit trail
- ✅ Integration with Deal management (add parts, automatic deduction)
- ✅ Integration with Commission Report (accurate parts cost)
- ✅ Mobile app supports offline scanning with sync when online

### Performance Requirements

- ✅ Barcode scan → product lookup: < 0.5 seconds
- ✅ Add product to deal → inventory deduction: < 1 second
- ✅ Transfer order creation: < 30 seconds
- ✅ Stocktake completion → variance report: < 5 seconds
- ✅ Real-time inventory dashboard load: < 2 seconds

### User Experience Requirements

- ✅ Mobile interface optimized for one-handed use
- ✅ Large touch targets for scanning buttons
- ✅ Visual/audio confirmation for successful scans
- ✅ Clear error messages when item not in inventory
- ✅ Minimal data entry (barcode scanning preferred)
- ✅ Offline capability for all mobile workflows

---

## Risks & Mitigation

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| **Barcode scanning reliability** | High - core workflow dependency | - Test with variety of devices and lighting<br>- Provide manual entry fallback<br>- Support QR codes as alternative |
| **Offline sync conflicts** | Medium - data accuracy | - Implement conflict resolution rules<br>- Queue operations with timestamps<br>- Show sync status clearly to users |
| **Inventory shrinkage** | Medium - financial impact | - Regular mandatory stocktakes<br>- Variance threshold alerts<br>- Audit trail for all movements |
| **Adoption resistance** | Medium - change management | - Comprehensive training program<br>- Start with pilot group<br>- Demonstrate time savings |
| **Integration complexity** | High - technical delivery | - Phased rollout approach<br>- Thorough testing of integrations<br>- Clear API contracts |

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- Product catalog structure and import
- Multi-warehouse configuration
- Basic receiving workflow (central warehouse)
- Web interface for managers

### Phase 2: Mobile Core (Weeks 3-4)
- Mobile app barcode scanning
- Technician container management
- Receiving directly to containers
- Transfer order basics

### Phase 3: Deal Integration (Weeks 5-6)
- Add products to deals via scanning
- Automatic inventory deduction
- Container restriction enforcement
- Cost/price integration

### Phase 4: Advanced Features (Weeks 7-8)
- Stocktaking workflow
- Variance reporting
- Serial number tracking
- Purchase orders (optional)

### Phase 5: Optimization (Week 9)
- Offline capability
- Performance tuning
- Reporting enhancements
- User training and documentation

---

## Dependencies

**Technical Dependencies:**
- Bitrix24 Enterprise plan (for advanced catalog features)
- Mobile app with camera access (for barcode scanning)
- Bitrix24 REST API access
- Barcode scanner devices (optional, for warehouse)

**Business Dependencies:**
- Complete product catalog data
- Technician user accounts created
- Warehouse locations defined
- Initial inventory count completed

**Integration Dependencies:**
- Deal management system (Epic 2) must be implemented first
- Commission Report structure (Epic 7) must be defined
- User roles and permissions (Epic 11) must be configured
  
---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/PRODUCT_REQUIREMENTS_DOCUMENT.md)
- [Technical Requirements - Workiz Migration](../00_drafts/TR-Workiz.md)
- Deal Management Epic (to be created)
- Commission Report Epic (to be created)
