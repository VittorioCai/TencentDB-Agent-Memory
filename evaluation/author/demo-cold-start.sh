#!/usr/bin/env bash
# Cold start, end to end, in the product: a new skill by author A enters as a
# candidate, the consumer cannot read it, the author's own records are read
# and found to contradict its claim, and the review queue puts it first.
#
# Steps (each read back from Core, each recorded):
#   1. A creates `eval-bridge-endpoint-c` — a third convention skill that
#      documents the container address again. /v3/skill/create runs
#      ensureSkillAsset: status candidate, the cold-start decision written.
#   2. A shares it (visibility team). The consumer B still cannot list it:
#      status candidate is readable by owner, admins and reviewers only.
#   3. The evidence pack for A is rebuilt (it now includes the new skill),
#      the assessment runs for the new asset's claim, the verified summary
#      is written onto the asset, and the gate re-reads it.
#   4. gate/get shows pending, review priority high, the contradiction cited.
#
# Idempotent on the skill: if it already exists it is reused. Nothing here
# touches the mainline pair or the frozen baseline; the new asset is a
# candidate and never enters the consumer's whitelist.
#
# Usage:
#   bash evaluation/author/demo-cold-start.sh [--out F]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CORE_URL="${CORE_URL:-http://localhost:8420}"
SERVICE_ID="${SERVICE_ID:-default}"
IDS="$REPO_ROOT/evaluation/tasks/identities.json"
OUT="${2:-$SCRIPT_DIR/artifacts/cold-start-demo-$(date -u +%Y-%m-%d).json}"
[[ "${1:-}" == "--out" ]] && OUT="$2"
NAME="eval-bridge-endpoint-c"
DOMAIN="reaching the team skill bridge over HTTP from an agent session: which address answers"
CLAIM="the team skill bridge is reachable from an agent session at http://10.244.7.19:8096/skill-bridge/v3/skill/search"

die() { echo "[error] $*" >&2; exit 1; }
ok()  { echo "[ok] $*"; }
warn(){ echo "[warn] $*" >&2; }
info(){ echo "[$(date +%H:%M:%S)] $*"; }
id_of() { python3 -c "import json;print(json.load(open('$IDS'))['identities']['$1']['$2'])"; }
TEAM="$(id_of a team_id)"; A_USER="$(id_of a user_id)"; A_AGENT="$(id_of a agent_id)"; B_USER="$(id_of b user_id)"
A_KEY="$REPO_ROOT/$(id_of a key_file)"; B_KEY="$REPO_ROOT/$(id_of b key_file)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
call() {  # keyfile path body out
  local keyfile="$1" path="$2" body="$3" out="$4" key
  key="$(tr -d '[:space:]' < "$keyfile")"
  printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$key" "$key" \
    | curl -sS -K - --max-time 25 -H 'content-type: application/json' -H "x-tdai-service-id: $SERVICE_ID" -H 'x-tdai-read-purpose: manage' -X POST "$CORE_URL$path" -d "$body" -o "$out"
}
envelope_ok() { python3 -c "import json,sys;sys.exit(0 if json.load(open(sys.argv[1])).get('code')==0 else 1)" "$1"; }

# 1. the new skill, by A
call "$A_KEY" "/v3/skill/get-by-name" "$(python3 -c 'import json,sys;print(json.dumps({"team_id":sys.argv[1],"agent_id":sys.argv[2],"skill_name":sys.argv[3]}))' "$TEAM" "$A_AGENT" "$NAME")" "$TMP/exists.json"
if envelope_ok "$TMP/exists.json"; then
  SKILL_ID="$(python3 -c "import json;print(json.load(open('$TMP/exists.json'))['data']['skill_id'])")"
  info "$NAME already exists as $SKILL_ID — reusing"
else
  python3 - "$TEAM" "$A_USER" "$A_AGENT" "$NAME" > "$TMP/create.json" <<'PY'
import json, sys
team, user, agent, name = sys.argv[1:5]
content = f"""---
name: {name}
description: Draft convention for reaching the skill bridge from an agent session (proposed replacement for the current entry).
---

# Skill bridge address (draft)

Send skill searches to the bridge at:

    http://10.244.7.19:8096/skill-bridge/v3/skill/search

Required headers: `content-type: application/json`, `x-tdai-service-id: default`.
Body: `{{"query": "<keywords>"}}`. The address is the memory-core stack's
internal network; use it from any agent session.
"""
print(json.dumps({"team_id": team, "user_id": user, "agent_id": agent, "task_id": "default", "name": name, "content": content}))
PY
  call "$A_KEY" "/v3/skill/create" "@$TMP/create.json" "$TMP/created.json"
  envelope_ok "$TMP/created.json" || die "skill/create failed: $(cat "$TMP/created.json")"
  SKILL_ID="$(python3 -c "import json;print(json.load(open('$TMP/created.json'))['data']['skill_id'])")"
  ok "created $NAME → $SKILL_ID (author A)"
fi

# The asset record it got: status and the cold-start decision.
call "$A_KEY" "/v3/meta/asset/gate/get" "{\"asset_id\":\"$SKILL_ID\"}" "$TMP/gate0.json"
envelope_ok "$TMP/gate0.json" || die "gate/get failed: $(cat "$TMP/gate0.json")"
python3 -c "
import json; d=json.load(open('$TMP/gate0.json'))['data']; g=d.get('gate') or {}
print(f\"  at creation: status={d['status']} decision={g.get('decision')} review_priority={g.get('review_priority')}\")
for r in g.get('reasons',[]): print('    ', r)"

# 2. shared by A, still invisible to B
call "$A_KEY" "/v3/meta/asset/update" "{\"asset_id\":\"$SKILL_ID\",\"visibility\":\"team\"}" "$TMP/vis.json"
envelope_ok "$TMP/vis.json" || die "asset/update visibility failed: $(cat "$TMP/vis.json")"
call "$B_KEY" "/v3/meta/asset/list-accessible" "{\"user_id\":\"$B_USER\",\"team_id\":\"$TEAM\",\"visibility\":[\"team\"]}" "$TMP/b-list.json"
B_SEES="$(python3 -c "import json;print(json.dumps(sorted(a['asset_id'] for a in json.load(open('$TMP/b-list.json'))['data']['items'])))")"
call "$B_KEY" "/v3/meta/asset/check-permission" "{\"user_id\":\"$B_USER\",\"asset_id\":\"$SKILL_ID\",\"action\":\"read\"}" "$TMP/b-perm.json" || true
B_PERM="$(python3 -c "import json;d=json.load(open('$TMP/b-perm.json'));print(json.dumps(d.get('data') or d.get('message')))" 2>/dev/null || echo null)"
echo "  B's list-accessible (team): $B_SEES"
echo "  B's permission on the candidate: $B_PERM"

# 3. the author's own records, read and checked
info "proxy call export for A (execution-grade evidence) …"
CALLS="$TMP/calls-a.jsonl"
USER_ID="$A_USER" SINCE="30 DAY" OUT="$CALLS" bash "$REPO_ROOT/evaluation/gate0/export-tool-call-logs.sh" >/dev/null 2>&1 || { warn "call export failed; the pack will rest on trusted outcomes alone"; : > "$CALLS"; }
info "evidence pack for A (cutoff: now) …"
node "$SCRIPT_DIR/build-evidence-pack.mjs" --author=a --domain="$DOMAIN" --keywords="skill bridge address,10.244.7.19,127.0.0.1:47318,timed out,reachability,container,host" --asset="$SKILL_ID" --calls="$CALLS" --out="$SCRIPT_DIR/artifacts/evidence-pack-a-$SKILL_ID.json" | tail -2
info "assessment …"
node "$SCRIPT_DIR/assess.mjs" --pack="$SCRIPT_DIR/artifacts/evidence-pack-a-$SKILL_ID.json" --domain="$DOMAIN" --asset-claim="$CLAIM" --asset="$SKILL_ID" --out="$SCRIPT_DIR/artifacts/assessment-a-$SKILL_ID.json" | tail -1
info "writing it onto the asset through asset/gate/assessment (admin signs it) …"
bash "$SCRIPT_DIR/write-assessment.sh" "$SCRIPT_DIR/artifacts/assessment-a-$SKILL_ID.json" --out "$SCRIPT_DIR/artifacts/assessment-write-a-$SKILL_ID.json" | tail -4

# 4. what the queue sees now
call "$A_KEY" "/v3/meta/asset/gate/get" "{\"asset_id\":\"$SKILL_ID\"}" "$TMP/gate1.json"
call "$B_KEY" "/v3/meta/asset/list-accessible" "{\"user_id\":\"$B_USER\",\"team_id\":\"$TEAM\",\"visibility\":[\"team\"]}" "$TMP/b-list2.json"
python3 - "$TMP/gate0.json" "$TMP/gate1.json" "$TMP/b-list.json" "$TMP/b-list2.json" "$SKILL_ID" "$OUT" "$SCRIPT_DIR/artifacts/assessment-a-$SKILL_ID.json" <<'PY'
import json, sys, datetime, os
g0 = json.load(open(sys.argv[1]))["data"]; g1 = json.load(open(sys.argv[2]))["data"]
b0 = sorted(a["asset_id"] for a in json.load(open(sys.argv[3]))["data"]["items"]); b1 = sorted(a["asset_id"] for a in json.load(open(sys.argv[4]))["data"]["items"])
skill = sys.argv[5]; out = sys.argv[6]; a = json.load(open(sys.argv[7]))
au = g1['gate']['signals']['author']
print(f"  after the assessment: status={g1['status']} decision={g1['gate']['decision']} review_priority={g1['gate']['review_priority']} assessment={'accepted' if au.get('assessment') else 'ignored: ' + str(au.get('assessment_ignored'))}")
for r in g1["gate"]["reasons"]: print("    ", r)
print(f"  B's list-accessible now: {b1}  (candidate {skill} present: {skill in b1})")
rec = {"schema": "cold-start-demo-v2", "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
       "skill_id": skill, "name": "eval-bridge-endpoint-c", "author": "a",
       "at_creation": {"status": g0["status"], "gate": g0.get("gate")},
       "consumer_list_accessible_before": b0, "consumer_list_accessible_after": b1, "candidate_visible_to_consumer": skill in b1,
       "assessment": a["summary_for_gate"], "after_assessment": {"status": g1["status"], "gate": g1.get("gate")}}
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
json.dump(rec, open(out, "w"), indent=2, ensure_ascii=False); print(f"→ {out}")
PY
