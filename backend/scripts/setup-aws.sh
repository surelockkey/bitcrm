#!/usr/bin/env bash
set -e

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"

BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

run_for() {
  local svc="$1"
  echo -e "\n${BOLD}${BLUE}▸ ${svc}${NC}"
  (cd "$BACKEND_DIR/services/$svc" && npm run setup:aws --silent)
}

echo -e "${BOLD}Provisioning AWS resources for all services${NC}"
run_for user
run_for crm
run_for deal
run_for inventory

echo -e "\n${BOLD}All services provisioned.${NC}"
