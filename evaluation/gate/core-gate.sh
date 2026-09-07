#!/usr/bin/env bash
# The gate, as the product runs it (2026-09-07): outcomes go into Core, Core
# decides, and the decision is the asset's `status`.
#
# This replaces apply.sh for the on/off comparison. apply.sh flipped
# `visibility` from outside the product; that was the review's objection
# ("why a script beside the product?"). With the gate inside Core
# (MemoryCore/src/metadata, mounted by evaluation/eval-core.sh) the runner's
# job shrinks to three things, each a call to a product route:
#
#   --sync <run_dir>   record the run's outcome events in Core
#                      (/v3/meta/asset/outcome/append, evaluate=false — a
#                      comparison batch must not teach the gate mid-batch;
#                      the evidence the gate acts on is what --seed put there)
#   --reset            gate OFF: every baseline asset status=approved at its
#                      baseline visibility. "Off" means everything admitted —
#                      the pool as the product ran it before there was a gate.
#   --apply            gate ON: --reset, then /v3/meta/asset/gate/evaluate per
#                      asset. Core reads the outcomes on file and writes the
#                      status; the bridge's whitelist (list-accessible) drops
#                      `failed` on its own.
#   --seed             record the evidence-base runs named in the baseline,
#                      evaluate, and check Core's decisions against the frozen
#                      baseline's. Idempotent: a run already synced is skipped.
#   --status           read status / visibility / decision per asset.
#
# Every write is followed by a read, and the record (--out) carries both.
# Status writes are made as the assets' owner (identity A); outcome records
# are made as the consumer whose session produced them (identity B by
# default), because Core attributes an outcome to its caller.
#
# Usage:
#   bash evaluation/gate/core-gate.sh --status|--reset|--apply|--seed [--baseline F] [--out F]
#   bash evaluation/gate/core-gate.sh --sync <run_dir> [--out F]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_DIR="$REPO_ROOT/deploy/global-images"
RUNS_DIR="$REPO_ROOT/evaluation/runner/runs"
CORE_URL="${CORE_URL:-http://localhost:8420}"
SERVICE_ID="${SERVICE_ID:-default}"
OWNER_KEY_FILE="${GATE_KEY_FILE:-$ENV_DIR/.topic4-user-key}"
CONSUMER_KEY_FILE="${GATE_CONSUMER_KEY_FILE:-$ENV_DIR/.topic4-user-key-b}"
BASELINE="$SCRIPT_DIR/artifacts/gate_baseline.json"
OUT=""; MODE=""; SYNC_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --status|--reset|--apply|--seed) MODE="${1#--}"; shift ;;
    --sync) MODE="sync"; SYNC_DIR="$2"; shift 2 ;;
    --baseline) BASELINE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$MODE" ]] || { echo "usage: core-gate.sh --status|--reset|--apply|--seed|--sync <run_dir> [--baseline F] [--out F]" >&2; exit 2; }

if [[ -t 1 ]]; then C_R=$'\033[31m'; C_G=$'\033[32m'; C_B=$'\033[34m'; C_Y=$'\033[33m'; C_0=$'\033[0m'
else C_R=""; C_G=""; C_B=""; C_Y=""; C_0=""; fi
info() { echo "${C_B}[$(date +%H:%M:%S)]${C_0} $*"; }
ok()   { echo "${C_G}[ok]${C_0} $*"; }
warn() { echo "${C_Y}[warn]${C_0} $*"; }
die()  { echo "${C_R}[error]${C_0} $*" >&2; exit 1; }

[[ -f "$BASELINE" ]] || die "no baseline: $BASELINE"
[[ -f "$OWNER_KEY_FILE" ]] || die "owner key not found: $OWNER_KEY_FILE"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Credential over stdin to curl; never on a command line.
call() {  # keyfile path body out
  local keyfile="$1" path="$2" body="$3" out="$4" key
  key="$(tr -d '[:space:]' < "$keyfile")"
  printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$key" "$key" \
    | curl -sS -K - --max-time 25 -H 'content-type: application/json' -H "x-tdai-service-id: $SERVICE_ID" \
        -X POST "$CORE_URL$path" -d "$body" -o "$out"
}
envelope_ok() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get('code')==0 else 1)" "$1" 2>/dev/null; }
envelope_msg() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('message') or d)" "$1" 2>/dev/null | head -c 300; }

# The gate must actually be in the product, or every call below is a 404
# that reads like a refusal.
probe="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$CORE_URL/v3/meta/asset/gate/get" -H 'content-type: application/json' -H "x-tdai-service-id: $SERVICE_ID" -d '{"asset_id":"x"}' || echo 000)"
[[ "$probe" != "404" && "$probe" != "000" ]] || die "Core does not serve /v3/meta/asset/gate/* (HTTP $probe) — run: bash evaluation/eval-core.sh enable"

TEAM_ID="$(python3 -c "import json;print(json.load(open('$BASELINE')).get('team_id',''))")"
ASSET_IDS=()
while IFS= read -r id; do ASSET_IDS+=("$id"); done < <(python3 -c "import json;print('\n'.join(json.load(open('$BASELINE'))['assets'].keys()))")
(( ${#ASSET_IDS[@]} > 0 )) || die "baseline lists no assets"

# ── read: status + visibility + decision per asset ───────────────
read_state() {  # out.json  → {asset_id: {status, visibility, gate_decision, confidence} | null}
  local out="$1"; : > "$TMP/rows.jsonl"
  for id in "${ASSET_IDS[@]}"; do
    if call "$OWNER_KEY_FILE" "/v3/meta/asset/get" "{\"asset_id\":\"$id\"}" "$TMP/get-$id.json" && envelope_ok "$TMP/get-$id.json"; then
      call "$OWNER_KEY_FILE" "/v3/meta/asset/gate/get" "{\"asset_id\":\"$id\"}" "$TMP/gate-$id.json" || true
      python3 - "$id" "$TMP/get-$id.json" "$TMP/gate-$id.json" >> "$TMP/rows.jsonl" <<'PY'
import json, sys, os
aid, getp, gatep = sys.argv[1:4]
d = json.load(open(getp))["data"]
g = None
if os.path.exists(gatep):
    try:
        gd = json.load(open(gatep)); g = (gd.get("data") or {}).get("gate") if gd.get("code") == 0 else None
    except Exception: g = None
print(json.dumps({"asset_id": aid, "name": d.get("name"), "owner_user_id": d.get("owner_user_id"),
                  "status": d.get("status"), "visibility": d.get("visibility"), "confidence": d.get("confidence"),
                  "gate_decision": (g or {}).get("decision"), "gate_decided_at": (g or {}).get("decided_at"),
                  "gate_rules_version": (g or {}).get("rules_version"),
                  # the full gate-decision-v2 document Core wrote onto the asset; the receipt reads it
                  "gate": g}))
PY
    else
      echo "{\"asset_id\":\"$id\",\"status\":null,\"visibility\":null,\"error\":\"$(envelope_msg "$TMP/get-$id.json" | tr -d '"')\"}" >> "$TMP/rows.jsonl"
    fi
  done
  python3 - "$TMP/rows.jsonl" "$out" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
json.dump({r["asset_id"]: (None if r.get("status") is None else r) for r in rows}, open(sys.argv[2], "w", encoding="utf-8"), indent=2)
PY
}
show_state() {
  python3 - "$1" <<'PY'
import json, sys
for aid, r in json.load(open(sys.argv[1], encoding="utf-8")).items():
    if r is None: print(f"  {aid}  UNREADABLE"); continue
    print(f"  {aid}  {str(r.get('name') or ''):26} status={str(r.get('status')):10} visibility={str(r.get('visibility')):8} gate={r.get('gate_decision')} confidence={r.get('confidence')}")
PY
}

# ── write helpers ────────────────────────────────────────────────
set_status() {  # asset_id status visibility → appends to $TMP/actions.jsonl
  local id="$1" status="$2" vis="$3"
  call "$OWNER_KEY_FILE" "/v3/meta/asset/update" "{\"asset_id\":\"$id\",\"status\":\"$status\",\"visibility\":\"$vis\"}" "$TMP/upd-$id.json"
  local accepted=false; envelope_ok "$TMP/upd-$id.json" && accepted=true
  echo "{\"op\":\"asset/update\",\"asset_id\":\"$id\",\"status\":\"$status\",\"visibility\":\"$vis\",\"accepted\":$accepted,\"message\":$(python3 -c "import json;print(json.dumps('$(envelope_msg "$TMP/upd-$id.json" | tr -d '"')'))")}" >> "$TMP/actions.jsonl"
  $accepted || warn "asset/update $id → $status rejected: $(envelope_msg "$TMP/upd-$id.json")"
}
# The gate acts on the evidence base only: as_of = the baseline's frozen_at, so
# outcomes the comparison batch itself recorded (evaluate=false) are on file
# but do not decide the batch they belong to. Core records as_of on the decision.
FROZEN_AT="$(python3 -c "import json;print(json.load(open('$BASELINE')).get('frozen_at',''))")"
evaluate() {  # asset_id → appends decision to $TMP/decisions.jsonl
  local id="$1"
  call "$OWNER_KEY_FILE" "/v3/meta/asset/gate/evaluate" "{\"asset_id\":\"$id\",\"apply\":true${FROZEN_AT:+,\"as_of\":\"$FROZEN_AT\"}}" "$TMP/eval-$id.json"
  if envelope_ok "$TMP/eval-$id.json"; then
    python3 -c "import json;d=json.load(open('$TMP/eval-$id.json'))['data'];print(json.dumps({'asset_id':'$id','applied':d.get('applied'),'decision':d.get('decision')}))" >> "$TMP/decisions.jsonl"
    echo "{\"op\":\"gate/evaluate\",\"asset_id\":\"$id\",\"accepted\":true}" >> "$TMP/actions.jsonl"
  else
    echo "{\"op\":\"gate/evaluate\",\"asset_id\":\"$id\",\"accepted\":false,\"message\":$(python3 -c "import json;print(json.dumps('$(envelope_msg "$TMP/eval-$id.json" | tr -d '"')'))")}" >> "$TMP/actions.jsonl"
    warn "gate/evaluate $id failed: $(envelope_msg "$TMP/eval-$id.json")"
  fi
}
baseline_visibility() { python3 -c "import json;print(json.load(open('$BASELINE'))['assets']['$1'].get('baseline_visibility') or 'team')"; }

# ── sync: a run's outcome events → Core ──────────────────────────
sync_run() {  # run_dir → writes run_dir/core-outcomes.json, prints a line
  local dir="$1" events="$1/outcome-events.jsonl" rec="$1/core-outcomes.json"
  [[ -f "$events" ]] || { warn "no outcome-events.jsonl in $dir"; return 0; }
  if [[ -f "$rec" ]]; then info "$(basename "$dir"): already synced ($(python3 -c "import json;print(len(json.load(open('$rec'))['posted']))" ) outcome(s)); skipping"; return 0; fi
  [[ -f "$CONSUMER_KEY_FILE" ]] || die "consumer key not found: $CONSUMER_KEY_FILE"
  local run_id; run_id="$(basename "$dir")"
  : > "$TMP/posted.jsonl"; : > "$TMP/skipped.jsonl"
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    python3 - "$line" "$TEAM_ID" "$run_id" > "$TMP/body.json" <<'PY'
import json, sys
e = json.loads(sys.argv[1]); team = sys.argv[2]; run_id = sys.argv[3]
state = e.get("state")
if state not in ("validated", "corrected", "used"):
    print(json.dumps({"skip": f"state {state} is not an outcome"})); sys.exit(0)
reason = e.get("corrected_reason")
body = {
    "team_id": team, "asset_id": e["asset_id"], "asset_version": e.get("asset_version"),
    "state": state, "relation": e.get("relation") or "unknown",
    "corrected_reason": (reason if reason in ("wrong", "stale") else "other") if state == "corrected" else None,
    "consumer_user_id": e.get("actor_user_id"), "consumer_agent_id": e.get("actor_agent_id"),
    "task_id": e.get("task_id"), "run_id": e.get("run_id") or run_id,
    "source": "evaluation-runner",
    "evidence_json": json.dumps({"event_id": e.get("event_id"), "target_ref": e.get("target_ref"),
                                 "proof_refs": e.get("proof_refs"), "executed_endpoint": e.get("executed_endpoint")}, ensure_ascii=False),
    "occurred_at": e.get("occurred_at"),
    "evaluate": False,
}
body = {k: v for k, v in body.items() if v is not None}
print(json.dumps({"event_id": e.get("event_id"), "body": body}))
PY
    if python3 -c "import json,sys;sys.exit(0 if 'skip' in json.load(open('$TMP/body.json')) else 1)"; then
      python3 -c "import json;d=json.load(open('$TMP/body.json'));print(json.dumps({'reason':d['skip']}))" >> "$TMP/skipped.jsonl"; continue
    fi
    python3 -c "import json;print(json.dumps(json.load(open('$TMP/body.json'))['body']))" > "$TMP/append.json"
    call "$CONSUMER_KEY_FILE" "/v3/meta/asset/outcome/append" "@$TMP/append.json" "$TMP/append-res.json"
    if envelope_ok "$TMP/append-res.json"; then
      python3 -c "
import json; b=json.load(open('$TMP/body.json')); r=json.load(open('$TMP/append-res.json'))['data']['outcome']
print(json.dumps({'event_id': b['event_id'], 'outcome_id': r['id'], 'state': r['state'], 'asset_id': r['asset_id'], 'relation': r['relation']}))" >> "$TMP/posted.jsonl"
    else
      python3 -c "
import json; b=json.load(open('$TMP/body.json'))
print(json.dumps({'event_id': b['event_id'], 'error': '$(envelope_msg "$TMP/append-res.json" | tr -d '"')'}))" >> "$TMP/skipped.jsonl"
      warn "outcome/append for $(python3 -c "import json;print(json.load(open('$TMP/body.json'))['event_id'])") failed: $(envelope_msg "$TMP/append-res.json")"
    fi
  done < "$events"
  python3 - "$TMP/posted.jsonl" "$TMP/skipped.jsonl" "$rec" "$run_id" "$CONSUMER_KEY_FILE" <<'PY'
import json, sys, datetime
posted = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
skipped = [json.loads(l) for l in open(sys.argv[2], encoding="utf-8") if l.strip()]
json.dump({"schema": "core-outcomes-v1", "run_id": sys.argv[4],
           "synced_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "consumer_key_file": sys.argv[5], "evaluate": False,
           "posted": posted, "skipped": skipped}, open(sys.argv[3], "w", encoding="utf-8"), indent=2)
print(f"posted={len(posted)} skipped={len(skipped)}")
PY
  ok "$run_id: outcomes recorded in Core → $rec"
}

# ── modes ────────────────────────────────────────────────────────
: > "$TMP/actions.jsonl"; : > "$TMP/decisions.jsonl"
info "reading ${#ASSET_IDS[@]} baseline asset(s) …"
read_state "$TMP/before.json"; show_state "$TMP/before.json"

case "$MODE" in
  status) ;;
  sync)
    [[ -d "$SYNC_DIR" ]] || die "not a run directory: $SYNC_DIR"
    sync_run "$SYNC_DIR"
    ;;
  reset|apply)
    for id in "${ASSET_IDS[@]}"; do set_status "$id" "approved" "$(baseline_visibility "$id")"; done
    if [[ "$MODE" == "apply" ]]; then
      for id in "${ASSET_IDS[@]}"; do evaluate "$id"; done
    fi
    ;;
  seed)
    while IFS= read -r rid; do
      [[ -n "$rid" ]] || continue
      if [[ -d "$RUNS_DIR/$rid" ]]; then sync_run "$RUNS_DIR/$rid"; else warn "evidence-base run $rid not found under $RUNS_DIR"; fi
    done < <(python3 -c "import json;print('\n'.join(r['run_id'] for r in json.load(open('$BASELINE')).get('source_runs',[])))")
    for id in "${ASSET_IDS[@]}"; do evaluate "$id"; done
    ;;
esac

read_state "$TMP/after.json"
[[ "$MODE" == "status" ]] || { info "after:"; show_state "$TMP/after.json"; }

# ── record ───────────────────────────────────────────────────────
python3 - "$MODE" "$BASELINE" "$TMP/before.json" "$TMP/after.json" "$TMP/actions.jsonl" "$TMP/decisions.jsonl" "${OUT:-}" "$OWNER_KEY_FILE" <<'PY'
import json, sys, datetime, os
mode, baseline_p, before_p, after_p, actions_p, decisions_p, out, owner_key = sys.argv[1:9]
before = json.load(open(before_p)); after = json.load(open(after_p))
actions = [json.loads(l) for l in open(actions_p, encoding="utf-8") if l.strip()]
decisions = {d["asset_id"]: d for d in (json.loads(l) for l in open(decisions_p, encoding="utf-8") if l.strip())}
baseline = json.load(open(baseline_p))
expected = {}
if mode == "reset":
    expected = {aid: {"status": "approved", "visibility": (baseline["assets"][aid].get("baseline_visibility") or "team")} for aid in baseline["assets"]}
elif mode in ("apply", "seed"):
    tgt = {"reject": "failed", "admit": "approved", "pending": "candidate"}
    for aid in baseline["assets"]:
        d = decisions.get(aid, {}).get("decision") or {}
        if d: expected[aid] = {"status": tgt.get(d.get("decision")), "visibility": (baseline["assets"][aid].get("baseline_visibility") or "team")}
verified = {}
for aid, exp in expected.items():
    a = after.get(aid) or {}
    verified[aid] = bool(a) and a.get("status") == exp["status"] and a.get("visibility") == exp["visibility"]
# In seed mode, Core's decision must agree with the frozen baseline's.
baseline_check = None
if mode == "seed":
    frozen = {d["asset_id"]: d["decision"] for d in baseline.get("decisions", [])}
    baseline_check = {aid: {"frozen": frozen.get(aid), "core": (decisions.get(aid, {}).get("decision") or {}).get("decision"),
                            "agree": frozen.get(aid) == (decisions.get(aid, {}).get("decision") or {}).get("decision")} for aid in baseline["assets"]}
rec = {
    "schema": "core-gate-record-v1", "mode": mode, "mechanism": "core-status",
    "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "baseline": baseline_p, "baseline_frozen_at": baseline.get("frozen_at"), "owner_key_file": owner_key,
    "before": {aid: (None if r is None else {"status": r.get("status"), "visibility": r.get("visibility"), "gate_decision": r.get("gate_decision")}) for aid, r in before.items()},
    "actions": actions,
    "decisions": {aid: d.get("decision") for aid, d in decisions.items()},
    "after": {aid: (None if r is None else {"status": r.get("status"), "visibility": r.get("visibility"), "gate_decision": r.get("gate_decision"), "confidence": r.get("confidence"), "gate": r.get("gate")}) for aid, r in after.items()},
    "status_at_start": {aid: (None if r is None else r.get("status")) for aid, r in after.items()},
    "visibility_at_start": {aid: (None if r is None else r.get("visibility")) for aid, r in after.items()},
    "expected": expected, "verified": verified,
    "all_verified": (all(verified.values()) if verified else None),
    "baseline_check": baseline_check,
}
if out:
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    json.dump(rec, open(out, "w", encoding="utf-8"), indent=2)
    print(f"→ {out}")
if verified and not all(verified.values()):
    print("VERIFY FAILED: " + ", ".join(f"{a}: expected {expected[a]} got {rec['after'].get(a)}" for a, v in verified.items() if not v))
    sys.exit(1)
if baseline_check and not all(v["agree"] for v in baseline_check.values()):
    print("BASELINE DISAGREEMENT: " + json.dumps(baseline_check))
    sys.exit(1)
PY
