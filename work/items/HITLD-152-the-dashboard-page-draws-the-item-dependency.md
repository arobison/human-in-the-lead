---
id: HITLD-152
title: The dashboard page shows the plan, the milestones, what is happening now, and quota and spend, in one file
kind: work
state: done
created: 2026-11-16
project: HITLD-15
needs: [HITLD-62, HITLD-135]
claimed_by: D-24
release_note: `hitld dashboard` writes one page with six views as tabs (Your move, Roadmap with a fewest-crossings layout, the Plan as an item graph, Proposals, Flow, and Quota and spend), one inline script for hover, scope and search allowed by its hash, and two settings, `reports.dashboard_plan_states` and `reports.dashboard_plan_max_items`.
---

## Why

The owner wanted to see the plan visually and opened `dashboard.html`. It shows the ledger, the quotas and the digest, and no graph of the plan. The item dependency graph exists only as a mermaid block in `work/views/items-graph.md`, which a browser does not draw without a script, and a plain file that needs a viewer is not one file to look at. Design 12 says the dashboard is static and self-contained, with charts as inline SVG and no scripts from elsewhere, and says the milestone graph belongs on the page (HITLD-62, planned). The item graph is kept out of it by the design's current wording.

## Settled by the owner

On 2026-11-16, in the chief of staff session, the owner decided two things, recorded as decisions:

- **What the page shows (HITLD-176):** all four: the plan (the item dependency graph), milestone progress, what is happening now, and quota and spend. In the owner's words, a work page designed in another project "could serve as a basis for the built in dashboard here plus the stuff above where it's not already covered by this design".
- **When (HITLD-177):** next, before the rest of rc.2. This item and HITLD-62 join the milestone Consumer live.
- **Which views (the owner's own words, in the UX review of the milestone board, PR #196):** "we're also missing a bunch of stuff from the dyno work page, your moves, flow, proposals". The page takes the reference's Your move (the default view), the full Proposals view (all proposed items, not only milestones) and Flow, as well as the Roadmap that HITLD-62 builds. HITLD-62 merges first, after the owner's UX review; this item builds on it.

## The reference the owner pointed to

On 2026-11-16 the chief of staff read the owner's reference: a work board built in another project's app, now pushed, with a design guide for the app it lives in. The project is not named in any public text. It reads this project's read API (`hitld work query --json`, version 3, with `claims`, `check` and `show`) and writes nothing. It has:

- **Scope and search:** a scope picker (all work, a long outcome, a project, a milestone) and a search field that narrow every view. An item opens in a pane on the right.
- **Your move (the default view):** the owner's attention is the constraint, so each section leads with its number: decisions waiting on the owner, ready to start, work in progress (who holds each, on which branch, claims in other worktrees included until they merge) and waiting outside. Most waited-on first, counting what waits through other items.
- **Roadmap:** what comes after what, without dates. The milestone map has project lanes, steps across, curved waits (thicker for more items behind them), the critical path in the accent, started milestones solid with a leading strip and idle ones hollow, owner decisions and outside waits as badges, and release gates as flags in a Releases lane. A second layout trades the lanes for fewer crossings. Also lists by milestone, long outcome, or project waits.
- **Proposals:** one table of bets to commit or drop: what stands between each and committing (ready, waits on the owner's answer, waits on other items) and how many open items wait on it.
- **Flow:** stage bands (proposed, blocked, ready, in progress, done) day by day from the committed status history, then measures each with the one that must not get worse.
- **Names and colors:** the tracker's statuses; Blocked and Ready derived as the tracker derives them; a milestone shows progress, not a state. One color per stage, light and dark.
- **Each figure once:** a number belongs to the view whose question it answers.

What this design already has: the item graph (the views), and the milestone graph (HITLD-62). What the reference adds: the Your move view, scope and search, Proposals, Flow, and the milestone map's lanes (HITLD-62 takes its layout first). Not taken: the other project's UI component library and its dev server, because this project takes no runtime dependency, so the page uses its own markup and no script.

## Done when

- `hitld dashboard` writes `dashboard.html` as one file with four views: the plan, milestone progress, what is happening now, and quota and spend.
  - **The plan:** the item dependency graph as inline SVG, items as nodes with their state, `needs` as edges, grouped by project, with the critical path and the ready items marked. It works from the tracker's read API, the same data as `items-graph.md`.
  - **Milestone progress:** the milestone graph of HITLD-62, drawn by the same code: each milestone's clauses, its constraints done, and what holds it up.
  - **What is happening now:** the dispatches running and what each is doing, pull requests waiting on the owner or on checks, and decisions waiting for the owner's answer, each with its age.
  - **Quota and spend:** the weekly usage against the reserve and its forecast, and what sessions and probes have cost.
- The page has the reference's views: **Your move** (the owner's decisions, ready to start, work in progress and waiting outside, each section leading with its number), **Roadmap** (HITLD-62's milestone board), **Proposals** (a table of every proposed item: the idea, what stands between it and committing, how many open items wait on it) and **Flow** (stage bands day by day from the committed status history, then the measures with the one that must not get worse).
- The owner reviews each view in the rendered file, one at a time, and the owner's notes are recorded as decisions, as for the milestone board.
- **Layout without a library (the owner's decision, HITLD-307):** the Roadmap offers a second layout, fewest crossings, written in this repository (no d3-dag or other runtime dependency, design 16): columns by longest path, crossing reduction by barycenter sweeps, linked milestones grouped (the critical path's group first), unlinked ones in a grid. It is computed when the page is generated.
- **One small inline script (the owner's decision, HITLD-308):** hover highlighting of what feeds a milestone and what it unblocks, scope, and search. The page is complete and readable without it. The script never uses `innerHTML`, gets its data as escaped JSON, and a Content-Security-Policy tag allows only that script by its hash. Design 12.4 says so, and a test fails the build if the page holds any other script or any network request.
- The page stays one file with no script from elsewhere and no network request. Opening it in a browser with no network shows all four views.
- The graphs are drawn by HITLd's own layout code, with no new runtime dependency, legible for a tracker of a few hundred items. Each node links to its item file in the repository, and a text list of the same nodes sits under each graph for a screen reader.
- A graph too large to read is cut by project or by state, with a setting for what the page shows by default, and the full graph remains in `work/views/`.
- Design 12 says what the page shows, in place of the sentence that keeps the item graph out of it.
- Tests build a fixture tracker with a diamond and a chain and check each view's SVG and lists. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. HITLD-62 draws the milestone graph on the page, so the two are built together or HITLD-62 first. A dashboard generated in one container shows that container's store until the stores sync (HITLD-142 and HITLD-148), so the page says when its data was read and from where.
