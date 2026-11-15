---
id: HITLD-96
title: Runs on a hosted tracker
kind: milestone
state: planned
created: 2026-11-15
project: HITLD-95
outcome: A project can run HITLd on Linear, Jira or GitHub Issues as its tracker.
done_when:
  - "c1: On a sandbox workspace of each of the three trackers, an item a mapped decider moved to planned is dispatched, claimed (assignment confirmed, ledger started, claim commit), merged through the queue, and shown done in the tracker, with the close confirmed by the queue, including in a run where the closing keyword is turned off."
  - "c2: On each, an item in an unmapped state is never dispatched and is named by hitld work check; a write to a missing field is refused by name."
  - "c3: On each, the conformance suite passes against the live sandbox and against the fake server."
  - "c4: The tracker injection scenarios pass at 100%, and the no-native-tools scenario passes."
  - "c5: After a run, hitld work reconcile finds no gap; with gaps seeded by hand (an item closed in the tracker, a merge reverted, a keyword that never fired), it finds each one."
  - "c6: A fixture project on a hosted tracker is imported and switched to the files backend, and hitld work check passes on the result."
constraints: [HITLD-97 c6, HITLD-98 c6, HITLD-99 c6]
check: demo a script, run by someone other than the items' authors, that drives c1, c2 and c5 against each sandbox workspace and records the result with its evidence
---

## Notes

From design 0002, section 16. The constraints so far are the import-and-switch slice; the other build items in that section join as they are filed. Contributions, which add to the outcome but are not needed for it: the one-way mirror out, migration from files to hosted, and views from the snapshot on the dashboard.
