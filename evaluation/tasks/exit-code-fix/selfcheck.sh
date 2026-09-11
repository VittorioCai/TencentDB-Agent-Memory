#!/usr/bin/env bash
# The acceptance command for the exit-code task's verifier — the frozen start
# plus four segments, each an actual output, before any model run:
#
#   0  the frozen start            the working copy built from the start commit and
#                                  frozen (commit, tree, test files, the suite's own
#                                  result) BEFORE anything touches it
#   1  start + original failure    the verifier's reference test fails on that copy
#   2  reference fix passes        the reference patch applied to the same copy; the
#                                  same test passes; the copy is judged against the
#                                  frozen start
#   3  suite does not regress      the controlled suite (original test content) shows
#                                  no new identified failure; baseline failures listed
#   4  discriminative value        token-provenance on the note's value: all OK, no
#                                  unscanned gap (real value from Core when the note
#                                  is in the pool, else a dry-run value)
#
# Also writes conditions.json beside this script: start commit and tree, what the
# copy excludes, the hashes of the reference test and patch, the suite baseline,
# and the tracked files that already hold a correct implementation the model may
# find (known hints; they are part of the code under test and are not removed —
# review 2026-09-11 item 4: the note shortens the search, it is not the only
# source of the answer).
#
# Usage: bash evaluation/tasks/exit-code-fix/selfcheck.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
START="$(python3 -c "import json;print(json.load(open('$HERE/task.json'))['start_commit'])")"
TREE="$(git -C "$REPO" rev-parse "${START}^{tree}")"
WORK="$(mktemp -d /private/tmp/topic4-devloop-selfcheck.XXXX)"
COPY="$WORK/repo"; mkdir -p "$COPY"
sha() { shasum -a 256 "$1" | cut -c1-64; }
hr() { printf '\n%s\n' "════════════════════════════════════════════════════════════════════"; }

# ── working copy from the frozen commit: tracked files only, single commit ──
git -C "$REPO" archive --format=tar "$START" | tar -x -C "$COPY"
for ex in $(python3 -c "import json;print(' '.join(json.load(open('$HERE/task.json'))['archive_excludes']))"); do rm -rf "$COPY/$ex"; done
(cd "$COPY" && git init -q && git -c user.name=verifier -c user.email=verifier@local add -A && git -c user.name=verifier -c user.email=verifier@local commit -q -m "start $START")
FILES="$(cd "$COPY" && git ls-files | wc -l | tr -d ' ')"
TESTS_BASE="$(cd "$COPY" && git ls-files | grep -c '\.test\.mjs$')"
echo "working copy: $COPY"
echo "start commit $START (tree $TREE); $FILES tracked files, $TESTS_BASE test files; excluded: $(python3 -c "import json;print(', '.join(json.load(open('$HERE/task.json'))['archive_excludes']))")"
echo "runs/ present in copy: $([[ -d "$COPY/evaluation/runner/runs" ]] && echo yes || echo no);  task dir present in copy: $([[ -d "$COPY/evaluation/tasks/exit-code-fix" ]] && echo yes || echo no)"

hr; echo "【0】冻结起点:模型动手前记下副本的提交、树、测试清单与内容、套件自身结果(读不到未受控工件的测试会失败,记为基线)"
node "$HERE/verify.mjs" --freeze --repo="$COPY" --out="$WORK/start.json" --source="$START"; S0=$?
echo "exit $S0 (expected 0 = 套件结果可解释)"

hr; echo "【1】起点 + 原版失败:在冻结起点跑验证器自带的参考回归测试"
node "$HERE/verify.mjs" --repo="$COPY" --start="$WORK/start.json" --json > "$WORK/seg1.json" 2>"$WORK/seg1.err"; S1=$?
python3 - "$WORK/seg1.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); c=r["checks"]
print(f"verdict {r['verdict']}: {r['reason']}")
print(f"reference test: tests {c['reference_test']['tests']} pass {c['reference_test']['pass']} fail {c['reference_test']['fail']}")
print("\n".join("    "+l for l in c["reference_test"]["output"].splitlines() if l.startswith(("not ok","ok ")) or l.strip().startswith("error:")))
PY
echo "exit $S1 (expected 1 = FAIL)"

hr; echo "【2】参考修复通过:同一副本打上 reference/fix.patch,同一测试;判决对照冻结起点"
(cd "$COPY" && git apply "$HERE/reference/fix.patch") && echo "patch applied: $(cd "$COPY" && git diff --stat | tail -1)"
node "$HERE/verify.mjs" --repo="$COPY" --start="$WORK/start.json" --json > "$WORK/seg2.json" 2>"$WORK/seg2.err"; S2=$?
python3 - "$WORK/seg2.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); c=r["checks"]
print(f"verdict {r['verdict']}: {r['reason']}")
print(f"reference test: tests {c['reference_test']['tests']} pass {c['reference_test']['pass']} fail {c['reference_test']['fail']}")
print(f"compared with start {c['start']['commit'][:7]} (frozen {c['start']['frozen_at']}); copy HEAD {c['history']['head'][:7]}, commits after start {c['history']['commits_after_start']}")
print(f"diff: {[f['file'] for f in c['diff']['files']]}  out_of_scope {c['diff']['out_of_scope']}  touched_verifier {c['diff']['touched_verifier']}  deleted_tests {c['diff']['deleted_tests']}")
print(f"attempts: {[a['value'] for a in r['attempts']]}")
PY
echo "exit $S2 (expected 0 = PASS)"

hr; echo "【3】既有套件不回归:受控套件(起点的测试内容)+ 参考测试;基线绑定(文件, 测试名)"
python3 - "$WORK/seg2.json" "$TESTS_BASE" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); s=r["checks"]["suite"]; k=r["checks"]["tests_kept"]
print(f"controlled suite: state {s['state']}; {s['files']} test files (start {sys.argv[2]} + 1 reference), tests {s['tests']} pass {s['pass']} fail {s['fail']} cancelled {s['cancelled']}, exit {s['exit']}, explained {s['explained']}")
print(f"new failures vs the frozen start: {[(f['file'],f['name']) for f in (s['new_failures'] or [])]}")
print(f"baseline failures still failing ({len(s['baseline_still_failing'] or [])} of {s['baseline_size']}):")
for f in (s['baseline_still_failing'] or []): print(f"    {f['file']}: {f['name']}")
print(f"original tests: baseline {k['baseline']} files, missing {k['missing']}, rewritten {k['modified']}, model-added {k['added']}")
PY

hr; echo "【4】判别值来源唯一:token-provenance 对笔记判别值"
if [[ "$(python3 -c "import json;print(len([k for k in json.load(open('$HERE/tokens.json')) if not k.startswith('_')]))")" == "0" ]]; then
  echo "(笔记还没入池:tokens.json 为空,用 --dry-run 的新值证明扫描面;入池后用 --check 复跑本段)"
  node "$HERE/fill-note.mjs" --dry-run; S4=$?
else
  node "$HERE/fill-note.mjs" --check; S4=$?
fi
echo "exit $S4 (expected 0 = 全部 OK、零未扫描缺口)"

# ── conditions ──
# Known hints: tracked files at the start that already spell the exit line the
# real way, and those that already parse curl's own error line generically —
# the review's first-choice alternative (curl 52/56) is hinted the same way,
# which is why the task keeps the exit-line defect and changes its wording.
HINTS_EXIT="$(git -C "$REPO" grep -l 'Exit Code:' "$START" -- . | sed "s/^$START://" | tr '\n' ' ')"
HINTS_CURL="$(git -C "$REPO" grep -l -F 'curl: \((\d+)\)' "$START" -- . | sed "s/^$START://" | tr '\n' ' ')"
# The images the containers run and where the gate comes from (mount | image), read now — not the recorded runs' runtime
# (their Core image digest is unknown: devloop-runs.json config_fixes). Since 2026-09-12 the gate is built into the image.
RUNTIME_JSON="$(node --input-type=module -e "import { containerImage, coreMountRecord, coreMountLive } from '$REPO/evaluation/runner/batch-conditions.mjs'; const c = containerImage('tdai-memory-core'), p = containerImage('tdai-proxy'), m = coreMountLive('tdai-memory-core'); console.log(JSON.stringify({ core_gate: m.core_gate, core_mounted: m.core_mounted, mounted_commit: m.mounted_commit_now, core_image_build_commit: m.image_build_commit, memorycore_tree_at_build: m.memorycore_tree_at_build, memorycore_tree_now: m.memorycore_tree_now, core_mount: coreMountRecord(c?.image_id ?? null), core_image_digest: c?.image_id ?? null, core_image_ref: c?.image_ref ?? null, core_repo_digests: c?.repo_digests ?? [], core_image_created: c?.image_created ?? null, proxy_image_digest: p?.image_id ?? null, proxy_image_ref: p?.image_ref ?? null, proxy_repo_digests: p?.repo_digests ?? [], proxy_image_created: p?.image_created ?? null, recorded_live: true, read_at: new Date().toISOString().replace(/\\.\\d+Z$/, 'Z'), recorded_live_since: '2026-09-11', meaning: 'the containers as they run when this selfcheck runs (read live, not frozen at run time); the Core image the recorded runs used is unknown — see devloop-runs.json config_fixes' }));" 2>/dev/null || echo '{"error":"docker not readable"}')"
echo "runtime images: $(python3 -c "import json,sys;d=json.loads(sys.argv[1]);print('core', str(d.get('core_image_digest'))[:19], 'proxy', str(d.get('proxy_image_digest'))[:19])" "$RUNTIME_JSON")"
RUNTIME_JSON="$RUNTIME_JSON" python3 - "$HERE/conditions.json" "$START" "$TREE" "$FILES" "$TESTS_BASE" "$(sha "$HERE/reference/regression.reference.mjs")" "$(sha "$HERE/reference/fix.patch")" "$(sha "$HERE/verify.mjs")" "$HINTS_EXIT" "$HINTS_CURL" "$WORK/start.json" "$WORK/seg2.json" "$S0" "$S1" "$S2" "$S4" <<'PY'
import json,sys,datetime,os
runtime=json.loads(os.environ.get("RUNTIME_JSON") or "{}")
out,start,tree,files,tests,rt,rp,vf,hints_exit,hints_curl,startjson,seg2,s0,s1,s2,s4=sys.argv[1:17]
r=json.load(open(seg2)); st=json.load(open(startjson))
task=json.load(open(out.replace("conditions.json","task.json")))
import hashlib
doc={"frozen_at":datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z"),"start_commit":start,"start_tree":tree,
 "task_md_sha256":hashlib.sha256(open(out.replace("conditions.json","task.md"),"rb").read()).hexdigest(),
 "working_copy":{"how":"git archive <start> | tar -x; excludes removed; git init + one commit; frozen with verify.mjs --freeze before anything touches it","tracked_files":int(files),"test_files":int(tests),"excludes":task["archive_excludes"]},
 "reference":{"regression_test_sha256":rt,"fix_patch_sha256":rp,"verify_sha256":vf,"dest":task["reference_test_dest"],"acceptance_version":r.get("acceptance_version")},
 "suite_at_start":{k:v for k,v in st["suite_at_start"].items()},
 "suite_with_reference_fix":{k2:v for k2,v in r["checks"]["suite"].items() if k2 not in ("failures",)},
 "known_hints_in_tracked_files":{
   "exit_line_spelled_Exit_Code":[h for h in hints_exit.split() if h],
   "generic_curl_error_parser":[h for h in hints_curl.split() if h],
   "reading":"the copy already holds a correct implementation to refer to (evaluation/gate0/verify-capture.mjs reads `\\nExit Code: (-?\\d+)` and parses `curl: (N)` generically); the note's value is to shorten the search, not to be the only source of the answer. The review's first-choice alternative (curl 52/56 handling) is hinted by the same file, so the task keeps the exit-line defect and states this."},
 "runtime":runtime,
 "selfcheck":{"seg0_exit":int(s0),"seg1_exit":int(s1),"seg2_exit":int(s2),"seg4_exit":int(s4),"expected":{"seg0":0,"seg1":1,"seg2":0,"seg4":0}}}
json.dump(doc,open(out,"w"),indent=2,ensure_ascii=False); open(out,"a").write("\n")
print(f"\nconditions.json written ({out})")
PY
rm -rf "$WORK"
[[ "$S0" == "0" && "$S1" == "1" && "$S2" == "0" && "$S4" == "0" ]] && { echo "结论:验证器四段全过,可以跑模型"; exit 0; } || { echo "结论:验证器未全过(seg0=$S0 seg1=$S1 seg2=$S2 seg4=$S4)"; exit 1; }
