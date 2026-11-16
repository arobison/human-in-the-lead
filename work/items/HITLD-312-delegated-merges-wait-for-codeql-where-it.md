---
id: HITLD-312
title: "Delegated merges: wait for CodeQL where it analyzes the diff"
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Wait for CodeQL where it analyzes the diff: The merge path waits for the CodeQL result on code diffs, not on text-only ones."
answered_at: 2026-11-16T06:18:11.728Z
answered_via: question-tool
answered_by: owner
---

## Question

How should the gap between the named jobs and the CodeQL result check close?

PR #207 (HITLD-150): merge authority holds on the pull request path.

## Options and recommendation

- A. Wait for CodeQL where it analyzes the diff: The merge path waits for the CodeQL result on code diffs, not on text-only ones.
- B. Require it in branch protection: Text-only PRs would block.
- C. Leave it: Merge on the named jobs.

Recommended: Wait for CodeQL where it analyzes the diff. Branch protection cannot express it.

## Answer

Recorded in the front matter once answered.
