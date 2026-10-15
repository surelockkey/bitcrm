# BitCRM Backend

Locksmith business-management platform. Eight NestJS 11 microservices behind an
nginx gateway, DynamoDB single-table storage, SNS/SQS events, an OpenSearch
read model, Cognito auth. This file is the map; `EVENTS.md` is the event
contract and `monitoring/README.md` the observability detail.

---

## 1. Layout

```
backend/
  services/{user,crm,deal,inventory,search,telephony,messaging,billing}/   one NestJS app each
  packages/shared/            @bitcrm/shared — every cross-cutting concern
  gateway/nginx.conf          :4000 → the eight services
  infra/                      Terraform (bootstrap, dev, modules/*)
  monitoring/                 prometheus, grafana, tempo, loki, promtail, blackbox
  scripts/                    test.sh, setup-aws.sh, verify-monitoring.mjs, render-taskdef.sh
  docker-compose.yml          dynamodb, redis, opensearch, localstack, gateway, monitoring profile
  Dockerfile                  one multi-stage build, parameterised by --build-arg SERVICE
  EVENTS.md                   the event catalog — keep it current
../packages/types/            @bitcrm/types — shared with the frontend, lives at the REPO ROOT
```

npm workspaces are declared at the repo root, not here: `apps/*`, `packages/*`,
`backend`, `backend/services/*`, `backend/packages/*`. Turbo (`turbo.json`)
orchestrates build/dev/lint inside `backend/`. `@bitcrm/types` sits *outside*
the backend turbo workspace, so it must be built before anything that imports
it (the Dockerfile does this explicitly).

Everything loads env from a single `backend/.env` — each `main.ts` starts with
`config({ path: resolve(__dirname, '../../../.env') })`. `.env.example` is the
documented surface; keep it in sync when you add a variable.

### Services

| Service   | Port | Prefix           | Owns |
| --------- | ---- | ---------------- | ---- |
| user      | 4001 | `api/users`      | users, roles/permissions, technicians (assignments, commission, documents, calendar, location) |
| crm       | 4002 | `api/crm`        | contacts, companies, company documents, work orders |
| deal      | 4003 | `api/deals`      | deals/jobs, line items, timeline, attachments + the catalogs (job types/sources/tags/statuses, service areas — each with its own sales `tax` and default company —, custom fields, external companies), the read-only tax rates derived from the areas, the technician-eligibility projection, and the commissions report (`reports/commissions`, read-only) |
| inventory | 4004 | `api/inventory`  | products, brands, item categories, warehouses, containers, stock, transfers |
| search    | 4005 | `api/search`     | global search — OpenSearch read model + indexer (CQRS) |
| telephony | 4006 | `api/telephony`  | Twilio softphone: tokens, TwiML, call records, presence, call groups/flows, numbers, job dial-in codes, blocked callers |
| messaging | 4007 | `api/messaging`  | client inbox + team chat (Workiz Inbox model): conversations, messages (SMS/MMS, email, in-app), templates, opt-outs, settings — Twilio Messages API traffic; telephony stays the owner of the numbers |
| billing   | 4008 | `api/billing`    | job invoices + estimates (Workiz model), **the payment ledger + Stripe** (offline payments, portal card/ACH, refunds, webhook), document templates + headless-Chromium PDF rendering (`@bitcrm/document-renderer`), companies (many business profiles, one default — jobs pick one), template images, client-portal API (`/public/portal/:token`, `@Public` + Redis rate limit; the pages are `apps/portal`, see §10), the client's confirm-your-appointment page API (`/public/confirm/:token`, B12) |

---

## 2. Running locally

```bash
npm install                # from the REPO ROOT (workspaces)
npm run docker:up          # dynamodb :8000, redis :6379, opensearch :9200, localstack :4566, gateway :4000
npm run setup:aws          # per-service DynamoDB tables + SNS topics/SQS queues in LocalStack
npm run dev                # all eight services via turbo
npm run dev:deal           # or one (dev:user, dev:crm, dev:inventory, dev:search, dev:telephony, dev:messaging, dev:billing)

npm run docker:monitoring  # + prometheus/grafana/tempo/loki/exporters (Grafana :3001, admin/admin)
npm run check:monitoring   # fails if a service exists that nothing scrapes or probes
```

Everything the browser calls goes through the gateway at `http://localhost:4000`.
Scalar API docs per service at `/<prefix>/docs`, OpenAPI JSON at
`/<prefix>/openapi`, unified index at `/api/docs`.

**Redis gotcha:** the services connect to `127.0.0.1:6379`. On a machine with a
native Redis installed, that is the *native* one, not compose's `redis-local`
(which binds the wildcard address). Inspect with `redis-cli -h 127.0.0.1`, and
read `bitcrm_dependency_up{kind="redis"}` rather than the Redis dashboard,
which watches the container.

---

## 3. Request path

```
browser → nginx :4000 → service :400x
          ↓
  CognitoAuthGuard   verifies the Cognito **id** token (tokenUse: 'id'), rejects
                     deactivated users, populates req.user = {id, cognitoSub,
                     email, roleId, department} from custom: claims
          ↓
  PermissionGuard    reads @RequirePermission(resource, action); resolves the
                     user's permissions from Redis (`PERMISSION_CACHE_TTL_SECONDS`,
                     default 600 s — every permission change deletes the key
                     explicitly, so the TTL is only a safety net) or, on a miss,
                     from user-service's internal API; stores them on
                     req.resolvedPermissions; Super Admin bypasses
          ↓
  controller         thin: validate → delegate → wrap
          ↓
  service            business rules, cross-service calls, event publishing
          ↓
  repository         the only place that talks to DynamoDB
```

Both guards are registered globally by `AuthModule` (`@Global`, two `APP_GUARD`
providers), so importing `AuthModule` in `app.module.ts` protects everything.
Opt out per-route with `@Public()`.

Response envelope, uniformly: `{ success: true, data, pagination? }` and, from
`HttpExceptionFilter`, `{ success: false, error: { code, message } }`.

nginx is deliberately tuned (`max_fails=0`, long-lived keepalive,
`proxy_next_upstream ... non_idempotent`, and a `@upstream_down` block that adds
CORS headers to nginx's *own* 502/504 so a down service doesn't masquerade as a
CORS error). Don't "simplify" those without reading the comments in
`gateway/nginx.conf`.

### Auth model

- **Permissions** — `RESOURCE_REGISTRY` in `@bitcrm/types` is the single source
  of truth for resources and their actions. Adding a resource there gives every
  existing role `false` for it (deny-by-default). Default roles live in
  `services/user/src/roles/constants/default-roles.ts`.
- **Resolved permissions** — role matrix merged with sparse per-user overrides,
  cached in Redis by user-service, read by every service via
  `PermissionCacheReader` / `fetchResolvedPermissions`.
- **Data scope** — `all` | `department` | `assigned_only`, per resource.
  Controllers pull it off `@ResolvedPerms()` and pass it down; services enforce
  it (e.g. deal's list forces `techId = caller.id` under `assigned_only`).
  `getDataScopeFilter()` in shared is the canonical interpretation; search
  reimplements it as an OpenSearch filter in `search/authz/`.
- **Stage transitions** — `dealStageTransitions` (`'from->to'`, `'*->x'`) gate
  deal status moves; `canTransitionStage()` in shared.
- **Service-to-service** — `@Internal()` (= `@Public()` + `InternalGuard`)
  marks endpoints authenticated by the `x-internal-secret` header
  (`INTERNAL_SERVICE_SECRET`). Callers use an `InternalHttpService` with that
  header preset. Internal routes live at `/<resource>/internal[/...]` and are
  what the deal service, and the search backfill, read.

---

## 4. Service anatomy

A service is `src/main.ts` + `src/app.module.ts` + one folder per domain module.

`main.ts`, in this order — the order matters:

```ts
config({ path: resolve(__dirname, '../../../.env') });   // env first
initTracing('deal-service');                             // before Nest imports run
// ... NestFactory.create(AppModule, { bufferLogs: true })
app.useLogger(app.get(Logger));      // nestjs-pino
app.setGlobalPrefix('api/deals');
app.enableCors();
app.useGlobalFilters(new HttpExceptionFilter());
// Scalar docs at /api/deals/docs, OpenAPI at /api/deals/openapi
installGracefulShutdown(app);        // bounded SIGTERM/SIGINT close
runBootstrap(bootstrap);             // a failed bootstrap exits the process
```

`app.module.ts` composes the platform modules from `@bitcrm/shared`:
`LoggerModule.forRoot`, `MetricsModule.forRoot`, `HealthModule.forRoot`,
`ConnectivityModule.forRoot`, `DynamoDbModule`, `RedisModule`, `AuthModule`,
`StorageModule`, `EventsModule.forRoot`, then the domain modules. SQS handlers
are registered in `onModuleInit` and polling starts only when
`ENABLE_SQS_CONSUMER=true`.

A domain module is four files plus DTOs — `job-tags/` in deal-service is the
reference implementation:

```
job-tags/
  job-tags.module.ts       controllers + providers, exports the service
  job-tags.controller.ts   routes, @RequirePermission, @ApiOperation, envelope
  job-tags.service.ts      rules, id generation, SNS publish, business metrics
  job-tags.repository.ts   DynamoDB only — key shapes documented in a doc comment
  job-tags.constants.ts    PK/SK/GSI prefixes
  dto/create-*.dto.ts      class-validator + @ApiProperty
```

Conventions that hold across the codebase:

- Controllers return `{ success: true, data }`; they never touch DynamoDB.
- Repositories are the only DynamoDB callers, and each carries a doc comment
  spelling out its PK/SK/GSI layout. Copy that habit.
- Cross-service dependencies (`SnsPublisherService`, `BusinessMetricsService`)
  are injected `@Optional()` so unit tests can construct a service with `new`.
- Every `@ApiOperation.description` starts with `**Guard:** \`resource.action\``.
  Keep that — it is how the docs communicate authorization.
- **Route order matters.** Under a shared prefix, a collection route
  (`GET /job-types`) is shadowed by an earlier `GET /:id`. Catalog modules are
  imported *before* `DealsModule`, and `DealAttachmentsController` before
  `DealsController`, for exactly this reason.

---

## 5. Database — DynamoDB, single-table per service

Composite `PK`/`SK`, GSIs named `GSI<n>PK` / `GSI<n>SK` projecting `ALL`, given
display names per table.

| Table | Env | GSI1 | GSI2 | GSI3 | GSI4 |
| --- | --- | --- | --- | --- | --- |
| `BitCRM_Users` (also roles + technician profiles) | `USERS_TABLE` | RoleIndex | DepartmentIndex | TechnicianIndex | SkillStatusIndex |
| `BitCRM_Contacts` | `CONTACTS_TABLE` | CompanyIndex | ContactListIndex (sparse) | | |
| `BitCRM_Companies` (also work orders) | `COMPANIES_TABLE` | ClientTypeIndex | | | |
| `BitCRM_Deals` (deals, line items, timeline, catalogs, eligibility) | `DEALS_TABLE` | StageIndex | TechIndex | ContactIndex | DispatcherIndex (… GSI11 NeedsInvoiceIndex, sparse) |
| `BitCRM_Inventory` | `INVENTORY_TABLE` | CategoryIndex | TypeIndex | OwnerIndex | TransferEntityIndex |
| `BitCRM_Calls` (also job dial-in codes) | `CALLS_TABLE` | AgentIndex | AllCallsIndex | PartyIndex | |
| `BitCRM_CallGroups`, `BitCRM_CallFlows` | `CALL_GROUPS_TABLE`, `CALL_FLOWS_TABLE` | — | | | |
| `BitCRM_Messaging` (conversations, messages, pointers, opt-outs, templates, settings, counters) | `MESSAGING_TABLE` | InboxIndex | UnreadIndex | CategoryIndex | JobIndex (+ GSI5 FlagIndex, GSI6 AccountCategoryIndex; TTL on `expiresAt`) |
| `BitCRM_Billing` (invoices, estimates + lines, **payments + refunds + Stripe pointers**, templates, companies (business profiles), assets, portal tokens, per-job counters; TTL on `expiresAt` for webhook dedupe rows) | `BILLING_TABLE` | ListIndex | ContactIndex | DealIndex | UnpaidIndex (sparse) |

Item shapes are prefix-encoded, e.g.

```
USER#<id>          / METADATA        GSI1 ROLE_USER#<roleId>, GSI2 DEPT#<dept>
PHONE#<e164>       / USER            phone → user index item (not a GSI)
DEAL#<id>          / METADATA        GSI1 STATUS#<s> / <createdAt>#…, GSI5 STATUS#<s> / <visit day>#<slot>#…, sparse GSI6
                                     CLOSED#<YYYY-MM> / <closedAt>#…, GSI7 END#<YYYY-MM> / <visit end, Eastern clock>#… —
                                     the Jobs report's three "By:" dates. GSI7 (EndIndex) is written on create and on
                                     every scheduling update; rows older than it (every Workiz import) need
                                     `npm run backfill:end-index -w backend/services/deal -- --apply`, or "By: Job end
                                     date" does not list them. The jobs list's Search box (`GET /deals?q=`) matches
                                     `contains()` on four folded attributes of this row (`deals/deal-search.ts`, never
                                     read back into `Deal`): `searchText` / `searchDigits` (the job's own fields, written
                                     by the repository on create and on every update of an input) and
                                     `clientSearchText` / `clientSearchDigits` (crm's contact: on create, client change,
                                     merge and `contact.updated`); the job type is matched via the catalog at query
                                     time. Rows older than them need `backfill:deal-search` (see §10)
DEAL#<id>          / ASSIGN#<techId> assignment adjacency, on TechIndex — what findByTech reads
DEAL#<id>          / PRODUCT#<id>    line item; fulfillment: sourced | to_order | service
DEAL#<id>          / ATTACH#<id>     a job's file; sparse GSI10 ContactActivityIndex CONTACTFILE#<contactId> / <uploadedAt>#<id>
CONTACT#<id>       / ATTACH#<id>     the client's own file (client card "Upload file", `contacts/<id>/attachments/<id>` in S3),
                                     same GSI10 key — `GET /deals/attachments/by-contact/:id` lists both kinds newest first;
                                     a row with `dealId` downloads through its job, one without through `/deals/contacts/…`
JOB_TAG#<id>       / METADATA        GSI1 CATALOG#JOB_TAG, GSI1SK <priority>#<name>
JOB_TYPE#<id>      / METADATA        GSI1 CATALOG#JOB_TYPE; `durationMinutes` — Workiz's Duration (days/hours/minutes), what New
                                     Job / the job page add to the start when the type is picked; absent or 0 = an hour. The
                                     importer writes it; rows loaded before it get it from the parser's
                                     `bitcrm-patch-job-type-duration` (dry run first)
CONFIG#JOB_FIELDS  / METADATA        Settings → Field Validation: `requiredFields` (ids of `JOB_REQUIRABLE_FIELDS`); gates POST /deals only
CONFIG#JOB_RULES   / METADATA        the account's job rules (Workiz Account → Preferences): `updateJobEndTimeOnClose` (default true) —
                                     see §10 "A closed job ends when it was closed"
TECH_ELIGIBILITY#<id> / …            read model rebuilt from user-events
CALL#<sid>         / METADATA        GSI2 CALL#ALL for the global time-ordered log; optional `tagIds` (call tags);
                                     `partyNames` — both sides' names folded, what the log's Search box (`GET
                                     /calls?q=`) matches (`calls/call-search.ts`, never returned); stamped by the read
                                     path when it differs, older rows by `npm run backfill:call-party-names -w
                                     backend/services/telephony` (dry run without `--apply`)
CALLTAG#ALL        / CALLTAG#<id>    call-tag catalog — one partition, no GSI keys (never in the log); archive, don't delete
BLOCKED#ALL        / <E.164>         a blocked caller (Workiz Phone → Blocked callers): { id, number, comment?, createdBy,
                                     createdAt, externalId? } — one partition, no GSI keys, the shape the Workiz import
                                     writes. Read (cached 15 s) by the inbound voice webhook, which answers `<Reject/>` and
                                     logs the call with status `blocked`, and by messaging over
                                     `GET /blocked-callers/internal/numbers` (cached 60 s, fail-open), which drops the text.
                                     `calls.block` gates the list / block / unblock routes. Unblock deletes the row
EXT#<code> / EXTOF#<dealId>          job dial-in codes (both directions, for idempotent minting)
DEAL#<id> / PRODUCT#<lineId> (lines) sparse GSI7 DONELINES#<YYYY-MM> / <day>#DEAL#<id>#<lineKey> while the job is live
                                     and Done (day = scheduledDate, else createdAt) — the items report's lines without a
                                     Query per job; repository-kept on line adds and on status/schedule changes;
                                     DONELINESINDEX / STATE gates it (backfill:done-lines-index)
CALDAY#<YYYY-MM> / <startDate>#TECH#<techId>#<eventId>   users table: a copy of a calendar event per month it
                                     touches (no GSI keys), written in the event's TransactWrite; CALMONTHINDEX / STATE
ADMINAUDIT#<YYYY-MM> | ADMINAUDIT#<USER|ROLE>#<id> | ADMINAUDIT#ACTOR#<userId> / <at>#<id>   users table: the
                                     admin trail — one entry (`AdminAuditEntry`: who, what, to whom, field changes, traceId)
                                     written to all three partitions in one TransactWrite after the action succeeded
                                     (`audit/`); read by `GET /users/audit` (`users.edit`). No GSI keys. Not `AUDIT#<id>`:
                                     that is the technician documents' access log
USER#<id> / METADATA (users)        … GSI3 USERS#ALL / USER#<id> (TechnicianIndex) — every user, for the directory
                                     and roster without a Scan; USERSALLINDEX / STATE gates it
CONTACT#<id> / METADATA (contacts)  sparse GSI2 CONTACTS#ACTIVE / <name lowercased>#<id> — the client list A→Z;
                                     CONTACTLISTINDEX / STATE gates it (backfill:contact-list-index)
TECHSCOPE / USER#<userId> (messaging) a technician's job-derived parties {deals, contactIds, computedAt} — the
                                     assigned_only inbox without a by-tech call + per-contact reads; TECHSCOPEINDEX / STATE
DEALCALLS#<dealId> / CALL#<sid>      a job's linked calls (no GSI keys) — how a deal event finds the calls whose
                                     `dealTotal` to restamp; put/removed whenever a call's job link changes
CALLCOUNT / MONTH#<YYYY-MM>          { count } calls per UTC month of startedAt, ADDed on a call's first log write;
                                     CALLCOUNT / STATE { readyAt } (stamped by `recount:calls`) = trust them
DEAL#<id> / METADATA (deals)        … sparse GSI11 NEEDS_INVOICE / <createdAt>#DEAL#<id> while status=active,
                                     itemCount>0 and no invoiceId — set/cleared by the repository on every write;
                                     NEEDSINVOICEINDEX / STATE { readyAt, count } (stamped by the backfill) gates it
DEAL#<id> / TIMELINE#<ts>#<id>, <owner> / ACT#<ts>#<id>   job events / job-less imported Workiz events; sparse GSI8
                                     ActivityDayIndex ACTDAY#<New York day> and GSI9 ActorIndex ACTOR#<actorId>, both
                                     SK <ts>#<id>, + `activitySearch` — Reports → Activity (`GET /deals/activity`).
                                     ACTCOUNT#<day> / COUNT { count } — events per day, the report's "of N".
                                     A job's event also carries sparse GSI10 ContactActivityIndex CONTACT#<contactId> /
                                     <ts>#<id> (+ `contactId`) — the client card's History across all of the client's jobs
                                     (`GET /deals/timeline/by-contact/:id`, which folds the import's CLIENT#<id> / ACT# rows
                                     in by time). Rows older than the index need `npm run backfill:contact-index -w
                                     backend/services/deal` (idempotent, conditional; `--dry-run` counts)
INVLOG#<YYYY-MM>   / <createdAt>#<id> inventory audit log (item edits + stock moves), one partition per UTC month —
                                     never one constant key (the CALL#ALL lesson); walked newest-first, filters on top
                                     … GSI4 INVLOG#PRODUCT#<productId> / <createdAt>#<id> — one item's history on TransferEntityIndex
                                     (sparse: `container_assigned` names no item and lives in the month walk only)
PRODUCT#<id>       / METADATA        an inventory item; GSI1 CATEGORY#<category>, GSI2 TYPE#<type>, GSI4 PRODUCTS#ALL /
                                     <name lowercased, first 200 chars>#<id> on EVERY product (any type, any status — the
                                     Price Book list, name order, one ~16k-row partition), and a sparse GSI3
                                     PRODUCTS#STOCK / <name lowercased>#<id> on every stock-managed product (type product,
                                     manageStock not false, any status) — the "inventory products" list reads that ~3k-row
                                     partition, never a Scan of the ~46k-row table (whose read budget returned empty pages)
TRANSFER#<id>      / METADATA        a stock movement; GSI1 TRANSFERS#<YYYY-MM> / <createdAt>#<id> — the list, one
                                     partition per UTC month walked newest first down to `firstMonth` on
                                     TRANSFERS#INDEX / METADATA (only ever moves down), `type` filtered on top, never a
                                     Scan; GSI4 ENTITY#<type>#<id> for one location's movements (+ ENTITY_REF# rows)
WAREHOUSE#<id> | CONTAINER#<id> / METADATA   a location; GSI1 LOCATION#WAREHOUSE | LOCATION#CONTAINER /
                                     <name lowercased>#<id>. `totalUnits` / `uniqueItems` (Σ quantity, rows > 0 of
                                     its STOCK# rows) move in the SAME TransactWrite as every stock write — the
                                     stock row carries a condition on its old quantity so `uniqueItems` changes
                                     exactly on a 0 ↔ >0 crossing (`stock/stock-row-variant.ts`)
WAREHOUSE#<id> | CONTAINER#<id> / STOCK#<productId>   { productId, productName, quantity }
USER_CONTAINER#<userId> / METADATA   a user's container assignment (Workiz "User containers": one container, `all` or
                                     `none`); GSI1 CATALOG#USER_CONTAINER / <name>#<userId>, sparse GSI3
                                     CONTAINER_USERS#<containerId> / USER#<userId> for `access: container` only — who works
                                     from a van (OwnerIndex, beside the legacy OWNER#<technicianId> container rows)
CONTAINER_TEMPLATE#<id> / METADATA   a van's "ideal loadout" (`items` list on the row); GSI1 CATALOG#CONTAINER_TEMPLATE /
                                     <name lowercased> — the uniqueness check is a key condition on it, never Scan+Limit 1;
                                     archived, not deleted (`Container.templateId` points at it)
ITEM_GROUP#<id>    / METADATA        a Workiz item group (Price book → Item groups): `members` inline (productId, name,
                                     quantity, priceClient, taxable, description, customAttributes, the group's own `cost`
                                     + the import's extras), `groupType`, `categoryId`, `active` (the import's `isEnabled`
                                     reads as it until BitCRM writes one); GSI1 CATALOG#ITEM_GROUP / <name lowercased>.
                                     Disabled, never deleted — job lines carry `itemGroupId`
IDEMPOTENCY#TEMPLATE_FILL#<requestId> / METADATA   one "Fill from warehouse" request: claimed (conditional Put)
                                     before any stock moves, completed with the answer, released if the fill failed;
                                     `expiresAt` epoch seconds (+7 d) — the inventory table has no TTL configured yet
CONV#<id>          / METADATA        GSI1 INBOX#<open|archived>#<YYYY> — inbox split by year AND filter, never a
                                     constant key + FilterExpression (the CALL#ALL lesson); sparse GSI2 UNREAD#<YYYY>,
                                     GSI3 CAT#<kind>#<YYYY>, GSI5 FLAG#conversation, GSI6 ACCTCAT#<cat>#<YYYY>
INVOICE#<dealId>   / METADATA        one per job; GSI1 INVOICES, GSI2 CONTACT#<contactId> (status filtered, not keyed);
                                     sparse GSI4 UNPAID / <invoiceId> while status is due|overdue AND more than $0.01 is
                                     owed (Workiz counts a cent as paid) — set and cleared by the repository on every
                                     write that carries `status` (+ totals), never by a caller
UNPAIDINDEX        / STATE           { readyAt, count } — stamped by backfill:unpaid-index; until it exists the readers
                                     of UnpaidIndex answer from the full INVOICES list (slow, never wrong)
ESTIMATE#<id>      / METADATA | ITEM#<lineId>   GSI1 ESTIMATES, GSI2 CONTACT#…, GSI3 DEAL#<dealId>; DEAL#<id>/COUNTERS estimateSeq
PORTAL#<sha256>    / METADATA        portal token → contactId; CONTACT#<id>/PORTAL_LINK holds the link metadata
BUSINESS_PROFILE#<id> / METADATA     a company; GSI1 BUSINESS_PROFILES. The legacy SETTINGS/BUSINESS_PROFILE
                                     singleton is migrated lazily into BUSINESS_PROFILE#bp-default on first read
PAYMENT#<id>       / METADATA        a payment; GSI1 PAYMENTS, GSI2 CONTACT#<id>/PAYMENT#<createdAt>#<id>
INVOICE#<dealId>   / PAYMENT#<createdAt>#<id>   the SAME payment, adjacent to its invoice — one Query reads a
                                     job's ledger. Both copies are written in one TransactWrite
PAYMENT#<id>       / REFUND#<createdAt>#<id>    refunds under their payment (Stripe allows several partials)
PAYMENT_SCHEDULE#<dealId> / METADATA   a job's payment schedule (Workiz): `method` (percent | amount) + `entries`
                                     (id, percent|amount, dueDate, note). Its own partition — a job has one before it
                                     has an invoice; dollars and paid / overdue / due / future are worked out on read
                                     against the job's ledger (`payment-schedule.rules.ts`), never stored
PAYMENT#<id>       / REPORT          the Payments report's pointer: which PAYLINE rows the payment has and what each
                                     added to its bucket (the delta base); `rev`-guarded
PAYLINE#<YYYY-MM>  / <at>#<lineId>   one line of the Payments report — a payment on its PAYMENT date (tip included),
                                     a refund as a negative line on its own date, a reversal as "Dispute"; month and
                                     day on the business clock (America/New_York). No GSI keys
PAYAGG#<YYYY>      / D#<day>#<type>#<tech|->#<area|->  and  M#<YYYY-MM>#…   ADDed counters (n, amountCents,
                                     tipsCents, feesCents): the report's totals for any range, "All time" included,
                                     without reading the payments; PAYREPORT / INDEX holds its first and last month
STRIPE#<objectId>  / POINTER         → {paymentId}; one per session / intent / charge id, so a webhook finds
                                     its payment in ONE read
WEBHOOK#<eventId>  / METADATA        Stripe event dedupe; `expiresAt` TTL, 30 days
SETTINGS           / PAYMENTS        the PaymentSettings singleton (never holds a Stripe key)
CONV#<id>          / MSG#<createdAt>#<msgId>   the feed, paged in the partition; GSI4 JOB#<dealId> when job-linked
CONVOF#<kind>#<id> / ADDR#<e164|email> / PSID#<sid> / CLIENTMSG#<uuid>   pointers: find-or-create, inbound routing,
                                     webhook dedup, double-submit guard (the last one carries the TTL)
```

Rules:

- Table names come from `src/common/constants/dynamo.constants.ts`, never
  inline. Tests mock that module to point at the `*_Test` tables.
- Catalog lists reuse an existing GSI with a constant partition key
  (`CATALOG#JOB_TAG`) instead of adding an index. Prefer that.
- `Scan` is acceptable only for existence checks with `Limit: 1` (see
  `isReferencedByDeal`); everything else queries an index.
- Referenced catalog rows are **archived** (`active: false`), not deleted, so
  historical records keep resolving names.
- The document client sets `removeUndefinedValues` and
  `convertClassInstanceToMap` — the latter because `ValidationPipe({transform})`
  hands services class instances that the marshaller would otherwise reject.
  Its HTTP handler keeps sockets alive with `DYNAMODB_MAX_SOCKETS` (default 200,
  the SDK's own default is 50) and a 3 s connect / 10 s request timeout.
- Lookups that receive a list of ids use BatchGetItem (chunks of 100, retry
  `UnprocessedKeys`), never one GetItem per id — per-item fan-out queued behind
  the socket limit and was a top source of p95 latency (Phase A audit, Oct 2026).
- Local table creation is `services/<svc>/src/scripts/setup-dynamodb.ts`
  (`npm run setup:db` / `setup:dynamodb` in that workspace); `npm run setup:aws`
  from `backend/` runs all of them plus SNS/SQS. Production tables are Terraform
  (`infra/dev/data_plane.tf`).
- Schema/data changes ship as a script in `src/scripts/` — `backfill-*` for
  filling new attributes, `migrate-*` for reshaping keys, `seed-*` for catalog
  data — wired as an npm script in that service's `package.json`. Backfills must
  be idempotent and upsert-only.
- A **derived projection** is the exception, and it reconciles rather than
  backfills: rows the source of truth no longer lists must be removed, or a row
  that got in wrongly can never leave (see `TechnicianEligibilityReconciler`).
  Never author its rows with a `seed-*` script — the reconcile deletes them.
  Safety comes from refusing to act on an answer that could mean "the source is
  down": a failed call and an empty list both change nothing.

---

## 6. Events

SNS topics fanned out to one SQS queue per consumer; the consumer dispatches on
`eventType`. **The canonical contract is `@bitcrm/types` (`events/`)** — typed
payload interfaces plus `UserEventType` constants, with `event-contract.spec.ts`
locking the string values. Publishers and consumers both import them.

Topics: `user-events`, `deal-events`, `contact-events`, `inventory-events`,
`call-events`, `message-events`, `billing-events`. Consumers: deal-service
(`contact.merged`, `tech.approved`, `tech.updated`), messaging-service
(`contact.merged`, `contact.updated` — handlers land with the inbound webhook),
telephony-service (deal + contact events on `deal-events-to-telephony`: `dealTotal`
on linked calls, caller-name cache invalidation) and search-service (every topic, one `search-index` queue). DLQ
`maxReceiveCount = 5`.

**`EVENTS.md` is the catalog and is expected to stay accurate — update it in the
same change that adds or renames an event.**

Publishing:

```ts
this.snsPublisher?.publish('deal-events', 'job-tag.created', { jobTagId, name });
```

Fire-and-forget — a failed publish must never fail the write. The publisher
attaches the current trace id as a message attribute; the consumer restores it
into the async-local trace storage, so a trace spans the hop.

Consuming — register in `AppModule.onModuleInit` against `SqsConsumerService`,
gated on the queue URL env var, started only under `ENABLE_SQS_CONSUMER=true`
(so local dev without LocalStack stays quiet).

Live UI updates deliberately do **not** go through SNS. Telephony streams call
events over SSE (`GET /api/telephony/calls/stream`) fed by Redis pub/sub, so
every instance sees every webhook.

Twilio status callbacks (`/voice/conference-events`, `/voice/status`) reply
`<Response/>` first and do their work afterwards on `WebhookQueue`, a per-process
serial queue keyed `call:<primary sid>`. It orders one call's events within a
task only; across tasks, safety still rests on `applyLifecycle`'s monotonic
status guard and the Redis `SET NX` claims. `/voice/outbound` still writes the
call record before returning TwiML — later webhooks on other tasks depend on it.

### Search (CQRS read model)

`EVENT_ROUTES` in `services/search/src/indexer/event-routes.ts` maps each event
type to `{ SearchType, upsert|delete, idField }`. An upsert re-fetches the
authoritative entity over the internal HTTP API and reindexes it; a delete
removes the doc. The **backfill** (`npm run backfill -w backend/services/search`,
reading the services' internal list endpoints) is the authoritative populator —
events only keep the index fresh. It does **not** run on boot in deployed
environments (`ENABLE_SEARCH_BACKFILL` is unset; it used to re-index everything
on every deploy, 31 times in one week). Run it by hand — `npm run backfill` or
`POST /api/search/internal/reindex` — after every Workiz import, after a mapping
change, and on a new environment. Its deal pages walk StageIndex `STATUS#`
partitions and its product pages Query GSI4 `PRODUCTS#ALL`, so both depend on
those keys being present (`backfill:product-catalog-index` for products). Index name is versioned (`bitcrm-search-v3`)
behind the alias `bitcrm-search`; changing the mapping means a new version plus
`npm run create-index` and a reindex. The `conversation` document (messaging
inbox threads, `message-events`) is assembled from three internal reads —
the thread, its last N messages, and its party / jobs — see `EVENTS.md`.

---

## 7. Observability

Wired the same way in every service:

- **Logs** — `LoggerModule.forRoot({ serviceName })`, pino via nestjs-pino,
  `CorrelationMiddleware` puts a trace id on every request and log line
  (`traceId`), sensitive paths redacted. Pretty in dev, JSON in prod, plus Loki
  when `LOKI_URL` is set.
- **Metrics** — `MetricsModule.forRoot({ serviceName })` exposes
  `/<prefix>/metrics` and installs an HTTP interceptor. Domain counters belong
  on `BusinessMetricsService` (entity created/updated/deleted, events, SQS,
  cache, internal HTTP, deals, stock, search, calls) — extend that rather than
  minting ad-hoc registries.
- **Traces** — `initTracing('<svc>-service')` at the top of `main.ts`, OTLP to
  `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **Health** — `HealthModule.forRoot({ dynamoTables })` → `/<prefix>/health`.
- **Connectivity** — `ConnectivityModule.forRoot({...})` probes DynamoDB, Redis,
  S3, SNS, SQS, OpenSearch and peer services on an interval and exports
  `bitcrm_dependency_up`. `failFast` names probe kinds that should abort boot.

`scripts/verify-monitoring.mjs` discovers services from the filesystem and fails
if one isn't scraped and probed — it parses prefix, port and service name out of
`main.ts`, so keep those literal. It also checks the deploy path: every service
needs a `case` arm in `render-taskdef.sh` whose PORT and PREFIX match `main.ts`,
or its sidecar scrapes the wrong URL. It runs as part of `npm run test:unit`.

Deployed environments push instead of being scraped — Service Connect's HTTP
namespace load-balances across tasks, so a central Prometheus cannot scrape an
individual one. Metrics go via a Grafana Alloy sidecar over loopback; traces and
logs push straight from the app. `render-taskdef.sh` adds all of it only when
`GRAFANA_CLOUD_TOKEN` is set, and renders the old task definition exactly when
it isn't. See `monitoring/README.md`.

---

## 8. Testing

**Write the test first.** New behaviour starts with a failing unit test.

Three tiers, all Jest + ts-jest, `^src/(.*)$` mapped to `<rootDir>/src/$1`:

| Tier | Location | Config | Needs | What it covers |
| --- | --- | --- | --- | --- |
| unit | `test/unit/**/*.spec.ts` | `jest` block in `package.json` | nothing | services/mappers/utils with hand-rolled mocks from `test/unit/mocks.ts` |
| integration | `test/integration/*.spec.ts` | `test/integration/jest-integration.json` | DynamoDB Local :8001 | repositories against real DynamoDB |
| e2e | `test/e2e/*.spec.ts` | `test/e2e/jest-e2e.json` | DynamoDB :8001 + Redis | HTTP through supertest with guards and permissions live |

```bash
npm test              # unit, every package (this is the fast loop)
npm run test:unit:cov # + coverage
npm run test:integration
npm run test:e2e
npm run test:all
```

`scripts/test.sh` is the runner: it starts the `test` compose profile, drops and
recreates the `BitCRM_*_Test` tables, flushes Redis **DB 15** (tests never touch
dev data in DB 0), then runs each workspace `--runInBand` and prints a summary.

Harness conventions:

- `test/integration/setup.ts` owns table creation/teardown and exports the raw
  client; e2e reuses it.
- `test/e2e/setup.ts` mocks `src/common/constants/dynamo.constants` to the
  `_Test` tables **before any import**, swaps `CognitoAuthGuard` for a
  `TestAuthGuard` that reads an `x-test-user` header, keeps the **real**
  `PermissionGuard`, seeds role permissions into Redis, and overrides outbound
  collaborators (`InternalHttpService`, `GeocodingService`) so a test never
  makes a network call.
- e2e specs assert authorization explicitly: a read-only role gets 403, no
  header gets 401. Do that for every new resource.
- **billing's e2e is cross-service** (`services/billing/test/e2e/`): it boots the
  real crm, inventory, deal and billing `AppModule`s on 4002/4004/4003/4008 in
  one Jest process, swapping only `AuthModule` (bearer → super admin or an
  `assigned_only` technician; the real `PermissionGuard` reads Redis DB 15).
  Needs `dynamodb-local` :8000, LocalStack and `npm run setup:aws`; it clones the
  dev tables' schemas into `*_E2E` tables and drops them afterwards. Not part of
  `scripts/test.sh`. `npm run test:e2e -w billing-service` (`E2E_SLOW_MS=300`
  logs slow calls).
- Unit tests construct services with `new Service(mockRepo as any, ...)` — that
  is why collaborators are `@Optional()`.

Coverage today: shared 29 specs; user 40/8/9, deal 44/8/6, telephony 30/1/1,
crm 17/2/2, inventory 15/6/5, search 12 unit (no integration/e2e yet — search
and telephony are the thin spots).

If a test fails that your change cannot plausibly touch, check whether it was
already failing on a clean tree before chasing it — a couple of suites have been
red independently of feature work.

---

## 9. Adding a new service

The plumbing is checklist-driven; missing a step fails a build, a test, or
silently loses monitoring.

1. `services/<name>/` — copy the smallest existing service (`search` or
   `telephony`) for `package.json` (scripts + the `jest` block), `tsconfig`,
   `nest-cli.json`.
2. `main.ts` — env → `initTracing('<name>-service')` → prefix `api/<name>` →
   CORS → `HttpExceptionFilter` → Scalar docs → `installGracefulShutdown` →
   `runBootstrap`. Keep the literals greppable: `verify-monitoring.mjs` parses
   `setGlobalPrefix`, `process.env.<NAME>_SERVICE_PORT || <port>` and
   `initTracing` straight out of this file.
3. `app.module.ts` — Logger, Metrics, Health, Connectivity, plus whatever of
   DynamoDb/Redis/Auth/Storage/Events it needs.
4. Port: next free in the 400x range. Add `<NAME>_SERVICE_PORT` and
   `<NAME>_SERVICE_URL` to `.env.example` and `.env`.
5. `gateway/nginx.conf` — an `upstream` block (copy one verbatim, comments and
   all) and a `location /api/<name>` block.
6. `monitoring/prometheus/prometheus.yml` — a scrape job named
   `<name>-service` at `/api/<name>/metrics`; blackbox probe of
   `/api/<name>/health`. Then `npm run check:monitoring` until it passes.
7. `backend/package.json` — a `dev:<name>` script; `scripts/test.sh` — unit
   (and integration/e2e) entries; `scripts/setup-aws.sh` — a `run_for` line if
   it provisions anything.
8. Storage: `src/scripts/setup-dynamodb.ts` + `infra/dev/data_plane.tf` if it
   owns a table; `infra/modules/sns-sqs` wiring if it publishes or consumes.
9. Deploy: add it to `infra/dev/main.tf` `services` (port, ALB priority, path
   pattern), `services/<name>/taskdef.json`, the `case` in
   `scripts/render-taskdef.sh`, and the path filter + choice list in
   `.github/workflows/deploy-dev.yml`.
10. Tests: `test/unit`, `test/integration/jest-integration.json`,
    `test/e2e/jest-e2e.json` and their `setup.ts`.

### Adding a module to an existing service

Module + controller + service + repository + constants + DTOs, as in §4. Then:
register it in `app.module.ts` (**before** any module with a `GET /:id` under
the same prefix), add resource + actions to `RESOURCE_REGISTRY` and the default
roles if it is permission-gated, add unit tests first and e2e authorization
tests, and — if it emits events — the types in `@bitcrm/types` plus a row in
`EVENTS.md`.

---

## 10. Gotchas

- **`ValidationPipe` is not universal.** user, inventory and deal register
  `new ValidationPipe({ transform: true, whitelist: true })`; **crm, search and
  telephony do not** — their DTO decorators are inert and query params arrive as
  strings. Coerce numerics in the service (`Number(query.limit) || 20`) or a
  string `Limit` makes DynamoDB throw `SerializationException`. This has already
  caused a 500 on companies.
- **Auth uses the Cognito *id* token**, not the access token (`tokenUse: 'id'`);
  permissions ride on `custom:role_id` / `custom:user_id` claims.
- **Route shadowing** under a shared global prefix — see §4.
- **`@bitcrm/types` must be built** before backend builds that import it; it
  lives outside the backend turbo graph.
- **Events are fire-and-forget.** Never let a publish failure fail a write.
- **Reports → Activity reads two sparse indexes on the timeline rows, and the
  rows written before them are invisible to it.** The timeline writer stamps
  GSI8/GSI9 (+ `activitySearch`, `activitySource`) and ticks `ACTCOUNT#<day>`
  on every event; after the Terraform apply that creates ActivityDayIndex and
  ActorIndex — and again after every Workiz timeline import — run in
  `backend/services/deal`: `backfill:activity-index -- --apply` (idempotent,
  conditional, never overwrites a live write) and then `recount:activity --
  --apply` (sets each day's counter from the index). Of the imported rows
  only Workiz's own activity log is an Activity event (`workiz:activity:*`),
  not its job comments; every native event is, our own job notes included
  ("Added note: …", re-searchable after an edit). Call Tracking (`GET /telephony/calls/stats/tracking`) needs no
  backfill: it walks the month partitions of the call log.
- **The search index is derived.** Never treat it as a source of truth; fix data
  in the owning service and let the indexer or backfill catch up.
- **Inventory reads its lists off derived attributes, and a deploy is not done
  until the backfills have run.** `GET /containers` / `GET /warehouses` Query
  GSI1 `LOCATION#…` (rows without the keys are invisible), the `search`
  filters match `searchName` / `searchSku` (rows without them are never found),
  and `Product.onHand` is moved by the stock writes only where it already
  exists. In the same release, before traffic — and again after every Workiz
  import — run in `backend/services/inventory`: `backfill:location-index`,
  `backfill:product-search`, `backfill:product-onhand`, `backfill:product-numbers`
  (it raises `COUNTER#PRODUCT` past the imported numbers even when
  every row is numbered; skip it and the next `POST /products` gets "Product
  ID 1"), `backfill:user-containers` (turns the containers' `technicianId` and
  imported `accessUserIds` into `USER_CONTAINER#` rows; until it has run, a
  user with no row falls back to the container that names them as
  `technicianId`, and the secondary users have no van at all),
  `backfill:product-stock-index` (files stock-managed products on the GSI3
  `PRODUCTS#STOCK` partition; until it has run, `GET /products?manageStock=true`
  without a category is empty), `backfill:location-totals` (sums each
  warehouse's and container's STOCK# rows into `totalUnits` / `uniqueItems` on
  its METADATA row; stock writes move them only where they exist, so until it
  has run the lists show "—" for every imported location — run it AFTER the
  deploy, it is safe while stock moves), `backfill:transfer-index` (files
  every transfer row on the GSI1 month partitions and sets the walk's floor;
  until it has run, `GET /transfers` and its count show none of the transfers
  written before it). All eight are idempotent and upsert-only;
  `WORKIZ_IMPORT.md` §0 has the row shapes.
  `backfill:product-catalog-index` belongs to the same list (idempotent,
  upsert-only on the index keys): it files every product on the GSI4
  `PRODUCTS#ALL` partition, and until it has run on an environment the Price
  Book — `GET /products` and `/products/count` without `category` and without
  `manageStock=true` — is EMPTY there.
  `backfill:product-thumbnails` (after the deploy, after the catalog index,
  and after every import that brings photos) makes the 128×128 webp each
  photo's list row shows (`products/<id>/thumb-<uuid>.webp`, named in
  `thumbKey`); until it has run, those items show the placeholder. New
  uploads get theirs from `POST /products/:id/photo/complete`. It walks GSI4
  `PRODUCTS#ALL` (no Scan), is idempotent, and needs the S3 bucket too.
- **The jobs list's Search box reads derived attributes, and imported jobs have none until a
  backfill.** `GET /deals?q=` (and `/deals/counts?q=`) filter on `searchText` / `clientSearchText`
  (+ `*Digits`) of the METADATA row; a row without them is never found. Run in
  `backend/services/deal` after the deploy that ships it and after every Workiz import:
  `npm run backfill:deal-search -- --apply` (dry run without `--apply`; `--segments` /
  `--concurrency`; reads crm's contacts + companies tables directly, so on dev also set
  `CONTACTS_TABLE` / `COMPANIES_TABLE`; idempotent, conditional on `updatedAt`). The client's half
  stays current only while `contact.updated` reaches deal-service (`user-events-to-deal` subscribed
  to `contact-events`, Terraform). List pages are FILLED under any filter (`fillPartition`: reads on
  past the rows the filter drops, ≤ 20 reads a partition per request); a search in a huge closed
  status (Done, Canceled) may still answer a short page WITH a cursor, and its count is `null`.
- **Workiz display data: tech names, area colours, tag order.** `User.workizName` ("(2) TX - Daniel
  Munoz", written by the users import) leaves user-service on `GET /users`, `POST /users/by-ids` and the
  internal eligibility routes; deal-service copies it into TECH_ELIGIBILITY on boot and on `tech.updated`
  (now also `name`), which is where `included.technicians` and the qualified-techs lists read it — so deploy
  user-service BEFORE deal-service. A rename here drops `workizName`. `ServiceArea.color` (`#rrggbb`) and the
  tags' Workiz `priority` come from the importer; rows already loaded get them from the parser's
  `bitcrm-patch-display` (workiz-data-parser, `docs/import/jobs-parity-2026-10-08/displaydata.md`).
- **A subcontractor cannot sign in (Workiz "User type").** `User.userType` is `regular` (absent) or
  `subcontractor` — Workiz's free team member who "can not login, can take jobs and get messages".
  user-service enforces it: `POST /users` with `userType: subcontractor` makes the Cognito account
  with the invite suppressed and switches it off, forces the technician role and the field team;
  `changeUserType` (via `PUT /users/:id { userType }` or the technician card's `technicianType`, never
  on yourself, only below your rank) switches the account off and sets the `user:disabled` flag, or
  back on with the invite re-sent; `reactivate` keeps a sub's sign-in off; `resendInvite`,
  `assignRole`, an admin's 2FA switch-on and `gpsTrackingEnabled: true` are refused for a sub.
  `TechnicianProfile.technicianType` is the card's copy, kept in step and read back from the user.
  messaging's send-to-tech skips `in_app` for a sub (`no_app_login`); SMS / email go as before. After
  the deploy, and after every Workiz users import or the parser's `bitcrm-patch-user-type`, run
  `npm run backfill:user-type -w backend/services/user -- --apply` (dry run without `--apply`;
  needs `COGNITO_USER_POOL_ID`): it moves card-only types onto the user, fixes the cards and switches
  every sub's Cognito account off. Workiz has no sub badge on jobs, the schedule or reports — neither do we.
- **A closed job ends when it was closed (Workiz "Update Job End Time", `CONFIG#JOB_RULES`,
  ON by default).** `DealsService.moveStatus` to Done / Canceled writes `scheduledEndDate`
  (the close day on the job's clock — `jobTimezone`, else its area's, else New York),
  the slot's end (held at the start only when a same-day close came before it),
  `jobEndDateUtc` and, if the job had none, `jobTimezone`; the repository restamps the
  EndIndex from them, so "By: Job end date" lists the job on the day it was closed, as
  Workiz does (its export: the end is the second the status changed, even weeks after or
  before the visit). The start never moves and a reopen does not put the old end back.
  Jobs closed in BitCRM before the rule need `npm run backfill:close-end-time -w
  backend/services/deal -- --apply` (dry run without `--apply`); it leaves imported jobs
  on the end Workiz gave them unless `--since <ISO of the import>` says they closed here.
  Switch: `PUT /deals/job-rules { updateJobEndTimeOnClose }` (`settings.edit`).
- **Outside the office app, a job's time is told on the JOB's clock (owner, 2026-10-12).**
  Texts/emails (messaging's `ContextLoader`, the reminder anchors), receipts, documents,
  the portal and the confirm page use `jobTimezone`, else the area's zone
  (`GET /api/deals/service-areas/internal`, cached; a failed read is never fatal), else
  New York — never the company setting, which only serves messages with no job.
  messaging `jobZone`, billing `jobTimezoneOf` / `jobZone` (`common/dates.ts`). A clock
  time carries its zone's abbreviation for that day (`zoneAbbr` + `wallClockInstant` from
  `@bitcrm/types`: "10:00 AM CDT"; a `{{appointment_time}} - {{job_end_time}}` window
  says it once, after the end); a date-only value carries none and is never shifted.
- **Field Validation gates creation only** (Workiz: "applies for job creation only").
  `POST /deals` 422s on the admin-required rows of `JOB_REQUIRABLE_FIELDS`
  (`CONFIG#JOB_FIELDS`); the client-owned rows (names, numbers, email, company, the
  client's address) are judged against crm's contact, read only when one of them is on,
  and a crm that cannot be read leaves them to the form. `PUT /deals/:id` is not gated.
- **A job can have a first number of its own (`Deal.clientPhone`).** The job page's
  "Apply these changes to…" (`PUT /deals/:id/client-phone`, `deals/client-phone/`):
  `job` gives this job the number; `client` / `open_jobs` make it follow the profile
  and pin the OLD profile number (read from crm before the page writes the contact)
  onto the client's other jobs that showed it — `open_jobs` moves the open, unpaid
  ones to the new number instead. Absent = the client's first number. Telephony's
  bridge (phoneIndex 0) and dial-in dial it; the jobs search, global search and Jobs
  report read it. It is a client's number, so `JobNumberInterceptor` strips it from
  `DealsController` / `DealBillingController` answers without `contacts.view_numbers`
  (the dispatch map strips it with `phones`); `@Internal` reads keep it.
- **Who did it: request lines carry the caller, admin actions carry an audit entry.** Every
  "request completed" line has `userId` / `roleId` (never the email) once `CognitoAuthGuard` has
  run — set by `requestLogProps`, pino-http's `customProps`, which runs again when the response
  finishes; the `req` serializer is bound on arrival, before any guard, so a caller read there is
  always empty (it was, until 2026-10-15). user-service records every sensitive admin action —
  create / edit / deactivate / reactivate / type / role / permission overrides / invite / an
  admin's MFA switch, and role create / edit / delete — through `AdminAuditService.record(caller,
  …)` AFTER it succeeded: a log line starting `AUDIT` (CloudWatch filter `"AUDIT"`) and the
  `ADMINAUDIT#` rows (§5). Recording never fails the action. A new sensitive action gets a
  `record` call, an `ADMIN_AUDIT_ACTIONS` entry in `@bitcrm/types` and a test that a refused
  attempt records nothing.
- **Who is online (Admin → Users) is a Redis sorted set, not a column.** `CognitoAuthGuard`
  stamps every signed-in request's user into `users:last-seen` (score = epoch ms) through the
  shared `UserActivityTracker` — at most once a minute per user per process, fire-and-forget —
  so every service, the web and the app all count. The web also sends `POST /users/me/heartbeat`
  once a minute while its tab is in view. `GET /users/presence` (`users.view`) answers every
  user's `lastSeenAt` and `online` (within `USER_ONLINE_WINDOW_SECONDS`, 5 min); stamps older
  than half a year are pruned on read. A Redis flush only forgets "Last seen".
- **Caches fail open; Redis is never a reason to 500.** Wrap every cache read/write in
  `failOpen` (`@bitcrm/shared`): a failed read is a miss, a failed write or invalidation is
  dropped (the TTL bounds staleness). `PermissionCacheReader` does the same (a closed Redis
  used to surface as "invalid token" 401). `installGracefulShutdown` keeps serving for
  `SHUTDOWN_DRAIN_MS` (3 s in production) after SIGTERM, closes the HTTP listener, and only
  then calls `app.close()` — Nest runs destroy hooks (Redis `quit()`) BEFORE closing HTTP, which
  gave 1,095 × 500 on the outgoing task of deploys in the week of 7 Oct 2026.
- **Geocoding needs `GOOGLE_MAPS_API_KEY` on deal** (GitHub secret → `render-taskdef.sh`, deal
  only). Without it jobs saved with no coordinates get no map pin / automatic area, ZIP areas
  never match, and the boot self-heal (`ServiceAreasBackfill`) is skipped. After adding it:
  `backfill:service-areas` and `backfill-geo` in deal.
- **Redis DB 0 is dev, DB 15 is tests.** Don't flush the wrong one.
- **Deal catalogs are cached in process for 60 s** (`common/cache/catalog-cache.ts`:
  job types, sources, tags, client tags, custom fields, statuses, service areas,
  external companies). A write clears the cache only in the task that took it, so
  other tasks can serve the old list for up to 60 s; uniqueness and overlap checks
  still read the repository. Catalog list Queries follow `LastEvaluatedKey`
  (`common/utils/query-all-pages.ts`) — the Workiz import made job types 898 rows.
- **Report windows are cached in Redis** (`common/cache/report-window-cache.ts`,
  `deal:report-window:v1:<kind>:<from>:<to>:<by>…`, gzipped, not stored above 4 MB):
  the Jobs report, Job Statistics, Tax and Commissions share one read across tasks.
  TTL 5 min when the window reaches today, 30 min if it ended in the last 3 days,
  24 h otherwise — there is no write-time invalidation, so those are the staleness
  bounds. Profit/commission rows (billing's ledger) stay per task for 60 s. The
  nightly `DashboardSnapshotScheduler` (Redis day-lock) also warms last week and
  last month. The dashboard's snapshot miss reads one projected window
  (`readStatsWindow`), not 100-row `list()` pages.
- **"Needs invoice" is an index, gated until backfilled.** GSI11 NeedsInvoiceIndex
  (sparse, repository-owned) answers `GET /deals/internal/needs-invoice[/count]`
  and `?needsInvoice=true`. Until `npm run backfill:needs-invoice-index -w
  backend/services/deal -- --apply` has stamped `NEEDSINVOICEINDEX / STATE` (after
  the Terraform apply that creates the GSI), the internal routes answer 404 and the
  list keeps the old Scan; billing falls back on that 404 (and for assigned_only
  callers always uses the scoped public list). Re-run the backfill (it reconciles)
  after every Workiz import.
- **Telephony stores job totals on calls.** `dealTotal` is stamped when a call is
  linked and restamped from deal events; call stats, Call Tracking and the export
  read it and ask deal-totals only for rows without one. It is stripped from API
  responses (money behind `financials.view`). After the deploy and every import:
  `backfill:call-deal-totals -- --apply`, then `recount:calls -- --apply` (until
  `CALLCOUNT / STATE` exists, counts walk the log as before). Reads never write:
  parties/names are frozen by `CallFinalizer` 5 s after a call ends. Caller names
  are cached in Redis (`telephony:names:*`, 10 min found / 5 min unknown, cleared by
  contact events); the user directory is an SWR Redis entry. Recordings are copied
  to S3 (`calls/recordings/<callSid>/<recordingSid>.mp3`) after the webhook and
  served from there with Range support; not-yet-copied ones still stream from Twilio.
- **Messaging caches** (Redis, generation-keyed so a racing load never restores a
  pre-edit value): automations list (5 min, key carries `TRANSLATOR_VERSION`),
  templates list (5 min), party names (10 min / 5 min unknown, cleared by
  `contact.updated`); telephony's owned numbers 5 min with background refresh. Run
  `backfill:automation-specs -- --apply` after a deploy that raises
  `TRANSLATOR_VERSION` and after imports with automation rules.
- **User-service caches:** roles in Redis (`role:entity:<id>`, 5 min, generation-
  keyed; ≤10 s in-process copy per task), the approved-assignments set
  (`technicians:assignments:approved`, 5 min, cleared by every assignment write).
  Login reads security settings fresh on purpose — never cache them.
- **Batch routes for hot fan-outs:** inventory `POST /products/internal/by-ids`
  (≤500 ids; deal's items report falls back to per-id on 404/405), user
  `POST /users/internal/names-by-ids`, crm `contacts/internal/by-ids` — use them
  instead of one request per id.
- **Phase C indexes are gated; a deploy is not done until their backfills ran.** Each
  new read path stays on the old one until its backfill stamps a STATE row
  (checked ~once a minute per task). After the deploy, and again after every Workiz
  import (imports write rows without the new keys): deal
  `backfill:done-lines-index` (items report), user `backfill:users-all-index` and
  `backfill:calendar-month-index` (directory/roster, schedule calendar), crm
  `backfill:contact-list-index` (client list; Terraform GSI2 first), messaging
  `backfill:tech-scope` (technician inbox; needs the internal service URLs + secret
  like the search backfill). All dry-run by default, `-- --apply` to write; all
  reconcile. Calendar writes are now optimistic-locked (409 on a concurrent edit).
- **Price Book filters/search read OpenSearch.** Inventory sends filtered/search
  `GET /products[/count]` (no category) to search's `POST
  /search/internal/products/query` and loads the rows by id (re-checked against the
  filters); unfiltered/category browsing stays on DynamoDB. It needs index
  `bitcrm-search-v4` (`productList` fields) populated: `npm run create-index` then
  `npm run backfill` in search — the product walk stamps the `meta#product-list`
  readiness doc; until then, or on any search error/timeout (1 s), inventory reads
  DynamoDB. Stock writes publish `product.updated {fields:['onHand']}` so stock-level
  filters stay fresh. Needs `SEARCH_SERVICE_URL` (set by render-taskdef).
- **Dispatch map is windowed.** `GET /deals/map?from&to` bounds every status (open
  ones on GSI5), returns `pagination.totalAnyDate` for the "of N open" label, and is
  cached 10 s in Redis (key includes `deal:map:gen`, bumped by every deal write).
- **Internal batch reads:** `POST /deals/internal/by-ids` (≤500, includes deleted
  jobs — filter on status), used by billing's payments report with a public fallback.
- **Small inventory routes are CPU-bound, not I/O-bound.** At 0.5 vCPU Fargate
  throttles in 100 ms slices, so any burst (big walks, boot jobs, URL signing) delays
  every request in flight — latencies cluster at 100/200/300 ms. Keep per-request CPU
  low; `ProductsTypeBackfill` runs once (`PRODUCTTYPEHEAL / STATE`), thumbnail URLs
  are signed once per hour per key.
- **Telephony caches:** the Twilio owned-number list and Messaging Service
  membership live in Redis (fresh 5 min, served stale up to 1 h while one reload
  runs; buy/release invalidate), so Twilio-console changes take up to 5 min to
  show. Call flows and number settings are cached in process for 30 s.
- **Closed-status counts are bounded.** `/deals/counts` stops a Done/Canceled
  count at 1,000 matches or 3,000 rows read and reports `atLeast` (the tabs show
  "1,000+"); jobs-now counts only the four open statuses.
- **crm caps its batch lookups in the service** (no ValidationPipe): 500 distinct
  refs on `contacts/internal/by-ids`, 500 numbers on `contacts/internal/by-phones`.
- **Task sizing comes from `services/<svc>/taskdef.json`** (cpu 512 for every
  service since Phase A) plus the 2048 MB bump `render-taskdef.sh` adds with the
  Alloy sidecar — not from Terraform, whose task definition is a placeholder.
  Capacity provider and task count are per service in `service_sizing`
  (`infra/dev/compute.tf`); dev runs every service as one Spot task. Raising
  deal/user/crm to two tasks for real users is a one-line override there — keep
  new boot jobs and timers idempotent or behind a Redis lock (see
  `DashboardSnapshotScheduler`) so that stays safe.
- **Taxes live on service areas.** There is no tax-rate catalog: `ServiceArea.tax`
  (`{name, ratePercent}`) is the rate, exposed read-only as a `TaxRate` whose id is
  the area id (`GET /api/deals/tax-rates`). Job resolution is exempt client → the
  job's area tax → none. Jobs, estimates and invoices snapshot name + percent, so
  never "fix" a job by editing its area. Old `TAX_RATE#` rows / `defaultTaxRateId`
  pointers are converted by `npm run backfill:area-taxes -w backend/services/deal`.
- **The commissions report owns no rows.** `GET /api/deals/reports/commissions`
  (+ `/export`, CSV) is Workiz's "Commissions (Legacy)": Done jobs of a period,
  read off EXISTING keys — GSI5 `STATUS#done` by visit start for Closed /
  Scheduled (Workiz's "Closed" is the END of the visit window,
  `scheduledEndDate`, so the start range reaches 31 days back and the end day is
  filtered on), GSI1 `STATUS#done` by `createdAt` for Created, the tech index
  for an `assigned_only` caller. Every day and time is Connecticut's (the
  office's, Workiz's account clock): Created is the New York day, a visit is
  read off the job's own clock (`jobTimezone`, else its area's) onto New York
  (`report-dates`), and the visit indexes are read a day either side. It never reads
  GSI6: `closedAt` is when the job turned Done, not Workiz's "Closed". An
  imported job shows Workiz's frozen `commissionSnapshot`; a job done here is
  computed by `calculateWorkizCommission` (`commission-report/`) from billing's
  `POST /payments/internal/by-deals` and the technician's commission version in
  force on the job's day (user's `POST /technicians/internal/commissions`) —
  versions are never rewritten, which is what freezes a job's rate. The old
  `calculateCommission` in user-service (EPIC-6) is a different formula; leave it.
  Amounts need `financials.view` on top of `commission.view`: without it every
  amount is 0, no rate is sent (`money: false`) and the CSV has no amount
  columns. The Tech mode without `techId` is every job (Workiz).
- **A job line's cost is the line's own, and a job's Company Cost is the sum of
  its lines (Workiz).** `POST`/`PUT /deals/:id/products` honour `costCompany` only
  from a caller with `financials.view` (Workiz's Cost box in "Add job item");
  otherwise a new line or a swap takes the price book's cost and an in-place
  edit keeps the line's (`lineCosts` in `deal-line-rules.ts`). `refreshTotals`
  writes `companyCost = totals.cost` (Σ qty × costCompany) whenever the job has
  lines — Workiz's `company_parts` is exactly that on 560/560 dump jobs — so the
  quick view's Finance box and the commissions report's Company Parts agree
  (`partsOf` in `commission-report.rows.ts`: lines → typed Company Cost → the
  import's `companyParts` → the "Company Parts cost" custom field). Tech Cost
  stays typed. `soldBy` (Workiz "Sold by") is a user id on the line.
- **Job Statistics reads the Jobs report's windows; `/deals/stats` is the
  dashboard's.** `GET /api/deals/report/statistics` (Workiz Job Statistics) reads
  a period with `DealsRepository.readReportWindow` — "Closed" is the EndIndex
  (the visit's end, NOT `closedAt`), days on the account's Eastern calendar — and
  aggregates it with the pure `deals/report/job-statistics.logic.ts`. Its Profit
  is the Company Profit of the job's Commissions (Legacy) row (`commissionSnapshot`
  on an imported job, `CommissionReportService.build` on one done here), never
  total − tax − cost. Tabs and View Profit are `reports.view_*_statistics` /
  `reports.view_profit` on top of `reports.view` + `financials.view`; only an
  explicit `false` closes one, so a role saved before them keeps everything.
  `GET /deals/stats` keeps its own older semantics (by `closedAt`, money split
  per tech) because the dashboard widgets are built on it — don't "fix" one
  through the other. Offline check against Workiz's live numbers:
  `npm run verify:job-statistics -w backend/services/deal -- --package …`.
- **Companies are billing's.** A job's `businessProfileId` is validated against
  billing's internal list (cached 60s in deal, non-fatal when billing is down) and
  its name snapshotted; documents and the portal render the job's company (fallback:
  the default). Telephony stamps `CallRecord.businessProfileId` next to `sourceId`
  (number setting → the flow answering the number).
- **The client portal is its own frontend.** `apps/portal` (own Next app, own domain —
  `PORTAL_BASE_URL`, from SSM `/app/portal-domain`) serves `<PORTAL_BASE_URL>/<token>`
  and only calls billing's `@Public` `/public/portal/:token[/:kind/:id/(html|pdf)]`
  routes; the document is shown as `…/html` (the renderer's screen mode, in a
  sandboxed iframe) and the PDF is a download. Tokens are `HMAC(PORTAL_TOKEN_SECRET ||
  INTERNAL_SERVICE_SECRET, contactId:nonce)` — only the sha256 and the nonce are
  stored — so `POST /portal-links/:contactId/url` can hand out the SAME link again
  (copy, SMS) without killing the one the client already has; only
  `POST /portal-links/:contactId` regenerates. Rotating the secret orphans links
  (the next `…/url` replaces them). `GET /portal/:token` (outside the `api/billing`
  prefix, ALB rule `portal_legacy`) 302s links sent before the split to the portal.
- **The client confirms the visit through `{{confirm_link}}` (B12, Workiz `client_confirmed`).**
  The link is `<portal>/confirm/<token>`, one per JOB and stateless: the job's uuid
  (22 base64url chars) + the first 16 bytes of `HMAC(PORTAL_TOKEN_SECRET ||
  INTERNAL_SERVICE_SECRET, "client-confirm:v1:<dealId>")` (`@bitcrm/shared`
  `links/client-confirm-link.ts`) — no row anywhere. Messaging mints it when it renders a
  text (`ContextLoader` → `ctx.confirmLink`; a base URL in the Text Messages settings still
  wins), so it needs the portal origin too (`PORTAL_BASE_URL`, else `https://$APP_PORTAL_DOMAIN`).
  Billing's `@Public` `GET|POST /public/confirm/:token` verifies it (portal limiter), brands
  the answer with the job's company and calls deal's `@Internal`
  `GET|POST /deals/internal/:id/client-confirm`, where the job rules live: state
  open | confirmed | closed (done, canceled, done pending approval, deleted) | expired (the
  visit's end passed on the job's clock), a conditional write of `clientConfirmedAt` / `Via` /
  `By` / `For` (one confirmation per visit — `clientConfirmedFor` is the visit it was for, so
  a reschedule makes it stale and the client may confirm the new time), "Client Confirmed job"
  (`client_confirmed`) in the history and `deal.client_confirmed` (an automation trigger).
  **No sub-status is set** — Workiz sets none; a rule can.
- **Texting a document = messaging's `POST /messages`** (Twilio, the client's thread),
  driven by the web app's "Send by text" dialog: mark the document sent FIRST (the
  portal shows sent documents only), then send.
- **Payments live in billing, and `amountPaid` is a SUM, not a flag.** An
  invoice's `totals.amountPaid` is the gross of every payment in
  `COUNTED_PAYMENT_STATUSES` (`settled` + `refunded`) minus `refundedAmount`;
  `pending` (ACH in transit) never counts. Invoice status stays derived, so a
  partial payment leaves it `due`/`overdue` and a reversal pushes a `paid`
  invoice back on its own. Deal keeps only a denormalised `paymentStatus` +
  `amountPaid` for the job board, pushed over `PUT /deals/internal/:id/payment-status`.
  The jobs list's `unpaid=true` (Workiz "Show unpaid jobs") is a FilterExpression
  over those, `totals.total` and an imported snapshot's `totals.amountDue`
  (`deals/deal-balance.ts`, with its in-memory twin) — never a call into billing.
- **A payment belongs to the JOB, not to the invoice (Workiz).** A job can have
  payments and no invoice at all (most imported Workiz jobs do): the ledger rows
  still sit under `INVOICE#<dealId>` with `invoiceId === dealId`, just without
  an `INVOICE#<dealId>/METADATA` row. `GET/POST /deals/:dealId/payments` (the job's
  Payments tab) work either way and measure the balance against the job's own
  total; refund / delete / receipt fall back to the job too. The
  `/invoices/:id/payments` routes still 404 without an invoice, and an invoice
  created later starts from the existing ledger (`ledgerAmountPaid(deal.id)`).
- **Add payment carries Workiz's Payment type.** `POST …/payments` takes `methodDetail`
  (`OFFLINE_PAYMENT_TYPES` in @bitcrm/types: credit, cash, check, bank_transfer_offline,
  cash_app, consumer_financing, venmo, zelle, debit_offline) and `chargedByReferral`; the
  coarse `method` follows from the type (`PAYMENT_TYPE_METHOD`; a bank transfer made outside
  Stripe is `bank`) and a method sent with it must agree (400). A method-only body works as
  before. Credit charge is the web's `POST /deals/:dealId/card-intent` (the phone's typed-card
  rules, on the job with or without an invoice, NO signature gate); every phone/web card row
  carries `methodDetail: 'charge'`. The fee shown anywhere is `cardServiceFee` (@bitcrm/types),
  the very function billing charges with.
- **The Payments report is a projection, and a deploy is not done until it is rebuilt.**
  `GET /payments/report[/totals|/export]` (Workiz Reports → Payments) read only
  the `PAYLINE#` / `PAYAGG#` rows, never the ledger's `PAYMENTS` list index
  (keyed by `createdAt`, and summed with a 20k-row cap). `PaymentReportProjector`
  keeps them current from `syncLedger` (every ledger path) and the `refund.*`
  webhook: it re-reads the payment strongly consistent and writes the line +
  bucket DIFFERENCE in one `rev`-guarded transaction — never throws, never a
  delta it was told about. Rows written before the projection existed (every
  Workiz import) are invisible until `npm run rebuild:payment-report -w
  billing-service` has run (reconciles: overwrites with absolute values,
  deletes what the ledger no longer explains; `--dry-run` compares, `--jsonl
  <billing dir>` computes the report from an import package with no AWS). Run
  it after the deploy that ships the report and after every Workiz import.
- **The billing reports (Workiz Aging invoices, Invoices, Estimates, Tax) read
  indexes, never the whole ledger.** Everything about money still owed —
  Aging's five cards and table, the Invoices cards, "Days due", an
  unpaid-only Status filter, the overdue sweep — reads UnpaidIndex (~600 of
  ~78k invoices); a filter that may select a paid invoice walks GSI1 on its
  created window (New York days as UTC instants) with one FilterExpression
  the page and its count share. Estimates' cards read the created window
  projected to status + amounts (Redis 30 s). The Tax report is
  deal-service's (`GET /deals/report/tax`, `reports.view` + `financials.view`):
  Accrual reads the Jobs report's `readReportWindow` (the EndIndex for "Job
  end date"), Paid asks billing `GET /reports/internal/paid-by-job` — the
  Payments report's `PAYLINE#` lines, so it is only as complete as
  `rebuild:payment-report` made them — and works the tax out as Workiz does:
  taxable base × rate × min(1, collected / total), summed unrounded, rounded
  once per rate (not the jobs' stored tax). A deploy is not done until
  `npm run backfill:unpaid-index -w billing-service` has run (Terraform first:
  the UnpaidIndex GSI); run it again after every Workiz import. Offline
  checks against an import package: `verify:billing-reports` (billing) and
  `verify:tax-report` (deal). The reports read money the way Workiz prints it
  (`invoiceReportFigures` in @bitcrm/types): a cent or less owed is Paid /
  $0.00 (the invoice keeps the cent), Subtotal leaves out the card service fee
  (the job's `totals.serviceFee`), Amount adds the tip (Workiz's on an
  imported invoice, the ledger's otherwise) — stored totals are never
  rewritten for it.
- **Stripe webhook handlers ASSERT a state, they never apply a delta.** Stripe
  gives no ordering guarantee and re-delivers freely, so every status move goes
  through `canTransition` (`payments/payment-rules.ts`) and `reversed` is a
  one-way door: a late `payment_intent.succeeded` cannot resurrect a payment the
  bank already took back. Dedupe is a `WEBHOOK#<event.id>` row, released again
  if processing throws so the retry lands.
- **An ACH return arrives as `charge.dispute.created`, not as a failure.** The
  PaymentIntent stays `succeeded` forever. Reasons `insufficient_funds` /
  `incorrect_account_details` / `bank_cannot_process` mean the money left:
  mark the payment `reversed` and say so loudly.
- **billing's `main.ts` needs `{ rawBody: true }`** and `app.useBodyParser(...)`
  rather than `app.use(json(...))`, or the Stripe signature cannot be verified.
  Nest middleware runs AFTER the body parsers, so a `MiddlewareConsumer` cannot
  recover the bytes. `test/unit/stripe-webhook.http.spec.ts` posts really-signed
  bytes through a real app to keep that honest.
- **Money is dollars (2dp) in our types and cents at the Stripe boundary**,
  converted only in `payments/payment-rules.ts` (`toCents`/`fromCents`). Never
  round twice. A card surcharge is a payment-time charge on the `Payment` row —
  it never enters `DocumentTotals`, and it ships OFF (US card-network rules).
- **Client documents are numbered from Settings → Numbering, and a deploy is not done until
  `backfill:numbering` has run.** A job invoice keeps the job's number and a job estimate
  `<job number>-<n>` (Workiz shows the same); a CLIENT invoice / estimate (no job) takes the next
  number of its own counter on `COUNTERS#ACCOUNT` (`lastInvoiceNumber` / `lastEstimateNumber`,
  `GET/PUT /numbering`, `numbering/`): one atomic `SET n = if_not_exists(n, <legacy 1000+documentSeq>) + 1`
  per document, and the page's "Next … Id" is a conditional `SET` refused once a higher number is out
  (400 "must be more than the last number (N)", 409 when one went out mid-save). Numbers written by
  anything else (the Workiz import's stub estimates, 1140 …) are invisible to the counters until
  `npm run backfill:numbering -w billing-service` (`--dry-run` reports) raises them — run it after the
  deploy and after every import. Cut-over: the office sets Next Invoice Id / Next Estimate Id to the
  numbers after Workiz's last ones on the page. Settings → Estimates (`SETTINGS / ESTIMATES`,
  `GET/PUT /estimate-settings`) holds `attachPdf` (the Send panel asks
  `POST /{estimates|invoices}/:id/email-attachments` for the PDF, uploaded through messaging's presign
  on the caller's bearer) and `autoDeclineSameJob` (approving one of a job's estimates declines its
  other open ones, timeline "Updated estimate N status to Declined"); both default ON, the account's values.
- **Billing boots and works with no Stripe keys.** The `STRIPE_CLIENT` token
  resolves to `null`, the portal offers no methods, and the offline ledger
  (cash, cheque, card taken in person) is unaffected. Guard every online path
  on `StripeService.available` / `.onlineReady`.
- Plan documents belong in the gitignored `claude-plans/` at the repo root, not
  in `project-info/`.
