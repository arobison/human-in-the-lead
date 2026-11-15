---
id: HITLD-86
title: "Chief of staff and disposable orchestrators: rotation, scheduled tasks and events, tier 3 sessions"
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-86
release_note: "A chief of staff skill: the session the owner talks to, which owns scheduled tasks and starts disposable orchestrators. `hitld handover` releases the lease to a successor; `hitld run retire` and `hitld run status` are new; owner-mode merge approval is recorded with `hitld merge approve`. `orchestrator.handover_after_completions` is a new setting."
---

## Why

The orchestrator's context fills, and today the skill hands the owner a note to start a fresh session, against Q10. The owner works from a phone and wants one stable place to talk. Long-running agent systems converge on durable state outside the context, short-lived sessions replaced at a threshold, and a persistent layer that is files, a scheduler and event triggers rather than one long-lived model session.

## Done when

- The chief of staff is the session the owner talks to: it keeps little in context, relays questions, digests and answers, owns the schedule, and starts orchestrator sessions.
- An orchestrator hands over at a context threshold or after a number of completions: it writes the hand-over (`hitld handover`) and the chief of staff starts a successor from it; the owner's conversation does not move.
- Three wake sources reach whichever session holds the run lease: GitHub events, completion notices and scheduled tasks. Only the chief of staff owns scheduled tasks, so a retired session leaves none behind.
- Tier 3 work that needs its own session is started the same way, and the tier comes from sizing, not from who reviews: `owner_review_areas` attaches the review pack without forcing the large model.
- The design (part 13) describes the cloud mapping (session creation, messages between sessions, scheduled tasks) and the local one (scheduled runs, headless resume). An eval scenario kills an orchestrator mid-run and the chief of staff resumes it without the owner.

