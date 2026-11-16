---
id: HITLD-159
title: What the squash commit's sign-off says when the system merges without asking
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. The owner's sign-off, marked as delegated: The squash carries the owner's Signed-off-by plus a trailer naming the decision that delegated it, limited to the scope the owner chose for merging without asking."
answered_at: 2026-11-16T01:06:51.308Z
answered_via: question-tool
answered_by: owner
---

## Question

When the system merges a tracker-only pull request without asking, what does the squash commit's sign-off say?

CONTRIBUTING says the person who approves the merge signs off the squash commit, and the DCO check accepts agent commits that carry an Agent-Role trailer with no sign-off. Until now the chief of staff has added the owner's Signed-off-by to the tracker pull requests it merged for them. Raised for HITLD-150.

Reversibility: two-way.

## Options and recommendation

- A. The owner's sign-off, marked as delegated: The squash carries the owner's Signed-off-by plus a trailer naming the decision that delegated it, limited to the scope the owner chose for merging without asking.
- B. No sign-off on those merges: The squash carries the agent trailers and Merged-under with the decision, and no Signed-off-by.
- C. Sign-off only when the owner approved it: Merges the owner approves carry their sign-off. Merges made under the standing rule carry none, and the history shows which is which.

Recommended: The owner's sign-off, marked as delegated. It is what is in effect for tracker pull requests now, and the history shows it was a standing rule.

## Answer

Recorded in the front matter once answered.
