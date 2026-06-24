# EPIC 6: Technician Onboarding & Profile Management

---

## Overview

This epic covers the complete lifecycle management of technicians from initial onboarding through daily operations. The system starts with minimal data collection (Name + Email), allows technicians to self-fill their profiles, implements a skill approval workflow where managers must verify technician qualifications, and manages individual commission rates with transparent fee deductions. Integration with mobile app capabilities includes automatic GPS tracking and call masking.

---

## Business Objectives

1. **Streamlined Onboarding:** Minimal initial data (Name + Email), technician self-registration
2. **Data Security:** Secure collection and storage of sensitive documents (SSN, DL, bank account)
3. **Skill Verification:** Manager-approved skill assignments prevent false qualifications
4. **Commission Transparency:** Individual rate configuration with clear fee deductions
5. **Operational Integration:** Mobile app setup with automatic GPS tracking and call masking
6. **Accountability:** Complete technician profile and skill approval audit trail

---

## Key User Personas

### Logistics Manager/HR
- **Goals:** Onboard new technicians efficiently, maintain accurate profiles
- **Pains:** Manual data collection is scattered (emails, forms), sensitive data spread across tools
- **Needs:** Centralized onboarding workflow, secure document storage, audit trail

### Shift Manager
- **Goals:** Verify technician qualifications and assign jobs to qualified technicians
- **Pains:** Unsure which technicians are qualified for specific job types or areas, false skill claims
- **Needs:** Skill approval workflow, verified skill profiles, service area assignments, availability calendar

### Technician
- **Goals:** Get set up quickly, understand rates and expectations
- **Pains:** Onboarding process unclear, commission calculation opaque
- **Needs:** Clear setup instructions, mobile app training, commission rate transparency

### Finance/Admin
- **Goals:** Ensure accurate commission calculations, track technician fees
- **Pains:** Commission rules vary by technician, fee deductions inconsistent
- **Needs:** Configurable commission rules, transparent fee tracking

---

## Core Concepts

### Onboarding Workflow

```
Step 1: Initial Information (Logistics Department Receives)
  → Name
  → Email Address

Step 2: System Account Creation
  → Administrator creates Bitrix24 user account with "Technician" role
  → Administrator sends email invitation
  → Technician accepts and sets password

Step 3: Technician Self-Fills Profile
  → Logs into Bitrix24
  → Completes profile information:
    - Phone Number
    - Home Address
    - Driver's License Photo (upload)
    - Social Security Number (SSN)
    - Emergency Contact (Name, Phone, Relationship)
    - Bank Account (for payouts)
    - Profile photo

Step 4: Technician Proposes Skills
  → Technician selects Job Types (skills) they can perform
  → Technician selects Service Areas (metro areas) they can cover
  → Submits for manager approval
  → Status: "Pending Approval"

Step 5: Manager Reviews and Approves Skills
  → Manager opens technician profile
  → Reviews proposed Job Types and Service Areas
  → Approves or modifies skill assignments
  → Sets Labor Cost per Hour
  → Confirms skill approval

Step 6: Commission Configuration
  → Manager opens "Commissions" tab
  → Sets Base Rate (e.g., 40%)
  → Configures fee deductions

Step 7: Mobile App Setup
  → Technician installs Bitrix24 mobile app
  → Logs in with credentials
  → GPS tracking automatically enabled on clock-in
  → Push notifications enabled
  → Call masking feature activated

Step 8: Onboarding Complete
  → Profile status: "Active"
  → Technician ready for job assignments
```

### Technician Profile Structure

```
┌─────────────────────────────────────────────────┐
│          TECHNICIAN PROFILE                     │
├─────────────────────────────────────────────────┤
│
│ BASIC INFORMATION
│ ├─ Name: John Smith
│ ├─ Email: john@company.com
│ ├─ Phone: 404-555-0123
│ ├─ Home Address: 123 Main St, Atlanta, GA
│ ├─ Driver's License: [Document]
│ ├─ SSN: [Secured]
│ └─ Emergency Contact: Jane Smith (404-555-0124)
│
│ JOB QUALIFICATIONS
│ ├─ Job Types (Skills):
│ │  ☑ Locksmith
│ │  ☑ Lock Installation
│ │  ☑ Rekeying
│ │  ☐ Master Key Systems
│ │
│ └─ Service Areas:
│    ☑ Atlanta
│    ☑ North Georgia
│
│ OPERATIONAL
│ ├─ Labor Cost/Hour: $45
│ ├─ Call Masking: Enabled
│ ├─ GPS Tracking: Enabled
│ ├─ Status: Active
│ └─ Mobile App: Installed
│
│ COMMISSIONS
│ ├─ Base Rate: 40%
│ ├─ Credit Card Fee Deduction: 3%
│ └─ ACH Fee: None
│
│ AUDIT TRAIL
│ ├─ Created: 2025-01-15
│ ├─ Last Modified: 2025-11-11
│ └─ Inventory Counts: 12 completed
│
└─────────────────────────────────────────────────┘
```

### Commission Configuration

**Base Rate:**
```
Technician Commission: 40% of profit after parts and fees
(Configured per technician in profile)
```

**Fees (Deducted from Commission):**
```
Credit Card Fee: 3.0% of deal total (when paid by card)
ACH Fee: None (no deduction)
```

---

## Core Workflows

### 1. New Technician Onboarding

```
STEP 1: Logistics receives new hire info
  HR: "New tech starting: John Smith, john@email.com"

STEP 2: Admin creates Bitrix24 account
  Creates user account with "Technician" role
  Sends email invitation to john@email.com
  Email: "Welcome to [Company] - Set Up Your Account"

STEP 3: Technician accepts invitation
  Clicks invitation link
  Sets password
  Logs into Bitrix24

STEP 4: Technician completes profile
  Fills in required information:
    - Phone number
    - Home address
    - Driver's License photos (front/back)
    - SSN
    - Emergency contact (name, phone, relationship)
    - Bank account for payouts
    - Profile photo
  Saves profile

STEP 5: Technician proposes skills
  Selects Job Types: Locksmith, Installation, Rekeying
  Selects Service Areas: Atlanta, North Georgia
  Clicks "Submit for Approval"
  Status: "Pending Manager Approval"

STEP 6: Manager reviews and approves skills
  Opens technician profile
  Reviews proposed skills:
    ✓ Locksmith - Approved
    ✓ Installation - Approved
    ✓ Rekeying - Approved
  Sets Labor Cost: $45/hour
  Clicks "Approve Skills"

STEP 7: Manager configures commission
  Opens "Commissions" tab
  Sets:
    - Base Rate: 40%
    - Credit Card Fee: 3%
  Saves commission configuration

STEP 8: Technician installs mobile app
  Downloads Bitrix24 app
  Logs in with credentials
  GPS tracking automatically enabled
  Push notifications enabled
  Call masking activated

STEP 9: Onboarding complete
  Profile status: "Active"
  Skills status: "Approved"
  Ready for job assignments
```

### 2. Managing Technician Skills

```
Scenario: Technician acquires new skill

STEP 1: Technician completes training
  John Smith completes Master Key Systems certification

STEP 2: Technician proposes new skill
  Opens profile → "Skills" section
  Adds: Master Key Systems
  Clicks "Submit for Approval"
  Status: "Pending Manager Approval"

STEP 3: Manager receives notification
  Email: "John Smith proposed new skill: Master Key Systems"
  Manager opens technician profile

STEP 4: Manager reviews and approves
  Reviews skill: Master Key Systems
  Verifies certification/training completion
  Clicks "Approve Skill"
  Status: "Approved"

STEP 5: Updated skill used for job assignment
  Dispatcher needs to assign specialty job:
    Job Type: "Master Key Installation"

  System shows qualified technicians:
    ├─ Sarah Jones (has Master Key ✓)
    ├─ Mark Davis (has Master Key ✓)
    └─ John Smith (has Master Key ✓) ← Newly approved

  Dispatcher can now assign John to Master Key jobs
```

### 3. Commission Rate Management

```
Technician Scenario:
  Invoice Total: $350
  Parts Cost: $45
  Tax: $28
  Paid by Credit Card

  Base Profit: $350 - $28 - $45 = $277

  Tech Commission Calculation:
    Base Rate: 40%
    Tech Share: $277 × 40% = $110.80

    Deductions:
      - Credit Card Fee: $350 × 3% = $10.50

    Net Tech Payout: $110.80 - $10.50 = $100.30

If paid via ACH:
    Tech Share: $277 × 40% = $110.80
    Deductions: None (ACH has no fee)
    Net Tech Payout: $110.80
```

---

## Integration Points

### Integration with Deal Management (Epic 2)

- Technician field linked to user profile
- Deal only visible to assigned technician
- Status transitions limited by technician role

### Integration with Scheduling (Epic 4)

- Job Types (skills) used for intelligent assignment
- Service Areas (metro) used for job filtering
- Availability pulled from technician's Bitrix24 calendar

### Integration with Telephony (Epic 1)

- Call masking enabled in profile configuration
- Technician phone masking rules applied
- SMS routing to masked number

### Integration with Inventory (Epic 5)

- Technician container (van inventory) created
- Inventory access restricted to own container
- Stocktake assignments to specific technicians

### Integration with Commission Report (Epic 7)

- Base rate applied per technician
- Fee deductions configured (credit card 3%, ACH 0%)
- Commission calculations accurate and transparent

---

## Key Features

This epic includes the following key features:

### 1. Onboarding Workflow
- Admin creates account with Name + Email only
- Email invitation and password setup
- Technician self-fills profile data (phone, address, DL, SSN, emergency contact, bank account)
- Profile completion checklist and status tracking

### 2. Skill Management & Approval
- Technician proposes skills (job types & service areas)
- Manager approval workflow with notifications
- Skill status tracking (pending/approved/rejected)
- Approval history and audit trail
- Manager sets labor cost per hour

### 3. Commission Management
- Base rate configuration per technician
- Fee deduction setup (credit card 3%, ACH 0%)
- Commission calculation integration with Deal module
- Transparent commission reporting

### 4. Mobile App Setup & Access Control
- Mobile app download and login instructions
- GPS tracking (auto-enabled on clock-in)
- Push notification setup
- Call masking activation
- Technician role permissions
- Deal visibility restrictions (only assigned jobs)
- Inventory container restrictions (own van only)

---

## Technical Architecture

### Database Schema

```sql
-- Technician Extended Profile
b_user (extended)
  UF_JOB_TYPES (multi-select: Locksmith, Install, Rekey, etc.)
  UF_JOB_TYPES_STATUS (enum: pending, approved, rejected)
  UF_SERVICE_AREAS (multi-select: Atlanta, North GA, etc.)
  UF_SERVICE_AREAS_STATUS (enum: pending, approved, rejected)
  UF_LABOR_COST_HOUR (decimal)
  UF_HOME_ADDRESS (text)
  UF_DL_PHOTO (file)
  UF_SSN (encrypted text)
  UF_EMERGENCY_CONTACT (text)
  UF_BANK_ACCOUNT (encrypted text)
  UF_ONBOARDING_STATUS (enum: pending, active, inactive)
  UF_GPS_ENABLED (bool)
  UF_CALL_MASKING_ENABLED (bool)

-- Skill Approval History
b_technician_skill_approval
  ID
  USER_ID (int, foreign key to b_user)
  SKILL_TYPE (enum: job_type, service_area)
  SKILL_VALUE (string)
  STATUS (enum: pending, approved, rejected)
  PROPOSED_BY (int, technician user_id)
  REVIEWED_BY (int, manager user_id)
  PROPOSED_DATE (datetime)
  REVIEWED_DATE (datetime)
  COMMENTS (text)

-- Commission Configuration
b_technician_commission
  ID
  USER_ID
  BASE_RATE (decimal 0-100)
  CREDIT_CARD_FEE (decimal, default 3.0)
  EFFECTIVE_DATE
  CREATED_BY
  MODIFIED_BY
```

### API Endpoints

```
POST /api/technician/onboarding/create
  - Create new technician Bitrix24 account

POST /api/technician/{user_id}/profile/update
  - Technician updates their own profile data

GET /api/technician/{user_id}/profile
  - Retrieve technician profile

POST /api/technician/{user_id}/skills/propose
  - Technician proposes new skills for approval
  Body: {
    job_types: ["Locksmith", "Installation"],
    service_areas: ["Atlanta", "North Georgia"]
  }
  Response: { status: "pending", approval_required: true }

POST /api/technician/{user_id}/skills/approve
  - Manager approves or rejects proposed skills
  Body: {
    skill_type: "job_type",
    skill_value: "Master Key Systems",
    status: "approved",
    comments: "Certification verified"
  }

GET /api/technician/{user_id}/skills/pending
  - Get all pending skill approvals for a technician

POST /api/technician/{user_id}/commission
  - Update commission configuration

GET /api/technician/{user_id}/commission/calculate
  - Calculate commission for given deal
```

---

## Success Criteria

### Functional Requirements

- ✅ Admin creates technician account with Name + Email only
- ✅ Technician self-fills profile data securely
- ✅ Secure document storage (encrypted for SSN, DL, bank account)
- ✅ Technician proposes skills for manager approval
- ✅ Manager can approve/reject proposed skills
- ✅ Skill approval workflow with status tracking
- ✅ Commission calculations accurate with base rate and fee deductions
- ✅ Mobile app GPS tracking automatically enabled
- ✅ Call masking feature activation
- ✅ Profile audit trail captures all changes

### Data Security Requirements

- ✅ SSN encrypted at rest and in transit
- ✅ Driver's license photos stored securely
- ✅ Bank account info encrypted
- ✅ Access logs for sensitive data
- ✅ Compliance with data protection regulations

### Performance Requirements

- ✅ Onboarding form loads within 2 seconds
- ✅ Profile save completes within 1 second
- ✅ Commission calculation takes <0.5 seconds

---

## Risks & Mitigation

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| **Sensitive data breach** | Critical - legal/compliance | - Encrypt SSN and bank data<br>- Access logging<br>- Regular security audits<br>- Compliance review |
| **Incomplete technician setup** | Medium - operational issues | - Onboarding checklist<br>- Status indicators<br>- Admin reminders<br>- Validation on completion |
| **Skill approval delays** | High - technician cannot work | - Automated notifications to managers<br>- SLA for skill approvals (24 hours)<br>- Escalation workflow<br>- Dashboard for pending approvals |
| **False skill claims** | High - job assignment failures | - Manager verification required<br>- Certification documentation<br>- Skill approval history<br>- Ability to revoke skills |
| **Mobile app adoption** | Medium - GPS tracking gaps | - In-person training<br>- Clear instructions<br>- Tech support hotline<br>- Incentives for adoption |
| **Profile data accuracy** | Medium - assignment failures | - Validation on save<br>- Regular audits<br>- Manager sign-off<br>- Sync with HR system |

---

## Dependencies

**Integration Dependencies:**
- Deal Management (Epic 2) for role-based access
- User Roles & Permissions (Epic 11) for "Technician" role
- Mobile App (for GPS and call masking)
- Inventory Management (Epic 5) for container setup

---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/prd.md)
- [Technical Requirements - Workiz Migration](../00_drafts/TR-Workiz.md)
- Deal Management Epic (Epic 2)
- Scheduling & Dispatching Epic (Epic 4)
- Commission Report Epic (Epic 7)
- User Roles & Permissions Epic (Epic 11)
