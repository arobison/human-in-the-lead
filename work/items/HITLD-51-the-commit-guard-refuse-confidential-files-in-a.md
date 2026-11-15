---
id: HITLD-51
title: "The commit guard: refuse confidential files in a public repository"
kind: work
state: done
created: 2026-11-14
project: HITLD-15
claimed_by: claude/HITLD-51-commit-guard
release_note: "The commit guard refuses files above the repository's classification ceiling, at commit, at merge and in `hitld work check` (`hitld check classification`, policy `project.private_paths`)."
---

## Why

check 5 of One signal end to end (part 21) and part 10 promise that a commit adding a confidential file to a public repository is refused. Nothing builds it yet, and this repository is about to be public. Classification lives in front matter and in the private store's rules (part 10).

## Done when

- A commit (pre-commit hook installed by `hitld install`, and the same check at merge in either mode) that adds or changes a file whose classification is above the repository's ceiling is refused, with the file and the rule named.
- Files with no classification follow the project's default (part 3), and the repository's ceiling comes from policy.
- `hitld work check` runs the same rule over the whole tree.
- Tests and the offline eval scenario for check 5 of One signal end to end pass; part 21 says it is built.


