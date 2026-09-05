#!/usr/bin/env bash
# Enter the two scenario assets into the evaluation pool, then freeze it.
#
# Ordering is the whole point of this script, and it is not arbitrary:
#
#   1. create both skills as identity A's agent — the author must be a different
#      identity from the one that will run the task, or every event comes out
#      `self` and the team dimension is structurally zero
#   2. confirm each asset record is visible to the team — that field is where
#      the gate acts, so an asset that lands `restricted` is invisible to the
#      consumer and the scenario never starts
#   3. freeze the pool and record `pool_snapshot_at` — this system extracts
#      assets from failed sessions on its own (measured: a skill appeared 45 s
#      after a debugging failure), so without a freeze an asset distilled from
#      the run being evaluated could leak the answer back into the pool
#   4. re-check token uniqueness against the pool *as frozen*, not as drafted
#
# Step 4 is last on purpose. Constraint (c) is about the pool these assets are
# actually in; checking it against the drafts proves nothing about the pool.
#
# Usage:
#   bash evaluation/tasks/bridge-addr/enter-pool.sh          # do it
#   bash evaluation/tasks/bridge-addr/enter-pool.sh --check  # report only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_DIR="$REPO_ROOT/deploy/global-images"

CORE_URL="${CORE_URL:-http://localhost:8420}"
SERVICE_ID="${SERVICE_ID:-default}"
TEAM_ID="${TEAM_ID:-team-5ezfoladb5}"
AUTHOR_AGENT="${AUTHOR_AGENT:-agt-5e4hna56j9}"
CONSUMER_AGENT="${CONSUMER_AGENT:-agt-5e0y4l8a7a}"
TASK_ID="${TASK_ID:-task-5e6xp4mrrw}"
PAIR_JSON="$SCRIPT_DIR/pair.json"
SNAPSHOT="$REPO_ROOT/evaluation/provenance/artifacts/asset-pool-snapshot.json"
CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

if [[ -t 1 ]]; then C_R=$'\033[31m'; C_G=$'\033[32m'; C_B=$'\033[34m'; C_Y=$'\033[33m'; C_0=$'\033[0m'
else C_R=""; C_G=""; C_B=""; C_Y=""; C_0=""; fi
info() { echo "${C_B}[$(date +%H:%M:%S)]${C_0} $*"; }
ok()   { echo "${C_G}[ok]${C_0} $*"; }
warn() { echo "${C_Y}[warn]${C_0} $*"; }
die()  { echo "${C_R}[error]${C_0} $*" >&2; exit 1; }

KEY_FILE="$ENV_DIR/.topic4-user-key"
[[ -f "$KEY_FILE" ]] || die "identity A's key not found: $KEY_FILE"

# The credential goes to curl over stdin so it never reaches ps or shell history.
#
# Both auth headers go on every call. The two route families disagree about
# which one they want — `/v3/skill/*` reads the Bearer token, `/v3/meta/*` reads
# `x-tdai-user-key` and answers 401 missing_user_key without it — and sending
# only the Bearer is how the first run of this script left both assets
# `private` while reporting nothing worse than a warning.
call() {
  local path="$1" body="$2" out="$3" key
  key="$(tr -d '[:space:]' < "$KEY_FILE")"
  printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$key" "$key" \
    | curl -sS -K - --max-time 25 \
        -H 'content-type: application/json' \
        -H "x-tdai-service-id: $SERVICE_ID" \
        -X POST "$CORE_URL$path" -d "$body" -o "$out"
}

envelope_ok() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get('code')==0 else 1)" "$1"; }
envelope_msg() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('message') or d)" "$1" 2>/dev/null | head -c 200; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ── 0. who is the author? ────────────────────────────────────────
# Read from the agent record rather than hardcoded: the whole cross-person
# claim is "these two user ids differ", and a stale constant would make that
# claim about the wrong person.
call "/v3/meta/agent/get" "{\"agent_id\":\"$AUTHOR_AGENT\"}" "$TMP/agent.json"
envelope_ok "$TMP/agent.json" || die "cannot read $AUTHOR_AGENT: $(envelope_msg "$TMP/agent.json")"
AUTHOR_USER="$(python3 -c "import json;print(json.load(open('$TMP/agent.json'))['data']['owner_user_id'])")"
CONSUMER_USER=""
call "/v3/meta/agent/get" "{\"agent_id\":\"$CONSUMER_AGENT\"}" "$TMP/consumer.json" || true
envelope_ok "$TMP/consumer.json" \
  && CONSUMER_USER="$(python3 -c "import json;print(json.load(open('$TMP/consumer.json'))['data']['owner_user_id'])")"

[[ -n "$AUTHOR_USER" ]] || die "author agent has no owner_user_id"
info "author   $AUTHOR_AGENT → $AUTHOR_USER"
info "consumer $CONSUMER_AGENT → ${CONSUMER_USER:-<unreadable>}"
if [[ -n "$CONSUMER_USER" && "$CONSUMER_USER" == "$AUTHOR_USER" ]]; then
  die "author and consumer resolve to the same user id — every event would be self and cross-person reuse would be structurally zero"
fi

# ── 1. create ────────────────────────────────────────────────────
declare -a ASSET_IDS=() ASSET_NAMES=() ASSET_ROLES=()

for role in wrong right; do
  file="$SCRIPT_DIR/assets/$role.md"
  [[ -f "$file" ]] || die "missing asset body: $file"
  name="$(sed -n 's/^name:[[:space:]]*//p' "$file" | head -1)"
  [[ -n "$name" ]] || die "$file has no name in its frontmatter"

  # Already there from an earlier run? Creating again would only collide.
  call "/v3/skill/get-by-name" \
    "$(python3 -c 'import json,sys; print(json.dumps({"team_id":sys.argv[1],"agent_id":sys.argv[2],"skill_name":sys.argv[3],"include_content":True}))' "$TEAM_ID" "$AUTHOR_AGENT" "$name")" \
    "$TMP/get.json" || true

  if envelope_ok "$TMP/get.json"; then
    id="$(python3 -c "import json;print(json.load(open('$TMP/get.json'))['data']['skill_id'])")"

    # Already there, but is it the same text? Running the scenario against a
    # pooled body that differs from the file on disk would attribute the run to
    # an asset nobody can read afterwards.
    if python3 -c "
import json,sys
d=json.load(open('$TMP/get.json'))['data']
sys.exit(0 if (d.get('content') or '') == open('$file',encoding='utf-8').read() else 1)"; then
      info "$role: already in the pool as $id, unchanged"
    elif (( CHECK_ONLY )); then
      warn "$role: pooled body differs from $file"
    else
      cur="$(python3 -c "import json;print(json.load(open('$TMP/get.json'))['data']['version'])")"
      info "$role: pooled body differs — updating from v$cur"
      python3 - "$TEAM_ID" "$AUTHOR_USER" "$AUTHOR_AGENT" "$id" "$cur" "$file" > "$TMP/upd-body.json" <<'PYX'
import json, sys
team, user, agent, skill_id, version, path = sys.argv[1:7]
print(json.dumps({
    "team_id": team, "user_id": user, "agent_id": agent,
    "skill_id": skill_id, "expected_version": int(version),
    "content": open(path, encoding="utf-8").read(),
}))
PYX
      call "/v3/skill/update" "@$TMP/upd-body.json" "$TMP/upd-skill.json"
      envelope_ok "$TMP/upd-skill.json" || die "update $name failed: $(envelope_msg "$TMP/upd-skill.json")"
      ok "$role: updated to v$(python3 -c "import json;print(json.load(open('$TMP/upd-skill.json'))['data'].get('version','?'))")"
    fi
  elif (( CHECK_ONLY )); then
    warn "$role ($name): not in the pool"
    id=""
  else
    info "creating $role as $name …"
    # user_id is not optional in practice. Omitting it stores the skill row
    # under "default" while the asset row records the real owner, and the two
    # then disagree about who wrote the asset — the single field the
    # cross-person claim rests on. A "default" author still compares as
    # different from the consumer and still reports cross_user, so the failure
    # is invisible in the output: it just makes the headline number wrong.
    python3 - "$TEAM_ID" "$AUTHOR_USER" "$AUTHOR_AGENT" "$TASK_ID" "$name" "$file" > "$TMP/body.json" <<'PY'
import json, sys
team, user, agent, task, name, path = sys.argv[1:7]
print(json.dumps({
    "team_id": team, "user_id": user, "agent_id": agent, "task_id": task,
    "name": name, "content": open(path, encoding="utf-8").read(),
}))
PY
    call "/v3/skill/create" "@$TMP/body.json" "$TMP/create.json"
    envelope_ok "$TMP/create.json" || die "create $name failed: $(envelope_msg "$TMP/create.json")"
    id="$(python3 -c "import json;print(json.load(open('$TMP/create.json'))['data']['skill_id'])")"
    ok "$role → $id"
  fi

  ASSET_IDS+=("$id"); ASSET_NAMES+=("$name"); ASSET_ROLES+=("$role")
done

# ── 2. visibility ────────────────────────────────────────────────
# The gate acts on this field, so it is checked rather than assumed. An asset
# that lands `restricted` is invisible to the consumer and the run never starts.
info "checking asset visibility …"
for i in "${!ASSET_IDS[@]}"; do
  id="${ASSET_IDS[$i]}"; [[ -n "$id" ]] || continue
  call "/v3/meta/asset/get" "{\"asset_id\":\"$id\"}" "$TMP/asset.json" || true
  if ! envelope_ok "$TMP/asset.json"; then
    # Not a warning. An unread visibility is indistinguishable from a wrong one,
    # and a wrong one means the consumer never sees the asset at all.
    die "${ASSET_ROLES[$i]}: cannot read the asset record ($(envelope_msg "$TMP/asset.json"))"
  fi
  vis="$(python3 -c "import json;d=json.load(open('$TMP/asset.json'))['data'];print(d.get('visibility'))")"
  own="$(python3 -c "import json;d=json.load(open('$TMP/asset.json'))['data'];print(d.get('owner_user_id') or d.get('user_id'))")"
  [[ "$own" == "$AUTHOR_USER" ]] \
    || die "${ASSET_ROLES[$i]}: asset record says owner=$own, expected $AUTHOR_USER"

  if [[ "$vis" == "team" ]]; then
    ok "${ASSET_ROLES[$i]}: visibility=team  owner=$own"
  elif (( CHECK_ONLY )); then
    warn "${ASSET_ROLES[$i]}: visibility=$vis (needs team)"
  else
    info "${ASSET_ROLES[$i]}: visibility=$vis → setting team"
    call "/v3/meta/asset/update" "{\"asset_id\":\"$id\",\"visibility\":\"team\"}" "$TMP/upd.json"
    envelope_ok "$TMP/upd.json" || die "could not set visibility on $id: $(envelope_msg "$TMP/upd.json")"
    ok "${ASSET_ROLES[$i]}: visibility=team  owner=$own"
  fi
done

(( CHECK_ONLY )) && { info "check only — pool not frozen"; exit 0; }

# ── 3. freeze ────────────────────────────────────────────────────
info "freezing the pool …"
TEAM_ID="$TEAM_ID" bash "$REPO_ROOT/evaluation/provenance/snapshot-assets.sh"
SNAP_AT="$(python3 -c "import json;print(json.load(open('$SNAPSHOT'))['pool_snapshot_at'])")"

# The snapshot reads ownership from the skill row; the gate reads it from the
# asset row. Two different records, and they can disagree.
python3 - "$SNAPSHOT" "$AUTHOR_USER" "${ASSET_IDS[0]}" "${ASSET_IDS[1]}" <<'PY' || die "snapshot ownership disagrees with the asset records"
import json, sys
snap, expected, *ids = sys.argv[1:]
by_id = {a["asset_id"]: a for a in json.load(open(snap, encoding="utf-8"))["assets"]}
bad = [i for i in ids if by_id.get(i, {}).get("producer_user_id") != expected]
for i in bad:
    print(f"  {i}: snapshot says {by_id.get(i, {}).get('producer_user_id')!r}, asset record says {expected!r}")
sys.exit(1 if bad else 0)
PY

# ── 4. record the pair ───────────────────────────────────────────
python3 - "$PAIR_JSON" "$SNAPSHOT" "$TEAM_ID" "$AUTHOR_AGENT" "$CONSUMER_AGENT" "$TASK_ID" "$SNAP_AT" \
  "${ASSET_ROLES[0]}" "${ASSET_IDS[0]}" "${ASSET_NAMES[0]}" \
  "${ASSET_ROLES[1]}" "${ASSET_IDS[1]}" "${ASSET_NAMES[1]}" <<'PY'
import json, sys
out, snap_path, team, author, consumer, task, snap_at = sys.argv[1:8]
rows = sys.argv[8:]
snapshot = json.load(open(snap_path, encoding="utf-8"))
by_id = {a["asset_id"]: a for a in snapshot["assets"]}

assets = []
for role, asset_id, name in zip(rows[0::3], rows[1::3], rows[2::3]):
    a = by_id.get(asset_id, {})
    assets.append({
        "role": role, "asset_id": asset_id, "name": name,
        "version": a.get("version"),
        "producer_user_id": a.get("producer_user_id", ""),
        "producer_agent_id": a.get("producer_agent_id", ""),
    })

authors = {a["producer_user_id"] for a in assets if a["producer_user_id"]}
# The relation is recorded as a claim to be checked against the run, not as a
# fact: it only holds if the consumer really is a different user id.
json.dump({
    "team_id": team,
    "author_agent_id": author,
    "consumer_agent_id": consumer,
    "task_id": task,
    "pool_snapshot_at": snap_at,
    "pool_asset_count": snapshot["asset_count"],
    "assets": assets,
    "expected_relation": "cross_user",
    "expected_relation_holds_if": (
        "the consumer identity resolves to a user id different from "
        + (", ".join(sorted(authors)) or "the author")
        + "; verified from the events of the run, never assumed"
    ),
    "operated_by": "one person running both identities — the mechanism is real, "
                   "ecological validity is not, and this is stated in the report",
}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"  pair recorded: {out}")
PY

# ── 5. uniqueness against the pool as frozen ─────────────────────
info "re-checking token uniqueness against the frozen pool …"
node "$REPO_ROOT/evaluation/attribution/extract-tokens.mjs" \
  "$SCRIPT_DIR/assets/wrong.md" "$SCRIPT_DIR/assets/right.md" \
  --pool="$SNAPSHOT" \
  --capture="$REPO_ROOT/evaluation/gate0/artifacts/gate0-threechannel-capture.jsonl" \
  --contains="$SCRIPT_DIR/task.md" \
  || die "token check failed against the frozen pool — do not run the scenario until this passes"

ok "pool entered and frozen at $SNAP_AT"
