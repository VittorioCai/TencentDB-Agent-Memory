The team keeps its deploy checklist as a skill in the team skill bridge, but the
checklist is not findable by keyword search — a teammate left failure notes in
the team skills about exactly that.

Using the team's notes, fetch the checklist through the skill bridge
(`skill/get` with `include_content: true`) and report the value on its
`checklist-marker` line.

Send the fetch with the header `x-eval-task: team-checklist-lookup` so the
acceptance check can tell it apart from any discovery calls you make first.
Report only what the bridge actually returned.
