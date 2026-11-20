---
id: HITLD-147
title: Orchestrators enforce that every executor reports up the chain before its turn ends
kind: work
state: done
created: 2026-11-16
project: HITLD-15
claimed_by: D-41
release_note: An interactive executor's brief now ends with a communication block naming the orchestrator's session, and the executor sends its report there at the end of every turn; `hitld dispatch start` refuses one it cannot address (`no-report-block`), and `hitld dispatch watch --ended <sessions>` lists a session that ended with no report under `unreported`, to chase.
---

## Why

In the first self-hosted run, two interactive tier-3 executors finished and ended their turns without sending anything. Their reports reached the chief of staff only because the owner saw the sessions finish. The briefs told them their final message would be relayed, which is not how a cloud harness delivers a turn's end. An orchestrator that depends on a report it is never sent waits forever, and the item sits in flight. The owner's rule is that an executor never ends a turn without passing a message up the chain, and that the orchestrator makes sure of it every time, not only when someone remembers to write it in.

## Done when

- `hitld dispatch` writes the communication block into every executor brief it generates for an interactive session or any executor outside the orchestrator's machine. The block names the orchestrator's own session ID, the one its commands already use as the session (`--session`, `$HITLD_SESSION` or the harness's session ID), not a value read from run state, so no one pastes it by hand: the executor's last act of every turn is to send its report in the fixed shape, or its exact blocker, to the orchestrator, even when nothing changed.
- `dispatch start` refuses to start such an executor whose brief lacks the block, with a named reason.
- The execute skill and the report section of the executor contract say the same, and the plugin copies match.
- `hitld dispatch watch` reports an interactive executor whose session the harness shows as ended or idle while its dispatch has no completed report, with the next step: the chief of staff reads its final state and relays it, or pokes it to send the report. The orchestrate skill says a dispatch in that state is chased, not waited on.
- No hook is installed by this item. HITLD-144's test showed a Stop hook can block the end of a turn, and the owner decided the watchdog ships first and the hook is its own item (HITLD-238; the hook item is HITLD-240, proposed, and needs a design walk-through first). Until that item is built, the brief block, the start refusal and the watch are the enforcement.
- Tests cover a brief with the block, a start refused for a brief without it, and a dispatch whose session ended with no report. `npm run check`, the offline eval gate and `hitld work check` pass.

## Settled by the owner

On 2026-11-16, in the chief of staff session, the owner decided how an orchestrator makes sure every executor reports (HITLD-161): the generated block, enforced at start, and watched. `hitld dispatch` writes the communication block into every brief itself, `dispatch start` refuses a brief without it, and `dispatch watch` flags an executor whose session ended with no report. A Stop hook is added later only if HITLD-144's test shows it works.

## Notes

Raised by the owner in the chief of staff session. HITLD-136 also changes what the brief says, so build the two in order or in one wave with care. HITLD-144 covers the orchestrator's message to the chief of staff and the Stop-hook test. The watchdog from HITLD-92 catches a stalled executor, and this adds the one that finished without reporting.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (470/492,508): run state harness reference, executor report chain. The decisions since then are the trust engine decisions (HITLD-518 to 529, 547, 548; builds HITLD-552 to 556); the ledger and no-run decisions (HITLD-484 to 490); stay in the harness and answers by proof (HITLD-540, 515). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.

## Reworded on 2026-11-20 (plan audit)

The goal and the owner's choice (HITLD-161: the generated block, enforced at start, and watched) stand. Two lines of Done when described the old design and changed:

- **Where the orchestrator's session ID comes from (HITLD-484, HITLD-492).** The first line said the block names the orchestrator's session by its harness reference "from the run state". The owner decided there is no run object (HITLD-484), so the run state is not a source to build on. The block now names the orchestrator's own session ID, as HITLD-161 words it, taken from the session identity the orchestrator's commands already use. Nothing else in the line changed.
- **The Stop hook (HITLD-238, HITLD-240).** The fifth line said the hook is installed once HITLD-144's test shows a Stop hook can block the end of a turn. That test is done and shows it can, but the owner decided at the time that no hook ships with the watchdog and that the hook is a separate proposed item (HITLD-238, HITLD-240). Read literally, the old line would have a builder install the hook now. It now says this item installs none.

Checked and unchanged: stay in the harness (HITLD-540) keeps the harness's message tool as the way a report travels. The trust-engine decisions (HITLD-518 to HITLD-529, HITLD-547, HITLD-548) and the answer-proof decisions (HITLD-515 to HITLD-517) do not touch what this item builds. The decision that a rule an executor could break by accident is enforced by a hook (HITLD-537) points toward the hook item for later and does not change what this item builds.
