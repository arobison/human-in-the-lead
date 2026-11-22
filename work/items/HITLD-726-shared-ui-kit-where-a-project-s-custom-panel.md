---
id: HITLD-726
title: "Shared UI kit: where a project's custom panel code lives"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. In the project's own app only: hitld dashboard output has the six built-in panel types and what views.json declares; a project that wants a custom React panel builds its own app on the installed package and registers it there."
answered_at: 2026-11-22T01:08:39.711Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-723 question 3: where does a project's own custom panel code live?

Decision 687 says projects run no script in HITLD's build; the React app now installs into a project's own app.

## Options and recommendation

- A. In the project's own app only: hitld dashboard output has the six built-in panel types and what views.json declares; a project that wants a custom React panel builds its own app on the installed package and registers it there.
- B. HITLD's build bundles project panels: hitld dashboard compiles panel components named in views.json; revises 687.
- C. No custom panels at all: Only built-ins plus views.json.

Recommended: In the project's own app only. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
