# EPIC 8: CRM Client Base Management

---

## Overview

This epic covers the establishment of a structured and reliable client database in Bitrix24 by migrating historical data from Workiz. The system supports clear client segmentation by type (Residential, Commercial, Government), maintains hierarchical relationships between companies and contacts, and provides administrators with tools to ensure data integrity through deduplication and email linkage.

---

## Business Objectives

1. **Data Migration:** Establish client base from Workiz with data integrity
2. **Client Segmentation:** Clear typing (Residential, Commercial, Government)
3. **Organizational Structure:** Company → Contact hierarchy with relationship tracking
4. **Data Quality:** Deduplication tools and duplicate prevention
5. **Email Integration:** Link emails to clients for deal creation workflows
6. **Single Source of Truth:** All client interactions unified in Bitrix24

---

## Key User Personas

### Dispatcher
- **Goals:** Quickly find/create clients, access client history
- **Pains:** Duplicate client records cause confusion, manual search is slow
- **Needs:** Fast client lookup, clear company/contact separation, contact history

### Manager
- **Goals:** Maintain accurate client data, merge duplicates, audit client records
- **Pains:** Duplicates in system, orphaned contacts, email linking is manual
- **Needs:** Deduplication tools, bulk client management, email integration

### Administrator
- **Goals:** Ensure data integrity, prevent duplicates, manage client imports
- **Pains:** Manual deduplication is time-consuming, no validation rules
- **Needs:** Bulk import tools, validation rules, audit trail

### Client
- **Goals:** Consistent service, access their deal history, not repeated info collection
- **Pains:** Giving same information to multiple staff members
- **Needs:** Unified profile, clear interaction history

---

## Core Concepts

### Client Structure

```
┌─────────────────────────────────────────────────────┐
│           CLIENT BASE HIERARCHY                      │
├─────────────────────────────────────────────────────┤
│
│ COMPANY (Residential, Commercial, Government)
│ ├─ Name
│ ├─ Type: Commercial ← Client Type field
│ ├─ Phone
│ ├─ Email
│ ├─ Address
│ ├─ Website (if applicable)
│ ├─ Payment Terms (for Platinum clients)
│ ├─ Tax Exempt: Yes/No
│ ├─ W-9 Document (file)
│ ├─ COI Document (file)
│ └─ Contact List:
│    ├─ John Smith (Primary Contact)
│    ├─ Jane Smith (Secondary)
│    └─ Bob Johnson (Accounting)
│
│ CONTACT (individual person)
│ ├─ Name
│ ├─ Type: Residential or Company Representative
│ ├─ Email
│ ├─ Phone
│ ├─ Title (if company rep)
│ ├─ Department (if applicable)
│ └─ Deal History: [Deal #1, Deal #2, ...]
│
└─────────────────────────────────────────────────────┘
```

### Client Types

```
1. RESIDENTIAL
   - Individuals for home services
   - Single company card not necessary
   - Contact is the client

2. COMMERCIAL
   - Businesses with multiple properties/contacts
   - Company card with multiple contacts
   - Payment terms negotiated
   - W-9 and COI on file (Platinum)

3. GOVERNMENT
   - Government agencies and municipalities
   - Company card required
   - Work orders mandatory
   - Tax exempt status
   - Strict procurement rules
```

### Automatic Client Creation

```
FLOW: Inbound Call → Deal Creation

Step 1: Dispatcher receives call
  Phone: 404-555-0123
  System checks CRM: Phone not found

Step 2: Check contact lookup
  Name given: "John Smith"
  Company given: "Smith's Office Building"

Step 3: Auto-create if not found
  System creates:
    COMPANY: "Smith's Office Building" (Type: Commercial)
    CONTACT: "John Smith" (linked to company)
    DEAL: Associated with both

Step 4: Dispatcher can edit
  Can correct company type
  Can add additional details
  Deal process continues
```

---

## Core Workflows

### 1. Client Creation from Call

```
Inbound Call:
  Phone: 404-555-0123
  Caller Name: "John Smith"

Dispatcher answers:
  ↓
Dispatcher creates Deal:
  Opens Deal form
  Client section appears:
    - Phone: 404-555-0123 (auto-filled from call)
    - Name: [blank]
    - Company: [blank]

Dispatcher enters:
  - First Name: John
  - Last Name: Smith
  - Company: Smith's Consulting
  - Address: 123 Main St

System auto-creates:
  - COMPANY: Smith's Consulting (Type: blank, dispatcher must select)
  - CONTACT: John Smith (linked to company)
  - DEAL: Associated with both

Result:
  Company and Contact cards created
  All associated with Deal
  Future calls from same number route to John Smith
```

### 2. Merging Duplicate Clients

```
Manager identifies duplicates:
  - "ABC Supply Co." and "ABC Supply"
  - "John Smith" (contact 1) and "John S." (contact 2)

Manager opens deduplication tool:
  ↓
Step 1: Select primary record
  ABC Supply Co. (will be kept)
  ↓
Step 2: Select duplicate
  ABC Supply (will be merged)
  ↓
Step 3: Review merge
  All deals from duplicate → primary
  All contacts from duplicate → primary
  Duplicate card will be deleted
  ↓
Step 4: Confirm merge
  All history preserved on primary
  Duplicate permanently removed
```

### 3. Linking Email to Client

```
Email received from: john@smithconsulting.com
Subject: "Need emergency lockout service"

Email not in system yet

Dispatcher reviews email and recognizes:
  This is from Smith's Consulting (known client)

Dispatcher opens email in Bitrix24:
  ↓
Clicks "Link to Client"
  ↓
Searches for: "Smith" → Results show:
  - Smith's Consulting (Company)
  - John Smith (Contact in that company)
  ↓
Selects "Smith's Consulting"
  ↓
System links email:
  - Associates with company
  - Suggests adding john@smithconsulting.com to contact emails
  ↓
Dispatcher can now:
  - View all emails from this company
  - Create Deal directly from email
  - Track email communication in Deal timeline
```

### 4. Deal Creation from Linked Email

```
Manager has linked email to Smith's Consulting

Manager clicks "Create Deal from Email"
  ↓
System generates:
  DEAL:
    - Company: Smith's Consulting
    - Contact: John Smith (if only contact, auto-selected)
    - Job Description: [Populated from email body]
    - Email link: [Reference to original email]
  ↓
Dispatcher can edit:
  - Job type, service area, etc.
  - Can edit auto-populated description
  ↓
Deal ready for assignment
```

---

## Integration Points

### Integration with Deal Management (Epic 2)

- Client automatically linked to Deals
- Company/Contact cards show deal history
- Deal filters by client type possible

### Integration with Telephony (Epic 1)

- Inbound call automatically looks up client by phone
- Client details pre-fill Deal creation
- Pop-up shows existing client history

### Integration with Platinum Workflow (Epic 9)

- Company card stores W-9 and COI documents
- Payment terms configured
- Tax exempt status tracked

### Integration with Email (Google Workspace)

- Email addresses linked to contacts/companies
- Deal creation from email workflows
- Email history displayed in Deal timeline

---

## User Stories Breakdown

This epic is broken down into the following user stories:

1. **[Story 8.01: Automatic Client Creation from Calls](../stories/8.01-crm-auto-client-creation.md)**
   - Auto-create company/contact from Deal data
   - Phone number normalization and deduplication
   - E.164 format standardization
   - Integration with Epic 1 (Telephony) for call-based creation

2. **[Story 8.02: Duplicate Detection & Merging](../stories/8.02-crm-deduplication.md)**
   - Nightly duplicate detection job
   - Fuzzy matching algorithms (Levenshtein distance)
   - Manual merge workflow with history preservation
   - 30-day rollback capability
   - Audit trail for all merge operations

3. **[Story 8.03: Email Linking & Deal Creation from Email](../stories/8.03-crm-email-linking.md)**
   - Gmail integration via browser extension
   - Selective email linking (manual, not auto-sync)
   - Work Order attachment detection
   - Deal creation from linked emails
   - Email activity timeline integration

---

## Data Protection and Deletion Rules

### Business Context

Client data is critical for business operations and legal compliance. Accidental deletion of client records can:
- Lose historical context for recurring customers
- Break relationships between Deals, Invoices, and Clients
- Violate record retention requirements
- Create orphaned records (Deals without Clients)

### Deletion Protection Rules

#### 1. Company Deletion

```
┌────────────────────────────────────────────────────┐
│          Company Deletion Decision Tree            │
└────────────────────────────────────────────────────┘

Manager attempts to delete Company "ABC Supply Co."
        ↓
System checks:
  1. Does company have any Deals?
     → YES: Block deletion, show error
     → NO: Continue
        ↓
  2. Does company have any Contacts?
     → YES: Show warning, require confirmation
     → NO: Allow deletion
        ↓
  3. Does company have financial records?
     (Invoices, Payments, Payment Terms)
     → YES: Block deletion, show error
     → NO: Allow deletion

BLOCKED scenarios:
  ❌ Company with any Deal (active or completed)
  ❌ Company with any Invoice
  ❌ Company with any Payment history
  ❌ Platinum client with W-9 or COI on file

ALLOWED with WARNING:
  ⚠️  Company with Contacts (no Deals)
     → Prompt: "This will also delete 3 contacts"

ALLOWED without WARNING:
  ✅ Company with no Deals, Contacts, or financials
     (probably created by mistake)
```

#### 2. Contact Deletion

```
┌────────────────────────────────────────────────────┐
│           Contact Deletion Decision Tree           │
└────────────────────────────────────────────────────┘

Manager attempts to delete Contact "John Smith"
        ↓
System checks:
  1. Is contact linked to any Deals?
     → YES: Block deletion, show error
     → NO: Continue
        ↓
  2. Is contact Primary Contact for a Company?
     → YES: Block deletion, show error
        "Reassign primary contact first"
     → NO: Continue
        ↓
  3. Does contact have email/call history?
     → YES: Show warning, require confirmation
     → NO: Allow deletion

BLOCKED scenarios:
  ❌ Contact with any Deal (active or completed)
  ❌ Contact marked as Primary for any Company
  ❌ Contact with Invoice history

ALLOWED with WARNING:
  ⚠️  Contact with email/call/SMS history but no Deals
     → Prompt: "This will delete 12 emails and 5 call records"

ALLOWED without WARNING:
  ✅ Contact with no Deals or history
     (probably created by mistake)
```

### Alternative to Deletion: Archiving

**Recommended Approach:** Instead of deletion, implement soft-delete (archiving):

```
Archive workflow:
  Manager clicks "Archive Client"
        ↓
  System sets:
    - UF_ARCHIVED = true
    - UF_ARCHIVED_DATE = now()
    - UF_ARCHIVED_BY = current_user_id
        ↓
  Client hidden from:
    - Default search results
    - Deal creation dropdowns
    - Active client lists
        ↓
  Client still visible in:
    - Historical Deals
    - Archived clients view
    - Admin audit interfaces

Benefits:
  ✅ No data loss
  ✅ Deal relationships preserved
  ✅ Can be restored if needed
  ✅ Audit trail maintained
```

### Implementation

#### Database Constraints

```sql
-- Prevent deletion if Deals exist
ALTER TABLE b_crm_company
  ADD CONSTRAINT fk_company_deals_check
  FOREIGN KEY (ID) REFERENCES b_crm_deal(COMPANY_ID)
  ON DELETE RESTRICT;

ALTER TABLE b_crm_contact
  ADD CONSTRAINT fk_contact_deals_check
  FOREIGN KEY (ID) REFERENCES b_crm_deal(CONTACT_ID)
  ON DELETE RESTRICT;

-- Add archive flags
ALTER TABLE b_crm_company
  ADD COLUMN UF_ARCHIVED BOOLEAN DEFAULT FALSE,
  ADD COLUMN UF_ARCHIVED_DATE DATETIME NULL,
  ADD COLUMN UF_ARCHIVED_BY INT NULL;

ALTER TABLE b_crm_contact
  ADD COLUMN UF_ARCHIVED BOOLEAN DEFAULT FALSE,
  ADD COLUMN UF_ARCHIVED_DATE DATETIME NULL,
  ADD COLUMN UF_ARCHIVED_BY INT NULL;
```

#### Deletion Check Handler (PHP)

```php
<?php
namespace Bitrix\Crm\EventHandler;

use Bitrix\Main\EventManager;
use Bitrix\Crm\CompanyTable;
use Bitrix\Crm\ContactTable;
use Bitrix\Crm\DealTable;

class DeletionProtection
{
    public static function register()
    {
        $eventManager = EventManager::getInstance();

        // Hook into Company deletion event
        $eventManager->addEventHandler(
            'crm',
            'OnBeforeCompanyDelete',
            [self::class, 'onBeforeCompanyDelete']
        );

        // Hook into Contact deletion event
        $eventManager->addEventHandler(
            'crm',
            'OnBeforeContactDelete',
            [self::class, 'onBeforeContactDelete']
        );
    }

    /**
     * Block Company deletion if it has Deals, Invoices, or financials
     */
    public static function onBeforeCompanyDelete(&$ID, &$arFields)
    {
        // Check for associated Deals
        $dealCount = DealTable::getCount([
            'filter' => ['COMPANY_ID' => $ID]
        ]);

        if ($dealCount > 0) {
            global $APPLICATION;
            $APPLICATION->ThrowException(
                "Cannot delete company: {$dealCount} Deal(s) associated. " .
                "Use Archive instead or reassign Deals first."
            );
            return false;
        }

        // Check for Invoices
        $invoiceCount = \CCrmInvoice::GetList(
            [],
            ['UF_COMPANY_ID' => $ID],
            []
        );

        if ($invoiceCount > 0) {
            global $APPLICATION;
            $APPLICATION->ThrowException(
                "Cannot delete company: {$invoiceCount} Invoice(s) associated. " .
                "Use Archive instead."
            );
            return false;
        }

        // Check for Platinum status (W-9 or COI on file)
        $company = CompanyTable::getById($ID)->fetch();
        if (!empty($company['UF_W9_DOCUMENT']) || !empty($company['UF_COI_DOCUMENT'])) {
            global $APPLICATION;
            $APPLICATION->ThrowException(
                "Cannot delete Platinum client with W-9 or COI on file. " .
                "Archive instead to maintain compliance records."
            );
            return false;
        }

        // Check for Contacts
        $contactCount = ContactTable::getCount([
            'filter' => ['COMPANY_ID' => $ID]
        ]);

        if ($contactCount > 0) {
            // Allow deletion but show warning
            global $APPLICATION;
            $APPLICATION->addWarning(
                "Warning: This will also delete {$contactCount} associated Contact(s)."
            );
        }

        // Log deletion attempt
        self::logDeletionAttempt('company', $ID, $company['TITLE']);

        return true; // Allow deletion
    }

    /**
     * Block Contact deletion if it has Deals or is Primary Contact
     */
    public static function onBeforeContactDelete(&$ID, &$arFields)
    {
        // Check for associated Deals
        $dealCount = DealTable::getCount([
            'filter' => ['CONTACT_ID' => $ID]
        ]);

        if ($dealCount > 0) {
            global $APPLICATION;
            $APPLICATION->ThrowException(
                "Cannot delete contact: {$dealCount} Deal(s) associated. " .
                "Use Archive instead or reassign Deals first."
            );
            return false;
        }

        // Check if Primary Contact for any Company
        $companies = CompanyTable::getList([
            'filter' => ['UF_PRIMARY_CONTACT_ID' => $ID],
            'select' => ['ID', 'TITLE']
        ])->fetchAll();

        if (!empty($companies)) {
            $companyNames = array_column($companies, 'TITLE');
            global $APPLICATION;
            $APPLICATION->ThrowException(
                "Cannot delete contact: Primary Contact for Company: " .
                implode(', ', $companyNames) . ". " .
                "Reassign Primary Contact first."
            );
            return false;
        }

        // Check for Activity history (emails, calls, SMS)
        $activityCount = \CCrmActivity::GetList(
            [],
            ['CONTACT_ID' => $ID],
            []
        );

        if ($activityCount > 10) { // More than 10 activities
            global $APPLICATION;
            $APPLICATION->addWarning(
                "Warning: This will delete {$activityCount} activity records " .
                "(emails, calls, SMS) associated with this contact."
            );
        }

        // Log deletion attempt
        $contact = ContactTable::getById($ID)->fetch();
        self::logDeletionAttempt('contact', $ID, $contact['TITLE']);

        return true; // Allow deletion
    }

    /**
     * Log all deletion attempts for audit trail
     */
    private static function logDeletionAttempt($entityType, $entityId, $entityTitle)
    {
        global $USER;

        $logEntry = [
            'ENTITY_TYPE' => $entityType,
            'ENTITY_ID' => $entityId,
            'ENTITY_TITLE' => $entityTitle,
            'DELETED_BY' => $USER->GetID(),
            'DATE_DELETED' => date('Y-m-d H:i:s'),
            'IP_ADDRESS' => $_SERVER['REMOTE_ADDR']
        ];

        // Log to custom table
        \Bitrix\Main\Application::getConnection()->query(
            "INSERT INTO b_crm_deletion_log
             (ENTITY_TYPE, ENTITY_ID, ENTITY_TITLE, DELETED_BY, DATE_DELETED, IP_ADDRESS)
             VALUES (?, ?, ?, ?, ?, ?)",
            array_values($logEntry)
        );
    }
}

// Register handlers on module load
DeletionProtection::register();
```

### UI Warnings

#### Company Deletion Warning Modal

```
┌────────────────────────────────────────────────────┐
│  ⚠️  Cannot Delete Company                          │
├────────────────────────────────────────────────────┤
│                                                    │
│  Company: ABC Supply Co.                           │
│                                                    │
│  ❌ This company cannot be deleted because:       │
│                                                    │
│  • 12 Deals associated (8 completed, 4 active)    │
│  • 5 Invoices on record                           │
│  • Platinum client with W-9 on file               │
│                                                    │
│  Alternative actions:                              │
│  [Archive Company]  [Cancel]                       │
│                                                    │
│  Note: Archiving will hide this company from       │
│  active searches while preserving all history.     │
│                                                    │
└────────────────────────────────────────────────────┘
```

#### Contact Deletion Confirmation (Safe to Delete)

```
┌────────────────────────────────────────────────────┐
│  ⚠️  Confirm Contact Deletion                       │
├────────────────────────────────────────────────────┤
│                                                    │
│  Contact: John Smith                               │
│  Company: ABC Supply Co.                           │
│                                                    │
│  This contact has:                                 │
│  • 15 email records                                │
│  • 8 call records                                  │
│  • 0 Deals (safe to delete)                        │
│                                                    │
│  ⚠️  All activity history will be permanently      │
│     deleted. This cannot be undone.                │
│                                                    │
│  [Delete Permanently]  [Archive Instead]  [Cancel] │
│                                                    │
└────────────────────────────────────────────────────┘
```

### Archive Management Interface

**Admin Interface:** "Archived Clients"

```
┌────────────────────────────────────────────────────────────────┐
│  Archived Clients                          [Export] [Settings]  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Filter: [All ▼] [Companies ▼] [Last 30 days ▼]  [Search...]   │
│                                                                │
│  📦 ABC Supply Co. (Company)                                   │
│     Archived: 2025-10-15 by Manager Smith                     │
│     Reason: Client moved out of service area                   │
│     Deals: 23 (all completed)                                 │
│     [Restore] [View History] [Delete Permanently]             │
│                                                                │
│  📦 John Doe (Contact)                                         │
│     Archived: 2025-10-10 by Dispatcher Jones                  │
│     Reason: Duplicate contact merged                           │
│     Deals: 0                                                   │
│     [Restore] [View History] [Delete Permanently]             │
│                                                                │
│  📦 XYZ Services (Company)                                     │
│     Archived: 2025-09-20 by Admin Brown                       │
│     Reason: Company went out of business                       │
│     Deals: 45 (all completed, last: 2024-12-15)               │
│     [Restore] [View History] [Delete Permanently]             │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Permissions

**Who can delete/archive clients?**

| Role | Company Delete | Contact Delete | Company Archive | Contact Archive | Restore Archived |
|------|---------------|---------------|-----------------|-----------------|-----------------|
| **Dispatcher** | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| **Manager** | ⚠️ Restricted* | ⚠️ Restricted* | ✅ Yes | ✅ Yes | ✅ Yes |
| **Administrator** | ✅ Yes** | ✅ Yes** | ✅ Yes | ✅ Yes | ✅ Yes |

*Restricted = Only allowed if no Deals/Invoices associated
**Administrator can override restrictions with confirmation dialog

### Audit Trail

All deletion and archive operations logged:

```sql
-- Deletion/Archive Log Table
CREATE TABLE b_crm_deletion_log (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    ENTITY_TYPE ENUM('company', 'contact'),
    ENTITY_ID INT NOT NULL,
    ENTITY_TITLE VARCHAR(255),
    ACTION ENUM('delete_attempted', 'delete_blocked', 'delete_completed', 'archived', 'restored'),
    DELETED_BY INT NOT NULL,
    DATE_LOGGED DATETIME NOT NULL,
    IP_ADDRESS VARCHAR(45),
    REASON TEXT,
    RELATED_RECORDS JSON, -- Counts of associated Deals, Invoices, etc.

    INDEX idx_entity (ENTITY_TYPE, ENTITY_ID),
    INDEX idx_date (DATE_LOGGED),
    INDEX idx_user (DELETED_BY)
);
```

### Success Criteria

- ✅ Companies with Deals cannot be deleted (hard block)
- ✅ Companies with Invoices cannot be deleted (hard block)
- ✅ Platinum clients with W-9/COI cannot be deleted (hard block)
- ✅ Contacts with Deals cannot be deleted (hard block)
- ✅ Primary Contacts cannot be deleted until reassigned (hard block)
- ✅ Deletion attempts show clear error messages with alternative actions
- ✅ Archive functionality available as alternative
- ✅ Archived clients hidden from active searches but visible in history
- ✅ Managers can restore archived clients
- ✅ All deletion/archive operations logged for audit
- ✅ Permissions enforced based on user role

---

## Technical Architecture

### Database Schema

```sql
-- Companies
b_crm_company (standard Bitrix)
  ID
  TITLE
  UF_CLIENT_TYPE (enum: residential, commercial, government)
  PHONE
  EMAIL
  ADDRESS
  WEBSITE
  + Custom fields per Epic 9 (W-9, COI, Terms, Tax Exempt)

-- Contacts
b_crm_contact (standard Bitrix)
  ID
  TITLE (First Name + Last Name)
  COMPANY_ID (link to company)
  EMAIL
  PHONE
  UF_CONTACT_TYPE (enum: individual, company_rep)
  UF_TITLE (job title)

-- Client Email Mapping
b_crm_email_link
  ID
  EMAIL
  COMPANY_ID
  CONTACT_ID
  LINKED_BY
  DATE_LINKED

-- Duplicate Detection Log
b_crm_duplicate_log
  ID
  ENTITY_TYPE (company, contact)
  PRIMARY_ID
  DUPLICATE_ID
  MERGE_BY
  DATE_MERGED
  DETAILS (JSON)

-- Company-Contact History
b_crm_company_contact_history
  ID
  COMPANY_ID
  CONTACT_ID
  RELATIONSHIP (contact, billing, technical, etc.)
  START_DATE
  END_DATE
```

### API Endpoints

```
POST /api/crm/company/create
  - Create new company

POST /api/crm/contact/create
  - Create new contact

POST /api/crm/company/{id}/merge
  - Merge duplicate companies

GET /api/crm/duplicates
  - List potential duplicates

POST /api/crm/email/link
  - Link email to client

POST /api/crm/deal/from-email
  - Create deal from linked email
```

---

## Success Criteria

### Functional Requirements

- ✅ Company and Contact entities working correctly
- ✅ Client type field enforced
- ✅ Company → Contact hierarchy maintained
- ✅ Automatic client creation on Deal creation (Story 8.01)
- ✅ Phone number normalization and duplicate detection (Story 8.01)
- ✅ Deduplication tool working with merge history preserved (Story 8.02)
- ✅ 30-day rollback capability for merged records (Story 8.02)
- ✅ Deletion protection rules enforced (see Data Protection section above)
- ✅ Archive functionality for soft-delete (see Data Protection section above)
- ✅ Email linking with selective Gmail integration (Story 8.03)
- ✅ Deal creation from linked emails with Work Order detection (Story 8.03)

---

## Risks & Mitigation

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| **Data migration quality** | High - affects all operations | - Validate source data first<br>- Dedup before import<br>- Phased migration<br>- Audit trail during import |
| **Duplicate creation** | Medium - data quality | - Phone/email uniqueness checks<br>- Name similarity matching<br>- Merge tools available<br>- Regular dedup audits |
| **Email linking errors** | Low - workflow issues | - Validation before linking<br>- Manual review option<br>- Easy unlinking<br>- Error recovery |
| **Deletion of active clients** | Critical - data loss | - Enforce deletion rules<br>- Require manager approval<br>- Backup before deletion<br>- Audit trail |
| **Company-contact relationship breaks** | Medium - data integrity | - Integrity checks<br>- Foreign key constraints<br>- Orphan detection<br>- Regular cleanup jobs |

---

## Dependencies

**Integration Dependencies:**
- Deal Management (Epic 2) for Deal-Client linking
- Telephony (Epic 1) for call-based client creation
- Email Integration (Google Workspace) for email linking
- Platinum Clients (Epic 9) for Company card extensions

---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/prd.md)
- [Epic 1: Telephony Integration](EPIC-1-Telephony.md)
- [Epic 2: Deal Management](EPIC-2-Deal-Management.md)
- [Epic 9: Platinum Clients](EPIC-9-Platinum-Clients.md)
