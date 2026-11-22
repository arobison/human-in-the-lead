---
id: HITLD-609
title: "Design how a project's measurement tool plugs in: capabilities declared by the project, run through the evidence source, taught by the project's own skill"
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
needs: [HITLD-620]
constraint_of: [HITLD-567 c2]
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
  - what HITLD does when a measurement is refused, queued for a long time or canceled;
  - the machine named in a reference is whatever dyno supplies; HITLD does not interpret it.

## Noted on 2026-11-20 (the owner: HITLD reads results, reasons about them and starts measurements)

The owner added that HITLD is able to read the results and reason about them, and to start benchmark measurements itself. What that adds to the walk-through, keeping HITLD's side thin (HITLD-619):

- **Reading and reasoning put confidential values into a model's context.** A result that cannot live in the public repository is still sent to the model provider when a session reads it to reason about it. The design has a classification and a cap on what each channel may carry, and executors on other providers or local models are a separate open design (HITLD-616). The owner must decide which model channels may carry confidential results (the owner's own provider account only, a local model only, or none), as a rule by classification.
- **Where the reading happens.** Results are stored on the machine that holds them, so a session elsewhere (a cloud session) cannot read them directly. Prefer that dyno does the heavy reasoning it already does (comparing two commits, a trend, finding the commit a regression came in) and returns a verdict and the small summary the owner allows; HITLD reasons over that. Raw data is returned only when the classification and the channel allow it.
- **Starting a measurement is a decision with a cost.** It costs farm and machine time, not tokens, and can delay other work or disturb a measurement in progress. It needs a rule by kind of decision on the trust engine (HITLD-552): which kinds of measurement the system may start without asking, a limit on how many it may queue, and who is told when one is refused or queued. A loop that starts measurements (to bisect a regression, for example) needs a bound on how many it may start before it asks.
- **What reasoning may do with a result.** Opening an item from a regression, with references and no values in a public tracker (HITLD-617), is allowed by design 2.17; changing a budget or accepting a regression stays the owner's.

## Answer on the benchmark lock, confirmed by the owner on 2026-11-20

The question was whether HITLD still needs its own benchmark lock and quiet-machine hold, given that some measurements start outside HITLD (dyno's command line or web interface). The owner confirmed this direction:

- **Dyno is the authority for reservation, for every entry point.** Whoever starts a measurement, dyno enforces the reservation, including for a remote target or a farm. HITLD never locks a farm machine; it asks dyno.
- **The two meet in one place:** a local measurement on a machine that HITLD executors also use. There, dyno takes HITLD's existing machine-wide lock for the duration (one command, run by a hook that dyno's own configuration names, so dyno is not coupled to HITLD), and HITLD executors drain first. Dyno is the only caller because every entry point goes through dyno.
- **HITLD reads dyno's busy state** the way its load check reads CPU use, so its own heavy steps (tests, builds) wait during a measurement even if a person started it by hand. The first version is a status call; whether dyno also writes its busy state into the lock directory is left open, and the status call needs no shared filesystem.
- **What this changes in HITLD:** the lock and the quiet-machine hold (design 13.2 and 13.4, HITLD-559) keep guarding HITLD's own processes and the local case; they no longer try to represent a target machine or a farm.

## Raised on 2026-11-20 (GitHub issue 363)

The first outside consumer's own session filed GitHub issue 363 asking for the data area discussed above, synced across a person's machines (several laptops with different GPUs, later dedicated runners and phones). It is tracked as HITLD-622, which needs this item and the classification taxonomy (HITLD-620).

## Decided on 2026-11-20 (HITLD-623): dyno owns benchmark storage first

The owner decided, in stages: start with dyno owning storage (a private S3-compatible bucket, or whatever dyno chooses), and revisit a HITLD data area in the private store (HITLD-622, GitHub issue 363) only if sharing results across machines through dyno proves insufficient. The private store is not changed for this. What that means for HITLD's side:

- **Dyno is the only access path.** Bucket details, credentials, encryption and retention live in dyno's configuration. They never enter HITLD's repository, briefs, public tracker or reports. Dyno exposes commands to show a result, fetch a file and give a summary without raw values, and enforces the classification label.
- **HITLD keeps references** in its store: a result ID, which dyno instance holds it, the label and, where allowed, a headline. Decisions and studies that cite a result carry the reference.
- **A pin call.** Dyno owns lifecycle and deletion, but only HITLD knows which results a study or decision cites. HITLD tells dyno to pin a result with the citing reference, so retention keeps what is cited (the issue's fourth ask, as a call, not a store feature).
- **The store's sealing does not carry over to a bucket.** The bucket needs its own protection (an access policy, and client-side encryption by dyno where the label requires it), so the classification taxonomy (HITLD-620) needs a notion of the storage backend: what a label means in the sealed store and what it means in a bucket.
- **Reading from a cloud session** needs dyno's command line and bucket credentials in that session, which is a setup step for the consumer, and a way to receive the credentials without them entering the repository.

## Dyno's reply on GitHub issue 363, 2026-11-20

The consumer's session accepted the split, filed a design item for storage across machines and a build item for a real command line using the proposed interface (both as proposals, not contracts), and raised two points.

- **A completion command conflicts with its executor contract.** The contract forbids data or configuration keys that run code (`script`, `command`, hooks). Its alternative: completion is visible without one, through `measure status <handle>` to poll and a completion record (a file, or a line in an event log) that a caller can watch; if HITLD needs a push, HITLD watches that record itself. HITLD agrees: its own schema also refuses code-running keys, with one marked exception that the owner approves, and its cadence is already event-first (HITLD-536). The same conflict applies to the local-measurement hook (a command dyno runs before and after a local measurement to take and release HITLD's lock), which the owner confirmed earlier. **Proposed change, pending the owner's confirmation:** drop the hook. Dyno gates itself on measured machine load (it queues or refuses a measurement until the machine is quiet), reports busy or quiet through its status call, and HITLD gates its own heavy steps on that status. HITLD's machine-wide lock guards only HITLD's own processes. This also fits the owner's decision that most of the complexity lives in dyno (HITLD-619).
- **The status call fixes a failure seen the same day.** Timing measurements shared an 8-core machine with test suites at a load average near 50, and the measurements proved nothing; until now an orchestrator had to pass a hand-written rule (wait for a one-minute load under 4) into every brief. A status call that HITLD checks before heavy work turns that into a gate. Recorded as a sighting on HITLD-559.
- **For the walk-through:** a rule for tool adapters in HITLD's guidance, that an adapter's configuration names no code to run except in a property HITLD marks as executing and the owner approves. The command that HITLD runs to call dyno is such a property.

## Decided on 2026-11-20 (HITLD-624): the lock hook is dropped

The owner agreed with dropping the local-measurement hook (the proposal above). This supersedes the hook in the answer on the benchmark lock, and the completion command asked for earlier:

- **Dyno keeps its rule** that its data and configuration name no code to run. HITLD has the same rule, with a marked, owner-approved exception. If dyno later needs hooks, they belong in owner-level machine configuration outside the repository, which no agent can edit, as an approved exception; not now.
- **Dyno gates itself on measured machine load.** It queues or refuses a local measurement until the machine is quiet, so what protects a measurement is the ground truth (load, thermal state, other GPU use), not a cooperative lock that a browser, a build or a person's own command would ignore.
- **Dyno's status call reports three states** for the machine and each target it controls: busy, waiting for quiet (a local measurement is queued behind other work) and quiet, with who started the current measurement and for how long. HITLD gates its own heavy steps (tests, builds) on that status. While the state is waiting for quiet, HITLD starts no new heavy steps and lets the running ones finish, so the machine drains without a lock and a queued measurement is not starved.
- **Completion is by poll or a watched record.** `measure status <handle>` to poll, and a completion record (a file, or a line in an event log) that HITLD watches, consistent with its event-first cadence (HITLD-536). Dyno runs no command on completion.
- **HITLD's machine-wide lock guards only HITLD's own processes** (its executors' heavy steps and the merge queue). It no longer tries to represent a measurement, a target machine or a farm.
- **Still to design:** the shape of the status and the completion record (dyno proposes them), how HITLD's load gate reads the status, and the rule for tool adapters in HITLD's guidance (an adapter's configuration names no code to run except in a property HITLD marks as executing and the owner approves).

## Noted on 2026-11-20 (the classification walk-through, HITLD-632 to 635)

A result's label is the `classification` field holding an object with two keys: `readers` (public, any-model, approved-models, local-model-only, tools-only, owner-only) and `reach` (this-machine, synced-store, bucket-client-encrypted, bucket-provider-managed, anywhere), and a registered place for a bucket. A result starts local-model-only and this-machine-only until the bucket dyno owns is registered. Dyno's result output should use this shape; dyno's first example JSON is checked against it.

## Decided on 2026-11-20 (HITLD-641): what HITLD may start without asking, at first

The owner decided that HITLD starts without asking only the measurements an executor needs for its own item, within a per-item cap on how many. Scheduled baselines on the main branch, and a search for the commit a regression came in, ask the owner first, until the trust engine (HITLD-552) has enough evidence to propose unlocking each kind (merging's unlock bar is the model). So measurement kinds register on the trust engine as separate kinds of decision: an executor's own-item measurement (starts), a baseline (asks), a regression search (asks). The cap, and who is told when a start is refused or queued, are still to settle.


## Dyno's second reply on GitHub issue 363, 2026-11-21 (the interface is built)

Dyno's command line is built with the proposed interface, and its session replied with example JSON from the simulated target. Every command prints one object with `api_version`, `command` and `ok`; exit codes are 0 ok, 1 problem, 2 usage, 3 not built yet (naming the item that builds it) and 4 refused. Commands not built yet: fetching and storing results across machines, pinning, studies, devices and runners; compare, trend and bisect are proposed as an item of their own. Its local measurement worker has run only with a stand-in command, so the first real measurement may change the details.

What the examples settle, and what they open, for the walk-through (checked against the decisions above):

- **Completion record: matches the decision.** One line of an event log (`measurement-finished`, with handle, state, requester, times, run ID, verdict, exit code and a `result_command`), and the same object is the `completion` field of `measure status`. Nothing runs on completion. Open: the log's location is a placeholder for dyno's own state folder, so how HITLD finds and watches it is still to design.
- **The status call does not match the three states HITLD decided on (HITLD-624).** Dyno's `state` is only about dyno's own measurements (`busy`, `waiting-for-quiet`, `quiet`). The machine's load, power, thermal state and `quiet_enough` are reported separately under `machine`, and `state` can say `quiet` while `quiet_enough` is false (seen in its own build, at about one load per core with nothing measuring). So a gate on `state` alone would let HITLD's heavy steps start on a loaded machine. HITLD's gate must read both fields, or keep its own load check. This is a question for the walk-through, not yet decided.
- **No classification label in `result show`.** HITLD asked that every result carry one (readers and reach, HITLD-632 to 635). The example has no `classification` field, and `values_included: false` is the only protection shown. To ask dyno when the label design is walked through.
- **The quiet level is a guess:** load per core below 0.3, overridable; other GPU use is reported as "not measured"; thermal and power come from the operating system and are `unknown` where it does not report them, and they do not block.
- **Smaller points:** one `api_version` for all commands (adding a field keeps it); the simulated target advances on calls, not on time, so tests are deterministic; plain `status` does not advance it.

HITLD has not replied on the issue yet.
