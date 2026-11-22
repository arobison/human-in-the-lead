---
id: HITLD-760
title: "Packages: how work and release records attach when a project spans several modules"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Packages own paths, items map by touches, projects span packages: Each package declares its paths; an item belongs to a package by the files it touches; a project can span packages; milestones and release items name their package; release records pin the versions of the packages they depend on; a package declares depends_on with a range."
answered_at: 2026-11-22T02:09:46.150Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-756 reopened for the Cesium case: how do work and release records attach to a release package when one project can span several modules?

The owner's driving example is a branch with several separately versioned modules. A project is an outcome; a package is a unit with its own version.

## Options and recommendation

- A. Packages own paths, items map by touches, projects span packages: Each package declares its paths; an item belongs to a package by the files it touches; a project can span packages; milestones and release items name their package; release records pin the versions of the packages they depend on; a package declares depends_on with a range.
- B. Keep it: a project names one package: Each module becomes its own project.
- C. Each item names its package: Explicit, no inference.

Recommended: Packages own paths, items map by touches, projects span packages. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
