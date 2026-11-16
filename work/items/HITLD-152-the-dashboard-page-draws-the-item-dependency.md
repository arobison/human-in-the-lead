---
id: HITLD-152
title: The dashboard page shows the plan, the milestones, what is happening now, and quota and spend, in one file
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-62, HITLD-135]
---

## Why

The owner wanted to see the plan visually and opened `dashboard.html`. It shows the ledger, the quotas and the digest, and no graph of the plan. The item dependency graph exists only as a mermaid block in `work/views/items-graph.md`, which a browser does not draw without a script, and a plain file that needs a viewer is not one file to look at. Design 12 says the dashboard is static and self-contained, with charts as inline SVG and no scripts from elsewhere, and says the milestone graph belongs on the page (HITLD-62, planned). The item graph is kept out of it by the design's current wording.

## Settled by the owner

On 2026-11-16, in the chief of staff session, the owner decided two things, recorded as decisions:

- **What the page shows (HITLD-176):** all four: the plan (the item dependency graph), milestone progress, what is happening now, and quota and spend. In the owner's words, a work page designed in another project "could serve as a basis for the built in dashboard here plus the stuff above where it's not already covered by this design".
- **When (HITLD-177):** next, before the rest of rc.2. This item and HITLD-62 join the milestone Consumer live.

## The reference the owner pointed to

On 2026-11-16 the chief of staff read the owner's reference: a work board specified in another project's tracker, with a design guide for the app it would live in. It is a proposal there and is not built. The project is not named in any public text. It specifies:

- **A kanban by lifecycle:** Proposed, Planned, In progress, Done, Dropped. A card shows the ID, title, project, kind, priority and, when claimed, who holds it.
- **Two dependency graphs:** the item graph and the project graph.
- **Filters** by initiative, project and kind, and a "waiting on the owner" filter: the open decision items the owner decides, and the items that need them.
- **Ready and blocked views,** each blocked item with its open needs.
- **Read-only:** each card links to its file and nothing edits one. The page reads the same parser as the command-line views, so its counts match them, and it runs nothing it reads. It shows one branch and says so, and leaves claims on other branches to the command line.
- **A UI checklist:** both light and dark themes, a 380 px width, keyboard only, reduced motion, and a clean console.
- **A place for what needs a look:** the first group of the navigation, with a count of the decisions waiting on the owner.

What this design already has: the item graph (the views), and the milestone graph (HITLD-62). What the reference adds: the kanban by lifecycle, the project graph, the filters, the waiting-on-the-owner view, and ready and blocked with open needs. Not taken: the other project's UI component library, because this project takes no runtime dependency, so the page uses its own markup.

## Done when

- `hitld dashboard` writes `dashboard.html` as one file with four views: the plan, milestone progress, what is happening now, and quota and spend.
  - **The plan:** the item dependency graph as inline SVG, items as nodes with their state, `needs` as edges, grouped by project, with the critical path and the ready items marked. It works from the tracker's read API, the same data as `items-graph.md`.
  - **Milestone progress:** the milestone graph of HITLD-62, drawn by the same code: each milestone's clauses, its constraints done, and what holds it up.
  - **What is happening now:** the dispatches running and what each is doing, pull requests waiting on the owner or on checks, and decisions waiting for the owner's answer, each with its age.
  - **Quota and spend:** the weekly usage against the reserve and its forecast, and what sessions and probes have cost.
- The owner reviews, in a walk-through (HITLD-135), one question at a time, which parts of the reference below the page takes and how, and the answers are recorded as decisions before anything is built.
- The page stays one file with no script from elsewhere and no network request. Opening it in a browser with no network shows all four views.
- The graphs are drawn by HITLd's own layout code, with no new runtime dependency, legible for a tracker of a few hundred items. Each node links to its item file in the repository, and a text list of the same nodes sits under each graph for a screen reader.
- A graph too large to read is cut by project or by state, with a setting for what the page shows by default, and the full graph remains in `work/views/`.
- Design 12 says what the page shows, in place of the sentence that keeps the item graph out of it.
- Tests build a fixture tracker with a diamond and a chain and check each view's SVG and lists. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. HITLD-62 draws the milestone graph on the page, so the two are built together or HITLD-62 first. A dashboard generated in one container shows that container's store until the stores sync (HITLD-142 and HITLD-148), so the page says when its data was read and from where.
