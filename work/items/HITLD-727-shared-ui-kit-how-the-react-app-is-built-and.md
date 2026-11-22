---
id: HITLD-727
title: "Shared UI kit: how the React app is built and shipped"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Commit the built bundle, CI checks it: React and the bundler are dev dependencies; the built bundle is committed and a CI check fails if it does not match the source; hitld dashboard inlines the data, so users need no tooling."
answered_at: 2026-11-22T01:08:43.118Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-723 question 4: how does the React app get built and shipped, given HITLD runs from a checkout with no build step and no React?

React and a bundler are new to this repository; self-hosting runs from a checkout.

## Options and recommendation

- A. Commit the built bundle, CI checks it: React and the bundler are dev dependencies; the built bundle is committed and a CI check fails if it does not match the source; hitld dashboard inlines the data, so users need no tooling.
- B. Build at release, checkout builds on demand: Bundle shipped in the release package; a checkout runs npm run build:ui first.
- C. Build on every dashboard run: hitld dashboard runs the bundler each time.

Recommended: Commit the built bundle, CI checks it. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
