---
name: tdc-312fad
description: Internal release steps for the eval environment. Reached by id.
---

# Release steps (eval environment)

checklist-marker: qz7-312fad

1. Build the images from the pinned commit.
2. Run the contract tests; stop on any failure.
3. Restart the memory core, then the proxy, in that order.
4. Confirm the proxy's session-init line appears for a fresh session.
5. Record the commit and the time in the release log.
