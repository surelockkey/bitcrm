# Deploying telephony-service

This is the first deploy of a **new** service, so it needs one-time AWS and
Twilio setup before the pipeline can do its job. The GitHub Actions workflow
only builds an image, registers a task definition, and updates an ECS service —
every one of those AWS resources has to exist first, and it comes from Terraform.

Order matters: **Terraform → GitHub secrets → merge → Twilio**. The Twilio
console needs the public URL, which only exists once the ALB rule is live.

## 1. Terraform (creates the service's infrastructure)

Already committed under `backend/infra/dev`:

| Resource | What it is |
|---|---|
| `local.services.telephony` | ECR repo, ECS service, ALB target group + listener rule for `/api/telephony/*` (priority 600), and the `bitcrm-dev-telephony-{exec,task}` IAM roles |
| `local.ddb_tables.calls` | `bitcrm-dev-calls`, PK/SK + `AgentIndex` (GSI1) + `AllCallsIndex` (GSI2) |
| `sns_sqs.topics.call-events` | `call.started` / `call.completed` / `call.recording_ready` |
| `task_telephony` policy | DDB calls (+ indexes), `UpdateTable` for the boot schema check, SNS publish, SSM read |

```bash
cd backend/infra/dev
terraform init
terraform plan -out tfplan     # expect ~15 additions, 0 changes, 0 destroys
terraform apply tfplan
```

The plan **must not** show changes to existing services. If it wants to modify
another service's target group or listener rule, stop — ALB rule priorities
collide (telephony claims 600; user/crm/deal/inventory/search hold 100–500).

Terraform writes `/bitcrm/dev/dynamodb/calls/table-name` and
`/bitcrm/dev/sns/call-events/arn` to SSM. `render-taskdef.sh` turns those into
`CALLS_TABLE` and `CALL_EVENTS_TOPIC_ARN` automatically — no manual env wiring.

## 2. GitHub secrets

The deploy job runs in the `dev` environment, so set these on that environment
(Settings → Environments → dev), or repo-wide if that's the existing convention:

| Secret | Where to find it | Consequence if missing |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio console home (`AC…`) | no outbound calls, no webhooks validated |
| `TWILIO_AUTH_TOKEN` | Twilio console home | signature validation fails → all webhooks 403 |
| `TWILIO_API_KEY` | Account → API keys (`SK…`) | access tokens can't be minted → softphone never connects |
| `TWILIO_API_SECRET` | shown **once** when the key is created | same as above |
| `TWILIO_TWIML_APP_SID` | Voice → TwiML Apps (`AP…`) | outbound dialling from the browser fails |

Optional repo/environment **variable** (not a secret): `TWILIO_CALLER_ID`, an
E.164 default caller ID. Unset → the service falls back to the account's first
owned number.

The renderer skips any Twilio value that is empty, so a half-configured
environment degrades rather than overwriting good values with `""`. It also
sets `PUBLIC_BASE_URL` from the SSM app domain — do not set it by hand.

## 3. Deploy

Merging to `main` triggers `.github/workflows/deploy-dev.yml`. Note that the
workflow file itself is in the `shared` path filter, so this merge redeploys
**every** service, not just telephony. That is the existing design; expect six
parallel deploy jobs.

Verify:

```bash
curl -s https://api.bitcrm.tech-slk.com/api/telephony/health | jq
aws ecs describe-services --cluster bitcrm-dev \
  --services bitcrm-dev-telephony \
  --query 'services[0].{running:runningCount,desired:desiredCount}'
```

## 4. Twilio console (needs the live URL from step 3)

Base URL: `https://api.bitcrm.tech-slk.com/api/telephony`

1. **TwiML App** (Voice → TwiML Apps → your app):
   - Voice Request URL → `<base>/voice/outbound`, method `POST`
2. **Each phone number** (Phone Numbers → Manage → Active numbers):
   - A call comes in → Webhook → `<base>/voice/inbound`, method `POST`
   - Call status changes → `<base>/voice/status`, method `POST`
   - Settings › Phone numbers in the app does this for you on purchase; existing
     numbers bought outside the app need it set manually.

Webhook routes are `@Public()` (no Cognito) and authenticated by the
`X-Twilio-Signature` guard, which recomputes the signature over
`PUBLIC_BASE_URL + originalUrl`. If that env var doesn't exactly match the URL
Twilio calls — scheme, host, no trailing slash — **every webhook 403s**. That is
the single most common cause of "the phone rings but nothing appears in the CRM".

## 5. Smoke test

1. Sign in, open the softphone in the app header, go online.
2. Call one of the workspace numbers from a mobile → the browser should ring.
3. Answer, talk, hang up → the call appears in **Calls** with a duration, and a
   recording once Twilio finishes processing it.
4. `GET /api/telephony/calls/stream` should stay open (SSE) — if it closes
   immediately, check the ALB idle timeout and that nginx-style buffering is off.

## Rollback

```bash
aws ecs update-service --cluster bitcrm-dev --service bitcrm-dev-telephony \
  --task-definition <previous-task-def-arn> --force-new-deployment
```

Telephony is self-contained: no other service reads the calls table or consumes
`call-events` yet, so rolling it back (or scaling it to zero) only disables the
softphone and the calls page. The frontend degrades to "No access"-style empty
states rather than erroring.
