---
id: HITLD-988
title: "The chief-of-staff skill keeps bulk reads out of the chief of staff's own context: a list, a log or a diff is read by a subagent that returns a short summary, or filtered by a script"
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The chief-of-staff skill says never to print a list, log, diff or issue thread into the chief of staff's own context: delegate the read to a subagent that returns a short summary, or filter it with a command first.
- The skill names the size above which this applies (about 2,000 tokens) and the cases where the full text is needed, such as a diff the chief of staff must judge.
- A skill eval scenario gives the chief of staff an issue list of 20 issues and checks it delegates the read or filters it; it fails if the full list is printed.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Every token in the context is re-read on every later call until the next compaction, so a 15,000-token list costs far more than the subagent that would summarize it. Serves the owner's token budget.

## Notes

rc.3. From the owner's request of 2026-11-24 to keep the token use of the chief-of-staff chat down without breaking the long-running chat: one chief-of-staff session read billions of cache-read tokens in eight days, because every model call re-reads the whole context, so cost grows with context size times the number of calls.
