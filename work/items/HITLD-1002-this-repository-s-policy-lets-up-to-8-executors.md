---
id: HITLD-1002
title: This repository's policy lets up to 8 executors run at once
kind: work
state: done
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
claimed_by: D-01M85XAQRDYS1GPH
---

## Done when

- `.human-in-the-lead/policy.json` has `execution.max_executors` as `{"value": 8, "min": 1, "max": 8}`, and nothing else in the file changes.
- `hitld config explain` on a checkout whose person, machine and run caps allow 8 reports a cap of 8 from the project layer; a test or an existing check covers the bound (the policy validates against its schema).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner asked on 2026-11-24 to raise the executor cap to 8. Changing a bound is a rule change (design part 11.2); the owner's own typed yes is this request and is recorded as a decision for the pull request. The cap in force is the smallest of the person, machine, project and run caps, so this raises only the project layer.

## Notes

rc.2. Same shape as HITLD-798 (4 to 5, pull request 532). The person, machine and run-scope caps are the owner's own settings and are not changed by this item; the owner types them in the orchestrator session. More executors do not raise throughput while the owner's review is the bottleneck: flow control still starts none while four or more code pull requests await the owner. Needs the owner's yes at merge (policy change).
