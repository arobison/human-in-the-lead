---
id: HITLD-133
title: Merging through GitHub pull requests, for sessions that cannot push main
kind: work
state: in-progress
created: 2026-11-15
project: HITLD-15
claimed_by: D-7
---

## Why

The merge queue merges by fast-forwarding main and pushing it. A cloud session cannot push main (its git access refuses it), and a protected main may refuse it anywhere. Every merge in a long session went another way, by hand: open a pull request, wait for the named checks, squash-merge it through the GitHub API with the owner's sign-off, then bring the next waiting branch up to date. A self-hosted orchestrator in a cloud session cannot merge without this. The owner decided it lands before self-hosting.

## Done when

- `merge.via: pull-request` (policy) makes the queue open or update a pull request for each tested branch (its body from the item, the report's evidence and the release note, after `hitld publish check`), wait for the checks the policy names (not every check: a check that never completes must not stall the queue), and squash-merge through the GitHub API with a commit message carrying the item's trailers and, in owner mode, the owner's `Signed-off-by` taken from the recorded approval; the local fast-forward stays for `merge.via: push`.
- After each merge, the next waiting branch is brought up to date with main (merge, never force-push), rebuilt where the build's output is committed, and re-checked; a conflict sends it back to its executor as a follow-up.
- The tracker's close (state, `claimed_by`, the release note) lands in the same pull request, and the merged branch's worktree is removed (HITLD-130).
- GitHub's own merge queue is noted as a later backend (design 14); the GitHub API is reached through the session's existing access, with no token stored by HITLd.
- Tests run the flow against a fake GitHub API: green, a red check, a check that never completes, a conflict on update; design 14.2 and 16.2 say so.
- `npm run check`, the offline eval gate and `hitld work check` pass.
