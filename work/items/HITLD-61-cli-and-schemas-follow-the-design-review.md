---
id: HITLD-61
title: "CLI and schemas follow the design review: command names, milestone tags, public judgement fields"
kind: work
status: Done
created: 2026-11-14
project: HITLD-15
claimed: D-61
changelog: "Commands are tagged by the milestone that builds them; `hitld migrate` is now `hitld data migrate`; public judgements carry only what, basis and by."
---

## Why

The design review renamed and reshaped things the code still shows the old way.

## Done when

- `hitld --help` tags commands by the milestone that builds them (named by outcome, no `v0`), and the three migrations have distinct names: `hitld data migrate`, `hitld work migrate`, `hitld config migrate`.
- Public entities carry only what was judged, the basis and who: `common.schema.json` no longer requires judgement fields that live in the private store (`at`, confidence, expected, evidence, outcomes); private records keep them.
- No milestone codes remain in code or schemas (left after the docs pass: schema descriptions with A1, T1, M6, M2, K1; core/lib/cli/commands/later.mjs, cli/table.mjs, merge/queue.mjs, eval/profiles.mjs, judgement/judgement.mjs, trust code, merge/quarantine.mjs, quota/window.mjs, harness capabilities.mjs, schemas.test.mjs; packaging/copilot/README.md); each uses the milestone's outcome name.
- Tests updated; `npm run check` and the offline eval gate pass.


