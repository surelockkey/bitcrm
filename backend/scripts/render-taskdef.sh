#!/usr/bin/env bash
# Render an ECS task definition for the given service.
#
# Required env vars (typically provided by the GH Actions workflow):
#   SERVICE              - user | crm | deal | inventory
#   IMAGE                - full ECR image URI with tag
#   EXECUTION_ROLE_ARN   - ECS task execution role ARN
#   TASK_ROLE_ARN        - per-service task role ARN
#
# Optional env vars (GitHub Secrets, injected at deploy time):
#   JWT_SIGNING_KEY
#   COGNITO_CLIENT_SECRET
#   INTERNAL_SERVICE_TOKEN
#   GIT_SHA              - commit SHA for /health version reporting
#
# All non-secret runtime config is read from SSM Parameter Store under /bitcrm/dev/.
# SSM path -> env var: /bitcrm/dev/x/y-z  ==>  X_Y_Z
#
# Output: rendered task definition JSON to stdout.

set -euo pipefail

: "${SERVICE:?SERVICE is required (user|crm|deal|inventory)}"
: "${IMAGE:?IMAGE is required}"
: "${EXECUTION_ROLE_ARN:?EXECUTION_ROLE_ARN is required}"
: "${TASK_ROLE_ARN:?TASK_ROLE_ARN is required}"

case "$SERVICE" in
  user)      PORT=4001; PORT_ENV=USER_SERVICE_PORT ;;
  crm)       PORT=4002; PORT_ENV=CRM_SERVICE_PORT ;;
  deal)      PORT=4003; PORT_ENV=DEAL_SERVICE_PORT ;;
  inventory) PORT=4004; PORT_ENV=INVENTORY_SERVICE_PORT ;;
  *) echo "unknown service: $SERVICE" >&2; exit 1 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEMPLATE="${REPO_ROOT}/backend/services/${SERVICE}/taskdef.json"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "taskdef template not found: $TEMPLATE" >&2
  exit 1
fi

# 1. SSM-derived env (auto-named from path)
SSM_ENV_JSON=$(aws ssm get-parameters-by-path \
  --path /bitcrm/dev/ \
  --recursive \
  --query 'Parameters[].[Name,Value]' \
  --output json | \
  jq 'map({
    name: (.[0] | sub("^/bitcrm/dev/"; "") | gsub("[/-]"; "_") | ascii_upcase),
    value: .[1]
  })')

# 2. Static + secret env vars
EXTRA_ENV_JSON=$(jq -n \
  --arg port "$PORT" \
  --arg port_env "$PORT_ENV" \
  --arg service "$SERVICE" \
  --arg git_sha "${GIT_SHA:-unknown}" \
  --arg jwt_key "${JWT_SIGNING_KEY:-}" \
  --arg cognito_secret "${COGNITO_CLIENT_SECRET:-}" \
  --arg internal_token "${INTERNAL_SERVICE_TOKEN:-}" \
  '
  [
    {name: "NODE_ENV",      value: "production"},
    {name: "AWS_REGION",    value: "us-east-1"},
    {name: "SERVICE_NAME",  value: ($service + "-service")},
    {name: $port_env,       value: $port},
    {name: "GIT_SHA",       value: $git_sha}
  ]
  + (if $jwt_key        != "" then [{name: "JWT_SIGNING_KEY",        value: $jwt_key}]        else [] end)
  + (if $cognito_secret != "" then [{name: "COGNITO_CLIENT_SECRET",  value: $cognito_secret}]  else [] end)
  + (if $internal_token != "" then [{name: "INTERNAL_SERVICE_TOKEN", value: $internal_token}] else [] end)
  ')

# 3. Merge SSM + extra env
ALL_ENV_JSON=$(jq -s '.[0] + .[1]' <(echo "$SSM_ENV_JSON") <(echo "$EXTRA_ENV_JSON"))

# 4. Substitute placeholders in template, inject environment array
sed \
  -e "s|\${IMAGE}|${IMAGE}|g" \
  -e "s|\${EXECUTION_ROLE_ARN}|${EXECUTION_ROLE_ARN}|g" \
  -e "s|\${TASK_ROLE_ARN}|${TASK_ROLE_ARN}|g" \
  "$TEMPLATE" | \
jq --argjson env "$ALL_ENV_JSON" '.containerDefinitions[0].environment = $env'
