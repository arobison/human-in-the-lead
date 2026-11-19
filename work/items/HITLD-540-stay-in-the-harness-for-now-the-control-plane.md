---
id: HITLD-540
title: Stay in the harness for now; the control plane is a later milestone
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: That sounds like overkill right now. Turning it into a real control plane seems like a much later milestone, so probably stay in the harness and fix the problems for now.
answered_at: 2026-11-19T23:30:15.829Z
answered_via: question-tool
answered_by: owner
---

## Question

How far should HITLd move out of the harness session into a service of its own?

HITLD-508 asked whether the control layer should leave the harness session. The failures this session: dropped question boxes on worker restarts, tool disconnects, and polling waits. A service would need to be reachable from cloud sessions, which are outbound-only containers behind an allowlisted proxy, so it would be a public host with per-session credentials.

## Options and recommendation

- A. A thin service for durable state and wake-ups: A small service owns open questions, events and wake-ups; the chief of staff stays a skill in a harness as a client
- B. A full control plane: The service also runs the chief of staff and orchestrators and chooses harnesses, models and providers
- C. Stay in the harness: No service; fix the failures inside the harness

Recommended: A thin service for durable state and wake-ups. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
