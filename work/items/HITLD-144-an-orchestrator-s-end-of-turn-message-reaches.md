---
id: HITLD-144
title: An orchestrator's end-of-turn message reaches the chief of staff in a cloud session
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

The chief-of-staff skill says that on the web, when an orchestrator's turn ends, its message to the chief of staff arrives. In the first self-hosted run it did not. The chief of staff received messages only when the orchestrator sent one with `send_message`. Each end-of-turn message, including a blocked executor report and a request for a decision, sat in the orchestrator's turn result, unseen, until the owner asked why the orchestrator was waiting. The orchestrator also ended turns asking the owner for input, although the owner talks only to the chief of staff and to interactive sessions.

## Done when

- The orchestrate skill tells an orchestrator started by a chief of staff to send its end-of-turn message with the harness's message tool, to the chief of staff's session ID given in its prompt, at the end of every turn. A turn that sends none is a defect the watchdog can see.
- The chief-of-staff skill's start prompt says the owner is not present, that the orchestrator decides operational calls itself and records them with `hitld rights log`, and that only real owner decisions go in `questions`.
- `hitld dispatch watch` (or `run status`) reports an orchestrator whose last turn ended with no message to the chief of staff, so the hourly check-in finds a stalled one without the owner asking.
- The skills' harness table says what actually delivers a turn's end on the web, and what does not.
- A test finds out whether a Stop hook in a cloud session can block the end of a turn until the message to the chief of staff has been sent, and whether any command a hook runs can send a message to another session. The result is recorded here, and a hook is added only if it works; the skill and the watchdog remain the fallback.
- Tests or an eval scenario cover an orchestrator that ends a turn without sending, and one that asks the owner a question it should have decided.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. HITLD-86 (done) defines the chief of staff and the wake sources; this fixes how the end-of-turn message arrives in the cloud mapping. HITLD-109 needs this, since self-hosting runs this way from its first day.
