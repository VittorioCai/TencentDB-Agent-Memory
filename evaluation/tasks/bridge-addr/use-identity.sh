#!/usr/bin/env bash
# Switch which identity CodeBuddy runs as, by swapping the apiKey in models.json.
#
# Why a script rather than two model entries: identity is derived from the API
# key the request carries, and CodeBuddy indexes models by `id` — but `id` is
# passed through to the upstream provider, which rejects anything that is not one
# of its own model names. So two entries cannot coexist with different keys, and
# only one identity can be active at a time.
#
# Verified the hard way: an entry with id `deepseek-v4-flash-b` returns
# "400 The supported API model names are deepseek-v4-pro, deepseek-v4-flash,
# deepseek-v4-flash-vision-exp, but you passed deepseek-v4-flash-b".
#
# Usage:
#   bash use-identity.sh a      # author  (topic4-dev)
#   bash use-identity.sh b      # consumer (topic4-eval-consumer)
#   bash use-identity.sh c      # second author (topic4-eval-author-c)
#   bash use-identity.sh show   # which one is active

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$SCRIPT_DIR/../../../deploy/global-images" && pwd)"
MODELS="$HOME/.codebuddy/models.json"

[[ -f "$MODELS" ]] || { echo "not found: $MODELS" >&2; exit 1; }

key_for() {
  case "$1" in
    a) cat "$ENV_DIR/.topic4-user-key" ;;
    b) cat "$ENV_DIR/.topic4-user-key-b" ;;
    c) cat "$ENV_DIR/.topic4-user-key-c" ;;
    *) echo "unknown identity: $1 (use a, b or c)" >&2; exit 2 ;;
  esac
}

case "${1:-show}" in
  show)
    python3 - "$MODELS" "$(key_for a | tr -d '[:space:]')" "$(key_for b | tr -d '[:space:]')" <<'PY'
import json, sys
models, ka, kb = sys.argv[1], sys.argv[2], sys.argv[3]
for m in json.load(open(models))["models"]:
    k = m.get("apiKey", "")
    who = "a (author)" if k == ka else "b (consumer)" if k == kb else "unknown"
    print(f"  {m['id']}  name={m['name']}  identity={who}")
PY
    ;;
  a|b)
    KEY="$(key_for "$1" | tr -d '[:space:]')"
    cp "$MODELS" "$MODELS.bak"
    python3 - "$MODELS" "$KEY" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
d = json.load(open(path))
for m in d["models"]:
    m["apiKey"] = key
json.dump(d, open(path, "w"), indent=2, ensure_ascii=False)
open(path, "a").write("\n")
PY
    echo "switched to identity $1 (previous config saved to models.json.bak)"
    ;;
  *)
    echo "usage: $0 [a|b|show]" >&2; exit 2 ;;
esac
