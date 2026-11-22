---
id: HITLD-886
title: Describe build-system ecosystems as data profiles; commands only in the project's policy
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Data profiles; commands only in policy: One rule: only the owner's policy runs code."
answered_at: 2026-11-22T20:40:30.237Z
answered_via: question-tool
answered_by: owner
---

## Question

How should an ecosystem be described (issue 553, HITLD-883 decision 1 of 12)?

Built-in profiles hold manifests, lockfiles, version sources, folders to skip and cache descriptions; install, build, test and publish commands appear only in the project's own policy.json.

## Options and recommendation

- A. Data profiles; commands only in policy: One rule: only the owner's policy runs code.
- B. Profiles may ship default commands: Less typing, but package code would run in a consumer.
- C. No built-in profiles: Projects declare everything.

Recommended: Data profiles; commands only in policy. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
