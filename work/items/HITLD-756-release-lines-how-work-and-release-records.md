---
id: HITLD-756
title: "Release lines: how work and release records attach to a line"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Project names its line, command takes --line: A project names its line and its items, milestones and release items inherit it; records live under work/releases/<line>/; release item unique per line and version; --line required when more than one line is declared."
answered_at: 2026-11-22T02:03:18.924Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-752 question 4: how do work and release records attach to a line, and how do release propose and release make know which line?

Releases hold whole milestones (issue 298); items reach a release through milestones and projects.

## Options and recommendation

- A. Project names its line, command takes --line: A project names its line and its items, milestones and release items inherit it; records live under work/releases/<line>/; release item unique per line and version; --line required when more than one line is declared.
- B. Each item names its line: Finer-grained.
- C. Each milestone names its line: The milestone is the unit a release holds.

Recommended: Project names its line, command takes --line. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
