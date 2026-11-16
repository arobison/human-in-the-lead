---
id: HITLD-150
title: "Merge authority holds on the pull-request path: the paths and areas that wait, and earning the queue"
kind: work
state: done
created: 2026-11-16
project: HITLD-15
needs: [HITLD-133]
claimed_by: D-22
release_note: "On the pull-request merge path (`merge.via: pull-request`), owner mode honors `merge.owner_paths` and `merge.owner_areas`: a pull request that changes nothing there merges once its named checks pass, decided from its diff alone. `merge.owner_paths` is read in order and a glob that starts with `!` takes files back out. With the new `merge.pull_request.delegated_by`, such a merge carries the owner's sign-off and a `Delegated-by` trailer, a `merge-delegated` trust event, and a digest line with its reversal; approvals on this path are trust events and earn queue proposals."
---

## Why

Design 14 gives the owner control over what waits for them: `merge.owner_paths` and `merge.owner_areas` limit owner mode to those paths and areas, a branch that touches nothing there goes through the queue without asking, and `merge.propose_queue_after` has the system propose letting the queue take an area once enough merges in a row were approved as presented and none reverted. The system never changes the mode itself. All of that runs in the local merge queue. In a cloud session the local queue cannot run, so merges go through pull requests (HITLD-133), and HITLD-133 does not mention these settings. This repository sets none of them, so every pull request waits for the owner, and none can earn its way out of waiting.

## Done when

- On the pull-request path, a pull request that changes nothing under `merge.owner_paths` or in `merge.owner_areas` is merged by the system once its named checks pass. One that changes a file there waits for the owner, as in owner mode today. With both settings empty, every pull request waits.
- This repository's `policy.json` turns the path on: `merge.via` is `pull-request`, `merge.pull_request.checks` names the CI jobs a merge waits for, and `merge.generated` names the committed plugin build so a rebuild does not count as a change a person must read. Until it does, the pull-request merge path that HITLD-133 builds is off here.
- The path decides from the pull request's diff, never from its author or its description.
- The earn-the-queue proposal works on this path: after `merge.propose_queue_after` approved merges in an area with none reverted, the orchestrator puts to the owner, as a decision, the policy change a yes would make. The system never changes `merge.mode` or the owner settings itself.
- A merge the system makes without asking carries the owner's `Signed-off-by`, marked as delegated by a trailer that names the decision that delegated it (HITLD-159), and it is listed in the digest with the command that reverses it.
- A revert of such a merge counts against the area's run, and a branch that fails its checks goes back to its executor, never to the owner.
- Tests run the flow against a fake GitHub API: a pull request outside the owner paths merged, one inside left waiting, a diff that touches both, the proposal after the threshold, and a revert resetting the run. Design 14 says how. `npm run check`, the offline eval gate and `hitld work check` pass.

## Settled by the owner

On 2026-11-16, in the chief of staff session, the owner decided two choices in this item, recorded as decisions:

- **Scope (HITLD-158):** tracker-only now, then earn the rest. In this repository `merge.owner_paths` lists everything except `work/`, so pull requests that touch only tracker files merge once their checks pass. Code, workflows, schemas and skills wait for the owner. After the number of approved merges in an area with none reverted that `merge.propose_queue_after` sets, the system proposes widening that area, and the owner decides each time.
- **Sign-off (HITLD-159):** the owner's `Signed-off-by`, marked as delegated, limited to that scope.

What the number is for `propose_queue_after`, and which paths `owner_paths` holds exactly, are the build's to propose and the owner's to approve in the pull request that sets them.

## Notes

Raised by the owner in the chief of staff session, who asked whether decision rights for merging pull requests that need no review were planned. They are designed and built for the local queue, and this item carries them to the pull-request path. HITLD-133 builds that path, so this needs it. HITLD-143 overlaps in its merge half: with these settings, tracker-only pull requests need no special case, and HITLD-143 narrows to logging and reversal.
