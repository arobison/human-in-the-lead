---
id: HITLD-643
title: Design the GitHub Copilot adapter for VS Code agent mode and the cloud agent, starting with a refresh of the harness support table
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
---

## Done when

- The support table in design part 15.7 is refreshed against each vendor's current documentation for the Copilot surfaces (VS Code agent mode and the cloud agent), with the date checked, and anything that changed since 2026-11-14 is listed.
- The owner has walked through the Copilot adapter design one question at a time, and each answer is recorded as a decision.
- The design (part 15.5) says what is built and what is not, how the adapter treats hooks while they are in preview, and what each surface may be given.
- Build items are filed from the decisions, each with its own done-when.
- `hitld work check` passes.

## Why

The owner asked on 2026-11-20 when VS Code GitHub Copilot support is done, noting that Copilot's hooks support is now in preview, and decided that it comes after v0.1.0 (HITLD-642). The design already names Copilot as the next harness after Claude Code (part 15.5) and treats the VS Code agent-mode hooks (`preToolUse` and `postToolUse`) as preview, so that surface is a subset and gets public items only until they leave preview. No item or milestone builds the adapter.

From a search on 2026-11-20 (summaries of the vendors' pages, not a full read, so to be checked in the refresh): a `preToolUse` command hook can allow, deny or ask; a crash or nonzero exit denies, and a timeout lets the call proceed (fail open); `ask` is treated as deny under the cloud agent; the older local hooks format is deprecated and scheduled for removal in February 2027. A hook that fails open on timeout cannot alone carry a guard that has to fail closed, such as the classification read hook (HITLD-638) or the executor guard.

## What the design has to settle

- Whether the VS Code surface stays a subset (public items only) until hooks leave preview, and what other guard stands in for a hook that can fail open.
- What a custom agent per role (executor, reviewer, adversary) may be given, and how its model and tools are set.
- Dispatch: subagents under an orchestrating chat session (parallelism unconfirmed), and for the cloud agent, creating the task from a brief by assigning an issue or by the command line (in preview), and follow-up through pull request comments.
- Where the adapter's clearance sits on the classification rule (HITLD-637): what a Copilot model channel may receive.
- How the eval suite runs the same scenarios against Copilot (part 17.7, HITLD-33).

## Notes

Design-heavy: stays `proposed` and is walked through with the owner before any build. Placed after v0.1.0 under HITLD-408 clause c2 as a proposal, beside the other-harness work. Related: HITLD-616 (executors on other harnesses and models; a non-Claude executor first), HITLD-33 (live evals and the Copilot cloud agent profile), HITLD-54 (the thin MCP server), HITLD-540 (stay in the harness for now), design parts 15.3, 15.5 to 15.7 and 17.7.
