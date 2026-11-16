---
id: HITLD-173
title: Whether the owner's local status-line capture feeds the usage snapshots
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: i think probably retire the status line...do those even work in the claude code desktop app? the agents can get all of that info from the private store, right? and the status line would really be something for me to glance at in the chief of staff session? not sure that adds value
answered_at: 2026-11-16T01:34:56.542Z
answered_via: chat
answered_by: owner
---

## Question

Should the owner's local status-line usage capture feed the same usage snapshots as the quota probe?

The capture is built and opt-in, and the probe is the way to get a reading in the cloud. Raised for HITLD-165.

Reversibility: two-way.

## Options and recommendation

- A. Yes, one snapshot format for both: Both write measured snapshots in the same shape.
- B. No, keep them separate: The capture stays local-only with its own snapshot shape.
- C. Replace the capture with the probe: Retire the status-line capture and use the probe everywhere.

Recommended: Yes, one snapshot format for both. One format and an adapted capture.

## Answer

Recorded in the front matter once answered.
