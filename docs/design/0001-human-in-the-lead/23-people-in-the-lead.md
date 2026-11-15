# 23. The people in the lead: judgement, calibration and the interface

[Back to the index](../0001-human-in-the-lead.md)

This part is about the people who make the calls: the owner and every area owner. It covers how their calls are recorded, how much each person's quick read counts, what feedback each person gets, and how the system asks them things.

## 23.1 Why

Other people trust this system's output because accountable people stand behind it. A contributor accepts a decline because a maintainer made it. Evidence makes the output correct; named people with a record make it trustworthy to others.

People differ. Skill, judgement, gut checks and calibration vary between people, and between areas for one person. Treating every word the same wastes good judgement or over-trusts weak judgement. Never telling people how their calls turned out leaves them no way to improve.

So two things are design surfaces in their own right:

- **the record of each person's judgement**, and the feedback it makes possible;
- **the interface between the system and each person**: what it asks, how, and when.

Both are general: nothing assumes one particular owner, and every setting is per person.

## 23.2 The judgement record

Every call a person makes is recorded at the moment it is made. That covers gut checks and considered judgements on signals and projects being shaped ([part 3](03-data-model.md#judgement)), and answers to decisions ([part 3](03-data-model.md#decision), [part 4](04-decision-rights.md)). The **judgement record** is the per-person view over all of them.

**What is new.** Judgements already record `what`, `basis`, `by`, `at` and a derived `weight`; decisions record their answer, rationale and channel. Both gain four fields. The first three are recorded from "One signal end to end" ([Q22](22-open-questions.md#q22-do-the-new-judgement-record-fields-join-one-signal-end-to-end-affects-its-record-scoring-waits-for-people-in-the-lead)); `outcomes` comes with the "People in the lead" milestone:

| Field | Notes |
|---|---|
| `confidence` | Optional, one tap: `sure`, `fairly-sure` or `unsure`. Skipping it is always allowed and is not read as `unsure` |
| `expected` | Optional: what the person expected to happen, in a few words ("halves upload time", "nobody will miss it") |
| `evidence_at_time` | Derived: the IDs of the signals, studies, runs and precedents the question or project showed when the call was made |
| `outcomes` | Derived, appended later: each matched outcome with its source, a verdict (`held`, `missed`, `mixed`, `not-observable`) and the evidence |

`evidence_at_time` matters because hindsight rewrites memory: a call is judged against what was known when it was made.

**Where the record lives.** The record's fields and the learned weights live in the private store and the person layer ([13.4](13-operations.md#134-settings-in-four-layers)). A public entity, such as a public signal, carries only what was judged, the basis and who (`what`, `basis`, `by`). Otherwise anyone could rebuild a person's calibration from public files, which would defeat the privacy in 23.4.

**Matching outcomes.** Outcomes come from sources the system already has:

| Source | Example |
|---|---|
| Study verdicts | A gut check that an approach would be fast; a study then measures it |
| Measurements | A benchmark run after the change ships |
| Outcome checks ([part 2](02-loops.md#210-outcome-sensing)) | The shaped problem is solved, partly solved, or not |
| Reversals | The person, another decider or a revert undoes the call; a precedent drawn from it is overruled |

An agent proposes each match with its evidence. The person can dispute a match, and the dispute is recorded: matching is a judgement too. Calls that never get an outcome stay as `not-observable` and are left out of every score; the review says how many there are.

One limit is stated wherever results are shown: an outcome is usually observed only for the option chosen. Nobody learns what the rejected option would have done, unless a study tested both.

## 23.3 Calibration as a prior

How much a person's quick read counts in prioritization ([part 2](02-loops.md#24-prioritization)) is learned from their record, per person, per area and per basis.

- **Starts from the person layer.** Each person's starting weight per basis is in the person layer, not in the committed `policy.json`. Without one, the design's default applies. The owner's gut checks start high. A new area owner starts at the default (23.6).
- **Tunes itself, by shrinkage.** A weight is pulled toward the default and moves only as far as its evidence supports. With few outcomes it barely moves; with many, it follows the record. There are no owner-set bounds, and no owner decision per change.
- **Two fixed rules.** They are part of the design, not settings. No one's judgement is weighted to zero. No one's gut check alone overrides contrary evidence (below).
- **Never fixed.** The trust-calibration loop ([part 2](02-loops.md#215-trust-calibration)) keeps comparing judged items with outcomes. Recent calls count more (`judgement.half_life`, counted in calls), so improvement shows in the weight.
- **Learned per confidence level.** When a person taps a confidence, the weight for that level comes from how their calls at that level held up. Saying `sure` more often buys nothing: if `sure` calls miss, the weight of `sure` falls.
- **Recorded, and seen by its person.** Each change is logged with its basis (calls, share held, area). Each person sees their own weights in their private review (23.4). Decided: [Q24](22-open-questions.md#q24-who-decides-a-change-to-a-persons-prior-weight-blocks-people-in-the-lead).

Why tuning needs no decision: a weight is an estimate from data, like a measured rate, and shrinkage keeps it from moving on thin evidence. The rules that bound it are fixed in the design, so tuning inside them is not a rule change, and it grants no one autonomy.

Calibration weighs inputs; it does not grade people. A weight never changes anyone's decision rights ([part 4](04-decision-rights.md#45-several-humans-in-the-lead)).

**Disagreement with evidence is surfaced, never resolved silently.** When a study, a measurement or research contradicts a person's call, the judgement is held out of the estimate, and the conflict goes to that person with the evidence and a recommendation ([part 3](03-data-model.md#judgement)). The system neither overrides them quietly nor defers to them quietly (the last anti-goal in [part 1](../0001-human-in-the-lead.md#goals-non-goals-anti-goals)). If they hold their view, the call stands where it is theirs to make, the record keeps both, and the outcome later shows which was right.

## 23.4 Feedback to the person: the calibration review

The **calibration review** is a periodic report to one person about their own calls. Its purpose is that person's improvement.

| Section | Content |
|---|---|
| **Reads that held up** | Calls whose outcomes arrived and held, especially gut checks that research or a study later supported |
| **Over- and under-confidence by area** | Per confidence level and area: how many calls, and the share that held. "Of 14 `sure` calls on caching, 13 held; of 9 on the build, 5 held" |
| **The decision journal** | Decisions whose outcomes arrived since the last review: the question, the evidence available then, what the person expected, what happened |
| **Scores** | Where calls carried a confidence or a stated probability, the Brier score (the mean squared gap between stated probability and outcome) per area, with the count it rests on. Taps map to probabilities set in `judgement.confidence_levels` |
| **Disputed matches** | Matches the person disputed, and how each was settled |
| **Your weights** | The person's current weights per area, basis and confidence level, and how they moved since the last review (23.3) |
| **Proposed changes** | Interface defaults the record suggests (23.6) |

**When.** After `review.every_outcomes` new outcomes, or at the person's cadence. It counts as a read against their attention budget, and its first screen fits a phone.

**Private by default.**

- The review is `confidential`, kept in the private store, and shown only to its person.
- **No leaderboard.** No readout compares or ranks people; the core has no query that returns several people's calibration side by side.
- **Each person sees only their own** review and weights. Weights tune themselves, so the owner needs no view of anyone else's; the person may share theirs.
- Until a decider's identity is authenticated (Q21), this privacy is a rule the core and readouts enforce, not a cryptographic guarantee. The review says so.

**The risk: feedback makes people hedge or game.** People may retreat to `unsure`, skip the tap, or avoid hard calls. Three guards:

- **Proper scoring.** The Brier score ([20.6](20-prior-art.md#206-decision-science-and-human-factors)) is a proper scoring rule: a person gets the best expected score by stating what they believe. Hedging toward even odds and inflating toward certainty both score worse on average.
- **Hedging is visible.** The review shows how often the person skipped the tap or chose `unsure`.
- **Every call is recorded.** Only the tap is optional; skipping it does not take a call out of the record.

## 23.5 The interface as a design surface

Most of the interface is specified elsewhere; this section gathers the principles.

| Principle | Where it is specified |
|---|---|
| **Questions stand alone**: recommendation first, then each option with what it costs and whether it is reversible, then the precedent offer | [Part 4](04-decision-rights.md#the-decision-question) |
| **Questions arrive when they are worth the interruption**: batched into digests; at once for the critical path, idle slots or a sev-1, and, if the person's setting allows, for non-urgent questions while they are answering quickly (each counts against their attention budget); quiet hours held | [Part 2](02-loops.md#the-owners-attention-as-a-budget), [part 5](05-execution.md#55-the-question-protocol), question timing in [part 11](11-metrics-and-control.md#114-feedback-controllers) |
| **Each person has an attention budget**: decisions, interrupts and reads, with their own cadence and quiet hours | [Part 2](02-loops.md#the-owners-attention-as-a-budget), [part 4](04-decision-rights.md#45-several-humans-in-the-lead) |
| **Everything answers from a phone**: questions, review packs and reports, through the harness's remote access | [Part 7](07-ux.md#76-owner-review-made-phone-friendly), [part 12](12-reporting-and-limits.md#122-progress-reports), [part 15](15-architecture.md) |
| **The person rates the question**: the one-tap "worth asking?" signal | [Part 2](02-loops.md#215-trust-calibration) |

Three additions:

- **The record rides in the question.** The confidence tap and `expected` are one optional line under the options; they never block an answer.
- **A full budget routes only easy-to-undo calls.** When the person's decision budget is full, only calls that are easy to undo take their recommendation, each logged and listed in the next digest. A call that is hard to undo always waits ([part 2](02-loops.md#the-owners-attention-as-a-budget)).
- **The attention budget is five keys in the person file** (`attention`, schema version 2). `decisions_per_digest` (default 5) is how many decisions may be in front of the person at once through digests. `interrupts_per_day` (default 3) is how many questions may be sent at once in any 24 hours. `quiet_hours` (default 22:00 to 07:00) are windows, read in `timezone` (default: the machine's own), in which nothing is sent at once. `non_urgent_at_once` (default 0) is how many questions that are not urgent may be sent at once while the person is answering quickly; 0 keeps every non-urgent question for a digest. `answering_window_minutes` (default 30) is what counts as answering quickly. The owner's ceilings are `attention.decisions_per_digest_max` and `attention.interrupts_per_day_max` in `policy.json`; the lower value applies.
- **Where each question goes is computed, not guessed.** `hitld rights pending` lists the open questions in the order of what waiting costs, with the budget left, and gives each one `deliver: now | digest | hold | default` and the reason. Cost of delay is derived from what the question blocks: the open items that need it, directly or through others, each weighted by its priority where the project declares one. A question is urgent when it sits on the critical path (the longest chain of open work, weighted by estimates), or when answering it makes ready the work that fills executor slots that would otherwise idle. In order of cost of delay:
  1. A default whose deadline has passed is `default`.
  2. An urgent question is `now`, using one interrupt. Quiet hours make it `hold` until they end; with no interrupt left in 24 hours it is `digest`.
  3. A question that is not urgent is `now` only when `non_urgent_at_once` allows it, the person answered within `answering_window_minutes`, no quiet hours apply and an interrupt is left. Otherwise it is `digest` while a place is left. A place is used by every question shown to the person and not yet answered, so `decisions_per_digest` caps what is in front of them.
  4. When the digest is full, a two-way question is `default`: it takes its default, else the recommendation. A question that is hard to undo is `hold`, and waits for room.

  Only a sev-1 breaks quiet hours, and a sev-1 is a page, not a question. A question counts as sent at once when it was asked with `--send` or shown with `hitld rights show --interrupt`; shown without it, it counts as part of a digest. The same ranking and the same budget apply to each person, from their own file.
- **The digest is built from the records, once.** `hitld rights digest` builds it from the ledger, the tracker and the private store, never from the orchestrator's memory, and `hitld dashboard` writes the same text to `digest.txt`. It fits one phone screen: at most 30 lines of 56 characters. It lists questions first, ranked by cost of delay with the recommendation inline, then what is still waiting, the calls made without asking (each with the command that reverses it), precedent applied, items merged, flaky tests and the quota lines. A section that does not fit is shortened, and says how many entries it left out; `--full` gives the whole text. It shows only what is new since the read cursor, a time in the private store that `--mark` moves when the digest is sent; marking also records each question in it as shown, which ends its queue time.
- **The digest has two triggers, and the orchestrator makes the call.** At `merge-batch`, after a batch of merges, quiet hours hold it back. When the owner writes (`owner-writes`) it goes at once: the owner is there, and nothing reaches them that they did not ask for. The result carries `delivery` (`send`; `hold`, with `hold_until` when quiet hours end; or `skip`, when nothing is new) and `urgency` (`interrupt`, when a question is needed now, so the channel may notify; `routine`; or `none`), so a channel acts on the result without reading the text. There is no timer: the cadence is the orchestrator's, and a later decision may set thresholds for when it calls.
- **Settings are per person.** Context level, cadence, quiet hours, channel, the confidence line, whether non-urgent questions may go at once, and how much the status line shows ([part 12](12-reporting-and-limits.md#1211-the-status-line-planned)) live in the person's own settings file, outside any repository ([part 13](13-operations.md#134-settings-in-four-layers)). A person changes their own interface settings without a rule change. The project's `policy.json` keeps what the owner sets for each person: their decision rights and the ceiling of their decision budget.
- **Question quality is evaluated.** The eval suite ([part 17](17-evals.md)) gains scenarios that check generated questions for recommendation first, cost and reversibility on every option, and length, deterministically; and for standing alone, by a judge checked against human labels.

## 23.6 Different people, different defaults

People new to the lead need more help. The defaults differ, and both adapt from the record.

| Setting | A new co-maintainer | An experienced person |
|---|---|---|
| **Context per question** | Fuller: background, the precedents that nearly matched, knowledge-base links | Terse: question, recommendation, options |
| **Starting prior weight** | The design's default | Higher, from their person layer, then tuned by the record |
| **Decision rights** | Narrow: a few rule bases in one area | As delegated |
| **Owner visibility** | First decisions shown to the owner in the digest ([part 4](04-decision-rights.md#45-several-humans-in-the-lead)) | The audit trail only |
| **Calibration review** | After fewer outcomes, so feedback comes early | At the person's cadence |

**Adapting.** A person who often opens the full context or asks follow-ups gets more; one who answers without opening it gets less. The review proposes these changes; the person accepts or declines.

**Onboarding to the lead.** Part 4 lists what a new co-maintainer receives ([4.5](04-decision-rights.md#45-several-humans-in-the-lead)). This part adds an optional **practice set**: past decisions in their area whose outcomes are known, answered blind, then shown with what was decided and what happened. It teaches the area's precedent and the confidence tap. Practice answers never move a weight, since hindsight may leak into them.

## 23.7 Measures

Each with its pair ([part 11](11-metrics-and-control.md#113-goodhart-pairs)):

| Measure, per person and area | Its pair, which must not get worse |
|---|---|
| **Calibration gap** ↓: stated confidence against the share that held, per level | Share of calls with the tap skipped or `unsure` |
| **Brier score** ↓ | Share of calls that get a score at all (scoring only easy calls) |
| **Prior usefulness** ↑: weighted judgements raised items that later realized value | Contradiction challenges sent per period |
| **Question quality** ↑: worth-asking rate; follow-ups needed per question | Escalation recall ([part 17](17-evals.md#174-metrics)): fewer questions must not mean missed ones |
| **Ramp of a new person** ↑: share of their decisions not reversed | Owner attention spent reviewing their decisions |
| **Review usefulness** ↑: the person's one-tap "useful?" on each review | Review length against its budget |

Each is reported only to its person.

<a id="238-in-v0-and-later"></a>

## 23.8 When each piece comes

| Piece | When |
|---|---|
| Judgements on signals (`what`, `basis`, `by` in public; the rest in the private store) with the starting weight from the person layer; "worth asking?" ratings and reversals | One signal end to end ([part 21](21-scope.md#what-it-contains)) |
| The person file: quiet hours, attention budget, question style, the status line | Before the first release ([13.4](13-operations.md#134-settings-in-four-layers)) |
| `confidence`, `expected` and `evidence_at_time` on judgements and decision answers, in the private store | One signal end to end (decided, Q22): a record started later cannot be backfilled honestly |
| Outcome matching, weight tuning, the calibration review, adapting each person's interface defaults, the practice set, question-quality evals | **People in the lead** ([part 21](21-scope.md#212-later-milestones)) |

Q22 to Q25, all decided, are in [part 22](22-open-questions.md).
