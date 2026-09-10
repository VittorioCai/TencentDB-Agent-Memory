#!/usr/bin/env bash
# Asset pool snapshot — records ownership and version of every asset in the pool
# at one instant.
#
# Why a snapshot has to come first: an asset's owner can change and its version
# rolls forward, so a lookup after the fact returns a different row than the one
# that was actually used. `producer_*` in a provenance event only has a definite
# meaning relative to a snapshot.
#
# The snapshot time doubles as `pool_snapshot_at`. This system auto-extracts
# assets from failed sessions (measured: a Skill appeared 45 s after a debugging
# failure), so any asset created after this instant is excluded from statistics —
# otherwise an asset distilled from the very run being evaluated could leak the
# answer back into the candidate pool.
#
# Usage:
#   bash evaluation/provenance/snapshot-assets.sh
#   TEAM_ID=team-xxx OUT=path/to/snapshot.json bash evaluation/provenance/snapshot-assets.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_DIR="$REPO_ROOT/deploy/global-images"

CORE_URL="${CORE_URL:-http://localhost:8420}"
KNOWLEDGE_URL="${KNOWLEDGE_URL:-http://localhost:8424}"
SERVICE_ID="${SERVICE_ID:-default}"
# The evaluation team. A bare run must not default to the old development team:
# this script overwrites `asset-pool-snapshot.json`, and pointing it at the
# wrong pool silently replaces the freeze the answer-leak guard compares against.
TEAM_ID="${TEAM_ID:-team-5ezfoladb5}"
OUT="${OUT:-$REPO_ROOT/evaluation/provenance/artifacts/asset-pool-snapshot.json}"

if [[ -t 1 ]]; then C_R=$'\033[31m'; C_G=$'\033[32m'; C_B=$'\033[34m'; C_0=$'\033[0m'
else C_R=""; C_G=""; C_B=""; C_0=""; fi
info() { echo "${C_B}[$(date +%H:%M:%S)]${C_0} $*"; }
ok()   { echo "${C_G}[ok]${C_0} $*"; }
die()  { echo "${C_R}[error]${C_0} $*" >&2; exit 1; }

KEY_FILE="$ENV_DIR/.topic4-user-key"
[[ -f "$KEY_FILE" ]] || die "business user key not found: $KEY_FILE"
USER_KEY="$(tr -d '[:space:]' < "$KEY_FILE")"
[[ -n "$USER_KEY" ]] || die "$KEY_FILE is empty"

mkdir -p "$(dirname "$OUT")"
SNAPSHOT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# The credential goes to curl over stdin, so it never reaches ps or shell history.
curl_json() {
  local url="$1" body="$2" out="$3"
  printf 'header = "Authorization: Bearer %s"\n' "$USER_KEY" \
    | curl -sS -K - --max-time 20 --fail-with-body \
        -H 'content-type: application/json' \
        -H "x-tdai-service-id: $SERVICE_ID" \
        -X POST "$url" -d "$body" -o "$out"
}

info "snapshot instant $SNAPSHOT_AT"

SKILLS_RAW="$(mktemp)"; WIKIS_RAW="$(mktemp)"
trap 'rm -f "$SKILLS_RAW" "$WIKIS_RAW"' EXIT

info "fetching skill assets …"
curl_json "$CORE_URL/v3/skill/list" "{\"team_id\":\"$TEAM_ID\",\"limit\":500}" "$SKILLS_RAW" \
  || die "skill/list failed: $(head -c 200 "$SKILLS_RAW")"

# `skill/list` runs through the admission gate, so an asset the gate has put
# out of the pool (candidate / failed) is simply absent from it — and absent is
# the same answer as never created. Measured 2026-09-10: with both mainline
# assets at `candidate` this script wrote a snapshot with **0 assets**, which
# every later run would have read as "the pool is empty" rather than "the pool
# is gated". The asset registry (`/v3/meta/asset/list`, management path) lists
# every asset in the team with its status; the two are joined below and each
# row says which listing(s) it came from.
ASSETS_RAW="$(mktemp)"; trap 'rm -f "$SKILLS_RAW" "$WIKIS_RAW" "$ASSETS_RAW"' EXIT
info "fetching the asset registry (management path; includes gated assets) …"
# The registry caps `limit` at 100 and pages by top-level `offset` (the schema
# merges them at the top level — a nested `pagination` object is stripped by
# Zod and silently gives page one). Pages are joined into one items array.
PAGE="$(mktemp)"; trap 'rm -f "$SKILLS_RAW" "$WIKIS_RAW" "$ASSETS_RAW" "$PAGE" "${PREV_SNAPSHOT:-}"' EXIT
echo '{"data":{"items":[]}}' > "$ASSETS_RAW"
offset=0
while :; do
  printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$USER_KEY" "$USER_KEY" \
    | curl -sS -K - --max-time 20 --fail-with-body \
        -H 'content-type: application/json' -H "x-tdai-service-id: $SERVICE_ID" \
        -X POST "$CORE_URL/v3/meta/asset/list" -d "{\"team_id\":\"$TEAM_ID\",\"limit\":100,\"offset\":$offset}" -o "$PAGE" \
    || die "meta/asset/list failed at offset $offset: $(head -c 200 "$PAGE")"
  got="$(python3 - "$ASSETS_RAW" "$PAGE" <<'PYP'
import json, sys
acc = json.load(open(sys.argv[1])); page = json.load(open(sys.argv[2]))
items = (page.get("data") or {}).get("items") or []
acc["data"]["items"].extend(items)
json.dump(acc, open(sys.argv[1], "w"))
print(len(items))
PYP
)"
  (( got < 100 )) && break
  offset=$((offset + 100))
done

# Knowledge runs as its own service and authenticates differently (no Bearer).
info "fetching knowledge assets …"
curl -sS --max-time 20 -X POST "$KNOWLEDGE_URL/v3/wiki/list" \
  -H 'content-type: application/json' \
  -H "x-tdai-service-id: $SERVICE_ID" \
  -H "x-conversation-id: provenance-snapshot" \
  -d "{\"team_id\":\"$TEAM_ID\"}" -o "$WIKIS_RAW" || true

# The registry row has no agent field. For a skill the gate hid from
# skill/list, the owner agent is carried over from the snapshot being replaced
# (an asset's owner agent does not change with its version) and the row says
# so; with no earlier snapshot it stays empty, which provenance reads as
# relation=unknown — never as self.
PREV_SNAPSHOT="$(mktemp)"; [[ -f "$OUT" ]] && cp "$OUT" "$PREV_SNAPSHOT" || echo '{}' > "$PREV_SNAPSHOT"
SNAPSHOT_AT="$SNAPSHOT_AT" TEAM_ID="$TEAM_ID" OUT="$OUT" PREV_SNAPSHOT="$PREV_SNAPSHOT" \
SKILLS_RAW="$SKILLS_RAW" WIKIS_RAW="$WIKIS_RAW" ASSETS_RAW="$ASSETS_RAW" python3 <<'PY'
import json, os

def load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}

def items_of(payload):
    data = payload.get("data")
    if isinstance(data, dict):
        return data.get("items") or []
    return data if isinstance(data, list) else []

def ms_to_iso(value):
    if not value:
        return ""
    import datetime
    return datetime.datetime.utcfromtimestamp(value / 1000).strftime("%Y-%m-%dT%H:%M:%SZ")

assets = []

for row in items_of(load(os.environ["SKILLS_RAW"])):
    assets.append({
        "asset_id":          row.get("skill_id", ""),
        "asset_type":        "skill",
        "name":              row.get("name", ""),
        "producer_user_id":  row.get("owner_user_id", ""),
        "producer_agent_id": row.get("owner_agent_id", ""),
        "team_id":           row.get("team_id", ""),
        "version":           row.get("version"),
        "is_head":           row.get("is_head"),
        "status":            row.get("status", ""),
        "asset_created_at":  ms_to_iso(row.get("created_at_ms")),
        "asset_updated_at":  ms_to_iso(row.get("updated_at_ms")),
    })

# Registry rows: every skill asset the management path lists, gated or not.
# A skill already seen via skill/list keeps that row and gains the registry's
# status; one the gate hid is added from the registry alone and says so.
prev_agents = {a.get("asset_id"): a.get("producer_agent_id", "") for a in (load(os.environ["PREV_SNAPSHOT"]).get("assets") or []) if a.get("producer_agent_id")}
seen = {a["asset_id"] for a in assets}
for row in items_of(load(os.environ["ASSETS_RAW"])):
    if row.get("asset_type") != "skill":
        continue
    aid = row.get("asset_id", "")
    if aid in seen:
        for a in assets:
            if a["asset_id"] == aid:
                a["status"] = row.get("status", a.get("status", ""))
                a["visibility"] = row.get("visibility", "")
                a["listing"] = "skill/list + meta/asset/list"
        continue
    prev = prev_agents.get(aid, "")
    assets.append({
        "asset_id":          aid,
        "asset_type":        "skill",
        "name":              row.get("name", ""),
        "producer_user_id":  row.get("owner_user_id", ""),
        "producer_agent_id": prev,
        "producer_agent_source": "previous snapshot" if prev else "unknown (registry rows carry no agent; no earlier snapshot to carry it from)",
        "team_id":           row.get("team_id", ""),
        "version":           row.get("version"),
        "is_head":           None,
        "status":            row.get("status", ""),
        "visibility":        row.get("visibility", ""),
        "listing":           "meta/asset/list only (hidden from skill/list by the gate)",
        "asset_created_at":  (row.get("created_at") or "")[:19] + ("Z" if row.get("created_at") else ""),
        "asset_updated_at":  (row.get("updated_at") or "")[:19] + ("Z" if row.get("updated_at") else ""),
    })
for a in assets:
    a.setdefault("listing", "skill/list")

for row in items_of(load(os.environ["WIKIS_RAW"])):
    assets.append({
        "asset_id":          row.get("wiki_id", ""),
        "asset_type":        "knowledge",
        "name":              row.get("name", ""),
        "producer_user_id":  row.get("owner_user_id", ""),
        "producer_agent_id": row.get("agent_id", ""),
        "team_id":           row.get("team_id", ""),
        "version":           row.get("version"),
        "is_head":           None,
        "status":            row.get("status", ""),
        "asset_created_at":  (row.get("created_at") or "")[:19] + ("Z" if row.get("created_at") else ""),
        "asset_updated_at":  (row.get("updated_at") or "")[:19] + ("Z" if row.get("updated_at") else ""),
    })

snapshot = {
    "pool_snapshot_at": os.environ["SNAPSHOT_AT"],
    "team_id":          os.environ["TEAM_ID"],
    "asset_count":      len(assets),
    "assets":           assets,
}

with open(os.environ["OUT"], "w", encoding="utf-8") as fh:
    json.dump(snapshot, fh, ensure_ascii=False, indent=2)

owners = {a["producer_user_id"] for a in assets if a["producer_user_id"]}
by_type = {}
for a in assets:
    by_type[a["asset_type"]] = by_type.get(a["asset_type"], 0) + 1

print("  " + str(len(assets)) + " asset(s): " + ", ".join(f"{k} {v}" for k, v in sorted(by_type.items())))
print(f"  {len(owners)} distinct producer(s)")
if len(owners) <= 1:
    print("  note: a single producer means this snapshot can yield no cross_user events.")
PY

ok "snapshot written to $OUT"
