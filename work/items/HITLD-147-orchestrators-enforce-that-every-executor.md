---
id: HITLD-147
title: Orchestrators enforce that every executor reports up the chain before its turn ends
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

In the first self-hosted run, two interactive tier-3 executors finished and ended their turns without sending anything. Their reports reached the chief of staff only because the owner saw the sessions finish. The briefs told them their final message would be relayed, which is not how a cloud harness delivers a turn's end. An orchestrator that depends on a report it is never sent waits forever, and the item sits in flight. The owner's rule is that an executor never ends a turn without passing a message up the chain, and that the orchestrator makes sure of it every time, not only when someone remembers to write it in.

## Done when

- `hitld dispatch` writes the communication block into every executor brief it generates for an interactive session or any executor outside the orchestrator's machine. The block names the orchestrator's session by its harness reference from the run state, so no one pastes it by hand: the executor's last act of every turn is to send its report in the fixed shape, or its exact blocker, to the orchestrator, even when nothing changed.
- `dispatch start` refuses to start such an executor whose brief lacks the block, with a named reason.
- The execute skill and the report section of the executor contract say the same, and the plugin copies match.
- `hitld dispatch watch` reports an interactive executor whose session the harness shows as ended or idle while its dispatch has no completed report, with the next step: the chief of staff reads its final state and relays it, or pokes it to send the report. The orchestrate skill says a dispatch in that state is chased, not waited on.
- When HITLD-144's test shows a Stop hook can block the end of a turn, the same hook is installed for executors. Until then, the brief block and the watch are the enforcement.
- Tests cover a brief with the block, a start refused for a brief without it, and a dispatch whose session ended with no report. `npm run check`, the offline eval gate and `hitld work check` pass.

## Settled by the owner

On 2026-11-16, in the chief of staff session, the owner decided how an orchestrator makes sure every executor reports (HITLD-161): the generated block, enforced at start, and watched. `hitld dispatch` writes the communication block into every brief itself, `dispatch start` refuses a brief without it, and `dispatch watch` flags an executor whose session ended with no report. A Stop hook is added later only if HITLD-144's test shows it works.

## Notes

Raised by the owner in the chief of staff session. HITLD-136 also changes what the brief says, so build the two in order or in one wave with care. HITLD-144 covers the orchestrator's message to the chief of staff and the Stop-hook test. The watchdog from HITLD-92 catches a stalled executor, and this adds the one that finished without reporting.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (470/492,508): run state harness reference, executor report chain. The decisions since then are the trust engine decisions (HITLD-518 to 529, 547, 548; builds HITLD-552 to 556); the ledger and no-run decisions (HITLD-484 to 490); stay in the harness and answers by proof (HITLD-540, 515). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
