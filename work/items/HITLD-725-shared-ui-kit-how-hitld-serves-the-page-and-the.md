---
id: HITLD-725
title: "Shared UI kit: how HITLD serves the page, and the role of artifacts"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Static bundle; artifact is the chief of staff's viewer only: hitld dashboard writes one HTML file with the React app and the contract data inside, regenerated on events (as HITLD-689); in a cloud session the chief of staff publishes it as an artifact so the owner can see it. A live artifact feed is a later optional item."
answered_at: 2026-11-22T01:05:53.338Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-723 question 2: how does HITLD serve the React page, and what role do artifacts play?

HITLD's own page may stop being a static file (owner). An artifact page cannot read the git repo; live data would need a Claude session or routine to write the contract into the artifact database, and it only works for people with a Claude account.

## Options and recommendation

- A. Static bundle; artifact is the chief of staff's viewer only: hitld dashboard writes one HTML file with the React app and the contract data inside, regenerated on events (as HITLD-689); in a cloud session the chief of staff publishes it as an artifact so the owner can see it. A live artifact feed is a later optional item.
- B. Static bundle plus a live artifact feed in rc.2: Also a Claude-only route that keeps an open artifact live.
- C. Local server with live data: hitld dashboard serve reads the tracker on each request; HITLD-694 goes away.

Recommended: Static bundle; artifact is the chief of staff's viewer only. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
