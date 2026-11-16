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
| **Milestone graph** | Milestones as nodes and `needs` between them as edges; each node's outcome, progress against its constraints, appetite spent and check; the critical path highlighted; a milestone's items one step down (12.1.2) | Tracker, ledger, recorded check results |
| **The dashboard page** | Your move, the roadmap, the plan (the item graph), proposals, flow, and quota and spend, in one file (12.1.3) | Tracker read API and history, ledger, usage snapshots |
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

### 12.1.2 The milestone graph

The milestone graph shows progress at the level people plan at. It complements the item dependency graph (`work/views/items-graph.md`, and the plan on the dashboard page, 12.1.3); it does not replace it. A milestone's items are drawn in the item graph, not on the milestone board.

- **Nodes** are milestones, labeled by name ([3.2](03-data-model.md#milestones-and-releases)). Each shows its outcome in one sentence; its constraints `done` out of all its constraints; `tokens_spent` against `appetite_tokens`; and its independent check: passed, due (`check_due`) or not yet due.
- **Edges** are `needs` between milestones: a milestone's constraints that name other milestones, as a long outcome's do. A `needs` from a milestone to an item is not an edge; it counts toward the node's progress.
- **The critical path** is highlighted: the chain of milestones not yet `done` with the most estimate tokens remaining, the same rule items use ([3.2](03-data-model.md#project-and-item)). A milestone's remaining tokens are those of its constraints that are items not yet `done`, each weighing its `estimate_tokens`, or 1 without one. With no tokens remaining on any chain, nothing is highlighted.
- **Drilling in.** Opening a milestone lists its constraints and contributions with their state and critical-path flag (the item critical path), and points to the item graph for them.
- **Two forms.** A generated view, `work/views/milestones.md`, with a mermaid graph and a table of the same fields, readable on GitHub and on a phone ([3.4](03-data-model.md#generated-views)). Tokens spent come from the ledger in the private store, so the view, which is committed and must be the same wherever it is generated, shows them as —. And a section of the HTML page `hitld dashboard` writes (12.4), with tokens spent from the ledger (a dash where the ledger has no record of any of a milestone's items), drawn as a board in inline SVG:
  - **Lanes** are projects, long outcomes first, with release gates (work items with a `release` version) as flags in a Releases lane at the top. **Across** are steps: a milestone starts once everything it waits on is done.
  - Each release's flag is labeled by its version. A done release stands at the left edge, before the first step: it has happened. An open one stands after the last milestone it needs (named in its `needs`, or holding an item constraint it needs), else after the last step, and never left of an open release it needs; releases at the same step stand in version order, earlier to the left. An open release's rule runs down through the milestone lanes, so what lands before it is to its left; the milestones it needs carry its version.
  - Only committed milestones are on the board. Proposed ones are in a table under it, whole proposed projects first, then lone milestones: the idea, what stands between it and committing (ready to commit; waits on your answer, an open owner decision; or waits on other items, named), and how many open items and milestones wait on it. Dropped ones are in a small table of their own. At phone width, the rows stack.
  - A node shows its name, its outcome in at most two lines, a progress bar, how many of its constraints are in progress and done, tokens spent against the appetite, and its check. A started milestone is solid with a strip in its stage color on the leading edge; one not started is hollow, with a dot in its stage color. The stages are proposed, waiting or blocked, ready, in flight and done. Owner decisions and outside waits that hold a milestone up show as badges by its name. A dashed border marks a milestone in a loop of needs.
  - A wait is thicker for more items behind it and dashed when none are; the critical path is in the accent color.
  - Each node and each release flag is a link that opens a drawer through the CSS `:target` rule, with no script: a pane on the right, 560 pixels wide or the full width on a phone, with a head (the title and a Close link) and a scrolling body. On a wide window it sits beside the board; on a narrow one it lies over the page on a dimmed backdrop. A click outside the drawer closes it, through a backdrop link behind it, while the board's boxes and flags stay above the backdrop and switch the drawer; the browser's Back goes to the previous one. The open milestone's box, or release's flag, is marked on the board. A milestone's drawer lists its constraints and contributions; a release's lists the milestones that land before it and what it needs, with their states. In a drawer, every item, milestone and release ID links to its file: on the forge at the default branch when the repository's `origin` remote is a known forge (GitHub), never with the remote's credentials, else by its repository-relative path. Links are plain anchors: nothing is fetched until one is followed. The view `milestones.md` links the same IDs, relative to the views directory, through the same helper.

### 12.1.3 The dashboard page

`hitld dashboard` writes one HTML file (12.4) that answers, view by view, what the owner asks of the work. The owner chose the views (HITLD-176, HITLD-306), after a work board they built in another project. Each figure is shown once, in the view whose question it answers. The page reads the tracker through its read API (the entities `hitld work query --json` gives, the claims and the committed state history), the ledger and the usage snapshots, and it says when its data was read and from where: the tracker at a commit and branch, and the private store on the machine that generated it. A page generated in one container shows that container's store until the stores sync. The views are tabs, radio inputs and CSS with no script, Your move first; without CSS they show one after another.

- **Your move**, the default view. The owner's attention is the constraint, so each section leads with its number: decisions waiting on the owner; branches waiting for the owner's merge or on checks; work in progress, with who holds each item, on which branch, and what its dispatch last did (claims in other worktrees included until they merge); what is ready to start, the critical path first; and outside waits. Most waited-on first, counting what waits through other items, and each with its age. This is also what is happening now.
- **Roadmap**: the milestone board of 12.1.2, and a second layout, fewest crossings, chosen by a switch with no script: linked milestones grouped (the critical path's group first), each group in columns by longest path with crossings reduced by barycenter sweeps, unlinked milestones in a grid. It is computed when the page is generated, by layout code in this repository, with no layout library ([part 16](16-packaging.md)).
- **Plan**: the item dependency graph as inline SVG, the same data as `items-graph.md`. Items are nodes in their stage's color; `needs` are edges; lanes are projects; columns are steps by longest path, with the order in each lane from the same barycenter code; items linked to none drawn stand in a grid under their lane. The critical path is in the accent and ready items are marked. Each node links to its item file, and a text list of the same nodes sits under the graph for a screen reader. It draws the states `reports.dashboard_plan_states` names (planned and in progress by default: proposed items have their own view), and past `reports.dashboard_plan_max_items` items it is cut by project, naming what it leaves out. The full graph stays in `work/views/`.
- **Proposals**: one table of every proposed item, by project: the idea, what stands between it and committing (ready to commit, waits on the owner's answer, or waits on other items, named), and how many open items wait on it. Proposed milestones are on the Roadmap.
- **Flow**: how many items stood in each stage at the end of each day, from the committed state history, as stacked bands with the same figures as a table; then each measure beside its pair, the one that must not get worse (11.3): throughput beside the change failure rate, lead time beside the first-pass yield, work in progress beside what is blocked. A shallow clone says its history is cut.
- **Quota and spend**: each quota against the reserve with its forecast (12.5), the thresholds passed, and the ledger's tokens by model and tier.

The stages and their colors are the tracker's: proposed, blocked, ready, in progress and done, with blocked and ready derived as the tracker derives them ([3.2](03-data-model.md)); a milestone shows progress, not a state. Light and dark follow the reader's setting. At phone width nothing scrolls the page sideways: wide graphs scroll inside their frame, and tables stack their cells.

**One small inline script** (HITLD-308). Hovering or focusing a node on the Roadmap or the Plan lights what feeds it and what it unblocks; a scope picker (all work, a long outcome, a project, a milestone) and a search field narrow every view. The page is complete and readable without it. The script never parses HTML (no `innerHTML`): it builds its controls with `createElement` and `textContent`. Its data is JSON in the script, with every `<`, `>`, `&` and line separator escaped, so tracker text cannot end it. A Content-Security-Policy tag, first in the head, allows that script alone by its SHA-256 hash, and nothing from elsewhere. A test fails the build if the page holds any other script, an event handler attribute, or anything that would make a network request. A page without a tracker has no script.

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
- **`hitld dashboard`** renders a static, self-contained HTML dashboard in one file (charts as inline SVG, one inline script allowed by its hash and nothing from elsewhere, no server, no network requests) and the digests, from that store and the tracker. The page's views are in 12.1.3; the Roadmap includes the milestone graph (12.1.2). It writes `dashboard.html` and `digest.txt` ([16.2](16-packaging.md#pages-the-commands-write)). It runs anywhere Node runs, under any harness.
- **`hitld dashboard --json`** adds the data contract to the command's output, and **`--no-write`** returns it without writing the page or the digest to disk. This lets **richer views** read the same data: a published dashboard page in Claude, or another app the owner builds on the same data. A view that publishes data off the machine gets aggregates only, at or below its classification limit, and publishing it is the owner's decision.
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
| `resets_at` | Optional: a time the window is known to reset, as the person declares it; later resets follow one window length apart. Used when no reading gives the reset |

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

### Pausing and resuming

A stop at the reserve is a pause, not an end. Nothing else wakes the run when the window resets, so the pause says when it will.

- **Recorded with its reset.** When the gate stops dispatch for every item, the session holding the lease records `paused` in the ledger: the limit that stopped it, the gate's reason, and when that limit's window resets. The reset comes from the latest reading (the status line's `resets_at`) or, without one, from the limit's declared `resets_at`. An item held because its own estimate would cross the reserve is a hold, not a pause.
- **A wake at the reset.** `hitld dispatch plan` gives the reset as `wake_at`, and `hitld run status` shows it, so the chief of staff has a wake pending for that time ([part 13](13-operations.md#the-watchdog-and-resuming-after-limits)). When no reset time is known, the watchdog looks again at each of the chief of staff's wakes.
- **Resumed.** At the wake the orchestrator re-plans. The gate decides from the next reading; once it no longer stops dispatch, the run records `resumed` with reason `reset`.
- **A raised budget re-plans at once.** When the person raises a limit or lowers their reserve with `hitld config write`, the command says whether the new settings lift the pause. If they do, the chief of staff wakes the orchestrator straight away, and its plan records `resumed` with reason `budget`, without waiting for the reset.
- **Executors cut off by the limit.** An executor that stopped because the account reached its limit is found by the watchdog after the reset and continued as a follow-up ([part 5](05-execution.md#the-watchdog)). Until the reset, the watchdog does not count quiet executors as stalled.

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
