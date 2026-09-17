# Event Catalog

All cross-service events flow through SNS topics, consumed via SQS (one queue
per consumer, dispatched by `eventType`). The **canonical contract** lives in
`@bitcrm/types` (`events/`) — `UserEventType` constants + payload interfaces.
Publishers and consumers import these so the wire format can't drift; the
`event-contract.spec.ts` test locks the string values.

## Topic: `user-events` (published by user-service)

| eventType | Payload (`@bitcrm/types`) | Published when | Consumers |
|---|---|---|---|
| `user.activated` | `UserActivatedEvent` | user created / reactivated | — (containers are created manually and technicians assigned to them; no auto-provisioning) |
| `user.role-changed` | `UserRoleChangedEvent` | role assigned | — |
| `user.invite-resent` | `UserInviteResentEvent` | invite re-sent | — (audit) |
| `tech.updated` | `TechUpdatedEvent` `{technicianId, changedFields}` | profile / assignments / commission change | deal (eligibility), reporting |
| `tech.approved` | `TechApprovedEvent` `{technicianId, jobTypeIds, serviceAreaIds}` | technician first becomes assignable | **deal (eligibility projection)** |
| `commission.updated` | `CommissionUpdatedEvent` | commission set | reporting, payment |
| `document.uploaded` / `document.accessed` / `document.deleted` | `DocumentEvent` | sensitive document op | — (compliance/audit) |
| `sensitive.accessed` | `SensitiveAccessedEvent` | SSN/bank read | — (compliance/audit) |

## Topic: `deal-events` (published by deal-service)
`deal.created`, `deal.updated`, `deal.status_changed`, `deal.completed`, `deal.deleted`,
`deal.tech_assigned`, `deal.tech_unassigned`, `deal.product_added`, `deal.product_removed`,
`deal.tech_confirmed`, `deal.tech_arrived`, `deal.sent_to_tech`.

### `deal.sent_to_tech` — Workiz "Send to tech" (typed: `DealSentToTechEvent` in `@bitcrm/types`)

| Field | Meaning |
|---|---|
| `dealId`, `dealNumber?` | the job |
| `techIds` | the technicians to notify — a subset of the roster at click time (omitted `techIds` on the request = everyone assigned) |
| `channels` | `('sms' \| 'email' \| 'in_app')[]` — what the dispatcher ticked |
| `sentAt` | ISO-8601, equals the deal's `sentToTechAt` after the click; **the idempotency key** per (deal, technician, channel) |
| `sentBy` | the dispatcher |

Published by `POST /api/deals/:id/send-to-tech` (`deals.edit`) **after** the deal is stamped
(`sentToTechAt` / `sentToTechVia` / `sentToTechBy` = Workiz `last_sent` / `sent`, plus `sentAt` /
`sentVia` / `sentBy` on each `ASSIGN#<techId>` row) and the `sent_to_tech` timeline entry is written —
the click is the "sent" moment, as in Workiz; delivery is asynchronous. One event per click, however
many technicians / channels; pressing again is a resend with a new `sentAt`.

Write order inside that request is load-bearing: **`ASSIGN#` rows → deal stamp → timeline entry →
event**. A job must never carry a "Sent" stamp for a click that published no event — that would read
`Sent · 12:10 PM` forever for a message nothing was asked to deliver. A roster technician whose
`ASSIGN#` row is missing is skipped with a warning instead of failing the send (see the import rule
below); anything else (a throttled table) aborts before the deal is stamped, so a retry is clean.

Consumed by **messaging** (queue `deal-events-to-messaging`, `SendToTechService`): renders the settings
`smsFormat` "New job" text for the job + technician and delivers it per channel — `sms` to the
technician's personal phone in their team thread, `in_app` as a line in that thread, `email` to their
user email (skipped with `email_not_configured` until `MESSAGING_EMAIL_FROM` is set). Idempotent per
(deal, technician, channel, `sentAt`) through the `CLIENTMSG#` key
`send-to-tech:<dealId>:<techId>:<channel>:<sentAt>` plus an `AUTOSENT#` marker (`ruleId`
`send-to-tech:<channel>`). Not held by quiet hours (a dispatcher's explicit action). Each
(technician, channel) outcome is reported back with `PUT /api/deals/internal/:id/sent-to-tech`
`{techId, channel, status: sent|skipped|failed, sentAt, reason?, messageId?, conversationId?, at?}`
→ `deliveries.<channel>` on the `ASSIGN#` row (a report about an older `sentAt` than the row's is
ignored). Chosen over letting messaging write the deals table: repositories stay per-service.

**Seen** (Workiz `seen` / "Viewed job in app"): `POST /api/deals/:id/seen` (`deals.view`) is called by
the technician's app on open; only an assigned technician counts — first open stamps `seenAt` on their
`ASSIGN#` row, `seenByTechAt` on the deal (sticky; a re-send does not clear it) and a `seen_by_tech`
timeline entry; later opens and non-roster callers answer `seen: false` / unchanged. No event.

**Assignment-row contract (Workiz import / any backfill).** Everything above hangs off the `ASSIGN#`
rows, so whatever writes a job's roster must write them the way `addAssignment` does — this is the
rule the generator follows, stated against the code that reads them:

| Attribute | Value | Why |
|---|---|---|
| `PK` / `SK` | `DEAL#<dealId>` / `ASSIGN#<techId>` | one row per (job, technician); `deal.assignedTechIds` on `METADATA` must list exactly these `techId`s |
| `GSI2PK` | `TECH#<techId>` | the tech index — a row without it is invisible to `findByTech` and to the dispatch board |
| `GSI2SK` | `<scheduledDate or now ISO>#DEAL#<dealId>` | orders a technician's day |
| `dealId`, `techId`, `scheduledDate` | as on the deal | read back by `listAssignments` / `getAssignment` |
| `assignedBy`, `assignedAt` | importer actor / import time | never rewritten afterwards |

`sentAt` / `sentVia` / `sentBy` / `seenAt` / `deliveries` / `techConfirmedAt` are runtime-only: the
import leaves them absent (an imported Workiz `sent` / `seen` timestamp belongs on the deal's
`sentToTechAt` / `seenByTechAt`, and may be copied to the row's `sentAt` / `seenAt`, but never invents
`deliveries`). A reschedule re-stamps only the index keys, the date and `restampedBy` / `restampedAt`,
so none of these is erased by moving the job.
A roster entry with no `ASSIGN#` row costs that technician their per-channel line on the job page and
their place on the tech index; it no longer breaks the send itself, and a reschedule rewrites `GSI2PK`
so a row that lost it heals on the next date change.

`deal.updated` (`{dealId, updatedBy?}`) fires on any field edit (update, client
reassignment, payment status) so the search index stays fresh; `deal.deleted`
(`{dealId, deletedBy}`) fires on soft delete so the doc leaves the index.

Custom-field catalog: `custom-field.created` / `.updated` / `.archived` / `.deleted`
(`{customFieldId, …}`) — emitted by `CustomFieldsService`. The `searchable` toggle
lives on the definition, so the search indexer invalidates its cached defs and
rebuilds all deal docs on any of these.

`deal.scheduled_changed` is **typed** in `@bitcrm/types` but not published yet:
`DealsService.update` emits only `deal.updated` for a date move. Until it does,
messaging derives the reschedule itself (`DEALSNAP#<dealId>` snapshot, compared
on every job event) and raises the same event internally, so an automation rule
on a reschedule works either way and needs no change the day the real event
lands.

A deal carries **many** technicians (`assignedTechIds`), so `deal.tech_assigned` /
`deal.tech_unassigned` (`{dealId, techId, assignedBy | unassignedBy}`) fire **once per technician** added or
removed by a roster change. Consumed by **messaging** (`deal.tech_assigned` + `deal.updated`, queue
`deal-events-to-messaging`) for the "New job" SMS to technicians. Assignment itself is stored as adjacency rows
(`PK=DEAL#<id>, SK=ASSIGN#<techId>`) indexed on the tech GSI, which is what
`findByTech` — and therefore the `assigned_only` data scope — reads.

**Deliberately unconsumed today:** `deal.tech_confirmed` (`{dealId, techId, confirmedAt}`) and
`deal.tech_arrived` (`{dealId, techId, arrivedAt}`) — the technician flow's "Confirmed job receipt"
and "Arrived at location". They are published for future consumers (an ETA/arrival notification to
the client, dispatch alerting) and for the audit trail; what the office actually reads today is the
`tech_confirmed` / `tech_arrived` **timeline entry** on the job, not the event. Neither is in the
search document (`search-mappers.ts` carries `superStatus` only), so nothing reindexes on them.
Because `deal-events` fans out with no SNS FilterPolicy, both still land on the messaging and search
queues, where the shared consumer logs `No handler for event type "…", deleting message` at WARN and
deletes them — no retry, no DLQ growth, just noise at the volume of the flow (~30k arrivals in the
Workiz export). Register a handler (or a filter policy) before treating that log line as a fault.

A deal line item (`SK=PRODUCT#<productId>`) carries a `fulfillment` of `sourced`
(pulled from an assigned tech's container — deducts stock), `to_order` (a part the
tech doesn't carry — no stock movement, toggleable to ordered via
`PATCH /deals/:id/products/:productId/ordered`), or `service` (a non-stockable service
line — no stock, no source tech). `deal.product_added` carries
`{dealId, productId, quantity, fulfillment}`. Only `sourced` lines call inventory's
internal deduct/restore. Service-type inventory products may only be added as `service`
lines; inventory rejects them from all stock operations (receive/transfer/deduct).

Service-area catalog: `service-area.created`, `service-area.updated`, `service-area.deleted`
(`{serviceAreaId, name}`) — emitted by `ServiceAreasService` on catalog CRUD.

Job-type catalog: `job-type.created`, `job-type.updated`, `job-type.archived`,
`job-type.deleted` (`{jobTypeId, name}`) — emitted by `JobTypesService`. Deals and
technicians store catalog *ids*, so the search indexer resolves names through
`CatalogNamesService` and invalidates that cache on these events.

Job-source catalog: `job-source.created` / `.updated` / `.archived` / `.deleted`
(`{jobSourceId, name}`) — emitted by `JobSourcesService`. Deals store a `sourceId`;
not indexed in search.

Job-tag catalog: `job-tag.created` / `.updated` / `.archived` / `.deleted`
(`{jobTagId, name}`) — emitted by `JobTagsService`. Deals store `tagIds` (many);
the search indexer resolves them to names via `CatalogNamesService` and
invalidates that cache on these events.

## Topic: `contact-events` / `crm` (published by crm-service)
`contact.created`, `contact.updated`, `company.created`, `company.updated`, `contact.merged`.
`contact.merged` (`{oldContactId, newContactId}`) is emitted once per absorbed duplicate by
`ContactsService.merge`; deal-service re-points the old contact's active deals to the survivor.

## Topic: `call-events` (published by telephony-service)

Contracts in `@bitcrm/types` (`events/call-events.ts`). Emitted fire-and-forget
by `CallsService.applyLifecycle` (the single call-record writer), gated on
`CALL_EVENTS_TOPIC_ARN`.

| eventType | Payload (`@bitcrm/types`) | Published when | Consumers |
|---|---|---|---|
| `call.started` | `CallStartedEvent` `{callSid, direction, from, to, agentId, answeredAt}` | both parties connected (first `answeredAt`) | — (reporting/CRM activity, future) |
| `call.completed` | `CallCompletedEvent` `{callSid, …, status, durationSeconds, startedAt, endedAt}` | first terminal status (completed/busy/no-answer/failed/canceled) | **messaging** (queue `call-events-to-messaging`) — the automation rules that text a missed caller back |
| `call.recording_ready` | `CallRecordingReadyEvent` `{callSid, recordingSid, recordingDurationSeconds}` | conference recording processed | — |
| `call.updated` | `CallUpdatedEvent` `{callSid, tagIds, actorId, updatedAt}` | a person adds or removes call tags (`PATCH /calls/:sid/tags`, `CallsService.updateTags`) — never on lifecycle changes | — (reporting on SPAM/Tech Call volumes, future) |

Live-UI updates deliberately do **not** go through SNS: the calls page streams
them over SSE (`GET /api/telephony/calls/stream`), fed by Redis pub/sub
(`telephony:call-events`) so every service instance sees every webhook.

## Topic: `message-events` (published by messaging-service)

Contracts in `@bitcrm/types` (`events/message-events.ts`). Emitted
fire-and-forget by messaging-service, gated on `MESSAGE_EVENTS_TOPIC_ARN`.
Not yet emitted by code: the repositories exist (M5) and the webhook /
outbound worker (M7, M9) are the publishers.

| eventType | Payload (`@bitcrm/types`) | Published when | Consumers |
|---|---|---|---|
| `message.received` | `MessageReceivedEvent` `{messageId, conversationId, channel, from, to, partyKind, partyId?, dealId?, providerSid?, createdAt}` | an inbound message was stored (webhook transaction committed); also a team / group `in_app` line for its members (`partyKind` `user` / `group`, M16) | **search** (rebuilds the `conversation` document); automations, reporting — future. The technician app's push is **not** a consumer of this event: `SendService` hands the stored line straight to `PushNotifierService` in-process (`src/push`), so a push carries the same recipient list as the SSE fan-out and needs no topic |
| `message.sent` | `MessageSentEvent` `{messageId, conversationId, channel, to, businessNumber?, sentByUserId?, automationRuleId?, dealId?, providerSid}` | the provider accepted an outbound message | **search** (`conversation` document) |
| `message.status_changed` | `MessageStatusChangedEvent` `{messageId, conversationId, status, errorCode?}` | an outbound message reached a terminal status (delivered / undelivered / failed / canceled) | **search** (`conversation` document) |
| `conversation.updated` | `ConversationUpdatedEvent` `{conversationId}` | any change to a conversation (new message, archive, flag, read, party change) | **search** (`conversation` document, M15) |
| `opt_out.changed` | `OptOutChangedEvent` `{channel, address, status, source}` | STOP/START keyword, Twilio 21610, SES bounce/complaint, manual edit | — |

Messages are **not** copied into the deal timeline (`TIMELINE#`); the job's
"Messages" tab reads `GET /api/messaging/messages/by-job/:dealId` instead.

Live-UI updates (new message, counters, opt-out banner) go over SSE
(`GET /api/messaging/stream`, M12) fed by Redis pub/sub (`messaging:events`),
same pattern as telephony. Team chat (M16) adds `team_counters.invalidated`
on the bus (`{conversationId, memberIds}` — never written to a browser) and
`team_counters.changed` on the stream (one member's own badge, recounted from
their `READ#` markers); a team / group `message.upserted` carries `recipients`
and `mentions`.

## Consumers (SQS, gated on `*_QUEUE_URL` + `ENABLE_SQS_CONSUMER=true`)
- **messaging-service** ← `contact.merged`, `contact.updated` (queue `contact-events-to-messaging`) → `ContactEventsHandler` (`src/contact-events/`): a merge hands the duplicate's thread to the survivor (`CONVOF#`, `partyId`, `ADDR#` rows; when both had a thread the survivor absorbs the addresses and the duplicate's thread is archived — messages are not moved between partitions), an update re-reads the contact from CRM and reconciles `ADDR#` rows + `conversation.addresses`. Also ← **every** deal event (queue `deal-events-to-messaging`, subscribed to the whole topic) → `AutomationDealEventsHandler` (`src/automations/engine/`), which fans each one out to `NewJobSmsService` (the settings `smsFormat` "New job" SMS to the assigned technician's personal phone, once per (job, technician, scheduledDate) via an `AUTOSENT#` marker — `deal.updated` carries no changed fields, so the job is re-read and only a changed `scheduledDate` re-sends) and then to the **rule engine** (`AutomationRuleEngine`): every enabled rule with a runnable `spec` is evaluated against the job, and what fires is claimed once (`AUTORUN#<ruleId>` / `ONCE#<entity>#<occurrence>`), acted on and logged (`RUN#<firedAt>#<id>`). Anything that has to wait — a rule's own delay, a send held by quiet hours, a "1 hour before the job" reminder — is written to `SCHEDULE#<YYYY-MM-DDTHH:MM>` and run by a minute poller (`ENABLE_AUTOMATION_SCHEDULER=true`, one instance; `AUTOMATION_SCHEDULER_INTERVAL_MS`, default 60 s, catching up at most 3 h after a restart). A minute bucket rather than SQS delay hops: a one-day delay is far past SQS's 15-minute maximum, and what is pending stays listable. Also ← `call.completed` (queue `call-events-to-messaging`) → the same engine. Also its own work queues: `messaging-outbound.fifo` (M9), `messaging-media` (M10), the SES-fed `messaging-email-events` / `messaging-inbound-email` (M17–M18; raw SES JSON, read by the service's own poller rather than the shared consumer). Handlers must be idempotent — the consumer does not deduplicate.
- **inventory-service** consumes nothing (container auto-provisioning was removed — containers are created via `POST /containers` and technicians assigned via `PUT /containers/:id`)
- **deal-service** ← `payment.received`, `contact.merged`, **`tech.approved`, `tech.updated`** → `DealsEventHandler`, `TechnicianEligibilityEventHandler`
- **search-service** ← **all topics** (`deal-events`, `contact-events`, `user-events`, `inventory-events`, `message-events`) via the single `search-index` queue → `IndexerEventHandler` (routes in `services/search/src/indexer/event-routes.ts`). Upsert events trigger a re-fetch of the authoritative entity (internal HTTP) + reindex into OpenSearch; delete events remove the doc. The backfill (internal list endpoints) is the authoritative populator; events keep it fresh. The `conversation` document (M15) is rebuilt from `conversation.updated` and every `message.*` event that names a conversation: the indexer reads `GET /api/messaging/conversations/internal/:id` plus `…/internal/:id/messages?limit=` (last N bodies → `body`), the party from crm / user-service (name → `title`, numbers and emails → `keywords`) and the referenced deals (number → `keywords`, roster → `ownerIds` for `assigned_only`). A contact / company / user edit and a deal roster change also rebuild the conversations that reference them.

## Topic: `inventory-events` (published by inventory-service)
`product.created` / `product.updated` (archive/reactivate emit `product.updated`),
`warehouse.created` / `warehouse.updated` (archive emits `warehouse.updated`),
`container.created` / `container.updated`, `transfer.created`,
`item-category.created/updated/archived/deleted`, `brand.created/updated/deleted`
(settings catalogs; not consumed anywhere yet). Payloads carry the entity id
(`{productId}` / `{warehouseId}` / `{containerId}` / `{transferId}`). Published
fire-and-forget via `publishInventoryEvent` (never fails the write). Consumed by
the search indexer (`search-index` queue). Internal stock deduct/restore transfers
are not emitted individually — the search backfill reconciles them.

## Eligibility projection (deal-service)
`tech.approved` / `tech.updated` (the latter only when `changedFields` includes
`assignments`) build a `TECH_ELIGIBILITY#<id>` read-model in `BitCRM_Deals`
(`TechnicianEligibilityRepository`). Existing approved technicians are backfilled on
boot via `GET /api/users/internal/technicians/assignable`
(`TechnicianEligibilityBackfill`, idempotent, upsert-only).

This projection is what `GET /deals/:id/qualified-techs` reads. It carries the
technician's approved **catalog ids** plus their name/department/home coordinates,
so assignment needs no synchronous call into user-service. Matching by id is what
made the qualified list work: it previously compared a deal's `lock_change` slug
against a technician's hand-typed "Lock Change" and so was always empty.

## Infra
SNS topics + SQS queues + SNS→SQS subscriptions are provisioned by Terraform
(`infra/modules/sns-sqs`, wired in `infra/dev/data_plane.tf`). The `user-events`
topic fans out to `user-events-to-inventory` and `user-events-to-deal` queues.
Local dev provisions topics/queues via each service's `src/scripts/setup-aws.ts`.
DLQ `maxReceiveCount = 5` (Terraform and setup scripts aligned).
