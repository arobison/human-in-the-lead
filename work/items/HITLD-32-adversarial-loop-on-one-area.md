---
id: HITLD-32
title: Adversarial loop on one area
kind: work
state: done
created: 2026-11-14
project: HITLD-28
constraint_of: [HITLD-68 c4]
claimed_by: D-46
---

## Why

Design part 21, One signal end to end.

## Done when

- One area has an invariant registry, and the adversary agent attacks it.
- Every break is committed as a failing regression test with a fix item.
- The adversarial pass runs on every change in that area.
- On a fixture area, all five seeded bugs are found and the three clean controls raise nothing.

## Findings on the core area (2026-11-20)

The pass on the core area broke three invariants, each recorded as regression tests marked todo with their fix items pending:

- `**` does not match across a line break: `globMatch('a/**', 'a/\r')` is false while `a/*` matches. Fixed by HITLD-654; its two regression tests no longer carry todo marks.
- `safePath('./C:x')` returns `C:x`, which it refuses when given directly: the absolute check runs before normalizing. Low impact on POSIX; on Windows, a drive-relative escape.
- An inline list in front matter does not read back. The defect is broader than the recorded counterexamples show: any `"` in the middle of a list member toggles the reader's quoting, so `needs: [a"b, c]` reads back as one member, with no comma inside the member needed.
