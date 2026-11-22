---
id: HITLD-498
title: The chief of staff learns the owner's local time, zone and quiet hours from hitld, not from its own guess
kind: work
state: proposed
created: 2026-11-18
project: HITLD-15
constraint_of: [HITLD-405 c3]
---

## Done when

- One command answers what the chief of staff needs, for example `hitld attention now`: the owner's local time, the zone, where the zone came from (the person file or the machine's clock), whether quiet hours apply now and until when, and the interrupt budget left today. `hitld run status` and `cadence due` can carry the same block.
- The chief-of-staff skill tells the chief of staff to read that block on every wake and before every message, never to work out quiet hours itself, and to give the owner times in the owner's zone with the zone named.
- The person file says whether the zone follows the device (the default today, unstated) or stays fixed at a home zone; when the device's zone changes, the chief of staff says so in a line. A session that runs elsewhere (a second machine or a cloud session on UTC) uses the person's zone from the shared store, not its own clock.
- Tests cover a person file with no zone, with a fixed zone and a changed device zone. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Reported in GitHub issue #296. The owner travels. The person file set no `attention.timezone`, so hitld used the machine's zone, which had moved. The chief of staff assumed the home zone, judged quiet hours had not started, and put a decision to the owner that hitld had rightly held (it was 00:42 where the owner was). Nothing in the skill says where the owner's zone or quiet hours come from, and no command answers "what time is it for the owner, and are quiet hours on?", so the agent did its own arithmetic from its own assumption. The code falls back to `Intl.DateTimeFormat().resolvedOptions().timeZone` in `core/lib/settings/attention.mjs`.

## Notes

Triaged 2026-11-18: proposed. Related: HITLD-84 (the attention budget's person-file keys and quiet hours), HITLD-162 (where person settings live), HITLD-148 (a cloud session starts with the owner's settings). Skill and code: the owner's own yes to merge.

## Note on 2026-11-20 (reconciliation)

The owner's awake time is what the rung-2 objection window counts (HITLD-523), so the commitment build (HITLD-554) needs this item.
