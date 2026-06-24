# EPIC 12: Communications & Corporate Messenger Migration

---

## Overview

This epic covers the migration of all internal corporate communications from Flock and WhatsApp into Bitrix24's unified messenger. The system centralizes all employee communication (Ukraine, Georgia, USA offices), enables audio/video calls with recording, manages file storage in cloud drive, and provides administrative controls over user access and group creation.

**Scope Note:** The client team will handle data export from Flock and WhatsApp internally. Integrators will receive pre-exported, filtered data and are responsible for:
- Validating and importing the data into Bitrix24
- Configuring the messenger functionality
- Setting up administrative controls and permissions

---

## Business Objectives

1. **Centralization:** Unify all employees (multi-geography) into single communication tool
2. **Cost Reduction:** Eliminate Flock subscription cost (~$X/month)
3. **Scalability:** Solve WhatsApp VoIP registration limitations
4. **Security:** Centralized storage in company cloud (not local devices)
5. **Compliance:** Call recording capability for training and quality assurance
6. **Search & Archive:** All communication history searchable and retained

---

## Key User Personas

### Employee (Ukraine/Georgia)
- **Goals:** Communicate with team seamlessly, access company announcements
- **Pains:** Currently uses Flock, about to migrate to new system
- **Needs:** Familiar chat interface, easy migration, clear instructions

### Employee (USA)
- **Goals:** Team communication, access shared files
- **Pains:** Currently uses WhatsApp, limited VoIP capabilities
- **Needs:** Reliable messaging, video calling, desktop access

### Department Manager
- **Goals:** Coordinate team, manage group chats, organize communication
- **Pains:** Cannot currently create groups without admin help
- **Needs:** Ability to create and manage team channels/groups

### IT Administrator
- **Goals:** Manage users, control group creation, archive communications
- **Pains:** User management across multiple countries, compliance tracking
- **Needs:** User management tools, audit logs, group controls

### Executive/Compliance
- **Goals:** Ensure compliance, manage communication governance
- **Pains:** Communication records scattered across tools, no audit trail
- **Needs:** Centralized archive, audit logs, call recordings

---

## Core Concepts

### Data Migration Strategy

```
┌──────────────────────────────────────────────────────┐
│          COMMUNICATION MIGRATION PATH                │
├──────────────────────────────────────────────────────┤
│
│ CLIENT EXPORTS DATA (Done by client team)
│ ├─ Flock data export (Ukraine, Georgia users)
│ │  ├─ User list (40+ employees)
│ │  ├─ Private chats (1-on-1 messages)
│ │  ├─ Group chats (office, department, topic-based)
│ │  ├─ Files shared in chats
│ │  └─ Message history (with timestamps, authorship)
│ │
│ ├─ WhatsApp data export (USA users)
│ │  ├─ User list (30+ employees)
│ │  ├─ Private chats (1-on-1 messages)
│ │  ├─ Group chats (team, project-based)
│ │  ├─ Files shared in chats
│ │  └─ Message history (with timestamps, authorship)
│ │
│ └─ Export format: JSON/CSV with structure:
│    ├─ users.json (ID, name, email, role)
│    ├─ chats.json (chat_id, name, type, members)
│    ├─ messages.json (chat_id, sender, text, timestamp)
│    └─ files/ (organized by chat_id)
│
│ CLIENT REVIEW & FILTERING (Done by client team)
│ ├─ Client reviews exported data
│ ├─ Identifies chats to migrate
│ ├─ Non-business/personal chats excluded
│ └─ Filtered dataset prepared for integrators
│
│ INTEGRATOR RECEIVES PRE-EXPORTED DATA
│ ├─ Client provides exported and filtered data
│ ├─ Data format validation
│ └─ Ready for import to Bitrix24
│
│ BITRIX24 IMPORT (Done by integrators)
│ ├─ Map users to Bitrix24 accounts (by email)
│ ├─ Create group chats in Bitrix24 messenger
│ ├─ Import message history (preserving timestamps)
│ ├─ Import file attachments to cloud drive
│ └─ Associate messages with original authors
│
│ RESULT: Bitrix24 Messenger
│ ├─ All employees unified
│ ├─ Complete communication history searchable
│ ├─ Files organized in cloud storage
│ └─ Active / historical chats clearly marked
│
└──────────────────────────────────────────────────────┘
```

### Messenger Functionality

```
┌──────────────────────────────────────────────────────┐
│        BITRIX24 MESSENGER INTERFACE                  │
├──────────────────────────────────────────────────────┤
│
│ CHAT TYPES
│ ├─ Private Chat (1-on-1 between two employees)
│ ├─ Group Chat (multi-person conversation)
│ ├─ Department Channel (broadcast-style)
│ └─ Activity Stream / Feed (company-wide announcements)
│
│ CORE FEATURES
│ ├─ Real-time messaging
│ ├─ File sharing (documents, images, videos)
│ ├─ Pin important messages
│ ├─ Pin important chats (to top of list)
│ ├─ Search across all messages & files
│ ├─ Employee presence status (online, away, DND)
│ ├─ Read receipts
│ └─ Message reactions/emoji
│
│ CALLING FEATURES
│ ├─ Audio calls (1-on-1 and group)
│ ├─ Video calls (1-on-1 and group)
│ ├─ Screen sharing (video calls)
│ ├─ Call recording (stored in cloud)
│ ├─ Automatic storage in Bitrix24 Drive
│ └─ Access to recordings (admin & participants)
│
│ STORAGE
│ ├─ Chat history: Indefinite retention
│ ├─ Files: Linked to Google Drive / Bitrix24 Drive
│ ├─ Call recordings: Cloud storage (30-day accessible)
│ ├─ Archive storage: After 30 days (admin only)
│ └─ Compliance: Audit trail of all actions
│
└──────────────────────────────────────────────────────┘
```

### File Sharing & Storage

```
WORKFLOW: File sharing in Bitrix24 messenger

Employee drops file in chat:
  File: "Q4 Budget Proposal.xlsx"
  ↓
System:
  1. Uploads to Bitrix24 Drive (or Google Drive)
  2. Creates link in chat message
  3. Preserves upload metadata (who, when)
  4. Makes accessible to chat members

Chat member clicks link:
  ↓
Options:
  - View online (if supported format)
  - Download to device
  - Share with others
  - Add to "Files from Chat" directory

Dedicated Chat Directory:
  "All Files from Atlanta Team"
  ├─ Q4 Budget Proposal.xlsx
  ├─ Meeting Notes 2025-11-05.pdf
  ├─ Org Chart v3.pdf
  └─ [Browse all X files]
```

---

## Core Workflows

### 1. Receiving Pre-Exported Data from Client

```
CLIENT PROVIDES:
  ├─ Exported data files (JSON/CSV format)
  ├─ File attachments (organized by chat)
  └─ List of chats to migrate (filtered by client)

INTEGRATOR VALIDATES:
  STEP 1: Check data format
    - Verify JSON/CSV structure
    - Confirm required fields present:
      • users.json: id, name, email
      • chats.json: chat_id, name, type, members
      • messages.json: chat_id, sender_id, text, timestamp
      • files/: organized by chat_id

  STEP 2: Data integrity check
    - Count total users, chats, messages
    - Verify file references match actual files
    - Check for missing/corrupted data

  STEP 3: Mapping preparation
    - Map source user IDs to Bitrix24 accounts (by email)
    - Identify any unmapped users (create accounts)
    - Prepare chat structure for import

READY FOR IMPORT ✅
```

### 2. Importing to Bitrix24

```
STEP 1: User Setup
  Create Bitrix24 accounts for all employees:
  - Import user list from Flock/WhatsApp
  - Associate with existing Bitrix24 users
  - Enable messenger access for all

STEP 2: Create Chat Structure
  For each migrated chat:
    - Create Bitrix24 group chat
    - Name: [Same as original]
    - Members: [Same members as original]
    - Type: Group or Channel (as appropriate)

STEP 3: Import Message History
  For each chat:
    - Preserve original message timestamps (if possible)
    - Map authors correctly (by email)
    - Import all messages in sequence
    - Maintain message metadata

STEP 4: Import Files
  For each file in chats:
    - Download from source
    - Upload to Bitrix24 Drive
    - Link to chat message
    - Preserve upload date/time

STEP 5: Verification
  - Count messages imported vs. source
  - Verify file integrity
  - Test search functionality
  - Confirm user access
```

### 3. Messenger Configuration

```
STEP 1: Enable Messenger
  - Enable Bitrix24 messenger module for all users
  - Configure messenger settings (file sharing, calls, etc.)
  - Set default permissions

STEP 2: Configure Chat Types
  - Enable private chats (1-on-1)
  - Enable group chats
  - Enable department channels (if needed)
  - Configure activity stream/feed

STEP 3: File Storage Configuration
  - Link to Bitrix24 Drive
  - Set file upload limits
  - Configure file retention policies
  - Enable file preview/online viewing

STEP 4: Call & Recording Settings
  - Enable audio/video calls
  - Configure call recording (enable/disable)
  - Set recording storage location
  - Define recording access permissions
  - Set retention period (30 days accessible, then archive)
```

### 4. Administrator Controls

```
ADMIN DASHBOARD:

User Management:
  ├─ View all employees (active/inactive)
  ├─ Create new user accounts
  ├─ Deactivate users
  ├─ Reset passwords
  └─ Assign roles

Group Chat Management:
  ├─ View all groups/channels
  ├─ Create new groups (admin only, unless delegated)
  ├─ Approve new groups (if requiring approval)
  ├─ Archive old groups
  ├─ Manage group membership
  └─ Set group permissions

Communication Governance:
  ├─ Restrict who can create groups
  │  (Only managers, or allow all)
  ├─ Set retention policies
  ├─ View audit log
  ├─ Search all messages (if needed for compliance)
  └─ Manage group naming standards

Recording & Compliance:
  ├─ Disable recording (if desired)
  ├─ View recording audit trail
  ├─ Archive recordings after 30 days
  ├─ Set access controls for recordings
  └─ Generate compliance reports
```

---

## Integration Points

### Integration with Bitrix24 Core

- Messenger is native Bitrix24 feature
- Integration with task creation (create task from message)
- Integration with Drive for file storage
- Integration with Contacts for employee directory

### Integration with CRM

- Chat linked to Deal/Company (for client discussions)
- Internal team discussions around opportunities
- File sharing within deal conversations

---

## User Stories Breakdown

This epic is broken down into the following user stories:

**Note:** Data export from Flock and WhatsApp will be handled by the client team internally. Integrators will receive pre-exported and filtered data ready for import.

1. **[Story 12.01: Data Import to Bitrix24](../stories/12.01-communications-data-import.md)**
   - Receive and validate pre-exported data from client
   - User account mapping (by email to Bitrix24 accounts)
   - Group chat creation in Bitrix24 messenger
   - Message history import (preserving timestamps and authorship)
   - File upload to Bitrix24 Drive and linking to messages
   - Data integrity verification and import validation

2. **[Story 12.02: Messenger Configuration](../stories/12.02-communications-messenger-config.md)**
   - Enable Bitrix24 messenger for all users
   - Configure chat types (private, group, channel, feed)
   - Set up file storage (Bitrix24 Drive integration)
   - Configure audio/video calling features
   - Set up call recording settings and storage
   - Configure retention policies

3. **[Story 12.03: Admin Controls & Permissions](../stories/12.03-communications-admin-controls.md)**
   - User account management interface
   - Group creation permissions and approval workflows
   - Group chat moderation tools
   - Audit logging configuration
   - Communication governance settings
   - Recording access controls

---

## Technical Architecture

### Database/Storage

```sql
-- Migrated Chat History (custom table for tracking)
b_communications_migrated_chat
  ID
  SOURCE_SYSTEM (flock, whatsapp)
  ORIGINAL_CHAT_ID
  BITRIX24_CHAT_ID
  MIGRATION_DATE
  MESSAGE_COUNT
  VERIFICATION_STATUS (pending, verified, failed)

-- Call Recording Archive
b_communications_call_recording
  ID
  CHAT_ID
  CALL_DATE
  PARTICIPANTS (array)
  RECORDING_FILE (Drive link)
  DURATION
  STORAGE_LOCATION (30-day accessible, or archived)
  ACCESS_LEVEL (all participants, admin only)

-- Migration Audit Log
b_communications_migration_log
  ID
  ENTITY_TYPE (user, chat, message, file)
  SOURCE_ID
  TARGET_ID
  ACTION (create, import, link)
  TIMESTAMP
  NOTES
```

### API Endpoints (if needed for custom scripts)

```
POST /api/communications/validate-import-data
  - Validate pre-exported data from client
  - Check format, integrity, completeness

POST /api/communications/import/messages
  - Import message history to chat
  - Preserve timestamps and authorship

POST /api/communications/import/files
  - Upload files to Bitrix24 Drive
  - Link files to chat messages

GET /api/communications/migration-status
  - Check import progress and validation
  - Return statistics and errors
```

---

## Success Criteria

### Functional Requirements

- ✅ All active employees have Bitrix24 user accounts
- ✅ All chat history from Flock/WhatsApp migrated to Bitrix24
- ✅ Files from chats accessible in Bitrix24 Drive
- ✅ Audio and video calling functional (1-on-1 and group)
- ✅ Call recordings automatically saved to cloud
- ✅ Search functionality works across all messages
- ✅ Permission controls enforced (group creation restrictions)
- ✅ Employee presence status displays correctly

### Data Integrity Requirements

- ✅ Message count matches source export (within 1%)
- ✅ Timestamps preserved from original (if possible)
- ✅ Author attribution accurate for all messages
- ✅ Files complete and downloadable
- ✅ No data corruption during import
- ✅ Verification report generated and reviewed

### Adoption Requirements

- ✅ Employee training completed
- ✅ All employees can access messenger
- ✅ Chat history searchable and accessible
- ✅ Flock and WhatsApp can be decommissioned

---

## Risks & Mitigation

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| **Data loss during migration** | Critical - compliance | - Client maintains backup of source data<br>- Verify imports (message counts) against client export<br>- Keep Flock/WhatsApp active during transition<br>- Staged migration by department |
| **Invalid/incomplete data from client** | High - blocks import | - Define clear export format specification<br>- Provide data validation tool to client<br>- Verify data integrity before import<br>- Clear communication about required fields |
| **Message timestamp loss** | Medium - audit trail | - Specify timestamp format in export requirements<br>- Document timestamp preservation method<br>- Acceptance of best-effort if not possible<br>- Relative ordering verified |
| **User mapping issues** | Medium - data integrity | - Map users by email (primary key)<br>- Identify unmapped users before import<br>- Create missing Bitrix24 accounts<br>- Manual verification of ambiguous mappings |
| **User adoption resistance** | Medium - operational | - Early communication about migration<br>- Training sessions (demo + hands-on)<br>- Support team available<br>- Quick-start guides<br>- Stagger rollout if needed |
| **Storage cost for old chats** | Low - cost impact | - Archive old group chats<br>- Set retention policy<br>- Monitor storage usage<br>- Cleanup plan documented |

---

## Dependencies

**Integration Dependencies:**
- User Roles & Permissions (Epic 11) for access control
---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/prd.md)
- [Epic 11: User Roles & Permissions](EPIC-11-User-Roles.md)
