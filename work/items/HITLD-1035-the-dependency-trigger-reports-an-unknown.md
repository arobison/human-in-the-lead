---
id: HITLD-1035
title: The dependency trigger reports an unknown `extends` profile and a manifest name with a slash, and the store git config tests cover the old-git fallback and a core key that must not cross
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- A project profile whose `extends` names an unknown profile is reported (a warning, or a refusal, the item says which) instead of silently skipped; a test covers it.
- A manifest name containing `/` either matches by path or is refused when the policy is read, and the policy guide says which; a test covers it.
- A test covers the git older than 2.26 fallback in the store's connection-config read (the `--system` and `--global` reads).
- A test shows a `core.*` key in the installation-level or global config does not cross into the store's git; the allow-list stays as it is.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

PR 633 (HITLD-921, the new-dependency trigger reads its manifest and lockfile names from the ecosystem profiles) and PR 634 (HITLD-272, the store's git reads connection keys from every config plain git reads) merged on 2026-11-24 after independent reviews found no blocking issue and these four points; the owner chose to merge and file them. [Certain: the points come from the reviewers' reports.]

## Notes

rc.3 (a proposal for the owner to move). Merge-path and credential areas: the owner's own yes at merge. The store copy's own config applying to the store's git is pre-existing and not part of this item.
