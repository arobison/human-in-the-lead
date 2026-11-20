---
id: HITLD-309
title: "Delegated merges: release records wait for the owner"
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Yes, it waits for me: owner_paths gains work/releases/**."
answered_at: 2026-11-16T06:18:03.522Z
answered_via: question-tool
answered_by: owner
---

## Question

work/releases/** would merge without asking under the delegated scope. Add it to the paths that wait for the owner?

PR #207 (HITLD-150): merge authority holds on the pull request path.

## Options and recommendation

- A. Yes, it waits for me: owner_paths gains work/releases/**.
- B. No, it can merge: Release records merge like other work/ files.

Recommended: Yes, it waits for me. A release record is the release decision (HITLD-179).

## Answer

Recorded in the front matter once answered.
