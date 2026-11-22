---
id: HITLD-960
title: A pilot runs small items on a local model through the executor contract and measures report-shape failures, test results and cost against a hosted model
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-541 c?]
---

## Why

There is no evidence that a local model can follow HITLd's long system prompt and strict report shape; the research found no study of small models' compliance with tool-use constraints, found that 4-bit builds change failure modes, and found long-horizon tool use 15 to 25 points behind frontier models on aggregate benchmarks. The owner wants to learn where roles can run, so we measure on our own tasks.

## Done when

- A pilot runs a fixed set of small, well-specified items (for example HITLD-269 and 274 class) on a local model through the executor contract in a sandbox, and on a hosted model as the control, with the same briefs.
- It records per run: report-shape failures (the parse errors `parseReport` raises), tests added and passing, whether the change met Done-when on an independent read, tokens and time, and cost or hardware used.
- It states a plain verdict: which item classes a local model handled, which it did not, and the failure modes.
- The model, quantization, serving stack, context length and hardware are recorded so the result can be repeated.
- `hitld work check` passes.

## Notes

rc.3. The first step after the design (HITLD-959) and the executor sandbox (HITLD-955); it does not need the whole design. Results are walk-through material for the owner, and the pilot never touches the merge path.
