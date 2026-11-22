---
id: HITLD-55
title: The knowledge-base `kb` tool
kind: work
state: done
created: 2026-11-14
project: HITLD-28
constraint_of: [HITLD-405 c1]
claimed_by: D-49
---

## Why

Design 8.5: the knowledge base has structure, front matter and a generated index, and the `kb` tool is how executors and the merge check use them.

## Done when

- `hitld kb search <terms>` searches with glossary expansion, and `--area` and `--tag` narrow it.
- `hitld kb index` regenerates `index.md` and `decisions.md`, and splits the index by area when it exceeds `kb.index_tokens_max`.
- `hitld kb stale` lists notes whose `sources` changed since `checked_at`, and a `checked_at` that is not reachable counts as stale.
- `hitld kb links` reports broken links and links to superseded notes.
- `hitld kb check` runs the rest plus the front-matter schema and the size budgets, and runs at merge in either mode.
- Tests run on a fixture knowledge base with one defect of each kind.
