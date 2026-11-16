---
id: HITLD-358
title: Release stages on the way to v0.1.0
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Yes: rc.2, rc.3, rc.4, v0.1.0: rc.2 stays HITLD-67 only; rc.3 is the self-hosted run holding up; rc.4 is an outside project adopting it; v0.1.0 adds the safe-to-publish and first-release checks; each stage has a release item and gate."
answered_at: 2026-11-16T18:03:17.481Z
answered_via: question-tool
answered_by: owner
---

## Question

Create release items for rc.3 and rc.4, and make v0.1.0's release item need rc.4 instead of its six open direct needs?

Only one release item per version is allowed, so stages are expressed by release items that need milestones.

## Options and recommendation

- A. Yes: rc.2, rc.3, rc.4, v0.1.0: rc.2 stays HITLD-67 only; rc.3 is the self-hosted run holding up; rc.4 is an outside project adopting it; v0.1.0 adds the safe-to-publish and first-release checks; each stage has a release item and gate.
- B. Fewer stages: Merge rc.3 and rc.4 into one candidate.
- C. rc.2 then v0.1.0: No intermediate candidates.

Recommended: Yes: rc.2, rc.3, rc.4, v0.1.0. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
