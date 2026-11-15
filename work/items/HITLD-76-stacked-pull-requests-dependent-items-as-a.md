---
id: HITLD-76
title: "Stacked pull requests: dependent items as a GitHub stack, merged in order by the merge queue"
kind: work
state: planned
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

## Notes

From GitHub's stacked pull request docs (public preview; read from the github/docs and github/gh-stack sources):

- A stack is a first-class object, not just pull requests based on each other's branches. The REST API has a `stack` object on pull requests and a Stacks API to list, read, create, extend and dissolve stacks; GraphQL has read-only `stack` and `stackEntry` fields; `pull_request` webhooks carry `stack`, and Actions sees `github.event.pull_request.stack`.
- Every pull request in a stack is checked against the stack's base (the trunk): required reviews, required status checks, CODEOWNERS and code scanning. Merging one requires every pull request below it to pass too, and a fully linear history.
- A stack can only be merged through the asynchronous merge API; the legacy synchronous merge endpoints refuse it. Merging a pull request merges or queues everything below it in one atomic operation. Squash makes one commit per pull request.
- Stacks work with GitHub's merge queue: the whole stack is queued in order, and ejecting one ejects everything above it.
- Keeping the history linear needs a cascading rebase: `gh stack rebase` then `gh stack push` (which pushes with `--force-with-lease`), or the server-side "Rebase stack" button, which writes signed commits and keeps approvals when the diff is unchanged. Agents here never force-push, so prefer the server-side rebase, or decide this explicitly.
- Open questions for this item: how each squash commit in a stack merge gets the approver's `Signed-off-by` (HITLD-59) through the asynchronous merge API; and whether hitld's own merge queue drives GitHub's merge queue or the stack merge API directly.

