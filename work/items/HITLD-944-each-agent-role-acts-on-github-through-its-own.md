---
id: HITLD-944
title: Each agent role acts on GitHub through its own GitHub App
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. One GitHub App per role: Queue, executor and release Apps."
answered_at: 2026-11-22T21:19:52.919Z
answered_via: question-tool
answered_by: owner
---

## Question

Should each agent role act through its own GitHub App (forge decision 1 of 8)?

A token of the owner's is the owner, so rulesets cannot restrict an agent without restricting the owner. Apps cost about an hour of setup and key custody.

## Options and recommendation

- A. One GitHub App per role: Queue, executor and release Apps.
- B. Fine-grained tokens per role: Still the owner as far as GitHub knows.
- C. Keep today's sign-in: No forge enforcement against agents.

Recommended: One GitHub App per role. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
