# Event Catalog

All cross-service events flow through SNS topics, consumed via SQS (one queue
per consumer, dispatched by `eventType`). The **canonical contract** lives in
`@bitcrm/types` (`events/`) — `UserEventType` constants + payload interfaces.
Publishers and consumers import these so the wire format can't drift; the
`event-contract.spec.ts` test locks the string values.

## Topic: `user-events` (published by user-service)

| eventType | Payload (`@bitcrm/types`) | Published when | Consumers |
|---|---|---|---|
| `user.activated` | `UserActivatedEvent` | user created / reactivated | inventory (provision container) |
| `user.role-changed` | `UserRoleChangedEvent` | role assigned | inventory |
| `user.invite-resent` | `UserInviteResentEvent` | invite re-sent | — (audit) |
| `tech.updated` | `TechUpdatedEvent` `{technicianId, changedFields}` | profile / assignments / commission change | deal (eligibility), reporting |
| `tech.approved` | `TechApprovedEvent` `{technicianId, jobTypeIds, serviceAreaIds}` | technician first becomes assignable | **deal (eligibility projection)** |
| `commission.updated` | `CommissionUpdatedEvent` | commission set | reporting, payment |
| `document.uploaded` / `document.accessed` / `document.deleted` | `DocumentEvent` | sensitive document op | — (compliance/audit) |
| `sensitive.accessed` | `SensitiveAccessedEvent` | SSN/bank read | — (compliance/audit) |

## Topic: `deal-events` (published by deal-service)
`deal.created`, `deal.stage_changed`, `deal.completed`, `deal.tech_assigned`, `deal.tech_unassigned`, `deal.product_added`, `deal.product_removed`.

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

## Consumers (SQS, gated on `*_QUEUE_URL` + `ENABLE_SQS_CONSUMER=true`)
- **inventory-service** ← `user.activated`, `user.role-changed` → `ContainersEventHandler`
- **deal-service** ← `payment.received`, `contact.merged`, **`tech.approved`, `tech.updated`** → `DealsEventHandler`, `TechnicianEligibilityEventHandler`
- **search-service** ← **all topics** (`deal-events`, `contact-events`, `user-events`, `inventory-events`) via the single `search-index` queue → `IndexerEventHandler`. Upsert events trigger a re-fetch of the authoritative entity (internal HTTP) + reindex into OpenSearch; delete events remove the doc. The backfill (internal list endpoints) is the authoritative populator; events keep it fresh.

## Topic: `inventory-events` (published by inventory-service)
`product.created` / `product.updated` (archive/reactivate emit `product.updated`),
`warehouse.created` / `warehouse.updated` (archive emits `warehouse.updated`),
`container.created`, `transfer.created`. Payloads carry the entity id
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
