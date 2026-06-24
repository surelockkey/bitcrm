# EPIC 11: User Roles & Permissions

---

## Overview

This epic covers the implementation of a flexible, multi-layered role and permission system in Bitrix24 that reflects the company's hierarchical structure. The system ensures each employee has appropriate access to information and functionality based on their role, with granular control at entity, stage, and field levels enabling future security enhancements.

---

## Business Objectives

1. **Role-Based Access:** Clear hierarchy (Super Admin → Admin → Manager → Standard → Technician)
2. **Data Security:** Restrict access to sensitive information by role
3. **Operational Control:** Prevent unauthorized deal modifications or status changes
4. **Scalability:** Support future field-level and stage-level permissions
5. **Audit Compliance:** Track who accessed what and when
6. **Flexibility:** Easy reconfiguration as business needs evolve

---

## Key User Personas

### Super Admin
- **Goals:** Manage all system aspects, ensure compliance
- **Pains:** Needs unrestricted access for troubleshooting
- **Needs:** Complete system access, user management, audit logs

### Administrator
- **Goals:** Manage users, configure business processes, maintain data
- **Pains:** Some system settings should not be changed (billing, core config)
- **Needs:** Full CRM access, user management, but restricted from critical settings

### Shift Manager
- **Goals:** Oversee team, make operational decisions, review performance
- **Pains:** Need to see all deals but can't change certain configs
- **Needs:** Deal access, team visibility, but not financial reports access

### Dispatcher
- **Goals:** Manage daily operations, create and update deals
- **Pains:** Should not see closed deals, shouldn't access other departments
- **Needs:** Current deals access, client management, assignment capability

### Technician
- **Goals:** See assigned work, update job status, collect payments
- **Pains:** Currently sees too much data (other techs' jobs, confidential info)
- **Needs:** Only assigned deals, limited CRM access, no financial reporting

---

## Core Concepts

### Role Hierarchy

```
┌──────────────────────────────────────────────────────┐
│              ROLE HIERARCHY                          │
├──────────────────────────────────────────────────────┤
│
│ TIER 1: SUPER ADMIN (Unrestricted)
│ └─ Complete system access
│    - All modules
│    - All data
│    - System settings
│    - User management
│    - Billing & subscription
│
│ TIER 2: ADMIN (Full CRM, Restricted Settings)
│ └─ Full CRM module access
│    - All deals, clients, reports
│    - User management (excluding admins)
│    - CRM settings & configurations
│    - ❌ Billing & subscription
│    - ❌ Critical system settings
│
│ TIER 3: DEPARTMENT MANAGER (Full Dept Access)
│ └─ Manager role (e.g., "Dispatch Manager")
│    - All deals in department
│    - Team visibility & management
│    - Operational reports
│    - ❌ Other departments
│    - ❌ Financial reports (consolidated)
│
│ TIER 4: STANDARD ROLES
│ ├─ "Dispatcher" Role
│ │  └─ Create/edit deals
│    - Clients (full access)
│    - Assigned/Pending deals only
│    - Reports (call analysis, source tracking)
│    - ❌ Closed deals
│    - ❌ Financial data
│
│ ├─ "Shift Manager" Role
│ │  └─ Operational oversight
│    - All open deals (any status)
│    - Team performance reports
│    - Commission reports (with restrictions)
│    - ❌ Closed deal edits
│
│ └─ "Technician" Role
│    └─ Highly restricted field roles
│    - ONLY assigned open deals
│    - Invoice creation & payment collection
│    - Mobile app features
│    - ❌ Other technician's deals
│    - ❌ Client data editing
│    - ❌ Any reporting
│
└──────────────────────────────────────────────────────┘
```

### Permission Matrix

```
┌────────────────────────────────────────────────────────────────┐
│                    PERMISSION MATRIX                           │
├──────────────┬──────┬────────┬──────────┬────────┬────────────┤
│ Entity       │ Admin│Manager │Dispatcher│Tech    │ Technician │
├──────────────┼──────┼────────┼──────────┼────────┼────────────┤
│ DEALS        │      │        │          │        │            │
│ View         │ All  │ All    │ All      │ Open   │ Assigned   │
│ Create       │ Yes  │ Yes    │ Yes      │ No     │ No         │
│ Edit         │ Yes  │ Yes    │ Yes      │ Own    │ Limited    │
│ Delete       │ Yes  │ No     │ No       │ No     │ No         │
│ Change Stage │ All  │ All    │ Pending* │ In Prog│ In Prog    │
│              │      │        │          │        │ only       │
│ CLIENTS      │      │        │          │        │            │
│ View         │ All  │ All    │ All      │ No     │ Assigned   │
│ Create/Edit  │ Yes  │ Yes    │ Yes      │ No     │ No         │
│ Delete       │ Yes  │ No     │ No       │ No     │ No         │
│ Merge        │ Yes  │ No     │ No       │ No     │ No         │
│              │      │        │          │        │            │
│ REPORTING    │      │        │          │        │            │
│ Commission R │ Yes  │ Team   │ No       │ No     │ Own only   │
│ Performance  │ Yes  │ Yes    │ Limited  │ No     │ Own only   │
│ Financial    │ Yes  │ No     │ No       │ No     │ No         │
│ Audit Log    │ Yes  │ Own    │ Own      │ No     │ No         │
│              │      │        │          │        │            │
│ SETTINGS     │      │        │          │        │            │
│ CRM Config   │ Yes  │ No     │ No       │ No     │ No         │
│ User Mgmt    │ Yes* │ No     │ No       │ No     │ No         │
│ Billing      │ Yes  │ No     │ No       │ No     │ No         │
│              │      │        │          │        │            │
└──────────────┴──────┴────────┴──────────┴────────┴────────────┘

* Limited or with restrictions shown
```

### Deal Stage Access

```
TECHNICIAN can only move deals in "In Progress" stages:
  ✅ Can change: In Progress → Job Accepted
  ✅ Can change: Job Accepted → In Progress
  ✅ Can change: In Progress → Job Done
  ❌ Cannot: Submitted → Assigned
  ❌ Cannot: Job Done → Done (final stage)

DISPATCHER can move deals in "Pending" stages + creation:
  ✅ Can change: Submitted → Pending [ANY PENDING STATUS]
  ✅ Can change: Within Pending stages (No Answer ↔ Follow-up)
  ❌ Cannot: Move to "In Progress" (that's manager/assignment)
  ❌ Cannot: Move to "Done" (final stage)

SHIFT MANAGER has unrestricted deal stage access:
  ✅ Can move between ANY stages
  ✅ Can finalize deals to "Done"
  ✅ Can move to "Canceled"
```

### Field-Level Permissions (Future Capability)

```
Current Phase: NOT enforced, but architecture supports

Future Capability:
  Role "Technician" → Deal Card:
    ✅ View: All fields
    ✅ Edit: Job status, invoice data, payments
    ❌ View: Company Parts Cost (confidential)
    ❌ Edit: Tech Parts Cost

  Role "Dispatcher" → Commission Report:
    ✅ View: Own commission data (if self-assigned deals)
    ❌ View: Other technician commissions
    ❌ View: Company profitability

This architecture is future-ready but not implemented in Phase 1
```

---

## Core Workflows

### 1. User Creation & Role Assignment

```
Super Admin creates new dispatcher:

STEP 1: Create User
  Name: Sarah Johnson
  Email: sarah@company.com
  Phone: 404-555-1234

STEP 2: Assign Role
  Role: "Dispatcher"
  Department: [Atlanta Division ▼]
  Team: [Dispatch Team ▼]

STEP 3: Permissions Applied
  System automatically grants:
  ✅ Deals: View all, Create new, Edit open
  ✅ Clients: View all, Create, Edit
  ✅ Calls: View, Create
  ✅ Reports: Call analysis, source tracking
  ❌ Inventory: No access
  ❌ Commission reports: No access
  ❌ Financial reports: No access

STEP 4: Confirm
  Sarah receives email invitation
  Sets password
  Logs in with assigned permissions
```

### 2. Technician Access Control

```
Technician "John" logs into Bitrix24:

Deal List View:
  Shows ONLY deals assigned to John in open statuses:
  ✅ Deal #123 (In Progress - accepted)
  ✅ Deal #124 (In Progress - work underway)
  ✅ Deal #125 (Submitted - just assigned)

  Hidden from John:
  ❌ Deal #99 (assigned to Sarah the dispatcher)
  ❌ Deal #88 (closed/done)
  ❌ Deal #77 (in "Pending" stage - dispatcher's domain)

Clicks on Deal #123:
  Can see:
  ✅ Customer details (name, phone, address)
  ✅ Job description
  ✅ Invoice and payment section
  ✅ [Create Invoice] button
  ✅ [Collect Payment] section
  ✅ Timeline/notes

  Cannot see:
  ❌ Estimate/pricing history
  ❌ Dispatcher notes (if marked confidential)
  ❌ Company Parts Cost (if separated)

Can perform:
  ✅ Change deal status (within In Progress stages)
  ✅ Add notes/timeline updates
  ✅ Create invoice
  ✅ Accept payments
  ✅ Call/SMS client

  Cannot perform:
  ❌ Delete deal
  ❌ Reassign deal
  ❌ View/edit client company data
  ❌ Access reports
```

### 3. Manager Oversight

```
Shift Manager opens CRM:

Deal Dashboard:
  Can see: ALL open deals (any status)
  - Submitted: 5 deals
  - In Progress: 12 deals
  - Pending: 8 deals
  Total: 25 open deals

Commission Report (if configured):
  Can view:
  ✅ Team commission report (all tech on this shift)
  ✅ Technician performance metrics
  ✅ Revenue by job type

  Cannot view:
  ❌ Individual technician commission breakdown details
  ❌ Company profitability/profit margins

Call Analysis:
  Can view:
  ✅ Call sources and conversion rates
  ✅ Dispatcher call handling stats
  ✅ Missed call analysis

  Cannot view:
  ❌ Consolidated financial reports
```

---

## Integration Points

### Integration with Deal Management (Epic 2)

- Deal stage transitions governed by role permissions
- Technician field restricts deal visibility
- Status restrictions enforced at creation

### Integration with Technician Profiles (Epic 6)

- Technician user account assigned "Technician" role
- Call masking enabled based on role
- Mobile app access enabled based on role

### Integration with All Modules

- Every entity (Deal, Client, Inventory, Report) respects role permissions
- Consistent permission model across all modules
- API endpoints validate permissions on every call

---

## Technical Architecture

### Bitrix24 Permission Implementation

```sql
-- Bitrix24 Permission Groups (native)
b_group (standard)
  ID
  NAME (e.g., "Dispatcher", "Technician")
  TIMESTAMP_X
  DESCRIPTION

-- Permission Assignment (standard)
b_group_sonet_group (links roles to features)
  GROUP_ID
  SONET_GROUP_ID

-- Custom Permission Storage (if needed)
b_crm_permission_override
  ID
  USER_ID
  ENTITY_TYPE (deal, client, inventory, etc.)
  ENTITY_ID
  PERMISSION_TYPE (view, edit, delete)
  GRANT_TYPE (allow, deny)
  CREATED_BY
  DATE_CREATE
```

### API Permission Checking

```
Before every API call:

1. Identify user role
2. Check entity type and ID
3. Validate permission:
   - Role-based matrix
   - Custom overrides
   - Field-level (future)
4. Allow or Deny

Example:
  GET /api/deal/123
  → Check role permissions for Deal access
  → If Technician: Verify they own Deal #123
  → If Dispatcher: Allow (all deals)
  → If Admin: Allow (all)
```

---

## Success Criteria

### Functional Requirements

- ✅ Roles defined and configurable in Bitrix24
- ✅ Deal visibility enforced by role
- ✅ Stage transition permissions enforced
- ✅ Technician access restricted to assigned deals
- ✅ Client data access controlled by role
- ✅ Report access limited by role
- ✅ Admin functions restricted to appropriate roles
- ✅ Permissions apply across all interfaces (web, mobile, API)

### Security Requirements

- ✅ No unauthorized data exposure via API
- ✅ Technician cannot see other technician's deals
- ✅ Sensitive reports restricted to authorized roles
- ✅ Audit log tracks permission violations
- ✅ Session validation on every request

### Usability Requirements

- ✅ Users see only data they have permission to access
- ✅ Clear error messages for permission denials
- ✅ No confusing restricted features in UI
- ✅ Role configuration intuitive for admins

---

## Risks & Mitigation

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| **Permission bypasses** | Critical - security | - Thorough security testing<br>- API permission validation<br>- Regular audits<br>- Penetration testing |
| **Over-restrictive permissions** | Medium - usability | - Start permissive<br>- Gather feedback<br>- Iterative tightening<br>- Clear documentation |
| **Complex rules causing confusion** | Medium - adoption | - Start simple (role-based only)<br>- Clear permission matrix<br>- Training for admins<br>- Support documentation |
| **Accidental permission removal** | Medium - operations | - Audit log of changes<br>- Admin approval for changes<br>- Backup permission sets<br>- Easy rollback |
| **Role proliferation** | Low - admin burden | - Limit custom roles<br>- Standard roles template<br>- Regular role review<br>- Consolidation policy |

---

## Dependencies

**Integration Dependencies:**
- Deal Management (Epic 2) for stage permissions
- Technician Profiles (Epic 6) for role assignment
- All other modules for permission enforcement

---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/prd.md)
- [Technical Requirements - Workiz Migration](../00_drafts/TR-Workiz.md)
- Deal Management Epic (Epic 2)
- Technician Onboarding Epic (Epic 6)
- All other epics for permission integration
