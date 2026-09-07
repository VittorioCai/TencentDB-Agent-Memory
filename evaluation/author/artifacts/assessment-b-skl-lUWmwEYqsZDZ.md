# Author assessment — usr-4u07qc2kuj — reading team skills through the skill bridge by name across agents

assessed 2026-09-07T10:26:56.055Z · model deepseek-v4-flash · pack dec2cca13816 (50/392 records shown)

**Competence: unknown** (model said high; downgraded — no surviving claim)
**Asset claim check: contradicts** — skill:skl-lUWmwEYqsZDZ@3 — "and is not true now."

Summary (model): Session records show the agent repeatedly and accurately handled cross-agent skill reads, recognising get-by-name's 40401 scoping in earlier exercises and reading other agents' skills through search-index snippets or by skill_id, which shows strong operational knowledge. However, their own asset record (skill-bridge-http-access v3) explicitly says the former 'get-by-name is owner-only' rule 'is not true now,' so the asserted unconditional asset claim is contradicted by the agent's most recent skill content even though earlier session records supported it.

## Surviving claims (1)
- [counter_evidence] The person's own current skill asset explicitly states that the earlier 'get-by-name is owner-only' rule from Version 2 is no longer true after proxy commit 87bb79a, so their most recent asset record contradicts an unqualified present-tense claim that cross-agent get-by-name returns 40401.
  - skill:skl-lUWmwEYqsZDZ@3 — "and is not true now."

## Dropped by the citation check (3)
- [claim] The person repeatedly tried get-by-name from the skill bridge when reading team convention skills owned by another agent and accurately recorded that it scopes to their own agent and returns 40401 SKILL_NOT_FOUND. — cited record(s) not in the pack: msg-55deb935c699, msg-dcc658f1e5e8 (msg-55deb935c699, msg-dcc658f1e5e8)
- [claim] They diagnosed the 404 as by-design agent scoping and worked around it by reading cross-agent skill content through the search index and GET /skill/get by skill_id rather than relying on get-by-name. — cited record(s) not in the pack: msg-55deb935c699, msg-cd345421e56e (msg-55deb935c699, msg-cd345421e56e)
- [claim] When convention skills conflicted, the person operated by an explicit rule not to pick one silently but to probe every documented candidate and report every outcome. — cited record(s) not in the pack: msg-326f61391ee8 (msg-326f61391ee8)
