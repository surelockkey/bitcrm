# Step 0: Infrastructure — Only What Step 1 Needs

**Duration:** 1.5 weeks
**Goal:** Deploy CRM + Deal services to staging. Nothing else.
**Team:** Tech Lead + DevOps Engineer

---

## What Step 1 needs to work

```
Frontend (Vercel) → ALB (HTTPS) → ECS Fargate → DynamoDB + Redis + S3
                                       ↑
                                   Cognito (auth)
```

Step 1 = CRM service + Deal service + frontend dashboard. That's it.
Everything else (scheduling, inventory, telephony, etc.) gets its infra when its Step starts.

---

## EPIC 0.1 — AWS Account & Repos

**Duration:** 1 day

### Story 0.1.1 — AWS Account

| Task | Done when |
|------|-----------|
| Create staging AWS account | Account accessible |
| Create IAM admin user (no root usage) | Root MFA locked, admin user with MFA |
| Enable CloudTrail | API logging active |
| Set billing alert at $200/mo | Alert configured |
| Configure AWS CLI profile `staging` | `aws --profile staging sts get-caller-identity` works |

No production account yet — created before Step 4 (Go-Live).

### Story 0.1.2 — Git Repos

| Task | Done when |
|------|-----------|
| Create `infra` repo | Terraform structure, `.gitignore`, branch protection on `main` |
| Create `backend` monorepo | Workspace root with `services/crm/`, `services/deal/`, `packages/shared/` |
| Create `frontend` repo | Next.js initialized |
| Branch protection on all repos | `main`: require PR + 1 approval |

**Backend monorepo (Step 0 scope only):**

```
backend/
  ├── services/
  │   ├── crm/          ← Step 1
  │   └── deal/         ← Step 1
  ├── packages/
  │   └── shared/       (DynamoDB client, Redis client, auth middleware, error handling)
  ├── docker-compose.yml
  ├── Dockerfile
  ├── package.json
  └── turbo.json
```

New service folders added in future Steps as needed.

**Infra repo:**

```
infra/
  ├── modules/
  │   ├── vpc/
  │   ├── ecs/
  │   ├── alb/
  │   ├── dynamodb/
  │   ├── redis/
  │   ├── cognito/
  │   └── s3/
  ├── staging/
  │   ├── main.tf
  │   ├── variables.tf
  │   └── terraform.tfvars
  └── backend.tf        (S3 state backend)
```

Production folder added before Step 4.

### Story 0.1.3 — Terraform State Backend

| Task | Done when |
|------|-----------|
| Create S3 bucket `{project}-tf-state-staging` | Bucket exists, versioning on, encryption on |
| Create DynamoDB table `terraform-locks` | `LockID` partition key |
| Configure `backend.tf` | `terraform init` works, state in S3 |

---

## EPIC 0.2 — Networking & Compute

**Duration:** 2 days
**Depends on:** EPIC 0.1

### Story 0.2.1 — VPC

| Task | Done when |
|------|-----------|
| Terraform `vpc` module | Accepts CIDR, AZs, env name |
| VPC `10.0.0.0/16` | Created |
| 2 public subnets (2 AZs) | For ALB |
| 2 private subnets (2 AZs) | For ECS, Redis |
| NAT Gateway (single) | Private subnets can reach internet |
| Internet Gateway | ALB can receive traffic |
| VPC endpoints for DynamoDB + S3 | No NAT cost for AWS service traffic |
| Security groups: `alb-sg` (443 from internet), `ecs-sg` (from ALB only), `redis-sg` (6379 from ECS only) | Correct inbound/outbound rules |

### Story 0.2.2 — ECS Cluster

| Task | Done when |
|------|-----------|
| Terraform `ecs` module | Creates cluster + ECR repos |
| ECS Fargate cluster | Active in AWS |
| ECR repos: `crm-service`, `deal-service` | 2 repos, lifecycle: keep last 10 images |
| ECS task execution IAM role | Can pull ECR, write CloudWatch logs, read Secrets Manager |
| ECS task IAM role | Can access DynamoDB, S3, Redis |
| Cloud Map namespace `internal.local` | Service discovery for service-to-service calls |

Task definition per service: `0.25 vCPU / 0.5GB RAM`, health check `GET /health`, 1 desired task.

### Story 0.2.3 — ALB

| Task | Done when |
|------|-----------|
| Terraform `alb` module | Creates ALB, listeners, target groups |
| ACM certificate for `api-staging.example.com` | Validated via DNS |
| ALB in public subnets | Internet-facing |
| HTTPS listener (443) | Using ACM cert |
| HTTP listener (80) | Redirects to HTTPS |
| Route: `/api/crm/*` → crm-service | Target group with health check |
| Route: `/api/deals/*` → deal-service | Target group with health check |
| Route 53 A record → ALB | `api-staging.example.com` resolves |

Only 2 routes. New routes added via Terraform when new services are deployed in future Steps.

---

## EPIC 0.3 — Database & Storage

**Duration:** 1 day
**Depends on:** EPIC 0.2 (VPC exists)

### Story 0.3.1 — DynamoDB Tables (CRM + Deals only)

| Task | Done when |
|------|-----------|
| Terraform `dynamodb` module | Accepts table name, keys, GSIs |
| `CRM` table | PK/SK (String), on-demand, PITR enabled |
| CRM GSI: phone → contact lookup | `GSI1PK: PHONE#<number>` → `GSI1SK: CONTACT#<id>` |
| `Deals` table | PK/SK (String), on-demand, PITR enabled, DynamoDB Streams enabled |
| Deals GSI1: status → deals | `GSI1PK: STATUS#<stage>` → `GSI1SK: <date>#DEAL#<id>` |
| Deals GSI2: dispatcher → deals | `GSI2PK: DISPATCHER#<id>` → `GSI2SK: <date>#DEAL#<id>` |
| Deals GSI3: technician → deals | `GSI3PK: TECH#<id>` → `GSI3SK: <date>#DEAL#<id>` |

No Inventory, Scheduling, Telephony, Config tables yet. Created when needed.

### Story 0.3.2 — Redis

| Task | Done when |
|------|-----------|
| Terraform `redis` module | Accepts node type, subnet group |
| ElastiCache Redis: `cache.t3.micro`, single node | Running in private subnet |
| Security group: 6379 from ECS only | Verified |
| Store endpoint in SSM Parameter Store | `/app/staging/redis/endpoint` |

### Story 0.3.3 — S3

| Task | Done when |
|------|-----------|
| Terraform `s3` module | Accepts bucket name, CORS |
| `{project}-documents-staging` bucket | Created, public access blocked, encryption on |
| CORS configured | Allows PUT/GET from Vercel domain (for pre-signed uploads) |

One bucket. More buckets added in future Steps (recordings in Step 3, etc.).

---

## EPIC 0.4 — Auth

**Duration:** 1 day
**Can run in parallel with:** EPIC 0.3

### Story 0.4.1 — Cognito

| Task | Done when |
|------|-----------|
| Terraform `cognito` module | Creates user pool + app client |
| User Pool with email sign-in | Created |
| Password policy: 8+ chars, upper + lower + number | Configured |
| Custom attributes: `custom:role`, `custom:department`, `custom:user_id` | Attributes exist on pool |
| App client (no secret — SPA) | Access token 1hr, refresh 30d |
| Create Super Admin test user | Can sign in and get token with `custom:role = super_admin` |

Role values: `super_admin`, `admin`, `department_manager`, `dispatcher`, `technician`

### Story 0.4.2 — Auth Middleware (shared package)

| Task | Done when |
|------|-----------|
| `packages/shared/src/middleware/auth.ts` | Validates Cognito JWT using `aws-jwt-verify` |
| `authenticate` middleware | Extracts user from token → `req.user` |
| `requireRole(...roles)` helper | Returns 403 if user role not in allowed list |
| Unit tests | Valid token → pass, expired → 401, wrong role → 403, missing → 401 |
| Local dev bypass | `AUTH_DISABLED=true` → injects mock user (local only) |

### Story 0.4.3 — Secrets Manager

| Task | Done when |
|------|-----------|
| Create secret `{project}/staging/stripe` | Stripe test keys stored |
| Create secret `{project}/staging/redis` | Auth token stored |
| `packages/shared/src/config/secrets.ts` | Reads + caches secrets at startup |

---

## EPIC 0.5 — CI/CD

**Duration:** 1.5 days
**Depends on:** EPIC 0.2 (ECR exists)

### Story 0.5.1 — Backend CI (GitHub Actions)

| Task | Done when |
|------|-----------|
| `.github/workflows/ci.yml` | Triggers on PR to `main` |
| Steps: install → lint → typecheck → test → build | All run, failed step blocks merge |

### Story 0.5.2 — Backend Deploy (GitHub Actions)

| Task | Done when |
|------|-----------|
| `.github/workflows/deploy.yml` | Triggers on push to `main` |
| GitHub OIDC → AWS IAM role | No access keys in GitHub |
| Build Docker image, tag with git SHA | Pushed to ECR |
| Update ECS task definition + deploy | Service running new image |
| Changed-service detection | Only rebuilds services with changed files |

### Story 0.5.3 — Terraform CI (GitHub Actions)

| Task | Done when |
|------|-----------|
| `.github/workflows/terraform.yml` | PR → `terraform plan` as comment. Merge → `terraform apply` staging |

### Story 0.5.4 — Vercel

| Task | Done when |
|------|-----------|
| Connect frontend repo to Vercel | Auto-deploys on push |
| Set `NEXT_PUBLIC_API_URL` env var | Points to `api-staging.example.com` |
| Preview deployments on PRs | Each PR gets a unique URL |

---

## EPIC 0.6 — Service Scaffold & Verify

**Duration:** 2 days
**Depends on:** Everything above

### Story 0.6.1 — Shared Package

| Task | Done when |
|------|-----------|
| Turborepo workspace configured | `npm run build` builds everything |
| `packages/shared` — DynamoDB client | Configured `DynamoDBDocumentClient`, exported as singleton |
| `packages/shared` — Redis client | `ioredis`, reads endpoint from env, auto-reconnect |
| `packages/shared` — BullMQ factory | `createQueue(name)`, `createWorker(name, handler)` |
| `packages/shared` — error classes | `AppError`, `NotFoundError`, `ValidationError`, `ForbiddenError` |
| `packages/shared` — response helpers | `success(data)`, `paginated(items, cursor)`, `error(err)` |
| `packages/shared` — logger | JSON to stdout: `{ msg, service, timestamp }` |
| `packages/shared` — env validation | Zod schema, fails fast if required vars missing |

### Story 0.6.2 — CRM Service Skeleton

| Task | Done when |
|------|-----------|
| `services/crm/` from template | Express + TypeScript, `GET /health`, `GET /api/crm/ping` |
| Dockerfile | Multi-stage build, non-root user |
| Connects to DynamoDB | Ping route does a read from CRM table |
| Connects to Redis | Ping route does a `PING` |

### Story 0.6.3 — Deploy & Verify End-to-End

| Task | Done when |
|------|-----------|
| Push CRM skeleton to `main` | GitHub Actions builds + deploys to ECS |
| `curl https://api-staging.example.com/api/crm/ping` → 200 | ALB → ECS → response works |
| Request without Cognito token → 401 | Auth middleware active |
| Request with valid token → 200 | Auth works end-to-end |
| CRM service reads DynamoDB | Verified in ping response |
| CRM service reads Redis | Verified in ping response |
| Frontend on Vercel calls API → shows response | Full stack connected |

### Story 0.6.4 — Local Dev Environment

| Task | Done when |
|------|-----------|
| `docker-compose.yml`: DynamoDB Local + Redis | `docker compose up -d` starts both |
| `scripts/setup-local-db.sh` | Creates CRM + Deals tables in local DynamoDB |
| `scripts/seed.sh` | Inserts sample contacts + deals |
| `.env.local` template | All vars pointing to localhost |
| `AUTH_DISABLED=true` in local | Skips Cognito, injects mock user |
| Hot reload with `tsx watch` | Save → restart |
| `README.md` | Clone → install → `docker compose up` → `npm run dev` in < 10 min |

---

## Done Criteria — Step 0 Complete

| # | Check |
|---|-------|
| 1 | `terraform plan` → 0 changes (staging fully applied) |
| 2 | CRM skeleton deployed and responding via HTTPS |
| 3 | Cognito auth blocks unauthenticated requests |
| 4 | DynamoDB CRM + Deals tables exist with GSIs |
| 5 | Redis accessible from ECS |
| 6 | S3 bucket exists, pre-signed upload works |
| 7 | GitHub Actions: PR → CI, merge → deploy to staging |
| 8 | Vercel frontend calls backend API successfully |
| 9 | Local dev runs in < 10 minutes for new developer |

Step 1 starts immediately after — building CRM and Deal features on top of this foundation.
