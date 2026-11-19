---
id: HITLD-551
title: The autonomy build work gets a new release stage before v0.1.0
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "B. A new stage before v0.1.0: Insert an earns-autonomy candidate between rc.4 and v0.1.0 so the first release includes the trust engine"
answered_at: 2026-11-19T23:43:52.295Z
answered_via: question-tool
answered_by: owner
---

## Question

Where should the build work from the design walk-throughs land in the release stages?

The design walk-throughs of 2026-11-19 produced the trust engine for merging and commitment, an AIMD pace controller, escalations, a resource gate and an answer-proof field. Stages: rc.2 self-hosting live, rc.3 the run holds up, rc.4 an outside project adopts it, v0.1.0 safe to publish and first release. The chief of staff recommended a v0.2.0 stage after the first release.

## Options and recommendation

- A. After v0.1.0, with its own stage: v0.1.0 ships with ask-first everywhere; the autonomy work is a v0.2.0 stage; prerequisites stay in rc.2 and rc.3
- B. A new stage before v0.1.0: Insert an earns-autonomy candidate between rc.4 and v0.1.0 so the first release includes the trust engine
- C. Fold it into rc.3: rc.3 becomes the run holds up and earns trust

Recommended: After v0.1.0, with its own stage. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
