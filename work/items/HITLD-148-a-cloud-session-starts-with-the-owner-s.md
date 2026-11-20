---
id: HITLD-148
title: A cloud session starts with the owner's settings and the machine's profile, with nothing carried between sessions by hand
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-142]
---

## Why

The person file and the machine file live in each container's home directory. A cloud container is discarded when its session ends, so every new session in the first self-hosted run started with neither file. The first-run setup had to be answered again, and the chief of staff carried the owner's answers to the orchestrator by hand. The milestone's first clause forbids carrying anything between sessions by hand.

## Done when

- A cloud session in an enrolled environment starts with the owner's person settings (caps, reserve, declared limits, attention budget and quiet hours) read from the project's own private store (each project has its own, HITLD-490), so it asks for nothing the owner already answered. What it reads names no other project: no other project's store address and no share set against another project (HITLD-549).
- The machine file is recorded at session start from the probe, as it already is for a cloud VM, and the owner's answers about the machine are kept in the store, not asked again.
- The orchestrator acts on the chief of staff's wake message that the owner said to go on without the store only when the owner's word is in a record it can read from the store (HITLD-174). That record is an answer record that carries its proof (HITLD-515): the answer record is built by HITLD-564, and which key signs waits for the store migration design (HITLD-516), so this item does not make up a record or a proof kind of its own. Until such a record exists the rule in the skills stays as HITLD-142 left it, and nothing stalls on this decision.
- The first-run setup asks only for what is missing, and says what it took from the store.
- When the store cannot be reached at session start, the session runs on the conservative defaults (one executor, the default reserve, no declared limits), says what it could not read and why, and asks nothing the store would have answered once it is reachable. The owner can say in their own message to go on.
- A change to the person file is made only in the owner's own turn, and reaches the store through `hitld store push`. An executor cannot change it.
- Tests cover a fresh container with the store, one without it (the setup runs as today), and a stale copy. `npm run check`, the offline eval gate and `hitld work check` pass.

## Settled by the owner

On 2026-11-16, in the chief of staff session, the owner decided two choices in this item:

- **Where the settings live (HITLD-162):** in the private store, synced. The person file travels with the store and any enrolled session reads it at start.
- **When the store cannot be reached (HITLD-163):** conservative defaults, and say so: one executor, the default reserve and no declared limits, as setup-not-done behaves today. The session says what it could not read and why, and the owner can say to go on or fix the store.

## Notes

Raised in the chief of staff session, where each new container needed the same setup carried in a message. HITLD-142 gets the store reachable from an orchestrator; this item puts the person and machine settings in it. HITLD-39 and HITLD-88 (done) built the walk-through this builds on.

The executor cap is a person setting, not a project one (the owner, 2026-11-16, HITLD-230): the settings a cloud session starts with include it, and HITLD-204 removes the project layer for it.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (333,508,470): settings in private store; store enrollment. The decisions since then are the trust engine decisions (HITLD-518 to 529, 547, 548; builds HITLD-552 to 556); the ledger and no-run decisions (HITLD-484 to 490); stay in the harness and answers by proof (HITLD-540, 515); answers, proof and contributors (HITLD-515 to 517). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.

## Reworded on 2026-11-20 (plan audit)

The goal and the owner's two choices stand (HITLD-162: the settings live in the private store, synced; HITLD-163: conservative defaults when the store cannot be reached). Two lines of Done when changed to match later decisions:

- **Which store, and what travels (HITLD-490, HITLD-549).** The first line said "the private store". The owner decided each project keeps its own private store (HITLD-490) and that projects are blind to each other: no project reads another project's data or learns that another exists (HITLD-549). The line now says the project's own store and says what the session reads names no other project. The listed settings (caps, reserve, declared limits, attention budget, quiet hours) are unchanged. The person file also holds keys that name other projects (store addresses, shares), and those do not travel.
- **The owner's word to go on without the store (HITLD-515, HITLD-516, HITLD-174).** The third line said the orchestrator acts on the owner's word only when it is "in a record it can read". The owner decided an answer counts by a checkable proof carried in one answer record, with the harness-attested turn as the proof today and the key to be chosen later (HITLD-515, HITLD-516). The record is therefore that answer record (HITLD-564), not one this item invents. The line already said the rule stays as HITLD-142 left it until the record exists, and that still holds.

Checked and unchanged: the ledger and no-run decisions (HITLD-484 to HITLD-490), the trust-engine decisions (HITLD-518 to HITLD-529, HITLD-547, HITLD-548), stay in the harness (HITLD-540) and contributor input (HITLD-517) do not change what this item builds.

For the owner, not decided here: the settings section of the operations design and its question on syncing the person file across machines still say the person file is not synced, which predates HITLD-162. HITLD-162 governs the settings a cloud session needs, so the build updates that design text for the owner's yes to merge. The same section says whether a person-level ceiling on executors across projects stays is not decided; the cap here stays as HITLD-230 set it.
