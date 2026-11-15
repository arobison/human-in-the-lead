---
id: HITLD-85
title: "Attention telemetry: asked and answered events, open decisions in run state, logged calls, trust signals for rubber stamps"
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-85
release_note: "`rights ask`, `rights show` and `rights answer` write `asked`, `sent` and `answered` ledger events; `hitld rights log` and `rights reverse` record and undo logged calls; `hitld rights trust` and the digest show a rubber-stamp indicator per area (`trust.rubber_stamp_seconds`)."
---

## Why

The owner's time is not measured. `rights ask` and `rights answer` write no ledger events, so decision latency is always empty and a hand-over reports no open questions while decisions wait. The orchestrator's logged calls, the safety valve that justifies not asking, live only in its context. Nothing records whether the owner took the recommendation or how fast, which is the cheapest rubber-stamp detector.

## Done when

- `rights ask` and `rights answer` write `asked` and `answered` ledger events, and showing a question writes `sent`, so queue time and owner time are measured separately (design 11).
- Run state lists open decisions from the ledger, and the hand-over shows them.
- Each logged call is a ledger event (dispatch, item, text) and the digest lists them with a way to reverse each one.
- The answered trust event records whether the owner took the recommendation and the latency; each question offers an optional "worth asking?" tap; "that was not worth asking" right after an answer is recorded as a rating of that decision.
- The trust record reports a rubber-stamp indicator per area (share of answers that took the recommendation quickly), and the digest surfaces it.
- Tests cover each event and the indicator.

