#!/usr/bin/env bash
# Push every dashboard in monitoring/grafana/dashboards/ into a Grafana instance.
#
# Run by a person with their own credential, so no Grafana token ever has to
# travel through a chat or a CI secret.
#
#   GRAFANA_URL=https://<stack>.grafana.net \
#   GRAFANA_TOKEN=<service account token> \
#     bash scripts/import-grafana.sh
#
# The token is a *Grafana service account* token (Grafana UI -> Administration ->
# Users and access -> Service accounts), not a Grafana Cloud access-policy
# token. The two are different credentials: access-policy tokens authenticate
# to the Prometheus/Loki/Tempo push endpoints, while the dashboard API lives on
# the Grafana instance itself. Needs the Editor role.
#
# Idempotent: dashboards are matched on their uid, so re-running updates in
# place rather than creating duplicates.
#
# Flags:
#   --dry-run   list what would be pushed, touch nothing
#   --local     target the local docker Grafana (http://localhost:3001, admin/admin)

set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DASH_DIR="$BACKEND_DIR/monitoring/grafana/dashboards"

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --local)
      GRAFANA_URL="http://localhost:3001"
      GRAFANA_AUTH=(--user "admin:admin")
      ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

: "${GRAFANA_URL:?GRAFANA_URL is required (e.g. https://yourstack.grafana.net)}"

if [[ -z "${GRAFANA_AUTH+x}" ]]; then
  : "${GRAFANA_TOKEN:?GRAFANA_TOKEN is required (Grafana service account token)}"
  GRAFANA_AUTH=(-H "Authorization: Bearer ${GRAFANA_TOKEN}")
fi

GRAFANA_URL="${GRAFANA_URL%/}"

# Local-only dashboards. Nothing scrapes nginx or a docker-network Redis in a
# deployed environment, so importing these would publish panels that can only
# ever read "No data".
LOCAL_ONLY=("gateway.json")

is_local_only() {
  local f="$1"
  for skip in "${LOCAL_ONLY[@]}"; do
    [[ "$f" == "$skip" ]] && return 0
  done
  return 1
}

echo "Target: $GRAFANA_URL"

DATASOURCES_JSON='[]'
if [[ "$DRY_RUN" == false ]]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "${GRAFANA_AUTH[@]}" "$GRAFANA_URL/api/health")
  if [[ "$code" != "200" ]]; then
    echo "Cannot reach Grafana (HTTP $code). Check GRAFANA_URL and the token's role." >&2
    exit 1
  fi

  # The dashboards carry the local provisioning uids (Prometheus / Loki /
  # Tempo). Grafana Cloud provisions its own (grafanacloud-<slug>-prom, ...),
  # so importing them unchanged gives a dashboard whose every panel reads
  # "Datasource not found". Discover the real uids and rewrite by type.
  code=$(curl -s -o /tmp/ds.json -w '%{http_code}' -m 20 "${GRAFANA_AUTH[@]}" "$GRAFANA_URL/api/datasources")
  if [[ "$code" != "200" ]]; then
    echo "Cannot read datasources (HTTP $code)." >&2
    echo "The token needs datasources:read — a Viewer service account cannot do this." >&2
    echo "Give the service account the Editor role; the same token keeps working." >&2
    exit 1
  fi
  DATASOURCES_JSON=$(cat /tmp/ds.json)

  # Picking the first datasource of each type is wrong on Grafana Cloud: a
  # stack ships several Loki and Prometheus datasources that are Grafana's own
  # telemetry (alert state history, usage insights, ML metrics), and they sort
  # ahead of the real ones. Wiring the Logs dashboard to alert-state-history
  # would look like a successful import and show the wrong data.
  echo "Datasources resolved:"
  DS_MAP_JSON=$(DATASOURCES_JSON="$DATASOURCES_JSON" python3 <<'PICK'
import json, os, sys

sources = json.loads(os.environ["DATASOURCES_JSON"])

# Grafana's own bookkeeping datasources, never the application's.
META = ("usage", "alert-state-history", "ml-metrics", "cardinality",
        "knowledgegraph", "profiles", "-k6")

def pick(dtype):
    same = [d for d in sources if d["type"] == dtype]
    real = [d for d in same if not any(m in d["uid"] for m in META)]
    pool = real or same
    for d in pool:
        if d.get("isDefault"):
            return d["uid"]
    return pool[0]["uid"] if pool else None

chosen = {t: pick(t) for t in ("prometheus", "loki", "tempo", "cloudwatch")}
for t, uid in chosen.items():
    print("  %-11s -> %s" % (t, uid or "(none on this instance)"), file=sys.stderr)
json.dump({k: v for k, v in chosen.items() if v}, sys.stdout)
PICK
  )
fi

pushed=0; skipped=0; failed=0

for file in "$DASH_DIR"/*.json; do
  name="$(basename "$file")"

  if is_local_only "$name"; then
    echo "  skip    $name (local-only)"
    skipped=$((skipped + 1))
    continue
  fi

  uid=$(jq -r '.uid // empty' "$file")
  title=$(jq -r '.title // empty' "$file")
  if [[ -z "$uid" || -z "$title" ]]; then
    echo "  FAIL    $name (missing uid or title)" >&2
    failed=$((failed + 1))
    continue
  fi

  if [[ "$DRY_RUN" == true ]]; then
    echo "  would   $name -> $uid ($title)"
    pushed=$((pushed + 1))
    continue
  fi

  # overwrite:true is what makes this idempotent; id must be null so Grafana
  # resolves the dashboard by uid instead of an id from another instance.
  # Datasource uids are rewritten to whatever this instance actually has.
  payload=$(DS_MAP_JSON="$DS_MAP_JSON" python3 - "$file" <<'REMAP'
import json, os, sys

dash = json.load(open(sys.argv[1]))
dash["id"] = None

by_type = json.loads(os.environ["DS_MAP_JSON"])

# The uid each dashboard is authored against -> the datasource type it means.
AUTHORED = {
    "Prometheus": "prometheus",
    "Loki": "loki",
    "Tempo": "tempo",
    "CloudWatch": "cloudwatch",
}

missing = set()

def walk(node):
    if isinstance(node, dict):
        ds = node.get("datasource")
        if isinstance(ds, dict) and ds.get("uid") in AUTHORED:
            want = AUTHORED[ds["uid"]]
            if want in by_type:
                ds["uid"] = by_type[want]
            else:
                missing.add(want)
        for v in node.values():
            walk(v)
    elif isinstance(node, list):
        for v in node:
            walk(v)

walk(dash)

if missing:
    # Importing a dashboard whose datasource does not exist produces panels
    # that can only ever error. Better to say so and skip.
    print("MISSING:" + ",".join(sorted(missing)), file=sys.stderr)
    sys.exit(3)

json.dump({"dashboard": dash, "overwrite": True,
           "message": "bitcrm monitoring import"}, sys.stdout)
REMAP
  ) || {
    rc=$?
    if [[ $rc -eq 3 ]]; then
      echo "  skip    $name (no datasource of the required type on this instance)"
      skipped=$((skipped + 1))
      continue
    fi
    echo "  FAIL    $name (could not build payload)" >&2
    failed=$((failed + 1))
    continue
  }

  response=$(curl -s -w '\n%{http_code}' -m 30 -X POST \
    "${GRAFANA_AUTH[@]}" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "$GRAFANA_URL/api/dashboards/db")

  code=$(echo "$response" | tail -1)
  # `sed '$d'` rather than `head -n -1`: BSD head has no negative count, so the
  # error body was being lost on macOS exactly when it was needed.
  body=$(echo "$response" | sed '$d')

  msg=$(echo "$body" | jq -r '.message // empty' 2>/dev/null)

  if [[ "$code" == "200" ]]; then
    echo "  ok      $name -> $uid"
    pushed=$((pushed + 1))
  elif [[ "$msg" == *"provisioned dashboard"* ]]; then
    # The local docker Grafana provisions these from disk, so the API refuses to
    # overwrite them. The dashboard is present and current - it is just managed
    # by the file provisioner rather than the API. Not a failure; it also means
    # --local exercises everything up to the write, which is what makes it a
    # usable smoke test of the payload.
    echo "  skip    $name (provisioned from disk, already current)"
    skipped=$((skipped + 1))
  else
    [[ -z "$msg" ]] && msg=$(echo "$body" | head -c 200)
    echo "  FAIL    $name (HTTP $code): $msg" >&2
    failed=$((failed + 1))
  fi
done

echo ""
echo "pushed=$pushed skipped=$skipped failed=$failed"
echo ""
echo "Alert rules go to the Mimir ruler, not here: scripts/import-alerts.sh"
echo ""

[[ $failed -eq 0 ]]
