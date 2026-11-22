---
id: HITLD-714
title: safePath refuses a path whose first segment is a drive letter after the path is normalized
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

`safePath` (`core/lib/precedent/glob.mjs`) refuses an absolute path, including a Windows drive such as `C:x`, before it normalizes the path. A path that becomes a drive path only after normalizing is accepted: `safePath('./C:x')` returns `C:x`, which `safePath` refuses when given directly. Given again, the accepted path reads as another path. On Windows that is a drive-relative path that escapes the repository root. The adversarial pass on the core area found it (invariant `safe-path-stays-inside`): the two counterexamples are `./a:` and `.\a:`.

## Done when

- `safePath` refuses a path whose first segment is a drive letter and a colon after normalizing, with the same refusal as `C:x` given directly, for `./C:x`, `.\C:x` and `a/../C:x`.
- A path `safePath` accepts is accepted again, unchanged, when given again.
- The two regression tests under `core/test/adversary/` for `safe-path-stays-inside` pass and lose their todo marks.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the adversarial pass (HITLD-32, PR 397); low impact on POSIX, a drive-relative escape on Windows. The two todo tests name this item once `hitld adversary file --test <test> --fix HITLD-714` runs for each. Code: the owner's own yes to merge. Related: HITLD-654 (the glob break of the same pass, fixed).
