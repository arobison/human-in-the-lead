---
id: HITLD-62
title: Milestone graph in the views and the report
kind: work
state: done
created: 2026-11-14
project: HITLD-15
needs: [HITLD-45]
claimed_by: D-20
release_note: `hitld work views` writes milestones.md as a milestone graph (mermaid) with a table, and `hitld dashboard` shows the same graph as inline SVG, each milestone opening to its items.
---

## Why

Design 12.1.2 and 3.4, "Generated views": once milestones are entities (HITLD-45), people need to see them as a graph, with how far each has come and what holds it up. It complements the item dependency graph; it does not replace it. Kept apart from HITLD-45, which already carries the format, the migration and the release records.

## Done when

- `hitld work views` writes `work/views/milestones.md`: a mermaid graph with milestones as nodes, labeled by name, and `needs` between milestones as edges. Each node shows its outcome, its constraints `Done` out of all, `tokens_spent` against `appetite_tokens`, and its check (passed, due or not yet due).
- The critical path through milestones not yet `Done` is highlighted, by the same rule items use (most estimate tokens remaining).
- Under the graph, a table lists each milestone with the same fields and its constraints and contributions with their state.
- `hitld report` adds the same graph to its HTML page as inline SVG; each node opens to its items, with no scripts from elsewhere and no network requests.
- `items-graph.md` is unchanged.
- Offline tests: a fixture tracker with three milestones, one `needs` between them and one passed check gives the expected nodes, edges, progress and critical path.

## Plan

docs/design/0001-human-in-the-lead/12-reporting-and-limits.md#1212-the-milestone-graph-planned; docs/design/0001-human-in-the-lead/03-data-model.md#generated-views.

## Follow-up

The dashboard's board follows the owner's choice of layout (the Work board of another project the owner runs: lanes by project, steps across, stage colors). Left for later: a layout that places nodes for the fewest edge crossings, highlighting a node's waits on hover, and a picker for which projects the board shows.
