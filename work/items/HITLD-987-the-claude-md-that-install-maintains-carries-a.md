---
id: HITLD-987
title: "The CLAUDE.md that install maintains carries a `# Compact instructions` section that says what a compaction keeps: standing owner instructions, open decisions, pending approvals and the dispatch and pull request in flight"
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `hitld install` writes a `# Compact instructions` section into the project's CLAUDE.md block, and `hitld check install` reports a missing or edited section; a test covers install, upgrade and a hand edit.
- The section lists what to keep: the owner's standing instructions, open decisions, pending approvals with their pull request and head, dispatch IDs in flight, the lease holder, and where the durable state lives; it says to drop raw tool output.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Claude Code reads a `# Compact instructions` section of CLAUDE.md when it summarizes, so a shorter window loses less when the section says what matters. Serves the owner, whose chat is compacted more often.

## Notes

rc.3. From the owner's request of 2026-11-24 to keep the token use of the chief-of-staff chat down without breaking the long-running chat: one chief-of-staff session read billions of cache-read tokens in eight days, because every model call re-reads the whole context, so cost grows with context size times the number of calls.
