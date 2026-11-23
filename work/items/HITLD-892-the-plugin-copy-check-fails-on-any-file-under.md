---
id: HITLD-892
title: The plugin copy check fails on any file under plugins/human-in-the-lead that is not on an explicit allowlist
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-64 c?]
---

## Why

`staleFiles` in `core/lib/packaging/build.mjs` compares only the generated directories (core, schemas, templates, evals, skills, agents, hooks). A pull request can add `plugins/human-in-the-lead/.mcp.json`, a `commands/*.md` file or edit `bin/hitld` or `plugin.json`, and `npm test` stays green; the diff looks like generated churn, and every consumer session then loads it.

## Done when

- The plugin copy check fails on any file under `plugins/human-in-the-lead/` that is not on an explicit allowlist or generated from `core/`.
- A test adds a stray file under the plugin folder and shows the check fail.
- A guard, rights, store or workflow change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Finding S6 (medium) of the second Fable security pass (2026-11-22), decision HITLD-885. 

Moved from rc.2 to rc.3 by the owner's cut-line decision HITLD-974 (2026-11-23).
