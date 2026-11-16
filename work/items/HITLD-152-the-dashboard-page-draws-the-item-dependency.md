---
id: HITLD-152
title: The dashboard page draws the item dependency graph and the milestone graph as inline SVG, so one file shows the plan
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

The owner wanted to see the plan visually and opened `dashboard.html`. It shows the ledger, the quotas and the digest, and no graph of the plan. The item dependency graph exists only as a mermaid block in `work/views/items-graph.md`, which a browser does not draw without a script, and a plain file that needs a viewer is not one file to look at. Design 12 says the dashboard is static and self-contained, with charts as inline SVG and no scripts from elsewhere, and says the milestone graph belongs on the page (HITLD-62, planned). The item graph is kept out of it by the design's current wording.

## Done when

- `hitld dashboard` writes `dashboard.html` with the item dependency graph drawn as inline SVG: items as nodes with their state, `needs` as edges, grouped by project, with the critical path and the ready items marked. It works from the tracker's read API, the same data as `items-graph.md`.
- The milestone graph of HITLD-62 is drawn by the same code on the same page, so both share one layout and one set of styles.
- The page stays one file with no script from elsewhere and no network request. Opening it in a browser with no network shows both graphs.
- The graphs are drawn by HITLd's own layout code, with no new runtime dependency: a layered layout of the dependency graph that stays legible for a tracker of a few hundred items, with each node linking to its item file in the repository and a text list of the same nodes under the graph for a screen reader.
- A graph too large to read is cut by project or by state, with a setting for what the page shows by default, and the full graph remains in `work/views/`.
- Design 12 says the item graph is on the page and in the views, in place of the sentence that keeps them apart.
- Tests build a fixture tracker with a diamond, a chain and a cycle refused by `work check`, and check the SVG's nodes, edges and markers. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. HITLD-62 draws the milestone graph on the page, so build the two together or this one after it. The dashboard reads the project's store and quotas, so a dashboard generated in one container shows that container's state until the store syncs (HITLD-142).
