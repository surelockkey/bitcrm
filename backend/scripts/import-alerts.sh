#!/usr/bin/env bash
# Load monitoring/prometheus/alerts.yml into Grafana Cloud's Mimir ruler.
#
#   PROM_BASE_URL=https://prometheus-prod-XX-<region>.grafana.net \
#   PROM_USERNAME=<numeric prometheus instance id> \
#   GRAFANA_CLOUD_TOKEN=<access policy token, needs rules:write> \
#     bash scripts/import-alerts.sh
#
# Same credential the Alloy sidecar uses, so nothing new is needed. Each rule
# group is PUT separately because the ruler API takes one group per request;
# posting a group that already exists replaces it, so re-running is safe.
#
# Flags:
#   --dry-run   print what would be sent, touch nothing
#   --list      show what is currently loaded and exit

set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ALERTS="$BACKEND_DIR/monitoring/prometheus/alerts.yml"
NAMESPACE="bitcrm"

# Reads nginx_* from the local gateway. There is no nginx in a deployed
# environment - the ALB replaces it - so this group could only ever evaluate to
# no-data there. Mirrors import-grafana.sh skipping gateway.json.
LOCAL_ONLY_GROUPS=("bitcrm-gateway")

DRY_RUN=false
LIST_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --list)    LIST_ONLY=true ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

: "${PROM_BASE_URL:?PROM_BASE_URL is required}"
: "${PROM_USERNAME:?PROM_USERNAME is required}"
: "${GRAFANA_CLOUD_TOKEN:?GRAFANA_CLOUD_TOKEN is required}"

PROM_BASE_URL="${PROM_BASE_URL%/}"
RULER="$PROM_BASE_URL/api/prom/config/v1/rules"

if [[ "$LIST_ONLY" == true ]]; then
  curl -sf -m 25 -u "${PROM_USERNAME}:${GRAFANA_CLOUD_TOKEN}" "$RULER" |
    python3 -c '
import sys, yaml
doc = yaml.safe_load(sys.stdin) or {}
if not doc:
    print("  (no rule groups loaded)")
for ns, groups in doc.items():
    for g in groups:
        print("  %s/%s: %d rules" % (ns, g["name"], len(g["rules"])))'
  exit 0
fi

TMPDIR_RULES=$(mktemp -d)
trap 'rm -rf "$TMPDIR_RULES"' EXIT

python3 - "$ALERTS" "$TMPDIR_RULES" <<'PY'
import sys, yaml, pathlib
alerts, outdir = sys.argv[1], sys.argv[2]
doc = yaml.safe_load(open(alerts))
for g in doc.get("groups", []):
    pathlib.Path(outdir, f"{g['name']}.yml").write_text(yaml.safe_dump(g, sort_keys=False))
PY

is_local_only() {
  for skip in "${LOCAL_ONLY_GROUPS[@]}"; do
    [[ "$1" == "$skip" ]] && return 0
  done
  return 1
}

loaded=0; skipped=0; failed=0

for file in "$TMPDIR_RULES"/*.yml; do
  group="$(basename "$file" .yml)"
  # Counted off the dumped group, whose indentation is yaml.safe_dump's, not
  # the source file's — anchoring to a specific indent silently reported zero.
  count=$(grep -c -- '- alert:' "$file" || true)

  if is_local_only "$group"; then
    echo "  skip    $group (local-only)"
    skipped=$((skipped + 1))
    continue
  fi

  if [[ "$DRY_RUN" == true ]]; then
    echo "  would   $group ($count rules)"
    loaded=$((loaded + 1))
    continue
  fi

  code=$(curl -s -o /tmp/ruler.out -w '%{http_code}' -m 25 -X POST \
    -u "${PROM_USERNAME}:${GRAFANA_CLOUD_TOKEN}" \
    -H 'Content-Type: application/yaml' \
    --data-binary @"$file" \
    "$RULER/$NAMESPACE")

  # The ruler accepts asynchronously: 202, not 200.
  if [[ "$code" == "202" || "$code" == "200" ]]; then
    echo "  ok      $group ($count rules)"
    loaded=$((loaded + 1))
  else
    echo "  FAIL    $group (HTTP $code): $(head -c 200 /tmp/ruler.out)" >&2
    failed=$((failed + 1))
  fi
done

echo ""
echo "loaded=$loaded skipped=$skipped failed=$failed"
[[ $failed -eq 0 ]]
