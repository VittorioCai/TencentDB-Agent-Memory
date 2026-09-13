#!/usr/bin/env bash
# 第三个任务笔记资产的准入/撤回。**用管理员密钥,属用户的步骤(CLAUDE.md §14),本仓库的会话不执行它。**
#
#   bash evaluation/tasks/resource-download/admit-note.sh --approve   # 有笔记组开跑前
#   bash evaluation/tasks/resource-download/admit-note.sh --revoke    # 有笔记组跑完置回 candidate
#   bash evaluation/tasks/resource-download/admit-note.sh --status    # 只读
#
# 为什么要管理员密钥:status 是审计字段,2026-09-08 起所有者写不了,只有团队管理员可以
# 作为一次管理行为改 status/confidence(见 evaluation/gate/core-gate.sh 的 set_status 注释)。
# visibility 归所有者,这里不碰 —— 它已经是 team。
#
# 每次写入后立刻读回,并把改动前后、命令、恢复命令写进 artifacts/(CLAUDE.md §10)。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
CORE="${CORE_URL:-http://localhost:8420}"
ADMIN_KEY_FILE="$REPO/deploy/global-images/.admin-key"
OWNER_KEY_FILE="$REPO/deploy/global-images/.topic4-user-key"
NOTE="$(python3 -c "import json;print([k for k in json.load(open('$HERE/tokens.json')) if not k.startswith('_')][0])")"

MODE=""
case "${1:-}" in --approve) MODE=approved ;; --revoke) MODE=candidate ;; --status) MODE=status ;;
  *) echo "usage: admit-note.sh --approve | --revoke | --status" >&2; exit 2 ;; esac

read_state() {  # key_file → "status visibility version name"
  local key; key="$(tr -d '[:space:]' < "$1")"
  curl -sS -X POST "$CORE/v3/meta/asset/get" -H 'content-type: application/json' \
    -H 'x-tdai-service-id: default' -H "authorization: Bearer $key" -H "x-tdai-user-key: $key" \
    -d "{\"asset_id\":\"$NOTE\"}" | python3 -c "
import json,sys
d=(json.load(sys.stdin) or {}).get('data') or {}
print(d.get('status','unreadable'), d.get('visibility','unreadable'), d.get('version','unreadable'), d.get('name','unreadable'))"
}

BEFORE="$(read_state "$OWNER_KEY_FILE")"
echo "改动前:$NOTE  $BEFORE  (status visibility version name)"
[[ "$MODE" == "status" ]] && exit 0

CUR_STATUS="${BEFORE%% *}"
[[ "$CUR_STATUS" != "$MODE" ]] || { echo "已经是 $MODE,无需改动。"; exit 0; }
# 只允许在这两个状态之间来回:任何别的状态(archived / failed …)都说明有别的事发生过,停下来问人
case "$CUR_STATUS" in candidate|approved) ;; *) echo "当前状态是 '$CUR_STATUS',不在 candidate/approved 之间;本脚本不处理,先查清楚。" >&2; exit 2 ;; esac
[[ -r "$ADMIN_KEY_FILE" ]] || { echo "读不到管理员密钥 $ADMIN_KEY_FILE" >&2; exit 2; }

AKEY="$(tr -d '[:space:]' < "$ADMIN_KEY_FILE")"
RESP="$(curl -sS -X POST "$CORE/v3/meta/asset/update" -H 'content-type: application/json' \
  -H 'x-tdai-service-id: default' -H "authorization: Bearer $AKEY" -H "x-tdai-user-key: $AKEY" \
  -d "{\"asset_id\":\"$NOTE\",\"status\":\"$MODE\"}")"
echo "$RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('写入应答: code', d.get('code'), d.get('message'))
sys.exit(0 if d.get('code')==0 else 1)" || { echo "写入被拒,状态未改。**保留原始原因,不要换个渠道重试**(CLAUDE.md §14)。" >&2; exit 1; }

AFTER="$(read_state "$OWNER_KEY_FILE")"
echo "改动后:$NOTE  $AFTER"
[[ "${AFTER%% *}" == "$MODE" ]] || { echo "读回与预期不符,停下来查。" >&2; exit 1; }

TS="$(date -u +%Y%m%dT%H%M%SZ)"
REC="$HERE/artifacts/note-admission-$TS.json"
python3 - "$REC" "$NOTE" "$BEFORE" "$AFTER" "$MODE" "$TS" <<'PY'
import json, sys
rec, note, before, after, mode, ts = sys.argv[1:7]
f = lambda s: dict(zip(("status","visibility","version","name"), s.split()))
json.dump({
  "schema": "live-state-record-v1",
  "at": ts[:4]+"-"+ts[4:6]+"-"+ts[6:11]+":"+ts[11:13]+":"+ts[13:16],
  "what": f"第三个开发闭环任务的笔记资产 status → {mode}",
  "asset_id": note, "before": f(before), "after": f(after),
  "by": {"key_file": "deploy/global-images/.admin-key", "role": "team admin(status 是审计字段,所有者写不了)"},
  "how": f"bash evaluation/tasks/resource-download/admit-note.sh --{'approve' if mode=='approved' else 'revoke'}",
  "restore": "bash evaluation/tasks/resource-download/admit-note.sh --" + ("revoke" if mode == "approved" else "approve"),
  "verified": "写入后以所有者密钥读回,status 与预期一致;visibility 未改动(归所有者)。",
}, open(rec, "w"), indent=2, ensure_ascii=False)
open(rec, "a").write("\n")
print("记录 →", rec)
PY
