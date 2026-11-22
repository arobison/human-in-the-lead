---
id: HITLD-342
title: 'Retire the name "long outcome": a milestone with no project is just a milestone'
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-192 c1]
---

## Done when




- No public text, schema description, design part, dashboard label, test or message uses "long outcome". A milestone with no project is described as a milestone that waits on other milestones.
  - **Dashboard:** the lane that holds such milestones is titled "Across projects"; the scope picker lists them under the same name.
  - **Design and schemas:** design 3.2 and 12, the glossary, `schemas/milestone.schema.json` and `schemas/project.schema.json` drop the term; `work check`, migration messages and tests follow.
- Nothing about how a milestone with no parent behaves changes: it is still stored, checked and drawn as it is now.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner asked how "long outcome" got its name and whether it is needed in the taxonomy (2026-11-16). It came from HITLD-90, which retired the initiative level and needed a label for a milestone with no project. Only HITLD-1 uses it, and the name says nothing a reader can use. The owner chose no special name (decision HITLD-344).

## Notes

HITLD-90's own text and the migration step that names the term in its warning are history: leave the item as written and change only what a reader sees now. Touches design docs, schemas, core/lib/tracker and the dashboard; run `npm run build` for plugin copies.
