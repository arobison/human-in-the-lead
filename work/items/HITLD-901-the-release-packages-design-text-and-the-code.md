---
id: HITLD-901
title: The release packages design text and the code agree, with the owner deciding each row where they differ
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---

## Why

Design 03 (release trains) and part 16.5, as the curator wrote them in PR 521, and the code from PR 527 disagree: the version key (`version_from` vs `version_source`, JSON files only), default channels (`rc` alone vs `alpha, beta, rc`), the record path and field names, how a dependency's pin is read, the train and migration commands (`--item` vs `--train`; `work migrate` vs `release migrate --apply`), a migration step that adds `package: main` to milestones and release items, and a derived `packages` field. The design still reads 'decided, not built'. Groups and trains are also refused on the release pull-request path, so 'one owner approval' works only for a person at a terminal who can push tags.

## Done when

- For each row that differs, the owner decides whether the design or the code changes, one at a time, and each choice is a decision.
- The design text and the code then agree, and the design says what is built.
- The release pull-request path either supports groups and trains or the design says it does not.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable independent read of the delegated merges (2026-11-22), finding R3; decision HITLD-897. Joins Consumer live (HITLD-67) clause c2 as a recorded exception to the freeze: it is a defect in the release path rc.2 depends on, and it should land before the owner applies `release migrate` (HITLD-854).
