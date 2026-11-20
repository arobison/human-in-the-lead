---
id: HITLD-612
title: Cesium is the first outside consumer; this repository stays the first consumer in rc.2
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: it's the first outside consumer
answered_at: 2026-11-20T01:38:54.798Z
answered_via: chat
answered_by: owner
---

## Question

Is Cesium the first consumer, replacing this repository in rc.2 (Consumer live), or the first outside consumer?

HITLD-67 says the first consumer is this repository, running its own development on an installed release; setup for an outside consumer is parked in v0.1.0 (HITLD-24). The owner had said Cesium is the first consumer (HITLD-610).

## Options and recommendation

- A. First outside consumer: This repository stays rc.2's consumer; Cesium is the first outside project, which v0.1.0's setup serves
- B. First consumer, replacing this repository: rc.2 changes to a Cesium run and outside setup moves up

Recommended: First outside consumer. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
