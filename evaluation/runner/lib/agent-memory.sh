# The product's own memory of the consumer — guard, snapshot, rollback.
#
# Sourced by run-once.sh. Everything here talks to the Core container through
# `docker exec`, which is what the unit test replaces with a shim that runs the
# same commands against a temporary directory; the functions themselves are
# what production runs.
#
# L2 scene blocks and the L3 persona live under profiles/<team|agent>/ and are
# the product's memory of this agent. They accumulate ACROSS runs: batch 3 found
# a scene block, written in the middle of that batch's own window, carrying
# conclusions from earlier runs and both scenario addresses — run five was
# reading what runs one to four had taught it. Hence: snapshot before, restore
# after, record the hashes either way.
#
# Two later findings shape the order of operations:
#   * The memory pipeline writes the previous session's consolidation late —
#     seconds to minutes after the session ended — so it can land between two
#     runs, after the earlier run's rollback. MEM_EXPECT_EMPTY=1 clears the
#     consumer's profile before the run and records how many files went.
#   * Batch 4 (2026-09-10) showed the guard and the snapshot in the wrong
#     order: the tree was tarred BEFORE the residue was cleared, so the rollback
#     put the residue back. Every run started empty (the guard did its job), but
#     `hash_restored` never equalled `hash_before` again. The snapshot must be
#     taken from the state the run actually starts in: guard first, then tar.

MEM_ROOT="${MEM_ROOT:-/data/tdai-memory/profiles}"

# run-once.sh defines info/warn; stand-alone use (tests) gets plain echoes.
if ! type info >/dev/null 2>&1; then info() { echo "[mem] $*"; }; fi
if ! type warn >/dev/null 2>&1; then warn() { echo "[mem] warn: $*" >&2; }; fi

mem_exec() { docker exec "${CORE_CONTAINER:-tdai-memory-core}" "$@"; }

mem_hash() {  # prints a stable hash of the agent memory tree, or "absent"
  mem_exec sh -c \
    "cd '$MEM_ROOT' 2>/dev/null && find . -type f | LC_ALL=C sort | xargs -r sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1" 2>/dev/null || echo absent
}
# The consumer's own share of that tree. The whole-tree hash drifts when the
# pipeline writes to *another* agent's profile (measured 2026-09-08 23:20Z, 73
# minutes after the isolated batch), and those files never reach this run's
# model. Start points across a batch are compared on this hash when recorded.
mem_hash_scoped() {  # hash of the files under the consumer's profile dir(s), "absent" if none
  [[ -n "${MEM_AGENT:-}" ]] || { echo absent; return; }
  mem_exec sh -c \
    "cd '$MEM_ROOT' 2>/dev/null && find . -type f -path '*agent%3A$MEM_AGENT*' | LC_ALL=C sort | xargs -r sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1" 2>/dev/null || echo absent
}
mem_files_scoped() {
  [[ -n "${MEM_AGENT:-}" ]] || { echo 0; return; }
  mem_exec sh -c \
    "cd '$MEM_ROOT' 2>/dev/null && find . -type f -path '*agent%3A$MEM_AGENT*' | wc -l | tr -d ' '" 2>/dev/null || echo 0
}

# An empty-baseline batch (MEM_EXPECT_EMPTY=1): the consumer's profile must not
# exist when the session starts. If a late pipeline write landed, clear the
# consumer's profile (its designed baseline is empty) and record how many files
# were cleared, so the trial checkpoint judges hash_before against the frozen
# empty baseline honestly instead of silently starting polluted.
mem_clear_residue() {
  MEM_PRE_RUN_CLEARED=0
  if [[ "${MEM_EXPECT_EMPTY:-0}" == "1" && -n "${MEM_AGENT:-}" ]]; then
    local n_before
    n_before="$(mem_files_scoped)"
    if (( n_before > 0 )); then
      warn "consumer $MEM_AGENT has $n_before file(s) before the run (late pipeline write); clearing to the frozen empty baseline"
      mem_exec sh -c "cd '$MEM_ROOT' && rm -rf ./*agent%3A$MEM_AGENT*" 2>/dev/null || warn "could not clear the consumer profile"
      MEM_PRE_RUN_CLEARED="$n_before"
    fi
  fi
}

# Tar the whole tree to MEM_SNAP. What is in the tar is what the rollback puts
# back, so this must run from the state the session starts in.
mem_snapshot() {
  if [[ "${ISOLATE_AGENT_MEMORY:-1}" == "1" ]]; then
    if mem_exec test -d "$MEM_ROOT" 2>/dev/null; then
      mem_exec tar czf - -C "$MEM_ROOT" . > "$MEM_SNAP" 2>/dev/null \
        && info "agent memory snapshotted ($(mem_hash | cut -c1-12)…)" \
        || warn "could not snapshot agent memory; this run is not isolated from earlier ones"
    else
      warn "no agent memory tree at $MEM_ROOT — nothing to isolate"
    fi
  fi
}

# Before the session: guard first, then snapshot, then the start-point hashes.
# The tar is what the rollback puts back, so it must be taken AFTER the residue
# is cleared — otherwise the rollback re-installs the very files the guard
# removed, and hash_restored can never equal hash_before.
mem_prepare() {
  mem_clear_residue
  mem_snapshot
  MEM_HASH_BEFORE="$(mem_hash)"
  MEM_SCOPE_BEFORE="$(mem_hash_scoped)"; MEM_SCOPE_FILES_BEFORE="$(mem_files_scoped)"
  [[ -n "${MEM_AGENT:-}" ]] && info "consumer $MEM_AGENT memory: $MEM_SCOPE_FILES_BEFORE file(s), $(cut -c1-12 <<<"$MEM_SCOPE_BEFORE")…"
  return 0
}

# After the session: what the run wrote is kept beside the run (agent-memory-
# after.tar.gz) and then rolled back, so the next run starts where this one did.
# hash_after answers "what did the run write"; hash_restored, taken after the
# rollback, answers "did the rollback succeed".
mem_rollback() {
  MEM_HASH_AFTER="$(mem_hash)"
  MEM_SCOPE_AFTER="$(mem_hash_scoped)"; MEM_SCOPE_FILES_AFTER="$(mem_files_scoped)"
  if [[ "${ISOLATE_AGENT_MEMORY:-1}" == "1" && -s "$MEM_SNAP" ]]; then
    mem_exec tar czf - -C "$MEM_ROOT" . > "${RUN_DIR:-.}/agent-memory-after.tar.gz" 2>/dev/null || :
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
}
