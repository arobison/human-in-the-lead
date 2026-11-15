---
id: HITLD-111
title: "Fixes found writing the guides: refusal codes, a silent empty work check, dashboard --json, a pointer to adopt"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

Running every guide command on scratch fixtures (HITLD-91) found commands that do not do what design 16.2 and 12.4 say. They are cheapest to fix before the first release, which waits on the store milestone anyway.

## Done when

- `hitld work new` (and any other tracker write) refused off main or outside the orchestrator's own working tree returns `not-permitted`, not `failed`; `hitld work check` with no `policy.json` returns `policy`, not `failed`. A test covers each, and every command in the table that returns `failed` for a refusal design 16.2 names is fixed the same way.
- `hitld work check` that finds no tracker files where it looked, in a repository that has tracker-shaped files elsewhere (for example a folder holding front-matter items) or no `tracker.json`, says so as a warning instead of a bare "0 files, no problems".
- `hitld dashboard --json` matches design 12.4: either it returns the data contract without writing the page (a flag such as `--no-write`, or `--json` alone), or design 12.4 and the help say exactly what it does; the guide's dashboard page agrees.
- The orchestrate skill's first step points to the `adopt` skill when the project is not set up.
- `npm run check`, the offline eval gate and `hitld work check` pass.
