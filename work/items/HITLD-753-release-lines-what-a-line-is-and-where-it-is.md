---
id: HITLD-753
title: "Release lines: what a line is and where it is declared"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Declared in policy, projects point at it: policy.json lists lines with name, tag template, interface surface file and version source; a project names its line; none declared means today's single line."
answered_at: 2026-11-22T02:03:07.971Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-752 question 1: what is a release line, and where is it declared?

GitHub issue 465: independently versioned projects in one repository.

## Options and recommendation

- A. Declared in policy, projects point at it: policy.json lists lines with name, tag template, interface surface file and version source; a project names its line; none declared means today's single line.
- B. One line per project, declared in the tracker: Every project is a line.
- C. Derived from package manifests: HITLD discovers lines from manifests.

Recommended: Declared in policy, projects point at it. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
