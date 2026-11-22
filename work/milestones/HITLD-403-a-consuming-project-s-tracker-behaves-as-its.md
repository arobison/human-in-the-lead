---
id: HITLD-403
title: "A consuming project's tracker behaves as its guide says"
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: A project's own tracker files survive its formatters, migrations and edits, and items size from what the guide tells the project to write.
done_when:
  - "c1: Front matter a formatter wrapped still parses, and the generated views pass markdownlint."
  - "c2: Migrations and `work close` change only what they report."
  - "c3: Items and milestones are written and linked by command, also on a branch for review."
  - "c4: An item with a Plan and touches sizes below the heaviest profile in a project whose `work_dir` is not `work`, and the guide says what to write."
  - "c5: The tracker is kept true to what was built and decided: a curator applies the changes the owner has decided and flags drift, and the chief of staff verifies its pull requests against the decision records."
constraints: [HITLD-255 c1, HITLD-269 c1, HITLD-259 c2, HITLD-261 c2, HITLD-266 c2, HITLD-257 c3, HITLD-270 c3, HITLD-275 c3, HITLD-276 c3, HITLD-285 c4, HITLD-286 c4, HITLD-413 c3, HITLD-583 c5, HITLD-220 c5, HITLD-595 c5, HITLD-596 c5, HITLD-647 c5, HITLD-648 c5, HITLD-717 c5]
check: integration-test a fixture consumer tracker, formatted by prettier, migrated, edited by command and closed, passes `work check` and sizes to the expected profiles
---

## Notes

Proposed by the planning pass HITLD-343 on the owner's decision HITLD-363; the owner commits it later. Stage: v0.1.0-rc.4 (HITLD-401).

## Changed on 2026-11-20 (HITLD-608)

HITLD-595 (friction signals) and HITLD-596 (the friction controller) joined clause c5, beside the fuller curator, on the owner's decision HITLD-608.

HITLD-647 (the owner's rated sample for the friction reader) and HITLD-648 (the skill line that records recognized friction) joined clause c5 as proposals, from the HITLD-595 executor's report.

On 2026-11-22, filed from the first self-hosting run's follow-ups: HITLD-717 (the curator updates the design for the private-list refusals) joins clause c5.
