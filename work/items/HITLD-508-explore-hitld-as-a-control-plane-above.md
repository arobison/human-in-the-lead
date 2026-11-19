---
id: HITLD-508
title: "Explore HITLd as a control plane above harnesses: where the owner interacts, where durable state and loops live, and mixing executors, harnesses and providers (including local models)"
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
---

## Done when

- A study, written up as a design note and walked through with the owner one question at a time, answers whether and how HITLd should become a control plane above harnesses instead of an application that runs inside one. The note covers at least:
  - **Where the owner interacts.** Today the owner talks to the chief of staff, a skill running inside one harness, and decisions arrive as that harness's question boxes. What the owner's surface should be when HITLd is a meta-harness: Claude Code as one client among several (a web page, a command line, chat or mobile clients), and what stays conversational.
  - **Where durable state and loops live.** The planner, ledger, quota gate, merge queue, trust record and scheduled loops, today spread across disposable sessions. The options: keep them in sessions (as built), move them into one durable service the sessions call, or a hybrid in which the chief of staff stays a conversational session and the loops move out. What each costs in hosting, secrets and the store key (HITLD-333), and what it removes (polling check-ins, hand-over, dropped question boxes).
  - **Who runs the chief of staff's own agent loop.** On any harness or through an API, or HITLd builds its own loop and becomes a harness. The note recommends one, with the trade-offs.
  - **Mixing executors, harnesses and providers.** A model of each executor's capability, cost, quota and context limit (HITLD-418 starts the quota side); a routing policy by tier, risk and data classification, including sending confidential work to a locally run model and other work to cloud services; verification that does not depend on the executor (CI, measured tokens as HITLD-438 does); and trust per executor and kind of work (HITLD-507).
  - **What the owner would lose and keep from a harness:** the browser, the file viewer and editor, the permission model, the apps and mobile reach, and how much of that a meta-harness can borrow by treating the harness as a client.
  - **Sequencing against v0.1.0:** what, if anything, belongs before it (probably nothing but the interfaces), and the smallest first step.
- The owner decides the direction in the walk-through; the design is updated (parts 13, 15 and 22) and the items that build it are filed, each placed under a milestone.
- `hitld work check` passes.

## Why

The owner asked on 2026-11-19 whether running HITLd from inside a harness like Claude Code is the best experience, given that HITLd is designed as a layer on top of this or other harnesses, possibly several at once, matching harnesses, executors and models from different providers, with some work going to local models and some to cloud services. The design is portable at the execution layer (the core never calls a harness; harness adapters; design part 15) but the control layer, the chief of staff and the owner's decisions, runs in one harness. This run showed the cost: question boxes dropped on worker restarts about six times in one day, the GitHub tools disconnected and reconnected repeatedly, and every wait was a poll (dozens of hourly check-ins that found nothing) because a session cannot be woken by an event except through its harness.

## Notes

Design-heavy: stays proposed and is walked through with the owner. This is exploration, not a build, and it should not delay v0.1.0. Related: HITLD-405 c4 (the harness table covers the Claude desktop app), HITLD-165, HITLD-418 (how usage limits are reported and gated on different plans), HITLD-470 and HITLD-492 (no run object; the ledger and tracker carry continuity), HITLD-441 (deferral and emergent escalations), HITLD-507 (a general trust engine), HITLD-333 (the store key), HITLD-448 (the dashboard as the owner's view), HITLD-89 (event-driven cadences), HITLD-96 (a hosted tracker), HITLD-493 (the audit of defaults).
