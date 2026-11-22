---
id: HITLD-762
title: "Release packages: lockstep groups, dependents, trains and pre-release channels"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Lockstep groups: Packages that always share one version."
rationale: Dependents list in release propose, Release trains, Pre-release channels
answered_at: 2026-11-22T02:09:53.478Z
answered_via: question-tool
answered_by: owner
---

## Question

Which additions go into the packages design and the rc.2 build?

The owner said no consuming project has published tags and to aim for the best design now.

## Options and recommendation

- A. Lockstep groups: Packages that always share one version.
- B. Dependents list in release propose: Names every package that depends on a package with a breaking change.
- C. Release trains: One release item that needs several packages' release items.
- D. Pre-release channels: rc, beta, alpha counters per package.

Recommended: Lockstep groups. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
