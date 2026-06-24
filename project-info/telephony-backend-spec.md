# Telephony Backend Service — Technical Specification

**Version:** 1.0
**Date:** 2026-03-03
**Status:** Draft

---

## 1. Service Overview

### 1.1 Purpose

The Telephony Backend Service is the core middleware between **Twilio** (telephony provider) and the **CRM/frontend** layer. It manages all voice calls (inbound, outbound, masked), SMS messaging, call recordings, real-time supervisor monitoring, missed call processing, and call control operations (transfer, conference, hold/mute) for a multi-state locksmith dispatch business.

### 1.2 Scope

| Module | Description |
|--------|-------------|
| **Inbound Call Routing** | Simultaneous ring to all available dispatchers, queue management, timeout/forwarding rules |
| **Outbound Calls & Masking** | Dispatcher outbound calls with caller ID, technician call masking via extensions |
| **SMS Integration** | Two-way SMS via Twilio Programmable SMS, templates, TCPA compliance |
| **Call Recording & Storage** | 100% recording, hybrid storage (Twilio 30d → S3 cold), playback API |
| **Supervisor Monitoring** | Listen / Whisper / Barge modes for live calls |
| **Missed Calls** | Detection, dashboard data, one-click callback, auto-draft deal creation |
| **Call Control** | Warm transfer, conference calling (3+), hold, mute |
| **Call Log** | Unified log with filtering, tagging, quick actions |

### 1.3 Key Design Principles

- **Twilio as single telephony provider** — all voice/SMS routes through Twilio APIs
- **Stateless webhook handlers** — all call state persisted in DB, no in-memory sessions
- **Event-driven** — Twilio status callbacks drive state transitions
- **CRM-integrated** — every call/SMS linked to Deal, Contact, or Lead
- **Privacy-first** — technicians never see client phone numbers; clients never see technician numbers

---

## 2. Architecture

### 2.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        EXTERNAL                                   │
│                                                                   │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐                │
│  │  Client   │   │Technician│   │  Supervisor  │                │
│  │  Phone    │   │  Phone   │   │  Browser     │                │
│  └────┬─────┘   └────┬─────┘   └──────┬───────┘                │
│       │              │                  │                         │
└───────┼──────────────┼──────────────────┼─────────────────────────┘
        │              │                  │
   ┌────▼──────────────▼──────┐           │
   │       TWILIO CLOUD       │           │
   │  ┌──────────────────┐    │           │
   │  │ Voice API        │    │           │
   │  │ Programmable SMS │    │           │
   │  │ Conference API   │    │           │
   │  │ Recording API    │    │           │
   │  │ Twilio Functions │    │           │
   │  └────────┬─────────┘    │           │
   └───────────┼──────────────┘           │
               │ Webhooks                 │
   ┌───────────▼──────────────────────────▼─────────────────┐
   │              TELEPHONY BACKEND SERVICE                   │
   │                                                          │
   │  ┌────────────────────────────────────────────────────┐ │
   │  │              API Gateway / Router                   │ │
   │  └──┬────┬────┬────┬────┬────┬────┬────┬──────────────┘ │
   │     │    │    │    │    │    │    │    │                  │
   │  ┌──▼─┐┌─▼──┐┌▼──┐┌▼──┐┌▼──┐┌▼──┐┌▼──┐┌▼──┐           │
   │  │INB ││OUT ││SMS││REC││MON││MIS││CTL││LOG│           │
   │  │OUND││BOUN││   ││ORD││ITOR││SED││   ││   │           │
   │  └──┬─┘└──┬─┘└─┬─┘└─┬─┘└─┬─┘└─┬─┘└─┬─┘└─┬─┘           │
   │     │     │    │    │    │    │    │    │                  │
   │  ┌──▼─────▼────▼────▼────▼────▼────▼────▼──┐             │
   │  │            Database Layer                 │             │
   │  │  PostgreSQL / MySQL                       │             │
   │  └──┬────────────────────────────────────────┘             │
   │     │                                                      │
   │  ┌──▼────────────────────────────────────────┐             │
   │  │            S3-Compatible Storage           │             │
   │  │  Backblaze B2 / Wasabi (recordings)        │             │
   │  └───────────────────────────────────────────┘             │
   └────────────────────┬───────────────────────────────────────┘
                        │ REST API / WebSocket
   ┌────────────────────▼───────────────────────────────────────┐
   │                    CRM / FRONTEND                           │
   │  Dispatcher Dashboard, Deal Cards, Timeline, Mobile App    │
   └────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20+ (recommended) or PHP 8.2+ |
| Framework | Express/Fastify (Node) or Laravel/Symfony (PHP) |
| Telephony Provider | Twilio (Voice, SMS, Conference, Recording APIs) |
| Database | PostgreSQL 15+ (primary) |
| Cache | Redis 7+ (call state, dispatcher availability, rate limiting) |
| Object Storage | Backblaze B2 / Wasabi (S3-compatible) for recordings |
| Message Queue | Redis Streams or RabbitMQ (async processing) |
| Real-time | WebSocket (Socket.io or Pusher) for live dashboard updates |
| Job Scheduler | node-cron / Laravel Scheduler for recording migration, cleanup |
| Monitoring | Prometheus + Grafana / Datadog |

### 2.3 Service Boundaries

The telephony service is **the only service** that communicates with Twilio. Other services (CRM, Dispatch, etc.) communicate with telephony via its REST API or event bus.

```
CRM Service ──REST──► Telephony Service ──Twilio SDK──► Twilio Cloud
                              │
Dispatch Service ──REST──►    │
                              │
Notification Svc ◄──Events────┘
```

---

## 3. Database Schema

### 3.1 Core Tables

```sql
-- ============================================================
-- 3.1.1 Call Log (master record for every call)
-- ============================================================
CREATE TABLE calls (
    id              SERIAL PRIMARY KEY,
    twilio_sid      VARCHAR(64) UNIQUE NOT NULL,   -- Twilio Call SID
    direction       VARCHAR(10) NOT NULL,           -- 'inbound', 'outbound', 'masked'
    status          VARCHAR(20) NOT NULL DEFAULT 'initiated',
                    -- 'initiated','ringing','in-progress','completed',
                    -- 'busy','no-answer','canceled','failed'
    from_number     VARCHAR(20) NOT NULL,
    to_number       VARCHAR(20) NOT NULL,
    caller_id       VARCHAR(20),                    -- number client sees
    duration        INT DEFAULT 0,                  -- seconds
    answered_by     INT,                            -- user_id of dispatcher/tech who answered

    -- CRM links
    contact_id      INT,                            -- FK → CRM contacts
    deal_id         INT,                            -- FK → CRM deals

    -- Source tracking
    job_source      VARCHAR(100),                   -- "Google Ads", "Facebook", etc.
    caller_city     VARCHAR(100),                   -- from Twilio Lookup
    caller_state    VARCHAR(10),
    metro_area      VARCHAR(50),

    -- Call masking
    extension       VARCHAR(10),                    -- e.g. "12345"
    is_masked       BOOLEAN DEFAULT FALSE,
    tech_user_id    INT,                            -- technician for masked calls

    -- Timestamps
    date_created    TIMESTAMP NOT NULL DEFAULT NOW(),
    date_answered   TIMESTAMP,
    date_completed  TIMESTAMP,

    -- Indexes
    INDEX idx_twilio_sid    (twilio_sid),
    INDEX idx_direction     (direction, date_created),
    INDEX idx_status        (status),
    INDEX idx_from          (from_number),
    INDEX idx_contact       (contact_id),
    INDEX idx_deal          (deal_id),
    INDEX idx_date          (date_created),
    INDEX idx_answered_by   (answered_by)
);

-- ============================================================
-- 3.1.2 Call Recordings
-- ============================================================
CREATE TABLE call_recordings (
    id              SERIAL PRIMARY KEY,
    call_id         INT NOT NULL REFERENCES calls(id),
    twilio_sid      VARCHAR(64) UNIQUE NOT NULL,    -- Twilio Recording SID
    recording_url   TEXT NOT NULL,                   -- current URL (Twilio or S3)
    duration        INT NOT NULL,                    -- seconds
    channels        SMALLINT DEFAULT 1,              -- 1=mono, 2=dual-channel
    file_size       BIGINT,                          -- bytes
    format          VARCHAR(10) DEFAULT 'mp3',

    -- Storage lifecycle
    storage_location VARCHAR(20) DEFAULT 'TWILIO',  -- 'TWILIO', 'S3'
    migrated_to_s3  BOOLEAN DEFAULT FALSE,
    date_migrated   TIMESTAMP,

    -- Retention
    date_created    TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMP,                       -- 2 years from creation

    INDEX idx_call_id       (call_id),
    INDEX idx_storage       (storage_location, date_created),
    INDEX idx_twilio_rec    (twilio_sid)
);

-- ============================================================
-- 3.1.3 Deal Drafts (auto-save during calls)
-- ============================================================
CREATE TABLE deal_drafts (
    id              SERIAL PRIMARY KEY,
    call_id         VARCHAR(64),                     -- Twilio Call SID
    phone           VARCHAR(20) NOT NULL,
    client_id       INT,                             -- Contact ID if found
    contact_name    VARCHAR(255),                    -- "contact person" for this deal
    street          VARCHAR(255),
    city            VARCHAR(100),
    state           VARCHAR(50),
    zip             VARCHAR(20),
    job_type        VARCHAR(100),
    notes           TEXT,
    job_source      VARCHAR(100),
    metro_area      VARCHAR(50),
    created_by      INT NOT NULL,                    -- dispatcher user_id
    status          VARCHAR(20) DEFAULT 'DRAFT',     -- 'DRAFT','CONVERTED','ABANDONED'
    date_created    TIMESTAMP NOT NULL DEFAULT NOW(),
    date_updated    TIMESTAMP NOT NULL DEFAULT NOW(),

    INDEX idx_phone         (phone),
    INDEX idx_call_id       (call_id),
    INDEX idx_status_date   (status, date_created)
);

-- ============================================================
-- 3.1.4 Missed Calls
-- ============================================================
CREATE TABLE missed_calls (
    id              SERIAL PRIMARY KEY,
    twilio_sid      VARCHAR(64) UNIQUE NOT NULL,
    from_number     VARCHAR(20) NOT NULL,
    to_number       VARCHAR(20) NOT NULL,
    contact_id      INT,
    deal_id         INT,
    status          VARCHAR(20) DEFAULT 'PENDING',
                    -- 'PENDING','CALLING','CALLED_BACK','RESOLVED','IGNORED'
    callback_user_id INT,
    callback_call_sid VARCHAR(64),
    date_callback   TIMESTAMP,
    notes           TEXT,
    date_created    TIMESTAMP NOT NULL DEFAULT NOW(),

    INDEX idx_status_date   (status, date_created DESC),
    INDEX idx_contact       (contact_id),
    INDEX idx_twilio        (twilio_sid)
);

-- ============================================================
-- 3.1.5 SMS Log
-- ============================================================
CREATE TABLE sms_log (
    id              SERIAL PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,            -- 'DEAL','CONTACT','LEAD'
    entity_id       INT NOT NULL,
    direction       VARCHAR(10) NOT NULL,            -- 'INBOUND','OUTBOUND'
    from_number     VARCHAR(20) NOT NULL,
    to_number       VARCHAR(20) NOT NULL,
    message_text    TEXT,
    template_id     INT,                             -- FK if template was used
    twilio_sid      VARCHAR(64),
    status          VARCHAR(20),
                    -- 'queued','sending','sent','delivered','failed','received'
    error_code      VARCHAR(10),
    error_message   TEXT,
    segments        SMALLINT DEFAULT 1,              -- SMS segments count
    date_created    TIMESTAMP NOT NULL DEFAULT NOW(),
    date_delivered  TIMESTAMP,

    INDEX idx_entity        (entity_type, entity_id),
    INDEX idx_from          (from_number),
    INDEX idx_to            (to_number),
    INDEX idx_twilio        (twilio_sid),
    INDEX idx_date          (date_created),
    INDEX idx_status        (status)
);

-- ============================================================
-- 3.1.6 SMS Templates
-- ============================================================
CREATE TABLE sms_templates (
    id              SERIAL PRIMARY KEY,
    title           VARCHAR(255) NOT NULL,
    message         TEXT NOT NULL,
    category        VARCHAR(50),                     -- 'ETA','CONFIRMATION','FOLLOWUP','OTHER'
    placeholders    JSONB,                           -- available placeholders metadata
    is_active       BOOLEAN DEFAULT TRUE,
    sort_order      INT DEFAULT 500,
    created_by      INT,
    date_created    TIMESTAMP DEFAULT NOW(),
    date_modified   TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 3.1.7 SMS Opt-out (TCPA compliance)
-- ============================================================
CREATE TABLE sms_optout (
    id              SERIAL PRIMARY KEY,
    phone           VARCHAR(20) UNIQUE NOT NULL,
    contact_id      INT,
    date_optout     TIMESTAMP NOT NULL DEFAULT NOW(),
    date_optin      TIMESTAMP,                       -- if re-subscribed
    is_active       BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- 3.1.8 Call Tags
-- ============================================================
CREATE TABLE call_tags (
    id              SERIAL PRIMARY KEY,
    call_id         INT NOT NULL REFERENCES calls(id),
    tag             VARCHAR(50) NOT NULL,
                    -- 'SPAM','WRONG_NUMBER','ROBOCALL','SALES','FOLLOW_UP',
                    -- 'EMERGENCY','COMPLAINT','VOICEMAIL'
    tagged_by       INT NOT NULL,
    date_created    TIMESTAMP DEFAULT NOW(),

    UNIQUE(call_id, tag),
    INDEX idx_tag           (tag),
    INDEX idx_call          (call_id)
);

-- ============================================================
-- 3.1.9 Spam Numbers
-- ============================================================
CREATE TABLE spam_numbers (
    id              SERIAL PRIMARY KEY,
    phone           VARCHAR(20) NOT NULL,
    reason          VARCHAR(50),                     -- 'TELEMARKETER','ROBOCALL','WRONG_NUMBER','OTHER'
    reported_by     INT NOT NULL,
    is_blocked      BOOLEAN DEFAULT FALSE,           -- manual block
    report_count    INT DEFAULT 1,
    date_created    TIMESTAMP DEFAULT NOW(),

    UNIQUE(phone),
    INDEX idx_phone         (phone)
);

-- ============================================================
-- 3.1.10 Call Transfers
-- ============================================================
CREATE TABLE call_transfers (
    id                  SERIAL PRIMARY KEY,
    original_call_sid   VARCHAR(64) NOT NULL,
    consult_call_sid    VARCHAR(64),
    target_user_id      INT NOT NULL,
    initiator_user_id   INT NOT NULL,
    status              VARCHAR(20) DEFAULT 'INITIATED',
                        -- 'INITIATED','CONSULTING','COMPLETED','CANCELLED','FAILED'
    conference_name     VARCHAR(100),
    date_initiated      TIMESTAMP DEFAULT NOW(),
    date_completed      TIMESTAMP
);

-- ============================================================
-- 3.1.11 Conferences
-- ============================================================
CREATE TABLE conferences (
    id                  SERIAL PRIMARY KEY,
    conference_name     VARCHAR(100) UNIQUE NOT NULL,
    original_call_sid   VARCHAR(64) NOT NULL,
    initiator_user_id   INT NOT NULL,
    participants        JSONB,                       -- [{user_id, call_sid, status}]
    status              VARCHAR(20) DEFAULT 'ACTIVE',
    date_created        TIMESTAMP DEFAULT NOW(),
    date_ended          TIMESTAMP
);

-- ============================================================
-- 3.1.12 Service Area Numbers
-- ============================================================
CREATE TABLE service_area_numbers (
    id              SERIAL PRIMARY KEY,
    state           VARCHAR(5) NOT NULL,             -- 'TX','AL','CT','IL','AZ','NY'
    client_type     VARCHAR(20) NOT NULL,            -- 'Regular','Platinum'
    phone_number    VARCHAR(20) UNIQUE NOT NULL,     -- E.164 format
    twilio_sid      VARCHAR(64),                     -- Twilio Phone Number SID
    label           VARCHAR(100),                    -- "Texas Regular"
    is_sms_enabled  BOOLEAN DEFAULT TRUE,
    is_voice_enabled BOOLEAN DEFAULT TRUE,
    is_active       BOOLEAN DEFAULT TRUE,

    UNIQUE(state, client_type)
);

-- Seed data: 12 numbers (6 states × 2 types)
INSERT INTO service_area_numbers (state, client_type, phone_number, label) VALUES
('TX', 'Regular',  '+14695521001', 'Texas Regular'),
('TX', 'Platinum', '+14695522001', 'Texas Platinum'),
('AL', 'Regular',  '+12563881001', 'Alabama Regular'),
('AL', 'Platinum', '+12563882001', 'Alabama Platinum'),
('CT', 'Regular',  '+12037699001', 'Connecticut Regular'),
('CT', 'Platinum', '+12037699002', 'Connecticut Platinum'),
('IL', 'Regular',  '+13128761001', 'Illinois Regular'),
('IL', 'Platinum', '+13128762001', 'Illinois Platinum'),
('AZ', 'Regular',  '+16235441001', 'Arizona Regular'),
('AZ', 'Platinum', '+16235442001', 'Arizona Platinum'),
('NY', 'Regular',  '+16468821001', 'New York Regular'),
('NY', 'Platinum', '+16468822001', 'New York Platinum');

-- ============================================================
-- 3.1.13 Dispatcher Availability (cached in Redis, persisted here)
-- ============================================================
CREATE TABLE dispatcher_availability (
    user_id         INT PRIMARY KEY,
    is_online       BOOLEAN DEFAULT FALSE,
    is_clocked_in   BOOLEAN DEFAULT FALSE,
    is_on_call      BOOLEAN DEFAULT FALSE,
    current_call_sid VARCHAR(64),
    last_activity   TIMESTAMP,
    date_updated    TIMESTAMP DEFAULT NOW()
);
```

### 3.2 Redis Cache Structure

```
# Dispatcher availability (real-time)
dispatcher:available              → SET of user_ids (currently available)
dispatcher:{user_id}:status       → HASH {online, clocked_in, on_call, call_sid}
dispatcher:{user_id}:last_call    → TIMESTAMP

# Call state (during active calls)
call:{twilio_sid}:state           → HASH {status, from, to, answered_by, deal_id, ...}
call:{twilio_sid}:draft_id        → INT (deal draft ID)

# Transfer state
transfer:{call_sid}               → HASH {consult_sid, target_user, status}

# Conference state
conference:{name}                 → HASH {participants, initiator, status}

# Missed calls counter
missed_calls:pending_count        → INT

# SMS rate limiting
sms:rate_limit:{from_number}      → counter (max 200/day per number)

# Queue: calls waiting
call_queue                        → LIST of {call_sid, from, to, timestamp}
```

---

## 4. API Endpoints

### 4.1 Twilio Webhooks (Incoming from Twilio)

These endpoints receive callbacks from Twilio. All must validate the `X-Twilio-Signature` header.

```
POST /webhooks/twilio/voice/inbound
  ← Twilio calls this when inbound call arrives
  → Returns TwiML to route call to dispatcher queue

POST /webhooks/twilio/voice/status
  ← Twilio sends call status updates (initiated, ringing, answered, completed)
  → Updates call record in DB, triggers events

POST /webhooks/twilio/voice/queue-wait
  ← Twilio requests hold music for queued callers
  → Returns TwiML with hold music loop

POST /webhooks/twilio/voice/fallback
  ← Twilio calls this after 120s timeout (no answer)
  → Returns TwiML for voicemail or forward to manager

POST /webhooks/twilio/recording/status
  ← Twilio sends when recording is ready
  → Downloads recording, stores in S3, links to Deal timeline

POST /webhooks/twilio/sms/inbound
  ← Twilio sends inbound SMS
  → Routes to CRM entity, notifies dispatchers

POST /webhooks/twilio/sms/status
  ← Twilio sends SMS delivery status updates
  → Updates SMS log status (delivered, failed, etc.)

POST /webhooks/twilio/masked-call/connect
  ← Twilio Function calls this for extension-based routing
  → Returns TwiML to connect tech ↔ client via masking

POST /webhooks/twilio/callback/connect
  ← Called when dispatcher answers callback call
  → Returns TwiML to dial client

POST /webhooks/twilio/callback/result
  ← Called when callback completes
  → Updates missed call status

POST /webhooks/twilio/transfer/consult
  ← Called when transfer target answers
  → Returns TwiML for consultation phase

POST /webhooks/twilio/transfer/status
  ← Transfer call status updates

POST /webhooks/twilio/conference/join
  ← Called when conference participant answers
  → Returns TwiML to join conference room
```

### 4.2 REST API (Called by CRM/Frontend)

#### 4.2.1 Calls

```
# --- Outbound Calls ---

POST /api/calls/outbound
  Body: {
    deal_id: number,
    to_number: string,         // client phone
    dispatcher_user_id: number,
    caller_id?: string         // override caller ID (defaults to deal's called_number)
  }
  Response: {
    success: boolean,
    call_sid: string,
    status: string
  }

POST /api/calls/masked
  Body: {
    deal_id: number,
    tech_user_id: number
  }
  Response: {
    success: boolean,
    call_sid: string,
    extension: string,         // the extension dialed
    masked_caller_id: string   // company number shown to client
  }

# --- Call Control ---

POST /api/calls/{call_sid}/hold
  Body: { hold: boolean }
  Response: { success: boolean }

POST /api/calls/{call_sid}/mute
  Body: { mute: boolean }
  Response: { success: boolean }

POST /api/calls/{call_sid}/hangup
  Response: { success: boolean }

# --- Transfer ---

POST /api/calls/{call_sid}/transfer
  Body: {
    target_user_id: number,
    type: "warm"               // only warm transfer supported
  }
  Response: {
    success: boolean,
    consult_call_sid: string,
    status: "consulting"
  }

POST /api/calls/{call_sid}/transfer/complete
  Body: {
    consult_call_sid: string
  }
  Response: { success: boolean }

POST /api/calls/{call_sid}/transfer/cancel
  Response: { success: boolean }

# --- Conference ---

POST /api/calls/{call_sid}/conference
  Body: {
    participants: number[]      // user_ids to add
  }
  Response: {
    success: boolean,
    conference_name: string,
    participants: [{ user_id, call_sid, status }]
  }

POST /api/conferences/{name}/add-participant
  Body: { user_id: number }
  Response: { success: boolean, call_sid: string }

POST /api/conferences/{name}/remove-participant
  Body: { participant_call_sid: string }
  Response: { success: boolean }
```

#### 4.2.2 Call Log

```
GET /api/calls
  Query: {
    direction?: "inbound" | "outbound" | "masked",
    status?: string,
    from_number?: string,
    contact_id?: number,
    deal_id?: number,
    date_from?: ISO8601,
    date_to?: ISO8601,
    tags?: string[],           // filter by tags
    has_recording?: boolean,
    answered_by?: number,      // user_id
    search?: string,           // full-text search in notes
    page?: number,
    per_page?: number,         // default 50, max 200
    sort_by?: "date" | "duration",
    sort_order?: "asc" | "desc"
  }
  Response: {
    items: Call[],
    total: number,
    page: number,
    per_page: number
  }

GET /api/calls/{call_id}
  Response: {
    call: Call,
    recording?: Recording,
    tags: string[],
    timeline_events: TimelineEvent[],
    transfer?: TransferInfo
  }

# --- Tagging ---

POST /api/calls/{call_id}/tags
  Body: { tag: string }
  Response: { success: boolean }

DELETE /api/calls/{call_id}/tags/{tag}
  Response: { success: boolean }

# --- Spam ---

POST /api/calls/{call_id}/mark-spam
  Body: {
    reason: "TELEMARKETER" | "ROBOCALL" | "WRONG_NUMBER" | "OTHER"
  }
  Response: { success: boolean }
```

#### 4.2.3 Recordings

```
GET /api/recordings/{recording_id}/stream
  → Returns audio stream (proxies from Twilio or S3)
  → Supports Range headers for seeking

GET /api/recordings/{recording_id}/download
  → Returns file download (Content-Disposition: attachment)

GET /api/recordings/{recording_id}/url
  Response: {
    url: string,               // presigned URL (valid 1 hour)
    duration: number,
    format: string
  }
```

#### 4.2.4 SMS

```
POST /api/sms/send
  Body: {
    deal_id?: number,
    contact_id?: number,
    to_number: string,
    message: string,
    template_id?: number,
    template_data?: object     // placeholder values
  }
  Response: {
    success: boolean,
    message_sid: string,
    status: string,
    from_number: string        // auto-selected caller ID
  }

GET /api/sms/conversations/{entity_type}/{entity_id}
  → Returns all SMS for a Deal/Contact/Lead, sorted chronologically
  Response: {
    messages: SmsMessage[],
    entity: { type, id, name }
  }

GET /api/sms/templates
  Query: { category?: string, active_only?: boolean }
  Response: { templates: SmsTemplate[] }

POST /api/sms/templates
  Body: { title, message, category, placeholders }
  Response: { id: number }

PUT /api/sms/templates/{id}
  Body: { title?, message?, category?, is_active? }

POST /api/sms/templates/{id}/preview
  Body: { deal_id: number }
  Response: { rendered_message: string }

# --- Opt-out ---

GET /api/sms/optout/check/{phone}
  Response: { opted_out: boolean, date_optout?: string }
```

#### 4.2.5 Missed Calls

```
GET /api/missed-calls
  Query: {
    status?: "PENDING" | "CALLED_BACK" | "RESOLVED" | "IGNORED",
    date_from?: ISO8601,
    date_to?: ISO8601,
    page?: number,
    per_page?: number
  }
  Response: {
    items: MissedCall[],
    total: number,
    pending_count: number
  }

POST /api/missed-calls/{id}/callback
  Body: {
    dispatcher_user_id: number
  }
  Response: {
    success: boolean,
    call_sid: string
  }

POST /api/missed-calls/{id}/resolve
  Body: { notes?: string }
  Response: { success: boolean }

POST /api/missed-calls/bulk-action
  Body: {
    ids: number[],
    action: "RESOLVE" | "IGNORE"
  }
  Response: {
    success: boolean,
    updated_count: number
  }
```

#### 4.2.6 Drafts

```
POST /api/drafts
  Body: {
    call_id: string,
    phone: string,
    client_id?: number,
    contact_name?: string,
    street?: string,
    city?: string,
    state?: string,
    zip?: string,
    job_type?: string,
    notes?: string,
    job_source?: string,
    metro_area?: string,
    created_by: number
  }
  Response: { draft_id: number }

PUT /api/drafts/{id}
  Body: { ...partial fields }
  Response: { success: boolean }

GET /api/drafts/by-phone/{phone}
  → Find open draft for phone number (used when client calls back)
  Response: { draft?: DealDraft }

POST /api/drafts/{id}/convert
  → Converts draft to CRM Deal
  Response: { success: boolean, deal_id: number }
```

#### 4.2.7 Supervisor Monitoring

```
GET /api/monitoring/active-calls
  Response: {
    calls: [{
      call_sid: string,
      direction: string,
      from_number: string,
      to_number: string,
      dispatcher_name: string,
      dispatcher_user_id: number,
      duration: number,          // seconds since answered
      status: string,
      deal_id?: number,
      contact_name?: string
    }]
  }

POST /api/monitoring/{call_sid}/listen
  Body: { supervisor_user_id: number }
  → Supervisor joins call silently (can hear both parties, no one hears supervisor)
  Response: { success: boolean, monitor_call_sid: string }

POST /api/monitoring/{call_sid}/whisper
  Body: { supervisor_user_id: number }
  → Supervisor joins call, only dispatcher hears supervisor
  Response: { success: boolean, monitor_call_sid: string }

POST /api/monitoring/{call_sid}/barge
  Body: { supervisor_user_id: number }
  → Supervisor joins as full conference participant (everyone hears everyone)
  Response: { success: boolean, monitor_call_sid: string }

POST /api/monitoring/{monitor_call_sid}/stop
  → Supervisor leaves the call
  Response: { success: boolean }
```

#### 4.2.8 Dispatcher Availability

```
POST /api/dispatchers/clock-in
  Body: { user_id: number }
  Response: { success: boolean }

POST /api/dispatchers/clock-out
  Body: { user_id: number }
  Response: { success: boolean }

GET /api/dispatchers/available
  Response: {
    dispatchers: [{
      user_id: number,
      name: string,
      is_on_call: boolean,
      current_call_sid?: string,
      last_activity: ISO8601
    }]
  }

POST /api/dispatchers/{user_id}/status
  Body: { status: "available" | "busy" | "break" }
  Response: { success: boolean }
```

---

## 5. Module Specifications

### 5.1 Inbound Call Routing Module

#### 5.1.1 Call Distribution Logic

```
WHEN inbound call arrives:
  1. Extract metadata from Twilio webhook:
     - from_number, to_number
     - job_source (from Twilio metadata/tracking params)
     - caller_city, caller_state (Twilio Lookup by area code)

  2. Create call record in DB (status: 'initiated')

  3. Lookup caller in CRM:
     - Search contacts by phone number
     - If found: load name, address, last deal info
     - If not found: mark as "New Client"
     - Check spam_numbers table: if exists, add warning flag
     - Check deal_drafts table: if open draft exists, include it

  4. Determine available dispatchers:
     - Query Redis SET dispatcher:available
     - Filter: is_online=true AND is_clocked_in=true AND is_on_call=false

  5. Ring all available dispatchers simultaneously:
     - Return TwiML <Dial> with multiple <Client> elements
     - Each dispatcher gets pop-up via WebSocket push:
       {
         event: "incoming_call",
         call_sid, from_number, job_source, caller_city,
         contact: { found, name, address, last_job_type, last_job_date },
         spam_warning: boolean,
         draft: { id, street, city } | null
       }

  6. First dispatcher to answer:
     - Update call record: answered_by = user_id, status = 'in-progress'
     - Update dispatcher availability: is_on_call = true
     - Remove pop-up from all other dispatchers (WebSocket: "call_claimed")
     - Start recording
     - Open Deal Draft form on dispatcher's screen

  7. If no answer within 120 seconds:
     - Check forwarding rules:
       Option A: Route to voicemail → TwiML <Record>
       Option B: Forward to shift manager
     - Create missed_call record
     - Auto-create deal draft for new contacts
```

#### 5.1.2 Queue Management

```
WHEN all dispatchers busy AND new call arrives:
  1. Add call to call_queue in Redis
  2. Return TwiML: hold music + "Your call is important..." message
  3. Push WebSocket event to dashboard: queue_updated (count)

WHEN any dispatcher finishes a call:
  1. Check call_queue
  2. If calls waiting:
     - Pop oldest call from queue
     - Route to newly available dispatcher
     - Push notification: "1 call waiting in queue"

AFTER 120 seconds in queue:
  1. Apply timeout rules (voicemail/forward)
  2. Create missed_call record
```

### 5.2 Outbound Calls & Masking Module

#### 5.2.1 Dispatcher Outbound Call

```
WHEN dispatcher initiates call from Deal:
  1. Determine caller ID:
     - Priority 1: Deal.called_number (the number client originally called)
     - Priority 2: Service area number based on client state + client type
     - Priority 3: Default fallback number

  2. Create Twilio call:
     - TO: client phone number
     - FROM: selected caller ID
     - record: record-from-answer

  3. Create call record: direction='outbound', deal_id, caller_id

  4. Call connects → update status, start recording
```

#### 5.2.2 Technician Masked Call (Extension-Based)

```
Architecture:
  Tech → dials company number + extension → Twilio Function → routes to client
  Client → sees company number, NOT tech's personal number
  Tech → sees extension display, NOT client's number

WHEN tech initiates masked call:
  1. Tech's mobile app sends POST /api/calls/masked { deal_id, tech_user_id }

  2. Backend:
     a. Load deal → get client phone, service area number
     b. Generate/retrieve extension for this deal
     c. Initiate Twilio call:
        - Call tech's phone
        - When tech answers → Twilio Function connects to client
        - CallerID for client = service area company number
        - Recording enabled

  3. Both parties connected through Twilio bridge
     - Neither party has the other's direct number
     - Call logged to Deal timeline

EXTENSION ROUTING (for callbacks):
  WHEN client calls back company number:
    → IVR: "Press 1 for Deal #XXXX" or "Press 0 for dispatch"
    → If extension entered: route through dispatcher queue (NOT directly to tech)
    → Dispatcher can manually transfer to tech if needed
```

#### 5.2.3 Caller ID Selection Logic

```
function getCallerIdForDeal(deal_id, direction):
  deal = getDeal(deal_id)
  contact = getContact(deal.contact_id)

  if direction == 'outbound_dispatcher':
    // Use the number client originally called
    if deal.called_number AND isValidTwilioNumber(deal.called_number):
      return deal.called_number

    // Fallback to service area
    state = extractState(contact.address)
    client_type = contact.client_type || 'Regular'
    return lookupServiceAreaNumber(state, client_type)

  if direction == 'masked_tech':
    // Always use service area number for masking
    state = extractState(contact.address)
    return lookupServiceAreaNumber(state, contact.client_type)
```

### 5.3 SMS Module

#### 5.3.1 Outbound SMS Flow

```
WHEN dispatcher sends SMS:
  1. Validate:
     - Check sms_optout table → if opted out, return error
     - Check rate limit: max 200 SMS/day per from_number
     - Validate phone format (E.164)

  2. Select FROM number:
     - Same logic as caller ID selection (deal.called_number → service area → fallback)

  3. If template selected:
     - Load template from sms_templates
     - Replace placeholders: {CLIENT_NAME}, {APPOINTMENT_DATE}, {ETA_TIME}, etc.
     - Data source: Deal fields, Contact fields, custom template_data

  4. Send via Twilio:
     twilioClient.messages.create({
       to: to_number,
       from: from_number,
       body: message,
       statusCallback: '/webhooks/twilio/sms/status'
     })

  5. Create sms_log record (status: 'queued')

  6. Return immediately to frontend (async delivery)

  7. Twilio status callback updates:
     queued → sending → sent → delivered (or failed)
     → Update sms_log.status
     → If failed: create follow-up task, notify dispatcher
```

#### 5.3.2 Inbound SMS Flow

```
WHEN Twilio webhook receives inbound SMS:
  1. Validate X-Twilio-Signature

  2. Find CRM entity:
     - Search by from_number:
       a. Active Deal with this phone → link to Deal
       b. Contact with this phone → link to Contact
       c. Not found → create new Lead

  3. Check for STOP/UNSUBSCRIBE:
     - If message body matches opt-out keywords:
       → Add to sms_optout
       → Send confirmation: "You have been unsubscribed..."
       → Return (don't notify dispatchers)

  4. Save to sms_log (direction: INBOUND, status: received)

  5. Add to CRM entity timeline

  6. Notify all online dispatchers:
     - WebSocket push: { event: "sms_inbound", entity, from, message }
     - Browser notification
     - Sound alert

  7. Return empty TwiML response to Twilio
```

#### 5.3.3 TCPA Compliance

```
Opt-out keywords: STOP, UNSUBSCRIBE, CANCEL, END, QUIT
Opt-in keywords:  START, YES, UNSTOP

BEFORE sending any SMS:
  if isOptedOut(to_number):
    return { allowed: false, reason: "Client opted out" }

WHEN "STOP" received:
  → Insert/update sms_optout (is_active = true)
  → Auto-reply: "You have been unsubscribed. Reply START to re-subscribe."

WHEN "START" received:
  → Update sms_optout (is_active = false, date_optin = now)
  → Auto-reply: "You have been re-subscribed to SMS notifications."
```

### 5.4 Call Recording & Storage Module

#### 5.4.1 Recording Lifecycle

```
Phase 1: RECORDING (during call)
  - Twilio records call in real-time
  - record-from-answer mode (doesn't record ringing)
  - Dual-channel option: channel 1 = caller, channel 2 = dispatcher

Phase 2: HOT STORAGE (day 0-30)
  - Recording stored on Twilio CDN (free for 30 days)
  - Instant playback via Twilio URL
  - Also immediately copied to S3 for redundancy

Phase 3: COLD STORAGE (day 31+)
  - Daily cron job checks recordings older than 30 days
  - Downloads from Twilio (if not already on S3)
  - Deletes from Twilio (stops storage charges)
  - Updates recording_url in DB to S3 URL
  - Playback via presigned S3 URL (1-hour expiry)

Phase 4: EXPIRY (after 2 years)
  - Weekly cron checks recordings where expires_at < now
  - Deletes from S3
  - Marks record as EXPIRED in DB
  - Retains metadata (call_id, duration) but no audio file
```

#### 5.4.2 Recording Webhook Handler

```
WHEN Twilio sends recording-complete webhook:
  1. Validate signature
  2. Extract: RecordingSid, RecordingUrl, Duration, CallSid, Channels
  3. If RecordingStatus == 'absent': log error, return
  4. Find call in DB by CallSid
  5. Download recording from Twilio (authenticated request)
  6. Upload to S3:
     - Key: recordings/{YYYY}/{MM}/{DD}/{RecordingSid}.mp3
     - Encrypted at rest (AES-256)
     - Metadata: CallSid, Duration, EntityType, EntityId
  7. Insert into call_recordings table
  8. Add to CRM timeline (playback widget)
  9. Return 200 OK
```

#### 5.4.3 Migration Cron Job (Daily, 2 AM)

```
SELECT id, twilio_sid, recording_url
FROM call_recordings
WHERE date_created < NOW() - INTERVAL '30 days'
  AND storage_location = 'TWILIO'
  AND migrated_to_s3 = false
LIMIT 100;

FOR EACH recording:
  1. Verify S3 copy exists (uploaded during Phase 2)
     - If missing: download from Twilio → upload to S3
  2. Update DB: storage_location = 'S3', recording_url = s3_url
  3. Delete from Twilio: twilioClient.recordings(sid).delete()
  4. Mark migrated_to_s3 = true, date_migrated = now
  5. Log: "Recording {id} migrated to S3"
```

#### 5.4.4 PCI Compliance (Payment Recording Pause)

```
WHEN dispatcher processes payment during call:
  1. Frontend sends: POST /api/calls/{call_sid}/recording/pause
  2. Backend: twilioClient.calls(call_sid).recordings.list() → pause
  3. Payment form displayed
  4. After payment: POST /api/calls/{call_sid}/recording/resume
  5. Recording resumes (gap in audio during payment)
```

### 5.5 Supervisor Monitoring Module

#### 5.5.1 Listen Mode (Silent)

```
WHEN supervisor clicks "Listen":
  1. Get active call's conference SID
  2. Add supervisor to Twilio Conference as "coach":
     conference.participants.create({
       from: SUPERVISOR_PHONE or CLIENT_ID,
       to: supervisor's device,
       coach: true,
       muted: true   // supervisor is silent
     })
  3. Supervisor hears both parties
  4. Neither party hears supervisor
  5. Log: monitoring_event { call_sid, supervisor_id, mode: "listen" }
```

#### 5.5.2 Whisper Mode

```
WHEN supervisor clicks "Whisper":
  1. Same as Listen, but:
     conference.participants.create({
       from: SUPERVISOR_PHONE,
       to: supervisor's device,
       coach: DISPATCHER_PARTICIPANT_SID  // only dispatcher hears
     })
  2. Supervisor speaks → only dispatcher hears
  3. Client does NOT hear supervisor
  4. Use case: coaching during live call
```

#### 5.5.3 Barge Mode

```
WHEN supervisor clicks "Barge":
  1. Add supervisor as regular conference participant:
     conference.participants.create({
       from: SUPERVISOR_PHONE,
       to: supervisor's device,
       // no coach flag → full participant
     })
  2. Everyone hears everyone (3-way call)
  3. Use case: escalation, taking over call
```

### 5.6 Missed Calls Module

#### 5.6.1 Detection Logic

```
A call is MISSED when:
  - direction = 'inbound'
  - AND (status IN ('no-answer', 'busy', 'canceled'))
  - AND (duration = 0 OR answered = false)

NOT missed:
  - Outbound calls
  - Calls that were answered even briefly (duration > 0)
  - Internal transfers
```

#### 5.6.2 One-Click Callback Flow

```
WHEN dispatcher clicks "Call Back" for missed call #123:
  1. Backend:
     a. Get dispatcher's phone (SIP/softphone or mobile)
     b. Get service area number for client's number
     c. Twilio calls DISPATCHER first:
        twilioClient.calls.create({
          to: dispatcher_phone,
          from: service_area_number,
          url: '/webhooks/twilio/callback/connect?missedCallId=123&clientPhone=+1555...',
          record: 'record-from-answer',
          statusCallback: '/webhooks/twilio/callback/result'
        })

  2. Dispatcher answers:
     → TwiML: "Connecting you to the client. Please wait."
     → <Dial callerId="{service_area_number}">
         <Number>{client_phone}</Number>
       </Dial>

  3. Client answers → connected

  4. Update missed_call: status = 'CALLED_BACK'

  5. Create new call record linked to original missed call
```

#### 5.6.3 Auto-Draft Creation

```
WHEN missed call detected AND caller is NEW (no contact in CRM):
  1. Auto-create Contact in CRM
  2. Create deal_draft:
     - title: "Missed Call - {date/time}"
     - phone: caller number
     - service_area: from called_number lookup
     - status: DRAFT
     - assigned_to: round-robin (dispatcher with fewest active deals today)
  3. Link draft to missed_call record
  4. Push notification to assigned dispatcher
```

### 5.7 Call Control Module

#### 5.7.1 Warm Transfer

```
1. Dispatcher A → POST /api/calls/{sid}/transfer { target_user_id: B }
2. Backend:
   a. Put client on hold (TwiML: hold music)
   b. Call Dispatcher B
   c. Dispatcher A briefs Dispatcher B (consultation phase)
3. Dispatcher A → POST /api/calls/{sid}/transfer/complete
4. Backend:
   a. Create conference room
   b. Move client call into conference
   c. Move Dispatcher B's call into conference
   d. Disconnect Dispatcher A
5. Client now talks with Dispatcher B
```

#### 5.7.2 Conference Calling

```
1. Dispatcher A → POST /api/calls/{sid}/conference { participants: [B, C] }
2. Backend:
   a. Create Twilio Conference room
   b. Move current call (client) into conference
   c. Call each participant → join conference
3. All parties hear each other
4. Dispatcher A can:
   - Add more participants: POST /api/conferences/{name}/add-participant
   - Remove participants: POST /api/conferences/{name}/remove-participant
   - End conference: all disconnected when initiator leaves
```

#### 5.7.3 Hold/Mute

```
POST /api/calls/{call_sid}/hold { hold: true }
  → twilioClient.calls(callSid).update({
      twiml: '<Response><Play loop="100">{hold_music_url}</Play></Response>'
    })
  → Both parties hear hold music

POST /api/calls/{call_sid}/hold { hold: false }
  → Reconnect to live call (restore conference)

POST /api/calls/{call_sid}/mute { mute: true }
  → twilioClient.calls(callSid).update({ muted: true })
  → Dispatcher is muted, client doesn't hear dispatcher
  → Dispatcher still hears client
```

---

## 6. Events (WebSocket / Event Bus)

The service emits the following events for real-time frontend updates:

```typescript
// --- Call Events ---
call.incoming           { call_sid, from, to, contact, job_source, spam_warning, draft }
call.claimed            { call_sid, answered_by }    // dismiss pop-up on other dispatchers
call.status_changed     { call_sid, old_status, new_status }
call.ended              { call_sid, duration, recording_available }
call.queue_updated      { queue_count }

// --- Recording Events ---
recording.ready         { call_id, recording_id, url, duration }

// --- SMS Events ---
sms.inbound             { entity_type, entity_id, from, message, timestamp }
sms.status_updated      { sms_id, old_status, new_status }

// --- Missed Call Events ---
missed_call.new         { id, from_number, contact_name, date }
missed_call.resolved    { id, resolved_by }
missed_call.count       { pending_count }

// --- Transfer Events ---
transfer.initiated      { call_sid, initiator, target }
transfer.consulting     { call_sid }
transfer.completed      { call_sid, transferred_to }
transfer.cancelled      { call_sid }

// --- Conference Events ---
conference.created      { name, call_sid, participants }
conference.participant_joined   { name, user_id }
conference.participant_left     { name, user_id }
conference.ended        { name }

// --- Monitoring Events ---
monitoring.started      { call_sid, supervisor_id, mode }
monitoring.stopped      { call_sid, supervisor_id }

// --- Dispatcher Events ---
dispatcher.status       { user_id, status }
dispatcher.availability { available_count }
```

---

## 7. Background Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| `RecordingMigrationJob` | Daily 2:00 AM | Migrate recordings >30 days from Twilio to S3 |
| `RecordingExpiryJob` | Weekly Sunday 3:00 AM | Delete recordings >2 years from S3 |
| `DraftCleanupJob` | Daily 4:00 AM | Mark drafts >7 days as ABANDONED, delete |
| `MissedCallArchiveJob` | Daily 5:00 AM | Archive missed calls >90 days |
| `SmsLogCleanupJob` | Monthly 1st, 2:00 AM | Archive SMS logs >2 years |
| `DispatcherAvailabilitySync` | Every 60 seconds | Sync Redis availability with DB |
| `CallQueueHealthCheck` | Every 30 seconds | Check for stuck calls in queue |
| `SmsRetryJob` | Every 5 minutes | Retry failed SMS (max 3 attempts) |
| `TwilioHealthCheck` | Every 60 seconds | Ping Twilio API, alert if down |

---

## 8. Security

### 8.1 Twilio Webhook Validation

Every incoming webhook from Twilio MUST be validated:

```
1. Extract X-Twilio-Signature header
2. Compute expected signature using:
   - Webhook URL
   - POST body parameters
   - Twilio Auth Token
3. Compare signatures
4. If mismatch → return 403, log security event
```

### 8.2 API Authentication

```
- All /api/* endpoints require Bearer token (JWT)
- Token contains: user_id, role, permissions
- Role-based access:
  - Dispatcher: calls, sms, drafts, missed-calls
  - Supervisor/Manager: + monitoring, call-log (all), recordings
  - Admin: + templates, service-area-numbers, configuration
  - Technician: calls/masked (own deals only), NO access to client numbers
```

### 8.3 Data Privacy

```
- Client phone numbers: NEVER exposed to technicians
- Technician phone numbers: NEVER exposed to clients
- Call recordings: accessible only to dispatchers, managers, admins
- SMS content: accessible only to dispatchers assigned to Deal
- Recording URLs: presigned with 1-hour expiry
- All data encrypted at rest (DB, S3)
- All data encrypted in transit (TLS 1.3)
```

### 8.4 Rate Limiting

```
- Twilio webhooks: no rate limit (trust Twilio)
- API endpoints: 100 req/sec per user
- SMS sending: 200 SMS/day per FROM number (Twilio limit)
- Recording downloads: 10 req/min per user
- Monitoring (listen/whisper/barge): 5 concurrent sessions total
```

---

## 9. Performance Requirements

| Metric | Target |
|--------|--------|
| Inbound call webhook → TwiML response | < 500ms |
| CRM contact lookup during pop-up | < 2 seconds |
| Call connection time (ring start to answer) | < 5 seconds |
| Pop-up WebSocket push to all dispatchers | < 200ms |
| Recording playback start (hot storage) | < 1 second |
| Recording playback start (cold storage/S3) | < 3 seconds |
| SMS send API response | < 1 second |
| SMS delivery (Twilio processing) | < 10 seconds |
| Missed call detection → dashboard update | < 2 seconds |
| Whisper/Barge connection | < 3 seconds |
| Call log query (50 records, filtered) | < 100ms |
| Missed calls dashboard query | < 50ms |
| Draft auto-save round-trip | < 500ms |
| Active calls list (monitoring) | < 200ms |

### 9.1 Concurrency

```
Expected load:
- ~15 concurrent calls during peak hours
- ~5 dispatchers online simultaneously
- ~100 calls/day
- ~200 SMS/day
- ~10 missed calls/day
- ~1-2 supervisor monitoring sessions concurrent

The service should handle 10x expected load without degradation.
```

---

## 10. Error Handling

### 10.1 Twilio Failures

| Scenario | Handling |
|----------|----------|
| Twilio API unreachable | Return cached TwiML fallback, alert ops |
| Recording webhook fails | Retry 3x with exponential backoff |
| SMS delivery fails (30003 - unreachable) | Retry in 5 min (max 3x), then notify dispatcher |
| SMS to landline (21610) | Return error "Number does not support SMS" |
| Call masking fails | Fall back to regular outbound (log warning) |
| Transfer target doesn't answer | Return client from hold, notify dispatcher |
| Conference creation fails | Abort conference, return to 1:1 call |

### 10.2 Internal Failures

| Scenario | Handling |
|----------|----------|
| DB connection lost | Queue writes in Redis, replay on recovery |
| Redis unavailable | Fall back to DB queries for dispatcher availability |
| S3 upload fails | Keep recording on Twilio, retry migration next day |
| WebSocket push fails | Frontend polls /api/missed-calls every 30s as fallback |
| Draft auto-save fails | Retry immediately, show error toast after 3 failures |

### 10.3 Conflict Resolution

```
Scenario: Tech marks status but dispatcher reassigned job
  → Server returns 409 Conflict
  → Mobile app: "This job was reassigned. Refreshing..."
  → Force refresh

Scenario: Two dispatchers try to answer same call
  → First TCP ACK wins (Twilio handles this)
  → Second dispatcher gets "call_claimed" event via WebSocket

Scenario: Draft exists but Deal already created
  → Mark draft as CONVERTED
  → Don't create duplicate Deal
```

---

## 11. Monitoring & Observability

### 11.1 Health Check Endpoint

```
GET /health
Response: {
  status: "healthy" | "degraded" | "unhealthy",
  checks: {
    database: { status, latency_ms },
    redis: { status, latency_ms },
    twilio: { status, last_check },
    s3: { status, last_check }
  },
  uptime_seconds: number,
  version: string
}
```

### 11.2 Key Metrics (Prometheus)

```
# Call metrics
telephony_calls_total{direction, status}
telephony_call_duration_seconds{direction}
telephony_call_queue_size
telephony_call_connection_time_seconds

# Recording metrics
telephony_recordings_total{storage_location}
telephony_recording_migration_total{status}
telephony_recording_storage_bytes{location}

# SMS metrics
telephony_sms_total{direction, status}
telephony_sms_delivery_time_seconds
telephony_sms_optout_total

# Missed calls
telephony_missed_calls_total
telephony_missed_calls_pending
telephony_callback_response_time_seconds

# Monitoring
telephony_active_monitoring_sessions{mode}

# System
telephony_webhook_latency_seconds{endpoint}
telephony_api_latency_seconds{endpoint}
telephony_error_total{type}
```

### 11.3 Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| Twilio API down | Health check fails 3x | Critical |
| Call queue growing | queue_size > 5 for > 2 min | High |
| Recording webhook backlog | > 50 unprocessed recordings | Medium |
| SMS delivery rate drop | delivery_rate < 90% over 1 hour | High |
| No dispatchers available | available_count = 0 during business hours | Critical |
| Missed call rate spike | missed_calls > 10 in 30 min | High |
| S3 upload failures | > 5 failures in 1 hour | Medium |
| Database connection pool exhausted | connections > 90% | Critical |

---

## 12. Cost Estimates

### 12.1 Twilio Costs (Monthly)

```
Voice:
  - Inbound calls:  ~3,000 min/month × $0.0085/min  = $25.50
  - Outbound calls: ~2,000 min/month × $0.013/min   = $26.00
  - Masked calls:   ~1,000 min/month × $0.013/min   = $13.00
  - Phone numbers:  12 numbers × $1.00/month         = $12.00
  - Recording:      Free first 30 days (migrated to S3 after)

SMS:
  - Outbound:       ~42,000/month × $0.0079          = $331.80
  - Inbound:        ~28,000/month × $0.0079          = $221.20

Total Twilio: ~$630/month (~$7,560/year)
```

### 12.2 Storage Costs (Monthly)

```
Recordings (cold storage - Backblaze B2):
  - ~3,000 calls/month × avg 3 min × ~1 MB/min = 9 GB/month
  - Cumulative over 2 years: ~216 GB
  - Storage: 216 GB × $0.006/GB/month = $1.30/month
  - Egress (playback): ~50 GB/month × $0.01/GB = $0.50/month

Total Storage: ~$2/month (~$24/year)
```

### 12.3 Infrastructure Costs

```
  - Server (application): existing infrastructure
  - Redis: existing infrastructure
  - PostgreSQL: existing infrastructure
  - Additional overhead: minimal

  Total additional infra: ~$0 (uses existing)
```

---

## 13. Testing Strategy

### 13.1 Unit Tests

```
- Caller ID selection logic (deal number → service area → fallback)
- Missed call detection (various statuses, edge cases)
- TCPA opt-out keyword matching
- SMS template placeholder replacement
- Draft lifecycle (create, update, convert, abandon)
- Spam number lookup and warning generation
- Queue timeout calculations
- Rate limiting counters
```

### 13.2 Integration Tests

```
- Twilio webhook signature validation (valid, invalid, missing)
- Full inbound call flow: webhook → DB → WebSocket → pop-up
- Full SMS flow: send → Twilio → delivery callback → status update
- Recording lifecycle: webhook → S3 upload → migration → expiry
- Masked call flow: initiate → Twilio Function → connect → record
- Callback flow: dispatcher answers → client connected → status updated
- Transfer flow: hold → consult → complete (or cancel)
- Conference flow: create → add participants → remove → end
```

### 13.3 Load Tests

```
- 50 concurrent inbound calls (5x peak)
- 500 SMS/minute burst
- 100 simultaneous recording playback streams
- 1000 call log queries/minute
- WebSocket: 50 connected clients, 10 events/second
```

### 13.4 Test Environment

```
- Twilio Test Credentials (no real calls, no charges)
- Test phone numbers: +15005550001 through +15005550009
- Ngrok / localtunnel for webhook testing during development
```

---

## 14. Deployment

### 14.1 Environment Variables

```env
# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxx
TWILIO_AUTH_TOKEN=xxxxxx
TWILIO_API_KEY_SID=SKxxxxxx
TWILIO_API_KEY_SECRET=xxxxxx

# S3-Compatible Storage
S3_ENDPOINT=https://s3.us-west-002.backblazeb2.com
S3_REGION=us-west-002
S3_BUCKET=locksmith-recordings
S3_ACCESS_KEY=xxxxxx
S3_SECRET_KEY=xxxxxx

# Database
DATABASE_URL=postgresql://user:pass@host:5432/telephony

# Redis
REDIS_URL=redis://host:6379

# Application
APP_URL=https://api.your-domain.com
HOLD_MUSIC_URL=https://cdn.your-domain.com/hold-music.mp3
VOICEMAIL_GREETING_URL=https://cdn.your-domain.com/voicemail.mp3

# Timeouts & Limits
RING_TIMEOUT_SECONDS=120
DRAFT_AUTOSAVE_INTERVAL=5000
DRAFT_TTL_DAYS=7
RECORDING_HOT_STORAGE_DAYS=30
RECORDING_RETENTION_YEARS=2
SMS_RETENTION_YEARS=2
MISSED_CALL_ARCHIVE_DAYS=90
SMS_DAILY_RATE_LIMIT=200
MAX_SMS_RETRY_ATTEMPTS=3

# WebSocket
WS_PORT=8080

# Monitoring
PROMETHEUS_PORT=9090
```

### 14.2 Required Twilio Configuration

```
1. Purchase 12 phone numbers (6 states × 2 types)
2. Configure each number:
   - Voice URL: {APP_URL}/webhooks/twilio/voice/inbound
   - Voice Fallback URL: {APP_URL}/webhooks/twilio/voice/fallback
   - SMS URL: {APP_URL}/webhooks/twilio/sms/inbound
   - Status Callback: {APP_URL}/webhooks/twilio/voice/status
3. Create Messaging Service (all 12 numbers)
4. Deploy Twilio Functions for extension-based masking
5. Configure recording settings:
   - recordingStatusCallback on all call endpoints
   - Dual-channel recording for monitoring-capable calls
```

### 14.3 Database Migrations

```
Migration order:
  001_create_calls_table
  002_create_call_recordings_table
  003_create_deal_drafts_table
  004_create_missed_calls_table
  005_create_sms_log_table
  006_create_sms_templates_table
  007_create_sms_optout_table
  008_create_call_tags_table
  009_create_spam_numbers_table
  010_create_call_transfers_table
  011_create_conferences_table
  012_create_service_area_numbers_table
  013_create_dispatcher_availability_table
  014_seed_service_area_numbers
  015_seed_sms_templates
```

---

## 15. Dependencies on Other Services

| Service | Dependency | Direction |
|---------|------------|-----------|
| **CRM Service** | Contact/Deal/Lead lookup, Deal creation, Timeline events | Telephony → CRM |
| **Auth/IAM Service** | User authentication, role verification | Telephony → IAM |
| **Notification Service** | Push notifications for mobile (new job, missed call) | Telephony → Notifications |
| **Dispatch Service** | GPS location for technician (context in pop-up) | Telephony → Dispatch |
| **Payment Service** | PCI compliance signal (pause/resume recording) | Payment → Telephony |

---

## 16. File/Module Structure

```
telephony-service/
├── src/
│   ├── config/
│   │   ├── database.ts
│   │   ├── redis.ts
│   │   ├── twilio.ts
│   │   ├── s3.ts
│   │   └── env.ts
│   │
│   ├── webhooks/                  # Twilio incoming webhooks
│   │   ├── voice/
│   │   │   ├── inbound.ts         # Inbound call routing
│   │   │   ├── status.ts          # Call status updates
│   │   │   ├── queue-wait.ts      # Hold music TwiML
│   │   │   ├── fallback.ts        # Timeout → voicemail/forward
│   │   │   └── masked-connect.ts  # Extension-based masking
│   │   ├── recording/
│   │   │   └── status.ts          # Recording complete handler
│   │   ├── sms/
│   │   │   ├── inbound.ts         # Inbound SMS handler
│   │   │   └── status.ts          # Delivery status updates
│   │   ├── callback/
│   │   │   ├── connect.ts         # Missed call callback connect
│   │   │   └── result.ts          # Callback result
│   │   ├── transfer/
│   │   │   ├── consult.ts         # Transfer consultation phase
│   │   │   └── status.ts          # Transfer status updates
│   │   └── conference/
│   │       └── join.ts            # Conference participant join
│   │
│   ├── api/                       # REST API routes
│   │   ├── calls.ts               # Call CRUD, outbound, masked
│   │   ├── call-control.ts        # Hold, mute, transfer, conference
│   │   ├── call-log.ts            # Call log listing, filtering, tagging
│   │   ├── recordings.ts          # Stream, download, URL
│   │   ├── sms.ts                 # Send, conversations, templates
│   │   ├── missed-calls.ts        # List, callback, resolve
│   │   ├── drafts.ts              # CRUD, convert
│   │   ├── monitoring.ts          # Active calls, listen/whisper/barge
│   │   └── dispatchers.ts         # Availability, clock-in/out
│   │
│   ├── services/                  # Business logic
│   │   ├── CallRoutingService.ts
│   │   ├── CallerIdService.ts
│   │   ├── MaskingService.ts
│   │   ├── RecordingService.ts
│   │   ├── SmsService.ts
│   │   ├── SmsTemplateEngine.ts
│   │   ├── TcpaService.ts
│   │   ├── MissedCallService.ts
│   │   ├── DraftService.ts
│   │   ├── TransferService.ts
│   │   ├── ConferenceService.ts
│   │   ├── MonitoringService.ts
│   │   ├── DispatcherService.ts
│   │   ├── SpamService.ts
│   │   ├── CrmLookupService.ts    # Contact/Deal lookup (calls CRM service)
│   │   └── WebSocketService.ts    # Real-time event broadcasting
│   │
│   ├── jobs/                      # Background jobs
│   │   ├── RecordingMigrationJob.ts
│   │   ├── RecordingExpiryJob.ts
│   │   ├── DraftCleanupJob.ts
│   │   ├── MissedCallArchiveJob.ts
│   │   ├── SmsLogCleanupJob.ts
│   │   ├── SmsRetryJob.ts
│   │   ├── DispatcherAvailabilitySyncJob.ts
│   │   └── CallQueueHealthCheckJob.ts
│   │
│   ├── middleware/
│   │   ├── twilioSignature.ts     # Validate Twilio webhook signature
│   │   ├── auth.ts                # JWT validation
│   │   ├── rateLimit.ts           # Rate limiting
│   │   └── errorHandler.ts        # Global error handling
│   │
│   ├── models/                    # Database models / types
│   │   ├── Call.ts
│   │   ├── CallRecording.ts
│   │   ├── DealDraft.ts
│   │   ├── MissedCall.ts
│   │   ├── SmsLog.ts
│   │   ├── SmsTemplate.ts
│   │   ├── SmsOptout.ts
│   │   ├── CallTag.ts
│   │   ├── SpamNumber.ts
│   │   ├── CallTransfer.ts
│   │   ├── Conference.ts
│   │   └── ServiceAreaNumber.ts
│   │
│   ├── events/                    # Event definitions
│   │   └── types.ts
│   │
│   └── utils/
│       ├── phoneFormat.ts         # E.164 normalization
│       ├── twimlBuilder.ts        # TwiML response helpers
│       └── logger.ts
│
├── migrations/                    # Database migrations
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── docker-compose.yml
├── Dockerfile
└── package.json
```

---

**End of Telephony Backend Service Specification**
