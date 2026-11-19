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

## Added 2026-11-19: the service as the owner's decision and approval surface

The owner said that turning HITLd into a service is a really interesting idea, because it would also let a web interface (and other clients) take the owner's decisions and approvals directly, as an alternative to telling the chief of staff. The owner's comparison is Dyno, the workbench in the Cesium 2.0 WebGPU prototype (the `cesium-webgpu-2.0-poc` branch of the public CesiumJS repository, under `packages/next`): a browser app with a rail of views (a Viewer that opens content in one engine at a time, Compare, Trends, Alerts, Images, Analysis) over a command-line runner, where the person sees results and approves or rejects changes (for example approving or rejecting image differences) instead of working in a terminal. The study should treat it as a worked example of a decision surface over a runner and look at how its views, shared state and approve-or-reject flow could carry over. The study should cover, in addition to the points above:

- **A decision and approval surface.** The owner answers decisions, approves merges and commitments (HITLD-472, HITLD-291), and gives input on proposals from a web interface, alongside the chief of staff. Questions are durable and belong to the service, not to a session, so a dropped question box (about a dozen in one stretch of 2026-11-17 to 2026-11-19) cannot lose one.
- **Authority.** Today an approval counts only from the owner's own message, which the harness guarantees. A web surface needs its own proof that an action is the owner's: per-person keys and signed answers (HITLD-409, HITLD-333). Until then, anything written from a web page is data, not an answer.
- **One place, once, counted.** HITLD-407 (the owner answers once, in one place, and it counts) was built on the chief of staff's session being that place; the study says whether the service becomes the place, with the chief of staff as one client.
- **Several humans.** Named contributors and their input recorded under their own names (HITLD-501) fit a service naturally.
- **Safety of what is shown.** Issue bodies, reports and item text on a decision page are untrusted: rendered as inert data, with nothing in them able to act.
- **A cheap first step.** Whether a read-and-propose inbox can be prototyped with the existing published Artifact (shared state, clickable proposals) before anything is built, with the authority question settled before an answer from it counts.

## Decided on 2026-11-19 (HITLD-515)

The authority question is settled for any surface: an answer counts by a checkable proof, not by its channel (HITLD-515). A web page can therefore carry an answer once a proof exists. What this study still decides is whether a service is worth building to host such a surface.

## Decided on 2026-11-19 (HITLD-540)

The owner decided to stay in the harness for now and treat a real control plane as a much later milestone. A service would have to be a public host that cloud sessions call (they are outbound-only containers behind an allowlisted proxy), with per-session credentials; that is overkill today. This item moves from HITLD-405 c4 to the new milestone HITLD-541, which is not under any release stage. The study stays open as exploration, and the in-harness fixes for dropped questions and polling are tracked separately.
