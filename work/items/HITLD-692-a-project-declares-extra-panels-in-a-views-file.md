---
id: HITLD-692
title: A project declares extra panels in a views file, and HITLD renders them with no script
kind: work
state: done
created: 2026-11-21
project: HITLD-15
needs: [HITLD-691]
claimed_by: D-01M80GWJHV5RXDWK
release_note: A project can declare its own dashboard panels (table, board, bar, line, timeline, graph) in .human-in-the-lead/views.json, checked by hitld check views and shown in their own tab; the data contract gains views (api_version stays 2)
---

## Why

Decided by the owner (HITLD-684, 685, 687): a project declares extra panels as data in a committed `views.json` beside `tracker.json`, validated against the tracker's declared fields; the closed set of panel types is table, board, bar chart, line chart, timeline and graph; and no script comes from a project.

## Done when

- A `views.json` schema exists, and `hitld check` (or the dashboard command) validates a project's file against it and against the fields declared in `tracker.json`: a panel naming an undeclared field is refused, naming the field and the panel.
- Each of the six panel types renders from the data contract with no script: a table (chosen columns), a board (columns by a field such as state), a bar chart (counts by a field), a line chart (a count over time), a timeline (items on a date field) and a graph (items and their `needs` or another declared relation). Every panel has a text fallback that reads without CSS and a heading for a screen reader.
- A panel may use a filter over any field in the contract. A filter or field that does not exist yields an error naming it, not an empty panel.
- Nothing a project supplies is rendered as markup: all values are escaped, and a test with hostile field values (script tags, URLs, very long text) shows the page holds no script from data.
- The built-in views stay as they are; a project's panels appear in their own tab or section, named by the project.
- Tests cover each panel type, validation errors, an escaped hostile value and a project with no `views.json`. `npm run check`, the offline eval gate and `hitld work check` pass.
