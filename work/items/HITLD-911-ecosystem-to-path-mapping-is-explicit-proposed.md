---
id: HITLD-911
title: Ecosystem-to-path mapping is explicit, proposed at install
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Explicit mapping, proposed at install: A list of profile plus path globs in policy.json; most specific wins."
answered_at: 2026-11-22T20:49:40.218Z
answered_via: question-tool
answered_by: owner
---

## Question

How does HITLd know which ecosystem applies to which part of a mixed repository (HITLD-883 decision 3 of 12)?

Run-time detection would let a branch change HITLd's behavior by adding a manifest, with no owner approval.

## Options and recommendation

- A. Explicit mapping, proposed at install: A list of profile plus path globs in policy.json; most specific wins.
- B. Detect at run time: No setup but a branch can alter behavior.

Recommended: Explicit mapping, proposed at install. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
