---
id: HITLD-798
title: This repository's policy lets up to 5 executors run at once
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M814XZFEY9BTHX
---

## Why


The owner asked for five executors at once (2026-11-22) after seeing the economize gate hold the run at one. The cap is the smallest of the person, machine, project and run layers (HITLD-204). The person and machine files now say 5; the project's `execution.max_executors.value` is 4 and the run's scope says 3, so five cannot happen until the project value rises. The project's allowed range is 1 to 6, so 5 is inside it.

## Done when

- `.human-in-the-lead/policy.json` sets `execution.max_executors.value` to 5, and `hitld config explain` shows the project layer at 5.
- A policy change reaches main only with the owner's own yes. `npm run check` and `hitld work check` pass.
