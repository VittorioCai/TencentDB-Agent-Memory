#!/usr/bin/env bash
# The dev loop's runs, one arm at a time, each run with a fresh consumer:
#
#   bash evaluation/tasks/exit-code-fix/run-arm.sh --arm no-note --n 2
#   bash evaluation/tasks/exit-code-fix/run-arm.sh --arm note --n 2
#   bash evaluation/tasks/exit-code-fix/run-arm.sh --arm smoke --n 1     # not a sample
#
# Before an arm starts, the note's status in Core is read and must match the
# arm: `candidate` (not listed to consumers) for no-note, `approved` for note.
# Admission is the administrator's step (an experiment preparation action);
# this script never changes a status. Every run's id, exit, consumer and
# verdict go into devloop-runs.json beside this script, appended, never
# rewritten — the manifest is the formal list of the loop's runs.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
ARM=""; N=1
while [[ $# -gt 0 ]]; do case "$1" in --arm) ARM="$2"; shift 2;; --n) N="$2"; shift 2;; *) echo "unknown: $1" >&2; exit 2;; esac; done
case "$ARM" in no-note|note|smoke) ;; *) echo "--arm must be no-note, note or smoke" >&2; exit 2;; esac
MANIFEST="$HERE/devloop-runs.json"
[[ -f "$MANIFEST" ]] || echo '{"task":"exit-code-fix","runs":[]}' > "$MANIFEST"

NOTE_ID="$(python3 -c "import json;print([k for k in json.load(open('$HERE/tokens.json')) if not k.startswith('_')][0])")"
STATUS="$(node --input-type=module -e "
import { readFileSync } from 'node:fs';
const k = readFileSync('$REPO/deploy/global-images/.topic4-user-key', 'utf8').replace(/\s+/g, '');
const r = await fetch('http://localhost:8420/v3/meta/asset/get', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tdai-service-id': 'default', authorization: 'Bearer ' + k, 'x-tdai-user-key': k }, body: JSON.stringify({ asset_id: '$NOTE_ID' }) }).then((r) => r.json()).catch(() => ({}));
console.log((r?.data?.status ?? 'unreadable') + ' ' + (r?.data?.visibility ?? 'unreadable'));
")"
VISIBILITY="${STATUS#* }"; STATUS="${STATUS%% *}"
case "$ARM" in
  no-note|smoke) [[ "$STATUS" == "candidate" ]] || { echo "the note $NOTE_ID is '$STATUS' in Core; the $ARM arm needs it hidden (candidate). Nothing run." >&2; exit 2; } ;;
  note) [[ "$STATUS" == "approved" ]] || { echo "the note $NOTE_ID is '$STATUS' in Core; the note arm needs it admitted (approved) — the administrator's step. Nothing run." >&2; exit 2; }
        # a private skill is excluded from other users' searches (2026-09-11: two note-arm runs voided for this); the owner sets team via fill-note.mjs --fix-visibility
        [[ "$VISIBILITY" == "team" ]] || { echo "the note $NOTE_ID is visibility='$VISIBILITY' in Core; the note arm needs team visibility or the consumer's search never returns it. Nothing run." >&2; exit 2; } ;;
esac
TASK_SHA="$(shasum -a 256 "$HERE/task.md" | cut -c1-64)"
echo "note $NOTE_ID status in Core: $STATUS, visibility $VISIBILITY (arm $ARM); task.md sha256 ${TASK_SHA:0:12}…"
# every invocation records what it observed, so the report can show when the note was approved and when it was set back
python3 - "$MANIFEST" "$STATUS" "$ARM" "$N" "$TASK_SHA" "$VISIBILITY" <<'PY'
import json, sys, datetime
m, status, arm, n, sha, vis = sys.argv[1:7]
doc = json.load(open(m)); doc.setdefault("status_observations", []).append({"at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "note_status": status, "note_visibility": vis, "arm": arm, "n": int(n), "task_md_sha256": sha})
json.dump(doc, open(m, "w"), indent=2, ensure_ascii=False); open(m, "a").write("\n")
PY

# `seq 1 0` counts DOWN ("1 0") — with --n 0 that started two runs on 2026-09-11 (the note arm's first pair); guard it
(( N > 0 )) || { echo "--n $N: status recorded, nothing run"; exit 0; }
for i in $(seq 1 "$N"); do
  log="$(mktemp)"
  bash "$REPO/evaluation/runner/run-once.sh" --task "$HERE" --auto --fresh-consumer --label "devloop-$ARM" > "$log" 2>&1; rc=$?
  rid="$(grep -oE 'run [0-9TZ]+-devloop-[a-z-]+(-[0-9]+)? →' "$log" | head -1 | sed -E 's/^run //; s/ →$//')"
  dir="$(grep -oE '/private/tmp/topic4-runs/[^ ]+' "$log" | tail -1)"
  NOTE_VISIBILITY="$VISIBILITY" python3 - "$MANIFEST" "$ARM" "$i" "${rid:-unknown}" "$rc" "$dir" "$STATUS" "$TASK_SHA" <<'PY'
import json, sys, os, datetime
m, arm, i, rid, rc, d, status, task_sha = sys.argv[1:9]
doc = json.load(open(m))
def load(n):
    p = os.path.join(d, n)
    try: return json.load(open(p)) if p and os.path.exists(p) else None
    except ValueError: return None
run, verdict, consumer, mc = load("run.json"), load("verdict.json"), load("consumer.json"), load("memory-channel.json")
doc["runs"].append({"arm": arm, "sample": arm != "smoke", "seq": int(i), "run_id": rid, "exit": int(rc), "dir": d,
  "note_status_at_start": status, "note_visibility_at_start": os.environ.get("NOTE_VISIBILITY"), "task_md_sha256": task_sha,
  "consumer_agent_id": (consumer or {}).get("agent_id"),
  "verdict": (verdict or {}).get("verdict"), "attempts": [a.get("value") for a in (verdict or {}).get("attempts", [])],
  "memory_channel_ok": (mc or {}).get("ok"), "started_at": (run or {}).get("started_at"),
  "recorded_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
json.dump(doc, open(m, "w"), indent=2, ensure_ascii=False); open(m, "a").write("\n")
print(f"[{i}] {arm}  {rid}  exit={rc}  verdict={(verdict or {}).get('verdict')}  consumer={(consumer or {}).get('agent_id')}  memory_ok={(mc or {}).get('ok')}")
PY
  cat "$log" >> "${MANIFEST%.json}.log"; rm -f "$log"
done
echo "manifest → $MANIFEST (driver log ${MANIFEST%.json}.log, not committed)"
