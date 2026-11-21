---
id: HITLD-654
title: A path with a line break in its name no longer slips past every glob that ends in **
kind: work
state: planned
created: 2026-11-20
project: HITLD-15
---

## Why

The glob matcher in `core/lib/precedent/glob.mjs` compiles `**` to a pattern that does not match a carriage return, a line feed, U+2028 or U+2029, so `globMatch('a/**', 'a/\r')` is false while `a/*` is true. A path can legally contain these characters (git forbids only NUL and `/`). Every decision that reads a glob ending in `**` or using `**/` then fails open for such a path:

- the owner gate: with this repository's `owner_paths` (`["**", "!work/**", "work/releases/**"]`), a branch whose only change is a file with a line break in its name does not wait for the owner, and a test glob such as `core/test/**/*.test.mjs` still runs that file;
- the area lookup (the file falls into "unassigned" and `owner_areas` is skipped), `sensitive_globs`, `public_globs`, the commit guard's private-path check, touches and overlap checks, and the adversarial pass's own "due" test.

Found by the adversarial loop (HITLD-32) and confirmed end to end by its independent review. The checks that fail closed (`unless_only`, `!work/**`, `generated`) are unaffected.

## Done when

- `globMatch` matches a path containing CR, LF, U+2028 or U+2029 for every glob a bare `*` matches it for, with a test for each of the four characters and for `**` and `**/`.
- The owner gate, the area lookup, `sensitive_globs`, `public_globs` and the guard's private-path check each have a test with a line-break file name showing the same decision as for a plain name.
- The todo test HITLD-32 commits for this break passes and its todo mark is removed.

## Notes

- Related and separate: `changedOnBranch` in `core/lib/merge/owner.mjs` uses `git diff --name-only` without `-z`, so git quotes non-ASCII and line-break names and prefix globs such as `secrets/**` match nothing. File it as its own item if the review of HITLD-32 confirms it.
- Do first: this is a gate failure on main today. It needs a change to the matcher, not a policy edit.
