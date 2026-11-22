---
id: HITLD-790
title: "Cloud executors: enable the plugin so the guard runs"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Yes: commit project settings that enable it, then verify: A separate item commits project settings enabling the plugin from this repository's marketplace for cloud sessions, then a fresh cloud session is started and the guard is checked to run, with budget metering there too (HITLD-782)."
answered_at: 2026-11-22T05:08:52.865Z
answered_via: question-tool
answered_by: owner
---

## Question

The plugin's hooks, including the executor guard, do not run in cloud executor sessions, so cloud executors have been unguarded and unmetered. Should we enable the plugin in those sessions?

The HITLD-781 executor tested it: git push origin HEAD was allowed in a cloud executor session.

## Options and recommendation

- A. Yes: commit project settings that enable it, then verify: A separate item commits project settings enabling the plugin from this repository's marketplace for cloud sessions, then a fresh cloud session is started and the guard is checked to run, with budget metering there too (HITLD-782).
- B. No: rely on the environment's own limits: Document that the guard applies to print mode only.

Recommended: Yes: commit project settings that enable it, then verify. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
