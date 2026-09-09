#!/usr/bin/env bash
# Emit the Grafana Alloy metrics-sidecar container definition as JSON.
#
# Kept out of render-taskdef.sh so both stay readable, and out of the six
# taskdef.json templates so the sidecar is defined exactly once.
#
# Required env:
#   SERVICE                - user | crm | deal | inventory | search | telephony
#   APP_PORT               - the app container's port
#   APP_METRICS_PATH       - e.g. /api/users/metrics
#   PROM_REMOTE_WRITE_URL  - Grafana Cloud Prometheus push endpoint
#   PROM_USERNAME          - numeric Prometheus instance id
#   GRAFANA_CLOUD_TOKEN    - access-policy token (the basic-auth password)
#   ALLOY_CONFIG_FILE      - path to monitoring/alloy/ecs.alloy
#
# Output: a one-element JSON array on stdout, ready to concatenate onto
# .containerDefinitions.

set -euo pipefail

for v in SERVICE APP_PORT APP_METRICS_PATH PROM_REMOTE_WRITE_URL PROM_USERNAME \
         GRAFANA_CLOUD_TOKEN ALLOY_CONFIG_FILE; do
  if [[ -z "${!v:-}" ]]; then
    echo "render-alloy-sidecar: $v is required" >&2
    exit 1
  fi
done

# Fargate gives a task no volume to mount a config from, so Alloy's config
# travels in the environment and is written to /tmp at start-up. --storage.path
# also has to live under /tmp: the image's default WAL directory is not
# writable on a read-only-ish task filesystem.
START_CMD='printf "%s" "$ALLOY_CONFIG" > /tmp/config.alloy && exec /bin/alloy run /tmp/config.alloy --storage.path=/tmp/alloy --server.http.listen-addr=127.0.0.1:12345'

jq -n \
  --arg config    "$(cat "$ALLOY_CONFIG_FILE")" \
  --arg port      "$APP_PORT" \
  --arg mpath     "$APP_METRICS_PATH" \
  --arg promurl   "$PROM_REMOTE_WRITE_URL" \
  --arg promuser  "$PROM_USERNAME" \
  --arg token     "$GRAFANA_CLOUD_TOKEN" \
  --arg loggroup  "/ecs/bitcrm-dev-${SERVICE}" \
  --arg startcmd  "$START_CMD" \
  '[{
     name: "alloy",
     image: "grafana/alloy:v1.5.1",
     essential: false,
     entryPoint: ["/bin/sh", "-c"],
     command: [$startcmd],
     environment: [
       {name: "ALLOY_CONFIG",          value: $config},
       {name: "APP_PORT",              value: $port},
       {name: "APP_METRICS_PATH",      value: $mpath},
       {name: "PROM_REMOTE_WRITE_URL", value: $promurl},
       {name: "PROM_USERNAME",         value: $promuser},
       {name: "GRAFANA_CLOUD_TOKEN",   value: $token},
       {name: "DEPLOY_ENV",            value: "dev"}
     ],
     logConfiguration: {
       logDriver: "awslogs",
       options: {
         "awslogs-group": $loggroup,
         "awslogs-region": "us-east-1",
         "awslogs-stream-prefix": "alloy"
       }
     }
   }]'
