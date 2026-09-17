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
| deal      | 4003 | `api/deals`      | deals/jobs, line items, timeline, attachments + the catalogs (job types/sources/tags/statuses, service areas — each with its own sales `tax` and default company —, custom fields, external companies), the read-only tax rates derived from the areas, and the technician-eligibility projection |
| inventory | 4004 | `api/inventory`  | products, brands, item categories, warehouses, containers, stock, transfers |
| search    | 4005 | `api/search`     | global search — OpenSearch read model + indexer (CQRS) |
| telephony | 4006 | `api/telephony`  | Twilio softphone: tokens, TwiML, call records, presence, call groups/flows, numbers, job dial-in codes |
| messaging | 4007 | `api/messaging`  | client inbox + team chat (Workiz Inbox model): conversations, messages (SMS/MMS, email, in-app), templates, opt-outs, settings — Twilio Messages API traffic; telephony stays the owner of the numbers |
| billing   | 4008 | `api/billing`    | job invoices + estimates (Workiz model), document templates + headless-Chromium PDF rendering (`@bitcrm/document-renderer`), companies (many business profiles, one default — jobs pick one), template images, client portal (`/public/portal/:token`, `@Public` + Redis rate limit) |

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
                     user's permissions from Redis (60s TTL) or, on a miss,
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
| `BitCRM_Contacts` | `CONTACTS_TABLE` | CompanyIndex | | | |
| `BitCRM_Companies` (also work orders) | `COMPANIES_TABLE` | ClientTypeIndex | | | |
| `BitCRM_Deals` (deals, line items, timeline, catalogs, eligibility) | `DEALS_TABLE` | StageIndex | TechIndex | ContactIndex | DispatcherIndex |
| `BitCRM_Inventory` | `INVENTORY_TABLE` | CategoryIndex | TypeIndex | OwnerIndex | TransferEntityIndex |
| `BitCRM_Calls` (also job dial-in codes) | `CALLS_TABLE` | AgentIndex | AllCallsIndex | PartyIndex | |
| `BitCRM_CallGroups`, `BitCRM_CallFlows` | `CALL_GROUPS_TABLE`, `CALL_FLOWS_TABLE` | — | | | |
| `BitCRM_Messaging` (conversations, messages, pointers, opt-outs, templates, settings, counters) | `MESSAGING_TABLE` | InboxIndex | UnreadIndex | CategoryIndex | JobIndex (+ GSI5 FlagIndex, GSI6 AccountCategoryIndex; TTL on `expiresAt`) |
| `BitCRM_Billing` (invoices, estimates + lines, templates, companies (business profiles), assets, portal tokens, per-job counters) | `BILLING_TABLE` | ListIndex | ContactIndex | DealIndex | |

Item shapes are prefix-encoded, e.g.

```
USER#<id>          / METADATA        GSI1 ROLE_USER#<roleId>, GSI2 DEPT#<dept>
PHONE#<e164>       / USER            phone → user index item (not a GSI)
DEAL#<id>          / METADATA
DEAL#<id>          / ASSIGN#<techId> assignment adjacency, on TechIndex — what findByTech reads
DEAL#<id>          / PRODUCT#<id>    line item; fulfillment: sourced | to_order | service
DEAL#<id>          / ATTACH#<id>
JOB_TAG#<id>       / METADATA        GSI1 CATALOG#JOB_TAG, GSI1SK <priority>#<name>
TECH_ELIGIBILITY#<id> / …            read model rebuilt from user-events
CALL#<sid>         / METADATA        GSI2 CALL#ALL for the global time-ordered log; optional `tagIds` (call tags)
CALLTAG#ALL        / CALLTAG#<id>    call-tag catalog — one partition, no GSI keys (never in the log); archive, don't delete
EXT#<code> / EXTOF#<dealId>          job dial-in codes (both directions, for idempotent minting)
CONV#<id>          / METADATA        GSI1 INBOX#<open|archived>#<YYYY> — inbox split by year AND filter, never a
                                     constant key + FilterExpression (the CALL#ALL lesson); sparse GSI2 UNREAD#<YYYY>,
                                     GSI3 CAT#<kind>#<YYYY>, GSI5 FLAG#conversation, GSI6 ACCTCAT#<cat>#<YYYY>
INVOICE#<dealId>   / METADATA        one per job; GSI1 INVOICES, GSI2 CONTACT#<contactId> (status filtered, not keyed)
ESTIMATE#<id>      / METADATA | ITEM#<lineId>   GSI1 ESTIMATES, GSI2 CONTACT#…, GSI3 DEAL#<dealId>; DEAL#<id>/COUNTERS estimateSeq
PORTAL#<sha256>    / METADATA        portal token → contactId; CONTACT#<id>/PORTAL_LINK holds the link metadata
BUSINESS_PROFILE#<id> / METADATA     a company; GSI1 BUSINESS_PROFILES. The legacy SETTINGS/BUSINESS_PROFILE
                                     singleton is migrated lazily into BUSINESS_PROFILE#bp-default on first read
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
`call-events`, `message-events`, `billing-events`. Consumers: deal-service (`payment.received`,
`contact.merged`, `tech.approved`, `tech.updated`), messaging-service
(`contact.merged`, `contact.updated` — handlers land with the inbound webhook)
and search-service (every topic, one `search-index` queue). DLQ
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

### Search (CQRS read model)

`EVENT_ROUTES` in `services/search/src/indexer/event-routes.ts` maps each event
type to `{ SearchType, upsert|delete, idField }`. An upsert re-fetches the
authoritative entity over the internal HTTP API and reindexes it; a delete
removes the doc. The **backfill** (`npm run backfill -w backend/services/search`,
reading the services' internal list endpoints) is the authoritative populator —
events only keep the index fresh. Index name is versioned (`bitcrm-search-v3`)
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
- **The search index is derived.** Never treat it as a source of truth; fix data
  in the owning service and let the indexer or backfill catch up.
- **Redis DB 0 is dev, DB 15 is tests.** Don't flush the wrong one.
- **Taxes live on service areas.** There is no tax-rate catalog: `ServiceArea.tax`
  (`{name, ratePercent}`) is the rate, exposed read-only as a `TaxRate` whose id is
  the area id (`GET /api/deals/tax-rates`). Job resolution is exempt client → the
  job's area tax → none. Jobs, estimates and invoices snapshot name + percent, so
  never "fix" a job by editing its area. Old `TAX_RATE#` rows / `defaultTaxRateId`
  pointers are converted by `npm run backfill:area-taxes -w backend/services/deal`.
- **Companies are billing's.** A job's `businessProfileId` is validated against
  billing's internal list (cached 60s in deal, non-fatal when billing is down) and
  its name snapshotted; documents and the portal render the job's company (fallback:
  the default). Telephony stamps `CallRecord.businessProfileId` next to `sourceId`
  (number setting → the flow answering the number).
- Plan documents belong in the gitignored `claude-plans/` at the repo root, not
  in `project-info/`.
