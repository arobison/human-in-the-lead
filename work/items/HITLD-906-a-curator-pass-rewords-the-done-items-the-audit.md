---
id: HITLD-906
title: A curator pass rewords the done items the audit found stale or contradicted, and the guide marks what is true only from rc.2
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-192 c?]
---

## Why

The audit of the 60 done 'Consumer live' items found stale or contradicted wording: the cloud executor guard item says 'guarded and metered' where it only recognizes (now closer to true since HITLD-792 merged); the milestone graph item names `hitld report` where the command is `hitld dashboard`; the dashboard item says 'one small inline script' but now inlines two; the feedback skill item routes project feedback to a command that is not built; the private store item says a passphrase where export now encrypts to age keys; the executor-outlives-orchestrator decision reads 'Open' though its answer is recorded; the CI time is estimated not measured; HITLD-842 is planned though its migration ran; HITLD-800 is planned; and the guide pins v0.1.0-rc.1 but describes hook behavior that rc.1 lacks (the hook fix is not in the tag).

## Done when

- Each item named is reworded to say what is true, and each stale 'stays proposed' line on the done bug items is cleared.
- The guide and README mark the hook lookup behavior 'from rc.2', or the pin moves when rc.2 is cut.
- `hitld work check` passes.


## Notes

From the Fable audit of the done items (2026-11-22), findings 1 to 9 and the smaller points; decision HITLD-897. rc.3 by the owner's decision. A tracker-only curator pass except the guide text, which needs the owner's yes if it changes a design rule.
