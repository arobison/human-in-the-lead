---
id: HITLD-917
title: HITLd needs Node on the machine in rc.2; a standalone binary comes in rc.3
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Node on the machine in rc.2; standalone binary in rc.3: No new release machinery before rc.2."
answered_at: 2026-11-22T20:54:16.694Z
answered_via: question-tool
answered_by: owner
---

## Question

How does a project with no Node toolchain run HITLd (HITLD-883 decision 9 of 12)?

Node 22.13 or later on the machine, not in the project; standalone binaries in rc.3.

## Options and recommendation

- A. Node on the machine in rc.2; standalone binary in rc.3: No new release machinery before rc.2.
- B. Pinned runner in rc.2: Adds a download and checksum.
- C. Container image: Poor fit.

Recommended: Node on the machine in rc.2; standalone binary in rc.3. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
