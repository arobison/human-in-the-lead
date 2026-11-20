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

The design already decides the direction (design parts 3.3, 2.17, 5.x, 13.2 and 13.3): the project's measurement tool owns measurements and studies; the system references them through the evidence source and does not duplicate them; executors measure through it and cite result IDs; benchmark measurements hold the benchmark lock and a quiet machine; budgets and regressions come from the tool's measurements. What is missing: nothing in the core implements the evidence source (the interface is three calls: get a result, get a study and an optional start), no item or milestone builds it, and nothing says how a project declares what its tool can do or how an agent learns when to reach for it.

## What the design has to settle

- A capability set the project declares (run a suite, run a study, compare two commits, read a trend, find the commit a regression came in, list instruments), each with its command, its JSON output shape, the serial resources it needs, whether it needs a quiet machine, and a cost and duration estimate, so the system can tell what a project's tool supports and degrade the rest.
- A command-backed evidence source: the core calls the project's own command line with JSON in and out and never imports the tool, so no project's tool is special to the core.
- Who teaches agents when to use it: a skill owned by the project's repository (when a change touches rendering, which suite; which instrument for which kind of question), loaded on demand, with the brief pointing to it, and a knowledge-base note per domain instrument.
- Which events invoke it: the executor contract (measure and cite result IDs), the baseline cadence, the performance-budget loop, and an item of kind study.
- What HITLD shows: the headline result and a link to the tool's own views, not a copy of its trends.
- Noise and verdicts: whose regression threshold counts (the tool's, the project's budget, the owner's), and how a regression against measured run-to-run noise becomes an item.
- Where results live: kept by the project's tool and referenced by result ID (the current design), or also stored in the project's private store as a project-owned data area. The store is a generic key-path text store synced through a git repository, with no command that lets a session write a project's own files (executors are refused store commands), no declared record types, and no size or retention rules, so storing results there needs a decision on those. Raised by the owner on 2026-11-20 for the first outside consumer's benchmark results (HITLD-612); the case for a copy is results the project cannot keep in a public repository, and the case against is duplicating what the tool already owns.
- Whether the evidence source is also the right shape for other tools (an eval harness, a load test, a fuzzer), so the abstraction is not shaped by one project.

## Notes

Design-heavy: stays `proposed` and is walked through with the owner before any build. Related: HITLD-559 (a performance run takes the machine; proposed), HITLD-42 (load-aware admission and quiet-machine holds), HITLD-135 (the walk-through skill), HITLD-403 (a consuming project's tracker behaves as its own). Design only so far; the placement under a milestone is the owner's.

## Decided on 2026-11-20 (HITLD-610)

The owner said the harness, dyno, is in the cesium-2.0-webgpu-pox branch of the cesiumgs/cesium repository and that Cesium is the first consumer, and decided to place the walk-through on the roadmap: it is a constraint of milestone HITLD-567 (clause c2), so it is settled before HITLD-559 and any build item that depends on the evidence source starts.

## Clarified on 2026-11-20 (HITLD-612)

Cesium is the first outside consumer, not the consumer of rc.2 (that is this repository, HITLD-67). Its setup and release pin belong to v0.1.0 (HITLD-24, HITLD-66); this walk-through is placed in rc.5, before v0.1.0, so the design is settled before the first outside project depends on it.

## Decided on 2026-11-20 (HITLD-617)

The owner answered that the first outside consumer's benchmark results are confidential and cannot live in the public repository. So the design must include private storage for results, and nothing public may carry them. What that settles and what it leaves open:

- **Settled:** results are kept in private storage (the project's private store or another private location). The project's public repository, its tracker files, its pull request titles and bodies, its commit messages and its public reports carry references only (a result ID and a link that needs access), never a number, a configuration or a trace.
- **Consequences to design:**
  - The executor contract's `bench_runs` field cites result IDs, and a report's text goes into a pull request, so what a report may say about a result needs a rule and a check against the private term list.
  - A budget regression or trend opens an item automatically (design 2.17). In a public tracker that item may name the metric and the commit but not the measured values, which stay in private storage.
  - The dashboard, the digest and any generated view must read values from private storage at view time and never write them into committed files.
  - Whether a reference such as a result ID is itself safe to publish needs a decision.
- **Still open:** the shape of the data area (the store is a git text store sealed to approved devices, so large traces and long commit-by-commit history probably need a separate private location with the store holding an index), who may write it (not executors), size and retention, and how a cloud session receives access.

## Noted on 2026-11-20 (the owner, after HITLD-617)

The owner added two facts: the results may be made public someday, and today they are stored only on the machine that produced them. What that changes:

- **Confidential is a setting, not a fixed rule.** The results carry a classification (the design already has classifications and a cap on what each channel may carry), confidential by default. Making them public later is the owner's decision that changes the classification, not a redesign.
- **Results are per machine.** They are hardware-specific anyway, so a comparison or a regression trend is only meaningful between runs on the same machine, and a cloud session or another machine cannot read them. A reference to a run must therefore name the machine as well as the result ID, and the evidence source reads a result on the machine that holds it.
- **The first version may not need a copy at all.** HITLD stores references only (machine and result ID, a headline the owner allows, no values) in the synced store, and the values stay where they were produced. A data area in the private store is needed only if results must be read from another machine. That is still open.
- **Benchmarks run where the hardware is.** A run needs the machine with the right GPU, a quiet machine and the benchmark lock, so the capability set must say which machine can run which suite or instrument (the machine registry, design 13.4, holds capacities and locks per machine), and a session elsewhere asks that machine to run it or waits.

## Decided on 2026-11-20 (HITLD-618)

The owner decided that HITLD stops using the word and concept of a run: HITLD has no run object (HITLD-484), and a project's measurement results are results (or measurements), each with its own ID, the machine that produced it and its classification. This item's text now says result and measurement where it said run. The names that exist today (the executor contract's `bench_runs`, the evidence source's `getRun` and `startRun`, the baseline cadence's "benchmark runs", "a performance run takes the machine" in HITLD-559) are renamed when the design is walked through and the design parts are updated; decision HITLD-617 keeps its original wording as the record.

## Decided on 2026-11-20 (HITLD-619): most of the complexity lives in dyno

The owner said dyno measures in two ways, locally or by driving a remote machine over a network (which is different from that remote machine running its own benchmarks locally), that it may eventually drive a farm of dedicated test machines, and decided that most of that complexity lives in dyno. So HITLD's side stays thin. This supersedes the last bullet of the note above (which machine can run which suite is dyno's to declare and reserve, not a HITLD registry).

- **Dyno's side (not modeled by HITLD):** the controller and the target machine, the farm and its inventory, reserving and queueing targets, the exclusive hold and the quiet-machine hold on a target, which results are comparable, and where results are stored.
- **HITLD's side (the whole interface):**
  - dyno declares what it can do (suites, instruments, kinds of target) and HITLD reads that declaration;
  - HITLD asks for a measurement with constraints and gets back a handle, then an event when the result is ready, so no session or executor holds a slot while a queue waits;
  - a result comes back as an opaque reference (a result ID and strings dyno supplies for the controller and target machines), a headline the owner allows and a classification;
  - HITLD enforces the classification rule: no values in public text, and the public tracker, pull requests and reports carry references only.
- **What this puts in question (for the walk-through):**
  - whether HITLD still needs its own benchmark lock and quiet-machine hold (design 13.2 and 13.4, HITLD-559) at all, or whether dyno's reservation replaces them even for local measurements;
  - what HITLD does when a measurement is refused, queued for a long time or cancelled;
  - the machine named in a reference is whatever dyno supplies; HITLD does not interpret it.

## Noted on 2026-11-20 (the owner: HITLD reads results, reasons about them and starts measurements)

The owner added that HITLD is able to read the results and reason about them, and to start benchmark measurements itself. What that adds to the walk-through, keeping HITLD's side thin (HITLD-619):

- **Reading and reasoning put confidential values into a model's context.** A result that cannot live in the public repository is still sent to the model provider when a session reads it to reason about it. The design has a classification and a cap on what each channel may carry, and executors on other providers or local models are a separate open design (HITLD-616). The owner must decide which model channels may carry confidential results (the owner's own provider account only, a local model only, or none), as a rule by classification.
- **Where the reading happens.** Results are stored on the machine that holds them, so a session elsewhere (a cloud session) cannot read them directly. Prefer that dyno does the heavy reasoning it already does (comparing two commits, a trend, finding the commit a regression came in) and returns a verdict and the small summary the owner allows; HITLD reasons over that. Raw data is returned only when the classification and the channel allow it.
- **Starting a measurement is a decision with a cost.** It costs farm and machine time, not tokens, and can delay other work or disturb a measurement in progress. It needs a rule by kind of decision on the trust engine (HITLD-552): which kinds of measurement the system may start without asking, a limit on how many it may queue, and who is told when one is refused or queued. A loop that starts measurements (to bisect a regression, for example) needs a bound on how many it may start before it asks.
- **What reasoning may do with a result.** Opening an item from a regression, with references and no values in a public tracker (HITLD-617), is allowed by design 2.17; changing a budget or accepting a regression stays the owner's.

