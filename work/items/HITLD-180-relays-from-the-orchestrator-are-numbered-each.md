---
id: HITLD-180
title: Relays from the orchestrator are numbered, each is confirmed when done, and a dropped one is noticed
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

The orchestrator asks the chief of staff to act on a session it cannot reach, with a `relay:` line in its end-of-turn message (the chief-of-staff skill, Relays). In the first self-hosted run, the orchestrator asked the chief of staff to poke an executor to merge main and rebuild a pull request. The message also carried a merge report, an adoption plan and two questions for the owner. The chief of staff acted on the rest of the message and never sent the relay, so the executor sat idle for about eight minutes until the owner asked about it. Nothing in the message shape or the skills makes a dropped relay visible: a relay is one line among long paragraphs, nothing says it was done, and no one is told when it was not.

## Done when

- The owner decides, in a design walk-through (HITLD-135), one question at a time, and the answers are recorded as decisions before anything is built:
  - Whether each relay is its own numbered line (`relay 1: ...`, `relay 2: ...`), one per action, and whether the message may carry any other action outside the numbered lines.
  - Whether the chief of staff confirms each relay in its next message to the orchestrator (`relayed 1: poked D-7`), and what the orchestrator does when a confirmation is missing after a set time.
  - Whether `hitld dispatch watch` reports a relay that was recorded and has no effect after a set time (a poked executor with no new commits or messages), so a dropped relay is found without the owner asking.
  - Whether the chief of staff's own steps for a wake say to list every relay line in the message first and act on them before anything else.
- The chief-of-staff and orchestrate skills, the message shape and the design say the chosen answer in one change the owner approves, and the plugin copies match.
- A test or eval scenario shows an orchestrator message with two relays and a long report, and checks both are sent and confirmed, and that a dropped relay is reported by the watch.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session, who asked that the fix, numbering the relays, go into a work item. The orchestrator already numbers its relays on the owner's instruction, as a working rule until this is settled. State is `proposed` on the owner's rule that design choices are reviewed with them first. Related: HITLD-144 (the orchestrator's end-of-turn message reaches the chief of staff), HITLD-147 (executors report up the chain) and HITLD-167 (ending finished sessions, which also uses the `relay` line).

