---
id: HITLD-843
title: "Q38: which tag template this repository's main package takes"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. v{version}: No tag renamed; v0.1.0-rc.1 already matches; the v* ruleset and consumer refs keep their meaning."
answered_at: 2026-11-22T07:27:21.314Z
answered_via: question-tool
answered_by: owner
---

## Question

Which tag template does this repository's main package take?

HITLD-758 (the curator pass on release packages, PR 521) needs the answer to finish part 22; HITLD-759 builds on it.

## Options and recommendation

- A. v{version}: No tag renamed; v0.1.0-rc.1 already matches; the v* ruleset and consumer refs keep their meaning.
- B. main@{version}: A second tag beside the old one, a new ruleset, every consumer moves its ref.

Recommended: v{version}. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
