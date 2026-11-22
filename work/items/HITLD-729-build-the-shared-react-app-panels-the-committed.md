---
id: HITLD-729
title: "Build the shared React app: panels, the committed bundle and its CI check"
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
needs: [HITLD-691]
release_note: hitld dashboard pages with a tracker inline the shared React app (a committed bundle, checked in CI) and the contract data; core/lib/ui/ exports a typed client, React hooks, the six panel components, theme variables and a panel registry for a project's own app
claimed_by: D-01M80WW9X15NK1FB
---

## Why

The owner's decisions on the shared UI kit (HITLD-720, 721, 724 to 728): one React app and component set serves HITLD's own page and projects; it is installed with HITLD (an eject command comes later as its own item); the page is a static HTML file with the contract data inlined and regenerated on events; custom panel code lives in a project's own app, not in HITLD's build; and the built bundle is committed with a CI check that fails when it does not match the source.

## Done when

- A React app renders the six panel types (table, board, bar, line, timeline, graph) from the dashboard data contract (HITLD-691) and the project's `views.json` (HITLD-692), with theme variables a project can set to restyle it.
- A typed client and React hooks over the contract are exported for a project's own app, and a project can register a custom panel there.
- `hitld dashboard` writes one self-contained HTML file with the committed bundle and the contract data inlined, and the page states when and where its data was read.
- The built bundle is committed; a CI check fails when the bundle does not match the source, and React and the bundler are development dependencies only.
- A test renders each panel type from fixture data, and a project's declared field appears in a rendered panel.
- `npm run check`, the offline eval gate and `hitld work check` pass.
