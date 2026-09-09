# Monitoring

Prometheus + Grafana + Tempo + Loki, all behind the `monitoring` compose profile.

```bash
npm run docker:up            # app infra
npm run docker:monitoring    # + prometheus, grafana, tempo, loki, exporters, promtail
npm run dev                  # the six services (on the host, not in docker)
npm run check:monitoring     # fails if a service exists that nothing scrapes
```

| UI         | URL                     | Login       |
| ---------- | ----------------------- | ----------- |
| Grafana    | http://localhost:3001   | admin/admin |
| Prometheus | http://localhost:9090   | —           |

## What is covered

Every service under `backend/services/` is scraped at `/<prefix>/metrics`, probed
at `/<prefix>/health`, traced into Tempo, and shipped into Loki:

| Service    | Port | Metrics                   |
| ---------- | ---- | ------------------------- |
| user       | 4001 | `/api/users/metrics`      |
| crm        | 4002 | `/api/crm/metrics`        |
| deal       | 4003 | `/api/deals/metrics`      |
| inventory  | 4004 | `/api/inventory/metrics`  |
| search     | 4005 | `/api/search/metrics`     |
| telephony  | 4006 | `/api/telephony/metrics`  |

Plus `redis-exporter`, `opensearch-exporter`, `nginx-exporter` (the gateway),
blackbox HTTP probes of every health endpoint, blackbox TCP probes of
DynamoDB Local / LocalStack / Redis / OpenSearch, and Prometheus, Loki and
Tempo scraping themselves.

`scripts/verify-monitoring.mjs` discovers services from the filesystem and fails
if one is not scraped and probed, so a service added later cannot silently go
unmonitored the way search and telephony did. It runs as part of
`npm run test:unit`.

## The three signals

- **Metrics** — `MetricsModule.forRoot()` in each `app.module.ts`. Shared
  business metrics live in `BusinessMetricsService`.
- **Traces** — `initTracing()` at the top of each `main.ts`, OTLP →
  `OTEL_EXPORTER_OTLP_ENDPOINT` (Tempo, :4318).
- **Logs** — two paths into Loki. Host-run Node services push directly via the
  `pino-loki` transport, enabled by setting `LOKI_URL`; container logs are
  tailed by Promtail. Both label streams `service=…`, so one Grafana query
  spans them. Log lines carry `traceId`, which the Loki datasource turns into a
  Tempo link.

Leaving `LOKI_URL` unset is supported and is the default in `.env.example`
consumers who do not run the monitoring profile: logs stay on stdout and
nothing else changes.

## Known local-dev caveat: which Redis is measured

`redis-exporter` watches the **docker** `redis-local` container. On a machine
that also runs a native Redis, the native one owns `127.0.0.1:6379` and the
services connect to *that*, while docker's binds the wildcard address. The
Redis dashboard then describes an instance nothing is using.

A container cannot reach a loopback-only listener on the host, so there is no
config fix from inside compose. Two honest options:

- Stop the native Redis and let the services use the docker one, or
- read `bitcrm_dependency_up{kind="redis"}` on the **Dependency Status**
  dashboard, which is measured by each service against the Redis it actually
  connects to.

## Deployed environments (Grafana Cloud)

Local uses the compose stack above; `bitcrm-dev` on ECS pushes to Grafana Cloud
instead. Pull does not work there and the reason is worth knowing: Service
Connect uses an **HTTP** namespace, so `http://user:4001` resolves through the
Envoy sidecar and load-balances across tasks — a central Prometheus would scrape
a different task on every scrape. Tasks also run on `FARGATE_SPOT`, so their IPs
churn. Everything therefore pushes.

| Signal | Path | Sidecar |
| --- | --- | --- |
| Metrics | Alloy scrapes `127.0.0.1:<port>` and remote-writes | yes, one |
| Traces | OTLP straight from the app | no |
| Logs | `pino-loki` straight from the app | no |

Only metrics need an agent, because prom-client is pull-only. Under `awsvpc` a
sidecar shares the task's network namespace, so it scrapes over loopback and
needs no service discovery at all.

### Configuration

`scripts/render-taskdef.sh` adds the sidecar and the telemetry env only when
`GRAFANA_CLOUD_TOKEN` is set **and** a remote-write endpoint is configured.
Without them it renders byte-for-byte the task definition it always did, so the
code ships safely ahead of the credentials.

The token is the only secret; it lives in the GitHub `dev` environment as
`GRAFANA_CLOUD_TOKEN`. Everything else is a public endpoint or a numeric
instance id and rides the SSM auto-mapping (`/bitcrm/dev/<path>` → `ENV_VAR`):

| SSM parameter | Env var |
| --- | --- |
| `/bitcrm/dev/prom/remote-write-url` | `PROM_REMOTE_WRITE_URL` |
| `/bitcrm/dev/prom/username` | `PROM_USERNAME` |
| `/bitcrm/dev/loki/url` | `LOKI_URL` |
| `/bitcrm/dev/loki/username` | `LOKI_USERNAME` |
| `/bitcrm/dev/otlp/endpoint` | `OTLP_ENDPOINT` |
| `/bitcrm/dev/otlp/username` | `OTLP_USERNAME` |

Two details that are easy to get wrong and fail silently:

- Each signal has its **own** numeric username. Reusing one across all three is
  a 401, and `pino-loki` runs with `silenceErrors` so it looks like success.
- Alloy labels each task with `constants.hostname` (the ECS task id). Without
  it every task of a service reports the same `instance`, and remote-write
  rejects the colliding samples as out-of-order.

### The bitcrm-dev stack

| | |
| --- | --- |
| Grafana | https://greencranberry2695.grafana.net |
| Region | `prod-eu-west-2` (the workload is `us-east-1`; telemetry crosses regions) |
| Prometheus | `prometheus-prod-65-prod-eu-west-2` · user `3572362` |
| Loki | `logs-prod-012` · user `1781856` |
| Traces | `otlp-gateway-prod-eu-west-2` · user `1824069` |

The trace username is the **stack** id, not the Tempo instance id: traces go
through the shared OTLP gateway, and posting to the Tempo host directly answers
404. Verified against both.

### Importing dashboards and alerts

```bash
# Alert rules -> Mimir ruler. Uses the same access-policy token as the sidecar.
PROM_BASE_URL=https://prometheus-prod-65-prod-eu-west-2.grafana.net \
PROM_USERNAME=3572362 GRAFANA_CLOUD_TOKEN=<token> \
  bash scripts/import-alerts.sh            # --list to show what is loaded

# Dashboards -> the Grafana instance.
GRAFANA_URL=https://greencranberry2695.grafana.net GRAFANA_TOKEN=<sa token> \
  bash scripts/import-grafana.sh           # --dry-run to preview, --local to smoke-test
```

Two different credentials, and they are not interchangeable. The access-policy
token authenticates to the Prometheus/Loki/Tempo endpoints; the Grafana
instance API rejects it with `Invalid API key` and needs a **service account**
token instead (Grafana UI -> Administration -> Users and access -> Service
accounts, Editor role). Both scripts are idempotent.

## Dashboards

`grafana/dashboards/*.json`, auto-provisioned. Service-scoped ones drive their
dropdown off `label_values(http_requests_total, service)`, so a newly scraped
service appears without editing the dashboard.

Overview · HTTP Deep Dive · Node.js Runtime · Health & Uptime · Dependency
Status · Events & Messaging · Business Metrics · Tracing · Redis · Search ·
Telephony · API Gateway · Logs · Load Balancer

Two are environment-specific. **API Gateway** reads nginx and is local-only —
there is no nginx in AWS. **Load Balancer** is its deployed counterpart, reads
`AWS/ApplicationELB`, and needs a CloudWatch datasource in Grafana. The import
script skips the gateway dashboard for that reason.
