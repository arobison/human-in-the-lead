---
id: HITLD-134
title: Choices the owner makes in conversation are recorded as decisions
kind: work
state: done
created: 2026-11-15
project: HITLD-15
constraint_of: [HITLD-67 c3]
claimed_by: D-6
release_note: "`hitld rights record` files a choice the owner made in conversation as a decision."
---

## Why

Most of the owner's choices in a long session came through the harness's question tool or chat, and the orchestrator wrote decision items for some of them by hand; none went through `hitld rights ask` and `answer`. The trust record, the attention telemetry and the rubber-stamp indicator never saw dozens of the owner's answers, which is the evidence the attention budget learns from. The owner decided this lands before self-hosting.

## Done when

- `hitld rights record` files a decision and its answer in one step, from the owner's own turn only (the same guards as `rights answer`): the question, the options with the recommendation, the option picked or the owner's words, the check code of what was shown, and how it arrived (`question-tool` or `chat`). It writes the tracker item, the ask record, the ledger's `asked` and `answered` events and the trust event, as a normal ask and answer would.
- The orchestrate and chief-of-staff skills require it for every choice the owner makes: placements, names, scope, design questions, delegations. A choice that changes the tracker or a design is recorded before the change is made.
- Questions asked and answered this way count in the attention budget and in the measures like any other.
- Tests cover a choice through the question tool, one in chat, and a refusal outside the owner's turn.
- `npm run check`, the offline eval gate and `hitld work check` pass.
