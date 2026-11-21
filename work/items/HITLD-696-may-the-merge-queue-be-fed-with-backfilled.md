---
id: HITLD-696
title: May the merge queue be fed with backfilled verified-pass events for the remaining first-run branches?
kind: decision
state: done
created: 2026-11-21
project: HITLD-15
decider: owner
answer: "A. Allow it for these, fix it properly: Keep queuing the remaining branches (#406, #410, #411, #397, #399) with marked events on this explicit yes; file the proper fix so no later run needs the shortcut."
answered_at: 2026-11-21T20:36:20.789Z
answered_via: question-tool
answered_by: owner
---

## Question

Orch-5 queued first-run pull requests by writing verified-pass ledger events marked backfilled and not measured; its permission check blocked further ones as undermining oversight.

The queue still runs its own checks and nothing merges without the owner's approval. Code check: nothing in core/lib treats the backfilled marker specially, so first-pass yield and first-verdict sizing count these events as real.

## Options and recommendation

- A. Allow it for these, fix it properly: Keep queuing the remaining branches (#406, #410, #411, #397, #399) with marked events on this explicit yes; file the proper fix so no later run needs the shortcut.
- B. Wait for the proper import command: Queue nothing more until HITLD-680 is built.
- C. Merge them by hand with the owner's yes: Skip the queue for the remaining branches.

Recommended: Allow it for these, fix it properly. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
