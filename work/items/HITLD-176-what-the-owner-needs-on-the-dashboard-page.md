---
id: HITLD-176
title: What the owner needs on the dashboard page
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "we designed a work page in another project that could serve as a basis for the built in dashboard here plus the stuff above where it's not already covered by this design, The plan: item dependency graph, Milestone progress, What's happening now, Quota and spend"
answered_at: 2026-11-16T01:46:06.966Z
answered_via: question-tool
answered_by: owner
---

## Question

What should the dashboard page show, so the owner has the whole plan in one file?

The dashboard shows the ledger, quotas and digest and no plan today. The dependency graph exists only as a mermaid view the owner could not see in a browser. Raised for HITLD-152.

Reversibility: two-way.

## Options and recommendation

- A. The plan: item dependency graph: Every item with its state and needs, grouped by project, with the critical path and ready items marked.
- B. Milestone progress: Each milestone's clauses, constraints done and what holds it up.
- C. What is happening now: Running executors, pull requests waiting, and decisions waiting with ages.
- D. Quota and spend: Weekly usage against the reserve and the forecast, and what sessions and probes have cost.

Recommended: The plan: item dependency graph. It is what the owner could not see.

## Answer

Recorded in the front matter once answered.
