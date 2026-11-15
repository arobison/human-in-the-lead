---
id: HITLD-39
title: First-run setup walk-through in the orchestrator skill
kind: work
status: Done
created: 2026-11-14
project: HITLD-15
needs: [HITLD-37, HITLD-38]
claimed: D-39
---

## Why

Per design 13.4: a new person or machine must be set up in the main session, with detected values and sensible defaults, before autonomous dispatch starts. Until then conservative defaults apply.

## Done when

- With no person or machine file, the orchestrator skill runs `hitld machine detect`, asks a few questions with recommendations, writes the files through `hitld config write`, and shows `hitld config explain`.
- Until setup is done, autonomous dispatch waits and one executor at most runs work the person starts by hand.
- An executor cannot run the setup.
- An offline eval scenario covers the walk-through and the wait.
- The walk-through offers the status-line usage capture as opt-in, says what it changes in the person's harness settings, and installs it only on a yes. (Already done in `hitld install`: it installs the capture only with `--statusline`; `--no-statusline` is accepted and does nothing. The walk-through only has to ask and then run that.)
- The status-line readout (design 12.1.1) is HITLD-56.
