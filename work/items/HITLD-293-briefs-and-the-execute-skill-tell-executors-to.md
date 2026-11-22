---
id: HITLD-293
title: Briefs and the execute skill tell executors to run the pinned CodeQL bundle on their changed code before reporting
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-189 c1]
---

## Why

The CodeQL result check is a real gate on pull requests (PR #196 failed it on two high alerts) and an executor cannot see it from a local `npm run check`. D-20 had to install the pinned CodeQL bundle by hand. The orchestrator now adds a sentence to each brief by hand. Changing the generated briefs and the execute skill's rules is a rule change, so the owner decides it.

## Done when

- `hitld dispatch start` briefs (core/lib/dispatch/brief.mjs), templates/AGENTS.contract.md and skills/execute/SKILL.md tell an executor whose change touches code to run `scripts/codeql-scan.mjs` before reporting, fix real findings in code (no suppression comments), and put the alert count before and after in the report's evidence.
- A test fixes the brief text.
- `npm run check` and `hitld work check` pass.
