---
id: HITLD-35
title: Notification digests
kind: work
state: done
created: 2026-11-14
project: HITLD-28
claimed_by: D-35
release_note: "One digest, built from records: `hitld rights digest --trigger merge-batch|owner-writes --mark` fits one phone screen, puts questions first by cost of delay, shows only what is new, holds back in quiet hours, and returns `delivery` and `urgency`. `hitld dashboard` writes the same text to `digest.txt`."
---

## Why

Design part 21, One signal end to end.

## Done when

- A digest is written at merge-batch boundaries and when the owner writes.
- It lists items merged, calls made, precedent applications and decisions waiting, and fits one phone screen.
- Quiet hours hold it back.
- It is built from records, not the orchestrator's memory: ranked by cost of delay with questions first and the recommendation inline, a read cursor so it shows only what is new, a size budget, and an urgency the channel can act on (HITLD-84, HITLD-85).
- A test covers a digest in each trigger.
