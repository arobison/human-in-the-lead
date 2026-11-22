---
id: HITLD-724
title: "Shared UI kit: how a project gets the React app and components"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Installed with HITLD, eject later: One package ships with HITLD; projects restyle with theme variables, change layout with views.json and register custom panels in code. A later hitld ui eject item copies the source into a project that outgrows this; it is not in rc.2."
answered_at: 2026-11-22T01:05:49.784Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-723 question 1: how does a project like dyno get the React app and components?

HITLD ships one React app and component set (HITLD-721). Projects restyle, add information, change layout, or write their own UI. Research found copy-in kits drift and have no real update command.

## Options and recommendation

- A. Installed with HITLD, eject later: One package ships with HITLD; projects restyle with theme variables, change layout with views.json and register custom panels in code. A later hitld ui eject item copies the source into a project that outgrows this; it is not in rc.2.
- B. Installed, with eject in rc.2: Same, with the eject command in rc.2 too.
- C. Copied into the project from the start: Every project owns the source; drift is built in.

Recommended: Installed with HITLD, eject later. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
