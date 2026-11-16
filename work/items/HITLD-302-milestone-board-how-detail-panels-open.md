---
id: HITLD-302
title: "Milestone board: how detail panels open"
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. CSS :target panels: A click opens a panel through the URL fragment."
answered_at: 2026-11-16T05:59:23.775Z
answered_via: question-tool
answered_by: owner
---

## Question

How should detail panels open on dashboard.html with no scripts?

HITLD-62 milestone board (PR #196).

## Options and recommendation

- A. CSS :target panels: A click opens a panel through the URL fragment.
- B. details/summary: Native expandable blocks.
- C. Always visible: Every milestone text stays under the graph.

Recommended: CSS :target panels. Works with no script and supports links and the back button.

## Answer

Recorded in the front matter once answered.
