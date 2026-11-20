---
id: HITLD-609
title: "Design how a project's measurement tool plugs in: capabilities declared by the project, run through the evidence source, taught by the project's own skill"
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
---

## Done when



- The owner has walked through the design one question at a time, and each answer is recorded as a decision.
- The design parts say how a project's own measurement tool (benchmark suites, studies with domain instruments, trends by commit, regression finding) connects, and mark what is built and what is not.
- Build items are filed from the decisions, each with its own done-when.
- `hitld work check` passes.

## Why

The first outside consuming project, Cesium 2.0 (this repository stays the first consumer, in rc.2: decision HITLD-612), has a workbench harness (dyno) that runs rendering benchmark suites, runs studies with domain-specific instruments, shows commit-by-commit trends for performance metrics and identifies regressions. The owner asked how HITLD should know how to use those tools when they are needed, and what abstraction connects them.

The design already decides the direction (design parts 3.3, 2.17, 5.x, 13.2 and 13.3): the project's measurement tool owns runs and studies; the system references them through the evidence source and does not duplicate them; executors measure through it and cite run IDs; benchmark runs hold the benchmark lock and a quiet machine; budgets and regressions come from the tool's measurements. What is missing: nothing in the core implements the evidence source (the interface is three calls, run, study and an optional start), no item or milestone builds it, and nothing says how a project declares what its tool can do or how an agent learns when to reach for it.

## What the design has to settle

- A capability set the project declares (run a suite, run a study, compare two commits, read a trend, find the commit a regression came in, list instruments), each with its command, its JSON output shape, the serial resources it needs, whether it needs a quiet machine, and a cost and duration estimate, so the system can tell what a project's tool supports and degrade the rest.
- A command-backed evidence source: the core calls the project's own command line with JSON in and out and never imports the tool, so no project's tool is special to the core.
- Who teaches agents when to use it: a skill owned by the project's repository (when a change touches rendering, which suite; which instrument for which kind of question), loaded on demand, with the brief pointing to it, and a knowledge-base note per domain instrument.
- Which events invoke it: the executor contract (measure and cite run IDs), the baseline cadence, the performance-budget loop, and an item of kind study.
- What HITLD shows: the headline result and a link to the tool's own views, not a copy of its trends.
- Noise and verdicts: whose regression threshold counts (the tool's, the project's budget, the owner's), and how a regression against measured run-to-run noise becomes an item.
- Whether the evidence source is also the right shape for other tools (an eval harness, a load test, a fuzzer), so the abstraction is not shaped by one project.

## Notes

Design-heavy: stays `proposed` and is walked through with the owner before any build. Related: HITLD-559 (a performance run takes the machine; proposed), HITLD-42 (load-aware admission and quiet-machine holds), HITLD-135 (the walk-through skill), HITLD-403 (a consuming project's tracker behaves as its own). Design only so far; the placement under a milestone is the owner's.

## Decided on 2026-11-20 (HITLD-610)

The owner said the harness, dyno, is in the cesium-2.0-webgpu-pox branch of the cesiumgs/cesium repository and that Cesium is the first consumer, and decided to place the walk-through on the roadmap: it is a constraint of milestone HITLD-567 (clause c2), so it is settled before HITLD-559 and any build item that depends on the evidence source starts.

## Clarified on 2026-11-20 (HITLD-612)

Cesium is the first outside consumer, not the consumer of rc.2 (that is this repository, HITLD-67). Its setup and release pin belong to v0.1.0 (HITLD-24, HITLD-66); this walk-through is placed in rc.5, before v0.1.0, so the design is settled before the first outside project depends on it.
