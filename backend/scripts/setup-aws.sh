#!/usr/bin/env bash
set -e

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"

BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

run_for() {
  local svc="$1"
  local script="${2:-setup:aws}"
  echo -e "\n${BOLD}${BLUE}▸ ${svc}${NC}"
  (cd "$BACKEND_DIR/services/$svc" && npm run "$script" --silent)
}

echo -e "${BOLD}Provisioning AWS resources for all services${NC}"
run_for user
run_for crm
run_for deal
run_for inventory
run_for search
# telephony provisions DynamoDB rather than SNS/SQS; its topic is optional.
run_for telephony setup:dynamodb

echo -e "\n${BOLD}All services provisioned.${NC}"
