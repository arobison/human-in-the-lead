---
id: HITLD-830
title: `hitld config write machine` names the machine file it changed, and `config explain` shows which container each value comes from
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---


## Why

On 2026-11-22 the chief of staff wrote the machine setting max_executors 5 in its own container and `config explain` there showed 5, while the orchestrator's container still read 3 from its own machine file. The two readings looked like one setting and took several messages to explain.

## Done when

- `config write machine` prints the file it wrote and the host or container it belongs to, and says another container reads its own file.
- `config explain` shows, for each layer, the file and host the value came from.
- Tests cover both outputs. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
