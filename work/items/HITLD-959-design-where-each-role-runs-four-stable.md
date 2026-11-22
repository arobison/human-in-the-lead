---
id: HITLD-959
title: "Design where each role runs: four stable interfaces (task spec, sandbox provider, harness adapter, model endpoint) and a per-role placement policy"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-541 c?]
---

## Why

The owner wants the system to stay flexible as the ecosystem develops and as we learn where each role should run: on hosted, local-sandboxed or cloud infrastructure, with any provider's agent or a local model, for the reasons of quota and cost, privacy, independence from one provider and offline use (decision HITLD-958). Research on 2026-11-22 (local sandboxes, hosted sandboxes, other vendors' headless agents, local inference, agent security) found that most harnesses share one shape (a prompt in, JSON events out, a final result, an exit status, tool permissions) but no shared field names or standard, that the real security boundary belongs in the sandbox and the egress proxy and not in harness permission flags, and that no study measures small models' compliance with a strict report contract.

## Done when

- A design (a part of the design document) defines four stable interfaces with everything behind them swappable by configuration: a task specification (role, repository ref, prompt, allowed tools, output schema, budget, egress allowlist); a sandbox provider (create, run, stream, collect artifacts, destroy, with local container or microVM, hosted service and CI runner behind it); a harness adapter per command-line agent that normalizes its events to our executor report as the result envelope; and a model endpoint (OpenAI-compatible and Anthropic-compatible) reached through an egress proxy that injects keys so no agent holds one.
- A per-role placement policy says which roles may run where and on which class of model, with the constraints the research supports: an executor may run on a weaker or local model if contained (no secrets, proxied egress, its own branch only, independent checks on its output); the merge step is deterministic, never a model's decision; the assistant that records the owner's word is never a weak model and never the recorder of approvals (a system records them from authenticated events); reviewers use the strongest model.
- The Rule of Two (no session combines untrusted input, sensitive data and an external write channel) is applied to each role, and where a role breaks it the design says how it is split.
- Credentials: a local executor needs no forge credential when the orchestrator verifies and pushes its branch; a cloud executor uses the executor App; model keys are injected by the proxy.
- A gateway layer, if any, is our own thin proxy or hash-pinned (a popular gateway was compromised on PyPI twice in 2026).
- Per platform, a recommended local sandbox (a microVM per agent on macOS; rootless Podman with gVisor on Linux; a hardened WSL2 distro on Windows; microVMs under a proxy as the strongest) and the default-deny read rules each needs.
- The owner's choices are walked through one at a time and recorded as decisions, and the builds are filed with their release.
- `hitld work check` passes.

## Notes

The research reports are summarized in the owner's session of 2026-11-22; most of their figures came from search summaries and need checking before they are relied on, and every post mid-2026 model name or score is unverified. rc.3. The pilot is HITLD-960. HITLD-955 (local executor sandbox) and HITLD-956 (executor profile) are built provider-agnostic from the start. Design home: the 'HITLd runs above the harness' milestone (HITLD-541).
