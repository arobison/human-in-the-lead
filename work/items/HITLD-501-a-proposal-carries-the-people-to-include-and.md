---
id: HITLD-501
title: A proposal carries the people to include, and the input each gives is recorded under their own name
kind: work
state: proposed
created: 2026-11-18
project: HITLD-53
---

## Done when

- A proposal (a proposed milestone or item, and a walk-through that settles one) carries a list of the people to include: the humans who need to contribute to it, named by the owner or by whoever files the proposal. The list is part of the proposal's record and the dashboard's Proposals view shows it.
- Anyone on the list can add input to a proposal, and each piece of input is recorded under the name of the person who gave it, separate from a decision. Input is never counted as an answer: deciding stays with the decider (the owner today) until HITLD-44 is decided, and a decision records whose input it considered.
- The Proposals view and the chief of staff's walk-throughs show, for each proposal, who was included, who has given input and who has not, so no contributor is left out by default.
- A test covers a proposal with two named contributors, one of whom gives input, and a decision that cites it. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner said on 2026-11-18 that for proposals it is important that the humans who need to contribute are all included, not just the owner. Today a proposal goes to the owner alone: the Proposals view is the owner's queue, walk-throughs are with the owner, and decisions have a single decider. The full design for several humans (HITLD-44, deferred until after v0.1.0 in HITLD-430) is not needed to start: this is the light version the owner chose, which records who is included and what each gives, and leaves who decides to HITLD-44.

## Notes

Design: proposed; the shape of the list, how a contributor gives input (the dashboard, the tracker, a comment) and how it reaches the chief of staff are walked through with the owner. Related: HITLD-44 (how a team shares the loops), HITLD-409 and HITLD-36 (an answer counts only from the person who gave it; per-person keys), HITLD-152 (the Proposals view). Until per-person keys exist, input is recorded by name but not signed. Code and design: the owner's own yes to merge.

## Decided on 2026-11-19 (HITLD-517)

Contributor input counts when a tracker platform authenticated its author (GitHub, Jira, Linear), with each tracker adapter supplying the author (HITLD-96). The contributor list maps platform accounts to people, one entry per platform per person. The text is copied and hashed when recorded, because platforms let authors edit or delete a comment. A comment from an integration or bot account is not a person. On HITLd's own git-file tracker the input comes through the contributor's pull request on the platform, since git commit authors are not authenticated unless signed. Input only: decisions stay the owner's until HITLD-44 says who else decides.
