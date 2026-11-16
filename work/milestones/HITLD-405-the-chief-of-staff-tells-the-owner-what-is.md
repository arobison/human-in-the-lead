---
id: HITLD-405
title: "The chief of staff tells the owner what is true, briefly and on time"
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: What the chief of staff tells the owner is checked against a source, short, asked one question at a time, and acted on within minutes of the event.
done_when:
  - "c1: A claim about HITLd cites the design, the code or a command, or says it is unchecked."
  - "c2: One question per call, a queue offered in batches, and no bare number without what it names."
  - "c3: Notifications, found work and the usage figure are handled during long tasks and on schedule."
  - "c4: The harness table covers the Claude desktop app."
constraints: [HITLD-146 c1, HITLD-55 c1, HITLD-216 c2, HITLD-217 c2, HITLD-182 c3, HITLD-155 c3, HITLD-219 c3, HITLD-289 c4]
check: demo the owner reviews one recorded chief-of-staff session against the four clauses, with the offline eval scenarios of each item passing
---

## Notes

Proposed by the planning pass HITLD-343 on the owner's decision HITLD-363; the owner commits it later. Stage: v0.1.0-rc.3 (HITLD-400). HITLD-146 keeps its need on the end-to-end eval runner HITLD-57 (the owner's decision HITLD-361), so this milestone, and every stage after it, waits on that runner.
