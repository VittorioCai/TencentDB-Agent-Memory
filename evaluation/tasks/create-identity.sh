#!/usr/bin/env bash
# Create an evaluation identity: a user, its membership in the evaluation
# team, and one agent it owns. Records ids (never keys) in identities.json.
#
# Why a script and not four curl lines in a notebook: the ids it creates are
# the producer/actor fields every event carries, and a second author only
# helps the author dimension if its assets are really written and validated
# under its own id. Recording the ids next to the run data keeps that claim
# checkable.
#
#   user      created with the admin key (only system_admin may create users)
#   member    added to the team by the team owner's key
#   agent     created with the new user's own key, owned by the new user
#
# The new user's key is written to deploy/global-images/.topic4-user-key-<tag>
# (mode 0600) and never printed.
#
# Usage:
#   bash evaluation/tasks/create-identity.sh --tag c --username topic4-eval-author-c --agent-name Topic4-Author-C

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_DIR="$REPO_ROOT/deploy/global-images"
CORE_URL="${CORE_URL:-http://localhost:8420}"
SERVICE_ID="${SERVICE_ID:-default}"
TEAM_ID="${TEAM_ID:-team-5ezfoladb5}"
ADMIN_KEY_FILE="$ENV_DIR/.admin-key"
OWNER_KEY_FILE="$ENV_DIR/.topic4-user-key"
IDS="$SCRIPT_DIR/identities.json"

TAG=""; USERNAME=""; AGENT_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --username) USERNAME="$2"; shift 2 ;;
    --agent-name) AGENT_NAME="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$TAG" && -n "$USERNAME" && -n "$AGENT_NAME" ]] || { echo "usage: create-identity.sh --tag X --username U --agent-name N" >&2; exit 2; }
[[ -f "$ADMIN_KEY_FILE" ]] || { echo "admin key not found: $ADMIN_KEY_FILE" >&2; exit 1; }
[[ -f "$OWNER_KEY_FILE" ]] || { echo "team owner key not found: $OWNER_KEY_FILE" >&2; exit 1; }

KEY_OUT="$ENV_DIR/.topic4-user-key-$TAG"
if [[ -f "$KEY_OUT" ]]; then echo "identity $TAG already has a key file: $KEY_OUT — refusing to overwrite" >&2; exit 1; fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Credential over stdin to curl; never on a command line.
call() {
  local keyfile="$1" path="$2" body="$3" out="$4" key
  key="$(tr -d '[:space:]' < "$keyfile")"
  printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$key" "$key" \
    | curl -sS -K - --max-time 25 -H 'content-type: application/json' -H "x-tdai-service-id: $SERVICE_ID" \
        -X POST "$CORE_URL$path" -d "$body" -o "$out"
}
ok() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get('code')==0 else 1)" "$1"; }
msg() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('message') or d)" "$1" 2>/dev/null | head -c 200; }
field() { python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data'][sys.argv[2]])" "$1" "$2"; }

# ── 1. user (admin key) ──────────────────────────────────────────
call "$ADMIN_KEY_FILE" /v3/meta/user/create "$(python3 -c 'import json,sys;print(json.dumps({"username":sys.argv[1]}))' "$USERNAME")" "$TMP/user.json"
ok "$TMP/user.json" || { echo "user/create failed: $(msg "$TMP/user.json")" >&2; exit 1; }
USER_ID="$(field "$TMP/user.json" user_id)"
# The key is written straight from the response to the file; it never touches a variable that could be echoed.
python3 -c "
import json,sys,os
d=json.load(open(sys.argv[1]))['data']; k=d.get('default_user_key') or d.get('user_key')
assert k, 'no key in response'
fd=os.open(sys.argv[2], os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600); os.write(fd, (k+'\n').encode()); os.close(fd)
" "$TMP/user.json" "$KEY_OUT"
echo "user     $USER_ID ($USERNAME) — key → $KEY_OUT (0600)"

# ── 2. team membership (owner key) ───────────────────────────────
call "$OWNER_KEY_FILE" /v3/meta/team-member/add "{\"team_id\":\"$TEAM_ID\",\"user_id\":\"$USER_ID\",\"role\":\"member\"}" "$TMP/member.json"
if ok "$TMP/member.json"; then echo "member   $USER_ID joined $TEAM_ID (role member, added by the team owner)"
else
  call "$ADMIN_KEY_FILE" /v3/meta/team-member/add "{\"team_id\":\"$TEAM_ID\",\"user_id\":\"$USER_ID\",\"role\":\"member\"}" "$TMP/member2.json"
  ok "$TMP/member2.json" && echo "member   $USER_ID joined $TEAM_ID (role member, added with the admin key; owner key refused: $(msg "$TMP/member.json"))" \
    || { echo "team-member/add failed: $(msg "$TMP/member.json") / $(msg "$TMP/member2.json")" >&2; exit 1; }
fi

# ── 3. agent (the new user's own key) ────────────────────────────
call "$KEY_OUT" /v3/meta/agent/create "$(python3 -c 'import json,sys;print(json.dumps({"team_id":sys.argv[1],"owner_user_id":sys.argv[2],"name":sys.argv[3]}))' "$TEAM_ID" "$USER_ID" "$AGENT_NAME")" "$TMP/agent.json"
ok "$TMP/agent.json" || { echo "agent/create failed: $(msg "$TMP/agent.json")" >&2; exit 1; }
AGENT_ID="$(field "$TMP/agent.json" agent_id)"
echo "agent    $AGENT_ID ($AGENT_NAME) owned by $USER_ID"

# ── 4. verify with the new key: the record reads back and skill/list answers ──
call "$KEY_OUT" /v3/meta/agent/get "{\"agent_id\":\"$AGENT_ID\"}" "$TMP/agent-get.json"
ok "$TMP/agent-get.json" || { echo "agent/get with the new key failed: $(msg "$TMP/agent-get.json")" >&2; exit 1; }
OWNER_BACK="$(field "$TMP/agent-get.json" owner_user_id)"
[[ "$OWNER_BACK" == "$USER_ID" ]] || { echo "agent owner reads back as $OWNER_BACK, expected $USER_ID" >&2; exit 1; }
call "$KEY_OUT" /v3/skill/list "{\"team_id\":\"$TEAM_ID\",\"agent_id\":\"$AGENT_ID\"}" "$TMP/list.json"
ok "$TMP/list.json" && echo "verify   agent owner reads back; /v3/skill/list answers code 0 with the new key" \
  || echo "verify   agent owner reads back; /v3/skill/list: $(msg "$TMP/list.json")"

# ── 5. record ids (never keys) ───────────────────────────────────
python3 - "$IDS" "$TAG" "$USERNAME" "$USER_ID" "$AGENT_ID" "$AGENT_NAME" "$TEAM_ID" <<'PY'
import json, sys, os, datetime
p, tag, username, user_id, agent_id, agent_name, team = sys.argv[1:8]
doc = json.load(open(p)) if os.path.exists(p) else {"identities": {}}
doc["identities"][tag] = {"username": username, "user_id": user_id, "agent_id": agent_id, "agent_name": agent_name, "team_id": team,
                          "key_file": f"deploy/global-images/.topic4-user-key-{tag}", "created_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                          "operator": "same person as every other evaluation identity; the id is what makes the author dimension computable, not an independent human"}
json.dump(doc, open(p, "w"), indent=2); print(f"recorded → {p}")
PY
