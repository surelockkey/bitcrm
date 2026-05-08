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
# Service-friendly aliases derived from SSM (so service code can do
# process.env.USERS_TABLE rather than process.env.DYNAMODB_USERS_TABLE_NAME)
SSM_ALIASES_JSON=$(echo "$SSM_ENV_JSON" | jq '
  . as $orig |
  reduce .[] as $e ([]; . +
    (
      # DynamoDB table aliases: DYNAMODB_<X>_TABLE_NAME -> <X>_TABLE
      if ($e.name | test("^DYNAMODB_.*_TABLE_NAME$")) then
        [{name: ($e.name | sub("^DYNAMODB_"; "") | sub("_TABLE_NAME$"; "_TABLE")), value: $e.value}]
      # SNS aliases: SNS_<X>_ARN -> <X>_TOPIC_ARN  (- becomes _ already)
      elif ($e.name | test("^SNS_.*_ARN$")) then
        [{name: ($e.name | sub("^SNS_"; "") | sub("_ARN$"; "_TOPIC_ARN")), value: $e.value}]
      # SQS URL aliases: SQS_<X>_URL -> <X>_QUEUE_URL
      elif ($e.name | test("^SQS_.*_URL$")) then
        [{name: ($e.name | sub("^SQS_"; "") | sub("_URL$"; "_QUEUE_URL")), value: $e.value}]
      else [] end
    )
  )
')

# Derive API_GATEWAY_URL from the public app domain in SSM so per-service
# Swagger docs report the right server (not localhost:4000).
APP_DOMAIN=$(echo "$SSM_ENV_JSON" | jq -r '.[] | select(.name == "APP_DOMAIN") | .value')
API_GATEWAY_URL=""
if [[ -n "$APP_DOMAIN" && "$APP_DOMAIN" != "null" ]]; then
  API_GATEWAY_URL="https://${APP_DOMAIN}"
fi

EXTRA_ENV_JSON=$(jq -n \
  --arg port "$PORT" \
  --arg port_env "$PORT_ENV" \
  --arg service "$SERVICE" \
  --arg git_sha "${GIT_SHA:-unknown}" \
  --arg jwt_key "${JWT_SIGNING_KEY:-}" \
  --arg cognito_secret "${COGNITO_CLIENT_SECRET:-}" \
  --arg internal_token "${INTERNAL_SERVICE_TOKEN:-}" \
  --arg api_gateway_url "$API_GATEWAY_URL" \
  '
  [
    {name: "NODE_ENV",      value: "production"},
    {name: "AWS_REGION",    value: "us-east-1"},
    {name: "SERVICE_NAME",  value: ($service + "-service")},
    {name: $port_env,       value: $port},
    {name: "GIT_SHA",       value: $git_sha}
  ]
  + (if $api_gateway_url != "" then [{name: "API_GATEWAY_URL",        value: $api_gateway_url}] else [] end)
  + (if $jwt_key         != "" then [{name: "JWT_SIGNING_KEY",        value: $jwt_key}]         else [] end)
  + (if $cognito_secret  != "" then [{name: "COGNITO_CLIENT_SECRET",  value: $cognito_secret}]  else [] end)
  + (if $internal_token  != "" then [{name: "INTERNAL_SERVICE_TOKEN", value: $internal_token}]  else [] end)
  ')

# 3. Merge SSM + aliases + extra env
ALL_ENV_JSON=$(jq -s '.[0] + .[1] + .[2]' <(echo "$SSM_ENV_JSON") <(echo "$SSM_ALIASES_JSON") <(echo "$EXTRA_ENV_JSON"))

# 4. Substitute placeholders in template, inject environment array
sed \
  -e "s|\${IMAGE}|${IMAGE}|g" \
  -e "s|\${EXECUTION_ROLE_ARN}|${EXECUTION_ROLE_ARN}|g" \
  -e "s|\${TASK_ROLE_ARN}|${TASK_ROLE_ARN}|g" \
  "$TEMPLATE" | \
jq --argjson env "$ALL_ENV_JSON" '.containerDefinitions[0].environment = $env'
