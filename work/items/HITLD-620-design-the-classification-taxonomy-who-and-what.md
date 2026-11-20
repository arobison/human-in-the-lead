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

## Noted on 2026-11-20 (HITLD-623)

Benchmark results will live in a bucket owned by dyno, not in the sealed private store, so the taxonomy has to say what a label means for each storage backend (the sealed store and a bucket with its own protection), not only which channels may carry the data.

## Walk-through on 2026-11-20: what the owner decided so far

The owner walked through the first questions one at a time. Each is a recorded decision:

- **Structure (HITLD-625):** labels on data plus clearances on channels, in two dimensions, with default deny, an explicit deny winning, and owner-level guardrails that can only narrow. Borrowed from lattice labels and from cloud permission systems (resource tags matched by conditions, organization policies that cap grants, perimeters that stop data leaving); their policy language is not borrowed.
- **What carries a label and the default (HITLD-626):** entities, files, data areas, tool outputs and ledger events can carry a label. Unlabeled data takes its container's label; with no container, the strictest: nobody but the owner, this machine only.
- **Who changes a label (HITLD-627):** any agent or the system may tighten one; only the owner may loosen one, as a signed, recorded decision with a reason.
- **Derived data (HITLD-628):** a verdict, summary, headline or result ID takes the strictest label of its inputs, unless the owner lowers a named kind of derived data by a signed decision. Nothing is lowered by default.
- **Enforcement (HITLD-629):** at the commands and tools that return data (HITLD's commands, dyno's result commands, a hook on file reads), which check the label against the clearance of the model the session runs on before returning labeled data, and fail closed. The public-text check stays. The limit: it cannot stop a person pasting data into a prompt, or a tool that bypasses these commands.
- **Default clearances (HITLD-630):** the remote model on the owner's own account is cleared for public, internal and confidential data, but not for secret data or labels that say no remote model or owner only; a local model is cleared for anything except owner only; any other provider needs the owner's decision.
- **Vocabulary (HITLD-631):** explicit, with no shorthands, because agents mostly use labels and the owner will not remember what a shorthand means. Who may read: public; any model (including a remote model on the owner's account); local model only; tools only (no model sees it); owner only. The widest place it may reach: this machine only; the owner's synced private store; a private bucket with client-side encryption; a private bucket with provider-managed encryption; anywhere. The owner registers concrete places (this machine, the store, the bucket dyno owns) under a class. Benchmark results start as local model only and this machine only until the bucket is registered.

## Still to settle in the walk-through

- Whether a role (an executor, an orchestrator, the curator) may hold a standing clearance for its job beyond its model's, and how that is recorded.
- How a label is written in a file and in a command's JSON (two explicit fields, their names, and how a place class is registered), and what dyno's result label looks like so the two agree.
- The one-time move of today's four level names (public, internal, confidential, secret) on existing entities to explicit labels, through the tracker's migration mechanism, after which the old names are retired.
- What a clearance is for a tool, for the synced store's sealing, and for a bucket, so the same rule decides every channel.
- Build items, filed from the decisions, each with its own done-when.

