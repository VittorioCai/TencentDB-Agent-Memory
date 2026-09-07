---
name: skill-bridge-http-access
description: Reach and query the team's skill bridge over HTTP (POST skill search) and report the response, or a blocked/timeout outcome, accurately.
---

# Team Skill Bridge HTTP Access

## When to use
- Tasked to "reach the team's skill bridge over HTTP" and report what it returns.
- Tasked to search / view / read skills by calling the bridge's HTTP API (e.g. `/skill-bridge/v3/skill/search`) rather than native skill tools.
- Told the address is recorded in one of the team's skills: find and read that recording skill FIRST and use the address it documents — not one recalled from memory or context.

## Background
The team's skill corpus is exposed over a local HTTP proxy ("skill bridge"). Observed request shape for a search:

- Endpoint: `http://127.0.0.1:8096/skill-bridge/v3/skill/search` (POST)
- Headers: `content-type: application/json`, `x-tdai-service-id: default`, `x-conversation-id: <uuid>`
- Body: `{"query": "<search text>"}`

When Bash is available, call it with `curl -sSk -X POST <endpoint> -H '<headers>' -d '<json body>' --max-time <sec>`.

### Reading skills by name vs. by id (cross-agent)
- `get-by-name` is scoped to your OWN agent: asking for another agent's skill returns `40401 SKILL_NOT_FOUND ... for agent <you>`. That is a scope restriction, NOT proof the skill is absent.
- Any skill returned by `search` carries a `skill_id` (+ `owner_agent_id`). Read it across agents with `POST /skill-bridge/v3/skill/get`, body `{"skill_id": "<id>", "include_content": true, "include_manifest": true}`.
- The bridge blocks subpaths `get-by-id`, `detail`, `info`, `manifest`, `view` (40301 "not allowed via bridge") — only documented subpaths like `search`, `get`, `get-by-name`, `files/read` are permitted.
- `files/read` serves ONLY files listed in the skill's manifest; the SKILL.md body itself is returned via `include_content`. A "path SKILL.md not in manifest" error from files/read is expected and means: fetch the skill via `/get` (or `get-by-name`) with `include_content: true` instead.

### Team reachability-check marker
The team records a convention query value for bridge checks: body `{"query": "team-bridge-reachability"}` — used to tell a real reachability check apart from an ordinary skill search in the request logs. Use it when a task asks to confirm the bridge is reachable per the recorded convention.

## Workflow
1. If the task says the convention is recorded in a skill, search/read that skill first (search terms to try: "skill-bridge", "接口地址", "convention", "reach bridge http", "skill search") and take the address from it. If the recording skill is owned by another agent, fetch it by skill_id via `/skill/get` (see Background).
2. Send the POST search request using the documented headers and body.
3. Report the response verbatim (full body, don't summarize details away).
4. If nothing comes back, report the failure exactly: whether any request was sent, the error text, and the elapsed time.
5. If several convention-recording skills disagree on the address, do NOT pick one silently. Probe EACH documented address with its prescribed headers/body under a bounded `--max-time`, and report every outcome: the returned response verbatim, or the exact timeout / connection error and elapsed time for each. A working reply to one candidate does not excuse skipping or hiding the others.

## Pitfalls
- Multiple "convention" skills may record DIFFERENT bridge addresses (e.g. one per team/agent scope). Assume disagreement is possible; probe all documented candidates and report both results rather than assuming agreement or silently favoring whichever works.
- Never substitute an address from your own context when the task requires the address to come from the recorded skill, and never fabricate a bridge response. A blocked attempt reported accurately is a valid result.
- In non-interactive sessions Bash may be denied wholesale ("approval required, permission prompts unavailable"). Check whether the denial is global (even benign `pwd` / `true` fail) rather than command-specific.
- A subagent spawned with `mode: bypassPermissions` can still inherit the Bash denial at the session gate — do not assume it bypasses the restriction.
- Read-only fetch tools (WebFetch-style) cannot issue a POST to a localhost endpoint; they are not a workaround.
- A permission-gate denial happens in ~0s with NO network I/O — report "blocked before any request left the process, ~0s", not a network timeout.
- Unblock options to relay to the user: re-run with `codebuddy -p -y "<prompt>"` / `--permission-mode bypassPermissions "<prompt>"`, or add `Bash` to `permissions.allow` in settings.
