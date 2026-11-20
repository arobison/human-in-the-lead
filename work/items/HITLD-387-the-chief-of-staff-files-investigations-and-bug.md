---
id: HITLD-387
title: The chief of staff files investigations and bug reports itself when it sees an error repeat, without being asked
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Done when




- The chief of staff skill says: when the chief of staff sees the same error, refusal or anomaly a second time (in one run or across sessions), or a single one that changes a decision or a safety rule, it files a work item for it, as an investigation (cause unknown) or a bug report (cause known), without being asked. It checks the tracker for a duplicate first; if one exists it appends the new evidence to that item (a note with the date and where it was seen) and files nothing new.
- The item it files is `proposed`, has a Done when, and carries the evidence: the command or event, its output, where and when it was seen (pull request, dispatch or session), how many times, and what it blocks. It names no private store, device, key, environment or model, and it records a security finding only as the owner has decided security findings are recorded.
- The chief of staff tells the owner in one line after filing (the item ID and why), and does not ask first. It does not fix the problem itself, and it files one item per cause, not one per occurrence.
- The skill lists what does not trigger it: a question that is the owner's to answer (that is a decision), a one-off error with no decision hanging on it, and anything already tracked.
- An offline eval scenario seeds a repeated error and checks the chief of staff files one item with the evidence and tells the owner afterward; another seeds the same error already tracked and checks it appends to the item and files nothing new.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

On 2026-11-16 the `tracker` check run on two tracker-only pull requests read `in_progress` after it had succeeded. The chief of staff noticed it on the first, merged on the evidence of the other checks, saw it again on the second, and filed an item (HITLD-386) only when the owner asked whether one existed. The owner's instruction (2026-11-16): the chief of staff should file investigations and bug reports into the work tracker on its own when it sees repeated errors like that, so the owner does not have to ask. The standing rule was to file work items for problems after checking duplicates; this item makes the trigger, the duplicate check and the evidence explicit.

## Notes

Skill and eval change: needs the owner's own yes to merge. Related: HITLD-155 (executors raise the bugs they find), HITLD-143 (whether the chief of staff's reversible tracker edits need a per-change owner approval: filing an item is one of them; until that is decided, an item filed this way is `proposed` and the owner can drop it), HITLD-239 (repeated orchestrator silence), HITLD-182 (the chief of staff acts on events during long tasks), HITLD-386 (the example).

## Note on 2026-11-20 (reconciliation)

Under the one trust engine (HITLD-507, 552) "the chief of staff files investigations and bug reports itself" is a kind with a supervision mode, not a separate rule. Today it files on a second sighting by the owner's standing rule (recorded as an initial grant, HITLD-576).
