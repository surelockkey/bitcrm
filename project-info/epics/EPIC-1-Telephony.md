# EPIC 1: Telephony and Call Processing

---

## Overview

This epic covers the complete implementation of IP telephony solution deeply integrated with Bitrix24 CRM. The system handles inbound/outbound call routing, SMS messaging, call recording with hybrid storage, call quality monitoring, and extension-based call masking for technician-client communication.

---

## Business Objectives

1. **Unified Communication:** Consolidate all voice and SMS communication in one platform with CRM integration
2. **Source Tracking:** Capture advertising source (gclid) for every inbound call to measure marketing ROI
3. **Quality Assurance:** 100% call recording with hybrid storage strategy (90-day hot + 7-year cold archive)
4. **Privacy Protection:** Extension-based call masking to protect client phone numbers from technicians
5. **Operational Efficiency:** Automatic Deal creation, draft auto-save during active calls, missed call management

---

## Key User Personas

### Dispatcher
- **Goals:** Answer inbound calls efficiently, create Deals with accurate source tracking, manage missed calls
- **Pains:** Manual Deal creation during calls leads to data loss if call drops
- **Needs:** Pop-up caller identification, draft auto-save, round-robin call distribution

### Manager (Shift Supervisor)
- **Goals:** Monitor call quality, ensure dispatchers follow protocols, review call recordings for training
- **Pains:** No real-time visibility into active calls, difficult to access call recordings
- **Needs:** Whisper mode for live monitoring, easy access to call recordings, call analytics dashboard

### Technician
- **Goals:** Communicate with clients about job details, call clients from job site
- **Pains:** Clients save technician's personal number and call directly (bypassing dispatch)
- **Needs:** Call masking system where clients see company number, not tech's personal number

### Executive/Owner
- **Goals:** Measure marketing ROI, ensure compliance (call recording retention), control telephony costs
- **Pains:** Current system expensive ($X/month for recording storage)
- **Needs:** Cost-effective hybrid storage, source attribution reports, compliance-grade retention

---

## Core Concepts

### Call Routing Architecture

```
┌─────────────────────────────────────────────────────┐
│              Inbound Call Flow                       │
└─────────────────────────────────────────────────────┘

Client calls company number
        ↓
Telephony Provider (Twilio/etc.)
        ↓
Bitrix24 Call Distribution Logic:
  - Check dispatcher "Available" status
  - Round-robin among available dispatchers
  - Fallback to voicemail if no one available
        ↓
Ring dispatcher's device (web + mobile app)
        ↓
CRM Pop-up with:
  - Caller ID + existing client info (if found)
  - Advertising source (gclid from URL tracking)
  - Recent Deal history
        ↓
Dispatcher answers → Deal draft auto-save begins
        ↓
Call ends → Deal finalized OR saved as draft
        ↓
Recording uploaded to cloud (hot storage: 90 days)
```

### Extension-Based Call Masking

**Problem:** When technician calls client from personal phone, client saves tech's number and bypasses dispatch for future calls.

**Solution:** Extension-based masking system

```
┌──────────────────────────────────────────────────────┐
│         Outbound Call Masking Flow                   │
└──────────────────────────────────────────────────────┘

Tech assigned to Deal #12345
        ↓
System generates unique extension: EXT-12345
        ↓
Tech clicks "Call Client" in mobile app
        ↓
Tech's call routes through:
  Tech's Phone → Twilio → Masked Number → Client
        ↓
Client sees: Company Number (e.g., 555-LOCK)
Client does NOT see: Tech's personal number
        ↓
If client calls back:
  Client calls 555-LOCK
        ↓
  "Press 1 for Deal #12345" (routes to assigned tech)
  "Press 0 for dispatch" (normal routing)
```

### Hybrid Storage Strategy

**Cost Problem:** Storing 100% call recordings in cloud for 7 years = $X,XXX/year

**Solution:** Hybrid hot/cold storage

```
┌────────────────────────────────────────────────────┐
│          Recording Storage Lifecycle               │
└────────────────────────────────────────────────────┘

Call ends → Recording uploaded to Cloud (Twilio/AWS S3)
             ↓
             HOT STORAGE (0-90 days)
             - Instant access via CRM
             - Streaming playback
             - Download available
             ↓
          Day 91 Migration Job
             ↓
         COLD STORAGE (91 days - 7 years)
             - Move to local server / cheap cloud tier
             - Indexed by Deal ID + Date
             - Accessible via archive search
             ↓
          After 7 years: Delete
          (Compliance requirement met)

Estimated Annual Savings: $2,666
```

---

## Core Workflows

### 1. Inbound Call → Deal Creation

```
Step 1: Call Arrives
  → System checks caller ID against CRM database
  → If found: Load existing Contact + Company
  → If not found: Prepare blank Contact form

Step 2: CRM Pop-up Displays
  → Caller: John Smith (Existing Client)
  → Last Job: 2 months ago - "Lock Installation"
  → Source: Google Ads Campaign "Emergency Lockout"
  → [Answer Call] [Send to Voicemail]

Step 3: Dispatcher Answers
  → Call timer starts
  → Deal draft auto-save activates (saves every 30 seconds)
  → Dispatcher creates/updates Deal fields:
      - Service Type: [Rekey ▼]
      - Address: [123 Main St, Atlanta, GA]
      - Notes: "Client locked out, needs immediate service"

Step 4: Call Ends
  → Dispatcher clicks "Save Deal" (or auto-save completes)
  → Deal status: "Submitted - New"
  → Call recording linked to Deal timeline
  → Deal ready for assignment
```

### 2. SMS Integration

**Two-Way SMS Messaging:**

```
Dispatcher → Client SMS:
  → Dispatcher opens Deal
  → Clicks "Send SMS"
  → Types message: "Technician John will arrive in 15 minutes"
  → SMS sent from company number (metro-based)
  → Message logged in Deal timeline

Client → Company SMS:
  → Client sends SMS to company number
  → System finds associated Deal (by phone number)
  → SMS appears in Deal timeline
  → Notification sent to assigned dispatcher/technician
  → Respond directly from Deal card
```

### 3. Call Recording & Monitoring

**Whisper Mode (Manager Monitoring):**

```
Manager opens "Active Calls" dashboard
        ↓
Sees: Dispatcher #3 on call with client
        ↓
Clicks "Listen" (whisper mode)
        ↓
Manager hears:
  ✅ Dispatcher speaking
  ✅ Client speaking
  ❌ Dispatcher does NOT hear manager
        ↓
Manager can assess:
  - Call handling quality
  - Protocol adherence
  - Training opportunities
```

### 4. Missed Call Management

**Persistent Notifications:**

```
Inbound call rings all available dispatchers → No answer
        ↓
Voicemail recorded (if client leaves message)
        ↓
Missed call logged in "Missed Calls" interface:
  ┌──────────────────────────────────────────────┐
  │ Missed Calls (3 unprocessed)                 │
  ├──────────────────────────────────────────────┤
  │ 📞 555-1234 | 10:45 AM | New caller          │
  │    Voicemail: "Need lockout service ASAP"    │
  │    [Call Back] [Create Deal] [Mark Handled]  │
  ├──────────────────────────────────────────────┤
  │ 📞 555-5678 | 10:32 AM | John Smith          │
  │    No voicemail                               │
  │    Last job: 30 days ago                     │
  │    [Call Back] [Create Deal] [Mark Handled]  │
  └──────────────────────────────────────────────┘

Notification persists until:
  ✅ Dispatcher calls back
  ✅ Deal created
  ✅ Manually marked as "Handled"
```

---

## Integration Points

### Integration with Deal Management (Block 2)

**Deal Draft Auto-Save:**
- During active call, system saves Deal fields every 30 seconds
- If call drops, dispatcher can resume from last auto-save
- Prevents data loss from network issues or browser crashes

**Source Tracking:**
- gclid parameter captured from ad click
- Associated with Contact/Company
- Automatically populated in Deal on call creation
- Feeds into Marketing ROI reports

### Integration with Scheduling (Block 4)

**Caller ID Integration:**
- When dispatcher assigns job to technician
- Technician can click-to-call from Deal card
- Outbound call uses metro-based caller ID
- Call automatically logged in Deal timeline

### Integration with Reporting (Block 7)

**Call Analytics:**
- Calls by source (Google Ads, Bing, Organic, etc.)
- Average call duration
- Missed call rate by time of day
- Dispatcher performance metrics

---

## User Stories Breakdown

This epic is broken down into the following user stories:

1. **[Story 1.01: Inbound Call Routing](../stories/1.01-telephony-inbound-calls.md)**
   - Multi-line call distribution
   - Round-robin routing algorithm
   - CRM pop-up with caller identification
   - Automatic Deal creation with source tracking
   - Deal draft auto-save mechanism

2. **[Story 1.02: Outbound Calls & Call Masking](../stories/1.02-telephony-outbound-calls-masking.md)**
   - Extension-based call masking system
   - Metro area-based caller ID selection
   - Technician outbound call workflows
   - Call-back routing through extensions

3. **[Story 1.03: SMS Integration](../stories/1.03-telephony-sms-integration.md)**
   - Two-way SMS messaging
   - Deal timeline logging
   - Metro-based SMS number routing
   - SMS templates and automation

4. **[Story 1.04: Call Recording & Monitoring](../stories/1.04-telephony-call-recording-monitoring.md)**
   - 100% call recording
   - Hybrid storage strategy (90-day hot + 7-year cold)
   - Whisper mode for manager monitoring
   - AI transcription and call scoring
   - Recording playback and download

5. **[Story 1.05: Missed Calls Interface](../stories/1.05-telephony-missed-calls-interface.md)**
   - Missed call dashboard
   - Persistent notifications
   - Voicemail transcription
   - Callback workflows

6. **[Story 1.06: Call Control & Call Log](../stories/1.06-telephony-call-control-call-log.md)**
   - Call transfer, hold, conference
   - Call log with advanced filtering
   - Call notes and disposition codes
   - Integration with Deal timeline

---

## Technical Architecture

### Telephony Provider Options

**Option A: Twilio (Recommended)**
- Mature API for call routing and recording
- Built-in call masking support
- SMS capabilities included
- AI transcription available (Twilio Autopilot)
- Cost: ~$X per minute

**Option B: Bitrix24 Native Telephony**
- Limited call masking capabilities
- May require custom development
- Evaluate feature parity

**Decision:** Integrator to propose optimal provider with cost/feature comparison

### API Endpoints

```
POST /api/telephony/inbound/route
  - Route inbound call to available dispatcher

POST /api/telephony/call/create
  - Initiate outbound call with masking

GET /api/telephony/recording/{call_id}
  - Retrieve call recording

POST /api/telephony/sms/send
  - Send SMS from company number

POST /api/telephony/whisper/start
  - Start whisper mode monitoring

GET /api/telephony/missed-calls
  - List unhandled missed calls
```

---

## Success Criteria

### Functional Requirements

- ✅ All inbound calls route to available dispatchers with <5 second ring time
- ✅ CRM pop-up displays within 2 seconds of call connection
- ✅ Deal draft auto-save prevents data loss during active calls
- ✅ 100% call recording capture rate (>99.9% uptime)
- ✅ Extension-based masking works for all technician-client calls
- ✅ SMS messages log to Deal timeline automatically
- ✅ Hybrid storage migration runs nightly, 90-day recordings moved to cold storage
- ✅ Missed call interface shows all unhandled calls until action taken

### Performance Requirements

- ✅ Call connection time: <5 seconds
- ✅ CRM pop-up load: <2 seconds
- ✅ Recording playback start: <3 seconds
- ✅ SMS delivery: <10 seconds
- ✅ Whisper mode connection: <3 seconds

### Cost Requirements

- ✅ Recording storage cost ≤$X,XXX/year (with hybrid strategy)
- ✅ Per-minute call cost ≤$X

---

## Risks & Mitigation

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| **Call quality/dropped calls** | High - affects customer experience | - Use enterprise-grade provider<br>- Redundant network paths<br>- Quality monitoring alerts |
| **Recording storage costs** | Medium - budget impact | - Implement hybrid storage<br>- Automatic cold migration<br>- Monitor storage usage |
| **Call masking complexity** | High - custom feature | - Thorough testing with Twilio<br>- Fallback to direct calling<br>- Clear user documentation |
| **AI transcription accuracy** | Low - nice-to-have | - Use proven AI service (Twilio/AWS)<br>- Human review for critical calls |
| **Compliance (7-year retention)** | High - legal requirement | - Automated migration to cold storage<br>- Retention policy enforcement<br>- Annual compliance audit |

---

## Dependencies

**Technical Dependencies:**
- Bitrix24 Enterprise plan (for telephony API access)
- Telephony provider account (Twilio/etc.)
- Server infrastructure for cold storage
- Mobile app with VoIP capability

**Business Dependencies:**
- Metro area definitions and phone number assignments
- Dispatcher work schedules configured
- Advertising source tracking URLs implemented

**Integration Dependencies:**
- Deal Management (Epic 2) must be implemented for Deal creation
- User Roles & Permissions (Epic 11) for call access controls

---

**Document Status:** ✅ Ready for Review

---

**Related Documents:**
- [Product Requirements Document](../prd/prd.md)
- [Technical Requirements - Workiz Migration](../00_drafts/TR-Workiz.md)
- Deal Management Epic (Epic 2)
- Reporting Epic (Epic 7)
