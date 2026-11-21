---
id: HITLD-693
title: "Evidence panels: an evidence source returns typed fragments with a label, and HITLD renders them"
kind: work
state: planned
created: 2026-11-21
project: HITLD-15
needs: [HITLD-692]
---

## Why

Decided by the owner (HITLD-686, 687): a project's evidence source (for example the measurement tool, HITLD-609) puts data on the page as typed fragments that carry a classification label; HITLD renders them and refuses what the label does not allow. The adapter's command is an owner-approved executing property; no code comes from data.

## Done when

- An evidence source's command returns a JSON fragment: a panel type from the closed set, its data, and a classification label (readers and reach, HITLD-633). HITLD validates it against a schema and renders it as a project panel.
- A fragment with no label, an unknown label, or a label that does not allow the page's reach (this machine only, a synced store, a published artifact) is refused, naming why, and its data is never inlined.
- The command that produces fragments is declared as an executing property that the owner approves; a views file or fragment that names code is refused.
- A fragment carries a source and the time it was read, shown on the panel, and a stale fragment is marked.
- Tests cover a valid fragment, a missing label, a label too narrow for the page, a command not approved, and a hostile value in a fragment. `npm run check`, the offline eval gate and `hitld work check` pass.
