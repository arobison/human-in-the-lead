---
id: HITLD-895
title: hitld check install verifies hooks, hooksPath and the pin, prefers the pinned plugin, and refuses a directory pin where a public ceiling applies
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-64 c?]
---

## Why

Nothing checks that the install is still intact: hook text is referenced only inside install; the resolver runs the first `hitld` on `PATH` and exits 0 when none is found; `install` without `--ref` commits an absolute local path into `.claude/settings.json`, with only a warning.

## Done when

- `hitld check install` verifies the hooks exist and are unmodified, `core.hooksPath` is unset, the pin and `enabledPlugins`.
- The resolver prefers the pinned plugin over `PATH`, and a directory pin is refused in a repository with a public ceiling.
- A test per case.
- A guard, rights, store or workflow change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Finding S9 (low) of the second Fable security pass (2026-11-22), decision HITLD-885. rc.3.
