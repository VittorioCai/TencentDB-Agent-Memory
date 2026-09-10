#!/usr/bin/env bash
# Move finished run records from the outside-the-repo staging root into
# evaluation/runner/runs/. Deliberately separate from run-once.sh (2026-09-11):
# while a batch is running, every record carries the current trace values
# (verdict.json attempts[].value, receipts, tool-call logs), and a session that
# finds the repository would read them. Collect only when no further session
# will run under these trace values — after the batch, before the next
# fill-traces rotates them.
#
# Usage: bash evaluation/runner/collect-runs.sh [--dry-run]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNS_DIR="${RUNS_DIR:-$REPO_ROOT/evaluation/runner/runs}"
RECORDS_ROOT="${RUN_RECORDS_ROOT:-/private/tmp/topic4-runs}"
DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1
[[ -d "$RECORDS_ROOT" ]] || { echo "nothing staged at $RECORDS_ROOT"; exit 0; }
mkdir -p "$RUNS_DIR"
moved=0
for parent in "$RECORDS_ROOT"/*.*; do
  [[ -d "$parent" ]] || continue
  for run in "$parent"/*/; do
    [[ -d "$run" ]] || continue
    run="${run%/}"; id="$(basename "$run")"
    if [[ -e "$RUNS_DIR/$id" ]]; then echo "skip $id (already in runs/)"; continue; fi
    if (( DRY )); then echo "would move $run → $RUNS_DIR/$id"; continue; fi
    mv "$run" "$RUNS_DIR/$id" && rmdir "$parent" 2>/dev/null; echo "moved $id"; moved=$((moved + 1))
  done
done
echo "collected $moved run(s) into $RUNS_DIR"
