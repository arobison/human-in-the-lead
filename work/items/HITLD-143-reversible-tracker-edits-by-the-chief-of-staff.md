---
id: HITLD-143
title: Reversible tracker edits by the chief of staff and orchestrator land without a per-change owner approval
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-150, HITLD-131]
---

## Why

Tracker items are text files in git, so a change to one is easy to review and easy to undo. Today every tracker change from a cloud session reaches main through a pull request that needs the owner's sign-off, whether it files an item, fixes a typo or adds a dependency. The owner asked for a system so the chief of staff and orchestrator can change work items without asking each time. Decision rights already treat a call that is easy to undo as the system's own: it is logged with `rights log`, listed in the digest, and reversed with one command. Merging the change is the part that still asks, and HITLD-150 now builds it, so this item narrows to the class, the logging and the reversal.

## Done when

- The owner sets, in the person file, which tracker edits are a two-way door the system makes on its own authority, and the default list is short: create an item, fix wording inside an item's facts, add or correct a `needs` link, and correct a duplicate. Everything else stays the owner's, including a release, a milestone, a state change to done or dropped on work no executor reported on, a change of scope, and anything outside `work/`.
- A change in that class is made, logged with `hitld rights log` naming the item and the change, and listed in the digest with the command that reverses it. `hitld rights reverse` undoes it by a revert pull request that also lands without a further approval.
- Merging such a pull request is the path HITLD-150 builds (the paths that wait, the delegated sign-off, the check on the diff). This item adds no merge authority of its own; it supplies the class of edits and the logging and reversal.
- The delegation can be turned off in one setting, and an executor's session cannot use it.
- The decision to delegate is recorded as the owner's own answer, and the orchestrate and chief-of-staff skills say when to use this path and when to ask.
- Tests cover a change in the class, a change outside it, a diff that touches a file outside `work/`, a revert, and the setting turned off. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. It builds on HITLD-125 (one command to publish tracker changes), HITLD-133 (merging through pull requests) and HITLD-131 (tracker-only pull requests skip the code checks), and on the decision-rights design for two-way doors (part 4). HITLD-132's curator findings stay routed as that item says. The owner decides the class and the delegated sign-off, so the first step of whoever builds this is a decision for the owner, not a default.
