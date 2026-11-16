---
id: HITLD-124
title: Session identity without flags, and a lease mismatch that says what differs
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-4
---

## Why

Every run command took `--session` and `--host` by hand. A checkpoint run without the `--host` its run start used failed with `lease-lost`, which reads like another session took the lease. Self-hosted sessions will make these calls constantly.

## Done when

- `hitld` takes the session's identity from the harness where it gives one (a cloud session's ID, `HITLD_SESSION`), otherwise makes one at `run start` and remembers it for this session; the host defaults to the same value on every call of the session. `--session` and `--host` stay as overrides.
- A lease refusal says exactly what differs (session, host or both) and, when only the host differs, says so plainly instead of reporting the lease as lost.
- Tests cover both, and the orchestrate and chief-of-staff skills drop the flags from their commands.
- `npm run check`, the offline eval gate and `hitld work check` pass.
