---
id: HITLD-385
title: How the owner unblocks HITLD-343 past orch-3's permission check
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. I'll message orch-3 myself: The owner types the request in orch-3's own session; it then writes the threshold, starts HITLD-343 and reports."
answered_at: 2026-11-16T18:47:27.138Z
answered_via: question-tool
answered_by: owner
---

## Question

How should HITLD-343 be unblocked, given that orch-3's permission check only accepts the gate change from the owner directly?

Both the by-hand start and the relayed settings write were refused as weakening a safety control.

## Options and recommendation

- A. I'll message orch-3 myself: The owner types the request in orch-3's own session; it then writes the threshold, starts HITLD-343 and reports.
- B. Wait for the window reset: HITLD-343 starts after 2026-11-20 19:00Z or when usage drops.
- C. Add an allow rule for orch-3: A permission rule for hitld config write in orch-3's settings.

Recommended: I'll message orch-3 myself. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
