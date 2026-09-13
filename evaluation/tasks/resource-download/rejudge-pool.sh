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
TASK="$HERE"; SNAP="recorded"; OUT=""; BATCH=""; FROM="archive"
while [[ $# -gt 0 ]]; do case "$1" in
  --task) TASK="$(cd "$2" && pwd)"; shift 2;; --snapshot) SNAP="$2"; shift 2;;
  --out) OUT="$2"; shift 2;; --batch) BATCH="$2"; shift 2;;
  --from) FROM="$2"; shift 2;;   # archive(默认,入库副本)| tmp(清单里的 /private/tmp 路径)
  *) echo "unknown: $1" >&2; exit 2;; esac; done
case "$FROM" in archive|tmp) ;; *) echo "--from must be archive or tmp" >&2; exit 2;; esac
[[ -n "$OUT" ]] || { echo "要 --out" >&2; exit 2; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
NOTE="$(python3 -c "import json;print([k for k in json.load(open('$TASK/tokens.json')) if not k.startswith('_')][0])")"
CUR_V="$(python3 -c "import json;print(json.load(open('$TASK/tokens.json'))['$NOTE'].get('version',''))")"
node "$REPO/evaluation/attribution/resolve-tokens.mjs" --task="$TASK" --out="$WORK/tok.json" > "$WORK/resolve.log" 2>&1 \
  || { echo "判别值解析失败,一次也没重判:"; cat "$WORK/resolve.log"; exit 1; }

: > "$OUT"
python3 - "$TASK/devloop-runs.json" "$REPO" "${BATCH:-}" "$FROM" <<'RUNS' | while IFS=$'\t' read -r rid arm dir; do
import json, os, sys
m, repo, batch, frm = sys.argv[1:5]
for r in json.load(open(m))["runs"]:
    if r.get("arm") == "smoke" or not r.get("sample"):
        continue
    if batch and str(r.get("batch")) != batch:
        continue
    # 默认走**入库归档副本**:干净克隆里没有 /private/tmp,入库的 rows 必须能在那里逐字复现。
    arch = os.path.join(repo, "evaluation/runner/runs", r["run_id"])
    tmp = r.get("dir") or ""
    if frm == "archive":
        d = arch if os.path.exists(os.path.join(arch, "capture.jsonl")) else tmp
    else:
        d = tmp if (tmp and os.path.exists(os.path.join(tmp, "capture.jsonl"))) else arch
    print(f"{r['run_id']}\t{r['arm']}\t{d}")
RUNS
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

  # 逐运行独立目录。**先删固定路径的产物再跑**:两个阶段都往仓库里同一个路径写,
  # 上一次的输出留在那里,某一步失败时 cp 会把它当成这次的结果抄走(第十轮复核指出)。
  RD="$WORK/$rid"; mkdir -p "$RD"
  PROV_ART="$REPO/evaluation/provenance/artifacts/provenance-events.jsonl"
  USED_ART="$REPO/evaluation/attribution/artifacts/used-events.jsonl"
  rm -f "$PROV_ART" "$USED_ART"

  if ! (cd "$REPO" && node evaluation/provenance/build-events.mjs "$S" "$dir/tool-call-logs-all.jsonl" "$dir/capture.jsonl" > "$RD/prov.md" 2>&1); then
    row "{\"run_id\":\"$rid\",\"arm\":\"$arm\",\"rejudged\":false,\"error\":\"build-events\",\"why\":\"来源事件构建失败,不借用上一次的产物\"}"
    echo "  ERROR build-events $rid" >&2; continue
  fi
  [[ -f "$PROV_ART" ]] || { row "{\"run_id\":\"$rid\",\"arm\":\"$arm\",\"rejudged\":false,\"error\":\"build-events\",\"why\":\"这一步没有写出 provenance-events.jsonl\"}"; echo "  ERROR 无产物 $rid" >&2; continue; }
  cp "$PROV_ART" "$RD/events.jsonl"

  if ! (cd "$REPO" && node evaluation/attribution/judge-hard.mjs "$RD/events.jsonl" "$dir/run-artifacts.json" "$WORK/tok.json" > "$RD/judgement.md" 2>&1); then
    row "{\"run_id\":\"$rid\",\"arm\":\"$arm\",\"rejudged\":false,\"error\":\"judge-hard\",\"why\":\"判决失败,不借用上一次的产物\"}"
    echo "  ERROR judge-hard $rid" >&2; continue
  fi
  [[ -f "$USED_ART" ]] || { row "{\"run_id\":\"$rid\",\"arm\":\"$arm\",\"rejudged\":false,\"error\":\"judge-hard\",\"why\":\"这一步没有写出 used-events.jsonl\"}"; echo "  ERROR 无产物 $rid" >&2; continue; }
  cp "$USED_ART" "$RD/used.jsonl"

  python3 - "$rid" "$arm" "$dir/used-events.jsonl" "$RD/used.jsonl" "$NOTE" "$S" >> "$OUT" <<'FP'
import json, os, sys
rid, arm, before_p, after_p, note, snap = sys.argv[1:7]

def events(p):
    """逐事件取指纹。**只比状态名是不够的** —— 状态多重集相同、落在完全不同的调用上,
    也会被判成「一字不差复现」(第十轮复核指出)。加上目标类型、证据位置与版本。"""
    out = []
    try:
        for l in open(p, encoding="utf-8"):
            if not l.strip(): continue
            e = json.loads(l)
            if e.get("asset_id") != note: continue
            out.append("|".join([str(e.get("state")), str(e.get("target_type")),
                                 str(e.get("target_ref")), "v" + str(e.get("asset_version"))]))
    except FileNotFoundError:
        return []
    return sorted(out)

b, a = events(before_p), events(after_p)
print(json.dumps({"run_id": rid, "arm": arm, "rejudged": True, "snapshot": os.path.basename(snap),
  "note_in_snapshot": any(x["asset_id"] == note for x in json.load(open(snap, encoding="utf-8"))["assets"]),
  "before": [x.split("|")[0] for x in b], "after": [x.split("|")[0] for x in a],
  "before_fp": b, "after_fp": a, "changed": b != a}, ensure_ascii=False))
FP
  echo "  重判 $rid $arm" >&2
done
echo "rows → $OUT  ($(wc -l < "$OUT" | tr -d ' ') 行)"
