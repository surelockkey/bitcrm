# Call tags: the item shapes an importer writes

What the Workiz generator has to emit so that call tags arrive already working —
named in the call log, offered in the picker, and findable through
`GET /calls?tagId=`. Two things go into the **calls table** (`CALLS_TABLE`,
`bitcrm-<env>-calls`): one catalog row per tag, and one extra attribute on the
calls that carry it.

Source of the contract: `packages/types/src/entities/call-tag.entity.ts`,
`src/call-tags/call-tags.constants.ts`, `src/call-tags/call-tags.repository.ts`,
`src/calls/calls.repository.ts`.

---

## 1. The catalog row — `CALLTAG#ALL` / `CALLTAG#<id>`

One partition holds every call tag, exactly as per-number settings use
`NUMSET#ALL`. Listing is a single `Query`, reading one is a `GetItem`, and
**no GSI keys are written**: a catalog row must never surface in the call log,
which shares this table (`GSI1 AgentIndex`, `GSI2 AllCallsIndex`,
`GSI3 PartyIndex`).

```json
{
  "PK": "CALLTAG#ALL",
  "SK": "CALLTAG#4f3b2b54-6d7a-5d0e-9a3b-1c2d3e4f5a6b",

  "id": "4f3b2b54-6d7a-5d0e-9a3b-1c2d3e4f5a6b",
  "name": "SPAM CALLER",
  "color": "blue",
  "priority": 0,
  "active": true,
  "externalId": "workiz:tag:645312",
  "createdBy": "workiz-import",
  "createdAt": "2026-09-20T00:00:00.000Z",
  "updatedAt": "2026-09-20T00:00:00.000Z"
}
```

| Attribute | Type | Rule |
|---|---|---|
| `PK` | S | literal `CALLTAG#ALL` |
| `SK` | S | `CALLTAG#` + `id` |
| `id` | S | `bid('tag', <workiz tag id>)` — the **same** namespace job tags use, so one Workiz tag id is one BitCRM id whatever it labels |
| `name` | S | trimmed, ≤ 60 chars (`CALL_TAG_LIMITS.nameMaxLength`), **unique case-insensitively** — the service returns 409 on a clash, and two identical chips would be unreadable anyway |
| `color` | S | one of `JOB_TAG_COLORS`: `slate red amber green teal blue violet pink`. Anything else is rejected by the API; the reader coerces a stored unknown to `slate` |
| `priority` | N | integer, higher sorts first in the pickers. Workiz has no such field → `0` |
| `active` | BOOL | `false` = archived: leaves every picker, keeps naming the calls that carry it. Workiz has no such field → `true` |
| `externalId` | S | `workiz:tag:<workiz tag id>` (`ext_id('tag', id)`). Absent on tags created in BitCRM |
| `createdBy` | S | `workiz-import` |
| `createdAt`, `updatedAt` | S | ISO-8601 with milliseconds |

`CallTagsRepository.toEntity` is deliberately tolerant, so a minimal row still
lists: `id` falls back to the `SK` suffix, `color` to `slate`, `priority` to `0`,
`active` to `true`, `createdBy` to `import`, the timestamps to `""`. Emit the
full row anyway — the Settings screen shows priority and state.

There is no `entityType` discriminator: a call tag is a `CALLTAG#` row and a job
tag is a `JOB_TAG#` row in the deal service's own table. A Workiz tag with
`type: "1"` goes to job tags, `type: "3"` here; `type: "2"` (client) still has
nowhere to go.

## 2. The tags on a call — `tagIds` on `CALL#<sid>` / `METADATA`

```json
{
  "PK": "CALL#CAb6d499efb62c81336e3dc5bb323d38c2",
  "SK": "METADATA",
  "callSid": "CAb6d499efb62c81336e3dc5bb323d38c2",
  "startedAt": "2026-09-11T11:28:25.000Z",

  "tagIds": [
    "4f3b2b54-6d7a-5d0e-9a3b-1c2d3e4f5a6b",
    "9c81a0d2-7f44-5bb6-8e21-0a5f6d3c7e19"
  ]
}
```

| Rule | Why |
|---|---|
| `tagIds` is a **list of strings** (DynamoDB `L` of `S`), each an `id` from §1 — never a Workiz id, never a name | that is what the chips resolve and what `contains(#tagIds, :tagId)` matches |
| **Omit the attribute entirely** when the call has no tags — never write `[]` | "untagged" has one shape for the filter, the picker and `setTags`' compare-and-set alike |
| At most `CALL_TAG_LIMITS.maxPerCall` = **25** ids, distinct, order preserved | the API rejects a 26th; Workiz's own maximum is 4, so this never bites in practice |
| Nothing else changes: no GSI key, no new item, no `updatedAt` bump needed | tags live on the existing `METADATA` item |
| An id may point at an **archived** tag | the API refuses to *add* one, but historical rows keep theirs and the chip still renders (dimmed) |

`tagIds` is outside the lifecycle `upsert` whitelist in `CallsRepository`, so a
later Twilio webhook for the same call cannot wipe an imported list.

## 3. Reading the Workiz side

**The catalog** is `settings_tags.jsonl`, filtered to `type == "3"`
(`type_name: "call"`) — 28 rows. Fields are only `id, name, color, type,
type_name`: no order, no active flag, no timestamps.

`color` is a hex string and has to be mapped to a palette token (nearest hue;
saturation < 0.2 → `slate`). The 17 hexes that actually occur on call tags:

| hex | token | | hex | token |
|---|---|---|---|---|
| `#0059a0` | blue | | `#be2c2c` | red |
| `#c04d97` | pink | | `#B91C1C` | red |
| `#37d34d` | green | | `#22C55E` | green |
| `#3d1c8b` | violet | | `#3ACF7D` | green |
| `#198218` | green | | `#D574E4` | pink |
| `#edce4c` | amber | | `#E8CF63` | amber |
| `#e18a2b` | amber | | `#FBAB33` | amber |
| `#D58E41` | amber | | `#000ED2` | blue |
| `#3589E9` | blue | | | |

Keep the original hex in an extra attribute (`colorHex`) if the lossy mapping
needs auditing later; nothing in the service reads it.

**The tags on a call** come from `calls.jsonl`, field `tags` — **not** from the
`call_tags` table in `workiz.sqlite`, whose `tag_id` is empty (a conversion
defect). Two shapes occur and both must be handled:

- a list of id strings — `"tags": ["727458"]` (373 377 non-empty; another
  126 908 calls carry an empty list, which is the same as no tags), and
- a comma-separated string — `"tags": "336351,336357"` (22 calls).

Counts over the full 1 816 419-call dump: **373 399 tagged calls (20.6 %)**, at
most **4 tags on any one call**, 65 distinct tag ids referenced.

## 4. The 37 tag ids with no catalog row

Only 28 of those 65 ids exist in `settings_tags` — the rest are tags deleted in
Workiz, and they are not rare: **140 983 references**, led by `645319`
(100 955 — more than any surviving tag), `613123` (25 532) and `613122`
(8 866).

Left alone they render as a raw uuid chip on 100 k+ calls, because the UI falls
back to the id when the catalog cannot name it. Pick one, deliberately:

1. **Recommended — mint an archived placeholder** per unknown id:
   `name: "Workiz tag <workiz id>"`, `color: "slate"`, `active: false`,
   `externalId: "workiz:tag:<workiz id>"`. The calls keep a label that reads as
   retired, the tag never appears in a picker, and if anyone ever recovers the
   real names it is a rename, not a backfill of 140 983 calls.
2. **Drop them** — filter those ids out of `tagIds` while writing the calls.
   Cheaper, and permanent: the information is gone.

Do not emit a `tagIds` entry pointing at a row you did not write.

## 5. What the API enforces, for reference

The importer writes DynamoDB directly and none of this runs on its rows, but
staying inside the same rules keeps the data usable afterwards:

- `POST /call-tags` — 409 on a duplicate name (case-insensitive), 400 on an
  empty name, a name over 60 chars, a color outside the palette, or a
  non-integer priority.
- `DELETE /call-tags/:id` — archives (`active: false`), never deletes. The call
  log is too large to check for references, and a historical call must keep
  resolving its labels.
- `PATCH /calls/:sid/tags { add?, remove? }` — a delta, compare-and-set on the
  stored list; 404 for an unknown call or an unknown tag being added, 400 for an
  archived tag being added or the 25-tag cap.
- `GET /calls?tagId=<id>` — a `contains` FilterExpression inside the
  `CALL#ALL` date-ordered walk, not an index. Fine for a common tag, expensive
  for a rare one over all of time; the web toolbar tells the user to add a date
  range. The walk is bounded per request (`MAX_QUERY_PAGES`), so a page can come
  back short — even empty — while still carrying `nextCursor`, which means
  "nothing more in the stretch read so far", not "no more calls". If tag lookups
  become routine, the upgrade is a sparse `CALLTAG#<id>` GSI maintained by
  `setTags` — not a cheaper filter. **A generator that writes such a GSI today
  would be wrong**: no call-tag row and no `tagIds` write puts any GSI key on
  the item, and the three call indexes (`GSI1 AgentIndex`, `GSI2 AllCallsIndex`,
  `GSI3 PartyIndex`) are the only ones the calls table has.
