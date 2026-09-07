#!/usr/bin/env bash
# Enter the second scenario's three assets into the evaluation pool, as
# author C, then freeze the pool.
#
# Order matters here more than in the mainline, because one asset points at
# another by id:
#
#   1. create the checklist (tdc-<suffix>) as C — the marker line
#      `checklist-marker: qz7-<suffix>` is what the acceptance looks for; the
#      name, description and body avoid the task's words on purpose, so the
#      bridge search for "deploy checklist" cannot surface it (README: why)
#   2. read its skill id back, substitute it into the right note; put a
#      fabricated id of the same shape into the wrong note; create both as C
#      (`category: failure_experience` in their frontmatter)
#   3. set all three visible to the team; confirm the owner is C
#   4. freeze the pool (snapshot to the fixed path the runner reads and a
#      copy beside this task), record the pair, and screen the notes'
#      discriminative tokens against the frozen pool, the captured system
#      prompt and the task text — the two ids must be the only tokens
#
# Idempotent: existing assets are found by name and left alone unless their
# body differs from the generated file (then a new version is appended).
#
# Usage:
#   bash evaluation/tasks/bridge-name/enter-pool.sh          # do it
#   bash evaluation/tasks/bridge-name/enter-pool.sh --check  # report only
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_DIR="$REPO_ROOT/deploy/global-images"
CORE_URL="${CORE_URL:-http://localhost:8420}"
SERVICE_ID="${SERVICE_ID:-default}"
IDS="$SCRIPT_DIR/../identities.json"
GEN="$SCRIPT_DIR/assets/generated"
PAIR_JSON="$SCRIPT_DIR/pair.json"
SNAPSHOT="$REPO_ROOT/evaluation/provenance/artifacts/asset-pool-snapshot.json"
TASK_SNAPSHOT="$SCRIPT_DIR/asset-pool-snapshot.json"
TOKENS="$SCRIPT_DIR/tokens.json"
CHECK_ONLY=0; [[ "${1:-}" == "--check" ]] && CHECK_ONLY=1
if [[ -t 1 ]]; then C_R=$'\033[31m'; C_G=$'\033[32m'; C_B=$'\033[34m'; C_Y=$'\033[33m'; C_0=$'\033[0m'; else C_R=""; C_G=""; C_B=""; C_Y=""; C_0=""; fi
info() { echo "${C_B}[$(date +%H:%M:%S)]${C_0} $*"; }
ok()   { echo "${C_G}[ok]${C_0} $*"; }
warn() { echo "${C_Y}[warn]${C_0} $*"; }
die()  { echo "${C_R}[error]${C_0} $*" >&2; exit 1; }

id_of() { python3 -c "import json;print(json.load(open('$IDS'))['identities']['$1']['$2'])"; }
TEAM_ID="$(id_of c team_id)"; C_USER="$(id_of c user_id)"; C_AGENT="$(id_of c agent_id)"; CONSUMER_AGENT="$(id_of b agent_id)"
KEY_FILE="$REPO_ROOT/$(id_of c key_file)"
[[ -f "$KEY_FILE" ]] || die "identity C's key not found: $KEY_FILE"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
call() {  # path body out — key over stdin
  local path="$1" body="$2" out="$3" key
  key="$(tr -d '[:space:]' < "$KEY_FILE")"
  printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$key" "$key" \
    | curl -sS -K - --max-time 25 -H 'content-type: application/json' -H "x-tdai-service-id: $SERVICE_ID" -X POST "$CORE_URL$path" -d "$body" -o "$out"
}
envelope_ok() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get('code')==0 else 1)" "$1" 2>/dev/null; }
envelope_msg() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('message') or d)" "$1" 2>/dev/null | head -c 200; }

# A suffix that is stable across re-runs: recorded in pair.json once chosen.
if [[ -f "$PAIR_JSON" ]]; then SUFFIX="$(python3 -c "import json;print(json.load(open('$PAIR_JSON')).get('suffix',''))")"; fi
[[ -n "${SUFFIX:-}" ]] || SUFFIX="$(python3 -c "import secrets;print(secrets.token_hex(3))")"
mkdir -p "$GEN"

# ensure_skill <role> <file> → prints skill_id; creates or appends a version as C
ensure_skill() {
  local role="$1" file="$2" name id cur
  name="$(python3 -c "import re,sys;s=open(sys.argv[1],encoding='utf-8').read();m=re.search(r'^name:\s*(.+)$',s,re.M);print(m.group(1).strip() if m else '')" "$file")"
  [[ -n "$name" ]] || die "$file has no name in its frontmatter"
  call "/v3/skill/get-by-name" "$(python3 -c 'import json,sys;print(json.dumps({"team_id":sys.argv[1],"agent_id":sys.argv[2],"skill_name":sys.argv[3],"include_content":True}))' "$TEAM_ID" "$C_AGENT" "$name")" "$TMP/get-$role.json" || true
  if envelope_ok "$TMP/get-$role.json"; then
    id="$(python3 -c "import json;print(json.load(open('$TMP/get-$role.json'))['data']['skill_id'])")"
    if python3 -c "import json,sys;d=json.load(open('$TMP/get-$role.json'))['data'];sys.exit(0 if (d.get('content') or '')==open('$file',encoding='utf-8').read() else 1)"; then
      info "$role: already in the pool as $id, unchanged" >&2
    elif (( CHECK_ONLY )); then warn "$role: pooled body differs from $file" >&2
    else
      cur="$(python3 -c "import json;print(json.load(open('$TMP/get-$role.json'))['data']['version'])")"
      python3 - "$TEAM_ID" "$C_USER" "$C_AGENT" "$id" "$cur" "$file" > "$TMP/upd-$role.json" <<'PY'
import json, sys
team, user, agent, skill_id, version, path = sys.argv[1:7]
print(json.dumps({"team_id": team, "user_id": user, "agent_id": agent, "skill_id": skill_id, "expected_version": int(version), "content": open(path, encoding="utf-8").read()}))
PY
      call "/v3/skill/update" "@$TMP/upd-$role.json" "$TMP/upd-res-$role.json"
      envelope_ok "$TMP/upd-res-$role.json" || die "update $name failed: $(envelope_msg "$TMP/upd-res-$role.json")"
      ok "$role: updated to v$(python3 -c "import json;print(json.load(open('$TMP/upd-res-$role.json'))['data'].get('version','?'))")" >&2
    fi
  elif (( CHECK_ONLY )); then warn "$role ($name): not in the pool" >&2; id=""
  else
    python3 - "$TEAM_ID" "$C_USER" "$C_AGENT" "$name" "$file" > "$TMP/create-$role.json" <<'PY'
import json, sys
team, user, agent, name, path = sys.argv[1:6]
print(json.dumps({"team_id": team, "user_id": user, "agent_id": agent, "task_id": "default", "name": name, "content": open(path, encoding="utf-8").read()}))
PY
    call "/v3/skill/create" "@$TMP/create-$role.json" "$TMP/created-$role.json"
    envelope_ok "$TMP/created-$role.json" || die "create $name failed: $(envelope_msg "$TMP/created-$role.json")"
    id="$(python3 -c "import json;print(json.load(open('$TMP/created-$role.json'))['data']['skill_id'])")"
    ok "$role → $id (author C)" >&2
  fi
  echo "$id"
}

# ── 1. the checklist ─────────────────────────────────────────────
sed "s/{{SUFFIX}}/$SUFFIX/g" "$SCRIPT_DIR/assets/checklist.md" > "$GEN/checklist.md"
CHECKLIST_ID="$(ensure_skill checklist "$GEN/checklist.md")"
(( CHECK_ONLY )) && [[ -z "$CHECKLIST_ID" ]] && { info "check only — checklist not in the pool; nothing more to check"; exit 0; }

# ── 2. the two notes ─────────────────────────────────────────────
# The wrong id has the checklist id's shape and cannot collide with it.
WRONG_ID="$(python3 -c "
import secrets, sys
real = sys.argv[1]
while True:
    cand = 'skl-' + ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789') for _ in range(12))
    if cand != real: print(cand); break" "$CHECKLIST_ID")"
[[ -f "$PAIR_JSON" ]] && WRONG_ID="$(python3 -c "import json;print(json.load(open('$PAIR_JSON')).get('wrong_id') or '$WRONG_ID')")"
sed "s/{{RIGHT_ID}}/$CHECKLIST_ID/g" "$SCRIPT_DIR/assets/note-right.md" > "$GEN/note-right.md"
sed "s/{{WRONG_ID}}/$WRONG_ID/g" "$SCRIPT_DIR/assets/note-wrong.md" > "$GEN/note-wrong.md"
RIGHT_NOTE_ID="$(ensure_skill right "$GEN/note-right.md")"
WRONG_NOTE_ID="$(ensure_skill wrong "$GEN/note-wrong.md")"

# ── 3. visibility and ownership ──────────────────────────────────
for pair in "checklist:$CHECKLIST_ID" "right:$RIGHT_NOTE_ID" "wrong:$WRONG_NOTE_ID"; do
  role="${pair%%:*}"; id="${pair#*:}"; [[ -n "$id" ]] || continue
  call "/v3/meta/asset/get" "{\"asset_id\":\"$id\"}" "$TMP/asset-$role.json" || true
  envelope_ok "$TMP/asset-$role.json" || die "$role: cannot read the asset record ($(envelope_msg "$TMP/asset-$role.json"))"
  vis="$(python3 -c "import json;print(json.load(open('$TMP/asset-$role.json'))['data'].get('visibility'))")"
  own="$(python3 -c "import json;d=json.load(open('$TMP/asset-$role.json'))['data'];print(d.get('owner_user_id') or '')")"
  [[ "$own" == "$C_USER" ]] || die "$role: asset record says owner=$own, expected C ($C_USER)"
  if [[ "$vis" == "team" ]]; then ok "$role: visibility=team owner=$own"
  elif (( CHECK_ONLY )); then warn "$role: visibility=$vis (needs team)"
  else
    call "/v3/meta/asset/update" "{\"asset_id\":\"$id\",\"visibility\":\"team\"}" "$TMP/vis-$role.json"
    envelope_ok "$TMP/vis-$role.json" || die "could not set visibility on $id: $(envelope_msg "$TMP/vis-$role.json")"
    ok "$role: visibility=team owner=$own"
  fi
done
(( CHECK_ONLY )) && { info "check only — pool not frozen"; exit 0; }

# ── 4. freeze, record, screen ────────────────────────────────────
info "freezing the pool …"
# The frozen pool for THIS scenario lives beside the task; the mainline's
# frozen snapshot at the fixed path is left untouched, so the two scenarios
# do not rewrite each other's baseline. run-once.sh --task prefers the copy
# beside the task when it exists.
TEAM_ID="$TEAM_ID" OUT="$TASK_SNAPSHOT" bash "$REPO_ROOT/evaluation/provenance/snapshot-assets.sh"
SNAP_AT="$(python3 -c "import json;print(json.load(open('$TASK_SNAPSHOT'))['pool_snapshot_at'])")"
python3 - "$PAIR_JSON" "$TASK_SNAPSHOT" "$TEAM_ID" "$C_AGENT" "$C_USER" "$CONSUMER_AGENT" "$SNAP_AT" "$SUFFIX" "$WRONG_ID" "$CHECKLIST_ID" "$RIGHT_NOTE_ID" "$WRONG_NOTE_ID" <<'PY'
import json, sys
out, snap_path, team, author_agent, author_user, consumer, snap_at, suffix, wrong_id, checklist, right, wrong = sys.argv[1:13]
snapshot = json.load(open(snap_path, encoding="utf-8")); by_id = {a["asset_id"]: a for a in snapshot["assets"]}
def row(role, aid):
    a = by_id.get(aid, {}); return {"role": role, "asset_id": aid, "name": a.get("name"), "version": a.get("version"), "producer_user_id": a.get("producer_user_id", ""), "producer_agent_id": a.get("producer_agent_id", "")}
json.dump({
    "scenario": "bridge-name", "team_id": team, "author_agent_id": author_agent, "author_user_id": author_user, "consumer_agent_id": consumer,
    "task_marker": "team-checklist-lookup", "suffix": suffix, "checklist_marker": f"qz7-{suffix}", "wrong_id": wrong_id,
    "pool_snapshot_at": snap_at, "pool_asset_count": snapshot["asset_count"],
    "assets": [row("checklist", checklist), row("right", right), row("wrong", wrong)],
    "discriminative_tokens": {"right": checklist, "wrong": wrong_id},
    "failure_class_when_wrong": "service refusal (core 40401 SKILL_NOT_FOUND / bridge 403 not_visible), not reachability",
    "expected_relation": "cross_user",
    "operated_by": "one person running every identity; author C is a distinct user id, not an independent human",
}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"  pair recorded: {out}")
PY
info "screening the notes' tokens against the frozen pool, the captured system prompt and the task text …"
node "$REPO_ROOT/evaluation/attribution/extract-tokens.mjs" "$GEN/note-wrong.md" "$GEN/note-right.md" \
  --pool="$TASK_SNAPSHOT" --capture="$REPO_ROOT/evaluation/gate0/artifacts/gate0-threechannel-capture.jsonl" \
  --contains="$SCRIPT_DIR/task.md" --out="$TOKENS" \
  || die "token screen failed — do not run the scenario until this passes"
ok "pool entered and frozen at $SNAP_AT; checklist $CHECKLIST_ID (marker qz7-$SUFFIX), right note $RIGHT_NOTE_ID, wrong note $WRONG_NOTE_ID (points at $WRONG_ID); tokens → $TOKENS"
