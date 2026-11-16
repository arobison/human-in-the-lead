---
id: HITLD-436
title: A completion's token count cannot be corrected, and the estimator takes one outlier as the typical cost
kind: work
state: in-progress
created: 2026-11-16
project: HITLD-15
claimed_by: D-34
release_note: "`hitld ledger correct-tokens` corrects a completion's recorded token count with a new ledger event. A completion's tokens now count output plus fresh input, never cache reads; `hitld dispatch complete` refuses a figure three times the dispatch's estimate or more without `--tokens-over-estimate`, and records the start estimate beside the actual, which `hitld ledger summary` shows. The token estimate uses the median of at least three similar completions, and the tier default below that."
---

## Done when




- A completion's recorded token count can be corrected by a supported command (or a `logged` event the ledger and the estimator both honor, with `corrects` naming the entry), so a wrong figure is fixed without editing the ledger by hand; the correction is itself in the ledger.
- `hitld dispatch complete --tokens` names what it counts (output tokens plus fresh input, not cache reads) and refuses or warns on a figure far above the planner's estimate for the item, so a cache-read total cannot be recorded as a cost by mistake.
- The estimator does not take a single completion as the typical cost: it uses a robust figure (for example the median with a minimum sample, or a cap relative to the estimate) and says when the sample is too small. A test covers one outlier among several normal completions.
- The gate's burn calculation does not read the token figure of a completion; if it does, a test shows an outlier cannot distort it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Found by the orchestrator on 2026-11-16 and reported by it: when it completed the headless run D-27 (HITLD-343, which ended `blocked` after 88 seconds and about 8k output tokens), it passed `--tokens 1882000`, the run's input plus cache-read total from the result file. The ledger then held 1,882,231 tokens against HITLD-343, `ledger summary` reported that as the cost per accepted item, and the planner's estimate for the next items became about 1.88M tokens each; a generated brief said "Budget: ~1882k tokens; report at 2823k". The real cost was about $1. There is no supported command that corrects a completion's token count.

## Notes

Related: HITLD-81 (agent-shaped estimates), HITLD-298 (`estimate_tokens` on), HITLD-139 and HITLD-112 (token accounting). Proposed milestone: HITLD-408 (HITLd measures its own work), clause c1; the owner places it.

Evidence added 2026-11-16 (the orchestrator's one correction attempt, reported to the chief of staff): `hitld ledger append '{"event":"logged","item":"HITLD-343","dispatch":"D-27","corrects":"reported-D-27","text":"...","tokens":8065}'` was refused with `{"ok": false, "error": "forbidden-field", "message": "a logged event may carry only event, text, item, dispatch, area, notes, corrects; not tokens"}`. The raw-append allowlist in `core/lib/cli/commands/ledger.mjs` (RAW_APPEND_FIELDS) has no `tokens` on any event, and a `reported` event cannot be raw-appended at all, so a completion's token count has no supported correction. Afterwards `hitld ledger summary` still read `tokens_per_accepted_item` total 1,882,231 and the plan's estimate for HITLD-149 was 1,882,231 tokens (400,000 before D-27): the estimator takes the one event as the typical cost. A gate check that an item's estimate would cross the reserve reads that estimate, so with about 9 points of headroom the inflated figure can hold every item on cost; HITLD-421 started only because the owner set the critical threshold by hand. Until this is fixed the planner's cost figures are not to be trusted for any new start.
