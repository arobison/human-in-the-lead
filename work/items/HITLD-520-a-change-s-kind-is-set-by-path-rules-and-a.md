---
id: HITLD-520
title: A change's kind is set by path rules, and a classifier can only tighten it
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "A. Paths cap, classifier only tightens: Path rules in policy name each kind and set its ceiling; a change touching several kinds takes the most restrictive; a classifier reads only the diff and can send a change to the owner but never promote one; owner_paths become the never-unlock kinds; propose_queue_after goes away; past approval counts do not count toward the new bar"
answered_at: 2026-11-19T21:25:13.244Z
answered_via: question-tool
answered_by: owner
---

## Question

How is a change's kind decided for earning trust, and can a classifier loosen it?

HITLD-472: trust is earned per kind of change. Today merge.owner_paths and areas are path globs, and merge.propose_queue_after counts approvals, which HITLD-473 dropped as the signal. The owner suggested combining path rules with a classifier in a way that cannot be fooled or that contains the blast radius.

## Options and recommendation

- A. Paths cap, classifier only tightens: Path rules in policy name each kind and set its ceiling; a change touching several kinds takes the most restrictive; a classifier reads only the diff and can send a change to the owner but never promote one; owner_paths become the never-unlock kinds; propose_queue_after goes away; past approval counts do not count toward the new bar
- B. Classifier can also loosen it: The classifier may call a change safer than its paths say
- C. Paths only: No classifier

Recommended: Paths cap, classifier only tightens. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
