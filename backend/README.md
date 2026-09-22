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
   per message by the service. Numbers outside the Messaging Service need
   their own `SmsUrl` pointed at the same inbound URL. Also on the Messaging
   Service: **Enforce HTTP Basic Auth for media access** on (the media
   worker downloads MMS with `AccountSid:AuthToken`) and **Advanced Opt-Out**
   on with the STOP/START/HELP texts (the webhook records `OptOutType` into
   `OPTOUT#`; it never auto-replies). `MESSAGING_DELETE_TWILIO_MEDIA=true`
   on the task removes each media from Twilio once its copy is in S3 —
   off by default, the owner's call.
5. **Hourly reconciliation** — the backend has no in-process scheduler
   (`@nestjs/schedule` is not used), so schedule the internal trigger from
   outside, e.g. EventBridge Scheduler → a Lambda/`curl`, or a cron on any
   host that holds the secret:

   ```bash
   curl -sS -X POST "https://<domain>/api/messaging/internal/reconcile" \
     -H "x-internal-secret: $INTERNAL_SERVICE_SECRET" \
     -H "content-type: application/json" -d '{}'
   ```

   An empty body reconciles the last 90 minutes (overlapping runs are
   harmless — every write is keyed by the Twilio SID). After an outage pass
   `{"since": "<ISO>", "until": "<ISO>", "limit": 10000}` for the gap. The
   response reports `scanned`, `skipped` (already known and up to date),
   `synced` (known, but Twilio's status outranked ours — a lost status
   callback; written as the callback would have), `inbound` / `outbound`
   inserts, `adopted` (an outbound line whose sid was lost mid-send) and
   `errors` per sid. Alert on `failed > 0`.

   One line at a time: `POST …/internal/reconcile/message` with
   `{"conversationId", "createdAt", "messageId"}` fetches that message's
   sid from Twilio and applies the same comparison (answers `synced` /
   `unchanged` / `no_provider_sid` / `not_syncable`, 404 when unknown).
   On a machine Twilio cannot call back (no `PUBLIC_BASE_URL`), set
   `MESSAGING_STATUS_SYNC_INTERVAL_SECONDS` (e.g. `30`) and the service
   polls Twilio itself for the messages it sent that are older than 60 s
   and still short of a terminal status; off by default.

Rollback is the usual `aws ecs update-service … --task-definition <previous>`;
nothing else reads the messaging table. `search` consumes `message-events`
into its `conversation` documents (M15) and reads the messaging internal
routes for the backfill — see `services/search/DEPLOY.md`; a rolled-back
messaging leaves those documents stale, not broken.

### Email over SES (M17/M18 — `infra/dev/email.tf`)

Applied on dev 2026-09-22 with `messaging_email_domain = "surelockkey.com"`,
`messaging_email_from_local_part = "system"` and `messaging_mail_from_subdomain
= "ses"` (the DNS zone is in the same account; `mail.surelockkey.com` is Google
Workspace's Gmail CNAME, so the MAIL FROM lives on `ses.`). The tfvars are
local (`*.auto.tfvars` is gitignored) — re-create them before the next plan or
it will tear the email resources down.

Email history and new mail sit in the same conversation thread as SMS
(design §5, variant A). Everything in `email.tf` is gated on
`var.messaging_email_domain`: with the default `""` the plan is empty and
the task role gains nothing, so the file is inert until the owner picks the
domain (O12). No code path requires it either — without `MESSAGING_EMAIL_FROM`
`channel: email` answers 501, without a queue URL that consumer is not built.

| Resource | Name | Notes |
|---|---|---|
| SES domain identity + Easy DKIM | `<domain>` | `aws_sesv2_email_identity`; verifies once the three DKIM CNAMEs resolve |
| SES MAIL FROM | `<var.messaging_mail_from_subdomain>.<domain>` (default `mail.`) | SPF alignment for DMARC; falls back to SES's own on MX failure. Pick a name nothing else holds — a CNAME there cannot share the name with the MX + TXT |
| SES configuration set | `bitcrm-dev-messaging` | event destination → SNS `bitcrm-dev-messaging-email-events` (Send, Reject, Bounce, Complaint, Delivery, Open, Click, RenderingFailure, DeliveryDelay) |
| SNS + SQS | `bitcrm-dev-messaging-email-events` + `-dlq` | SES events → message status; permanent bounce / complaint → `OPTOUT#email#` |
| SES receipt rule set + rule | `bitcrm-dev-messaging` / `…-inbound` | recipients `<reply>.<domain>`; S3 action into the app bucket under `messaging/inbound-email/`, notifying SNS `bitcrm-dev-messaging-inbound-email`. **Activating it makes it the account's one active rule set in the region** |
| SNS + SQS | `bitcrm-dev-messaging-inbound-email` + `-dlq` | visibility 120 s (fetch + parse + attachment copies) |
| S3 bucket policy | on the app bucket | lets `ses.amazonaws.com` `PutObject` under the prefix (source-account + rule-set conditions). The bucket's only policy resource — extend it there |
| IAM (task role) | `SESSendEmail`, `ConsumeEmailQueues` | `ses:SendEmail`/`SendRawEmail` on the identity + configuration set; receive/delete on the two queues. Reading the raw mail is covered by the existing `messaging/*` grant |

SSM → task env (all auto-mapped by `render-taskdef.sh`, no script change):

| SSM parameter | Env var |
|---|---|
| `/bitcrm/dev/messaging/email-from` | `MESSAGING_EMAIL_FROM` (`office@<domain>`, `var.messaging_email_from_local_part`) |
| `/bitcrm/dev/messaging/email-domain` | `MESSAGING_EMAIL_DOMAIN` |
| `/bitcrm/dev/messaging/email-reply-domain` | `MESSAGING_EMAIL_REPLY_DOMAIN` (`<var.messaging_reply_subdomain>.<domain>`, default `reply.`) |
| `/bitcrm/dev/ses/configuration-set` | `SES_CONFIGURATION_SET` |
| `/bitcrm/dev/sqs/messaging-email-events/url` | `MESSAGING_EMAIL_EVENTS_QUEUE_URL` |
| `/bitcrm/dev/sqs/messaging-inbound-email/url` | `MESSAGING_INBOUND_EMAIL_QUEUE_URL` |

Rollout, once the owner has decided the domain (O12):

1. `cd infra/dev && terraform plan -var messaging_email_domain=<domain> -out tfplan`
   (add `-var messaging_reply_subdomain=…` / `-var messaging_email_from_local_part=…`
   / `-var messaging_mail_from_subdomain=…` to change the defaults `reply` /
   `office` / `mail`). Expect only the resources
   above plus the SSM parameters and two in-place updates of the messaging
   task role policy. Put the variables in a `*.auto.tfvars` so later plans
   keep them. Then `terraform apply tfplan`.
2. **DNS** — publish what `terraform output messaging_email_dns_records`
   prints, at the domain's registrar / zone (the identity stays *pending*
   until the DKIM CNAMEs resolve; SES checks for up to 72 h):
   - three `CNAME` `<token>._domainkey.<domain>` → `<token>.dkim.amazonses.com` (DKIM),
   - `MX <mailfrom>.<domain>` → `10 feedback-smtp.us-east-1.amazonses.com` and
     `TXT <mailfrom>.<domain>` → `v=spf1 include:amazonses.com ~all` (MAIL FROM / SPF),
   - `MX <reply>.<domain>` → `10 inbound-smtp.us-east-1.amazonaws.com` (replies into the inbox),
   - `TXT _dmarc.<domain>` → `v=DMARC1; p=none; rua=mailto:office@<domain>` (tighten to `quarantine` later).
   If the domain is a subdomain of `tech-slk.com` the records can go into the
   Route 53 zone `data.tf` already reads; that is a follow-up, not automated here.
3. **SES sandbox** — a new account can only mail verified addresses:
   request production access in the SES console (region us-east-1) before
   the first client mail. Also confirm the account's *one* active receipt
   rule set is the one applied here.
4. **Deploy** the messaging service; the task picks the six variables up
   from SSM. Verify: send an email from a conversation (`POST
   /conversations/:id/messages` with `channel: "email"`), watch the status
   walk `queued → sent → delivered`, reply from the client mailbox and see
   the line appear in the same thread. Bounces and complaints show up as
   `undelivered` / an opt-out banner.
5. **Settings** — `PUT /api/messaging/settings` with `companyName` (the
   display name) and, optionally, `companyEmail` on the verified domain (the
   `From`; an address elsewhere is ignored because SES would refuse it).

What is *not* in this rollout: the CRM has no `contacts/internal/by-emails`
route yet, so a first mail from an address the inbox has never seen opens an
`unknown` conversation (replies to our mails and mails from addresses we
have written to thread correctly through the reply token / `ADDR#`); the
messaging service probes the route and starts resolving contacts the moment
crm adds it.
