# Deploying search-service

The read model behind global search: one OpenSearch index, versioned behind
the alias `bitcrm-search`, fed by the `search-index` SQS queue (every event
topic) and rebuilt from the other services' `…/internal/all` routes by the
backfill. Nothing here is a source of truth — fix data in the owning service
and let the indexer or the backfill catch up (`CLAUDE.md` §6, §10).

## Index version

`SEARCH_INDEX_NAME` (`src/common/constants/opensearch.constants.ts`) names the
concrete index; changing the mapping means a new version. Current: **v3**,
which added the `conversation` document fields (`conversationKind`,
`conversationState`, `partyKind`, `partyId`, `assignedUserId`, `flagged`,
`lastMessageAt`, `dealIds`). Migrating a running environment:

```bash
cd backend
npm run create-index -w backend/services/search   # creates bitcrm-search-v3 and moves the alias to it
npm run backfill      -w backend/services/search   # fills it — the alias points at an empty index until this finishes
```

`create-index` swaps the alias immediately after creating the index, so run
the backfill right after it (or run both from one shell). Both are
idempotent; the old index can be deleted once the new one is populated.

## Backfill

```bash
npm run backfill -w backend/services/search                    # every type
npm run backfill -w backend/services/search -- conversation    # only inbox threads
npm run backfill -w backend/services/search -- deal contact    # any subset of SEARCH_TYPES
```

Alternatives to the CLI: `POST /api/search/internal/reindex` with the
`x-internal-secret` header (fire-and-forget, all types), or
`ENABLE_SEARCH_BACKFILL=true` on exactly one task, which runs it on boot
(`render-taskdef.sh` sets it for the search task).

Sources are the internal list routes (`BackfillService.SOURCES`). The
conversation source is
`GET /api/messaging/conversations/internal/all?limit=&cursor=`, which walks
the messaging table's InboxIndex year partitions (open threads newest year
first, then archived) — a Query per year, never a Scan. Each thread is then
enriched with `GET …/conversations/internal/:id/messages?limit=` (the last
`SEARCH_CONVERSATION_MESSAGES` bodies, default 20) plus the party from crm /
user-service and the referenced deals from deal-service, so one thread costs
up to a dozen internal reads.

### Pacing

| Variable | Default | Meaning |
|---|---|---|
| `SEARCH_BACKFILL_CONCURRENCY` | `8` | enrichment fetches in flight per page of 200 |
| `SEARCH_BACKFILL_PAGE_DELAY_MS` | `0` | pause between pages |
| `SEARCH_CONVERSATION_MESSAGES` | `20` | messages folded into each conversation document |

For the first conversation run over the imported history (~73k threads),
start with `SEARCH_BACKFILL_CONCURRENCY=4 SEARCH_BACKFILL_PAGE_DELAY_MS=250`
and watch `bitcrm_internal_http_*` on messaging, crm and deal plus
`bitcrm_search_index_operations_total{status="error"}`; raise the
concurrency once the peers are comfortable. Fetches for the same party or
job are cached across the run, so busy clients do not multiply the load.

The run is upsert-only: a failed source reports `-1` in the totals and the
pages already written stay valid — re-run the same command.

## Events

`message-events` reaches the `search-index` queue (Terraform subscription,
`infra/dev/data_plane.tf`). `conversation.updated`, `message.received`,
`message.sent` and `message.status_changed` all rebuild the conversation
document (`src/indexer/event-routes.ts`); contact / company / user edits and
deal roster changes cascade to the conversations that reference them.
Nothing to configure beyond `SEARCH_INDEX_QUEUE_URL` and
`ENABLE_SQS_CONSUMER=true`, as for every other topic.

## Query

`GET /api/search?q=&mode=typeahead|full&type=conversation,contact,deal&limit=&page=&size=`
— `type` is an optional csv over `SEARCH_TYPES`; without it every type the
caller may view is searched. Conversation hits carry `url: /messages/:id`,
the party name as `title`, the last message preview as `subtitle` and
`badges` of kind / `archived` / `flagged` / last channel. Viewers without
`contacts.view_numbers` see a number-only thread titled "Unknown number";
`assigned_only` viewers see only the threads of jobs they are on, their own
team thread and threads assigned to them.
