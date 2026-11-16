---
id: HITLD-243
title: "Land the Windows pull request: merge main into fix/windows, resolve the conflicts and get its checks green"
kind: work
state: done
created: 2026-11-16
project: HITLD-15
claimed_by: D-21
---

## Why

The owner's first run of hitld on Windows produced PR #186 (branch `fix/windows`, 156 files, +5,928/-1,436): a fixed number of git processes per command, and the test suite passing on Windows (`hitld work claims` from 129 s to 3.0 s; 158 failing tests on Windows to 0). It was opened against an older main. Main has since merged the isolated test home and temp directories (PR #135, #139), the sweep (PR #163), headless dispatch (PR #180) and more, and GitHub marks the pull request as conflicting, with no checks run on it. The owner asked for it to be merged to main first.

A trial merge of main into the branch conflicts in 21 files: `core/lib/cli/commands/ledger.mjs`, `core/lib/machine/detect.mjs`, their plugin copies, and 17 test files and fixtures (`cadence`, `env`, `eval-baselines`, `eval-report`, `eval`, `feedback`, `flake`, `precedent`, `quota`, `rights-hardening`, `run`, `settings`, `store-remote-git`, `store`, `tracker-fixture`, `tracker-git`, `tracker-ids`).

## Done when

- Main is merged into `fix/windows` (a merge commit, never a rebase or a force-push, since it is the owner's branch), with every conflict resolved so that both sides' intent holds: the Windows changes, and main's isolated home (`core/test/helpers`), temp-directory helper and cleanup check. The plugin copies are rebuilt with `npm run build`, not merged by hand.
- No test is skipped, deleted or weakened to resolve a conflict. Where a Windows skip conflicts with main's helpers, both are kept.
- The full CI-like `npm run check` passes on Linux (CI=true GITHUB_ACTIONS=true GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1, HITLD_* unset), and the offline eval gate passes against the committed baseline.
- GitHub's checks on the new head of PR #186 pass, including the six required ones.
- The report lists each conflicted file and how it was resolved, anything on Windows that could not be verified here (the Windows-only tests cannot run on Linux), and the four "Decisions for you" from the pull request body, left untouched.
- Merging PR #186 to main needs the owner's own yes; the executor does not merge it.

## Notes

The owner's instruction, 2026-11-16: land the Windows pull request first, then run the feedback triage. Filed by the chief of staff under HITLD-181. The owner is the author of PR #186, so pushing a merge commit to `fix/windows` is within what they asked for.
