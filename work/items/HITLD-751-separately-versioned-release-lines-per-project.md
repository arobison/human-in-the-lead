---
id: HITLD-751
title: "Separately versioned release lines per project (GitHub issue 465): when"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "B. Design and build in rc.2: Same walk-through, and the build joins HITLD-67."
answered_at: 2026-11-22T01:57:58.778Z
answered_via: question-tool
answered_by: owner
---

## Question

Issue 465 asks for independently versioned release lines per project in one repository. How should rc.2 treat it?

A design change to the release model: version, tag matching, release record and interface delta are repository-wide today. The owner's laptop projects may be monorepos.

## Options and recommendation

- A. Design in rc.2, build later: File a proposed design item, walk it through; build in rc.3.
- B. Design and build in rc.2: Same walk-through, and the build joins HITLD-67.
- C. Track it, defer both to rc.3: File only.

Recommended: Design in rc.2, build later. The chief of staff recommended designing in rc.2 and building later; the owner chose to build in rc.2 too.

## Answer

Recorded in the front matter once answered.
