---
id: HITLD-1048
title: "Study whether an LLM-written network is ever the right artifact: weight-space programming against a plain-code baseline, and what HITLD would offer other projects that need one"
kind: work
state: proposed
created: 2026-11-25
project: HITLD-15
---

## Done when

- A written note says, for one algorithmic job where a plain program is the obvious answer, what an LLM-written network cost against an LLM-written program: tokens, wall time, correctness on a held-out set, and what a reviewer can check from the artifact alone. The program is the baseline; the network has to beat it on something that matters, or the note says it did not.
- The note names the situations where a project needs a network and not a program (an algorithm embedded inside a larger neural pipeline, or a target with no general runtime), and says whether any project HITLD serves is in one.
- If the answer is yes, the note proposes the smallest thing HITLD would offer: the contract around any agent-generated artifact (a spec, a held-out eval the generator never sees, an eval gate, the owner's approval and provenance), with weights as one backend among several. If the answer is no, this item closes with the note as its record.
- `hitld work check` passes.

## Why

The owner wants the idea recorded so it is not lost, and explored later. Weight-space programming has an LLM write a network's weights directly, with no training. The original report (Takehi, Teoh, Zhang and Khattab) was informal and small, and a follow-up critique argues it amounts to writing a restricted class of programs. The looped variant (Heakl and others, 2026-11-23) reports an LLM-written transformer solving mazes and a 20-disk Tower of Hanoi at 100 percent on the authors' own test sets, at 39 minutes and $19, with readable weights; the thread's own top reply asks why not write a Python script, and the thread does not compare against one. Until that comparison exists there is no case for HITLD to build anything. Serves any project that must ship a model and not a program.

## Notes

Not for any near-term release: no milestone link, state proposed, so the owner commits it when it is wanted. From the owner's question of 2026-11-25. Evidence read: the thread text only (saved by the owner); the blog, demo and code at mbzuai-oryx were not reachable from the session, and every number above is the authors' claim, not checked. Related: HITLD-1045 (ledger durations, a possible data source for a trained baseline).
