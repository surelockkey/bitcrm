# BitCRM Backend

Locksmith business management platform — backend monorepo.

## Architecture

- **7 NestJS microservices**: user (4001), crm (4002), deal (4003), inventory (4004),
  search (4005), telephony (4006), messaging (4007)
- **Shared package**: DynamoDB, Redis, Auth (Cognito), error handling
- **Infrastructure**: Terraform for AWS Cognito, Docker for local DynamoDB + Redis

## Quick Start

```bash
# Install dependencies
npm install

# Start local infrastructure (DynamoDB + Redis)
npm run setup

# Start all services
npm run dev

# Start a single service
npm run dev:user
```

## API Docs

Each service exposes Scalar API docs:

- <http://localhost:4001/api/users/docs>
- <http://localhost:4002/api/crm/docs>
- <http://localhost:4003/api/deals/docs>
- <http://localhost:4004/api/inventory/docs>

Unified docs: <http://localhost:4001/api/docs>

## Terraform (Cognito)

```bash
cd infra/dev
terraform init
terraform plan
terraform apply
```

Copy outputs to `.env`.

## messaging-service: infrastructure and rollout

The SMS/MMS/email inbox (`api/messaging`, port 4007). Its infrastructure lives
in `infra/dev` next to everything else; this section is the map of what it
creates, what the task reads, and the order to bring it up. The service code
itself (`services/messaging/`) ships separately — `test.sh`, `setup-aws.sh`
and the deploy workflow skip it until the directory (and its `taskdef.json`)
exist.

### Resources (`infra/dev`)

| Resource | Name | Notes |
|---|---|---|
| DynamoDB table | `bitcrm-dev-messaging` | `local.ddb_tables.messaging`; PK/SK, PAY_PER_REQUEST, **PITR on**, TTL on `expiresAt` (first TTL use in BitCRM — the `ddb-table` module's new optional `ttl_attribute`) |
| GSIs | `InboxIndex` (GSI1), `UnreadIndex` (GSI2), `CategoryIndex` (GSI3), `JobIndex` (GSI4), `FlagIndex` (GSI5), `AccountCategoryIndex` (GSI6) | keys `GSI<n>PK`/`GSI<n>SK` (S), projection ALL; 2, 4, 5, 6 are sparse |
| SNS topic | `bitcrm-dev-message-events` | `message.received`, `message.sent`, `message.status_changed`, `conversation.updated`, `opt_out.changed`; the `search-index` queue is subscribed |
| SQS FIFO | `bitcrm-dev-messaging-outbound.fifo` + `bitcrm-dev-messaging-outbound-dlq.fifo` | outbound send queue, `MessageGroupId` = conversation, visibility 90 s, DLQ after 5 receives; filled and consumed by the service |
| SQS | `bitcrm-dev-messaging-media` + `-dlq` | inbound MMS media → S3; filled and consumed by the service |
| SQS | `bitcrm-dev-contact-events-to-messaging` + `-dlq` | subscribed to `contact-events` (`contact.merged`, `contact.updated`) |
| S3 / KMS | `messaging/*` in the app bucket, key `alias/bitcrm-dev-documents` | same presigned SSE-KMS flow as deal attachments |
| ECS | service `bitcrm-dev-messaging`, ECR `bitcrm-messaging`, log group `/ecs/bitcrm-dev-messaging` | `local.services.messaging` |
| ALB | target group `bitcrm-dev-messaging`, listener rule priority **700** for `/api/messaging` + `/api/messaging/*`, health check `/api/messaging/health/live` | public rule: Twilio webhooks are authenticated by `X-Twilio-Signature` |
| IAM | roles `bitcrm-dev-messaging-exec` / `bitcrm-dev-messaging-task`, inline policy `bitcrm-dev-messaging-task` (`task_messaging`) | DynamoDB on the table + `/index/*`; S3 objects under `messaging/*` + prefix-scoped `ListBucket`; KMS `GenerateDataKey`/`Decrypt`/`DescribeKey`; SNS publish `message-events`; SQS send on outbound + media, receive/delete on all three; SSM read `/bitcrm/dev/*` |

The `sns-sqs` module now accepts `fifo = true` and `visibility_timeout_seconds`
per queue and skips the SNS queue policy for queues with no topic
subscriptions. Existing queues are unaffected (same names, 30 s, same policies).

### SSM parameters → task environment

All written by Terraform; `scripts/render-taskdef.sh` maps `/bitcrm/dev/x/y-z`
to `X_Y_Z` and adds the friendlier aliases in the right-hand column.

| SSM parameter | Env var in the task |
|---|---|
| `/bitcrm/dev/dynamodb/messaging/table-name` | `MESSAGING_TABLE` (and `DYNAMODB_MESSAGING_TABLE_NAME`) |
| `/bitcrm/dev/sns/message-events/arn` | `MESSAGE_EVENTS_TOPIC_ARN` (and `SNS_MESSAGE_EVENTS_ARN`) |
| `/bitcrm/dev/sqs/messaging-outbound/url` | `MESSAGING_OUTBOUND_QUEUE_URL` (and `SQS_MESSAGING_OUTBOUND_URL`) |
| `/bitcrm/dev/sqs/messaging-outbound/arn` | `SQS_MESSAGING_OUTBOUND_ARN` |
| `/bitcrm/dev/sqs/messaging-media/url` | `MESSAGING_MEDIA_QUEUE_URL` (and `SQS_MESSAGING_MEDIA_URL`) |
| `/bitcrm/dev/sqs/messaging-media/arn` | `SQS_MESSAGING_MEDIA_ARN` |
| `/bitcrm/dev/sqs/contact-events-to-messaging/url` | `CONTACT_EVENTS_TO_MESSAGING_QUEUE_URL` (and `SQS_CONTACT_EVENTS_TO_MESSAGING_URL`) |
| `/bitcrm/dev/sqs/contact-events-to-messaging/arn` | `SQS_CONTACT_EVENTS_TO_MESSAGING_ARN` |
| `/bitcrm/dev/documents/bucket` (existing) | `DOCUMENTS_BUCKET` |
| `/bitcrm/dev/documents/kms-key-id` (existing) | `DOCUMENTS_KMS_KEY_ID` |
| `/bitcrm/dev/redis/url` (existing) | `REDIS_URL` (shared pub/sub for the SSE stream) |

Set by the renderer, not SSM: `MESSAGING_SERVICE_PORT=4007`, `SERVICE_NAME=messaging-service`,
`ENABLE_SQS_CONSUMER=true`, `PUBLIC_BASE_URL=https://<app domain>`, and
`MESSAGING_SERVICE_URL=http://messaging:4007` in **every** task (Service Connect).

### GitHub `dev` environment

| Kind | Name | Used by |
|---|---|---|
| secret (existing) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | telephony **and** messaging — same account, the signature guard needs the owner's token |
| variable (new) | `TWILIO_MESSAGING_SERVICE_SID` | messaging: the Messaging Service (`MG…`) every outbound SMS goes through (A2P 10DLC). Empty → not rendered; the service boots but cannot send |
| variable (new, optional) | `MESSAGING_DEFAULT_SENDER` | messaging: E.164 fallback sender |

### Rollout order

1. **Terraform** — `cd infra/dev && terraform init && terraform plan -out tfplan`.
   Expect additions only for messaging (table, topic, three queues + three
   DLQs, subscriptions, SSM parameters, ECR, target group, listener rule 700,
   ECS service, roles, log group) plus two in-place updates: the `search-index`
   queue policy and its new `message-events` subscription. Any change to
   another service's target group, rule or role means a priority collision —
   stop. Then `terraform apply tfplan`.
2. **GitHub variables** — `TWILIO_MESSAGING_SERVICE_SID` (and optionally
   `MESSAGING_DEFAULT_SENDER`) on the `dev` environment. The Twilio secrets
   already exist for telephony.
3. **Deploy** — the service must exist in the checkout with
   `services/messaging/taskdef.json` (family `bitcrm-dev-messaging`, container
   `messaging`, port 4007, log group `/ecs/bitcrm-dev-messaging`). Merge, or
   run *Deploy (dev)* with `service = messaging`. Verify with
   `curl https://<domain>/api/messaging/health` and
   `aws ecs describe-services --cluster bitcrm-dev --services bitcrm-dev-messaging`.
4. **Twilio console** — on the Messaging Service, point *Incoming Messages*
   at `https://<domain>/api/messaging/webhooks/twilio/inbound` and the
   *Fallback URL* at `…/webhooks/twilio/fallback`. Status callbacks are set
   per message by the service.

Rollback is the usual `aws ecs update-service … --task-definition <previous>`;
nothing else reads the messaging table, and `search` merely ignores
`message-events` it has no handler for.
