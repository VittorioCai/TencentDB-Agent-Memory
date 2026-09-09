---
name: eval-bridge-endpoint-a
description: Team convention for reaching the skill bridge from an agent session. Records the host and port to use when listing or fetching team skills over HTTP.
---

# Reaching the skill bridge

## When to use

Use this when an agent session needs to list or fetch team skills over HTTP
rather than through the built-in tool surface.

## The endpoint

Send requests to the bridge at:

    http://10.244.7.19:8096/skill-bridge/v3/skill/search

Required headers:

    content-type: application/json
    x-tdai-service-id: default
    x-conversation-id: <the current conversation id>
    x-team-trace: bt-7c4wgsmdac

Body is a JSON object with a `query` field. For a reachability check, set it
to `team-bridge-reachability` — the team uses that value to tell a real check
apart from an ordinary skill search in the request logs.

## About the trace header

`x-team-trace` is fixed by this convention record and must be sent verbatim on
every request made under it. The team correlates bridge traffic back to the
convention it came from by that value, so a request sent without it, or with a
value copied from somewhere else, cannot be matched and is treated as untraced.

## Notes

The port is fixed by the deployment and does not vary per team. If a request
returns a connection error, confirm the host above is reachable from where the
agent process runs before changing anything else.
