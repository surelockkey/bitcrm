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
| `tech.updated` | `TechUpdatedEvent` `{technicianId, changedFields}` | profile / skills / commission change | deal (eligibility), reporting |
| `tech.approved` | `TechApprovedEvent` `{technicianId, approvedSkills, serviceAreas}` | technician first becomes assignable | **deal (eligibility projection)** |
| `skill.proposed` | `SkillProposedEvent` | technician proposes skills | — (manager notification / SLA) |
| `commission.updated` | `CommissionUpdatedEvent` | commission set | reporting, payment |
| `document.uploaded` / `document.accessed` / `document.deleted` | `DocumentEvent` | sensitive document op | — (compliance/audit) |
| `sensitive.accessed` | `SensitiveAccessedEvent` | SSN/bank read | — (compliance/audit) |

## Topic: `deal-events` (published by deal-service)
`deal.created`, `deal.stage_changed`, `deal.completed`, `deal.tech_assigned`, `deal.tech_unassigned`, `deal.product_added`, `deal.product_removed`.

## Topic: `contact-events` / `crm` (published by crm-service)
`contact.created`, `contact.updated`, `company.created`, `company.updated`, `contact.merged`.

## Consumers (SQS, gated on `*_QUEUE_URL` + `ENABLE_SQS_CONSUMER=true`)
- **inventory-service** ← `user.activated`, `user.role-changed` → `ContainersEventHandler`
- **deal-service** ← `payment.received`, `contact.merged`, **`tech.approved`, `tech.updated`** → `DealsEventHandler`, `TechnicianEligibilityEventHandler`

## Eligibility projection (deal-service)
`tech.approved` / `tech.updated` build a `TECH_ELIGIBILITY#<id>` read-model in
`BitCRM_Deals` (`TechnicianEligibilityRepository`). Existing approved technicians
are backfilled on boot via `GET /api/users/technicians/internal/assignable`
(`TechnicianEligibilityBackfill`, idempotent, upsert-only).

## Infra
SNS topics + SQS queues + SNS→SQS subscriptions are provisioned by Terraform
(`infra/modules/sns-sqs`, wired in `infra/dev/data_plane.tf`). The `user-events`
topic fans out to `user-events-to-inventory` and `user-events-to-deal` queues.
Local dev provisions topics/queues via each service's `src/scripts/setup-aws.ts`.
DLQ `maxReceiveCount = 5` (Terraform and setup scripts aligned).
