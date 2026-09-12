#!/usr/bin/env bash
# Reproduce, against the live product, what the upstream `fix(memory-core): expose
# extraction configuration in skill archive responses` PR addresses.
#
# Claim under test — deliberately narrow, after the 2026-09-12 expert review:
#   with `skill.extraction.enabled: false`, `POST /v3/skill/extract` answers
#   `code: 0` + `task_id`, the slice IS archived and the task IS registered and
#   enqueued, and NOTHING in the response says the task cannot be executed in
#   this configuration.
#
# What this script does NOT claim:
#   - that the task is "never queued" (it is queued — trigger-service.ts appends
#     the task and calls enqueueAgent inside the tasks mutex);
#   - that every storage mode behaves this way (the extractor is constructed per
#     storage mode: service builds one per instance, standalone uses the process
#     singleton — this reproduction is the standalone/sqlite path only);
#   - anything about retry policy for tasks already in the queue.
#
# Evidence collected (the expert's requirement — "no new candidate assets" is NOT
# used as evidence on its own, since a real extraction may also produce none):
#   ① the HTTP response, verbatim
#   ② the agent's `_tasks.json` before and after → the task entry really is there
#   ③ Core's log for this request id → archive + write_tasks + enqueue, and
#      whatever the worker then does with a task it cannot extract
#
# Usage: bash evaluation/upstream/skill-extraction-flag/reproduce.sh [--keep]
#   default: removes this run's residue (archive + task entry) and restarts Core
#   --keep:  leaves the residue in place for inspection
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_DIR="$REPO_ROOT/deploy/global-images"
KEY_FILE="$ENV_DIR/.topic4-user-key"
CORE_URL="${CORE_URL:-http://localhost:8420}"
SERVICE_ID="${SERVICE_ID:-default}"
CONTAINER="${CORE_CONTAINER:-tdai-memory-core}"
KEEP=0; [[ "${1:-}" == "--keep" ]] && KEEP=1

# identity a (evaluation/tasks/identities.json); the agent id is synthetic so the
# residue never lands in a directory the delivery reads.
USER_ID="usr-n68ea5ythq"; TEAM_ID="team-5ezfoladb5"
AGENT_ID="agt-repro-extraction-flag"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SESSION="repro-extraction-flag-$STAMP"
OUT="$SCRIPT_DIR/artifacts/reproduce-$STAMP.json"
die() { echo "[error] $*" >&2; exit 1; }

[[ -f "$KEY_FILE" ]] || die "identity a's key not found: $KEY_FILE"
SWITCH="$(bash "$REPO_ROOT/evaluation/runner/core-extraction.sh" status 2>&1)"
echo "[1/6] $SWITCH"
[[ "$SWITCH" == *"file=false container=enabled:false"* ]] \
  || die "this reproduction needs extraction OFF; got: $SWITCH (set it with core-extraction.sh off --record)"

TASKS_KEY="skill_buffer/$USER_ID/$TEAM_ID/$AGENT_ID/_tasks.json"
in_core() { docker exec "$CONTAINER" sh -c "$1" 2>&1; }
# The local content backend writes under /data/tdai-memory; find the file rather
# than hard-coding the subPath, which is configurable.
find_tasks() { in_core "find /data -path '*$AGENT_ID/_tasks.json' 2>/dev/null | head -1" | tr -d '\r'; }

BEFORE_FILE="$(find_tasks)"
BEFORE_JSON="$( [[ -n "$BEFORE_FILE" ]] && in_core "cat '$BEFORE_FILE'" || echo "null" )"
echo "[2/6] _tasks.json before: ${BEFORE_FILE:-<absent>}"

SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BODY="$(python3 - "$USER_ID" "$TEAM_ID" "$AGENT_ID" "$SESSION" <<'PY'
import json, sys
u, t, a, s = sys.argv[1:5]
print(json.dumps({
  "user_id": u, "team_id": t, "agent_id": a, "session_id": s,
  "reason": "upstream PR reproduction: extraction switch is not visible in the archive response",
  "messages": [
    {"role": "user", "content": "the runner could not find the task id on macOS; what is the fix"},
    {"role": "assistant", "content": "BSD sed has no \\b word boundary — match the id with [[:space:]] instead."},
  ],
}))
PY
)"
RESP="$SCRIPT_DIR/artifacts/.resp-$STAMP.json"
key="$(tr -d '[:space:]' < "$KEY_FILE")"
# The credential goes to curl over stdin so it never reaches ps or shell history.
printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$key" "$key" \
  | curl -sS -K - --max-time 30 -H 'content-type: application/json' \
      -H "x-tdai-service-id: $SERVICE_ID" -X POST "$CORE_URL/v3/skill/extract" \
      -d "$BODY" -o "$RESP" || die "curl failed"
unset key
echo "[3/6] response: $(head -c 400 "$RESP")"
REQ_ID="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('request_id') or '')" "$RESP")"
TASK_ID="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print((d.get('data') or d).get('task_id') or '')" "$RESP")"

sleep 8   # give the worker pool a chance to pick the agent up
AFTER_FILE="$(find_tasks)"
AFTER_JSON="$( [[ -n "$AFTER_FILE" ]] && in_core "cat '$AFTER_FILE'" || echo "null" )"
echo "[4/6] _tasks.json after: ${AFTER_FILE:-<absent>}"

LOGS="$(docker logs "$CONTAINER" --since "$SINCE" 2>&1 | grep -E "$SESSION|$TASK_ID|$REQ_ID|skill-worker|SkillExtractor|extractor" | head -40)"
echo "[5/6] core log lines matched: $(printf '%s' "$LOGS" | grep -c . )"

export BEFORE_JSON AFTER_JSON LOGS
python3 - "$OUT" "$RESP" "$STAMP" "$SWITCH" "$TASK_ID" "$REQ_ID" "$BEFORE_FILE" "$AFTER_FILE" "$SESSION" "$AGENT_ID" <<'PY'
import json, os, sys

def as_json(raw):
    """The file's content when it parses; otherwise the raw text, so a read error is visible rather than swallowed."""
    raw = (raw or "").strip()
    if not raw or raw == "null": return None
    try: return json.loads(raw)
    except json.JSONDecodeError: return {"unparsed": raw[:2000]}

out, resp, stamp, switch, task_id, req_id, before_f, after_f, session, agent = sys.argv[1:11]
rec = {
  "at": stamp, "what": "live reproduction for the upstream extraction-flag PR",
  "claim": "extraction off: /v3/skill/extract archives, registers and enqueues the task, and the response carries no field saying the task cannot be executed in this configuration",
  "not_claimed": [
    "that the task is never queued — it is queued (trigger-service.ts writeTasks + enqueueAgent inside the tasks mutex)",
    "that every storage mode behaves this way — this is the standalone/sqlite path; service mode builds the extractor per instance",
    "anything about retry policy for tasks already in the queue",
    "that an empty candidate pool proves the task did not run — a real extraction may also produce nothing",
  ],
  "switch": switch, "session_id": session, "agent_id": agent,
  "request_id": req_id, "task_id": task_id,
  "response": json.load(open(resp)),
  "tasks_file": {"before": before_f or None, "after": after_f or None},
  "tasks_before": as_json(os.environ.get("BEFORE_JSON")),
  "tasks_after": as_json(os.environ.get("AFTER_JSON")),
  "core_log": [l for l in (os.environ.get("LOGS") or "").split("\n") if l.strip()],
}
json.dump(rec, open(out, "w"), ensure_ascii=False, indent=2)
open(out, "a").write("\n")
print(f"record → {out}")
PY
rm -f "$RESP"

if [[ $KEEP -eq 0 ]]; then
  echo "[6/6] cleanup: removing this run's archive + task entry, then restarting Core"
  in_core "find /data -path '*$AGENT_ID*' -print -delete" >/dev/null
  docker restart "$CONTAINER" >/dev/null || die "could not restart $CONTAINER"
  for _ in $(seq 1 45); do [[ "$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null)" == healthy ]] && break; sleep 2; done
  echo "[6/6] $(bash "$REPO_ROOT/evaluation/runner/core-extraction.sh" status)"
else
  echo "[6/6] --keep: residue left in place (agent $AGENT_ID)"
fi
