---
id: HITLD-902
title: The front-matter line editors consume a flow list's continuation lines, and setKeys keeps CRLF
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-189 c?]
---

## Why

Reproduced: PR 538 made the parser accept multi-line `[...]` lists, but `setListLine` and `dropKey` replace only a key's line plus `- ` lines, so both leave orphan continuation lines that read back with errors; `setKeys` (PR 541) has the same flaw for list keys and rewrites CRLF to LF across the whole file. `work migrate constraints-on-items` would write that into a tracker whose milestone lists are wrapped.

## Done when

- One shared span-of-a-key helper also consumes flow-list continuation lines, and every line editor uses it.
- `setKeys` keeps CRLF line endings.
- A test per editor on a wrapped list and a CRLF file.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable independent read of the delegated merges (2026-11-22), finding R8 and R15; decision HITLD-897. rc.3 by the owner's decision.
