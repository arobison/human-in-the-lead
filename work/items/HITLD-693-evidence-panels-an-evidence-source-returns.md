---
id: HITLD-693
title: "Evidence panels: an evidence source returns typed fragments with a label, and the shared React app renders them"
kind: work
state: planned
created: 2026-11-21
project: HITLD-15
needs: [HITLD-692, HITLD-729]
---

## Why

Decided by the owner (HITLD-686, 687): a project's evidence source (for example the measurement tool, HITLD-609) puts data on the page as typed fragments that carry a classification label; HITLD renders them and refuses what the label does not allow. The adapter's command is an owner-approved executing property; no code comes from data.

Reworded for the shared UI kit (HITLD-721, 724 to 728): the page is one React app with one component set, installed with HITLD and built by HITLD-729, so an evidence panel is one of that app's panel components fed by a fragment, not a separately rendered piece of markup. A project's own custom panel code lives in its own app (HITLD-726), never in a fragment.

## Done when

- An evidence source's command returns a JSON fragment: a panel type from the closed set (the six built-in panel types of the shared React app, HITLD-729), its data, and a classification label (readers and reach, HITLD-633). HITLD validates it against a schema and puts it in the dashboard data, and the app renders it with that type's panel component as a project panel.
- A fragment with no label, an unknown label, or a label that does not allow the page's reach (this machine only, a synced store, a published artifact) is refused, naming why, and its data is never inlined into the page's bundle.
- The command that produces fragments is declared as an executing property that the owner approves; a views file or fragment that names code, a component or a script is refused, and a fragment cannot add a panel type.
- A fragment carries a source and the time it was read, shown on the panel, and a stale fragment is marked.
- Tests cover a valid fragment rendered by its panel component, a missing label, a label too narrow for the page, a command not approved, a fragment naming an unknown panel type or code, and a hostile value in a fragment rendered as text, not markup. `npm run check`, the offline eval gate and `hitld work check` pass.
