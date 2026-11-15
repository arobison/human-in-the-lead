---
id: HITLD-12
title: Eval results page and hitld eval accept --run
kind: work
state: done
created: 2026-11-14
project: HITLD-2
---

## Why

The owner reviews a stored run and accepts exactly that run; graders store path, expected and actual.

## Done when

- A results page shows a stored eval run, with each grader's path, expected and actual.
- `hitld eval accept --run <id>` accepts exactly that run and no other.
- Accepting is refused for executors.
- Tests cover the page and the accept command.
