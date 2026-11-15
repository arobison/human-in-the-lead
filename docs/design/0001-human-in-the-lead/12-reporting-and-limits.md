# 12. Reporting, monitoring and account limits

[Back to the index](../0001-human-in-the-lead.md)

The owner directs the system mostly from a distance, so what they can see matters as much as what they can decide. This part covers what the system shows (12.1–12.3), how it is built so any harness or app can show it (12.4), the account limits it must stay inside (12.5), and who else hears about progress (12.6). A minimal version comes first (12.7).

## 12.1 Readouts

| Readout | Shows | Source |
|---|---|---|
| **Live** | The fleet in flight with each item's stage (briefed, claimed, implementing, verifying, reporting, in review, merged); what is blocked and on what; what is waiting on the owner, oldest first | Run state ([part 13](13-operations.md#131-orchestrator-continuity)), ledger, tracker |
| **Explorable metrics** | Every queue's stock, age and flow; quality and cost measures ([part 11](11-metrics-and-control.md#111-measures)); as time series, filterable by project, milestone, tier, model and harness | Ledger, tracker history, usage snapshots |
| **Controllers** | Every controller step: sensor values, setpoint and bounds, action, reason, rule version (12.3) | Controller step log |
| **Progress reports** | What was built per project, decisions made, studies concluded with their verdicts, what is blocked, what is next, with charts (12.2) | All of the above |
| **Token use over time** | By model, tier, project, harness and kind of work, against what it bought: accepted items, waste, cost per accepted item | Ledger, usage snapshots |
| **Quotas** | Each account limit: used, remaining, reserve, burn rate, projected exhaustion (12.5) | Usage snapshots, declared limits |
| **Milestone graph** (planned) | Milestones as nodes and `needs` between them as edges; each node's outcome, progress against its constraints, appetite spent and check; the critical path highlighted; a milestone's items one step down (12.1.2) | Tracker, ledger, recorded check results |
| **Status line** (planned) | One line, always visible: what the person would otherwise ask about (12.1.1) | Run-state file, machine registry |

### 12.1.1 The status line (planned)

The status line is the one always-visible surface, so it shows what the person would otherwise ask about, in one line and in this priority order:

1. decisions waiting for the person, with the oldest one's age;
2. branches waiting for their merge, in owner mode;
3. problems needing attention: a red check on `main`, an incident, a stalled executor;
4. quota headroom against the person's reserve: amber when economizing, red at the reserve;
5. the fleet: executors running against the cap, and ready items waiting;
6. machine state: a quiet-machine hold, who holds a serial resource, heavy work deferred for load;
7. the orchestrator's context filling (a hand-over is near);
8. quiet hours on;
9. time since the last report, as a sign the system is alive.

Rules:

- It is computed from the run-state file and the machine registry only, never from the network, so it is cheap and always current.
- By default it shows only what needs the person. Fleet and machine detail appear on request, or when something is wrong.
- How much it shows is a per-person setting in the person file ([13.4](13-operations.md#134-settings-in-four-layers), [part 23](23-people-in-the-lead.md#235-the-interface-as-a-design-surface)).

### 12.1.2 The milestone graph (planned)

The milestone graph shows progress at the level people plan at. It complements the item dependency graph (`work/views/items-graph.md`); it does not replace it. Items stay in the item graph.

- **Nodes** are milestones, labelled by name ([3.2](03-data-model.md#milestones-and-releases)). Each shows its outcome in one sentence; its constraints `done` out of all its constraints; `tokens_spent` against `appetite_tokens`; and its independent check: passed, due (`check_due`) or not yet due.
- **Edges** are `needs` between milestones. A `needs` from a milestone to an item is not an edge; it counts toward the node's progress.
- **The critical path** is highlighted: the chain of milestones not yet `done` with the most estimate tokens remaining, the same rule items use ([3.2](03-data-model.md#project-and-item)).
- **Drilling in.** Opening a milestone lists its constraints and contributions with their state and critical-path flag, and links to the item graph for them.
- **Two forms.** A generated view, `work/views/milestones.md`, with a mermaid graph and a table of the same fields, readable on GitHub and on a phone ([3.4](03-data-model.md#generated-views)). And a section of the HTML page `hitld dashboard` writes (12.4), where each node opens to its items without scripts from elsewhere.

## 12.2 Progress reports

A **progress report** is a digest of progress, sent through the notification channel inside the attention budget ([part 2](02-loops.md#the-owners-attention-as-a-budget)). It is sent when there is something to say, not on a calendar. `hitld cadence due` ([13.3](13-operations.md#133-the-scheduler-later-milestone)) says when, from these triggers:

| Trigger | Setting | Due when |
|---|---|---|
| **Merges** | `reports.every_merges` | This many items have merged since the last report |
| **Decisions** | `reports.every_decisions` | This many decisions have been asked or answered, or calls logged, since the last report |
| **Value** | `reports.every_merged_estimate_tokens` | The items merged since the last report add up to this many estimate tokens |
| **The owner's presence** | `reports.when_owner_writes`, `reports.min_changes` | The owner writes in the chief of staff's session and at least `min_changes` merges or decisions are waiting |
| **An idle machine** | `reports.when_idle`, `reports.min_changes` | No executor is running, load is low, and at least `min_changes` are waiting |
| **A ceiling on silence** | `reports.silence_max_hours` | This long has passed with no report while a run is active or work changed |

The ceiling limits how long the owner may hear nothing. It is not a schedule: a report sent for any other reason restarts it, and with no run and no change, silence stays silent. A threshold of 0 is off. Quiet hours hold a report unless the owner is the one who wrote. Digests of questions and logged calls use the same triggers under `digests.*`, without the value trigger.

- **One phone screen first.** The message itself fits a phone screen: per project, one line on what was built and one on what is next; decisions made and pending; study verdicts; blocked items; quota headroom. A link opens the full HTML report.
- **Charts** in the full report: queue stocks over time, token use against accepted items, critical-path progress per milestone, quota burn.
- **Facts, not adjectives.** Every line cites items, decisions, studies or run IDs. No "great progress".
- **It counts as a read** against the attention budget; a report that grows past its budget is shortened, not sent longer. The digest `hitld rights digest` builds and the `digest.txt` of `hitld dashboard` are the same text, with a size budget of 30 lines of 56 characters ([part 23.5](23-people-in-the-lead.md)).

## 12.3 Inspectable controllers

Every controller ([part 11](11-metrics-and-control.md#114-feedback-controllers)) appends one record per evaluation to `controller-steps.jsonl`: time, controller, rule version, the sensor values it read, its setpoint and bounds, the action it took (including "hold"), and the reason in one sentence. So the owner can always answer "why did it do that?" from the record.

**What-if replay.** `hitld control replay --from <t1> --to <t2> --set <setting>=<value>` re-runs the controllers over the recorded sensor values for a past period with different settings, and shows which actions would have differed. It is deterministic and offline. Its limit is stated in its output: it replays the controllers' decisions, not the world's response to them, so it shows what the controller would have done, not what would then have happened. (Measuring what would have happened needs a live experiment, [part 11](11-metrics-and-control.md#115-changing-the-system).)

## 12.4 A portable build

- **A local metrics store.** The core writes everything the readouts need to the private store: the ledger, the controller step log, usage snapshots (12.5), and quota declarations. These files follow a **versioned data contract** (`metrics_schema_version`), like every other data format ([part 16](16-packaging.md#165-releases-and-compatibility)).
- **`hitld dashboard`** renders a static, self-contained HTML dashboard (charts as inline SVG, no scripts from elsewhere, no server, no network requests) and the digests, from that store. The page includes the milestone graph (12.1.2). It runs anywhere Node runs, under any harness.
- **`hitld dashboard --json`** emits the data contract itself, so **richer views** can read the same data: a published dashboard page in Claude, or another app the owner builds on the same data. A view that publishes data off the machine gets aggregates only, at or below its classification limit, and publishing it is the owner's decision.
- **The dashboard with safe intents** ([part 5](05-execution.md#57-control-plane-and-readout)) is a later milestone built on the same contract.

## 12.5 Quotas and budgets

Autonomous runs spend the owner's account limits. The system must know them, forecast them, stay inside them, and never lock the owner out of their own tools.

**Where these settings live.** Limits, the reserve and the thresholds below belong to the person, in their own settings file outside any repository; a project may only be stricter ([part 13](13-operations.md#134-settings-in-four-layers)). Usage snapshots are kept per account in the machine-wide registry, so every project on a machine sees the same use.

### The model

Each limit is a **quota**:

| Field | Meaning |
|---|---|
| `unit` | `tokens`, `requests`, `usd`, `credits`, or `plan-percent` (a vendor's "usage" percentage with no published unit) |
| `window` | `rolling_5h`, `weekly`, `monthly_utc` (calendar month, UTC), `run`, or a custom period |
| `limit` | The amount per window, where known |
| `scope` | Which account, harness and models it covers |
| `source` | `measured` from a vendor readout or API, `estimated` from the ledger, or `declared` in the person's settings |
| `confidence` | How far to trust the current value, from its source and age |
| `hard` | Whether exceeding it needs the owner's approval first |
| `reserve` | The share kept back for the owner's own interactive use |

The existing run token budget becomes a quota with `window: run`.

### What can be measured, by harness

What a vendor exposes decides how much the system must estimate. Four kinds of source exist, and which accounts offer which changes over time. The dated vendor details (plans, prices, APIs) are in [a reference note](../../reference/harness-usage-sources.md), which can go stale without changing this design.

| Source | Gives | Limits |
|---|---|---|
| **A harness feed** | Where the harness hands a per-session command its own usage (a status line input, for example), the used share of each window and its reset time | Per session, not an API; present only after a first request; percentages with no published token equivalent |
| **Telemetry** | Tokens and cost per request, by model, exported to a local collector or file; headless runs report their own cost | Costs are client-side estimates at list price. Session transcript files are not parsed: their format is not a stable interface |
| **A vendor usage API** | Usage and spend per key, organization or user, at a stated granularity and delay | Often excludes subscription use; may need an admin credential |
| **Nothing machine-readable** | A figure shown on screen only | Declared by the person |

**Where nothing is machine-readable, the limit is declared** in the person's settings with `source: declared`, and consumption is estimated from the ledger. When a measured value arrives (a daily figure, a status-line snapshot), the estimate is corrected, and the estimator's accuracy (bias) and precision (spread) against measurements are tracked, as for token estimates ([part 1](../0001-human-in-the-lead.md#14-accuracy-and-precision)).

**The status-line usage capture is opt-in.** It touches the person's own harness settings (it installs a status line command, or wraps the person's own), so the first-run setup offers it and explains what it changes ([13.4](13-operations.md#first-run)). Without it, the limit is declared and estimated.

### Forecast

For each quota: the **burn rate** (consumption per hour, smoothed over a recent window and split by run and by interactive use where the source allows; usage snapshots are per account in the machine registry, so another project's run is not counted as interactive use, [13.4](13-operations.md#across-projects)), the **remaining** amount above the reserve, and the **projected exhaustion** time with a band that reflects the estimate's precision. A quota projected to run out before its window resets is flagged.

### Control

Quotas are **constraints for the controllers**. The budget controller ([part 11](11-metrics-and-control.md#114-feedback-controllers)) acts as headroom shrinks:

| Headroom above the reserve | Action |
|---|---|
| Ample | Normal dispatch |
| Below `quota.economize_below` | Prefer cheaper models and tiers where the sizing rules allow it (never below the tier blast radius requires; such items wait instead); lower concurrency |
| Below `quota.critical_below` | Dispatch only critical-path items |
| At the reserve | Stop autonomous dispatch; in-flight executors finish or checkpoint; the owner is told |

- **The owner's reserve is never spent by autonomous work.** The default reserve is 25% of each window, set in the person file ([13.4](13-operations.md#134-settings-in-four-layers)); it stays available so an autonomous run never locks the owner out of their own interactive use (decided: [Q11](22-open-questions.md#q11-how-large-is-the-owners-reserve-on-each-account-limit)).
- **Threshold notifications** at `quota.notify_used` levels go into the digest; a projected exhaustion before reset, or reaching the reserve, is an interrupt.
- **Hard budgets need a yes.** Limits that cost money are hard: before any action that would exceed one (paid overage, API spend), the system asks the person and waits. Plan windows are soft, with the reserve (decided: [Q12](22-open-questions.md#q12-which-limits-are-hard)).

### Privacy

Usage data and metrics stay local by default, in the private store. Reports contain no secrets and no raw untrusted text; they respect classification ([part 10](10-security.md#103-information-classification)), so a digest sent through a channel carries only what that channel may carry.

## 12.6 Stakeholder communication

Different people need different views of the same progress:

| Audience | Gets | Classification ceiling |
|---|---|---|
| **The owner** | Progress reports, decisions, quotas | Everything |
| **Area owners and co-maintainers** | Their areas' progress, and decisions in their areas (answered by the owner until [Q21](22-open-questions.md#q21-how-is-a-deciders-identity-established-blocks-any-second-human-and-any-channel-other-than-the-local-session)'s signed answers exist) | `internal` (and `confidential` items they are cleared for) |
| **Contributors and users** | Release notes, changelog with credit, roadmap status | `public` |
| **A team or leadership** | Status per long outcome and project: outcomes, risks, what is next | Set per audience in `policy.json` |

Each audience has a template and a classification ceiling, and reports are generated from the same data with everything above the ceiling removed. Sending to anyone outside the project goes through the send gate ([part 9](09-contributors.md#93-replies)) and is the owner's decision until a precedent allows a routine report.

<a id="127-in-v0"></a>

## 12.7 The minimal version

In "One signal end to end" ([part 21](21-scope.md)):

- the ledger's usage fields and `hitld ledger summary`;
- quotas declared in the person's settings, including the owner's reserve, and the run budget in `policy.json` ([part 13](13-operations.md#134-settings-in-four-layers));
- opt-in status-line snapshots of window percentages, where the harness provides them;
- a forecast per quota, and the reserve rule enforced at dispatch;
- `hitld dashboard` producing a static HTML report and a text digest;
- `hitld cadence due`, which says when a digest or report is due, from thresholds, the owner's presence, an idle machine and a ceiling on silence (12.2).

Explorable dashboards, controller replay, per-audience reports and vendor API readers come later ([part 21](21-scope.md)).
