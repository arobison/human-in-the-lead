---
id: HITLD-721
title: "Shared UI kit: one React app and component set for HITLD's page and projects"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. One React app and components: HITLD's page and every project use the same panels, with views.json to override layout, CSS variables for style, and a typed client and hooks for custom UIs. Output is a static bundle plus a JSON file."
answered_at: 2026-11-22T00:58:37.109Z
answered_via: question-tool
answered_by: owner
---

## Question

Should the shared UI be one React app and component set that reads the contract JSON in the browser, used by HITLD's own page and by projects?

The owner said HITLD's own page may stop being static if that simplifies things. Research (public docs, partly unverifiable) found no single existing tool that covers restyle, extend, re-layout and replace; the owner found layered options too complicated. This revises decision 689 (static file regenerated on events).

## Options and recommendation

- A. One React app and components: HITLD's page and every project use the same panels, with views.json to override layout, CSS variables for style, and a typed client and hooks for custom UIs. Output is a static bundle plus a JSON file.
- B. Keep it static and framework-neutral: A plain renderer plus a typed client with optional React hooks.
- C. Adopt an existing tool: Use Evidence, Observable Framework or Grafana over the contract after a short experiment.

Recommended: One React app and components. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
