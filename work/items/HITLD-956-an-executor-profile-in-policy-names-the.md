---
id: HITLD-956
title: An executor profile in policy names the provider, the launch command, the environment variables it receives and the network destinations it may reach
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-541 c?]
---

## Why

HITLd's executor knowledge is Claude Code–specific: the guard is a Claude Code hook and the launch command is built in. The owner asked about executors across providers and local inference; each provider needs its own launch command, its own key and its own network destinations.

## Done when

- Policy has an executor profile naming the provider, the launch command, the environment variables the executor receives, and the network destinations it may reach; an executor receives only its own provider's key.
- `hitld check policy` validates the profile; commands appear only here, as the owner's configuration.
- The Claude profile ships as the built-in default; a test shows a second profile launches with only its own variables.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable forge-enforcement spec (2026-11-22) and the owner's walk-through decisions HITLD-944 to 951. The design home is the 'HITLd runs above the harness' milestone (HITLD-541). rc.3.
