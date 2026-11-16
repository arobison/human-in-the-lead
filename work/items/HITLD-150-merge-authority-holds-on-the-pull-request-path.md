---
id: HITLD-150
title: "Merge authority holds on the pull-request path: the paths and areas that wait, and earning the queue"
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-133]
---

## Why

Design 14 gives the owner control over what waits for them: `merge.owner_paths` and `merge.owner_areas` limit owner mode to those paths and areas, a branch that touches nothing there goes through the queue without asking, and `merge.propose_queue_after` has the system propose letting the queue take an area once enough merges in a row were approved as presented and none reverted. The system never changes the mode itself. All of that runs in the local merge queue. In a cloud session the local queue cannot run, so merges go through pull requests (HITLD-133), and HITLD-133 does not mention these settings. This repository sets none of them, so every pull request waits for the owner, and none can earn its way out of waiting.

## Done when

- On the pull-request path, a pull request that changes nothing under `merge.owner_paths` or in `merge.owner_areas` is merged by the system once its named checks pass. One that changes a file there waits for the owner, as in owner mode today. With both settings empty, every pull request waits.
- The path decides from the pull request's diff, never from its author or its description.
- The earn-the-queue proposal works on this path: after `merge.propose_queue_after` approved merges in an area with none reverted, the orchestrator puts to the owner, as a decision, the policy change a yes would make. The system never changes `merge.mode` or the owner settings itself.
- A merge the system makes without asking carries the owner's delegated sign-off for that class, recorded in the owner's own earlier answer and named as delegated in the commit message, and it is listed in the digest with the command that reverses it.
- A revert of such a merge counts against the area's run, and a branch that fails its checks goes back to its executor, never to the owner.
- Tests run the flow against a fake GitHub API: a pull request outside the owner paths merged, one inside left waiting, a diff that touches both, the proposal after the threshold, and a revert resetting the run. Design 14 says how. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session, who asked whether decision rights for merging pull requests that need no review were planned. They are designed and built for the local queue, and this item carries them to the pull-request path. HITLD-133 builds that path, so this needs it. HITLD-143 overlaps in its merge half: with these settings, tracker-only pull requests need no special case, and HITLD-143 narrows to logging and reversal.
