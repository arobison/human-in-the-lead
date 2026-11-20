---
id: HITLD-616
title: "Design how a session calls out to executors on other harnesses and models: a non-Claude headless executor first, local models after"
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
---

## Done when

- The owner has walked through the design one question at a time, and each answer is recorded as a decision.
- The design parts (15.3 and 15.6 on harness adapters, 5.8 on the model catalog) say how an orchestrator or the chief of staff in one harness dispatches an executor in another harness or on another model, and mark what is built and what is not.
- Build items are filed from the decisions, the first being one non-Claude headless executor behind the existing adapter shape, each with its own done-when.
- `hitld work check` passes.

## Why

The owner asked whether there is an item to explore calling out from a Claude Code session into a ChatGPT (Codex) executor, or a local model run through something like pi or Ollama. Today it is one clause inside HITLD-508 (HITLD-541 holds only its control-plane study), parked behind the owner's decision to stay in the harness for now (HITLD-540). Mixing executors does not need a control plane: the design already says the core never calls a harness and a harness adapter carries out a dispatch (part 15.3), with Codex, Cursor, Copilot and Gemini as later adapters (15.6) and a model catalog as later work (5.8). Usage was at 0.90 of the weekly limit on 2026-11-20, so a second provider's executor would also relieve the shared Claude quota.

## What the design has to settle

- Whether a local model endpoint (Ollama, a minimal agent such as pi) is a harness adapter or a different adapter kind, since a model is not a harness and brings no tools, hooks or sandbox of its own.
- The first step: one non-Claude headless executor (Codex through `codex exec`, with JSON events) behind the adapter shape that Claude Code's headless own-session mode uses, and what it takes to run the executor contract and the scenario suite against it.
- Which catalog entries and calibration each model gets (first-pass yield, token-estimate bias), and how a new model enters as a trial (design 5.8, part 11).
- Routing: by execution profile, risk and data classification, including that confidential work goes only to a local model or to an approved provider, and who approves sending a project's code to another provider (the owner's decision, per kind of project).
- Trust: an executor from another provider earns standing on the trust engine separately (HITLD-507, 552), so its output gets the stronger check until it has a record.
- Quota and cost: each provider has its own limits and billing; the quota probe (HITLD-165) reads only Claude's, so the pace controller needs a reading per provider or a declared figure.
- Credentials: keys for another provider never enter the repository or the brief, and cloud sessions need a way to receive them.
- The executor contract and the instructions (AGENTS.md, skills) must read the same to a model that is not Claude, and the eval suite runs live across models (HITLD-12).

## Notes

Design-heavy: stays `proposed` and is walked through with the owner before any build. Split out of HITLD-508 on the owner's decision HITLD-615; HITLD-508 keeps the control-plane questions (where the owner interacts and where durable state and loops live). Related: HITLD-540 and 541 (stay in the harness; control plane later), HITLD-12 and 33 (live evals across models; the Copilot cloud agent profile), HITLD-561 (execution profile from measured history), HITLD-560 (executor budget), HITLD-165 (quota probe), design parts 15.3, 15.6 and 5.8. Placed under HITLD-567 clause c3 (an item's execution profile: mode, model and effort) as a proposal for the owner to move; it follows the measurement-tool walk-through (HITLD-609).
