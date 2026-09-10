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
# Resolved after the options are parsed (below), so --task can override.
RUNS_DIR="${RUNS_DIR:-$EVAL/runner/runs}"

LABEL=""
IDENTITY="b"
TASK_DIR=""
SINCE="${SINCE:-30 MINUTE}"
AUTO=0
GATE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    # --task <dir>: the scenario directory (task.md, verify.mjs, confounders.watch,
    # optional tokens.json / gate_baseline.json / probe-*.mjs). Default: the mainline.
    --task) TASK_DIR="$2"; shift 2 ;;
    # --gate on|off: reset the scenario assets' visibility to the frozen
    # baseline before the session (off), or reset and then hide what the
    # baseline's decisions reject (on). Both arms start from the same pool;
    # the label defaults to gate-on / gate-off so the aggregate groups them.
    --gate) GATE="$2"; shift 2 ;;
    # --ablate <asset_id>[,<asset_id>]: leave-one-out. Reset to the baseline,
    # then hide the named asset(s) for this session only. The truth this
    # produces is behavioural: did the run change without the asset?
    --ablate) ABLATE="$2"; shift 2 ;;
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
case "$GATE" in
  ""|on|off) ;;
  *) echo "--gate must be on or off, got: $GATE" >&2; exit 2 ;;
esac
ABLATE="${ABLATE:-}"
if [[ -n "$ABLATE" && -n "$GATE" ]]; then
  echo "--ablate and --gate are different experiments; pick one" >&2; exit 2
fi
TASK_DIR="${TASK_DIR:-$EVAL/tasks/bridge-addr}"
[[ -d "$TASK_DIR" && -f "$TASK_DIR/task.md" && -f "$TASK_DIR/verify.mjs" ]] || { echo "--task must name a scenario directory with task.md and verify.mjs, got: $TASK_DIR" >&2; exit 2; }
TASK_NAME="$(basename "$TASK_DIR")"
[[ -n "$LABEL" ]] || LABEL="${GATE:+gate-$GATE}"
[[ -n "$LABEL" ]] || LABEL="${ABLATE:+loo-${ABLATE##*-}}"
[[ -n "$LABEL" ]] || LABEL="run"

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
# Records are staged OUTSIDE the repository during the run, in their own unique
# parent so `ls ..` from the run dir shows no sibling runs, and moved into
# runs/ only after the session and analysis finish (2026-09-10, 方案 2 补充二).
# A model with a shell reached the repo through a harness process's cwd; no run
# record — verdict.json's attempts[].value, receipts, tool-call logs — sits in
# the repo tree while a session that could read it is alive.
FINAL_RUN_DIR="$RUNS_DIR/$RUN_ID"
RECORDS_ROOT="${RUN_RECORDS_ROOT:-/private/tmp/topic4-runs}"
mkdir -p "$RECORDS_ROOT"
STAGE_PARENT="$(mktemp -d "$RECORDS_ROOT/$RUN_ID.XXXX")"
RUN_DIR="$STAGE_PARENT/$RUN_ID"
mkdir -p "$RUN_DIR"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_EPOCH="$(date +%s)"

info "run $RUN_ID → $RUN_DIR"

# ── 0. the gate ──────────────────────────────────────────────────
# Before the session, never after: the model must see the pool the gate left.
# Both arms reset to the frozen baseline first, so the third gate-on run faces
# the same gate as the first; nothing this run produces feeds back into it.
# The state the product then reports is read back and kept with the run — a
# run whose gate state is unknown is not comparable with anything, so a
# failure here ends the run before a capture exists that could be misread.
# The frozen baseline this run starts from. A batch pins its own (batch 3
# runs against gate_baseline_batch3.json, which names the rules version and
# the commit) by exporting GATE_BASELINE; the default is unchanged, so a
# rerun of an earlier batch reproduces it.
GATE_BASELINE="${GATE_BASELINE:-$EVAL/gate/artifacts/gate_baseline.json}"
[[ -f "$TASK_DIR/gate_baseline.json" ]] && GATE_BASELINE="$TASK_DIR/gate_baseline.json"
if [[ ( -n "$GATE" || -n "$ABLATE" ) && -z "${CAPTURE_FROM:-}" ]]; then
  [[ -f "$GATE_BASELINE" ]] || die "gate/ablation requested but no baseline at $GATE_BASELINE (build it: node evaluation/gate/build-baseline.mjs …)"
  FROZEN="$(python3 -c "import json;print(json.load(open('$GATE_BASELINE'))['frozen_at'])")"
  if [[ -n "$ABLATE" ]]; then
    # Leave-one-out: baseline for everything, private for the named asset(s).
    # The gate's decisions are not applied; the question is what the model
    # does without this asset, not what the gate would do about it.
    info "ablation: hiding $ABLATE, everything else at the baseline frozen $FROZEN"
    bash "$EVAL/gate/apply.sh" --hide "$ABLATE" --baseline "$GATE_BASELINE" --out "$RUN_DIR/gate-apply.json" \
      || die "ablation could not be applied and read back; the run is not started"
  else
    # Since 2026-09-07 the gate is the product's: Core holds the outcomes,
    # decides, and writes the asset's status; the bridge's whitelist does the
    # hiding. "off" = every baseline asset approved; "on" = Core evaluates
    # from the outcomes --seed put on file. The visibility-flipping apply.sh
    # is kept for ablation only (GATE_MECHANISM=visibility restores it for
    # a like-for-like rerun of the earlier batch).
    GATE_MODE="reset"; [[ "$GATE" == "on" ]] && GATE_MODE="apply"
    if [[ "${GATE_MECHANISM:-core}" == "visibility" ]]; then
      info "gate $GATE: $GATE_MODE visibility from the baseline frozen $FROZEN (old mechanism)"
      bash "$EVAL/gate/apply.sh" "--$GATE_MODE" --baseline "$GATE_BASELINE" --out "$RUN_DIR/gate-apply.json" \
        || die "gate $GATE could not be applied and read back; the run is not started"
    else
      info "gate $GATE: $GATE_MODE status through Core, baseline frozen $FROZEN"
      bash "$EVAL/gate/core-gate.sh" "--$GATE_MODE" --baseline "$GATE_BASELINE" --out "$RUN_DIR/gate-apply.json" \
        || die "gate $GATE could not be applied and read back through Core; the run is not started"
    fi
  fi
  cp "$GATE_BASELINE" "$RUN_DIR/gate_baseline.json"
fi

# ── 0b. the agent's own memory, snapshotted ──────────────────────
# L2 scene blocks and the L3 persona live under
# profiles/<team|agent>/ and are the product's own memory of this agent.
# They accumulate ACROSS runs: batch 3 found a scene block, written at
# 07:56:30 in the middle of that batch's own 07:51–07:58 window, carrying
# conclusions from earlier runs ("endpoint-b … outranks documented-but-silent
# endpoint-a") and both scenario addresses. The model reached it through the
# product's own `scenario/read`, so run five was reading what runs one to
# four had taught it — the arm was not five independent samples.
#
# Snapshot before, restore after, and record the hash either way, so a run
# either starts from the same memory as its siblings or says that it did not.
MEM_ROOT="${MEM_ROOT:-/data/tdai-memory/profiles}"
MEM_SNAP="$RUN_DIR/agent-memory-before.tar.gz"
mem_hash() {  # prints a stable hash of the agent memory tree, or "absent"
  docker exec "${CORE_CONTAINER:-tdai-memory-core}" sh -c \
    "cd '$MEM_ROOT' 2>/dev/null && find . -type f | LC_ALL=C sort | xargs -r sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1" 2>/dev/null || echo absent
}
# The consumer's own share of that tree. The whole-tree hash drifts when the
# memory pipeline writes to *another* agent's profile — measured 2026-09-08
# 23:20Z, 73 minutes after the isolated batch, four files of the old consumer
# rewritten — and those files never reach this run's model. Comparing start
# points across a batch therefore uses this hash when it is recorded; the
# whole-tree hash stays as the rollback check. The agent comes from MEM_AGENT,
# else from the proxy's forced identity, which is what decides the session.
MEM_AGENT="${MEM_AGENT:-$(sed -n '/debugForceIdentity:/,/task_id/p' "$REPO_ROOT/deploy/global-images/.proxy-config/config.yaml" 2>/dev/null | sed -n 's/^ *agent_id: *"\{0,1\}\([^" ]*\)"\{0,1\}.*/\1/p' | head -1)}"
mem_hash_scoped() {  # hash of the files under the consumer's profile dir(s), "absent" if none
  [[ -n "$MEM_AGENT" ]] || { echo absent; return; }
  docker exec "${CORE_CONTAINER:-tdai-memory-core}" sh -c \
    "cd '$MEM_ROOT' 2>/dev/null && find . -type f -path '*agent%3A$MEM_AGENT*' | LC_ALL=C sort | xargs -r sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1" 2>/dev/null || echo absent
}
mem_files_scoped() {
  [[ -n "$MEM_AGENT" ]] || { echo 0; return; }
  docker exec "${CORE_CONTAINER:-tdai-memory-core}" sh -c \
    "cd '$MEM_ROOT' 2>/dev/null && find . -type f -path '*agent%3A$MEM_AGENT*' | wc -l | tr -d ' '" 2>/dev/null || echo 0
}
if [[ "${ISOLATE_AGENT_MEMORY:-1}" == "1" ]]; then
  if docker exec "${CORE_CONTAINER:-tdai-memory-core}" test -d "$MEM_ROOT" 2>/dev/null; then
    docker exec "${CORE_CONTAINER:-tdai-memory-core}" tar czf - -C "$MEM_ROOT" . > "$MEM_SNAP" 2>/dev/null \
      && info "agent memory snapshotted ($(mem_hash | cut -c1-12)…)" \
      || warn "could not snapshot agent memory; this run is not isolated from earlier ones"
  else
    warn "no agent memory tree at $MEM_ROOT — nothing to isolate"
  fi
fi
MEM_HASH_BEFORE="$(mem_hash)"
MEM_SCOPE_BEFORE="$(mem_hash_scoped)"; MEM_SCOPE_FILES_BEFORE="$(mem_files_scoped)"
[[ -n "$MEM_AGENT" ]] && info "consumer $MEM_AGENT memory: $MEM_SCOPE_FILES_BEFORE file(s), $(cut -c1-12 <<<"$MEM_SCOPE_BEFORE")…"

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

  TASK_FILE="$TASK_DIR/task.md"
  if (( AUTO )); then
    # The session runs in a fresh, empty directory — never in the repository.
    # Two reasons, both measured 2026-09-10. First, every earlier session's
    # system prompt read "Working directory: …/topic4-gate0": the model could
    # cat tokens.json, pair.json, the run records, anything. Second, CodeBuddy
    # keeps each session's tool results on disk under
    # ~/.codebuddy/projects/<slug of the working directory>/<session>/tool-results/,
    # and run 20260908T075637Z read one of those files back — the project slug
    # was the same for every run, so every run could see every earlier run's
    # tool output. A new empty directory per run gives a new slug and an empty
    # cache, and puts the repository out of reach. Both are recorded in run.json.
    # Each session gets its own unique PARENT, and its cwd sits inside it — so
    # `ls ..` from the session shows no sibling runs (2026-09-10, 补充二: 无兄弟目录).
    # A shared parent would let the model enumerate every other run's session dir.
    SESSION_ROOT="${SESSION_ROOT:-/private/tmp/topic4-sessions}"
    mkdir -p "$SESSION_ROOT"
    SESSION_PARENT="$(mktemp -d "$SESSION_ROOT/${RUN_ID}.XXXX")"
    SESSION_CWD="${SESSION_CWD:-$SESSION_PARENT/session}"
    mkdir -p "$SESSION_CWD"
    SESSION_SIBLINGS="$(( $(ls -1A "$(dirname "$SESSION_CWD")" 2>/dev/null | wc -l | tr -d ' ') - 1 ))"
    # CodeBuddy's slug: leading slash dropped, every "/" becomes "-", dots kept
    # (checked against ~/.codebuddy/projects on 2026-09-10).
    SESSION_SLUG="$(printf '%s' "$SESSION_CWD" | sed -E 's#^/##; s#/#-#g')"
    SESSION_PROJECT_DIR="$HOME/.codebuddy/projects/$SESSION_SLUG"
    SESSION_CACHE_BEFORE="$(find "$SESSION_PROJECT_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')"
    if [[ -n "$(ls -A "$SESSION_CWD" 2>/dev/null)" ]]; then
      warn "session directory $SESSION_CWD is not empty; the session can read what is in it"
    fi
    (( SESSION_CACHE_BEFORE > 0 )) && warn "CodeBuddy already holds $SESSION_CACHE_BEFORE file(s) for this directory's project slug; the session can read earlier tool results"
    info "session working directory: $SESSION_CWD (project cache files before: $SESSION_CACHE_BEFORE)"
    info "launching a fresh single-prompt CodeBuddy session (run-codebuddy.sh -p)"
    # -p spawns a new process, runs one prompt to completion (the agent still
    # loops through its own tool calls inside that turn), and exits. Its stdout
    # is the model's transcript; keep it for the record.
    if (cd "$SESSION_CWD" && bash "$EVAL/gate0/run-codebuddy.sh" "$(cat "$TASK_FILE")") >"$RUN_DIR/codebuddy-stdout.txt" 2>&1; then
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

# ── 1b. restore the agent's memory ───────────────────────────────
# What the run wrote into the product's memory is kept beside the run (so it
# can be read later) and then rolled back, so the next run starts where this
# one did. Both hashes go into run.json: equal means the run changed nothing,
# different means it did and the rollback is what keeps the arm comparable.
MEM_HASH_AFTER="$(mem_hash)"
MEM_SCOPE_AFTER="$(mem_hash_scoped)"; MEM_SCOPE_FILES_AFTER="$(mem_files_scoped)"
if [[ "${ISOLATE_AGENT_MEMORY:-1}" == "1" && -s "$MEM_SNAP" ]]; then
  docker exec "${CORE_CONTAINER:-tdai-memory-core}" tar czf - -C "$MEM_ROOT" . > "$RUN_DIR/agent-memory-after.tar.gz" 2>/dev/null || :
  if docker exec -i "${CORE_CONTAINER:-tdai-memory-core}" sh -c "rm -rf '$MEM_ROOT'/* && tar xzf - -C '$MEM_ROOT'" < "$MEM_SNAP" 2>/dev/null; then
    MEM_HASH_RESTORED="$(mem_hash)"
    MEM_SCOPE_RESTORED="$(mem_hash_scoped)"
    if [[ "$MEM_HASH_RESTORED" == "$MEM_HASH_BEFORE" ]]; then
      [[ "$MEM_HASH_AFTER" == "$MEM_HASH_BEFORE" ]] \
        && info "agent memory unchanged by this run" \
        || info "agent memory was written during the run and has been rolled back"
    else
      warn "agent memory did not restore to its pre-run hash — later runs are NOT isolated from this one"
    fi
  else
    warn "could not restore agent memory; later runs are NOT isolated from this one"
  fi
fi

# ── 2. the service's own records ─────────────────────────────────
TOOL_CALLS="$RUN_DIR/tool-call-logs.jsonl"
if SINCE="$SINCE" OUT="$RUN_DIR/tool-call-logs-all.jsonl" bash "$EVAL/gate0/export-tool-call-logs.sh" >"$RUN_DIR/export.log" 2>&1; then
  info "$(wc -l < "$RUN_DIR/tool-call-logs-all.jsonl" | tr -d ' ') service-side row(s) in the export window"
else
  warn "could not export tool_call_logs; see $RUN_DIR/export.log"
  : > "$RUN_DIR/tool-call-logs-all.jsonl"
fi

# The export is a time window, and two runs ten minutes apart share it. Rows
# from the previous run then arrive here, have no capture to pair with, and
# become bridge_only fetched events under the other session's key — inside
# this run's directory. Seen on 2026-09-06: run 2 carried four of run 1's
# fetches. So the rows are cut to this run's own conversation, taken from the
# capture; the full window is kept beside it for the record.
RUN_CONV="$(python3 - "$CAPTURE" <<'PY'
import json, sys
for line in open(sys.argv[1], encoding="utf-8"):
    try: e = json.loads(line)
    except ValueError: continue
    if e.get("event") != "http.request": continue
    h = e.get("headers") or {}
    c = h.get("x-conversation-id") or h.get("X-Conversation-Id")
    if c: print(c); break
PY
)"
if [[ -n "$RUN_CONV" ]]; then
  python3 - "$RUN_DIR/tool-call-logs-all.jsonl" "$TOOL_CALLS" "codebuddy:$RUN_CONV" <<'PY'
import json, sys
src, dst, key = sys.argv[1:4]
kept = dropped = 0
with open(dst, "w", encoding="utf-8") as out:
    for line in open(src, encoding="utf-8"):
        if not line.strip(): continue
        row = json.loads(line)
        if row.get("session_key") == key:
            out.write(line if line.endswith("\n") else line + "\n"); kept += 1
        else:
            dropped += 1
print(f"{kept} row(s) belong to this session; {dropped} from other session(s) in the window set aside")
PY
else
  warn "no conversation id in the capture; service rows NOT cut to this session"
  cp "$RUN_DIR/tool-call-logs-all.jsonl" "$TOOL_CALLS"
fi

# The task id the proxy resolved this session to, from its own "→ initialized"
# line. Stamped onto the events below so the gate can count distinct tasks;
# empty when the line is not found, and then the events keep task_id null —
# a missing signal, never a guessed one.
TASK_ID=""
if [[ -n "$RUN_CONV" ]]; then
  # `\b` is not a word boundary in BSD sed, so the earlier pattern matched
  # nothing on macOS and every event carried task_id null — the "false zero"
  # this stamping was meant to end. Anchor on the space the log line has.
  TASK_ID="$(docker logs tdai-proxy 2>&1 | grep -F "session=codebuddy:$RUN_CONV" | grep -F "→ initialized" | tail -1 | grep -oE '(^| )task=[^[:space:]]+' | tail -1 | sed 's/^ *task=//' || true)"
fi
[[ -n "$TASK_ID" ]] && info "task id per proxy log: $TASK_ID" || warn "task id not found in the proxy log; events will carry task_id null"

CANDIDATES="$EVAL/provenance/artifacts/candidate-log.jsonl"
[[ -f "$CANDIDATES" ]] && cp "$CANDIDATES" "$RUN_DIR/candidate-log.jsonl"

# ── 3. acceptance ────────────────────────────────────────────────
# Run before attribution, and independently of it. Whether the task succeeded is
# a fact about the run; whether an asset helped is a judgement about that fact.
# Letting the second decide the first is how a scenario starts grading itself.
info "acceptance …"
node "$TASK_DIR/verify.mjs" "$CAPTURE" --json > "$RUN_DIR/verdict.json" 2>"$RUN_DIR/verify.log"
VERDICT_CODE=$?
VERDICT="$(python3 -c "import json;print(json.load(open('$RUN_DIR/verdict.json'))['verdict'])" 2>/dev/null || echo ERROR)"

# ── 3a. independent reachability probe ───────────────────────────
# A model call timing out at an address proves the model followed the asset
# that gave it the address; it does not prove the address is wrong. The
# harness opens its own TCP connection to every host:port the run attempted,
# right now, and records the result. The outcome judge calls an asset wrong
# only when this probe also fails to reach the address it gave.
if [[ -f "$TASK_DIR/probe-reachability.mjs" ]]; then
  (cd "$REPO_ROOT" && node "$TASK_DIR/probe-reachability.mjs" --verdict="$RUN_DIR/verdict.json" \
    --out="$RUN_DIR/reachability.json" --source="harness probe at run time" --timeout-ms=5000 > "$RUN_DIR/reachability.log" 2>&1) \
    || warn "reachability probe failed; see $RUN_DIR/reachability.log (outcomes will be unconfirmed)"
else
  info "no independent probe for this scenario ($TASK_NAME); outcomes that need one stay unconfirmed"
fi
[[ -f "$RUN_DIR/reachability.json" ]] && info "reachability: $(tr '\n' ';' < "$RUN_DIR/reachability.log")"

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

# The frozen pool this scenario was entered with: beside the task when the
# scenario keeps its own (bridge-name), else the fixed path (the mainline).
SNAPSHOT="$EVAL/provenance/artifacts/asset-pool-snapshot.json"
[[ -f "$TASK_DIR/asset-pool-snapshot.json" ]] && SNAPSHOT="$TASK_DIR/asset-pool-snapshot.json"
cp "$SNAPSHOT" "$RUN_DIR/asset-pool-snapshot.json" 2>/dev/null || warn "no pool snapshot to copy"

# ── 3b. has the pool moved since it was frozen? ──────────────────
# The system extracts skills from finished sessions on its own. The first real
# consumer run left a consumer-owned skill in the evaluation pool one minute
# after it ended, and the next run read that skill before any credited asset.
# It happened not to carry the discriminative tokens; nothing guarantees the
# next one will not. The frozen snapshot cannot flag an asset it never held, so
# the live pool is read here and the difference recorded — loudly, because a
# drifted pool changes what every later number in this run means.
TEAM_ID_FOR_POOL="$(python3 -c "import json;print(json.load(open('$SNAPSHOT')).get('team_id',''))" 2>/dev/null || true)"
if [[ -n "$TEAM_ID_FOR_POOL" ]] \
   && TEAM_ID="$TEAM_ID_FOR_POOL" OUT="$RUN_DIR/asset-pool-live.json" \
      bash "$EVAL/provenance/snapshot-assets.sh" >"$RUN_DIR/pool-live.log" 2>&1; then
  python3 - "$RUN_DIR/asset-pool-snapshot.json" "$RUN_DIR/asset-pool-live.json" "$RUN_DIR/pool-drift.json" <<'PY'
import json, sys
frozen = {a["asset_id"]: a for a in json.load(open(sys.argv[1], encoding="utf-8"))["assets"]}
live = {a["asset_id"]: a for a in json.load(open(sys.argv[2], encoding="utf-8"))["assets"]}
added = [live[k] for k in live if k not in frozen]
removed = [frozen[k] for k in frozen if k not in live]
changed = [{"asset_id": k, "frozen_version": frozen[k].get("version"), "live_version": live[k].get("version")}
           for k in live if k in frozen and str(live[k].get("version")) != str(frozen[k].get("version"))]
drift = {"added": added, "removed": removed, "version_changed": changed,
         "drifted": bool(added or removed or changed)}
json.dump(drift, open(sys.argv[3], "w", encoding="utf-8"), indent=2, ensure_ascii=False)
if drift["drifted"]:
    print(f"POOL DRIFT: +{len(added)} added, -{len(removed)} removed, {len(changed)} version change(s)")
    for a in added:
        print(f"  + {a['asset_id']} {a.get('name','')} owner={a.get('producer_agent_id','')} created={a.get('asset_created_at','')}")
PY
  if python3 -c "import json,sys;sys.exit(0 if json.load(open('$RUN_DIR/pool-drift.json'))['drifted'] else 1)"; then
    warn "the live pool differs from the frozen snapshot — see pool-drift.json; attribution below is against the FROZEN pool"
  else
    info "pool unchanged since freeze"
  fi
else
  warn "could not read the live pool; drift unknown (not the same as none)"
fi

info "provenance …"
(cd "$REPO_ROOT" && node "$EVAL/provenance/build-events.mjs" "$SNAPSHOT" "$TOOL_CALLS" "$CAPTURE" \
  > "$RUN_DIR/provenance.md" 2>&1) || warn "build-events failed; see $RUN_DIR/provenance.md"
cp "$EVAL/provenance/artifacts/provenance-events.jsonl" "$RUN_DIR/events.jsonl" 2>/dev/null \
  || { warn "no provenance events produced"; : > "$RUN_DIR/events.jsonl"; }

(cd "$REPO_ROOT" && node "$EVAL/provenance/build-early-events.mjs" "$SNAPSHOT" "$TOOL_CALLS" "$CAPTURE" \
  ${CANDIDATES:+--candidates="$CANDIDATES"} > "$RUN_DIR/early.md" 2>&1) || warn "build-early-events failed"
cp "$EVAL/provenance/artifacts/early-events.jsonl" "$RUN_DIR/early-events.jsonl" 2>/dev/null || : > "$RUN_DIR/early-events.jsonl"
# The builders know the session, not the run or the task; stamp both now so
# every later stage (judge, gate, receipt) inherits them.
(cd "$REPO_ROOT" && node "$EVAL/provenance/stamp-events.mjs" "$RUN_DIR/events.jsonl" "$RUN_DIR/early-events.jsonl" \
  --run-id="$RUN_ID" ${TASK_ID:+--task-id="$TASK_ID"} >/dev/null) || warn "could not stamp run/task ids on the events"

info "judgement …"
(cd "$REPO_ROOT" && node "$EVAL/attribution/collect-artifacts.mjs" "$CAPTURE" \
  --task="$TASK_DIR/task.md" --run-id="$RUN_ID" ${TASK_ID:+--task-id="$TASK_ID"} >/dev/null 2>&1) || warn "collect-artifacts failed"
cp "$EVAL/attribution/artifacts/run-artifacts.json" "$RUN_DIR/run-artifacts.json" 2>/dev/null \
  || { warn "no artifacts collected"; echo "[]" > "$RUN_DIR/run-artifacts.json"; }
(cd "$REPO_ROOT" && node "$EVAL/attribution/judge-hard.mjs" \
  "$RUN_DIR/events.jsonl" "$RUN_DIR/run-artifacts.json" "$( [[ -f "$TASK_DIR/tokens.json" ]] && echo "$TASK_DIR/tokens.json" || echo "$EVAL/attribution/artifacts/tokens.json" )" \
  > "$RUN_DIR/judgement.md" 2>&1) || warn "judge failed; see $RUN_DIR/judgement.md"
cp "$EVAL/attribution/artifacts/used-events.jsonl" "$RUN_DIR/used-events.jsonl" 2>/dev/null || : > "$RUN_DIR/used-events.jsonl"
# The tokens the judgement was made with, kept beside it: versioned, and the
# outcome judge below refuses to blame a version whose tokens it cannot see.
if [[ -f "$TASK_DIR/tokens.json" ]]; then cp "$TASK_DIR/tokens.json" "$RUN_DIR/tokens.json"; else cp "$EVAL/attribution/artifacts/tokens.json" "$RUN_DIR/tokens.json" 2>/dev/null || warn "no tokens.json to keep"; fi

# ── 4b. outcomes and what the gate would say ─────────────────────
# Each used event is followed to the specific call it fed, and that call's own
# outcome decides validated / corrected / needs_review — never the run's
# overall verdict, which would validate the wrong asset in a run that
# recovered from it. The decisions written here are what THIS run's evidence
# alone would say; they are informational and never applied — the gate the
# next run faces is the frozen baseline, not an accumulation.
info "outcomes …"
REACH_ARG=""
[[ -f "$RUN_DIR/reachability.json" ]] && REACH_ARG="--reachability=$RUN_DIR/reachability.json"
(cd "$REPO_ROOT" && node "$EVAL/attribution/judge-outcome.mjs" \
  "$RUN_DIR/used-events.jsonl" "$RUN_DIR/verdict.json" "$RUN_DIR/tokens.json" \
  ${REACH_ARG:+"$REACH_ARG"} \
  --out="$RUN_DIR/outcome-events.jsonl" > "$RUN_DIR/outcome.md" 2>&1) \
  || { warn "judge-outcome failed; see $RUN_DIR/outcome.md"; : > "$RUN_DIR/outcome-events.jsonl"; }
# The outcomes go into the product (Core's meta_asset_outcomes), recorded by
# the harness's admin key and naming the consumer who produced them
# (2026-09-08: Core trusts a row only when an admin or reviewer submits it
# with the call id, the asset version and evidence; a consumer's own report
# is kept and ignored). evaluate=false: recorded now, acted on only when a
# batch ends and --apply runs. Replays (CAPTURE_FROM) record nothing — their
# outcomes are already on file under the original run.
if [[ -z "${CAPTURE_FROM:-}" && -s "$RUN_DIR/outcome-events.jsonl" && "${GATE_MECHANISM:-core}" != "visibility" ]]; then
  GATE_SUBMITTER_KEY_FILE="${GATE_SUBMITTER_KEY_FILE:-$REPO_ROOT/deploy/global-images/.admin-key}" bash "$EVAL/gate/core-gate.sh" --sync "$RUN_DIR" --baseline "$GATE_BASELINE" \
    > "$RUN_DIR/core-sync.log" 2>&1 || warn "outcomes could not be recorded in Core; see $RUN_DIR/core-sync.log"
fi
(cd "$REPO_ROOT" && node "$EVAL/gate/decide.mjs" \
  --events="$RUN_DIR/events.jsonl,$RUN_DIR/used-events.jsonl,$RUN_DIR/outcome-events.jsonl" \
  --snapshot="$RUN_DIR/asset-pool-snapshot.json" --tokens="$RUN_DIR/tokens.json" \
  --out="$RUN_DIR/gate-decisions.json" > "$RUN_DIR/gate-decisions.md" 2>&1) \
  || warn "decide failed; see $RUN_DIR/gate-decisions.md"

# ── 5. cost ──────────────────────────────────────────────────────
# Collected every run, not only when someone remembers. Injection cost is paid
# on every turn by every person, so a reuse rate with no cost beside it argues
# only one side of the trade.
# Token usage is in the final chunk of each streamed response (the upstream is
# asked with stream_options.include_usage); cost.mjs reads it from there. The
# earlier collector looked in request JSON and reported null for every run.
(cd "$REPO_ROOT" && node "$EVAL/runner/cost.mjs" "$CAPTURE" "$RUN_DIR/cost.json" --started="$START_EPOCH") \
  || warn "cost collection failed"

# ── 5b. the identity the proxy actually resolved ─────────────────
# Read from the proxy's own session-init log, never inferred from request
# headers. The two disagree by design: in -p mode CodeBuddy forwards the
# binding headers from codebuddy-binding.env (the old gate0 ids), and the
# proxy's debugForceIdentity overrides them. A capture therefore shows the old
# team in its headers while the session ran as the forced consumer — and
# reading the headers nearly had a valid run thrown out as mis-bound. The
# "→ initialized" line is what the session was; that is what gets recorded.
CONV_ID="$(python3 - "$CAPTURE" <<'PY'
import json, sys
for line in open(sys.argv[1], encoding="utf-8"):
    try: e = json.loads(line)
    except ValueError: continue
    if e.get("event") != "http.request": continue
    h = e.get("headers") or {}
    c = h.get("x-conversation-id") or h.get("X-Conversation-Id")
    if c: print(c); break
PY
)"
RESOLVED_LINE=""
if [[ -n "$CONV_ID" ]]; then
  RESOLVED_LINE="$(docker logs tdai-proxy 2>&1 | grep -F "session=codebuddy:$CONV_ID" | grep -F "→ initialized" | tail -1 || true)"
fi
if [[ -n "$RESOLVED_LINE" ]]; then
  printf '%s\n' "$RESOLVED_LINE" > "$RUN_DIR/resolved-identity.txt"
  info "identity per proxy log: $(sed -E 's/.*→ initialized //' <<<"$RESOLVED_LINE")"
else
  warn "could not find this session's '→ initialized' line in the proxy log; identity unverified"
fi

# ── 5c. is the product's auto-extraction on or off for this run? ─────
# Decided for the on/off comparison: extraction is switched off so both arms
# see the same frozen pool and no run can teach the next one. That is a change
# to the product under test, so every run records the switch's state — read
# from the core config the container actually mounts, not from memory of
# having flipped it.
CORE_CFG="$REPO_ROOT/deploy/global-images/.memory-core-config/tdai-gateway.yaml"
EXTRACTION_ENABLED="$(python3 - "$CORE_CFG" <<'PY' 2>/dev/null || echo unknown
import re, sys
s = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"^skill:\n(?:(?:  .*|)\n)*?  extraction:\n(?:(?:    .*|)\n)*?    enabled:\s*(true|false)", s, re.M)
print(m.group(1) if m else "unknown")
PY
)"
info "core auto-extraction: $EXTRACTION_ENABLED"

# ── 5d. what else was in the model's context ─────────────────────
# The 2026-09-06 review found every comparison run carrying the consumer
# agent's own L3 memory — learned from the evidence-base runs — with an SOP
# that says "probe every documented candidate". That prescribes the off arm's
# second dial. It is the product working, not a fault, but a run that does not
# record it cannot say what its numbers rest on. The task's `confounders.watch`
# lists the phrases to look for; the record is written beside the run either way.
node "$EVAL/runner/context-confounders.mjs" --run="$RUN_DIR" \
  --watch="$TASK_DIR/confounders.watch" 2>"$RUN_DIR/context-confounders.log" \
  || warn "context-confounders failed (see context-confounders.log)"

# ── 6. manifest ──────────────────────────────────────────────────
RUN_TASK_NAME="$TASK_NAME" \
REPO_ROOT_REPORT="$REPO_ROOT" MEM_ROOT_REPORT="$MEM_ROOT" MEM_HASH_BEFORE="${MEM_HASH_BEFORE:-}" MEM_HASH_AFTER="${MEM_HASH_AFTER:-}" \
MEM_AGENT="${MEM_AGENT:-}" MEM_SCOPE_BEFORE="${MEM_SCOPE_BEFORE:-}" MEM_SCOPE_AFTER="${MEM_SCOPE_AFTER:-}" \
MEM_HASH_RESTORED="${MEM_HASH_RESTORED:-}" MEM_SCOPE_RESTORED="${MEM_SCOPE_RESTORED:-}" \
SESSION_CWD="${SESSION_CWD:-}" SESSION_PROJECT_DIR="${SESSION_PROJECT_DIR:-}" SESSION_CACHE_BEFORE="${SESSION_CACHE_BEFORE:-}" \
SESSION_SIBLINGS="${SESSION_SIBLINGS:-}" PROBE_CWD="$( p="$(pgrep -f proxy-observability-probe 2>/dev/null | head -1)"; [[ -n "$p" ]] && lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || echo "" )" REPO_ROOT_REPORT="$REPO_ROOT" \
MEM_SCOPE_FILES_BEFORE="${MEM_SCOPE_FILES_BEFORE:-}" MEM_SCOPE_FILES_AFTER="${MEM_SCOPE_FILES_AFTER:-}" \
MEM_ISOLATED="$([[ "${ISOLATE_AGENT_MEMORY:-1}" == "1" && -s "$MEM_SNAP" && "${MEM_HASH_RESTORED:-}" == "${MEM_HASH_BEFORE:-}" ]] && echo 1 || echo 0)" \
python3 - "$RUN_DIR" "$RUN_ID" "$LABEL" "$IDENTITY" "$STARTED_AT" "$VERDICT" "$CONV_ID" "$RESOLVED_LINE" "$EXTRACTION_ENABLED" "$GATE" "$ABLATE" <<'PY'
import json, os, re, sys
run_dir, run_id, label, identity, started, verdict, conv_id, resolved_line, extraction, gate, ablate = sys.argv[1:12]

# The gate state this run actually started under, as read back from the
# product after apply.sh wrote it — not the mode that was requested. An
# ablation run records the same block with mode "ablate" and the hidden ids.
mode = gate or ("ablate" if ablate else None)
gate_block = {"mode": mode, "hidden": ablate.split(",") if ablate else [], "baseline_frozen_at": None,
              # mechanism: "core-status" (Core decides and writes status; since 2026-09-07)
              # or "visibility" (apply.sh flipped visibility from outside; earlier batches, ablation)
              "mechanism": None, "visibility_at_start": None, "status_at_start": None, "all_verified": None}
apply_p = os.path.join(run_dir, "gate-apply.json")
if mode and os.path.exists(apply_p):
    rec = json.load(open(apply_p, encoding="utf-8"))
    gate_block["mechanism"] = rec.get("mechanism") or "visibility"
    gate_block["visibility_at_start"] = rec.get("visibility_at_start") or rec.get("visibility_after")
    gate_block["status_at_start"] = rec.get("status_at_start")
    gate_block["all_verified"] = rec.get("all_verified")
    if rec.get("decisions"):
        gate_block["core_decisions"] = {aid: (d or {}).get("decision") for aid, d in rec["decisions"].items()}
core_outcomes = None
co_p = os.path.join(run_dir, "core-outcomes.json")
if os.path.exists(co_p):
    co = json.load(open(co_p, encoding="utf-8"))
    core_outcomes = {"posted": len(co.get("posted") or []), "skipped": len(co.get("skipped") or []),
                     "synced_at": co.get("synced_at"), "evaluate": co.get("evaluate")}
    base_p = os.path.join(run_dir, "gate_baseline.json")
    if os.path.exists(base_p):
        gate_block["baseline_frozen_at"] = json.load(open(base_p, encoding="utf-8")).get("frozen_at")

def count(name):
    p = os.path.join(run_dir, name)
    if not os.path.exists(p):
        return None
    return sum(1 for line in open(p, encoding="utf-8") if line.strip())

# Parse "→ initialized agent=… task=… team=… user=…" into fields. Absent line
# → nulls, never a guess from the request headers.
resolved = {k: None for k in ("agent_id", "team_id", "user_id", "task_id")}
if resolved_line:
    for key, field in (("agent", "agent_id"), ("team", "team_id"), ("user", "user_id"), ("task", "task_id")):
        m = re.search(rf"\b{key}=(\S+)", resolved_line)
        if m:
            resolved[field] = m.group(1)

manifest = {
    "run_id": run_id,
    "label": label,
    "task": os.environ.get("RUN_TASK_NAME") or None,
    "identity": identity,
    "conversation_id": conv_id or None,
    # What the proxy actually bound this session to. Null fields mean the log
    # line was not found, not that identity was absent.
    "resolved_identity": resolved,
    "resolved_identity_source": "proxy session-init log" if resolved_line else None,
    # The product's skill auto-extraction during this run: "true" / "false" as
    # read from the mounted core config, or "unknown" if it could not be read.
    # Off for the on/off comparison — a disclosed design choice, not a default.
    "auto_extraction_enabled": {"true": True, "false": False}.get(extraction, None),
    # The product's own memory of this agent (L2 scene blocks, L3 persona),
    # hashed before and after. Equal means the run changed nothing; different
    # means it did and was rolled back, so the next run starts where this one
    # did. `isolated` false is the flag that says this run may have been
    # reading what earlier runs in its own batch wrote.
    "agent_memory": {
        "root": os.environ.get("MEM_ROOT_REPORT", "/data/tdai-memory/profiles"),
        "hash_before": os.environ.get("MEM_HASH_BEFORE") or None,
        "hash_after": os.environ.get("MEM_HASH_AFTER") or None,
        # hash_after answers "what did the run write"; hash_restored, taken
        # after the rollback, answers "did the rollback succeed". They are
        # different questions — a run that wrote and was restored has
        # hash_after != hash_before and hash_restored == hash_before.
        "hash_restored": os.environ.get("MEM_HASH_RESTORED") or None,
        "written_during_run": bool(os.environ.get("MEM_HASH_BEFORE")) and os.environ.get("MEM_HASH_BEFORE") != os.environ.get("MEM_HASH_AFTER"),
        "isolated": os.environ.get("MEM_ISOLATED") == "1",
        # The consumer's own share, hashed apart: this is what "same start
        # point" is judged on across a batch (isolation-check.mjs), because
        # the whole tree drifts when the pipeline writes to another agent.
        "consumer_scope": ({
            "agent_id": os.environ.get("MEM_AGENT"),
            "hash_before": os.environ.get("MEM_SCOPE_BEFORE") or None,
            "hash_after": os.environ.get("MEM_SCOPE_AFTER") or None,
            "hash_restored": os.environ.get("MEM_SCOPE_RESTORED") or None,
            "files_before": int(os.environ.get("MEM_SCOPE_FILES_BEFORE") or 0),
            "files_after": int(os.environ.get("MEM_SCOPE_FILES_AFTER") or 0),
        } if os.environ.get("MEM_AGENT") else None),
    },
    # Where the session ran and what CodeBuddy could already see for that
    # directory. Empty cwd + zero cached files is the isolation claim; a run
    # started in the repository would carry the repository path here.
    "session": ({
        "cwd": os.environ.get("SESSION_CWD"),
        "codebuddy_project_dir": os.environ.get("SESSION_PROJECT_DIR") or None,
        "project_cache_files_before": int(os.environ.get("SESSION_CACHE_BEFORE") or 0),
        "cwd_is_repository": os.environ.get("SESSION_CWD", "").startswith(os.environ.get("REPO_ROOT_REPORT", "\x00")),
        # 无兄弟目录:会话 cwd 的父目录里除它自己外还有几个条目(应为 0)。
        "sibling_dirs": (int(os.environ["SESSION_SIBLINGS"]) if os.environ.get("SESSION_SIBLINGS") not in (None, "") else None),
        # 探针进程的 cwd,以及它是否落在仓库里(应为 False)——模型正是顺着它找到仓库的。
        "probe_cwd": os.environ.get("PROBE_CWD") or None,
        "probe_cwd_in_repository": bool(os.environ.get("PROBE_CWD")) and os.environ.get("PROBE_CWD", "").startswith(os.environ.get("REPO_ROOT_REPORT", "\x00")),
    } if os.environ.get("SESSION_CWD") else None),
    "auto_extraction_source": "deploy/global-images/.memory-core-config/tdai-gateway.yaml skill.extraction.enabled",
    "started_at": started,
    "gate": gate_block,
    # This run's outcomes as recorded in Core (evaluate=false); null when
    # nothing was recorded (replay, old mechanism, or a failed sync — see core-sync.log).
    "core_outcomes": core_outcomes,
    "verdict": verdict,
    # What else the model had in context: the consumer's injected L3 memory
    # (present? which lines the task watches for?) and skills outside the
    # frozen pool that were listed or read. Nulls mean the record is missing,
    # never that nothing was there. Full detail in context-confounders.json.
    "context_confounders": (lambda p: (lambda c: {
        "profile_memory_present": c.get("profile_memory", {}).get("present"),
        "l3_watch_hits": len(c.get("profile_memory", {}).get("l3", {}).get("watch_hits", []) or []) if c.get("profile_memory", {}).get("l3", {}).get("present") else None,
        "l3_sha1": c.get("profile_memory", {}).get("l3", {}).get("sha1"),
        "non_pool_skills_in_listing": len((c.get("available_skills") or {}).get("not_in_pool", [])) if c.get("available_skills") is not None else None,
        "non_pool_skill_reads": len(c.get("non_pool_skill_reads") or []) if c.get("non_pool_skill_reads") is not None else None,
    })(json.load(open(p, encoding="utf-8"))) if os.path.exists(p) else None)(os.path.join(run_dir, "context-confounders.json")),
    "counts": {n: count(n) for n in
               ("capture.jsonl", "tool-call-logs.jsonl", "candidate-log.jsonl",
                "events.jsonl", "early-events.jsonl", "used-events.jsonl", "outcome-events.jsonl")},
    "note": "verdict ERROR means the run could not be judged, not that it failed; "
            "it stays in the denominator so a collection failure cannot hide",
}
json.dump(manifest, open(os.path.join(run_dir, "run.json"), "w", encoding="utf-8"), indent=2)
PY

# ── 7. the receipt ───────────────────────────────────────────────
# After the manifest, because it reads run_id, the resolved task id and the
# conversation id from it. What this run used, from whom, in what state, with
# what evidence and what risk. The gate decision shown is the one the run
# actually faced — the frozen baseline when a gate mode was set — not what
# this run's own evidence would decide; that stays in gate-decisions.json.
RECEIPT_DECISIONS="$RUN_DIR/gate-decisions.json"
[[ ( -n "$GATE" || -n "$ABLATE" ) && -f "$RUN_DIR/gate_baseline.json" ]] && RECEIPT_DECISIONS="$RUN_DIR/gate_baseline.json"
# Under the in-Core gate the record written before the session carries the
# product's own decision per asset (gate-decision-v2) and whether the run
# faced it (apply) or ran with the gate off (reset). That is what the receipt
# shows; the frozen baseline stays the record of the evidence it rests on.
if [[ -n "$GATE" && -f "$RUN_DIR/gate-apply.json" ]] \
   && python3 -c "import json,sys; sys.exit(0 if json.load(open('$RUN_DIR/gate-apply.json')).get('mechanism')=='core-status' else 1)" 2>/dev/null; then
  RECEIPT_DECISIONS="$RUN_DIR/gate-apply.json"
fi
info "receipt …"
# contributed is a cross-run claim (a contrast batch); the receipt looks it up
# from the calibration output, never derives it from this run. The verdict
# supplies the call slots for conflict detection.
CONTRIB="$EVAL/calibration/contributed-events.jsonl"
(cd "$REPO_ROOT" && node "$EVAL/receipt/build-receipt.mjs" \
  --events="$RUN_DIR/events.jsonl,$RUN_DIR/early-events.jsonl,$RUN_DIR/used-events.jsonl,$RUN_DIR/outcome-events.jsonl" \
  --snapshot="$RUN_DIR/asset-pool-snapshot.json" --decisions="$RECEIPT_DECISIONS" --run="$RUN_DIR/run.json" \
  --verdict="$RUN_DIR/verdict.json" ${CONTRIB:+--contributed="$CONTRIB"} \
  --out="$RUN_DIR/receipt.json" > "$RUN_DIR/receipt.txt" 2>&1) \
  || warn "build-receipt failed; see $RUN_DIR/receipt.txt"
# The same receipt in Chinese, in the shape of the topic's own sample.
[[ -f "$RUN_DIR/receipt.json" ]] && (cd "$REPO_ROOT" && node "$EVAL/receipt/render-cli.mjs" "$RUN_DIR/receipt.json" --lang=zh > "$RUN_DIR/receipt.zh.txt" 2>&1) || :

case "$VERDICT" in
  PASS)  echo "${C_G}PASS${C_0}  $RUN_ID" ;;
  FAIL)  echo "${C_R}FAIL${C_0}  $RUN_ID" ;;
  *)     echo "${C_Y}ERROR${C_0} $RUN_ID  — the run could not be judged; it still counts in the total" ;;
esac
python3 -c "import json;print('      ' + json.load(open('$RUN_DIR/verdict.json'))['reason'])" 2>/dev/null || :

# Session and analysis are done; nothing more will be written. Move the staged
# records into the repo now, so they are preserved, and drop the staging parent.
mkdir -p "$RUNS_DIR"
if mv "$RUN_DIR" "$FINAL_RUN_DIR" 2>/dev/null; then
  rmdir "$STAGE_PARENT" 2>/dev/null || :
  RUN_DIR="$FINAL_RUN_DIR"
  info "records moved into the repo → $RUN_DIR"
else
  warn "could not move records into $FINAL_RUN_DIR; they remain at $RUN_DIR"
fi
echo "      $RUN_DIR"
exit "$VERDICT_CODE"
