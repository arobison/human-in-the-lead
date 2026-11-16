---
id: HITLD-336
title: Public setting names for the dashboard Plan view, from HITLD-152
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Keep as built: The names stay reports.dashboard_plan_states and reports.dashboard_plan_max_items; they follow the existing reports.* naming."
answered_at: 2026-11-16T17:14:32.204Z
answered_via: question-tool
answered_by: owner
---

## Question

Keep the Plan view's two public settings named reports.dashboard_plan_states and reports.dashboard_plan_max_items?

The dashboard Plan view reads which item states it shows and how many items it draws from these settings. Once released the names cannot change.

## Options and recommendation

- A. Keep as built: The names stay reports.dashboard_plan_states and reports.dashboard_plan_max_items; they follow the existing reports.* naming.
- B. Rename them: The owner gives the names; the HITLD-152 branch and its decision change before the PR.
- C. Drop the settings: The Plan view's states and item cap are fixed in code; no public names to commit to.

Recommended: Keep as built. They follow the existing reports.* naming and nothing in the view calls for different names.

## Answer

Recorded in the front matter once answered.
