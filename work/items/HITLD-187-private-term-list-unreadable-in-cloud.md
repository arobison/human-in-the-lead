---
id: HITLD-187
title: Verify what the public-text checks do when the private term list cannot be read
kind: work
state: done
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-64 c3]
claimed_by: D-52
release_note: "When the private term list is not there to read, as in a cloud session that has not pulled the store, the commit hooks, the merge, `hitld work check` and `hitld publish check` warn by name that the list was not checked, and `publish check` no longer says the text may be posted."
---

## Why

HITLD-114 keeps the private term list in the private store. A cloud session may lack the store or the key, so the list is unreadable there. If the commit, merge and publish checks then pass with no terms, a private name could reach a public repository from exactly the sessions that publish most. This is unverified: the first step is to find out.

## Done when

- A test reproduces the case (no store, no key, no list) for the commit hook, the merge check, `hitld work check` and `hitld publish check`, and records what each does.
- If any passes silently, it instead refuses or warns by name that the list was not checked, and the run says so.
- The finding is recorded in this item, including when it turns out to be already handled.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Security-relevant. Raised under HITLD-181 from the owner's session review; related to HITLD-114 and HITLD-142.

## Finding (D-52)

The premise held. With no private store, no device key and so no list (the store address in `HITLD_STORE_REMOTE` or not), all four checks passed and said nothing about the list:

| Check | Before | Now |
|---|---|---|
| Commit hooks (`check classification --staged`, `check commit-message`) | Passed; no warning | Pass; a warning in each result, which `git commit` prints |
| The merge (`hitld merge`, either mode) | Checked against the implied terms only; nothing in the result | The same check; the result carries the warning |
| `hitld work check` | Passed; no warning | Passes; the warning is among its warnings |
| `hitld publish check` | "no private term found: it may be posted", or "the list is empty" when no address was set | Exit 0, with the warning and a message that the list was not checked and the text should be posted only once it is checked where the store is |

The warning starts "the private term list was not checked:", says whether there is no store or a store with no list, and whether only the implied terms (the store address in use, device names) or none were checked. It never prints a term or the store's path. A list with every term removed is a list that was read and gives no warning. A list that does not read still refuses (`private-list-invalid`), as before.

Warn, not refuse: a project with no list is a real state (design part 10.3, limits), and a refusal would stop every commit in a cloud executor session and every pull request a cloud chief of staff posts. Whether the merge or `publish check` should refuse when a store address is set but no list is present is left to the owner.

Tests: `core/test/private-terms-missing.test.mjs` (fails 4 of 4 on the code before this change, passes 4 of 4 after). `loadTerms` reports `list_found`, and `hitld merge` adds the warnings it notes to its result.

## Review fixes (D-52)

An independent review found further silent passes, and the skills told agents to post on `ok` alone. Fixed:

- `publish check` reports `list_found`. The orchestrate, chief-of-staff and adopt skills post only when the check is `ok` and `list_found` is true, and otherwise report it to the owner. The execute skill, whose executors never post, says so in the report.
- `hitld work publish` and `hitld feedback publish` carry `list_found` and the warning in their results. For `feedback publish` the warning comes with the result, after the approved issue is sent.
- With no `policy.json`, the commit hooks still check the store address in `HITLD_STORE_REMOTE` and warn that the list was not checked. `hitld work check` refuses without a policy, as before.
- A list file with no lines (empty, or blank lines only) counts as no list. A file whose terms were all removed still has its lines and counts as read.
- `private-list-invalid` names the list by its key in the store, never the store's path. A directory where the list goes, or a list that cannot be read, is refused with that code.
- Design part 10.3: the merge row says it checks only the implied terms when there is no list. The reason for warning instead of refusing now cites design 0003, section 8: a session with an address and no key, or with an unreachable remote, runs on a local store it never pulled.

## Owner's answers on pull request 404 (D-52)

The owner answered the two questions from the review fixes:

- **`hitld feedback publish` refuses to send** when the private term list was not checked. This applies whether the person approves it or posts it by hand. The record stays drafted, and the refusal says how to fix it: pull the store where this device can open it (`hitld store status` says what is missing), or answer from where the store is.
- **`merge.require_private_list`** is an opt-in policy flag, off by default. When it is on, `hitld merge` refuses when the list is not there, and main does not move. When it is off, the merge checks the implied terms and warns, as before, so cloud sessions keep merging.

Both refusals use the existing code `private-list-invalid`, and each refusal's message says that the list is missing and how to fix it. A new code, or a wider description of this one, has to be listed word for word in design part 16.2, which a test checks. Design changes still to make in `docs/`, not made here:

- Part 10.3, the "Where it is checked" table: the merge row should name `merge.require_private_list`. The paragraph after the table should say that `feedback publish` refuses, not warns, when there is no list.
- Part 16.2, and its copy in `core/lib/cli/errors.mjs`: widen the description of `private-list-invalid` to cover a list that cannot be read or is not there. Or, if the owner wants the missing-list refusals told apart from a list that does not read, add a code `private-list-missing` and switch both refusals to it.
