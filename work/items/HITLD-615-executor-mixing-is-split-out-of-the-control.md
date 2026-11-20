---
id: HITLD-615
title: Executor-mixing is split out of the control-plane exploration into its own design item
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: yes
answered_at: 2026-11-20T01:53:04.157Z
answered_via: chat
answered_by: owner
---

## Question

Should mixing executors, harnesses and models (a non-Claude headless executor first, a local model later) be its own proposed design item, split from the control-plane exploration?

HITLD-508 bundles it with the control-plane question the owner deferred (HITLD-540, 541). Usage is above the reserve, so a second provider's executor is also a relief valve on the shared Claude quota.

## Options and recommendation

- A. Split it out: File its own proposed design item with a first step of one non-Claude headless executor; leave the control-plane study in HITLD-508
- B. Leave it inside the control-plane exploration: No new item; it waits for the control-plane study

Recommended: Split it out. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
