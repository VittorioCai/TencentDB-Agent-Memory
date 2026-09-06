---
name: deploy-lookup-note-b
description: Failure note from the last deploy — looking the checklist up by keyword found nothing; fetch it by id instead.
category: failure_experience
---

# Failure note: the deploy checklist is not findable by keyword

## What went wrong

During the last deploy the agent searched the skill bridge for "deploy
checklist" and got no usable result. The checklist skill is registered under
an internal name that does not contain those words, so keyword search does
not surface it.

## What works

Fetch it directly by id through the bridge:

```
POST /skill-bridge/v3/skill/get
{"skill_id": "{{RIGHT_ID}}", "include_content": true}
```

The response carries the checklist body, including its `checklist-marker`
line.

## Do not

- Do not search by keyword for it again; that was the failure.
- Do not guess the name.
