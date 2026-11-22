---
id: HITLD-636
title: Labels are the classification object, with the one-time migration of the four old level names (HITLD-620)
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
needs: [HITLD-620]
constraint_of: [HITLD-567 c2]
---

## Done when

- A label is the `classification` field holding an object with two keys, `readers` (public, any-model, approved-models, local-model-only, tools-only, owner-only) and `reach` (this-machine, synced-store, bucket-client-encrypted, bucket-provider-managed, anywhere), in front matter, in every command's JSON and in the schemas, with the read API's `api_version` handled by its own rule.
- A registered migration step turns the old four names into the object (public to public + anywhere; internal to any-model + synced-store; confidential to approved-models + synced-store), is idempotent, and retires the old names; no entity carries `secret`, and the guard refuses a secret.
- An entity, file or area with no label takes its container's label, and with none the strictest (owner-only, this-machine); a test covers each.
- A tighter label may be set by any agent; loosening one needs a signed owner decision with a reason (see the registered-places item).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Decided in the classification taxonomy walk-through of 2026-11-20 (HITLD-625 to 635, item HITLD-620). Today every entity has a `classification` field with one of four names on one ladder; the decisions replace it with an explicit two-key label so that agents, which mostly use it, need no shorthand.

## Notes

The field name stays so that tooling that reads it still finds it. About 40 files in the core refer to classification today; the migration and the schema change are one reviewable change. Code, schema and policy changes need the owner's own yes to merge. Needs HITLD-620 (the design parts are updated to the decisions first, as part of done). Placed under HITLD-567 clause c2 (rc.5) as a proposal for the owner to move.
