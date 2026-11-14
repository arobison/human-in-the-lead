---
id: HITLD-76
title: "Stacked pull requests: dependent items as a GitHub stack, merged in order by the merge queue"
kind: work
status: Planned
created: 2026-11-14
project: HITLD-28
---

## Why

Items often depend on each other: one builds on another's branch before that one is merged. Opening each as a pull request into main makes every later one conflict and need a merge of main after each squash. A stack (each pull request based on the one below it, as GitHub's stacked pull requests support) shows each change's own diff and merges in order. The owner asked that the system use stacks, including when the merge queue merges automatically.

## Done when

- When an item's branch starts from another open item's branch (its `needs`), the orchestrator opens its pull request as part of a stack on that branch, not on main, and the briefs and reports name the stack.
- The merge queue, in owner mode and in the automatic mode, merges a stack bottom-up: each merge retargets or updates the next pull request, its checks run on the new base, and a failure stops the stack above it and sends that item back.
- Squash merges keep working with the DCO rule (HITLD-59): the approver's sign-off lands on each squash commit in the stack.
- Closing by trailer at merge (HITLD-49) closes each item in the stack as its own pull request merges.
- A fixture test builds a stack of three dependent branches, merges it through the queue, and checks order, retargeting and that a failure in the middle stops the top.
- Design 14 says how stacks and the merge queue work together; HITLD-27's answer covers merging a stack by hand.

