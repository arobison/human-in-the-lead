---
id: HITLD-80
title: "Milestone serves: value in the project's value units with a confidence, not a Fibonacci rank"
kind: work
status: In progress
created: 2026-11-15
project: HITLD-15
claimed: D-80
---

## Why

A milestone's `serves` entries give each contribution `value=<1|2|3|5|8|13>`, a Fibonacci rank. Prioritization divides value by size (cost of delay over duration, design 2.4) and the milestone's derived `scope` ranks contributions by value per token, so value must be a ratio in the project's own value units, as design 2 already says for opportunities. A rank divided by tokens looks precise and is not. The format is public, so it changes before v0.1.0-rc.1 (Q33). The owner decided this in session.

## Done when

- A `serves` entry is `<ID> value=<number> confidence=<0 to 1>`, where value is a positive number in the project's value units (design 2), the same meaning as an opportunity's value. 1, 2, 3, 5, 8 and 13 stay valid values, as quick choices, not as the only ones.
- The milestone schema, the parser in `core/lib/tracker/files/milestones.mjs`, the derived `scope` and the read API agree on the new meaning, with tests for a non-Fibonacci value, a zero or negative value refused, and scope ordering by value per token.
- Design 3.2 and 2.4 say what the value unit is and that the quick choices are only a convenience for the person entering it.
- No milestone file in this repository needs migrating (none has a `serves` value yet); `hitld work check` is clean.

