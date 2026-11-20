---
id: HITLD-448
title: Clicking an item in the dashboard shows its details in the page, not a link to the repository
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Done when




- Clicking an item anywhere on the dashboard (the Roadmap drawers, the Plan, Your move, Proposals, Flow) opens that item's details inside the page, in a drawer in the same style as the milestone drawers, and the page does not navigate away. It works in the claude.ai Artifact viewer and in a browser, with no network request.
- The drawer shows what the item file holds that a reader needs: its title and ID, kind and state, the project and the milestones it is a constraint of, its release, what it `needs` and what needs it (each a link that opens that item's drawer), its Why and Done when, and for a decision its question, options and answer. Text from the item is escaped; the page's rules hold (one file, no script from elsewhere, no `innerHTML`, a hash-locked content policy where the host allows it).
- A "Source file" link to the repository stays at the foot of the drawer as a secondary link, so the owner can still open the file; it is not what a click on the item does.
- The drawers carry the full detail of every item, embedded in the page. The size is measured and is not a constraint: the item files total about 0.67 MB against a page of about 0.42 MB and the Artifact limit of 16 MB, so the page would be about 1.1 MB; the item records the measured size and a test fails the build if the page passes 8 MB. The page does not read item text from the repository at click time: the Artifact's content policy blocks requests to other hosts, and design 12 keeps the page one file with no network request (HITLD-308).
- A fixture tracker tests a drawer for a work item, a decision and an external item, a needs link that opens another drawer, and that the page makes no network request. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner said on 2026-11-16, looking at the dashboard in the Artifact: clicking an individual item should show its details in the app, not link to the GitHub repository. Today each item link goes to the item's file on the forge, which the owner could not follow from the viewer (the loading error of HITLD-320) and which takes them out of the page they are reading.

## Notes

Dashboard code and design 12: needs the owner's own yes to merge. Replaces the fix HITLD-320 asked for: once an item opens in the page, the loading error no longer applies to item clicks; HITLD-320 stays open for the "Source file" link and the other links until the owner drops it. Related: HITLD-62 and HITLD-152 (the board and the views), HITLD-339 (the Artifact). Placed under HITLD-192 c2 (every link in the page opens, or says where it cannot).
