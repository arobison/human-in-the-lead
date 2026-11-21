---
id: HITLD-656
title: Changed-file names are read from git in a form that keeps every name intact
kind: work
state: planned
created: 2026-11-20
project: HITLD-15
---

## Why

Several places read the names of changed files from git without `-z`, so git quotes names that hold non-ASCII or line-break characters (for example `"secrets/\303\251"`) and prefix globs miss them. Found while fixing HITLD-654 (the glob matcher), which is a different cause: this one is git's output format, not the matcher.

- `changedOnBranch` in `core/lib/merge/owner.mjs` (`git diff --name-only`) feeds the owner gate in the local owner-mode listing and the presentation to the owner. With this repository's `owner_paths` it over-holds (fails closed); with a prefix glob such as a secrets prefix it fails open.
- `missingReleaseNote` in `core/lib/dispatch/release-note.mjs` (`git diff --name-only`, against `public_globs`) fails open: no release note is asked for.
- `core/lib/dispatch/touches.mjs` (`git log --name-only`, against touches).
- `readCommits` in `core/lib/guard/public-check.mjs` (`git log --raw` without `-z`) and its fallbacks (`diff-tree --name-only`, `ls-tree --name-only`).
- The conflict listings at `core/lib/merge/queue.mjs:413` and `core/lib/merge/pull-request.mjs:624` (`--diff-filter=U`) have the same defect but fail closed: a quoted name misses the generated globs, so the branch is sent back.

Already correct: `changedFiles` in `pull-request.mjs` (`--raw -z`), `queue.mjs` (`--name-status -z`), and `core/lib/guard/classification.mjs` (`--raw -z`, `ls-files -z`).

## Done when

- Every place above reads names with `-z` (or `core.quotePath=false` together with `-z`) and splits on NUL, so a name with non-ASCII or line-break characters reaches the matcher exactly as git holds it.
- Each place has a test with such a name showing the same decision as for a plain name (the owner gate with a prefix glob, the release-note check against `public_globs`, the touches check, and the public-text guard's commit read).
- A single shared helper reads changed names, and a test (or the code layout) shows no remaining caller uses `--name-only` or `--raw` without `-z` for a name that reaches a glob.

## Notes

- Do after HITLD-654 (the matcher) is merged. A change outside the first place is an owner-gate or confidentiality-check failure mode, so it needs the owner's yes.
