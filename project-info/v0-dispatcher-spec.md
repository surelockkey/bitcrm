# v0 Technical Specification: Dispatcher Dashboard

## Project Overview

Build a **front-end only** dispatcher dashboard for a locksmith field service management platform. This is a desktop-first web application for dispatchers who manage inbound calls, assign jobs to field technicians, track technician locations on a map, and handle customer communications.

**Design System:** GitHub/Vercel inspired — clean, minimal, monochrome with subtle accent colors. Use `shadcn/ui` components, `Tailwind CSS`, `Lucide icons`, `Inter` font. Dark sidebar, light content area. No gradients, no heavy shadows. Functional density over whitespace.

**Stack:** Next.js App Router, TypeScript, React, Tailwind CSS, shadcn/ui. All data is mocked — no real API calls. Use realistic locksmith industry data (addresses in Atlanta GA metro area, realistic job types, technician names, phone numbers).

**Resolution:** Optimized for 1920×1080 desktop. Responsive down to 1280×800. Not mobile.

---

## Global Layout

```
┌──────────────────────────────────────────────────────────┐
│ TOP BAR (h-14, sticky)                                    │
├────────┬─────────────────────────────────────────────────┤
│        │                                                  │
│  SIDE  │              MAIN CONTENT                       │
│  BAR   │              (scrollable)                       │
│  (w-64)│                                                  │
│        │                                                  │
│        │                                                  │
│        │                                                  │
│        │                                                  │
│        │                                                  │
└────────┴─────────────────────────────────────────────────┘
```

### Top Bar
- **Left:** Breadcrumb showing current location (e.g., `Dispatch / Map View`)
- **Center:** Global search bar — `⌘K` to open command palette. Placeholder: "Search jobs, clients, technicians..." Styled like GitHub's command palette
- **Right section (flex row, gap-3):**
  - Active calls indicator: red pulsing dot + count badge `3 active` — clicking opens Active Calls popover
  - Missed calls badge: bell icon with red count badge (e.g., `5`) — clicking opens Missed Calls popover
  - Notification bell with count
  - User avatar dropdown: dispatcher name "Sarah Johnson", role "Dispatcher", links to Settings, Sign Out

### Sidebar (dark background `bg-zinc-950`, text `text-zinc-400`)
- **Logo area (top):** App name "LockFlow" with lock icon, small text "Dispatch Console"
- **Navigation groups:**

**MAIN**
- Dashboard (LayoutDashboard icon) — `/`
- Dispatch Map (Map icon) — `/dispatch` — **this is the primary page**
- Jobs (Briefcase icon) — `/jobs`

**COMMUNICATION**
- Active Calls (Phone icon) — `/calls/active` — show live count badge
- Missed Calls (PhoneMissed icon) — `/calls/missed` — show pending count badge in red
- Call Log (PhoneCall icon) — `/calls/log`
- SMS (MessageSquare icon) — `/sms`

**TEAM**
- Technicians (Users icon) — `/technicians`

**REPORTS**
- Commission Report (DollarSign icon) — `/reports/commission`
- Performance (BarChart3 icon) — `/reports/performance`

**Bottom of sidebar:**
- Settings gear icon
- Collapse sidebar button
- Clock-in/Clock-out toggle with green/red indicator and current shift time "Clocked in: 4h 23m"

**Active page** indicator: left border accent `border-l-2 border-blue-500` + `bg-zinc-900` + `text-zinc-100`

### Command Palette (⌘K)
Modal overlay with search input at top. Shows recent items, then grouped results:
- Jobs: `#12345 — Lock Installation — 123 Main St`
- Clients: `Jane Doe — (555) 123-4567`
- Technicians: `John Smith — Available — 2 of 4 jobs`
Keyboard navigable with arrow keys. Esc to close.

---

## Page 1: Dashboard (`/`)

Overview page with key metrics and activity feed. Two-column layout on desktop.

### Top Row — Metric Cards (4 cards in a row, equal width)
Each card: white bg, subtle border, icon top-left, metric value large, label below, small trend indicator.

```
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ 📋 12      │ │ 🚗 8       │ │ 📞 3       │ │ ✅ 23      │
│ Unassigned │ │ In Progress│ │ Missed     │ │ Completed  │
│ Jobs       │ │ Jobs       │ │ Calls      │ │ Today      │
│ ↑ 2 vs avg │ │ — normal   │ │ ↓ 1 vs avg │ │ ↑ 5 vs avg │
└────────────┘ └────────────┘ └────────────┘ └────────────┘
```

### Left Column (2/3 width)

**Recent Activity Feed** — scrollable list of timestamped events:
```
• 2 min ago — Job #12389 assigned to Mike Jones by Sarah Johnson
• 5 min ago — Missed call from (555) 234-5678 — New Lead
• 8 min ago — John Smith completed Job #12385 — Lock Installation
• 12 min ago — Payment received: $350 for Job #12380 (Stripe)
• 15 min ago — SMS received from Jane Doe: "When will tech arrive?"
• 18 min ago — Job #12388 created from inbound call — Lockout Service
```
Each entry has an icon, timestamp (relative), description, and optional action link.

**Unassigned Jobs Queue** — table with columns:
| Job # | Type | Address | Client | Scheduled | Value | Age | Actions |
Rows are clickable. "Age" shows time since creation with color coding (green <30min, yellow 30-60min, red >60min). Actions: `[Assign]` `[View]`.

### Right Column (1/3 width)

**Technician Status Panel** — vertical list:
```
┌─────────────────────────────┐
│ TECHNICIANS (15 active)     │
├─────────────────────────────┤
│ 🟢 John Smith     [2 of 4] │
│    📍 Decatur, GA — 1m ago  │
├─────────────────────────────┤
│ 🟡 Mike Jones     [3 of 3] │
│    📍 Midtown — 30s ago     │
├─────────────────────────────┤
│ 🟢 Sarah Lee      [1 of 5] │
│    📍 Buckhead — 2m ago     │
├─────────────────────────────┤
│ 🔴 Tom Brown      Lunch     │
│    📍 Marietta — 8m ago     │
└─────────────────────────────┘
```
Status dot colors: 🟢 Available, 🟡 On Job, 🔴 Busy/Break, ⚫ Offline.
Click tech name → navigate to tech profile.

**Active Calls Widget** — compact list of current live calls:
```
┌─────────────────────────────┐
│ ACTIVE CALLS (2)            │
├─────────────────────────────┤
│ 📞 (555) 123-4567  03:24   │
│    Dispatcher: Mike Brown   │
│    [Listen] [Whisper]       │
├─────────────────────────────┤
│ 📞 (555) 987-6543  01:15   │
│    Dispatcher: Sarah Johnson│
│    [Listen] [Whisper]       │
└─────────────────────────────┘
```

---

## Page 2: Dispatch Map (`/dispatch`) — PRIMARY PAGE

This is the main working page. Full-width map with overlays.

### Layout
```
┌──────────────────────────────────────────────────────────┐
│ TOOLBAR                                                    │
├──────────────────────────────────────────────────────────┤
│                                                            │
│                    MAP AREA                                │
│               (fills remaining height)                    │
│                                                            │
│                                    ┌──────────────────┐  │
│                                    │    SIDEBAR        │  │
│                                    │  (job details/    │  │
│                                    │   tech list)      │  │
│                                    │  slides from      │  │
│                                    │  right on click   │  │
│                                    └──────────────────┘  │
│                                                            │
├──────────────────────────────────────────────────────────┤
│ BOTTOM BAR: "12 unassigned • 8 in progress • 15 techs"   │
└──────────────────────────────────────────────────────────┘
```

### Toolbar (h-12, flex row, items-center, border-b)
- **Left:**
  - Filter dropdown button: "Filters" with funnel icon. Click opens popover:
    - Job Type: multi-select checkboxes (Lockout, Lock Installation, Rekey, Key Duplication, Safe Opening, Commercial Lock, Access Control)
    - Service Area: multi-select checkboxes (Atlanta, North GA, East Atlanta, Buckhead, Midtown, Decatur, Marietta)
    - Status: checkboxes (Unassigned ✓, Assigned, In Progress)
    - Date: Today / This Week / Custom Range
    - `[Apply]` `[Clear All]` buttons at bottom
    - Show active filter count on button: "Filters (3)"
  - View toggle: `Map` | `List` | `Split` — segmented control. Map is default
  - Refresh button with "Last updated: 15s ago" tooltip
- **Right:**
  - Search box: "Search jobs or technicians..."
  - Job count badge: "Showing 12 of 45 jobs"
  - Fullscreen toggle button

### Map Area
Use a placeholder map component (static image or embedded map). On the map, render these overlays:

**Unassigned Job Pins (red):**
Place 12 red pins scattered across Atlanta metro area. Each pin:
- Red circle (#DC3545) with wrench icon inside
- On hover: tooltip card with shadow:
  ```
  Job #12345 — Lock Installation
  123 Main St, Atlanta GA
  Scheduled: 2:00 PM
  Value: $250
  Age: 25 min
  ```
- On click: opens Job Detail Sidebar (right side)

**Assigned Job Pins (colored with sequence numbers):**
Place 8 colored pins near technician icons. Each pin:
- Circle in technician's assigned color with white number: `[1]`, `[2]`, `[3]`
- On hover: tooltip: "Tech: John Smith — Job [2 of 4] — In Progress"

**Technician Icons:**
Place 15 technician markers. Each marker:
- Circular avatar with technician initials and unique color (`bg-blue-500`, `bg-green-500`, etc.)
- Status ring: green (available), yellow (on job), red (busy)
- Small badge showing current job: `2/4`
- If last update >5 min: gray overlay with clock icon
- On hover: tooltip:
  ```
  John Smith (#12)
  Status: On Job [2 of 4]
  Last seen: 30 seconds ago
  📍 456 Oak Ave, Decatur
  Skills: Lockout, Rekey, Installation
  ```
- On click: opens Technician sidebar panel

**Pin Clustering:**
If zoomed out enough, cluster nearby pins into numbered circles. Show count: `(5)` with color intensity based on count.

### Job Detail Sidebar (slides from right, w-96)

Opens when clicking an unassigned job pin.

```
┌─────────────────────────────────────┐
│ Job #12345                     [×]  │
│ ────────────────────────────────── │
│                                     │
│ 📍 123 Main St, Atlanta GA 30303   │
│    [Open in Google Maps ↗]         │
│                                     │
│ 🔧 Lock Installation               │
│ 📍 Metro: Atlanta                   │
│ 📅 Today, 2:00 PM                  │
│ 💰 Est. $250                       │
│ ⏱  Created 25 min ago              │
│                                     │
│ 📞 Client: Jane Doe                │
│    (555) 123-4567                  │
│    [Call] [SMS]                     │
│                                     │
│ 📝 Notes:                          │
│ "Front door lock broken, client    │
│  locked out. Needs immediate       │
│  service. Has a dog."              │
│                                     │
│ 📦 Required Items:                 │
│ • Kwikset Deadbolt (KB-100)        │
│ • 3x Keys                          │
│                                     │
│ Source: Google Ads                  │
│ Called: +1 (469) 552-1001          │
│                                     │
│ ─────────────────────────────────  │
│                                     │
│ QUALIFIED TECHNICIANS (5 of 18):   │
│                                     │
│ ┌─────────────────────────────────┐│
│ │ 🟢 John Smith                  ││
│ │    Skills: ✅ Lockout, Rekey    ││
│ │    Area: ✅ Atlanta, North GA   ││
│ │    Jobs: 2 of 4                 ││
│ │    Items: ✅ KB-100 (3 units)   ││
│ │    ETA: ~15 min                 ││
│ │                                  ││
│ │    [Assign to John]             ││
│ ├─────────────────────────────────┤│
│ │ 🟢 Mike Jones                  ││
│ │    Skills: ✅ Lockout            ││
│ │    Area: ✅ Atlanta              ││
│ │    Jobs: 1 of 3                 ││
│ │    Items: ⚠️ Missing KB-100     ││
│ │    ETA: ~22 min                 ││
│ │                                  ││
│ │    [Assign to Mike]             ││
│ ├─────────────────────────────────┤│
│ │ 🟡 Sarah Lee                   ││
│ │    Skills: ✅ Lockout, Locksmith ││
│ │    Area: ✅ Atlanta, East ATL   ││
│ │    Jobs: 3 of 5                 ││
│ │    Items: ✅ KB-100 (1 unit)    ││
│ │    ETA: ~35 min                 ││
│ │                                  ││
│ │    [Assign to Sarah]            ││
│ └─────────────────────────────────┘│
│                                     │
│ ℹ️ 13 excluded:                    │
│   6 missing skill • 5 wrong area   │
│   2 offline                        │
│                                     │
│ [Show All Technicians]             │
│                                     │
│ ─────────────────────────────────  │
│ [View Full Deal →]  [Cancel Job]   │
└─────────────────────────────────────┘
```

**Assign button behavior:**
1. Click `[Assign to John]`
2. Show confirmation dialog: "Assign Job #12345 to John Smith?" with `[Cancel]` `[Assign]` buttons
3. On confirm: show success toast "Job #12345 assigned to John Smith ✅" and sidebar closes
4. Map pin changes from red to John's color with sequence number

**Show All Technicians** — expands list to show ALL 18 techs. Non-qualified ones shown with red warnings:
```
❌ NOT MATCHING (13):

⚠️ Tom Brown
   ❌ Missing skill: Lockout
   ✅ Area: Atlanta
   Jobs: 0 of 3
   [Assign Anyway]

⚠️ Lisa White
   ✅ Skills: Lockout
   ❌ Area: Marietta (not Atlanta)
   Jobs: 2 of 4
   [Assign Anyway]
```
`[Assign Anyway]` shows warning dialog: "This technician doesn't meet the requirements for this job. Missing: Lockout skill. Assign anyway?" `[Cancel]` `[Assign Override]`

### Technician Sidebar (slides from right, w-96)

Opens when clicking a technician icon on map.

```
┌─────────────────────────────────────┐
│ John Smith (#12)               [×]  │
│ 🟢 Available                       │
│ ────────────────────────────────── │
│                                     │
│ 📍 456 Oak Ave, Decatur GA         │
│    Last update: 30 seconds ago     │
│                                     │
│ Skills: Lockout, Rekey, Locksmith, │
│         Installation               │
│ Areas: Atlanta, North GA, Decatur  │
│                                     │
│ ─────────────────────────────────  │
│                                     │
│ TODAY'S JOBS (2 of 4):             │
│                                     │
│ ┌─────────────────────────────────┐│
│ │ [1] ✅ Lock Repair              ││
│ │     789 Pine St — Completed     ││
│ ├─────────────────────────────────┤│
│ │ [2] 🔴 Lock Installation       ││
│ │     456 Oak Ave — In Progress   ││
│ ├─────────────────────────────────┤│
│ │ [3] ⚪ Rekey Service            ││
│ │     321 Elm Rd — 3:00 PM       ││
│ ├─────────────────────────────────┤│
│ │ [4] ⚪ Lockout Service          ││
│ │     654 Maple Dr — 5:00 PM     ││
│ └─────────────────────────────────┘│
│                                     │
│ Drag to reorder ↕                  │
│                                     │
│ ─────────────────────────────────  │
│ Revenue Today: $580                │
│ Completed: 1 job                   │
│ Container: 47 items in stock       │
│                                     │
│ [View Full Profile →]              │
│ [Call Tech] [Message]              │
└─────────────────────────────────────┘
```

Job list is drag-and-drop reorderable. Dragging shows ghost preview and resequences numbers. After reorder, show toast: "Job sequence updated. Technician notified."

### Bottom Status Bar (h-8, border-t, text-xs)
- Left: "12 unassigned • 8 in progress • 23 completed today"
- Center: "15 technicians online • 2 offline • 1 on break"
- Right: "Last refresh: 15s ago • Auto-refresh: ON" with toggle

---

## Page 3: Jobs List (`/jobs`)

Table view of all jobs/deals with advanced filtering.

### Toolbar
- Tab bar: `All` | `Unassigned` | `Assigned` | `In Progress` | `Completed` | `Cancelled` — with count badges
- Filter button (same filter popover as map page)
- Search: "Search by job #, address, client..."
- Date range picker: "Today" | "This Week" | "This Month" | Custom
- Export button: "Export CSV"
- `[+ New Job]` button (primary blue)

### Table
Columns (all sortable by clicking header):

| Job # | Status | Type | Client | Phone | Address | Metro | Technician | Scheduled | Value | Source | Created | Actions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| #12389 | `🔴 Unassigned` | Lockout | Jane Doe | (555) 123-4567 | 123 Main St, Atlanta | Atlanta | — | Today 2:00 PM | $250 | Google Ads | 25m ago | `[Assign] [View]` |
| #12388 | `🟡 Assigned` | Rekey | Bob Wilson | (555) 234-5678 | 456 Oak Ave, Decatur | Decatur | John Smith [2] | Today 3:00 PM | $180 | Direct | 1h ago | `[View] [Reassign]` |
| #12385 | `🟢 Completed` | Lock Install | Mary Clark | (555) 345-6789 | 789 Elm Rd, Buckhead | Buckhead | Mike Jones | Today 11:00 AM | $350 | Bing Ads | 3h ago | `[View]` |

- Status badges: colored pill badges (red=Unassigned, yellow=Assigned, blue=In Progress, green=Completed, gray=Cancelled)
- Rows are clickable → open job detail slide-over panel (same as map sidebar)
- Pagination at bottom: "Showing 1-25 of 342 jobs" with page controls
- Bulk select checkboxes → bulk actions bar: "3 selected — [Assign] [Cancel] [Export]"

### Job Detail Slide-Over
When clicking a row, a slide-over panel opens from the right (w-[480px]) showing full deal details:

**Tabs:** `Details` | `Timeline` | `Invoice` | `Files`

**Details tab:**
- All job fields organized in sections: Client Info, Address, Job Details, Assignment, Financial
- Editable inline fields (click to edit)
- Tags section with add/remove capability

**Timeline tab:**
Chronological activity feed:
```
📞 2:30 PM — Incoming call from Jane Doe (5m 20s)
   Source: Google Ads
   🎧 [Play Recording] [Download]
   Answered by: Sarah Johnson

📝 2:35 PM — Deal created by Sarah Johnson
   Status: Submitted → New

📱 2:38 PM — SMS sent to Jane Doe
   "Your technician is on the way! ETA: 30 min"
   ✓ Delivered

🚗 2:45 PM — Job assigned to John Smith by Sarah Johnson
   Sequence: [3 of 4]

✅ 3:15 PM — John Smith accepted job

📍 3:45 PM — John Smith started work
   Location: 123 Main St, Atlanta
```

---

## Page 4: Active Calls (`/calls/active`)

Real-time view of all currently active calls.

### Layout
Grid of call cards (3 per row on desktop).

```
┌──────────────────────────────┐
│ 📞 ACTIVE — 03:24            │
│ ──────────────────────────── │
│ Caller: (555) 123-4567       │
│ Client: Jane Doe (Existing)  │
│ Source: Google Ads            │
│ Location: Atlanta, GA        │
│                               │
│ Dispatcher: Sarah Johnson    │
│                               │
│ Deal: #12389 — Lockout       │
│                               │
│ [Listen] [Whisper] [Barge]   │
└──────────────────────────────┘
```

- Call duration ticks up in real-time (simulated with setInterval)
- `[Listen]` — button turns blue when active, shows "Listening..." state
- `[Whisper]` — shows warning: "Dispatcher can hear you, client cannot"
- `[Barge]` — shows confirmation: "You will join the call. Both parties will hear you."
- Empty state: "No active calls" with phone icon

---

## Page 5: Missed Calls (`/calls/missed`)

### Toolbar
- Tab bar: `Pending (5)` | `Called Back (12)` | `Resolved (34)` | `All`
- Sort: "Newest First" dropdown
- Bulk actions: checkboxes on each card → `[Mark Resolved]` `[Assign to Me]`
- Auto-refresh indicator: green pulsing dot + "Auto-refresh: ON"

### Missed Call Cards (stacked list, full width)

```
┌──────────────────────────────────────────────────────────┐
│ [ ] 📞 (555) 123-4567                    2 minutes ago   │
│     👤 John Smith — Existing Client                      │
│     🏷 Active deal: #12345 — Lock Installation           │
│     📍 Atlanta, GA                                        │
│     Last contact: Today, 10:30 AM                        │
│                                                           │
│     [📞 Call Back]  [📱 SMS]  [✓ Mark Resolved]          │
├──────────────────────────────────────────────────────────┤
│ [ ] 📞 (555) 234-5678                    5 minutes ago   │
│     🆕 NEW LEAD — Unknown caller                         │
│     📍 Decatur, GA (area code lookup)                    │
│     💾 Auto-draft: Deal #DRAFT-003                       │
│                                                           │
│     [📞 Call Back]  [📱 SMS]  [✓ Mark Resolved]          │
├──────────────────────────────────────────────────────────┤
│ [ ] 📞 (555) 345-6789                    8 minutes ago   │
│     👤 Mary Clark — Existing Client                      │
│     📍 Buckhead, GA                                       │
│     🎤 Voicemail: "Need lockout service ASAP, please..." │
│     [▶ Play Voicemail]                                   │
│                                                           │
│     [📞 Call Back]  [📱 SMS]  [✓ Mark Resolved]          │
└──────────────────────────────────────────────────────────┘
```

- Pending calls have a subtle left red border
- Called Back calls have blue left border
- Resolved calls have green left border + muted text
- "Call Back" button simulates initiating a call (show toast: "Calling (555) 123-4567...")
- Sound indicator icon for voicemail entries

---

## Page 6: Call Log (`/calls/log`)

### Toolbar
- Date range picker
- Filters: Direction (Inbound / Outbound / Masked), Status (Answered / Missed / Voicemail), Duration range, Dispatcher, Technician
- Search: "Search by phone, client, job #..."
- Export CSV button
- Tag filter pills: `Spam` `Wrong Number` `Follow-up` `VIP`

### Table

| Time | Direction | Phone | Client | Duration | Dispatcher | Deal | Status | Tags | Recording | Actions |
|---|---|---|---|---|---|---|---|---|---|---|
| 2:35 PM | ↙ Inbound | (555) 123-4567 | Jane Doe | 5:20 | Sarah Johnson | #12389 | ✅ Answered | — | [▶] | [View Deal] |
| 2:28 PM | ↙ Inbound | (555) 999-0000 | Unknown | 0:00 | — | — | ❌ Missed | `Spam` | — | [Call Back] [Tag ▼] |
| 2:15 PM | ↗ Outbound | (555) 234-5678 | Bob Wilson | 2:45 | Mike Brown | #12388 | ✅ Answered | — | [▶] | [View Deal] |
| 1:50 PM | 🔒 Masked | (555) 345-6789 | Mary Clark | 3:10 | — | #12385 | ✅ Answered | `VIP` | [▶] | [View Deal] |

- Direction icons: ↙ Inbound (green), ↗ Outbound (blue), 🔒 Masked (purple)
- Recording column: play button that shows inline audio player waveform
- Tag column: clicking `[Tag ▼]` shows dropdown with tag options
- Click row → expand inline to show call details + recording player

### Inline Expanded Row (below the clicked row)
```
┌──────────────────────────────────────────────────────────┐
│ Call Details                                               │
│                                                            │
│ 📞 (555) 123-4567 → +1 (469) 552-1001 (TX Regular)      │
│ Duration: 5:20 | Source: Google Ads | Metro: Atlanta      │
│                                                            │
│ 🎧 Recording:                                             │
│ ┌────────────────────────────────────────────────────┐   │
│ │ ▶ ───────────●────────────────── 2:15 / 5:20      │   │
│ │ [⏪] [▶/⏸] [⏩]  [Download]  [Transcribe]         │   │
│ └────────────────────────────────────────────────────┘   │
│                                                            │
│ Tags: [+ Add Tag]                                         │
│ Notes: [Click to add note...]                             │
│                                                            │
│ [View Deal #12389]  [Call Back]                           │
└──────────────────────────────────────────────────────────┘
```

---

## Page 7: SMS (`/sms`)

Split-pane messaging interface.

### Layout
```
┌────────────────┬─────────────────────────────────────────┐
│  CONVERSATIONS │  CONVERSATION VIEW                      │
│  (w-80)        │                                         │
│                │                                         │
│  Search...     │                                         │
│                │                                         │
│  Jane Doe      │                                         │
│  "When will..." │                                        │
│  2 min ago  🔵 │                                         │
│                │                                         │
│  Bob Wilson    │                                         │
│  "Thank you"   │                                         │
│  1h ago        │                                         │
│                │                                         │
│  Mary Clark    │                                         │
│  "Your tech..." │                                        │
│  3h ago        │                                         │
│                │                                         │
└────────────────┴─────────────────────────────────────────┘
```

### Left Panel — Conversation List
- Search box at top
- Each conversation: client name, last message preview (truncated), timestamp, unread dot
- Unread conversations have blue dot and bold text
- Active conversation highlighted with `bg-zinc-100`
- Filter tabs: `All` | `Unread (3)` | `Deals`

### Right Panel — Conversation View

**Header:**
```
┌──────────────────────────────────────────────────────────┐
│ Jane Doe  •  (555) 123-4567  •  Deal #12389             │
│ [📞 Call] [View Deal →]                                  │
└──────────────────────────────────────────────────────────┘
```

**Messages:**
Bubble-style chat. Outbound (right, blue bubbles), Inbound (left, gray bubbles).
```
┌─────────────────────────────────────┐
│                                      │
│   ┌──────────────────────┐          │
│   │ Hi, when will the    │  2:15 PM │
│   │ technician arrive?   │  Jane    │
│   └──────────────────────┘          │
│                                      │
│          ┌──────────────────────┐   │
│  2:18 PM │ Your technician is   │   │
│   Sarah  │ on the way! ETA:     │   │
│          │ 30 min               │   │
│          └──────────────────────┘   │
│              ✓✓ Delivered           │
│                                      │
│   ┌──────────────────────┐          │
│   │ Great, thank you!    │  2:20 PM │
│   │                      │  Jane    │
│   └──────────────────────┘          │
│                                      │
└─────────────────────────────────────┘
```

**Message Input:**
```
┌──────────────────────────────────────────────────────────┐
│ [Templates ▼]                                             │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Type a message...                                     │ │
│ └──────────────────────────────────────────────────────┘ │
│                                          45/1600  [Send] │
└──────────────────────────────────────────────────────────┘
```

**Templates dropdown:**
```
┌─────────────────────────────┐
│ ETA 30 min                   │
│ ETA On Way                   │
│ Job Confirmed                │
│ Payment Received             │
│ Request Quote                │
│ ──────────────────────────  │
│ [Manage Templates →]        │
└─────────────────────────────┘
```
Clicking template fills the message input with template text (placeholders pre-filled from deal data).

---

## Page 8: Technicians (`/technicians`)

### Layout
Grid of technician cards (4 per row) with list toggle option.

### Toolbar
- View toggle: `Grid` | `List`
- Filter: Status (Online / Offline / On Break), Skills, Service Area
- Search: "Search technicians..."
- Sort: "Name A-Z" | "Jobs Today" | "Status"

### Technician Card (Grid View)
```
┌────────────────────────────────┐
│  ┌────┐                        │
│  │ JS │  John Smith            │
│  └────┘  🟢 Available          │
│                                 │
│  📍 Decatur, GA (30s ago)      │
│  📋 Jobs: 2 of 4 today        │
│  💰 Revenue: $580 today       │
│                                 │
│  Skills: Lockout, Rekey,       │
│          Locksmith, Install    │
│                                 │
│  Areas: Atlanta, North GA,     │
│         Decatur                │
│                                 │
│  Container: 47 items           │
│                                 │
│  [View Profile] [Assign Job]   │
└────────────────────────────────┘
```

Avatar is colored circle with initials. Status dot on avatar corner.

### Technician Profile (slide-over panel, w-[560px])

**Tabs:** `Overview` | `Jobs Today` | `Inventory` | `Commission`

**Overview tab:**
- Personal info (name, phone, email, employee ID)
- Skills with badges (green pills)
- Service areas with badges
- Commission config: Base Rate 40%, CC Fee 3%
- Labor cost: $35/hr
- Clock-in status with shift duration
- GPS: Last location + timestamp
- Performance this month: jobs completed, revenue, avg job value

**Jobs Today tab:**
- Ordered list of today's jobs with sequence numbers, drag-to-reorder
- Status indicators per job
- Timeline of status changes

**Inventory tab:**
- Table of items in technician's container: SKU, Name, Qty, Last Restocked
- Search within container
- Low stock items highlighted in yellow
- Zero stock items highlighted in red

**Commission tab:**
- Mini commission preview for current period
- Per-job breakdown: Revenue, Parts Cost, Tax, CC Fee, Commission

---

## Page 9: Commission Report (`/reports/commission`)

### Toolbar
- Date range picker: "This Pay Period" | "Last Pay Period" | "This Month" | Custom
- Date type toggle: "By Close Date" | "By Created Date"
- Technician filter: multi-select dropdown
- Export: `[Export CSV]` `[Export Excel]`
- Print button

### Summary Cards (top row)
```
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ $45,230    │ │ $12,450    │ │ $2,340     │ │ $12,176    │
│ Total      │ │ Parts Cost │ │ CC Fees    │ │ Total      │
│ Revenue    │ │ (for Tech) │ │ Deducted   │ │ Commission │
└────────────┘ └────────────┘ └────────────┘ └────────────┘
```

### Report Table (grouped by technician)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▼ John Smith — Base Rate: 40% — CC Fee: 3%                   Total: $3,245 │
├──────────────────────────────────────────────────────────────────────────────┤
│ Deal #  │ Date   │ Type        │ Revenue │ Parts  │ Tax   │ CC Fee │ Commission│
│ #12345  │ Jan 12 │ Lock Install│ $350    │ $45    │ $28   │ $10.50 │ $106.60  │
│ #12350  │ Jan 12 │ Rekey       │ $180    │ $12    │ $14   │ $5.40  │ $59.44   │
│ #12358  │ Jan 13 │ Lockout     │ $250    │ $0     │ $20   │ $0     │ $92.00   │
│ ...     │        │             │         │        │       │        │          │
│         │        │   Subtotal: │ $8,450  │ $1,230 │ $676  │ $253.50│ $3,245.20│
├──────────────────────────────────────────────────────────────────────────────┤
│ ▼ Mike Jones — Base Rate: 40% — CC Fee: 3%                  Total: $2,890  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ...                                                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Collapsible technician sections (click header to expand/collapse)
- CC Fee column shows $0 for cash/ACH payments
- Formula shown in tooltip on column header: `Commission = (Revenue - Parts - Tax) × 40% - CC Fee`
- Grand total row at bottom with all columns summed

---

## Mocked Data Requirements

### 15 Technicians
Generate 15 technicians with:
- Realistic American names
- Unique colors from palette: blue, green, red, orange, purple, teal, pink, amber, cyan, lime, indigo, rose, emerald, sky, violet
- Skills subset from: Lockout, Lock Installation, Rekey, Key Duplication, Safe Opening, Commercial Lock, Access Control, Door Repair, Car Lockout, Master Key System
- Areas subset from: Atlanta, North GA, East Atlanta, Buckhead, Midtown, Decatur, Marietta, Sandy Springs, Roswell, Alpharetta
- Random GPS coordinates within Atlanta metro (lat: 33.70-33.85, lng: -84.50 to -84.30)
- Random job counts (0-6 per day)
- Status: 10 Available, 3 On Job, 1 Busy/Lunch, 1 Offline

### 45 Jobs
Generate 45 jobs with:
- Sequential IDs starting from #12340
- Statuses: 12 Unassigned, 8 Assigned, 15 In Progress, 8 Completed, 2 Cancelled
- Job types from the skills list above
- Realistic Atlanta addresses (use real street names: Peachtree St, Ponce de Leon Ave, Piedmont Rd, etc.)
- Client names (American first+last names)
- Phone numbers in (555) XXX-XXXX format
- Values: $80 - $500 range
- Sources: Google Ads (40%), Direct (25%), Bing Ads (15%), Referral (10%), Yelp (10%)
- Metro areas matching the address location
- Scheduled times throughout today (8 AM - 6 PM)
- Created timestamps: 5 min ago to 8 hours ago

### 25 Missed Calls
- 5 Pending, 8 Called Back, 12 Resolved
- Mix of existing clients and new leads
- Some with voicemail text
- Timestamps from recent 2 hours

### 50 Call Log Entries
- Mix of inbound (60%), outbound (30%), masked (10%)
- Durations: 0:00 to 15:00
- Some tagged as Spam, Wrong Number
- All with recording available (except missed)

### 10 SMS Conversations
- 3-8 messages each
- Mix of templates and custom messages
- Delivery statuses: delivered, failed
- Timestamps spread over today

### Commission Data
- 3 technicians with 8-15 deals each
- Revenue $80-$500 per deal
- Parts costs $0-$120
- Tax $0-$40
- CC Fee on ~60% of deals (card payments)
- Base rate 40% for all

---

## Interaction Patterns

### Toasts
Use shadcn toast component. Position: bottom-right. Types:
- Success (green left border): "Job #12345 assigned to John Smith ✅"
- Info (blue): "SMS delivered to (555) 123-4567"
- Warning (yellow): "Technician GPS stale — last update 8 min ago"
- Error (red): "Assignment failed — job already assigned"

Auto-dismiss after 5 seconds. Stackable (max 3 visible).

### Dialogs
Use shadcn AlertDialog for confirmations:
- "Assign Job #12345 to John Smith?" — `[Cancel]` `[Assign]`
- "Assign to unqualified technician? Missing: Lockout skill" — `[Cancel]` `[Assign Override]`
- "Mark 3 missed calls as resolved?" — `[Cancel]` `[Resolve All]`

### Loading States
- Skeleton loaders for cards and tables while data "loads" (simulate 500ms delay)
- Spinner on buttons during action (e.g., Assign button shows spinner for 1 second)
- "Refreshing..." overlay on map during refresh

### Empty States
- No results from filter: "No jobs match your filters" with `[Clear Filters]` button
- No missed calls: "All caught up! No pending missed calls." with check icon
- No active calls: "No active calls right now" with phone icon

### Keyboard Shortcuts
Display a help dialog (press `?`):
```
⌘K        Search / Command palette
⌘⇧M      Open dispatch map
⌘⇧J      Open jobs list
⌘⇧C      Open call log
?         Show keyboard shortcuts
Esc       Close panel / dialog
```

---

## Component Specifications

### Data Table Component
Reusable across Jobs, Call Log, Commission. Features:
- Sortable columns (click header to toggle asc/desc, show arrow indicator)
- Resizable columns (drag column border)
- Pinnable columns (pin to left)
- Row selection with checkboxes
- Inline expand on row click
- Pagination: 25/50/100 per page selector
- Column visibility toggle (eye icon menu)

### Map Component
Use `react-map-gl` with Mapbox or a placeholder colored div with positioned absolute markers for v0 prototype. Important: the map should take up the full available height (calc(100vh - topbar - toolbar - bottombar)).

### Metric Card Component
Reusable card with:
- Icon (top-left, muted color)
- Value (large, semibold)
- Label (small, muted)
- Trend indicator (↑ green / ↓ red / — neutral) with comparison text

### Status Badge Component
Pill-shaped badge with dot indicator:
- `Unassigned` — red bg, white text
- `Assigned` — yellow bg, dark text
- `In Progress` — blue bg, white text
- `Completed` — green bg, white text
- `Cancelled` — gray bg, white text

### Audio Player Component (for call recordings)
Inline waveform-style player:
- Play/Pause button
- Seekable progress bar with waveform visualization
- Current time / Total time
- Speed selector: 1x / 1.5x / 2x
- Download button
- Compact mode (single line) for table rows

---

## File Structure

```
app/
├── layout.tsx              # Global layout (sidebar + topbar + main)
├── page.tsx                # Dashboard
├── dispatch/
│   └── page.tsx            # Dispatch Map (primary page)
├── jobs/
│   └── page.tsx            # Jobs List
├── calls/
│   ├── active/
│   │   └── page.tsx        # Active Calls
│   ├── missed/
│   │   └── page.tsx        # Missed Calls
│   └── log/
│       └── page.tsx        # Call Log
├── sms/
│   └── page.tsx            # SMS Conversations
├── technicians/
│   └── page.tsx            # Technicians List
└── reports/
    ├── commission/
    │   └── page.tsx        # Commission Report
    └── performance/
        └── page.tsx        # Performance Report

components/
├── layout/
│   ├── sidebar.tsx
│   ├── topbar.tsx
│   ├── command-palette.tsx
│   └── bottom-bar.tsx
├── map/
│   ├── dispatch-map.tsx
│   ├── job-pin.tsx
│   ├── tech-marker.tsx
│   └── map-sidebar.tsx
├── shared/
│   ├── data-table.tsx
│   ├── metric-card.tsx
│   ├── status-badge.tsx
│   ├── audio-player.tsx
│   ├── filter-popover.tsx
│   └── empty-state.tsx
└── dialogs/
    ├── assign-job-dialog.tsx
    ├── override-dialog.tsx
    └── call-back-dialog.tsx

lib/
├── mock-data/
│   ├── technicians.ts      # 15 technicians
│   ├── jobs.ts             # 45 jobs
│   ├── calls.ts            # 50 call log entries
│   ├── missed-calls.ts     # 25 missed calls
│   ├── sms.ts              # 10 conversations
│   └── commission.ts       # Commission report data
├── types.ts                # TypeScript interfaces
└── utils.ts                # Formatters, helpers

```

---

## Design Tokens (Tailwind config)

```
Colors:
  - Background: bg-white (content), bg-zinc-950 (sidebar)
  - Text: text-zinc-900 (primary), text-zinc-500 (secondary), text-zinc-400 (muted)
  - Borders: border-zinc-200 (light), border-zinc-800 (dark/sidebar)
  - Accent: blue-500 (primary actions), red-500 (danger/unassigned), green-500 (success/available), yellow-500 (warning/assigned)

Spacing:
  - Page padding: p-6
  - Card padding: p-4
  - Card gap: gap-4
  - Section gap: gap-6

Radius:
  - Cards: rounded-lg
  - Buttons: rounded-md
  - Badges: rounded-full
  - Inputs: rounded-md

Shadows:
  - Cards: shadow-sm
  - Dropdowns: shadow-lg
  - Modals: shadow-2xl
  - Map sidebar: shadow-xl

Typography:
  - Font: Inter (system fallback: -apple-system, sans-serif)
  - H1: text-2xl font-semibold
  - H2: text-lg font-semibold
  - H3: text-sm font-medium uppercase tracking-wider text-zinc-500
  - Body: text-sm
  - Small: text-xs text-zinc-500
  - Monospace (job IDs, phone numbers): font-mono text-sm
```

---

## Important Implementation Notes

1. **All data is mocked** — import from `lib/mock-data/` files. No API calls. Data should be realistic and internally consistent (e.g., assigned jobs reference real technician IDs).

2. **State management** — use React `useState` and `useContext` for global state (selected filters, sidebar open/closed, current user). No external state library needed.

3. **Map component** — for v0, use a colored placeholder div (`bg-zinc-100`) with absolutely positioned pin/marker components. OR use a static map image as background. The pins and markers should be interactive (hover, click).

4. **Animations** — sidebar slides from right (`transform translateX`), toasts slide up, pins fade in/out, technician icons smooth-move. Use CSS transitions or Framer Motion.

5. **Clock-in timer** — show a running timer in the sidebar footer. Use `setInterval` to update every second. Format: "4h 23m 15s".

6. **Active call timers** — each active call card shows a ticking duration. Simulated with `setInterval`.

7. **Auto-refresh simulation** — on the map page, simulate a refresh every 30 seconds by slightly randomizing technician positions (±0.001 lat/lng).

8. **Drag and drop** — for job reordering in technician sidebar, use `@dnd-kit/sortable` or similar. Show visual drag handle (grip dots icon).

9. **Dark mode** — the sidebar is always dark. The content area respects system preference (light/dark). Implement with Tailwind `dark:` classes and a toggle in settings.

10. **Responsive** — sidebar collapses to icon-only mode on screens <1440px. Full collapse below 1280px with hamburger menu.
