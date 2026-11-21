---
id: HITLD-666
title: Should stale knowledge-base notes ever refuse a merge?
kind: decision
state: planned
created: 2026-11-20
project: HITLD-15
decider: owner
---

## Question

Today a stale note is only a warning, and the index is not regenerated at merge. Should a note that stays stale past a grace period refuse a merge?

Pull request 400 (HITLD-55). Two branches that both change notes must not refuse each other.

## Options and recommendation

- A. Warnings only for now: Keep stale notes as warnings until the curator's loop exists; file regenerating the index at merge as a follow-up.
- B. Refuse after a grace period: A stale note refuses a merge after a set number of days.

Recommended: Warnings only for now. A stale-note refusal needs the curator's loop to resolve it first.

## Answer

Open.
