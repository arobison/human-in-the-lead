# 0001: Human in the lead

| | |
|---|---|
| **Status** | Under review. The milestone "Usable in a consuming project" is built ([part 21](0001-human-in-the-lead/21-scope.md)). |
| **Date** | 2026-11-14 |
| **Scope** | The whole system: purpose, model, loops, roles, packaging, and the slice "One signal end to end" |
| **Reading order** | This file first. Then the parts below as needed. Open questions are in [part 22](0001-human-in-the-lead/22-open-questions.md). |

This design has twenty-three parts. This file holds part 1 (purpose and objective), the goals, and a glossary. Each other part is its own file:

| Part | File | What it settles |
|---|---|---|
| 2 | [The system as loops](0001-human-in-the-lead/02-loops.md) | Loops nested by speed; each as a queue with a WIP limit, sensors, a controller and escalation rules; strategy, trust calibration, security, non-functional budgets, plans, rollout, upstream, maintenance, outcome sensing, design review, docs |
| 3 | [Core data model](0001-human-in-the-lead/03-data-model.md) | Entities, lifecycles, adapter interfaces, and the files backend as the reference |
| 4 | [Roles and decision rights](0001-human-in-the-lead/04-decision-rights.md) | Who does what, when the owner is involved, how precedent works, several humans in the lead |
| 5 | [Execution](0001-human-in-the-lead/05-execution.md) | Sizing tiers, dispatch, the merge queue, the ledger, questions, reports, the control plane |
| 6 | [Verification: the compiler model](0001-human-in-the-lead/06-verification.md) | Why nobody needs to read generated code, and when someone must |
| 7 | [UX design and review](0001-human-in-the-lead/07-ux.md) | A loop beside verification whose evidence is "good to use", including developer experience |
| 8 | [Knowledge base](0001-human-in-the-lead/08-knowledge-base.md) | Markdown as the source of truth, the index, freshness, the `kb` tool, pluggable retrieval |
| 9 | [Contributors and relationships](0001-human-in-the-lead/09-contributors.md) | Area owners, trust levels, replies, credit, health, legal |
| 10 | [Security and classification](0001-human-in-the-lead/10-security.md) | Trust boundaries, least privilege, prompt injection, where each class of artifact lives |
| 11 | [Metrics and feedback controllers](0001-human-in-the-lead/11-metrics-and-control.md) | Definitions, controllers, stability rules, Goodhart pairs, testing changes to the system |
| 12 | [Reporting, monitoring and account limits](0001-human-in-the-lead/12-reporting-and-limits.md) | Readouts, progress reports, inspectable controllers, quotas with forecasts and the owner's reserve, stakeholder reports |
| 13 | [Operations](0001-human-in-the-lead/13-operations.md) | Orchestrator continuity, the environment resource manager, the scheduler, settings in four layers (person, machine, project, run) |
| 14 | [Integration and CI](0001-human-in-the-lead/14-integration.md) | The merge queue, conflicts, bisection and flakes, CI integration |
| 15 | [Architecture and portability](0001-human-in-the-lead/15-architecture.md) | Four layers (neutral core, portable instructions, harness adapters, thin packaging), the harness support table |
| 16 | [Packaging and distribution](0001-human-in-the-lead/16-packaging.md) | Repository layout, the `hitld` command, the marketplace and pinned versions, releases and compatibility, migrating the first consumer |
| 17 | [The eval suite](0001-human-in-the-lead/17-evals.md) | What it evaluates, fixtures, graders, metrics, how it runs, portability, the suite for "One signal end to end" |
| 18 | [Self-improvement](0001-human-in-the-lead/18-self-improvement.md) | Bootstrap stages, the guardrails against gaming its own grading, and how people give feedback on HITLd |
| 19 | [Viable system model check](0001-human-in-the-lead/19-viable-system-model.md) | Completeness check against Beer's model |
| 20 | [Ideas this design uses](0001-human-in-the-lead/20-prior-art.md) | The established ideas the design is built on, by field, from cybernetics and control theory to security, each with its source and where it is used |
| 21 | [Scope and milestones](0001-human-in-the-lead/21-scope.md) | The slice "One signal end to end" and later milestones by dependency |
| 22 | [Open questions](0001-human-in-the-lead/22-open-questions.md) | Calls that need the owner, each with a recommendation; and the calls this design made |
| 23 | [The people in the lead](0001-human-in-the-lead/23-people-in-the-lead.md) | Judgement records matched to outcomes, calibration as a per-person prior, private calibration reviews, the interface as a design surface, defaults for new and experienced people |

---

## 1. Purpose

### 1.1 What "human in the lead" means

**Human in the loop** puts a person inside an automated process, as a gate. The process runs; at fixed points it stops and asks the person to approve. Two failures follow. The person becomes the bottleneck, because every gate waits on them. And the person becomes a rubber stamp, because the volume of approvals exceeds their attention, so they approve without judging.

**HITLd** abbreviates human in the lead; the "d" keeps it apart from HITL, human in the loop.

**Human in the lead** puts people in front of the process. The core statement:

> Agents do the work. People make the calls that need judgement, and own the relationships. The system routes each such call to the right person, framed for a fast and good decision, and makes every result traceable to its evidence and to the human calls behind it, because that is what lets other people trust it.

The people in the lead set:

- the **direction**: strategy, principles, non-goals, portfolio balance;
- the **decision rights**: which calls are theirs, which belong to area owners, which agents make and record;
- the **objective**: its weights and its limits (1.3);

and they make the calls that need judgement. Agents do the labour: intake, triage, shaping, research, implementation, verification, shipping, and most of the measurement.

**Judgement.** A call needs judgement when it turns on values or trade-offs, on uncertainty the evidence cannot settle, on something hard to undo, on taste, or on people. Decision rights encode the known cases; novelty, stakes and irreversibility catch the unknown ones ([part 4](0001-human-in-the-lead/04-decision-rights.md)). Each answer can become precedent, so the same question does not come back. People's judgement is a strong prior but not an infallible one: the system weighs each person's quick reads by their record, shows them where evidence disagrees, and helps them get better at it ([part 23](0001-human-in-the-lead/23-people-in-the-lead.md)).

**Trust, in two directions.** Other people (users, contributors, reviewers) trust the output because accountable people stand behind it: they set the direction, made the calls, and hold the relationships. The system drafts; people own the relationship. And the people in the lead trust the system only as far as its record: autonomy is granted area by area as evidence accumulates, and withdrawn when it does not hold ([part 4.6](0001-human-in-the-lead/04-decision-rights.md#46-autonomy-changes-with-the-record)).

**Legibility.** Every result can answer "who decided, and on what evidence?" That traceability is what turns the output of a semi-autonomous system into something another person can rely on.

The difference from the loop shows in what people spend attention on. In the loop, attention goes to approvals, roughly in proportion to volume. In the lead, it goes to the calls that need judgement, which is the requisite-variety rule this design applies throughout: the system absorbs the variety it can handle by rule and precedent, and passes on only what needs a person.

The person in front is called **the owner** in this design: the person who holds the project's decision rights. A project may have more than one human: area owners hold delegated decision rights over parts of it. The owner talks to their chief of staff, the front-desk session that hands work to an orchestrator ([part 9](0001-human-in-the-lead/09-contributors.md)).

### 1.2 What is scarce

The design point is one owner directing many agents in parallel on a large codebase, each agent in its own working tree.

In an agentic flow, labour is cheap and parallel. What is scarce:

1. **The owner's attention.** Measured as decision latency and decisions per period.
2. **The orchestrator's context window.** Everything the main session reads costs it room to think about the rest of the run.
3. **Serial resources.** The GPU, the merge queue, and files that many items touch.

Two other properties of agents change the classic product development picture:

- **Onboarding is paid on every fresh agent.** A human engineer learns the codebase once; each new agent session learns it again. Onboarding tokens are a recurring cost, so the knowledge base ([part 8](0001-human-in-the-lead/08-knowledge-base.md)) is a cost lever, not a nicety.
- **Errors are correlated and confidently reported.** Agents from the same model share blind spots, and they report success in the same tone whether or not they succeeded. So verification must be independent of the author ([part 6](0001-human-in-the-lead/06-verification.md)), and reports must carry evidence rather than claims ([part 5](0001-human-in-the-lead/05-execution.md)).

### 1.3 The objective

The system maximizes **realized outcomes over time**, subject to four constraints.

**Realized** means shipped and verified, and where the outcome can be observed, observed. Merged is not realized; an item that ships and is reverted realized nothing and cost its tokens twice.

In words: deliver the most value, as early as possible, without exceeding the owner's attention budget or the token budget, without falling below the quality floor, and without damaging relationships.

As a formula, over a planning horizon:

```
maximize    Σ over outcomes o:  w(category(o)) · V(o) · D(t_o)

subject to  owner attention used      ≤  A        (decisions and reads per period)
            tokens used               ≤  T        (per run and per period)
            quality                   ≥  Q        (change failure rate, escaped defects)
            relationship health       ≥  R        (response times, contributor retention)
```

- `V(o)` is the value of outcome `o` as estimated at shaping, in the project's own value units (part 2, shaping). It is a prediction. The system records the prediction and, where it can, the realized value, so that value estimates are calibrated over time like token estimates.
- `D(t)` is the cost-of-delay discount: value lost per unit of delay, from the outcome's cost-of-delay profile (standard, urgent, fixed-date, intangible; [part 2](0001-human-in-the-lead/02-loops.md)).
- `w(category)` is the owner's weight per portfolio category (for example: features, quality, platform, research, community). The owner sets the weights in `policy.json`.
- `A`, `T`, `Q`, `R` are set by the owner in `policy.json`.

The constraints are **floors and ceilings, not terms to trade**. The system does not buy value with escaped defects or with the owner's quiet hours. Quality and relationship floors are hard; the attention and token budgets are hard per period, and the controllers in [part 11](0001-human-in-the-lead/11-metrics-and-control.md) act to stay inside them (for example, by dispatching only critical-path work when the token budget runs low).

Nobody computes this sum exactly. Its job is to make trade-offs explicit and consistent: prioritization ([part 2](0001-human-in-the-lead/02-loops.md)) uses cost of delay divided by size, which is the greedy policy for this objective when items are independent; the controllers use the constraints as their limits; and every metric in [part 11](0001-human-in-the-lead/11-metrics-and-control.md) traces to one of these terms.

### The objective, seen through several frames

The objective is a proxy that the owner writes and revises. Several fields have met the same problem, and the design is built on what they agree on ([part 20](0001-human-in-the-lead/20-prior-art.md)):

| Frame | How it reads this system | What the design takes from it |
|---|---|---|
| **Machine-learning objective** | The formula is a training objective: a proxy for what the owner wants, with constraints. Optimizing a proxy invites reward hacking | Goodhart pairs, outcome checks after shipping, evals the system cannot see; the objective is versioned and each revision is a decision |
| **Theory of constraints** | Throughput is set by the bottleneck, and the bottleneck is the owner's attention | Keep the bottleneck fed with well-framed decisions, never idle and never flooded: batching, framing, the reserve |
| **Control theory** | Setpoints, sensors, controllers and stability | Controllers act inside the owner's bounds, with rules against oscillation ([part 11](0001-human-in-the-lead/11-metrics-and-control.md)) |
| **Cybernetics** | Requisite variety: a regulator must absorb as much variety as it faces | Rules and precedent absorb routine variety; only what needs judgement reaches a person. Beer's viable system model as a completeness check ([part 19](0001-human-in-the-lead/19-viable-system-model.md)) |
| **Economics of flow** | Cost of delay, queues and work in progress | Prioritize by cost of delay over size; limit work in progress; measure queues ([part 2](0001-human-in-the-lead/02-loops.md)) |
| **Principal and agent** | A principal delegates to agents whose incentives and information differ, and pays to monitor them | Briefs state intent and limits; reports carry evidence, not claims; verification is independent of the author |
| **Mission command** | Leaders give intent and constraints; people closest to the work decide how | Items carry intent and "done when"; executors make cheap-to-undo calls and log them |
| **Forecasting and decision science** | Judgements are predictions that can be scored | Confidence recorded with each call, outcomes matched later, calibration fed back to the person ([part 23](0001-human-in-the-lead/23-people-in-the-lead.md)) |

What the frames share is the pattern the system is designed around: **someone accountable sets intent and limits; others act with local autonomy; outcomes are measured against a proxy that can be gamed; feedback flows back to both the actors and the intent; and autonomy is extended as trust is earned from the record.**

### 1.4 Accuracy and precision

This design keeps the two words distinct, because estimates are everywhere in it:

- **Accuracy** is closeness to the true value. For a set of estimates, it is the bias: the mean of the error.
- **Precision** is the spread of repeated estimates. For a set of estimates, it is the dispersion of the error (its standard deviation).

A token estimator can be precise and inaccurate (always 40% low) or accurate and imprecise (right on average, wildly scattered). The two need different fixes: a bias is corrected by a scale factor; a spread needs better inputs. Every estimate the system makes is tracked for both.

### 1.5 Durations

Plans in this design are milestones and dependencies, never time estimates. Durations appear only as **measurements** (lead time, decision latency, time to first response), never as commitments.

---

## Goals, non-goals, anti-goals

**Goals**

- One owner can direct many parallel agents on a large codebase and spend attention only on decisions that are theirs.
- Every unit of work is traceable: from a signal, through a decision or an opportunity, to an item, a dispatch, a commit, evidence, and a release.
- Confidence in generated code comes from independent evidence that accumulates over time, not from reading the code.
- The system measures itself and tunes itself inside bounds the owner sets; changes to the rules go to the owner as decisions.
- Token- and wall-time-efficient by design: short briefs, short reports, parallel work, serial resources protected.
- Tracker-agnostic: the model sits behind an adapter, with in-repo files as the reference backend.
- Portable across popular agent harnesses: a neutral core and portable instructions, with a thin adapter per harness. Adapters are built in order of how much of the design a harness can run natively: Claude Code first (skills, subagents, hooks, MCP and a plugin marketplace), then GitHub Copilot in VS Code and its cloud agent.
- Measured behaviour: an eval suite, shipped from the start, gates every change to skills, policy and templates, and detects model changes.
- Self-improving within guardrails: the plugin proposes changes to itself, tested against evals it cannot see, and the owner decides.

**Non-goals**

- Replacing the owner's judgement on strategy, relationships, or one-way doors.
- A general project-management product for large teams. Multi-owner use is supported through area owners, but the design point is one owner and many agents.
- Hosting. The slice "One signal end to end" runs inside Claude Code sessions on the owner's machines. Hosted pieces (webhooks, a dashboard) come later and stay optional.
- Estimating in time.

**Anti-goals** (what would make this a failure even if it technically works)

- The owner gets more questions, or worse questions, than before. Success means fewer, better-framed decisions.
- Green dashboards over broken software: metrics that rise while escaped defects rise too.
- An agent acts on instructions found in an issue, a PR, a web page or a code comment.
- Confidential material reaches the public repository or a public channel.
- Contributors feel they are talking to a bot that does not listen.
- The orchestrator's context fills with diffs and logs, so it manages the run badly.
- The owner's judgement is overridden silently, or deferred to without the evidence that disagrees with it.

---

## Glossary

| Term | Meaning |
|---|---|
| **Owner** | The person who holds the project's decision rights: identity and policy, direction, weights, budgets. "The owner" always means this person. A record's `owner` field is different: whoever is accountable for that record, which defaults to the owner. |
| **Area owner** | A human with delegated decision rights over an area (paths and topics). |
| **Chief of staff** | The owner's front-desk session: the session the owner talks to, which takes their requests and answers, keeps their attention budget and hands work to an orchestrator. `chief-of-staff` where code needs a role value. Distinct from the orchestrator. |
| **Orchestrator** | The session that runs the work: plans, sizes, dispatches, merges, asks. Implements only tiny tasks. Until the chief of staff is built (HITLD-86), the main session in the harness is both. |
| **Executor** | An agent that implements one item in its own worktree. A background agent (tiers 1–2) or its own session (tier 3). |
| **Signal** | Anything that arrives: a bug report, feature request, idea, question, failing test, research finding. Has provenance. |
| **Opportunity** | A shaped cluster of signals: problem, evidence, options, value, confidence, appetite. |
| **Initiative, project, item** | The work hierarchy. Items are the unit of dispatch. |
| **Item kinds** | `work` (change the product), `decision` (a question for a decider), `external` (waits on something outside the project). |
| **Decision** | An item of kind `decision`: a question, options, a recommendation, a decider, and after answering, an answer and rationale. |
| **Precedent** | A rule generalized from an answered decision, which resolves matching future questions automatically. |
| **Judgement** | A person's recorded judgement on a signal or opportunity (a gut check or a considered call): a calibrated prior for prioritization, never a decision by itself. |
| **Judgement record** | The per-person view of every call a person made (judgements and decision answers), each with optional confidence, what they expected, the evidence available at the time, and outcomes as they arrive ([part 23](0001-human-in-the-lead/23-people-in-the-lead.md)). |
| **Calibration review** | A periodic report to one person on how their calls turned out, by area and confidence level; for their own improvement, private to them by default, never a ranking ([part 23](0001-human-in-the-lead/23-people-in-the-lead.md)). |
| **Trust calibration** | The slow loop that matches the system's autonomy to its record per area, by proposals the owner decides. |
| **Study, run, verdict** | A question with a hypothesis, the evidence runs that test it, and the verdict that cites them. |
| **Appetite** | The token budget a piece of work is worth (Shape Up's appetite, in tokens). |
| **Tier** | The size class that sets who executes an item and with which model and effort. |
| **Dispatch** | One assignment of an item to an executor. An item may have several (retries, follow-ups). |
| **State, result** | `state` is where a record is in its lifecycle (`proposed`, `planned`, `in-progress`, `done`, `dropped`; only work items are ever `in-progress`). `result` is how an attempt ended (a report's `done`, `partial` or `blocked`; a check's `pass`, `fail`, `error` or `not-applicable`). Every value is lowercase kebab-case. Ready, blocked, claimed and stage are derived, never stored. |
| **Claim, unclaim** | A claim is the first commit of an executor's branch, setting a work item `in-progress` with `claimed_by`. Unclaiming gives up an abandoned claim with an `unclaim:` commit on main. Releasing is shipping: a release is what reached users. |
| **Ledger** | The append-only record of dispatches and their results, kept outside the repo. |
| **Brief** | The short instruction an executor receives. Points at the item file; does not restate it. |
| **Report** | The fixed-shape message an executor returns; its `result` says how the attempt ended. The HTML page of run measures is the dashboard (`hitld dashboard`). |
| **Logged call** | A cheap-to-undo decision an executor makes itself and records in its report. |
| **Classification** | `public`, `internal`, `confidential`, `secret`. Sets where an artifact may live. |
| **Private store** | Where non-public artifacts live: the ledger, confidential research, relationship notes. Outside the public repo. |
| **policy.json** | The data file holding every tunable setting and the owner's bounds on it. |
| **Serial resource** | A resource only one executor may use at a time (a GPU, the merge queue). |
| **Harness** | The agent tool that runs sessions and agents: Claude Code, GitHub Copilot, Codex, Cursor. |
| **Harness adapter** | The layer that dispatches executors, receives completions and reaches the human in one harness, behind one interface. |
| **`hitld`** | The command line (and Node library, and MCP server) that holds the system's logic. |
| **Eval scenario** | A labelled test of model-dependent behaviour, run repeatedly and graded; the unit of the eval suite. |
| **Sealed eval set** | Eval scenarios kept encrypted and unseen by the agents that improve the plugin. |
| **Protected core** | The parts only the owner may change: the eval suite, decision rights, classification rules, guards, and the self-improvement rules. |
