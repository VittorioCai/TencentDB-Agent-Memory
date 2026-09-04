#!/usr/bin/env bash
# One command, five segments, one question each:
#
#   1. What is in the asset pool, and who wrote it?
#   2. With the gate off, what happens?
#   3. What did attribution conclude, and what did it change?
#   4. With the gate on, what happens?
#   5. How accurate is the judgement itself?
#
# Every segment is labelled [live] or [fixture]. A [live] segment is produced by
# actually running something now; a [fixture] segment reads sample data from
# evaluation/contracts/fixtures/. The distinction is enforced by seg_begin(),
# which refuses to print without a source, because a demo that renders sample
# data as if it were a real result is the same failure this project exists to
# prevent.
#
# Usage:
#   bash evaluation/demo.sh            # run everything
#   bash evaluation/demo.sh --plain    # no colour (for piping into a file)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES="$SCRIPT_DIR/contracts/fixtures"
ARTIFACTS="$SCRIPT_DIR/provenance/artifacts"

if [[ "${1:-}" == "--plain" || ! -t 1 ]]; then
  C_DIM=""; C_B=""; C_G=""; C_Y=""; C_R=""; C_0=""
else
  C_DIM=$'\033[2m'; C_B=$'\033[1m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_0=$'\033[0m'
fi

LIVE_COUNT=0
FIXTURE_COUNT=0

# seg_begin <n> <title> <live|fixture> [note]
# The source tag is mandatory. Callers cannot print a segment without declaring
# where its data came from.
seg_begin() {
  local n="$1" title="$2" src="$3" note="${4:-}"
  local tag
  case "$src" in
    live)    tag="${C_G}[live]${C_0}";    LIVE_COUNT=$((LIVE_COUNT + 1)) ;;
    fixture) tag="${C_Y}[fixture]${C_0}"; FIXTURE_COUNT=$((FIXTURE_COUNT + 1)) ;;
    *) echo "demo.sh: segment $n declared an unknown source '$src'" >&2; exit 2 ;;
  esac
  echo
  echo "${C_B}[$n/5] $title${C_0}  $tag${note:+  ${C_DIM}$note${C_0}}"
  echo "${C_DIM}────────────────────────────────────────────────────────────${C_0}"
}

row() { printf '      %s\n' "$*"; }
note() { echo "      ${C_DIM}$*${C_0}"; }

have_stack() { docker ps --format '{{.Names}}' 2>/dev/null | grep -q tdai-memory-core; }

# ── 1. The asset pool ────────────────────────────────────────────
segment_pool() {
  if have_stack && bash "$SCRIPT_DIR/provenance/snapshot-assets.sh" >/tmp/demo-snap.log 2>&1; then
    seg_begin 1 "Asset pool" live
    python3 - "$ARTIFACTS/asset-pool-snapshot.json" <<'PY'
import json, sys
snap = json.load(open(sys.argv[1]))
owners = {a["producer_user_id"] for a in snap["assets"] if a["producer_user_id"]}
print(f"      frozen at {snap['pool_snapshot_at']}   team {snap['team_id']}")
for a in snap["assets"]:
    print(f"      {a['asset_id']:<22} {a['name'][:34]:<36} author={a['producer_user_id']}")
print(f"      {snap['asset_count']} asset(s), {len(owners)} distinct author(s)")
if len(owners) <= 1:
    print("      note: only one author so far; identity B has not written anything yet")
PY
    # Cross-person reuse is judged on user_id, so the demo must show that a
    # second identity exists and which role each one plays.
    local id_b
    id_b="$(sed -n 's/^USER_ID_B=//p' "$SCRIPT_DIR/gate0/codebuddy-binding.env" 2>/dev/null | head -1)"
    row ""
    row "identities:  usr-n3h5ewx4ja authors   ${id_b:-<not created>} consumes"
    note "both operated by one person: the mechanism is real, ecological validity is not"
  else
    seg_begin 1 "Asset pool" fixture "stack unavailable"
    row "see evaluation/provenance/README.md for the live path"
  fi
}

# ── 2. Gate off ──────────────────────────────────────────────────
segment_gate_off() {
  seg_begin 2 "Gate off — identity B runs the task" fixture "needs the E2E runner (P4-3)"
  row "injected 2 assets -> model fetched the wrong-address skill"
  row "curl timed out after 75 s -> acceptance FAILED"
  row "receipt:  fetched  wrong-address skill  ·  related check verify.sh did not pass"
}

# ── 3. Attribution ───────────────────────────────────────────────
segment_attribution() {
  seg_begin 3 "Attribution, and what it changed" fixture "needs the hard-evidence judge (P1-5)"
  python3 - "$FIXTURES/provenance-events.jsonl" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
for r in rows:
    if r["state"] in ("used", "corrected") and r["evidence_tier"] == "hard":
        detail = (r["proof_refs"][0].get("detail") or "")[:52]
        print(f"      {r['state']:<10} {r['asset_name'][:30]:<32} {r['relation']:<11} {detail}")
print("      author confidence for the producer drops once a corrected record lands")
PY
}

# ── 4. Gate on ───────────────────────────────────────────────────
segment_gate_on() {
  seg_begin 4 "Gate on — same task again" fixture "needs the rule engine (P2-2)"
  python3 - "$FIXTURES/gate-decision.json" <<'PY'
import json, sys
for d in json.load(open(sys.argv[1])):
    why = d["reasons"][0][:58]
    print(f"      {d['decision']:<8} {d['asset_name'][:30]:<32} {why}")
PY
  row ""
  row "injected 1 asset -> fetched the right-address skill -> acceptance PASSED"
}

# ── 5. Is the judgement itself accurate? ─────────────────────────
segment_selfcheck() {
  local out pass total
  out="$(cd "$REPO_ROOT" && node --test \
      evaluation/gate0/verify-capture.test.mjs \
      evaluation/provenance/build-events.test.mjs \
      evaluation/contracts/validate.test.mjs 2>&1)"
  pass="$(sed -n 's/^# *pass \([0-9]*\)/\1/p;s/^ℹ pass \([0-9]*\)/\1/p' <<<"$out" | tail -1)"
  total="$(sed -n 's/^# *tests \([0-9]*\)/\1/p;s/^ℹ tests \([0-9]*\)/\1/p' <<<"$out" | tail -1)"

  seg_begin 5 "Is the judgement itself accurate?" live
  if [[ -n "${pass:-}" && "$pass" == "${total:-}" ]]; then
    row "regression suite ${C_G}${pass}/${total} passing${C_0}"
  else
    row "regression suite ${C_R}${pass:-?}/${total:-?}${C_0}"
  fi
  note "including one test per false positive the earlier verifier fell for:"
  note "  command echo · an asset discussing the endpoints · the checker matching itself"
  echo
  row "${C_Y}precision / recall against the leave-one-out gold standard: not yet measured${C_0}"
  note "produced by P4-6; the number stays absent rather than being a placeholder"
}

# ── main ─────────────────────────────────────────────────────────
echo
echo "${C_B}Trustworthy attribution — end-to-end demo${C_0}"
echo "${C_DIM}$(date -u '+%Y-%m-%dT%H:%M:%SZ')${C_0}"

segment_pool
segment_gate_off
segment_attribution
segment_gate_on
segment_selfcheck

echo
echo "${C_DIM}────────────────────────────────────────────────────────────${C_0}"
echo "${C_B}Segments:${C_0} ${C_G}${LIVE_COUNT} live${C_0}, ${C_Y}${FIXTURE_COUNT} fixture${C_0}"
if (( FIXTURE_COUNT > 0 )); then
  echo "${C_DIM}A fixture segment reads sample data. It is replaced by a live run as each${C_0}"
  echo "${C_DIM}module lands; the tag is the honest record of which is which.${C_0}"
fi
echo
