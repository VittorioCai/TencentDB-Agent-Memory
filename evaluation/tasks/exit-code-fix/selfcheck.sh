#!/usr/bin/env bash
# The acceptance command for the exit-code task's verifier — four segments,
# each an actual output, before any model run:
#
#   1  start + original failure   the working copy at the frozen start commit; the
#                                 verifier's reference test fails there
#   2  reference fix passes       the reference patch applied to the same copy; the
#                                 same test passes
#   3  suite does not regress     the whole suite passes on the patched copy, counts
#   4  discriminative value       token-provenance on the note's value: all OK, no
#                                 unscanned gap (real value from Core when the note
#                                 is in the pool, else a dry-run value)
#
# Also writes conditions.json beside this script: start commit and tree, what the
# copy excludes, the hashes of the reference test and patch, the suite baseline,
# and the tracked files that already spell the exit line the real way (known
# hints the model may find; they are part of the code under test).
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

hr; echo "【0】起点的套件基线:未改动的副本上全套测试(只含受版本控制的文件;读不到未受控工件的测试会失败,记为基线)"
(cd "$COPY" && env -u NODE_TEST_CONTEXT node --test $(find evaluation -name '*.test.mjs' -not -path '*/node_modules/*' | sort) > "$WORK/seg0.txt" 2>&1); S0=$?
python3 - "$WORK/seg0.txt" "$HERE/suite-baseline.json" "$START" "$S0" <<'PY2'
import json,re,sys
out=open(sys.argv[1],encoding="utf-8").read()
n=lambda k: (lambda m: int(m.group(1)) if m else None)(re.search(rf"^(?:ℹ|#) {k} (\d+)",out,re.M))
failing=sorted({re.sub(r"\s*\([\d.]+ms\)$","",l[1:].strip()) for l in out.splitlines() if l.startswith("✖ ")} - {"failing tests:"})
doc={"start_commit":sys.argv[3],"exit":int(sys.argv[4]),"tests":n("tests"),"pass":n("pass"),"fail":n("fail"),"failing_tests":failing,
     "why":"the copy holds tracked files only; tests that read untracked artifacts fail here and are the baseline, not a regression"}
json.dump(doc,open(sys.argv[2],"w"),indent=2,ensure_ascii=False); open(sys.argv[2],"a").write("\n")
print(f"suite at start: tests {doc['tests']} pass {doc['pass']} fail {doc['fail']} (exit {doc['exit']}); baseline failing: {failing}")
PY2

hr; echo "【1】起点 + 原版失败:在冻结起点跑验证器自带的参考回归测试"
node "$HERE/verify.mjs" --repo="$COPY" --json > "$WORK/seg1.json" 2>"$WORK/seg1.err"; S1=$?
python3 - "$WORK/seg1.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); c=r["checks"]
print(f"verdict {r['verdict']}: {r['reason']}")
print(f"reference test: tests {c['reference_test']['tests']} pass {c['reference_test']['pass']} fail {c['reference_test']['fail']}")
print("\n".join("    "+l for l in c["reference_test"]["output"].splitlines() if l.startswith(("✔","✖","ℹ tests","ℹ pass","ℹ fail")) or l.strip().startswith("AssertionError")))
PY
echo "exit $S1 (expected 1 = FAIL)"

hr; echo "【2】参考修复通过:同一副本打上 reference/fix.patch,同一测试"
(cd "$COPY" && git apply "$HERE/reference/fix.patch") && echo "patch applied: $(cd "$COPY" && git diff --stat | tail -1)"
node "$HERE/verify.mjs" --repo="$COPY" --json > "$WORK/seg2.json" 2>"$WORK/seg2.err"; S2=$?
python3 - "$WORK/seg2.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); c=r["checks"]
print(f"verdict {r['verdict']}: {r['reason']}")
print(f"reference test: tests {c['reference_test']['tests']} pass {c['reference_test']['pass']} fail {c['reference_test']['fail']}")
print("\n".join("    "+l for l in c["reference_test"]["output"].splitlines() if l.startswith(("✔","✖"))))
print(f"diff: {[f['file'] for f in c['diff']['files']]}  out_of_scope {c['diff']['out_of_scope']}  touched_verifier {c['diff']['touched_verifier']}  deleted_tests {c['diff']['deleted_tests']}")
PY
echo "exit $S2 (expected 0 = PASS)"

hr; echo "【3】既有套件不回归:参考补丁下全套测试"
python3 - "$WORK/seg2.json" "$TESTS_BASE" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); s=r["checks"]["suite"]; k=r["checks"]["tests_kept"]
print(f"suite: {s['files']} test files (baseline {sys.argv[2]} + 1 reference), tests {s['tests']} pass {s['pass']} fail {s['fail']}, exit {s['exit']}")
print(f"new failures vs the start baseline: {s.get('new_failures')}; baseline failures still failing: {s.get('baseline_still_failing')}")
print(f"tests kept: baseline {k['baseline']} files, missing {k['missing']}")
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
HINTS="$(git -C "$REPO" grep -l 'Exit Code:' "$START" -- . | sed "s/^$START://" | tr '\n' ' ')"
python3 - "$HERE/conditions.json" "$START" "$TREE" "$FILES" "$TESTS_BASE" "$(sha "$HERE/reference/regression.reference.mjs")" "$(sha "$HERE/reference/fix.patch")" "$(sha "$HERE/verify.mjs")" "$HINTS" "$WORK/seg2.json" "$S1" "$S2" "$S4" <<'PY'
import json,sys,datetime
out,start,tree,files,tests,rt,rp,vf,hints,seg2,s1,s2,s4=sys.argv[1:14]
r=json.load(open(seg2))
doc={"frozen_at":datetime.datetime.utcnow().replace(microsecond=0).isoformat()+"Z","start_commit":start,"start_tree":tree,
 "working_copy":{"how":"git archive <start> | tar -x; excludes removed; git init + one commit","tracked_files":int(files),"test_files":int(tests),"excludes":json.load(open(out.replace("conditions.json","task.json")))["archive_excludes"]},
 "reference":{"regression_test_sha256":rt,"fix_patch_sha256":rp,"verify_sha256":vf,"dest":json.load(open(out.replace("conditions.json","task.json")))["reference_test_dest"]},
 "suite_at_start":json.load(open(out.replace("conditions.json","suite-baseline.json"))),
 "suite_with_reference_fix":{k2:v for k2,v in r["checks"]["suite"].items() if k2!="failing"},
 "known_hints_in_tracked_files":[h for h in hints.split() if h],
 "selfcheck":{"seg1_exit":int(s1),"seg2_exit":int(s2),"seg4_exit":int(s4),"expected":{"seg1":1,"seg2":0,"seg4":0}}}
json.dump(doc,open(out,"w"),indent=2,ensure_ascii=False); open(out,"a").write("\n")
print(f"\nconditions.json written ({out})")
PY
rm -rf "$WORK"
[[ "$S1" == "1" && "$S2" == "0" && "$S4" == "0" ]] && { echo "结论:验证器四段全过,可以跑模型"; exit 0; } || { echo "结论:验证器未全过(seg1=$S1 seg2=$S2 seg4=$S4)"; exit 1; }
