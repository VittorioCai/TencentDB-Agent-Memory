#!/usr/bin/env bash
# One evaluation run, start to finish, leaving everything behind.
#
# What a run produces is not a verdict — it is a directory that can be reopened
# after the fact:
#
#   capture.jsonl        the raw bytes between proxy and model
#   tool-call-logs.jsonl the service's own records for the window
#   candidate-log.jsonl  the injector's candidate set, if it was enabled
#   events.jsonl         provenance events built from the above
#   early-events.jsonl   recalled / selected / injected
#   verdict.json         the acceptance result and why
#   cost.json            tokens and wall time for this run
#   run.json             the manifest tying them together
#
# Saved from the *first* run, not once the pipeline looks finished. A run whose
# raw inputs were not kept cannot be re-judged when the judge changes, and the
# judge is going to change.
#
# ERROR is not FAIL. A run where the task was never attempted, or where the
# outcome could not be read, says something about the harness rather than about
# the asset — so it is reported on its own line. It still counts in the total,
# because a denominator that quietly drops the runs that broke is how a
# collection failure turns into a good-looking result.
#
# Usage:
#   bash evaluation/runner/run-once.sh --label gate-off
#   bash evaluation/runner/run-once.sh --label gate-on --identity b
#
# Exit: 0 PASS · 1 FAIL · 2 ERROR — the same codes verify.mjs uses.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EVAL="$REPO_ROOT/evaluation"
RUNS_DIR="${RUNS_DIR:-$EVAL/runner/runs}"

LABEL="run"
IDENTITY="b"
SINCE="${SINCE:-30 MINUTE}"
AUTO=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    --since) SINCE="$2"; shift 2 ;;
    # Launch the task itself via run-codebuddy.sh -p instead of waiting for a
    # manual session. This spawns a brand-new CodeBuddy process every time, so
    # the session is guaranteed fresh — which the manual path could not
    # guarantee, and a stale session against a just-recreated proxy is rejected
    # before the probe (which sits upstream of the proxy) sees anything, giving
    # an empty capture that looks like the model did nothing.
    --auto) AUTO=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -t 1 ]]; then C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_B=$'\033[34m'; C_0=$'\033[0m'
else C_R=""; C_G=""; C_Y=""; C_B=""; C_0=""; fi
info() { echo "${C_B}[$(date +%H:%M:%S)]${C_0} $*"; }
warn() { echo "${C_Y}[warn]${C_0} $*"; }
die()  { echo "${C_R}[error]${C_0} $*" >&2; exit 2; }

# Two runs started in the same second must not share a directory: the second
# would overwrite the first's raw inputs, and those are the whole point of
# keeping a run.
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$LABEL"
if [[ -d "$RUNS_DIR/$RUN_ID" ]]; then
  n=2
  while [[ -d "$RUNS_DIR/$RUN_ID-$n" ]]; do n=$((n + 1)); done
  RUN_ID="$RUN_ID-$n"
fi
RUN_DIR="$RUNS_DIR/$RUN_ID"
mkdir -p "$RUN_DIR"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_EPOCH="$(date +%s)"

info "run $RUN_ID → $RUN_DIR"

# ── 1. the session ───────────────────────────────────────────────
# The capture is produced by the observability probe sitting between proxy and
# model. Where the probe sits is not a detail: a probe between client and proxy
# saw a system prompt with zero asset blocks while the proxy's own log showed
# several injected on every turn. Both were honest; injection happens inside.
CAPTURE="$RUN_DIR/capture.jsonl"
if [[ -n "${CAPTURE_FROM:-}" ]]; then
  cp "$CAPTURE_FROM" "$CAPTURE"
  info "capture supplied from $CAPTURE_FROM"
else
  PROBE_OUT="${PROBE_OUT:-$EVAL/gate0/artifacts/gate0-proxy-capture.jsonl}"

  # The probe appends, so without truncating, run N's capture contains runs
  # 1..N as well — and every count, cost figure and attribution in this run
  # would be about a mixture of sessions.
  BEFORE=0
  if [[ -f "$PROBE_OUT" ]]; then
    BEFORE="$(wc -l < "$PROBE_OUT" | tr -d ' ')"
    cp "$PROBE_OUT" "$RUN_DIR/capture-before.jsonl"
    : > "$PROBE_OUT"
    info "capture cleared ($BEFORE earlier line(s) kept as capture-before.jsonl)"
  fi

  bash "$EVAL/tasks/bridge-addr/use-identity.sh" "$IDENTITY" >/dev/null \
    || die "could not switch to identity $IDENTITY"

  TASK_FILE="$EVAL/tasks/bridge-addr/task.md"
  if (( AUTO )); then
    info "launching a fresh single-prompt CodeBuddy session (run-codebuddy.sh -p)"
    # -p spawns a new process, runs one prompt to completion (the agent still
    # loops through its own tool calls inside that turn), and exits. Its stdout
    # is the model's transcript; keep it for the record.
    if bash "$EVAL/gate0/run-codebuddy.sh" "$(cat "$TASK_FILE")" >"$RUN_DIR/codebuddy-stdout.txt" 2>&1; then
      info "session finished; transcript → codebuddy-stdout.txt"
    else
      warn "run-codebuddy.sh exited non-zero; see $RUN_DIR/codebuddy-stdout.txt (continuing to judge whatever was captured)"
    fi
  else
    info "identity $IDENTITY active; run the task in a ${C_B}fresh${C_0} CodeBuddy session, then press enter"
    echo "       task: $TASK_FILE"
    echo "       (or re-run with --auto to launch a fresh session for you)"
    read -r _
  fi

  if [[ ! -s "$PROBE_OUT" ]]; then
    die "the capture is empty — the probe saw no traffic.
       Most often this means the CodeBuddy session was not fresh: enable/prepare
       recreated the proxy, and a session opened before that is rejected before
       the probe can see it. Re-run with --auto, or start a brand-new session.
       State check: bash evaluation/runner/prepare.sh --status"
  fi
  cp "$PROBE_OUT" "$CAPTURE"
fi

# ── 2. the service's own records ─────────────────────────────────
TOOL_CALLS="$RUN_DIR/tool-call-logs.jsonl"
if SINCE="$SINCE" OUT="$TOOL_CALLS" bash "$EVAL/gate0/export-tool-call-logs.sh" >"$RUN_DIR/export.log" 2>&1; then
  info "$(wc -l < "$TOOL_CALLS" | tr -d ' ') service-side row(s)"
else
  warn "could not export tool_call_logs; see $RUN_DIR/export.log"
  : > "$TOOL_CALLS"
fi

CANDIDATES="$EVAL/provenance/artifacts/candidate-log.jsonl"
[[ -f "$CANDIDATES" ]] && cp "$CANDIDATES" "$RUN_DIR/candidate-log.jsonl"

# ── 3. acceptance ────────────────────────────────────────────────
# Run before attribution, and independently of it. Whether the task succeeded is
# a fact about the run; whether an asset helped is a judgement about that fact.
# Letting the second decide the first is how a scenario starts grading itself.
info "acceptance …"
node "$EVAL/tasks/bridge-addr/verify.mjs" "$CAPTURE" --json > "$RUN_DIR/verdict.json" 2>"$RUN_DIR/verify.log"
VERDICT_CODE=$?
VERDICT="$(python3 -c "import json;print(json.load(open('$RUN_DIR/verdict.json'))['verdict'])" 2>/dev/null || echo ERROR)"

# ── 4. attribution ───────────────────────────────────────────────
#
# The stages write to fixed paths under artifacts/, and this run copies from
# there. So the previous run's output is cleared first: otherwise a stage that
# fails leaves the last run's file in place, it gets copied in, and the run
# reports results belonging to a different session. Same shape as everything
# else guarded here — a step that could not run producing output that looks
# like it did.
for stale in "$EVAL/provenance/artifacts/provenance-events.jsonl" \
             "$EVAL/provenance/artifacts/early-events.jsonl" \
             "$EVAL/attribution/artifacts/run-artifacts.json" \
             "$EVAL/attribution/artifacts/used-events.jsonl"; do
  rm -f "$stale"
done

SNAPSHOT="$EVAL/provenance/artifacts/asset-pool-snapshot.json"
cp "$SNAPSHOT" "$RUN_DIR/asset-pool-snapshot.json" 2>/dev/null || warn "no pool snapshot to copy"

info "provenance …"
(cd "$REPO_ROOT" && node "$EVAL/provenance/build-events.mjs" "$SNAPSHOT" "$TOOL_CALLS" "$CAPTURE" \
  > "$RUN_DIR/provenance.md" 2>&1) || warn "build-events failed; see $RUN_DIR/provenance.md"
cp "$EVAL/provenance/artifacts/provenance-events.jsonl" "$RUN_DIR/events.jsonl" 2>/dev/null \
  || { warn "no provenance events produced"; : > "$RUN_DIR/events.jsonl"; }

(cd "$REPO_ROOT" && node "$EVAL/provenance/build-early-events.mjs" "$SNAPSHOT" "$TOOL_CALLS" "$CAPTURE" \
  ${CANDIDATES:+--candidates="$CANDIDATES"} > "$RUN_DIR/early.md" 2>&1) || warn "build-early-events failed"
cp "$EVAL/provenance/artifacts/early-events.jsonl" "$RUN_DIR/early-events.jsonl" 2>/dev/null || : > "$RUN_DIR/early-events.jsonl"

info "judgement …"
(cd "$REPO_ROOT" && node "$EVAL/attribution/collect-artifacts.mjs" "$CAPTURE" \
  --task="$EVAL/tasks/bridge-addr/task.md" >/dev/null 2>&1) || warn "collect-artifacts failed"
cp "$EVAL/attribution/artifacts/run-artifacts.json" "$RUN_DIR/run-artifacts.json" 2>/dev/null \
  || { warn "no artifacts collected"; echo "[]" > "$RUN_DIR/run-artifacts.json"; }
(cd "$REPO_ROOT" && node "$EVAL/attribution/judge-hard.mjs" \
  "$RUN_DIR/events.jsonl" "$RUN_DIR/run-artifacts.json" "$EVAL/attribution/artifacts/tokens.json" \
  > "$RUN_DIR/judgement.md" 2>&1) || warn "judge failed; see $RUN_DIR/judgement.md"
cp "$EVAL/attribution/artifacts/used-events.jsonl" "$RUN_DIR/used-events.jsonl" 2>/dev/null || : > "$RUN_DIR/used-events.jsonl"

# ── 5. cost ──────────────────────────────────────────────────────
# Collected every run, not only when someone remembers. Injection cost is paid
# on every turn by every person, so a reuse rate with no cost beside it argues
# only one side of the trade.
python3 - "$CAPTURE" "$RUN_DIR/cost.json" "$START_EPOCH" <<'PY'
import json, sys, time

capture, out, started = sys.argv[1], sys.argv[2], int(sys.argv[3])
turns = prompt = completion = 0
system_chars = 0
seen_usage = False

for line in open(capture, encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except ValueError:
        continue
    body = (e.get("body") or {}).get("json") or {}
    if e.get("event") == "http.request" and isinstance(body.get("messages"), list):
        turns += 1
        msgs = body["messages"]
        if msgs and msgs[0].get("role") == "system":
            c = msgs[0].get("content")
            system_chars = max(system_chars, len(c if isinstance(c, str) else json.dumps(c)))
    usage = body.get("usage") or {}
    if usage:
        seen_usage = True
        prompt += usage.get("prompt_tokens") or 0
        completion += usage.get("completion_tokens") or 0

json.dump({
    "turns": turns,
    "wall_seconds": int(time.time()) - started,
    "system_prompt_chars": system_chars,
    # Null rather than zero when the capture carried no usage block. Zero reads
    # as "measured, and it was free".
    "prompt_tokens": prompt if seen_usage else None,
    "completion_tokens": completion if seen_usage else None,
    "token_source": "capture usage block" if seen_usage else "not present in this capture",
}, open(out, "w", encoding="utf-8"), indent=2)
PY

# ── 6. manifest ──────────────────────────────────────────────────
python3 - "$RUN_DIR" "$RUN_ID" "$LABEL" "$IDENTITY" "$STARTED_AT" "$VERDICT" <<'PY'
import json, os, sys
run_dir, run_id, label, identity, started, verdict = sys.argv[1:7]

def count(name):
    p = os.path.join(run_dir, name)
    if not os.path.exists(p):
        return None
    return sum(1 for line in open(p, encoding="utf-8") if line.strip())

manifest = {
    "run_id": run_id,
    "label": label,
    "identity": identity,
    "started_at": started,
    "verdict": verdict,
    "counts": {n: count(n) for n in
               ("capture.jsonl", "tool-call-logs.jsonl", "candidate-log.jsonl",
                "events.jsonl", "early-events.jsonl", "used-events.jsonl")},
    "note": "verdict ERROR means the run could not be judged, not that it failed; "
            "it stays in the denominator so a collection failure cannot hide",
}
json.dump(manifest, open(os.path.join(run_dir, "run.json"), "w", encoding="utf-8"), indent=2)
PY

case "$VERDICT" in
  PASS)  echo "${C_G}PASS${C_0}  $RUN_ID" ;;
  FAIL)  echo "${C_R}FAIL${C_0}  $RUN_ID" ;;
  *)     echo "${C_Y}ERROR${C_0} $RUN_ID  — the run could not be judged; it still counts in the total" ;;
esac
python3 -c "import json;print('      ' + json.load(open('$RUN_DIR/verdict.json'))['reason'])" 2>/dev/null || :
echo "      $RUN_DIR"
exit "$VERDICT_CODE"
