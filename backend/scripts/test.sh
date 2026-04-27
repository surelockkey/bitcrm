#!/usr/bin/env bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Track results
PASSED=0
FAILED=0
SKIPPED=0
TOTAL_TESTS=0
TOTAL_SUITES=0
FAILURES=()

print_header() {
  echo ""
  echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}${BLUE}  $1${NC}"
  echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_section() {
  echo ""
  echo -e "  ${CYAN}${BOLD}$1${NC}"
  echo -e "  ${DIM}$2${NC}"
  echo ""
}

run_tests() {
  local name="$1"
  local dir="$2"
  local cmd="$3"
  local type="$4"

  print_section "$name" "$dir"

  local output
  local exit_code=0
  output=$(cd "$dir" && eval "$cmd" 2>&1) || exit_code=$?

  # Extract test counts from Jest output
  local suites_line=$(echo "$output" | grep "Test Suites:" | tail -1)
  local tests_line=$(echo "$output" | grep "Tests:" | tail -1)

  if [ $exit_code -eq 0 ]; then
    local suite_count=$(echo "$suites_line" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
    local test_count=$(echo "$tests_line" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
    suite_count=${suite_count:-0}
    test_count=${test_count:-0}

    echo -e "    ${GREEN}PASS${NC}  ${suite_count} suites, ${test_count} tests"
    PASSED=$((PASSED + 1))
    TOTAL_TESTS=$((TOTAL_TESTS + test_count))
    TOTAL_SUITES=$((TOTAL_SUITES + suite_count))
  else
    # Check if it was skipped (no tests found)
    if echo "$output" | grep -q "No tests found\|No test suites found\|passWithNoTests"; then
      echo -e "    ${YELLOW}SKIP${NC}  No tests found"
      SKIPPED=$((SKIPPED + 1))
    else
      local fail_count=$(echo "$tests_line" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+')
      local pass_count=$(echo "$tests_line" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
      fail_count=${fail_count:-0}
      pass_count=${pass_count:-0}

      echo -e "    ${RED}FAIL${NC}  ${fail_count} failed, ${pass_count} passed"
      FAILED=$((FAILED + 1))
      FAILURES+=("$name")
      TOTAL_TESTS=$((TOTAL_TESTS + pass_count))

      # Show failure details
      echo "$output" | grep -A 3 "●" | head -20 | sed 's/^/    /'
    fi
  fi
}

# Parse args
RUN_UNIT=false
RUN_INTEGRATION=false
RUN_E2E=false
COVERAGE=false

if [ $# -eq 0 ]; then
  RUN_UNIT=true
  RUN_INTEGRATION=true
  RUN_E2E=true
fi

for arg in "$@"; do
  case $arg in
    unit)       RUN_UNIT=true ;;
    integration) RUN_INTEGRATION=true ;;
    e2e)        RUN_E2E=true ;;
    --coverage) COVERAGE=true ;;
    all)        RUN_UNIT=true; RUN_INTEGRATION=true; RUN_E2E=true ;;
    *)          echo "Usage: $0 [unit|integration|e2e|all] [--coverage]"; exit 1 ;;
  esac
done

COVERAGE_FLAG=""
if [ "$COVERAGE" = true ]; then
  COVERAGE_FLAG="--coverage"
fi

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"

print_header "BitCRM Test Runner"
echo -e "  ${DIM}Running: $([ "$RUN_UNIT" = true ] && echo "unit ")$([ "$RUN_INTEGRATION" = true ] && echo "integration ")$([ "$RUN_E2E" = true ] && echo "e2e ")$([ "$COVERAGE" = true ] && echo "(with coverage)")${NC}"

# ═══════════════════════════════════════
# UNIT TESTS
# ═══════════════════════════════════════
if [ "$RUN_UNIT" = true ]; then
  print_header "Unit Tests"

  run_tests \
    "@bitcrm/shared" \
    "$BACKEND_DIR/packages/shared" \
    "npx jest --silent $COVERAGE_FLAG" \
    "unit"

  run_tests \
    "user-service" \
    "$BACKEND_DIR/services/user" \
    "npx jest test/unit/ --silent $COVERAGE_FLAG" \
    "unit"

  run_tests \
    "crm-service" \
    "$BACKEND_DIR/services/crm" \
    "npx jest test/unit/ --silent $COVERAGE_FLAG" \
    "unit"

  run_tests \
    "deal-service" \
    "$BACKEND_DIR/services/deal" \
    "npx jest test/unit/ --silent $COVERAGE_FLAG" \
    "unit"

  run_tests \
    "inventory-service" \
    "$BACKEND_DIR/services/inventory" \
    "npx jest --silent --passWithNoTests $COVERAGE_FLAG" \
    "unit"
fi

# Helper: ensure Docker test containers are running and flush stale data
ensure_test_infra() {
  if ! docker compose -f "$BACKEND_DIR/docker-compose.yml" --profile test ps --status running 2>/dev/null | grep -q "dynamodb-test"; then
    echo -e "  ${YELLOW}Starting test containers...${NC}"
    docker compose -f "$BACKEND_DIR/docker-compose.yml" --profile test up -d dynamodb-test 2>/dev/null || true
    sleep 2
  fi

  # Delete and recreate the test DynamoDB table for a clean slate
  echo -e "  ${DIM}Resetting test database...${NC}"
  aws dynamodb delete-table --table-name BitCRM_Users_Test \
    --endpoint-url http://localhost:8001 --region us-east-1 \
    --no-cli-pager 2>/dev/null || true
  aws dynamodb create-table --table-name BitCRM_Users_Test \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S \
      AttributeName=GSI1SK,AttributeType=S \
      AttributeName=GSI2PK,AttributeType=S \
      AttributeName=GSI2SK,AttributeType=S \
    --global-secondary-indexes \
      'IndexName=RoleIndex,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
      'IndexName=DepartmentIndex,KeySchema=[{AttributeName=GSI2PK,KeyType=HASH},{AttributeName=GSI2SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url http://localhost:8001 --region us-east-1 \
    --no-cli-pager 2>/dev/null || true

  # Reset inventory test table
  echo -e "  ${DIM}Resetting inventory test database...${NC}"
  aws dynamodb delete-table --table-name BitCRM_Inventory_Test \
    --endpoint-url http://localhost:8001 --region us-east-1 \
    --no-cli-pager 2>/dev/null || true
  aws dynamodb create-table --table-name BitCRM_Inventory_Test \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S \
      AttributeName=GSI1SK,AttributeType=S \
      AttributeName=GSI2PK,AttributeType=S \
      AttributeName=GSI2SK,AttributeType=S \
      AttributeName=GSI3PK,AttributeType=S \
      AttributeName=GSI3SK,AttributeType=S \
      AttributeName=GSI4PK,AttributeType=S \
      AttributeName=GSI4SK,AttributeType=S \
    --global-secondary-indexes \
      'IndexName=CategoryIndex,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
      'IndexName=TypeIndex,KeySchema=[{AttributeName=GSI2PK,KeyType=HASH},{AttributeName=GSI2SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
      'IndexName=OwnerIndex,KeySchema=[{AttributeName=GSI3PK,KeyType=HASH},{AttributeName=GSI3SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
      'IndexName=TransferEntityIndex,KeySchema=[{AttributeName=GSI4PK,KeyType=HASH},{AttributeName=GSI4SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url http://localhost:8001 --region us-east-1 \
    --no-cli-pager 2>/dev/null || true

  # Reset deal test table
  echo -e "  ${DIM}Resetting deal test database...${NC}"
  aws dynamodb delete-table --table-name BitCRM_Deals_Test \
    --endpoint-url http://localhost:8001 --region us-east-1 \
    --no-cli-pager 2>/dev/null || true
  aws dynamodb create-table --table-name BitCRM_Deals_Test \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S \
      AttributeName=GSI1SK,AttributeType=S \
      AttributeName=GSI2PK,AttributeType=S \
      AttributeName=GSI2SK,AttributeType=S \
      AttributeName=GSI3PK,AttributeType=S \
      AttributeName=GSI3SK,AttributeType=S \
      AttributeName=GSI4PK,AttributeType=S \
      AttributeName=GSI4SK,AttributeType=S \
    --global-secondary-indexes \
      'IndexName=StageIndex,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
      'IndexName=TechIndex,KeySchema=[{AttributeName=GSI2PK,KeyType=HASH},{AttributeName=GSI2SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
      'IndexName=ContactIndex,KeySchema=[{AttributeName=GSI3PK,KeyType=HASH},{AttributeName=GSI3SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
      'IndexName=DispatcherIndex,KeySchema=[{AttributeName=GSI4PK,KeyType=HASH},{AttributeName=GSI4SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url http://localhost:8001 --region us-east-1 \
    --no-cli-pager 2>/dev/null || true

  # Reset CRM contacts test table
  echo -e "  ${DIM}Resetting CRM contacts test database...${NC}"
  aws dynamodb delete-table --table-name BitCRM_Contacts_Test \
    --endpoint-url http://localhost:8001 --region us-east-1 \
    --no-cli-pager 2>/dev/null || true
  aws dynamodb create-table --table-name BitCRM_Contacts_Test \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S \
      AttributeName=GSI1SK,AttributeType=S \
    --global-secondary-indexes \
      'IndexName=CompanyIndex,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url http://localhost:8001 --region us-east-1 \
    --no-cli-pager 2>/dev/null || true

  # Reset CRM companies test table
  echo -e "  ${DIM}Resetting CRM companies test database...${NC}"
  aws dynamodb delete-table --table-name BitCRM_Companies_Test \
    --endpoint-url http://localhost:8001 --region us-east-1 \
    --no-cli-pager 2>/dev/null || true
  aws dynamodb create-table --table-name BitCRM_Companies_Test \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S \
      AttributeName=GSI1SK,AttributeType=S \
    --global-secondary-indexes \
      'IndexName=ClientTypeIndex,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url http://localhost:8001 --region us-east-1 \
    --no-cli-pager 2>/dev/null || true

  # Flush Redis test data
  redis-cli FLUSHDB 2>/dev/null || true
}

# ═══════════════════════════════════════
# INTEGRATION TESTS
# ═══════════════════════════════════════
if [ "$RUN_INTEGRATION" = true ]; then
  print_header "Integration Tests"
  echo -e "  ${DIM}Requires: Docker (DynamoDB local + Redis)${NC}"
  ensure_test_infra

  run_tests \
    "user-service" \
    "$BACKEND_DIR/services/user" \
    "NODE_OPTIONS='--experimental-vm-modules' npx jest --config test/integration/jest-integration.json --silent --runInBand" \
    "integration"

  run_tests \
    "inventory-service" \
    "$BACKEND_DIR/services/inventory" \
    "NODE_OPTIONS='--experimental-vm-modules' npx jest --config test/integration/jest-integration.json --silent --runInBand" \
    "integration"

  run_tests \
    "crm-service" \
    "$BACKEND_DIR/services/crm" \
    "NODE_OPTIONS='--experimental-vm-modules' npx jest --config test/integration/jest-integration.json --silent --runInBand" \
    "integration"

  run_tests \
    "deal-service" \
    "$BACKEND_DIR/services/deal" \
    "NODE_OPTIONS='--experimental-vm-modules' npx jest --config test/integration/jest-integration.json --silent --runInBand" \
    "integration"
fi

# ═══════════════════════════════════════
# E2E TESTS
# ═══════════════════════════════════════
if [ "$RUN_E2E" = true ]; then
  print_header "E2E Tests"
  echo -e "  ${DIM}Requires: Docker (DynamoDB local + Redis)${NC}"
  ensure_test_infra

  run_tests \
    "user-service" \
    "$BACKEND_DIR/services/user" \
    "NODE_OPTIONS='--experimental-vm-modules' npx jest --config test/e2e/jest-e2e.json --silent --runInBand" \
    "e2e"

  run_tests \
    "inventory-service" \
    "$BACKEND_DIR/services/inventory" \
    "NODE_OPTIONS='--experimental-vm-modules' npx jest --config test/e2e/jest-e2e.json --silent --runInBand" \
    "e2e"

  run_tests \
    "crm-service" \
    "$BACKEND_DIR/services/crm" \
    "NODE_OPTIONS='--experimental-vm-modules' npx jest --config test/e2e/jest-e2e.json --silent --runInBand --forceExit" \
    "e2e"

  run_tests \
    "deal-service" \
    "$BACKEND_DIR/services/deal" \
    "NODE_OPTIONS='--experimental-vm-modules' npx jest --config test/e2e/jest-e2e.json --silent --runInBand --forceExit" \
    "e2e"
fi

# ═══════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════
echo ""
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${BLUE}  Summary${NC}"
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${GREEN}Passed:${NC}  $PASSED packages"
echo -e "  ${RED}Failed:${NC}  $FAILED packages"
echo -e "  ${YELLOW}Skipped:${NC} $SKIPPED packages"
echo -e "  ${BOLD}Total:${NC}   $TOTAL_SUITES suites, $TOTAL_TESTS tests"
echo ""

if [ ${#FAILURES[@]} -gt 0 ]; then
  echo -e "  ${RED}${BOLD}Failures:${NC}"
  for f in "${FAILURES[@]}"; do
    echo -e "    ${RED}x${NC} $f"
  done
  echo ""
  exit 1
else
  echo -e "  ${GREEN}${BOLD}All tests passed!${NC}"
  echo ""
  exit 0
fi
