---
id: HITLD-127
title: "Live evals across models and providers, on accounts the owner chooses"
kind: work
state: proposed
created: 2026-11-15
project: HITLD-28
needs: [HITLD-33]
constraint_of: [HITLD-70 c2]
---

## Why

Live evals need a model to run, and spend from an account. Which accounts they may use must be the owner's explicit choice, never whatever credentials happen to be at hand. A single provider would also say nothing about how the skills hold up on other models.

## Done when

- A study compares ways to run the live scenarios on several models: the Claude Code harness on the owner's own subscription (headless), the Anthropic API with the owner's own key, other providers' APIs or a router across them, and local open-weight models; for each, what it can run (the harness's tools and skills, or only a model with tool calls), its cost per suite run, and what it cannot test.
- A provider-neutral adapter lets `hitld eval --live` name the model and provider per run; credentials come only through `hitld env exec` secret tasks the owner declares, and a run refuses any provider or account the owner has not explicitly declared.
- Each result records the provider, model and harness, and the gate keeps a baseline per combination.
- A budget per run and per month stops the suite before it spends more than the owner set.
- Design part 17 describes it; the owner decides which providers to enable.
