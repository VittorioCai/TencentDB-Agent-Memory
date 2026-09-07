#!/usr/bin/env bash
# Publish a corrected version of the consumer's auto-extracted skill, keeping
# the old one in the version history with its applicability stated.
#
# Background (2026-09-06 review, item 4): the first evidence-base run left a
# consumer-owned skill in the evaluation team — `skill-bridge-http-access`,
# extracted by the product from identity B's own session. Its v2 body says
# get-by-name is owner-only (true before proxy commit 87bb79a, false since),
# tells the model to probe every documented address whenever skills disagree
# (which prescribed the off arm's second dial), and carries the acceptance
# marker query — harness knowledge that leaked into a team asset.
#
# The right move for a pooled asset that has gone stale is not to edit history:
# `/v3/skill/update` appends a version, v2 stays readable through
# `/v3/skill/versions`, and v3 states which bridge each version describes. The
# asset's author is B, so the write is made as B, with B's key over stdin.
#
# Usage:
#   bash evaluation/tasks/bridge-addr/revise-consumer-skill.sh            # apply
#   bash evaluation/tasks/bridge-addr/revise-consumer-skill.sh --check    # show head vs file, no write
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_DIR="$REPO_ROOT/deploy/global-images"
CORE_URL="${CORE_URL:-http://localhost:8420}"
KEY_FILE="$ENV_DIR/.topic4-user-key-b"
IDS="$SCRIPT_DIR/../identities.json"
SKILL_NAME="skill-bridge-http-access"
NEW_BODY="$SCRIPT_DIR/assets/consumer-skill-v3.md"
OLD_BODY="$SCRIPT_DIR/assets/consumer-skill-v2.md"
RECORD="$SCRIPT_DIR/consumer-skill-revision.json"
CHECK_ONLY=0; [[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

[[ -f "$KEY_FILE" ]] || { echo "identity B's key not found: $KEY_FILE" >&2; exit 1; }
TEAM_ID="$(python3 -c "import json;print(json.load(open('$IDS'))['team_id'])")"
B_USER="$(python3 -c "import json;print(json.load(open('$IDS'))['identities']['b']['user_id'])")"
B_AGENT="$(python3 -c "import json;print(json.load(open('$IDS'))['identities']['b']['agent_id'])")"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
call() {  # path body out — key over stdin, never in argv
  local path="$1" body="$2" out="$3" key
  key="$(tr -d '[:space:]' < "$KEY_FILE")"
  printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$key" "$key" \
    | curl -sS -K - --max-time 25 -H 'content-type: application/json' -H 'x-tdai-service-id: default' \
        -X POST "$CORE_URL$path" -d "$body" -o "$out"
}
ok() { python3 -c "import json,sys;sys.exit(0 if json.load(open('$1')).get('code')==0 else 1)"; }

call "/v3/skill/get-by-name" "$(python3 -c 'import json,sys;print(json.dumps({"team_id":sys.argv[1],"agent_id":sys.argv[2],"skill_name":sys.argv[3],"include_content":True}))' "$TEAM_ID" "$B_AGENT" "$SKILL_NAME")" "$TMP/head.json"
ok "$TMP/head.json" || { echo "cannot read $SKILL_NAME as B: $(cat "$TMP/head.json")" >&2; exit 1; }
SKILL_ID="$(python3 -c "import json;print(json.load(open('$TMP/head.json'))['data']['skill_id'])")"
HEAD_VER="$(python3 -c "import json;print(json.load(open('$TMP/head.json'))['data']['version'])")"
python3 -c "import json;open('$TMP/head.md','w',encoding='utf-8').write(json.load(open('$TMP/head.json'))['data'].get('content') or '')"

echo "head: $SKILL_ID v$HEAD_VER ($(wc -c < "$TMP/head.md" | tr -d ' ') chars)"
if cmp -s "$TMP/head.md" "$NEW_BODY"; then echo "head already equals $NEW_BODY — nothing to do"; exit 0; fi
if ! cmp -s "$TMP/head.md" "$OLD_BODY"; then
  echo "head body differs from the recorded v2 ($OLD_BODY); refusing to write over an unrecorded version" >&2
  diff "$OLD_BODY" "$TMP/head.md" | head -20 >&2 || true
  exit 1
fi
if (( CHECK_ONLY )); then diff "$OLD_BODY" "$NEW_BODY" || true; exit 0; fi

python3 - "$TEAM_ID" "$B_USER" "$B_AGENT" "$SKILL_ID" "$HEAD_VER" "$NEW_BODY" > "$TMP/upd.json" <<'PY'
import json, sys
team, user, agent, skill_id, version, path = sys.argv[1:7]
print(json.dumps({"team_id": team, "user_id": user, "agent_id": agent, "skill_id": skill_id,
                  "expected_version": int(version), "content": open(path, encoding="utf-8").read()}))
PY
call "/v3/skill/update" "@$TMP/upd.json" "$TMP/res.json"
ok "$TMP/res.json" || { echo "update failed: $(cat "$TMP/res.json")" >&2; exit 1; }
NEW_VER="$(python3 -c "import json;print(json.load(open('$TMP/res.json'))['data'].get('version','?'))")"

# Read back: the head must now be v3 with the new body, and v2 must still be there.
call "/v3/skill/get" "$(python3 -c 'import json,sys;print(json.dumps({"team_id":sys.argv[1],"agent_id":sys.argv[2],"skill_id":sys.argv[3],"include_content":True}))' "$TEAM_ID" "$B_AGENT" "$SKILL_ID")" "$TMP/after.json"
python3 -c "import json;open('$TMP/after.md','w',encoding='utf-8').write(json.load(open('$TMP/after.json'))['data'].get('content') or '')"
cmp -s "$TMP/after.md" "$NEW_BODY" || { echo "read-back body differs from $NEW_BODY" >&2; exit 1; }
call "/v3/skill/versions" "$(python3 -c 'import json,sys;print(json.dumps({"team_id":sys.argv[1],"agent_id":sys.argv[2],"skill_id":sys.argv[3]}))' "$TEAM_ID" "$B_AGENT" "$SKILL_ID")" "$TMP/versions.json" || true

python3 - "$SKILL_ID" "$HEAD_VER" "$NEW_VER" "$OLD_BODY" "$NEW_BODY" "$TMP/versions.json" "$RECORD" "$B_USER" "$B_AGENT" <<'PY'
import hashlib, json, sys, datetime, os
skill_id, old_v, new_v, old_p, new_p, versions_p, record_p, user, agent = sys.argv[1:10]
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
versions = None
if os.path.exists(versions_p):
    try:
        d = json.load(open(versions_p)); versions = d.get("data")
    except Exception: versions = None
rec = {
  "schema": "consumer-skill-revision-v1",
  "revised_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "skill_id": skill_id, "name": "skill-bridge-http-access",
  "author": {"user_id": user, "agent_id": agent, "written_as": "B (the asset's owner), key over stdin"},
  "from_version": int(old_v), "to_version": int(new_v) if str(new_v).isdigit() else new_v,
  "old_body_sha256": sha(old_p), "new_body_sha256": sha(new_p),
  "old_body_file": os.path.relpath(old_p, os.path.dirname(record_p)),
  "new_body_file": os.path.relpath(new_p, os.path.dirname(record_p)),
  "why": [
    "get-by-name is no longer owner-only since proxy commit 87bb79a (2026-09-05); v2 said it was",
    "probe-every-candidate is scoped to diagnostic tasks; v2 made it the default, which prescribed the off arm's second dial (COMPARISON 2026-09-06, confounders)",
    "the acceptance marker query team-bridge-reachability is harness knowledge and is removed from the team asset",
  ],
  "old_version_kept": "yes — /v3/skill/update appends; v2 remains readable through /v3/skill/versions and its applicability is stated at the top of v3",
  "versions_after": versions,
}
json.dump(rec, open(record_p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"recorded → {record_p}")
PY
echo "published $SKILL_ID v$HEAD_VER → v$NEW_VER; read-back matches $NEW_BODY"
