#!/usr/bin/env bash
# 重判一个闭环任务的采用归因,**原记录一个字节都不动**,结果逐次写成 rows。
#
#   bash evaluation/tasks/resource-download/rejudge-pool.sh --task <任务目录> --snapshot recorded|<路径> --out <rows.jsonl> [--batch N]
#
#     --snapshot recorded   每次运行用它自己当初存下的那份 asset-pool-snapshot.json
#                           → 这是**保真对照**:必须复现出当初记下的判定,复现不了就说明重放装置不可信
#     --snapshot <路径>     统一换成这一份冻结快照 → 这是**待验的改动**
#
# 为什么要重判:build-events.mjs:461 对不在冻结池快照里的资产直接 continue,一个事件都不写。
# 有笔记组的流程是「快照冻结时笔记还是 candidate → 之后才准入」,笔记因此从来不在快照里,
# fetched 不写、后面无从 credit。判据先冻结在 rejudge-criteria.json。
#
# 判别值明文只在 Core(§16),按冻结四元组取回。**已烧毁的版本解析不到 —— 那样的运行只能标 unresolvable,
# 不能算作「重判后没有 used」**,否则烧毁会被当成证据。
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
TASK="$HERE"; SNAP="recorded"; OUT=""; BATCH=""
while [[ $# -gt 0 ]]; do case "$1" in
  --task) TASK="$(cd "$2" && pwd)"; shift 2;; --snapshot) SNAP="$2"; shift 2;;
  --out) OUT="$2"; shift 2;; --batch) BATCH="$2"; shift 2;; *) echo "unknown: $1" >&2; exit 2;; esac; done
[[ -n "$OUT" ]] || { echo "要 --out" >&2; exit 2; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
NOTE="$(python3 -c "import json;print([k for k in json.load(open('$TASK/tokens.json')) if not k.startswith('_')][0])")"
CUR_V="$(python3 -c "import json;print(json.load(open('$TASK/tokens.json'))['$NOTE'].get('version',''))")"
node "$REPO/evaluation/attribution/resolve-tokens.mjs" --task="$TASK" --out="$WORK/tok.json" > "$WORK/resolve.log" 2>&1 \
  || { echo "判别值解析失败,一次也没重判:"; cat "$WORK/resolve.log"; exit 1; }

: > "$OUT"
python3 - "$TASK/devloop-runs.json" "$REPO" "${BATCH:-}" <<'PY' | while IFS=$'\t' read -r rid arm dir; do
import json, os, sys
m, repo, batch = sys.argv[1], sys.argv[2], sys.argv[3]
for r in json.load(open(m))["runs"]:
    if r.get("arm") == "smoke" or not r.get("sample"):
        continue
    if batch and str(r.get("batch")) != batch:
        continue
    d = r.get("dir") or ""
    if not (d and os.path.exists(os.path.join(d, "capture.jsonl"))):
        d = os.path.join(repo, "evaluation/runner/runs", r["run_id"])   # 仓库归档副本
    print(f"{r['run_id']}\t{r['arm']}\t{d}")
PY
  row() { python3 -c "import json,sys;print(json.dumps(json.loads(sys.argv[1]),ensure_ascii=False))" "$1" >> "$OUT"; }
  if [[ ! -s "$dir/capture.jsonl" ]]; then
    row "{\"run_id\":\"$rid\",\"arm\":\"$arm\",\"rejudged\":false,\"why\":\"记录不在了\"}"; continue
  fi
  # 当初那次判决用的登记簿。笔记**不在里面**,说明那次运行根本不是对着这条笔记判的
  # (2026-09-11 早期的运行判的是批次四的资产),拿它比对是无意义的假阳。
  RUN_V="$(python3 -c "import json;d=json.load(open('$dir/tokens.json'));print(d.get('$NOTE',{}).get('version',''))" 2>/dev/null || echo "")"
  if [[ -z "$RUN_V" ]]; then
    row "{\"run_id\":\"$rid\",\"arm\":\"$arm\",\"rejudged\":false,\"why\":\"当初的 tokens.json 里没有这条笔记 —— 那次运行不是对着它判的\"}"
    echo "  跳过(当初不判这条笔记) $rid" >&2; continue
  fi
  if [[ -n "$CUR_V" && "$RUN_V" != "$CUR_V" ]]; then
    row "{\"run_id\":\"$rid\",\"arm\":\"$arm\",\"rejudged\":false,\"why\":\"运行时是 v$RUN_V,当前登记 v$CUR_V —— 那一版判别值已烧毁,解析不到,重判会假阴\"}"
    echo "  跳过(判别值已烧毁) $rid" >&2; continue
  fi
  case "$SNAP" in recorded) S="$dir/asset-pool-snapshot.json";; *) S="$SNAP";; esac
  [[ -s "$S" ]] || { row "{\"run_id\":\"$rid\",\"arm\":\"$arm\",\"rejudged\":false,\"why\":\"没有可用的池快照\"}"; continue; }
  (cd "$REPO" && node evaluation/provenance/build-events.mjs "$S" "$dir/tool-call-logs-all.jsonl" "$dir/capture.jsonl" > "$WORK/prov.md" 2>&1) || true
  cp "$REPO/evaluation/provenance/artifacts/provenance-events.jsonl" "$WORK/events.jsonl" 2>/dev/null || : > "$WORK/events.jsonl"
  (cd "$REPO" && node evaluation/attribution/judge-hard.mjs "$WORK/events.jsonl" "$dir/run-artifacts.json" "$WORK/tok.json" > "$WORK/judgement.md" 2>&1) || true
  cp "$REPO/evaluation/attribution/artifacts/used-events.jsonl" "$WORK/used.jsonl" 2>/dev/null || : > "$WORK/used.jsonl"
  python3 - "$rid" "$arm" "$dir/used-events.jsonl" "$WORK/used.jsonl" "$NOTE" "$S" >> "$OUT" <<'PY'
import json, os, sys
rid, arm, before_p, after_p, note, snap = sys.argv[1:7]
def states(p):
    try:
        out = []
        for l in open(p, encoding="utf-8"):
            if not l.strip(): continue
            e = json.loads(l)
            if e.get("asset_id") == note: out.append(e["state"])
        return sorted(out)
    except FileNotFoundError:
        return []
b, a = states(before_p), states(after_p)
print(json.dumps({"run_id": rid, "arm": arm, "rejudged": True, "snapshot": os.path.basename(snap),
  "note_in_snapshot": any(x["asset_id"] == note for x in json.load(open(snap, encoding="utf-8"))["assets"]),
  "before": b, "after": a, "changed": b != a}, ensure_ascii=False))
PY
  echo "  重判 $rid $arm" >&2
done
echo "rows → $OUT  ($(wc -l < "$OUT" | tr -d ' ') 行)"
