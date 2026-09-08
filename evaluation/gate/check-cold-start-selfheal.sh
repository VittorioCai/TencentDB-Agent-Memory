#!/usr/bin/env bash
# Claim under test: after a container start, the FIRST model read does not
# self-heal a lagging registry; the second does.
# Discriminator: immediately after read #1, is the registry at the head?
set -uo pipefail
cd /Users/vittoriocai/Desktop/Tecent_agentmemory-project4/.claude/worktrees/topic4-gate0
ENV=deploy/global-images; URL=http://localhost:8420; SID=default
DB=/data/tdai-memory/metadata/tdai_metadata_default/metadata.db
call() { local kf="$1" p="$2" b="$3" x="${4:-}" k; k="$(tr -d '[:space:]' < "$kf")"
  printf 'header = "Authorization: Bearer %s"\nheader = "x-tdai-user-key: %s"\n' "$k" "$k" \
   | curl -sS -K - --max-time 25 -H 'content-type: application/json' -H "x-tdai-service-id: $SID" ${x:+-H "$x"} -X POST "$URL$p" -d "$b"; }
uid() { local k; k="$(tr -d '[:space:]' < "$1")"; call "$1" /v3/meta/auth/verify "{\"user_key\":\"$k\"}" \
   | python3 -c "import json,sys;d=json.load(sys.stdin).get('data') or {};u=d.get('user') if isinstance(d.get('user'),dict) else d;print(u.get('user_id') or '')"; }
waitup() { for i in $(seq 1 90); do [ "$(docker inspect tdai-memory-core --format '{{.State.Health.Status}}')" = healthy ] && { echo "  healthy after ${i}s"; return; }; sleep 1; done; echo "  NEVER HEALTHY"; }
sql() { docker exec tdai-memory-core node -e "$1" 2>&1 | grep -vE "Experimental|trace-warnings"; }
reg() { sql "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('$DB',{readOnly:true});
const r=db.prepare('SELECT version,status FROM meta_assets WHERE asset_id=?').get('$1');
console.log('    registry: v'+(r?r.version:'?')+' '+(r?r.status:'-'));"; }

TEAM=$(python3 -c "import json;print(json.load(open('evaluation/gate/artifacts/gate_baseline.json'))['team_id'])")
A=$(uid $ENV/.topic4-user-key); B=$(uid $ENV/.topic4-user-key-b)
AG=$(python3 -c "import json;print(json.load(open('evaluation/gate/artifacts/gate_baseline.json'))['assets']['skl-sZFb3KatWY6m']['producer_agent_id'])")
N="coldstart-$(date +%s)"
python3 -c "
import json;print(json.dumps({'team_id':'$TEAM','user_id':'$A','agent_id':'$AG','task_id':'default','name':'$N','content':'---\nname: $N\ndescription: throwaway\n---\n# v1 body\n'}))" > /tmp/c.json
SK=$(call $ENV/.topic4-user-key /v3/skill/create "@/tmp/c.json" | python3 -c "import json,sys;print((json.load(sys.stdin).get('data') or {}).get('skill_id',''))")
[ -n "$SK" ] || { echo "create failed"; exit 1; }
call $ENV/.topic4-user-key /v3/meta/asset/update "{\"asset_id\":\"$SK\",\"visibility\":\"team\"}" >/dev/null
echo "created $SK"

# move the skill to v2
python3 -c "
import json;print(json.dumps({'team_id':'$TEAM','user_id':'$A','agent_id':'$AG','skill_id':'$SK','expected_version':1,'content':'---\nname: $N\ndescription: throwaway\n---\n# v2 body\n'}))" > /tmp/u.json
call $ENV/.topic4-user-key /v3/skill/update "@/tmp/u.json" | python3 -c "import json,sys;d=json.load(sys.stdin);print('  skill/update code',d.get('code'),'→ v'+str((d.get('data') or {}).get('version')))"
HEAD=$(call $ENV/.admin-key /v3/skill/get "{\"team_id\":\"$TEAM\",\"user_id\":\"$A\",\"agent_id\":\"$AG\",\"skill_id\":\"$SK\",\"include_content\":false}" 'x-tdai-read-purpose: manage' | python3 -c "import json,sys;print((json.load(sys.stdin).get('data') or {}).get('version'))")
echo "  skill head = v$HEAD"

# the state a container recreate leaves: registry behind the head, and approved
sql "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('$DB');
db.prepare(\"UPDATE meta_assets SET version=1, status='approved' WHERE asset_id=?\").run('$SK');
console.log('  forced registry back to v1 / approved');"
reg "$SK"

echo; echo "── cold start: a real container RECREATE (eval-core.sh enable) ──"
bash evaluation/eval-core.sh enable >/tmp/enable.log 2>&1 || { echo "  enable failed"; tail -3 /tmp/enable.log; }
waitup
reg "$SK"
for n in 1 2 3; do
  printf "  read #%s: " "$n"
  call $ENV/.topic4-user-key-b /v3/skill/get "{\"team_id\":\"$TEAM\",\"agent_id\":\"$AG\",\"user_id\":\"$B\",\"skill_id\":\"$SK\",\"include_content\":false}" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print('code',d.get('code'),'|',(d.get('message') or ('served v%s'%(d.get('data') or {}).get('version')))[:90])"
  reg "$SK"
done
call $ENV/.topic4-user-key /v3/skill/delete "{\"team_id\":\"$TEAM\",\"user_id\":\"$A\",\"agent_id\":\"$AG\",\"skill_id\":\"$SK\",\"expected_version\":$HEAD}" >/dev/null 2>&1
echo "deleted $SK"
