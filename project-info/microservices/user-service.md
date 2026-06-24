# User Service

## Overview

The `user-service` is the **authentication, authorization, and identity backbone** of the Locksmith FSM platform. Every other microservice depends on it for user identity, role-based access control, and technician lifecycle management.

**Owns:** Users, Roles, Permissions, Technician Profiles, Onboarding

**Integrations:** AWS Cognito, S3, KMS

**Events Published:** `tech.approved`, `tech.updated`

**Events Consumed:** None (provider-only service)

---

## DynamoDB Tables

| Table | Primary Key | Sort Key | GSIs |
|-------|-------------|----------|------|
| `Users` | `userId` | — | `email-index`, `role-index` |
| `TechnicianProfiles` | `userId` | — | `skillStatus-index`, `serviceArea-index` |
| `SkillApprovals` | `userId` | `skillId` | `status-index` |
| `CommissionConfigs` | `userId` | `effectiveDate` | — |

---

## Core Responsibilities

### 1. Authentication & Identity (AWS Cognito)

- Integrate with **AWS Cognito** for JWT token issuance, refresh, and validation
- Handle user **sign-up, login, password reset**, and email invitation flows
- Provide a shared RBAC middleware library (`@shared/auth`) consumed by all other services for JWT verification and role extraction
- Session/token caching via **Redis (ElastiCache)** for fast JWT validation without hitting Cognito on every request

### 2. User CRUD & Role Management

Full CRUD operations for all platform users across **5 roles** in a strict hierarchy:

```
TIER 1: SUPER ADMIN (Unrestricted)
  - Complete system access
  - All modules, all data, system settings, user management, billing

TIER 2: ADMIN (Full CRM, Restricted Settings)
  - Full CRM module access (all deals, clients, reports)
  - User management (excluding other admins)
  - CRM settings & configurations
  - No billing, no critical system settings

TIER 3: DEPARTMENT MANAGER (Full Department Access)
  - All deals in their department
  - Team visibility & management
  - Operational reports
  - No cross-department access, no consolidated financial reports

TIER 4: DISPATCHER (Standard Role)
  - Create/edit deals, full client access
  - Assigned/Pending deals only
  - Reports: call analysis, source tracking
  - No closed deals, no financial data

TIER 5: TECHNICIAN (Restricted Field Role)
  - ONLY assigned open deals
  - Invoice creation & payment collection
  - Mobile app features
  - No other technician's deals, no client data editing, no reporting
```

**Key rules:**
- A user can only manage users at a **lower tier**
- Role assignment happens at user creation
- Department assignment for scoped access

### 3. Permission Matrix & RBAC Enforcement

The service implements and serves a comprehensive permission matrix:

#### Entity-Level Permissions

| Entity | Admin | Manager | Dispatcher | Technician |
|--------|-------|---------|------------|------------|
| **Deals — View** | All | All | All open | Assigned only |
| **Deals — Create** | Yes | Yes | Yes | No |
| **Deals — Edit** | Yes | Yes | Yes | Limited (own) |
| **Deals — Delete** | Yes | No | No | No |
| **Deals — Stage Change** | All stages | All stages | Pending stages | In Progress only |
| **Clients — View** | All | All | All | Assigned only |
| **Clients — Create/Edit** | Yes | Yes | Yes | No |
| **Clients — Delete** | Yes | No | No | No |
| **Clients — Merge** | Yes | No | No | No |
| **Reports — Commission** | Yes | Team | No | Own only |
| **Reports — Performance** | Yes | Yes | Limited | Own only |
| **Reports — Financial** | Yes | No | No | No |
| **Settings — CRM Config** | Yes | No | No | No |
| **Settings — User Mgmt** | Yes (limited) | No | No | No |
| **Settings — Billing** | Super Admin | No | No | No |

#### Deal Stage Transition Rules by Role

```
TECHNICIAN:
  Can: In Progress -> Job Accepted -> In Progress -> Job Done
  Cannot: Submitted -> Assigned, Job Done -> Done (final stage)

DISPATCHER:
  Can: Submitted -> Pending stages, within Pending stages
  Cannot: Move to "In Progress" or "Done"

SHIFT MANAGER:
  Can: Move between ANY stages, finalize to "Done", cancel
```

**Implementation:**
- Expose permission-check endpoints or library methods for other services to query
- Architecture is **future-ready for field-level permissions** (schema supports it, not enforced in Phase 1)

### 4. Technician Profile Management

Technician profiles have their own complex lifecycle with the following data:

#### Basic Profile Data
- Name, email, phone
- Home address with **geocoded coordinates** (latitude/longitude for dispatch distance calculations)
- Profile photo

#### Sensitive Documents (Encrypted Storage)
- **Driver's License** — photo upload to S3 with KMS encryption
- **Social Security Number (SSN)** — encrypted at rest (AES-256 via AWS KMS)
- **Bank account info** — encrypted at rest (AES-256 via AWS KMS)
- **Emergency contact** — name, phone, relationship

**Security requirements:**
- All sensitive data encrypted at rest using AES-256 via AWS KMS
- Documents stored in S3 with KMS encryption
- Access logging for all sensitive data reads (audit compliance)
- Data protection regulation compliance

#### Operational Settings
- Labor cost per hour (set by manager)
- Call masking: enabled/disabled
- GPS tracking: enabled/disabled
- Mobile app status: installed/not installed
- Profile status: `pending` | `active` | `inactive`

#### Profile Completion Tracking
- Checklist/status system ensuring all required fields are filled before the technician is marked active
- Admin dashboard visibility into incomplete profiles

### 5. Technician Onboarding Workflow

A multi-step onboarding flow:

```
Step 1: Initial Account Creation (Admin)
  - Admin creates account with Name + Email ONLY
  - System sends email invitation via Cognito

Step 2: Invitation Acceptance (Technician)
  - Technician clicks invitation link
  - Sets password
  - Logs into platform

Step 3: Profile Self-Fill (Technician)
  - Phone number
  - Home address (geocoded for dispatch)
  - Driver's License photos (front/back upload)
  - SSN (encrypted storage)
  - Emergency contact (name, phone, relationship)
  - Bank account for payouts (encrypted storage)
  - Profile photo

Step 4: Skill Proposal (Technician)
  - Selects Job Types (skills) they can perform
  - Selects Service Areas (metro areas) they can cover
  - Submits for manager approval
  - Status: "Pending Approval"

Step 5: Skill Review & Approval (Manager)
  - Manager opens technician profile
  - Reviews proposed Job Types and Service Areas
  - Approves or rejects each skill individually
  - Sets Labor Cost per Hour
  - Confirms skill approval

Step 6: Commission Configuration (Manager)
  - Sets Base Rate (e.g., 40%)
  - Configures fee deductions (credit card 3%, ACH 0%)
  - Sets effective date

Step 7: Mobile App Setup (Technician)
  - Installs mobile app
  - Logs in with credentials
  - GPS tracking automatically enabled on clock-in
  - Push notifications enabled
  - Call masking feature activated

Step 8: Onboarding Complete
  - Profile status: "Active"
  - Skills status: "Approved"
  - Technician is now assignable to jobs
  - System publishes `tech.approved` event
```

### 6. Skill Management & Approval Workflow

#### Skill Types
- **Job Types** — what the technician can do (e.g., Locksmith, Lock Installation, Rekeying, Master Key Systems)
- **Service Areas** — where the technician can work (e.g., Atlanta, North Georgia)

#### Approval Flow
1. Technician proposes new skills (job types and/or service areas)
2. Each proposal gets status: `pending` -> `approved` | `rejected`
3. **Manager must approve** before the technician becomes eligible for matching job assignments
4. Manager can add **comments** to approval/rejection

#### Skill Lifecycle
- Technician can propose new skills at any time (e.g., after completing training)
- Manager receives **notification** of pending skill proposals
- SLA for skill approvals: **24 hours** with escalation workflow
- Skills can be **revoked** by managers if needed
- Full **audit trail**: who proposed, who reviewed, when, comments

#### Events
- On skill approval: publish `tech.approved` event via SNS
  - Consumed by `deal-service` to update assignment eligibility
- On profile update: publish `tech.updated` event via SNS

### 7. Commission Configuration

Per-technician commission settings:

```
Base Rate: configurable % of profit after parts and fees (e.g., 40%)

Fee Deductions (from commission):
  - Credit Card Fee: configurable % of deal total (default 3%)
  - ACH Fee: configurable (default 0%)

Commission Calculation Formula:
  Revenue - Tax - Parts Cost = Base Profit
  Tech Share = Base Profit x Base Rate %
  Deductions = Deal Total x CC Fee % (if paid by card)
  Net Tech Payout = Tech Share - Deductions
```

- Effective date tracking for commission rate changes
- Commission config exposed to `reporting-service` for payout calculations
- Historical commission rates preserved for accurate retroactive reporting

---

## API Endpoints

### User Management

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/api/users` | Create new user account | Admin+ |
| `GET` | `/api/users` | List users (with filters: role, status, department) | Admin+ |
| `GET` | `/api/users/:id` | Get user by ID | Admin+ or self |
| `PUT` | `/api/users/:id` | Update user | Admin+ or self (limited) |
| `DELETE` | `/api/users/:id` | Deactivate user | Admin+ |
| `POST` | `/api/users/:id/invite` | Resend email invitation | Admin+ |

### Authentication

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/api/auth/login` | Login (Cognito) | Public |
| `POST` | `/api/auth/refresh` | Refresh JWT token | Authenticated |
| `POST` | `/api/auth/password-reset` | Request password reset | Public |
| `POST` | `/api/auth/password-reset/confirm` | Confirm password reset | Public |

### Technician Profiles

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `GET` | `/api/technicians/:id/profile` | Get technician profile | Manager+ or self |
| `PUT` | `/api/technicians/:id/profile` | Update technician profile (self-fill) | Self |
| `GET` | `/api/technicians` | List technicians (with filters) | Manager+ |
| `GET` | `/api/technicians/:id/onboarding-status` | Get onboarding completion status | Manager+ or self |

### Skill Management

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/api/technicians/:id/skills/propose` | Propose new skills | Self (technician) |
| `GET` | `/api/technicians/:id/skills` | Get all skills with statuses | Manager+ or self |
| `GET` | `/api/technicians/:id/skills/pending` | Get pending skill approvals | Manager+ |
| `POST` | `/api/technicians/:id/skills/:skillId/approve` | Approve a skill | Manager+ |
| `POST` | `/api/technicians/:id/skills/:skillId/reject` | Reject a skill | Manager+ |
| `DELETE` | `/api/technicians/:id/skills/:skillId` | Revoke an approved skill | Manager+ |

### Commission

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `GET` | `/api/technicians/:id/commission` | Get commission config | Manager+ or self |
| `POST` | `/api/technicians/:id/commission` | Set/update commission config | Manager+ |
| `GET` | `/api/technicians/:id/commission/history` | Get commission config history | Manager+ |

### Permissions (Internal/Library)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `GET` | `/api/permissions/:userId` | Get user permissions | Internal services |
| `POST` | `/api/permissions/check` | Check if user has permission for action | Internal services |

### Sensitive Documents

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/api/technicians/:id/documents` | Upload sensitive document (DL, etc.) | Self |
| `GET` | `/api/technicians/:id/documents/:docType` | Get document (presigned S3 URL) | Manager+ or self |
| `DELETE` | `/api/technicians/:id/documents/:docType` | Delete document | Admin+ |

---

## Integration Points

### Services That Depend on user-service

| Service | What It Needs | How |
|---------|---------------|-----|
| **All services** | JWT validation + role extraction | `@shared/auth` library (middleware) |
| **deal-service** | Technician skills, service areas, coordinates | API call or cached data for assignment algorithm |
| **telephony-service** | Call masking config per technician | API call |
| **inventory-service** | Technician ID for container (van) creation | API call on tech activation |
| **reporting-service** | Commission config for payout calculations | API call |
| **payment-service** | Fee deduction config for commission calc | API call |
| **crm-service** | User identity for contact ownership | `@shared/auth` middleware |

### Shared Library: `@shared/auth`

Exported as an npm package within the NestJS monorepo, this library provides:
- **JWT validation guard** — verifies Cognito-issued tokens
- **RBAC decorator** — `@Roles('admin', 'manager')` for endpoint protection
- **Role extraction** — parses role from Cognito token claims
- **Permission check utility** — validates entity-level access

---

## Events

### Published Events (via SNS)

| Event | Payload | Consumers |
|-------|---------|-----------|
| `tech.approved` | `{ technicianId, approvedSkills, serviceAreas }` | `deal-service` (update assignment pool) |
| `tech.updated` | `{ technicianId, changedFields }` | `deal-service` (re-index), `reporting-service` |

### Consumed Events

None. The user-service is a **provider-only** service.

---

## Security Requirements

- SSN and bank account info encrypted at rest using **AES-256 via AWS KMS**
- Driver's license photos stored in **S3 with KMS encryption**
- Access logging for **all sensitive data reads** (audit compliance)
- JWT tokens validated on every request
- Session validation with Redis caching
- **Audit log** tracks permission violations and sensitive data access
- No unauthorized data exposure via API
- Compliance with data protection regulations

---

## Performance Requirements

- Onboarding form loads within **2 seconds**
- Profile save completes within **1 second**
- Commission calculation takes **< 0.5 seconds**
- JWT validation (cached) **< 50ms**
- Permission check **< 100ms**

---

## Key Architectural Decisions

1. **AWS Cognito** for identity — managed service, no custom auth server to maintain
2. **Shared `@shared/auth` library** — avoids every service re-implementing JWT validation
3. **DynamoDB** for user/profile storage — fits access patterns (single-entity lookups by ID, GSI for email/role queries)
4. **S3 + KMS** for document storage — industry standard for encrypted file storage
5. **Redis caching** for JWT/session — reduces Cognito calls, sub-50ms validation
6. **Event-driven skill updates** — other services react to `tech.approved`/`tech.updated` instead of polling
7. **Separate TechnicianProfiles table** — isolates sensitive data and supports independent scaling from the Users table
