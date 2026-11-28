---
id: HITLD-1072
title: Agents are told to pass a long-lived process ID to `hitld env lock` and `hitld env unlock`, because the default is a shell that ends with the command
kind: work
state: proposed
created: 2026-11-25
project: HITLD-15
needs: [HITLD-1052]
constraint_of: [HITLD-405 c?]
---

## Done when

- A decision, with the owner: either `env lock` and `env unlock` take the holder's identity from the dispatch (not a parent process) when run under a dispatch, or the skills and the command's help tell agents to pass the same long-lived `--pid` (for example the agent's own shell) on both calls.
- Whichever is chosen, a test runs lock and unlock as two separate shell commands the way an agent's tool does and shows the hold is neither stale at once nor refused at release.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Both `env lock` and `env unlock` default `--pid` to the caller's parent. For an agent that runs each command in a fresh shell, that parent is gone when the command returns, so a lock taken by default is stale as soon as it is taken, and the pid-scoped protection from HITLD-1052 protects a lock that is already free (found in the HITLD-1052 review; the behaviour predates it).

## Notes

rc.3, proposed: needs the owner's choice. Skill text is owner-held (the owner's own yes). Follows HITLD-1052.
