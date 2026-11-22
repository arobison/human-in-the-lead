---
id: HITLD-912
title: Version sources move into the ecosystem profile only
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Move version sources into the profile only: One place; needs a migration of existing declarations."
answered_at: 2026-11-22T20:50:44.128Z
answered_via: question-tool
answered_by: owner
---

## Question

How does a release package's version source work (HITLD-883 decision 4 of 12)?

The owner chose the profile-only option over extending version_source in place. Every existing release package declaration must change and a migration is needed.

## Options and recommendation

- A. Move version sources into the profile only: One place; needs a migration of existing declarations.
- B. Extend in place; default from the profile: No migration; two places can name a source.

Recommended: Extend in place; default from the profile. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
