---
id: HITLD-429
title: "A command for hand merges: hitld merge hand takes the queue's lock, merges and writes the merged event"
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Done when




- `hitld merge hand <PR>` merges a pull request by hand on the forge and does what the chief of staff does now: it checks that the head SHA matches the one given (the full SHA), that every check run is complete and green (with a documented rule for a check run that reads `in_progress` with a success conclusion, HITLD-386: read the suite's own status, then re-read once), that the files changed are what the caller says they are (tracker-only means only `work/` files), takes the merge queue's lock, merges, writes the merged event to the ledger, and closes the item if the pull request closes one.
- The merge queue refuses to run while a hand merge holds the lock, and a hand merge refuses while the queue holds it, with a message naming the holder.
- A hand merge of a pull request that needs the owner's own yes (code, skill, policy, schemas) refuses unless the owner's yes is recorded for that head SHA (a decision answered in the owner's own turn).
- The chief of staff skill and the orchestrate skill say to use it instead of the forge's tool and a hand-written ledger event.
- Tests cover a stale head SHA, a check not complete, a tracker-only claim with a code file, a held lock, and a merge that needs the owner's yes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-27, a decision open since 2026-11-14, asked how a merge by hand and the merge queue share the lock and how a hand merge closes its item. The owner chose a command (HITLD-428). Today the chief of staff merges through the forge's tool after checking by hand, and the orchestrator appends the merged event by hand, which is manual and could race the queue.

## Notes

Code and skill: needs the owner's own yes to merge. Related: HITLD-133 (merging through GitHub pull requests), HITLD-386 (the stale check-run status), HITLD-150 (the delegated merge path), HITLD-76 (stacked pull requests, which HITLD-27 held up).
