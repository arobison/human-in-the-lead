---
id: HITLD-182
title: The chief of staff reads its notifications between tool calls, so a long task does not hold up the run
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

The chief of staff learns of events (an orchestrator's message, a failed CI check, a finished executor) from notifications that are delivered when a turn starts and queue unread while a long run of tool calls goes on. In the first self-hosted run an orchestrator's message waited 7 minutes and another 18, a CI-failure wake waited 5 minutes on the pull request the owner was about to be asked to merge, and a relay in one of those messages was dropped, so an executor sat idle. The owner called this friction. The chief-of-staff skill says what to do on a wake and nothing about reading notifications during a long task.

## Done when

- The chief-of-staff skill says that during any task of more than a few tool calls, the chief of staff reads its notifications between tool calls, and acts on what they hold (a failed check, an orchestrator message, a relay, an owner message) before it carries on with the task.
- Where the harness gives no way to read notifications mid-task, the skill says to end the task at a clean point and say so, so that the queue is read.
- `hitld dispatch watch` or the digest reports an orchestrator message or a CI event that has waited longer than a set time without being acted on, so a lag is found without the owner asking.
- An offline eval scenario runs a long task with an orchestrator message and a failed check queued behind it, and checks both are acted on before the task finishes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the chief of staff in the first self-hosted run and raised under the owner's instruction that problems it meets are checked against the tracker and filed (HITLD-181). It is related to HITLD-154 (a sensor for the owner's waiting), HITLD-144 (the orchestrator's end-of-turn message reaches the chief of staff) and HITLD-180 (numbered relays).

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (508): notifications polling. The decisions since then are stay in the harness and answers by proof (HITLD-540, 515). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
