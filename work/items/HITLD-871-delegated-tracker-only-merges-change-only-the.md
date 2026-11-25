---
id: HITLD-871
title: Delegated tracker-only merges change only the claimed item and run the queue's answer checks
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M88NC0G604RHSV
release_note: "`hitld merge --tracker-only <pull request>`, the chief of staff's, merges a tracker-only pull request after the queue's guards; under the owner's delegation a merge changes only the item a live dispatch on its branch claimed, answers and choices the rights flow recorded, and anything else in the tracker waits for the owner's yes, recorded with `hitld merge approve` for that head."
---

## Why

The review found that a pull request whose files are all under `work/` merges by delegation with the owner's sign-off, and that the answer check (`core/lib/merge/answers.mjs`) compares only four fields of an answered decision, so such a branch can rewrite a decision's title, question or options, another item's Done-when, or add items whose bodies become later executors' briefs. The chief of staff's hand-merge of tracker-only pull requests is prose only and skips the queue's answer, symbolic-link, quarantine and private-term checks.

## Done when

- A delegated tracker-only merge may change only the file of the item its branch claimed; any change to a decision item, to another item, or to a milestone waits for the owner.
- One command (`hitld merge --tracker-only <pull request>`) runs the queue's answer check, the symbolic-link rule, the quarantine and duplicate-ID guards and the private-term check, and verifies the head branch's origin; the chief-of-staff skill calls it instead of describing the steps.
- Owner-only state changes with no decision behind them (promoting `proposed` to `planned`) are refused.
- A test per case above.
- A merge-path or skill change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Findings T5 and T6 and the operating-model review's O6.

## Plan

- The rule (`delegatedTrackerScope`, `core/lib/merge/answers.mjs`): a merge without the owner may change in the tracker only the file of the item its dispatch claimed (from the ledger, never the branch), and not its `constraint_of`, `project`, `needs` or `holds`, nor a state the claim and close do not set; a decision already on main by its recorded answer alone (answer fields, state and what answering writes; question, options and body unchanged); and an added decision answered by the owner whose title and body are what the rights flow renders from its ask record (true to its check code) and whose answer is the recorded one. Anything else there waits for the owner: a decision added or rewritten otherwise, another item, an added item, a milestone, a view. An item promoted out of `proposed` is refused.
- The queue applies it to every pull request that would merge without the owner: one that changes more waits (`outside_claim`), one that promotes an item goes back (`owner_state`).
- `hitld merge --tracker-only <n>` (`core/lib/merge/tracker-only.mjs`): the head branch in this repository and at the pull request's head, every file under the tracker's folder, the commit guard with the private terms, the quarantine file, duplicate IDs in the merged tree, a conflict with main, the symbolic-link rule, the answer check, the rule above, the named checks; then a squash with the owner's delegated sign-off and `Delegated-by`, or with the owner's own yes: only an approval `hitld merge approve` recorded for that pull request and head (approvalHolds), which it marks used. The chief of staff's right alone (`--role` or `HITLD_ROLE`). The claim is a live dispatch's on that branch (not abandoned, unclaimed or interrupted, its item not merged since) that the branch's item file names. No lease. Outside owner mode it skips the scope rule, the answer check, the symbolic-link rule and the sign-off, as the queue does. The chief-of-staff skill calls it.
