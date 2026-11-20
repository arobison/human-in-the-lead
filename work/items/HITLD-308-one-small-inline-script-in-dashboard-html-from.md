---
id: HITLD-308
title: One small inline script in dashboard.html, from HITLD-152 on
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Yes, from HITLD-152 on: PR #196 stays script-free; HITLD-152 adds one inline script under the rules."
answered_at: 2026-11-16T06:05:33.859Z
answered_via: question-tool
answered_by: owner
---

## Question

Allow one small inline script in dashboard.html (hover highlighting, scope, search) under the safety rules: works without it, no innerHTML, escaped JSON data, a hash-locked content policy?

Design 12.4 says no scripts from elsewhere; it does not ban an inline script. Tracker text can include untrusted issue titles.

## Options and recommendation

- A. Yes, from HITLD-152 on: PR #196 stays script-free; HITLD-152 adds one inline script under the rules.
- B. Yes, add it to #196 now: D-20 adds hover highlighting before merge.
- C. No scripts at all: Static HTML and SVG only.

Recommended: Yes, from HITLD-152 on. Keeps the milestone board review small.

## Answer

Recorded in the front matter once answered.
