---
id: HITLD-98
title: "State and field mapping: tracker.json sections, refusal of unmapped states and missing fields, work map --suggest"
kind: work
state: planned
created: 2026-11-15
project: HITLD-95
needs: [HITLD-97]
constraint_of: [HITLD-96 c6]
---

## Why

Each team's tracker has its own states and fields (design 0002, section 4). A mapping is never guessed: an item in a state the mapping does not name is not dispatched, and a write to a field the tracker lacks is refused by name.

## Done when

- `tracker.json` holds the state and field mapping as in 0002 section 4, and `hitld work check` names every unmapped state and missing field it finds in an interchange file.
- `hitld work map --suggest` proposes a mapping from an interchange file for the owner to accept or change; it writes nothing on its own.
- Tests cover an unmapped state, a missing field and a suggested mapping.
- `npm run check`, the offline eval gate and `hitld work check` pass.
