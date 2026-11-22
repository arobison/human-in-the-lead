---
id: HITLD-844
title: "Q39: how a release package with no surface file is bumped"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. No proposal; the owner names the version: release propose proposes no version; the owner passes --version, a patch included."
answered_at: 2026-11-22T07:27:25.200Z
answered_via: question-tool
answered_by: owner
---

## Question

How is a package with no surface file bumped?

There is no interface to measure a delta from.

## Options and recommendation

- A. No proposal; the owner names the version: release propose proposes no version; the owner passes --version, a patch included.
- B. Patch by default: release propose proposes a patch bump; a breaking change can ship as a patch.

Recommended: No proposal; the owner names the version. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
