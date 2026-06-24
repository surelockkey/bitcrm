# EPIC 4: Scheduling & Dispatching

---

## Overview

This epic covers the implementation of a map-centric dispatching system that replaces manual multi-tool workflows. The system provides real-time visualization of unassigned jobs, technician locations, and assigns work based on skills, service areas, availability, and inventory. Integration with Bitrix24 calendars enables real-time technician scheduling.

---

## Business Objectives

1. **Unified Dispatch Interface:** Single map-based tool replacing Workiz + Google Sheets + Google Maps
2. **Intelligent Assignment:** Suggest technicians based on skills, area, availability, and inventory
3. **Real-Time Visibility:** GPS tracking of technicians on interactive map
4. **Route Optimization:** Sequential job numbering for efficient technician routes
5. **Schedule Integration:** Full sync with Bitrix24 calendars for availability management

---

## Key User Personas

### Shift Manager/Dispatcher
- **Goals:** Quickly assign unassigned jobs, optimize technician routes, monitor job progress
- **Pains:** Manual assignment across multiple tools is slow, no real-time technician location
- **Needs:** Interactive map showing jobs and technicians, intelligent suggestions, one-click assignment

### Technician
- **Goals:** See assigned jobs in order, navigate efficiently, get real-time job updates
- **Pains:** Manual job order entry, route changes require multiple communications
- **Needs:** Mobile app with job sequence, navigation, real-time order updates

### Manager/Owner
- **Goals:** Maximize technician utilization, reduce drive time, ensure SLA compliance
- **Pains:** Inefficient routes waste fuel and time, assignment decisions are subjective
- **Needs:** Dispatch analytics, utilization reports, route efficiency metrics

---

## Core Concepts

### Interactive Dispatch Map

```
┌────────────────────────────────────────────────────────┐
│              DISPATCH MAP INTERFACE                    │
├────────────────────────────────────────────────────────┤
│                                                        │
│        📍 Unassigned Job (Red Pin)                   │
│        🚗 Tech #1 Location (Blue Icon)               │
│        🚗 Tech #2 Location (Green Icon)              │
│                                                        │
│  Job Details Panel:                                   │
│  ├─ Job ID, Type, Address                            │
│  ├─ Matching Technicians:                            │
│  │  ✅ Tech #1 (Skills: ✓, Area: ✓, Avail: ✓)      │
│  │  ⚠️  Tech #2 (Skills: ✓, Area: ✗ wrong area)    │
│  │  ❌ Tech #3 (Skills: ✗ locksmith, not requested) │
│  └─ [Assign to Tech #1] [View Details]               │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Technician Profile Configuration

**Skills (Job Types):**
- Multi-select field: Locksmith, Lock Installation, Rekeying, etc.
- Only used to filter for matching jobs

**Service Areas (Metro Areas):**
- Multi-select field: Atlanta, North Georgia, East Atlanta, etc.
- Technician can only be assigned jobs in their areas

**Labor Cost per Hour:**
- Used in internal calculations and reporting

### Intelligent Assignment Logic

```
When dispatcher clicks on unassigned job:

System checks EVERY technician:

  Skills Match?          Service Area?        Availability?       Inventory?
  ✅ Locksmith required  ✅ Atlanta assigned   ✅ Not scheduled     ✅ Parts in van
  ✅ Install capability                       ✅ Lunch break OK
        ↓                      ↓                    ↓                  ↓
  RECOMMENDATION SCORE: 95/100 → BEST MATCH!

Display to dispatcher:
  - Top 3-5 matching technicians
  - Score breakdown
  - One-click assignment
  - Alternative suggestions if top choice unavailable
```

### Sequential Job Numbering

```
Tech #1 has 3 assigned jobs:

Morning Route:
  📍 [1] 123 Main St - Lock Installation - 9:00 AM
  📍 [2] 456 Oak Ave - Rekey Service - 10:30 AM
  📍 [3] 789 Elm Rd - Lockout Service - 1:00 PM

On map display:
  Each pin shows number: [1] [2] [3]
  Indicates optimal route sequence
  Tech navigates in order automatically
```

---

## Core Workflows

### 1. Dispatching a Job

```
Step 1: Dispatcher Views Map
  → Sees all unassigned jobs (red pins)
  → Sees all technician locations (color-coded icons)
  → Technician icons show current job number [2 of 4]

Step 2: Click on Unassigned Job
  → Job details panel opens
  → System analyzes all technicians:
     - Skills required vs. technician skills
     - Job metro area vs. technician areas
     - Technician calendar availability
     - Parts inventory in technician's van

Step 3: View Recommendations
  → Display ranked list of suitable technicians
  → Top suggestion highlighted (highest match score)
  → Each shows: Name, Score, ETA to job, Current jobs

Step 4: Assign Job
  → Click [Assign to Tech #2]
  → System updates:
     - Deal status: "Assigned"
     - Technician field populated
     - Job appears on Tech #2's list
     - Map updates with new sequence number
  → Notification sent to technician (push + SMS)
```

### 2. Managing Availability (Calendar Integration)

```
Technician Work Schedule:
  Monday-Friday: 8:00 AM - 5:00 PM
  Lunch: 12:00 PM - 1:00 PM

Bitrix24 Calendar:
  Stores technician availability and time-off

When dispatcher assigns job:
  → Check technician's calendar for conflicts
  → Job scheduled for 2:30 PM
  → Calendar shows no conflicts (lunch ends at 1:00 PM)
  → Assignment allowed

If job conflicts with scheduled time off:
  → Display warning: "Technician unavailable 2-3 PM"
  → Suggest alternative times or different technician
```

> **📘 Note:** If Bitrix24 Calendar meets all requirements, Google Calendar integration is optional and can be omitted to simplify architecture.

### 3. Real-Time GPS Tracking

```
Technician enables GPS in mobile app:
  → Background location service starts
  → Updates sent to Bitrix24 every 30 seconds
  → Dispatcher sees real-time location on map

Dispatcher monitors job progress:
  → Sees technician approaching job location
  → Pin moves closer to assigned job
  → Can notify if technician goes off route

After job completion:
  → Technician marks job "Done" in mobile app
  → Technician navigates to next job (map shows [2])
```

### 4. Route Optimization (Time-Based Sequencing)

```
Dispatcher assigns multiple jobs to same technician:

Morning assignments:
  Job A: 123 Main St (scheduled 1:00 PM)
  Job B: 456 Oak Ave (scheduled 9:00 AM)
  Job C: 789 Elm Rd (scheduled 10:30 AM)

System assigns numbers by scheduled time (earliest first):
  [1] 456 Oak Ave - 9:00 AM
  [2] 789 Elm Rd - 10:30 AM
  [3] 123 Main St - 1:00 PM

Technician sees clear sequence on map and in mobile app
Dispatcher can manually reorder if needed
```

> **📘 Simplified Approach:** Instead of complex distance-based optimization, jobs are sequenced by scheduled time. Earlier jobs get lower numbers [1], [2], [3]. This is simpler to implement and more predictable for dispatchers.

---

## Integration Points

### Integration with Deal Management (Epic 2)

- Job assignment captured in Deal "Assigned to" field → **[Epic 2: Deal Management](EPIC-2-Deal-Management.md)**
- Deal status changes: Submitted → Assigned → In Progress
- Technician can only see assigned jobs (other statuses hidden) → **[Epic 11: Permissions](EPIC-11-Permissions.md)**
- Schedule fields (Starts, Ends) stored in Deal → Used for job sequencing

### Integration with Inventory (Epic 5)

- When suggesting technicians, check if they have required parts → **[Story 5.03: Container Management](../stories/5.03-inventory-container-management.md)**
- Flag if parts needed must be transferred from warehouse → **[Story 5.06: Warehouse Transfers](../stories/5.06-inventory-warehouse-transfers.md)**
- Prevent assignment if critical parts unavailable

### Integration with Technician Profiles (Epic 6)

- Skills and service areas stored in technician's user profile → **[Epic 6: Technician Onboarding](EPIC-6-Technician-Onboarding.md)**
- Labor cost per hour used in profit calculations → **[Epic 7: Reporting](EPIC-7-Reporting.md)**
- Calendar and availability pulled from Bitrix24 calendars
- Can manage multiple technician groups/teams

### Integration with Mobile App

- Technician sees assigned jobs in order: [1] [2] [3]
- Navigation to each address (Google Maps integration)
- Update job status: Accepted → In Progress → Done
- Real-time GPS tracking enabled → **[Story 4.03: Mobile App](../stories/4.03-scheduling-mobile-app.md)**

---

## User Stories Breakdown

This epic is broken down into the following user stories:

1. **[Story 4.01: Interactive Dispatch Map](../stories/4.01-scheduling-dispatch-map.md)** (8 pts)
   - Map display of unassigned jobs and technician locations
   - Click to view job details panel
   - Real-time map updates (30 seconds)
   - Job filtering by type and service area

2. **[Story 4.02: Intelligent Job Assignment](../stories/4.02-scheduling-intelligent-assignment.md)** (13 pts)
   - Simple filtering algorithm (job type match + metro area match)
   - Time-based job sequencing (earliest scheduled = [1])
   - One-click job assignment
   - Push + SMS notifications to technician

3. **[Story 4.03: Mobile App for Technicians](../stories/4.03-scheduling-mobile-app.md)** (15 pts)
   - View assigned jobs in sequence order [1], [2], [3]
   - Update job status (Accept → In Progress → Done)
   - Google Maps navigation integration
   - Real-time GPS tracking with privacy controls
   - Background location updates (30 seconds)
   - Technician location display on dispatch map
   - Offline support with sync queue

### Supporting Features (Included in Epic)

**Technician Profile Configuration** (5 pts)
- Configure technician skills (job types)
- Configure service areas (metro areas)
- Labor cost per hour configuration

**Calendar Availability Integration** (8 pts)
- Bitrix24 Calendar integration (primary)
- Availability checking during assignment
- Schedule conflict detection and warnings
- Optional: Google Calendar two-way sync

---

## Technical Architecture

### Database Schema

```sql
-- Technician Profiles
b_user (extended with custom fields)
  UF_JOB_TYPES (multi-select: Locksmith, Install, Rekey, etc.)
  UF_SERVICE_AREAS (multi-select: Atlanta, North GA, etc.)
  UF_LABOR_COST_HOUR (decimal)
  UF_GPS_ENABLED (bool)

-- Deal Assignment History
b_deal_assignment
  ID
  DEAL_ID
  TECHNICIAN_ID
  ASSIGNED_BY
  ASSIGNED_DATE
  STATUS (active, replaced, completed)
  SEQUENCE_NUMBER (1, 2, 3, etc.)

-- Technician Location (real-time)
b_technician_location
  ID
  USER_ID
  LATITUDE (decimal)
  LONGITUDE (decimal)
  ACCURACY (meters)
  LAST_UPDATE (timestamp)
  DEVICE_ID
```

### API Endpoints

```
GET /api/scheduling/dispatch-map
  - Get all jobs and technician locations

POST /api/scheduling/assign-job
  - Assign job to technician

GET /api/scheduling/recommended-techs/{job_id}
  - Get ranked list of suitable technicians

POST /api/scheduling/location/update
  - Update technician GPS location

GET /api/scheduling/technician/{user_id}/availability
  - Check availability for date/time range

GET /api/scheduling/technician/{user_id}/assigned-jobs
  - Get technician's assigned jobs in sequence
```

---

## Supporting Feature Details

### Technician Profile Configuration

**Purpose:** Configure technician skills, service areas, and labor costs to enable intelligent job matching.

**User Story:**
**As a** Manager
**I want** to configure technician skills, service areas, and labor costs
**So that** the assignment algorithm can match jobs to qualified technicians

#### Acceptance Criteria

1. **Skills Configuration**
   - ✅ Multi-select field: Job types (Locksmith, Installation, Rekey, Lockout, Safe, Commercial, etc.)
   - ✅ Add/remove skills per technician
   - ✅ Skills displayed on technician profile page
   - ✅ Used in assignment filtering (Story 4.02)

2. **Service Areas Configuration**
   - ✅ Multi-select field: Metro areas (Atlanta, North GA, East Atlanta, Marietta, Decatur, etc.)
   - ✅ Technician can be assigned to multiple areas
   - ✅ Service areas displayed on profile and dispatch map
   - ✅ Used in assignment filtering (Story 4.02)

3. **Labor Cost Configuration**
   - ✅ Labor cost per hour field (hourly rate in USD)
   - ✅ Used in internal calculations (not visible to technician)
   - ✅ Feeds into commission reports and profit calculations

4. **Profile Management**
   - ✅ Manager can edit technician profiles
   - ✅ Technician cannot edit their own skills/areas
   - ✅ Audit log for profile changes (who changed what, when)

#### Technical Implementation

**Custom User Fields (Bitrix24 b_user table):**
```sql
-- Extend b_user table with custom fields
UF_JOB_TYPES (multi-select)
  Options: Locksmith, Installation, Rekey, Lockout, Safe, Commercial, etc.
  Example: ["Locksmith", "Installation", "Rekey"]

UF_SERVICE_AREAS (multi-select)
  Options: Atlanta, North GA, East Atlanta, Marietta, Decatur, etc.
  Example: ["Atlanta", "East Atlanta"]

UF_LABOR_COST_HOUR (decimal)
  Format: 25.00 (USD per hour)
  Example: 25.00
```

**API Endpoints:**
```javascript
// Get technician profile
GET /api/scheduling/technician/{user_id}/profile
  Response: {
    user_id: "123",
    name: "John Smith",
    skills: ["Locksmith", "Installation", "Rekey"],
    service_areas: ["Atlanta", "East Atlanta"],
    labor_cost_hour: 25.00
  }

// Update technician profile (Manager only)
PUT /api/scheduling/technician/{user_id}/profile
  Body: {
    skills: ["Locksmith", "Installation"],
    service_areas: ["Atlanta"],
    labor_cost_hour: 27.50
  }
  Response: {
    success: true,
    updated_fields: ["skills", "labor_cost_hour"]
  }
```

**Permissions:**
- Managers/Dispatchers: Full edit access
- Technicians: Read-only access to own profile
- Other users: No access

#### Integration Points

- **Assignment Algorithm (Story 4.02):** Uses skills/areas for filtering → [Story 4.02](../stories/4.02-scheduling-intelligent-assignment.md)
- **Technician Onboarding (Epic 6):** Profile created during onboarding → [Epic 6](EPIC-6-Technician-Onboarding.md)
- **Reporting (Epic 7):** Labor cost used in profit calculations → [Epic 7](EPIC-7-Reporting.md)

---

### Calendar Availability Integration

**Purpose:** Check technician calendar availability before assigning jobs to prevent double-booking and respect time-off requests.

**User Story:**
**As a** Shift Manager/Dispatcher
**I want** to check technician calendar availability before assigning jobs
**So that** I don't assign jobs during scheduled time-off or existing appointments

#### Acceptance Criteria

1. **Calendar Integration**
   - ✅ Use Bitrix24 Calendar as primary source
   - ✅ Store technician work schedules (e.g., Mon-Fri 8 AM - 5 PM)
   - ✅ Store time-off requests (vacation, sick days, lunch breaks)
   - ✅ Optional: Two-way sync with Google Calendar (if business requires it)

2. **Availability Checking**
   - ✅ Before assignment, check calendar for conflicts
   - ✅ Display warning if job overlaps with scheduled event
   - ✅ Show available time slots for alternative scheduling
   - ✅ Allow dispatcher to override conflicts (with confirmation)

3. **Conflict Detection**
   - ✅ Detect overlapping appointments
   - ✅ Flag lunch breaks (e.g., 12:00-1:00 PM)
   - ✅ Respect time-off requests (vacation, sick days)
   - ✅ Display conflict details: "Tech unavailable 2-3 PM (Doctor Appt)"

4. **Calendar Display**
   - ✅ Manager can view technician's calendar
   - ✅ Color-coded events: Work (blue), Time-off (red), Lunch (yellow)
   - ✅ Click on time slot to create new job assignment
   - ✅ Calendar widget on dispatch map sidebar

#### Technical Implementation

**Bitrix24 Calendar API:**
```javascript
// Check availability for specific time range
GET /api/calendar/user/{user_id}/availability
  Params: {
    date: "2025-01-15",
    time_start: "09:00",
    time_end: "11:00"
  }
  Response: {
    available: true,
    conflicts: []
  }

// Get calendar events for date range
GET /api/calendar/user/{user_id}/events
  Params: {
    date_from: "2025-01-15",
    date_to: "2025-01-20"
  }
  Response: {
    events: [
      {
        id: "event_123",
        title: "Lunch Break",
        start: "2025-01-15T12:00:00Z",
        end: "2025-01-15T13:00:00Z",
        type: "break",
        color: "#FFC107"
      },
      {
        id: "event_456",
        title: "Vacation",
        start: "2025-01-18T00:00:00Z",
        end: "2025-01-19T23:59:59Z",
        type: "time_off",
        color: "#DC3545"
      }
    ]
  }
```

**Google Calendar Sync (Optional):**
```javascript
// Enable Google Calendar sync (if required)
POST /api/calendar/sync/google
  Body: {
    user_id: "tech_123",
    google_calendar_id: "tech123@gmail.com",
    sync_direction: "bidirectional" // or "bitrix_to_google" or "google_to_bitrix"
  }
  Response: {
    success: true,
    synced_events_count: 15,
    next_sync: "2025-01-15T14:00:00Z"
  }

// Disable Google Calendar sync
DELETE /api/calendar/sync/google/{user_id}
  Response: {
    success: true
  }
```

**Conflict Detection Logic:**
```javascript
async function checkAvailability(userId, jobStartTime, jobEndTime) {
  // Get all calendar events for technician
  const events = await getCalendarEvents(userId, jobStartTime, jobEndTime);

  const conflicts = [];

  for (const event of events) {
    // Check if job overlaps with event
    if (jobStartTime < event.end && jobEndTime > event.start) {
      conflicts.push({
        event_id: event.id,
        event_title: event.title,
        event_type: event.type,
        overlap_minutes: calculateOverlap(jobStartTime, jobEndTime, event.start, event.end)
      });
    }
  }

  return {
    available: conflicts.length === 0,
    conflicts: conflicts
  };
}
```

**Calendar Event Types:**
- `work` - Regular work hours (default, blue)
- `break` - Lunch breaks (yellow)
- `time_off` - Vacation, sick days (red)
- `appointment` - Personal appointments (orange)
- `job` - Assigned jobs (green)

#### UI/UX Design

**Calendar Widget (Dispatch Map Sidebar):**
```
┌─────────────────────────────┐
│  Tech: John Smith          │
│  📅 Jan 15, 2025           │
├─────────────────────────────┤
│  8:00 AM ┌─────────────────┤
│          │ 🟢 Job [1]      │
│ 10:00 AM ├─────────────────┤
│          │ Available       │
│ 12:00 PM ├─────────────────┤
│          │ 🟡 Lunch        │
│  1:00 PM ├─────────────────┤
│          │ 🟢 Job [2]      │
│  3:00 PM ├─────────────────┤
│          │ Available       │
│  5:00 PM └─────────────────┤
└─────────────────────────────┘
```

**Conflict Warning Dialog:**
```
┌─────────────────────────────┐
│  ⚠️ Schedule Conflict       │
├─────────────────────────────┤
│  Tech: John Smith           │
│  Job: Lock Installation     │
│  Time: 12:30 PM - 1:30 PM   │
│                             │
│  Conflicts with:            │
│  • Lunch Break (12-1 PM)    │
│                             │
│  Suggested alternatives:    │
│  • 10:00 AM - 11:00 AM ✅   │
│  • 2:00 PM - 3:00 PM ✅     │
│                             │
│  [Assign Anyway] [Cancel]   │
└─────────────────────────────┘
```

#### Integration Points

- **Assignment Algorithm (Story 4.02):** Availability check during filtering → [Story 4.02](../stories/4.02-scheduling-intelligent-assignment.md)
- **Deal Management (Epic 2):** Schedule fields synced to calendar → [Epic 2](EPIC-2-Deal-Management.md)
- **Mobile App (Story 4.03):** Technician sees daily schedule → [Story 4.03](../stories/4.03-scheduling-mobile-app.md)

#### Google Calendar Integration Decision

> **📘 Important Decision Point:**
>
> **Use Bitrix24 Calendar as primary system.** Only implement Google Calendar sync if:
> 1. Business stakeholders explicitly request it
> 2. Technicians already heavily use Google Calendar
> 3. Two-way sync is critical for adoption
>
> **Benefits of Bitrix24 Calendar only:**
> - Simpler architecture (no third-party sync)
> - No Google API costs or rate limits
> - Native integration with Bitrix24 permissions
> - Easier maintenance and troubleshooting
>
> **When to add Google Calendar:**
> - If technicians refuse to adopt Bitrix24 Calendar
> - If external calendar sharing is required (e.g., with family)
> - If business uses Google Workspace organization-wide

---

## Success Criteria

### Functional Requirements

- ✅ Interactive map displays all unassigned jobs
- ✅ Technician locations update in real-time (30-second intervals)
- ✅ Intelligent recommendation system suggests suitable technicians
- ✅ Skills and service area filtering works correctly
- ✅ Calendar availability checked before assignment
- ✅ Sequential job numbering displays on map
- ✅ One-click assignment workflow
- ✅ Technician mobile app shows jobs in assigned order

### User Experience Requirements

- ✅ Map is the primary dispatch interface (not calendar or list view)
- ✅ Mobile app navigation integrated (Google Maps)
- ✅ Clear visual distinction between job types
- ✅ One-handed use optimized for mobile

---

## Dependencies

**Technical Dependencies:**
- Bitrix24 Enterprise or Pro plan
- Google Maps API key
- Mobile app with GPS capability
- Bitrix24 REST API access
- Bitrix24 Calendar API (Google Calendar optional)

**Business Dependencies:**
- Technician user accounts created
- Skills and service areas defined
- Work schedules configured in calendars
- Team/group structure defined

**Integration Dependencies:**
- Deal Management (Epic 2) must be implemented
- Technician Profiles (Epic 6) must be configured
- Mobile App with GPS (Epic 4.05)

---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/prd.md)
- [Technical Requirements - Workiz Migration](../00_drafts/TR-Workiz.md)
- Deal Management Epic (Epic 2)
- Technician Onboarding Epic (Epic 6)
- Inventory Management Epic (Epic 5)
