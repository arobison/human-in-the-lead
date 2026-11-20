---
id: HITLD-620
title: "Design the classification taxonomy: who and what may read a piece of data, and where it may go"
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
---

## Done when

- The owner has walked through the taxonomy one question at a time, and each answer is recorded as a decision.
- The design parts (3 and 10.3) define the taxonomy, how each piece of data gets a label, and what enforces it, and mark what is built and what is not.
- Build items are filed from the decisions, each with its own done-when.
- `hitld work check` passes.

## Why

The design has four levels (public, internal, confidential, secret; design 3 and 10.3). They answer where data may be stored, and say that confidential data is never sent to a third-party service without the owner's decision and that secrets are never in any agent context. They do not separate the questions the owner raised on 2026-11-20 for the first outside consumer's benchmark results (HITLD-609, HITLD-617): may it go to a remote language model, only to a local one, to no agent at all, and may it leave the machine it was produced on?

## What the design has to settle

- **Two dimensions, not one ladder.** Who or what may read it (the public; any agent including a remote model; a local model only; no model, tools only; nobody but the owner) and where it may go (anywhere; the synced private store; this machine only). The two are partly independent: data may be readable by a local agent yet never leave the machine, or may sync between the owner's machines yet never be read by any agent. A partial order, as with supervision modes in the trust engine (HITLD-527), not a ladder.
- **How the existing four levels map** onto it, and whether they stay as named shorthands (public, internal, confidential, secret) for the common combinations.
- **What carries a label:** an entity, a file, a data area in a store (HITLD-609's results), a tool's output, an event in the ledger; and the default for data with no label (the strictest, or the level of its source).
- **Enforcement:** where the check runs (a hook on what a session reads, the guard that checks public text, the channel's cap on what it may carry, the model adapter before a prompt is built), and that it fails closed. A label on a result decides which model channels may receive it, which ties to the multi-provider design (HITLD-616).
- **Who may change a label:** lowering one (making results public someday) is the owner's decision, recorded and signed; raising one is something the system may do by itself.
- **Combining:** what a summary or a verdict derived from labeled data is labeled; whether a reference such as an ID or a headline carries a lower label than the value it points to.
- **Agents and role:** whether a role (an executor, an orchestrator, the curator) may be given standing access to a label for its job, and how that is recorded.

## Notes

Design-heavy: stays `proposed` and is walked through with the owner before any build. Related: HITLD-609 (the measurement-tool design that raised it), HITLD-617 and 619, HITLD-616 (executors on other providers and local models), HITLD-64 (safe to publish), HITLD-69 (injection contained), design parts 3, 10.3 and the guard's classification check. Placed under HITLD-567 clause c2 (rc.5) on the owner's decision HITLD-621, moved from HITLD-64 clause c2 (v0.1.0): it has to be settled before the measurement-tool design (HITLD-609) is built on, and HITLD-609 needs it.
