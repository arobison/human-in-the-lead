---
id: HITLD-914
title: HITLd reads versions from monorepo manifests and never builds a project graph
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Read versions only; propose packages at install: HITLd never builds a graph."
answered_at: 2026-11-22T20:52:21.700Z
answered_via: question-tool
answered_by: owner
---

## Question

How does HITLd relate to monorepo tools (HITLD-883 decision 6 of 12)?

HITLd owns release packages; install may propose packages once from a workspace file; affected targets stay with the build tool.

## Options and recommendation

- A. Read versions only; propose packages at install: HITLd never builds a graph.
- B. Also read the workspace graph at run time: Tracks each tool's graph format.
- C. No workspace help: Owner declares packages by hand.

Recommended: Read versions only; propose packages at install. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
