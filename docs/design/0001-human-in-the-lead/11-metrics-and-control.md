# 11. Metrics and feedback controllers

[Back to the index](../0001-human-in-the-lead.md)

Every metric here traces to a term of the objective ([part 1](../0001-human-in-the-lead.md#13-the-objective)): value delivered and its delay, the owner's attention, tokens, quality, or relationships. Metrics are computed by scripts from three sources: the tracker's history (git history of item files, for the files backend), the ledger, and test and benchmark results. No metric needs an agent to compute it.

## 11.1 Measures

### Flow

| Measure | Definition | Source |
|---|---|---|
| **Stocks and flows per queue** | For each queue in [part 2](02-loops.md): items waiting (stock), arrivals and departures per period (flows) | Tracker history, ledger |
| **Lead time** | From an item's `planned` to `done`; also from a signal's arrival to the release that resolves it | Tracker history |
| **Critical-path progress** | For each active milestone: items done on its critical path over items on it; and the estimate tokens remaining on the path | Tracker, estimates |
| **Slot utilization** | Busy executor-slot time over (concurrency cap × run time) | Ledger |
| **Blocked time** | Time items spend ready-but-waiting: on a decision, a serial resource, or the merge queue, broken down by cause | Tracker history, ledger |
| **Decision latency** | From a decision being asked to being answered, split into queue time (held for a digest: `asked` to `sent`) and owner time (shown, unanswered: `sent` to `answered`). Median and 90th percentile. A decision never recorded as shown has no queue time, and its owner time runs from `asked` | Ledger |

### Cost

| Measure | Definition | Source |
|---|---|---|
| **Tokens per accepted item** | All tokens of all dispatches attributed to an item (executor, retries, acceptance, adversary, review) for items merged and not reverted, divided by their count; by tier and item type | Ledger |
| **Waste** | Tokens on dispatches whose output was discarded: retried, dropped, reverted. Speculation cost is reported separately | Ledger |
| **Orchestrator overhead** | Orchestrator tokens over total tokens in a run | Ledger, session usage |
| **Onboarding tokens** | Tokens an executor consumed before its first edit tool call. Where the harness exports telemetry with token use per request and timestamped tool decisions (Claude Code's OpenTelemetry export is the intended source, collected locally), from that. Session transcript files are not parsed, because their format is not a stable interface. Not measured on harnesses without such telemetry | Telemetry → ledger |
| **Token estimate error** | Per item type: accuracy as the mean of log(actual / estimate) (bias), and precision as its standard deviation (spread) | Ledger |

### Quality

| Measure | Definition | Source |
|---|---|---|
| **First-pass yield** | Share of items whose first executor report passed verification and merged without a follow-up round; by tier, item type and area | Ledger |
| **Change failure rate** | Share of merged items later reverted or followed by a fix item that cites them | Tracker links, git |
| **Rework rate** | Share of merges that are unplanned fixes for recently merged changes (DORA's deployment rework rate, adapted to merges) | Tracker links |
| **Recovery time** | From a sev-1 or sev-2 being raised to the rollback or fix that ends user impact | Tracker history |
| **Escaped defects** | Defects found after merge, per area, tier, model and skill version, with reliability growth per area ([part 6](06-verification.md#65-reliability-over-time)) | Tracker, provenance |
| **Review yield per token** | Confirmed findings per review token; the same for adversarial passes | Ledger |
| **Mutation score on changed lines** | Killed mutants over all mutants in changed code | Verification output |
| **Flake rate** | Test failures that pass on rerun with no change, over all failures | Per-test history from the test reporter ([part 14.7](14-integration.md#147-flaky-tests)), merge queue logs |

### Attention and relationships

| Measure | Definition | Source |
|---|---|---|
| **Decisions per period** and **reads per period** | Owner attention spent, against the budget | Ledger |
| **Auto-resolution rate** and **overrule rate** | Share of questions resolved by precedent; share of those the owner reversed | Tracker |
| **Rubber-stamp share** | Per area, of the answers that record both whether the recommendation was taken and how long the owner took, the share that took it within `trust.rubber_stamp_seconds` of the question being shown. A high share is a prompt to look: either the recommendations are good or the owner is not reading. Its pair is the overturn count: answers stamped and later reversed. The digest lists it per area | Trust record |
| **Escalation worth** | Of the questions rated, the share rated worth asking. Each question offers the optional rating; "that was not worth asking", said right after an answer, rates that answer. A later rating of the same decision replaces the earlier | Trust record |
| **Time to first response** | For external issues and PRs, per source and trust level | Intake, send gate |
| **Contributor retention, bus factor** | [Part 9](09-contributors.md#95-community-health) | Tracker, git |

**DORA, adapted.** The DORA delivery measures (change lead time, deployment frequency, recovery time, change fail rate and rework rate; check dora.dev for the current set) map here to lead time, merges and releases per period, recovery time, change failure rate, and rework rate. The adaptation is that an agentic flow merges far more often than a team deploys, so the unit is the merge for the throughput measures and the release for the user-facing ones.

## 11.2 Who moves what

`policy.json` holds every tunable setting with **bounds the owner sets**:

```json
{
  "execution": {
    "concurrency": { "value": 3, "min": 1, "max": 6, "controller": "concurrency" }
  }
}
```

These are the built defaults. Until the "Controllers" milestone, no controller moves the value; from then on the concurrency controller does.

- A **controller** may move a setting's `value` inside its `min` and `max` without asking. Every move is logged in `controller-steps.jsonl` ([12.3](12-reporting-and-limits.md#123-inspectable-controllers)) with the measurements that caused it, and each digest carries a short summary of the moves since the last one. The run-state file holds each setting's current value.
- Moving a setting **outside its bounds**, changing a bound, adding a setting, or changing a controller's rule is a **rule change**: the owner's decision ([part 4](04-decision-rights.md#42-when-the-owner-is-involved)).

## 11.3 Goodhart pairs

When a measure becomes a target, it stops being a good measure (Goodhart's law, as it is usually paraphrased). So every target metric is reported with a **pair**: a metric that gets worse if the first is gamed or over-optimized. A controller acting on a metric must check its pair, and a retro proposal must state both.

| Metric pushed up or down | Its pair, which must not get worse |
|---|---|
| Throughput (merges, items done) | Change failure rate, escaped defects |
| Tokens per accepted item ↓ | First-pass yield, escaped defects |
| Decision latency ↓ | Overrule and reversal rate of answered decisions; rubber-stamp share |
| Auto-resolution rate ↑ | Overrule rate of precedent applications |
| Slot utilization ↑ | Blocked time, merge conflicts, rework rate |
| Review allocation ↓ (fewer reviews) | Escaped defects in unreviewed areas |
| Mutation score ↑ | Test runtime, flake rate |
| Token estimate accuracy | Appetite use: estimates must not be padded so that every item "comes in under" |
| Time to first response ↓ | Share of threads where the contributor had to repeat themselves |
| Onboarding tokens ↓ | First-pass yield (a too-short brief that skips context fails later) |
| Knowledge-base freshness ↑ | Gardener tokens per useful update |
| Quarantine size ↓ | Escaped defects in quarantined areas ([part 14.7](14-integration.md#147-flaky-tests)) |
| Flake cost ↓ | Burn-in and comparison runs spent |
| Orchestrator overhead ↓ | Questions it failed to batch; decisions sent that precedent would have resolved |

## 11.4 Feedback controllers

Seven controllers: the five below, merge batch size and the flake comparison run count (both in the last two rows). Each names its sensor, its actuator, its rule and its pair. Every evaluation is logged with its sensor values, setpoint, action and reason, and can be replayed with different settings ([part 12](12-reporting-and-limits.md#123-inspectable-controllers)).

| Controller | Sensor | Actuator | Rule | Pair checked |
|---|---|---|---|---|
| **Sizing** | First-pass yield per item type and tier, over the last `n` completions | Default tier for that item type | Below `fpy_low` with at least `min_samples`: raise the default tier one step. Above `fpy_high` with at least `min_samples`: try one step lower on the next items of that type. Between: hold | Tokens per accepted item |
| **Concurrency** | Merge conflicts needing rework; serial-resource waits over `wait_max`; admission waits for a loaded machine; flake rate, in particular rising with executors ([part 14](14-integration.md#load-and-concurrency)); orchestrator context pressure | `execution.max_executors` | Additive increase, multiplicative decrease: after `k` clean completions, `+1`; on any congestion signal, decrease by one when the cap is 4 or less, and halve above that (rounded down, not below `min`) | Slot utilization, blocked time |
| **Review allocation** | Confirmed findings per review token, and per adversarial token, per area and tier | Review probability and adversarial budget per area and tier | Allocate in proportion to yield, with a floor (`explore_floor`) so that every area keeps being sampled; raise to the maximum for an area with a recent escaped defect | Escaped defects |
| **Question timing** | The owner's recent answer latency and activity (answers in the last interval) | Digest interval; whether non-urgent questions go out now | When the person is answering quickly, shorten the interval, and non-urgent questions may go at once; each one counts against their attention budget and quiet hours hold them. When they are quiet, hold for the next digest. Critical-path and idle-slot questions always go at once (quiet hours permitting). Whether non-urgent questions may go at once is a per-person setting ([13.4](13-operations.md#134-settings-in-four-layers), [part 23](23-people-in-the-lead.md#235-the-interface-as-a-design-surface)) | Decision latency, owner overrule rate |
| **Budget** (quotas, including the run token budget) | Headroom above the owner's reserve for every quota, and projected exhaustion against each window's reset ([part 12](12-reporting-and-limits.md#125-quotas-and-budgets)) | Model and tier choice; concurrency; which items may be dispatched; whether to dispatch at all | Economize below `quota.economize_below` (cheaper models where sizing allows, lower concurrency); critical-path only below `quota.critical_below`; stop autonomous dispatch at the reserve; ask the owner before exceeding any `hard` quota | Critical-path progress; first-pass yield (economizing must not cost more in retries than it saves) |
| **Merge batch size** | Batch failure rate and bisection cost ([part 14](14-integration.md#146-measures)) | `merge.batch_max` | Smaller after failures, so bisection is cheaper; larger after a run of clean batches | Queue wait |
| **Flake comparison runs** | Flake rate, and how often a comparison was inconclusive ([part 14.7](14-integration.md#147-flaky-tests)) | `flake.compare_runs`, below the ceiling `flake.compare_runs_max` in `policy.json` | More runs when comparisons are inconclusive; fewer after a run of clear ones | Flake cost |

The concurrency and budget controllers act on one project's settings, but the caps and quotas they work under are shared. The person's appetite for parallel agents and the machine's maximum apply across every project on the machine, and the person's limits and reserve apply across every machine; the strictest layer wins ([part 13](13-operations.md#134-settings-in-four-layers)).

### Stability rules

Controllers acting on delayed, noisy signals oscillate if left alone. These rules apply to all of them:

1. **One setting at a time.** At most one controller moves at most one setting per evaluation, so that each effect can be attributed. The others hold until its effect is measured.
2. **Minimum samples.** No move before `min_samples` observations since the last move of that setting.
3. **Hysteresis.** Raise and lower thresholds are separated (for example, `fpy_low` and `fpy_high`), so a value near one threshold does not flip back and forth.
4. **Leading indicators.** Controllers use the earliest signal available (a first failed check, a queue growing) rather than lagging ones (escaped defects found much later), and the lagging ones are used to audit the controllers.
5. **Bounds.** Controllers never leave the owner's bounds (11.2).
6. **Oscillation detection.** If a setting reverses direction more than `reversals_max` times in `window` moves, its controller freezes it and proposes a rule change to the owner.

## 11.5 Changing the system

Changes to skills, briefs, the executor contract, controllers or policy are **experiments**, not edits.

### Process studies

Each change is a process study, in the same shape as product studies ([part 3](03-data-model.md#study-run-verdict)):

- **Question** and **hypothesis**: "Shortening the brief template by pointing at the area page instead of listing pitfalls lowers onboarding tokens by at least 15% without lowering first-pass yield."
- **Metric** and its **pair**.
- **Method**: replay or live interleaving (below).
- **Minimum sample** before a verdict.
- **Verdict**, citing the replay or ledger evidence.

Adopting a change is the owner's decision, with the study as the evidence.

### Replay

The ledger records each dispatch's brief hash and skill versions, and the tracker and git record the repository state at each claim. A **replay** reruns past items against a new skill or brief version:

1. Pick a sample of completed items, stratified by tier, area and item type.
2. For each, check out the repository at the claim commit's parent, and dispatch the item again with the new version, in a scratch worktree, with the original "done when" and the original acceptance checks.
3. Compare first-pass yield, tokens, onboarding tokens and verification findings against the original dispatches.

Replay costs tokens, so its sample size follows the value of the decision it informs. It cannot measure effects that depend on the owner (decision latency) or on time (escaped defects); those need live evaluation.

### Live interleaving

For effects replay cannot measure, the new and old versions are assigned to comparable items in alternation during normal runs, and compared once both have `min_samples`.

### Recalibrating on model changes

A new model, or a new version of one, changes every estimate. When the model behind a tier changes:

- token estimators for that tier reset their scale factors and widen their spread until new samples arrive;
- sizing defaults for that tier return to the policy defaults;
- the human-read sampling rates for areas the tier touches return to defaults ([part 6](06-verification.md#65-reliability-over-time));
- a replay of a standard sample is run, so that the change is measured before it is trusted.
