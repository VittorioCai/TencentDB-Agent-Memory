#!/usr/bin/env bash
# 单独拉起 proxy（context-proxy，端口 8096）。
#
# proxy 的转发上游走 PROXY_UPSTREAM_URL（与 memory 组的 MEMORY_LLM_* 独立）。
# proxy 会调 memory:8420 做鉴权 / skill / tdai memory 注入；调 memory-hub:8125
# 做 sessionInit control plane。可以单跑 proxy 但相关能力会降级 / 关闭。
#
# 用法：
#   ./start-proxy.sh
#
# 需要以下 proxy 组参数（写在 .env）：
#   PROXY_UPSTREAM_URL / PROXY_UPSTREAM_API_KEY / PROXY_UPSTREAM_MODEL

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

load_env
require_vars \
  PROXY_IMAGE PROXY_PORT \
  PROXY_UPSTREAM_URL PROXY_UPSTREAM_API_KEY PROXY_UPSTREAM_MODEL

# 与 memory-core 保持一致的 gateway 内部凭据（默认 local，仅本地体验）
MEMORY_CORE_GATEWAY_API_KEY="${MEMORY_CORE_GATEWAY_API_KEY:-local}"

CONTAINER=tdai-proxy
NETWORK=tdai-memory-stack

if ! $DOCKER network inspect "$NETWORK" >/dev/null 2>&1; then
  info "创建 docker 网络 $NETWORK"
  $DOCKER network create "$NETWORK" >/dev/null
fi

# 依赖检查（不阻塞，仅提醒）
if ! $DOCKER ps --format '{{.Names}}' 2>/dev/null | grep -qx "tdai-memory-core"; then
  warn "memory-core 容器未运行，proxy 的 auth / tdai memory / skill 注入将全部降级。"
fi
if ! $DOCKER ps --format '{{.Names}}' 2>/dev/null | grep -qx "tdai-memory-hub"; then
  warn "memory-hub 容器未运行，proxy 的 sessionInit control plane 不可达。"
fi

pull_image "$PROXY_IMAGE"
rm_container_if_exists "$CONTAINER"

# proxy 只从 YAML 读上游 URL / API key（不认 PROXY_UPSTREAM_URL 环境变量），
# 所以我们从 .env 生成一个最小 config.yaml 挂到容器 /data/config.yaml。
# 容器 CMD 已经是 [--config /data/config.yaml]。
CONFIG_DIR="${PROXY_CONFIG_DIR:-$SCRIPT_DIR/.proxy-config}"
mkdir -p "$CONFIG_DIR"
CONFIG_FILE="$CONFIG_DIR/config.yaml"

# ── 三大能力开关（默认最小可用；打开时自动串联依赖）──
# PROXY_ENABLE_AUTH        : 客户端凭 x-tdai-user-key 走内核 auth/verify → user_id
# PROXY_ENABLE_SESSION_INIT: 首轮弹表单选 team/agent/task；依赖 auth+tdai
# PROXY_ENABLE_TDAI        : L2/L3 记忆注入 + L1 召回；依赖 memory-core
#
# 便捷开关 PROXY_FULL_STACK=1 一键把三个都开。
if [[ "${PROXY_FULL_STACK:-0}" == "1" ]]; then
  PROXY_ENABLE_AUTH=1
  PROXY_ENABLE_TDAI=1
  PROXY_ENABLE_SESSION_INIT=1
fi
PROXY_ENABLE_AUTH="${PROXY_ENABLE_AUTH:-0}"
PROXY_ENABLE_TDAI="${PROXY_ENABLE_TDAI:-0}"
PROXY_ENABLE_SESSION_INIT="${PROXY_ENABLE_SESSION_INIT:-0}"

# sessionInit 依赖 auth 拿 user_id；开 sessionInit 时自动补 auth
if [[ "$PROXY_ENABLE_SESSION_INIT" == "1" && "$PROXY_ENABLE_AUTH" != "1" ]]; then
  warn "PROXY_ENABLE_SESSION_INIT=1 需要 auth；自动打开 PROXY_ENABLE_AUTH"
  PROXY_ENABLE_AUTH=1
fi

bool() { [[ "$1" == "1" ]] && echo "true" || echo "false"; }

# ── sessionInit.debugForceIdentity（本地联调用）────────────────────────────
# 部分客户端无法完成交互式会话初始化表单——例如 CodeBuddy CLI 的交互式 TUI
# 既不转发 `-H` 头（拿不到 headerAutoSelect），又不认 `ask_followup_question`
# 工具（渲染不了表单），于是卡死。配置本段可让 proxy 在首个带 conversation id
# 的请求上直接按给定身份注册会话，完全跳过表单。
#
# 在 .env 里设 PROXY_FORCE_TEAM_ID / PROXY_FORCE_AGENT_ID / PROXY_FORCE_TASK_ID 启用。
# ⚠️ 身份不经校验、按原样信任，仅供本地/e2e，生产环境务必留空。
FORCE_IDENTITY_YAML=""
if [[ -n "${PROXY_FORCE_TEAM_ID:-}" && -n "${PROXY_FORCE_AGENT_ID:-}" ]]; then
  FORCE_IDENTITY_YAML="  debugForceIdentity:
    team_id: \"${PROXY_FORCE_TEAM_ID}\"
    agent_id: \"${PROXY_FORCE_AGENT_ID}\""
  if [[ -n "${PROXY_FORCE_TASK_ID:-}" ]]; then
    FORCE_IDENTITY_YAML="${FORCE_IDENTITY_YAML}
    task_id: \"${PROXY_FORCE_TASK_ID}\""
  fi
  warn "sessionInit.debugForceIdentity 已启用 —— 跳过会话初始化表单（仅限本地联调）"
fi

# ── 注入给模型的 bridge 基址 ────────────────────────────────────
# 不配 injection.externalGatewayUrl 时，proxy 会枚举网卡，把**容器内网 IP**
# （实测 172.21.0.4）嵌进 <skill_tools> / <tdai_memory_tools> 的 curl 模板。
# 但 coding agent 跑在宿主机上，连不到容器网段 —— 所有资产取用 curl 必然
# 超时（实测 exit 28，每次白等 75 秒），fetched/used 证据永远采不到。
#
# MemoryProxy/src/injection/index.ts:263 的注释称该 fallback "仅单节点 /
# 本地开发场景可用"，但 server.host 为 0.0.0.0 时它取到的正是容器地址，
# 因此在官方 Docker 部署下恰好不可用。本地必须显式指向宿主机可达地址。
EXTERNAL_GATEWAY_URL="${PROXY_EXTERNAL_GATEWAY_URL:-http://127.0.0.1:${PROXY_PORT}}"

# ── ClickHouse 业务埋点 ─────────────────────────────────────────
# 默认 clickhouse.enabled=false（MemoryProxy/src/config.ts:22），此时
# usage_logs / session_init_logs / tool_call_logs 三张表一行都不写 ——
# 代码里有埋点不等于数据落了盘。
#
# tool_call_logs 的 kind 字段区分 model_intent（模型在 SSE 里声称要调某工具）
# 与 bridge_call（bridge 真的转发了，带 upstream_status / elapsed_ms /
# reject_reason）。这条分界线是资产取用归因的一手证据，且由 proxy 自己写入，
# 不经过模型输出，抓包侧只能靠解析模型 stdout 反推，不等价。
#
# 在 .env 设 PROXY_CLICKHOUSE_URL 启用；库与表由 proxy 自动
# CREATE DATABASE / TABLE IF NOT EXISTS，无需手工建表。
CLICKHOUSE_YAML=""
if [[ -n "${PROXY_CLICKHOUSE_URL:-}" ]]; then
  CLICKHOUSE_YAML="clickhouse:
  enabled: true
  url: \"${PROXY_CLICKHOUSE_URL}\"
  database: \"${PROXY_CLICKHOUSE_DB:-context_proxy}\"
  user: \"${PROXY_CLICKHOUSE_USER:-default}\"
  password: \"${PROXY_CLICKHOUSE_PASSWORD:-}\"
"
  info "ClickHouse 埋点已启用 → ${PROXY_CLICKHOUSE_URL}"
fi

info "生成 proxy config → $CONFIG_FILE  (auth=$(bool $PROXY_ENABLE_AUTH) session-init=$(bool $PROXY_ENABLE_SESSION_INIT) tdai=$(bool $PROXY_ENABLE_TDAI))"
cat > "$CONFIG_FILE" <<YAML
# 由 start-proxy.sh 自动生成 —— 每次启动覆盖，请不要手动改。
server:
  host: 0.0.0.0
  port: 8096
  forwardTimeoutMs: 600000

upstream:
  url: "${PROXY_UPSTREAM_URL}"
  apiKey: "${PROXY_UPSTREAM_API_KEY}"

log:
  file: ""
  level: info
  backend: console

# tdai 内核对接（用于 injection / skill / auth 拉取）
tdai:
  enabled: $(bool $PROXY_ENABLE_TDAI)
  endpoint: "http://memory-core:8420"
  apiKey: "${MEMORY_CORE_GATEWAY_API_KEY}"
  serviceId: default
  memory:
    enabled: true
    inject: true
    writeL0: true
    recallL1: true
    injectL2L3: true

skill:
  endpoint: "http://memory-core:8420"
  serviceToken: "${MEMORY_CORE_GATEWAY_API_KEY}"

auth:
  enabled: $(bool $PROXY_ENABLE_AUTH)
  url: "http://memory-core:8420"
  timeoutMs: 5000

sessionInit:
  enabled: $(bool $PROXY_ENABLE_SESSION_INIT)
  maxRetries: 3
  injectAgentContext: true
  injectTaskContext: true
  headerAutoSelect:
    enabled: true
    teamHeader: "x-team-id"
    agentHeader: "x-agent-id"
    taskHeader: "x-task-id"
    onMismatch: "form"
${FORCE_IDENTITY_YAML}
costGuard:
  enabled: false

# 打开 skill + knowledge + tdai-memory 三个注入器；
# knowledge 依赖 memory-hub 起来，否则 hook 内部会降级为空块。
injection:
  enabled: true
  externalGatewayUrl: "${EXTERNAL_GATEWAY_URL}"
  injectors:
    - skill
    - knowledge
    - tdai-memory

${CLICKHOUSE_YAML}
redis:
  enabled: false
YAML

info "启动 proxy (image=$PROXY_IMAGE, port=$PROXY_PORT)"
$DOCKER run -d --name "$CONTAINER" \
  --network "$NETWORK" \
  --network-alias proxy \
  --add-host=host.docker.internal:host-gateway \
  -p "${PROXY_PORT}:8096" \
  -v "$CONFIG_FILE:/data/config.yaml:ro" \
  "$PROXY_IMAGE" >/dev/null

wait_healthy "$CONTAINER" 90
ok "proxy 已启动 → http://localhost:${PROXY_PORT}/"
ok "  用法：把 coding agent 的 API base 指向 http://localhost:${PROXY_PORT}"
