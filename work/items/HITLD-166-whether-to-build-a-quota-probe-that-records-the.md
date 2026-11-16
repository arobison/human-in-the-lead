---
id: HITLD-166
title: Whether to build a quota probe that records the claude command's rate-limit reading
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Yes, build it with the declared figure as fallback: A work item, filed as proposed, is reviewed with the owner for its details before anything is built."
answered_at: 2026-11-16T01:23:33.952Z
answered_via: question-tool
answered_by: owner
---

## Question

Should the system build a quota probe that runs one minimal claude print-mode call and records the rate-limit event it prints as a real measurement for the quota gate?

In a cloud container the claude command's streaming output carries a rate_limit_event with the weekly utilization, the reset time, and the windows that exist. The documentation does not mention it. A probe would work locally and in the cloud, cost one tiny request per reading, and rely on an undocumented format. The owner's declared figure (HITLD-164) would stay as the fallback.

Reversibility: two-way.

## Options and recommendation

- A. Yes, build it with the declared figure as fallback: A work item, filed as proposed, is reviewed with the owner for its details before anything is built.
- B. Not yet, collect more samples first: The chief of staff runs the probe by hand a few more times to learn how fine the percentage is and whether the format is stable, then brings the data to the owner.
- C. No, keep declared figures only: HITLD-164 stays the only source.

Recommended: Yes, build it with the declared figure as fallback. It gives real percentages and reset times in every session, and the fallback covers a probe that fails.

## Answer

Recorded in the front matter once answered.
