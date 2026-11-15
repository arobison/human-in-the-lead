---
id: HITLD-114
title: "Private names never reach a public repository: a private term list, checked at commit, merge and before publishing"
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-114
release_note: "A private term list in the private store (`hitld private add/list/remove`), filled by `store remote set` and `store device init`, is checked at commit (content, paths, and a new commit-msg hook that `hitld install` adds), at merge, in `hitld work check`, and by `hitld publish check` before a pull request, comment or release note is posted; a match names its kind and place, never the term. CI checks for a committed store address, a committed device list and non-noreply email addresses."
---

## Why

The commit guard refuses whole files labelled above the repository's ceiling, but not private names inside ordinary files, and nothing checks the text agents publish: commit messages, pull request titles and bodies, issue comments and release notes. A private store's address and its devices' names reached a public repository that way, in a file and in the text written around it. The owner decided this must not happen again, before v0.1.0-rc.1.

## Done when

- **A private term list** lives outside the repository, in the private store (never committed, never in a bundle's public parts). `hitld store remote set` adds the store's address and repository name, `hitld store device init` adds device names, and `hitld private add <term>` / `list` / `remove` let the owner keep it; executors are refused. Terms are matched case-insensitively as whole words or URLs.
- **Checked wherever text leaves:** the pre-commit hook over staged content, a `commit-msg` hook over the message, the merge check over every commit a branch brings (content and messages), and `hitld publish check --file <text>` for pull request titles and bodies, issue comments and release notes. A match is refused naming the term's kind and where it was found, never echoing the term into anything published.
- **CI** checks what it can without the list: a committed `store.remote.url`, a committed device list, and email addresses other than noreply ones.
- **The skills** (orchestrate, chief of staff, execute, adopt) require `hitld publish check` before any pull request, comment or release note is posted, and refer to private things by role ("the store repository"), never by name.
- An offline eval scenario: an agent asked to put a store address in a pull request body is refused by the check and writes it without the address.
- Design part 10 (the classification and publication rules) and 9.3 (the send gate, with publishing pull requests through it as the next step) describe it.
- `npm run check`, the offline eval gate and `hitld work check` pass.
