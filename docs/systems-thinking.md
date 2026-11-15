# The systems thinking behind HITLd

HITLd (human in the lead) is a way to build software in which agents do the work, and people set the direction and make the calls that need judgement. This page explains the ideas it is built on. It is for engineers and engineering leads who know agile, Scrum, Kanban or DevOps, and have not read systems theory.

None of these ideas is new. Most are already inside the processes you use, with trade-offs chosen for a time when people did the labour. The design itself is [0001: Human in the lead](design/0001-human-in-the-lead.md); this page links into it.

## The shift

Scrum, Kanban and their relatives assume that labour is scarce. Engineers are few and expensive, and each does one thing at a time. So a good process batches coordination into meetings, estimates effort, and limits how much is started.

With agents, labour is cheap and parallel. Ten agents can start ten items at once. Other things become scarce ([part 1.2](design/0001-human-in-the-lead.md#12-what-is-scarce)):

- **Human attention and judgement.** A person can make only so many good calls.
- **The orchestrator's context.** The agent that coordinates the run has a finite context window. Every diff it reads leaves less room for the rest.
- **Serial resources.** One GPU, one merge queue, a file that many items touch.

Agents also differ from people in two ways:

- **They pay onboarding on every fresh start.** An engineer learns a codebase once. Each new agent session learns it again, in tokens.
- **Their errors are correlated and confidently reported.** Agents from one model share blind spots, and they say "done, all tests pass" in the same tone whether or not it is true.

So the old trade-offs move. A meeting that saved engineers' time now spends attention. A story point estimates effort nobody spends. A person's code review, once cheap next to writing the code, becomes the most expensive step. The principles stay; the answers change.

## The principles

Each section gives the principle, where HITLd uses it, and a practice you know that already uses it.

### Stocks and flows

**What it says.** A system's behaviour comes from its stocks (things that accumulate) and the flows that fill and drain them. In a bathtub, the water is the stock; the tap and the drain are flows. Donella Meadows, _Thinking in Systems_ (2008).

**In HITLd.** Every stage of work is a queue, and every queue is a query over the tracker, so its stock (items waiting) and flows (arrivals and departures) can always be computed. No work waits in an agent's context or in chat ([part 2, common rules](design/0001-human-in-the-lead/02-loops.md#common-rules)).

**In today's practice.** A Kanban board is a picture of stocks. But people update it, so it is only as current as the last stand-up. Here the tracker is files in git and the views are generated, so the stocks are exact.

### Feedback, setpoints and error

**What it says.** A feedback controller compares a measurement with a target (the setpoint) and acts on the difference (the error). In a cascade, a slow outer loop sets the target of a fast inner one. A controller that reacts to noise or to late signals oscillates. Karl J. Åström and Richard M. Murray, _Feedback Systems_ (2008).

**In HITLd.** The system is a set of loops nested by speed. Execution and the merge queue are fast; triage and prioritization are medium; trust calibration and learning are slow; strategy is slowest. Slow loops set the setpoints of fast ones, never the reverse ([part 2](design/0001-human-in-the-lead/02-loops.md#loops-nested-by-speed)). Controllers follow stability rules: one setting at a time, minimum samples, hysteresis ([part 11](design/0001-human-in-the-lead/11-metrics-and-control.md#114-feedback-controllers)). For example, the concurrency controller adds one executor after a run of clean completions, and halves the count when merge conflicts appear.

**In today's practice.** Scrum is a cascade too: the sprint inside the release plan inside the roadmap. But each loop needs a meeting to close it, so loops close on the calendar. Here a loop closes when its measurements arrive.

### Requisite variety and the good regulator

**What it says.** W. Ross Ashby's law of requisite variety: a regulator can control only as much variety as it can express. Ashby, _An Introduction to Cybernetics_ (1956). Roger Conant and Ashby added the good regulator theorem: every good regulator of a system must be a model of that system (1970). The corollary: a model needs the distinctions someone acts on, and a distinction nobody acts on is cost without control. Add one only if someone acts on it.

**In HITLd.** The owner's variety is small; the questions that arrive vary widely. So the system absorbs routine variety with rules and precedent, and passes on only what needs a person. A hundred similar questions are one question and a rule ([part 4.2](design/0001-human-in-the-lead/04-decision-rights.md#42-when-the-owner-is-involved), [4.3](design/0001-human-in-the-lead/04-decision-rights.md#43-precedent)). The corollary also tests any new field, state or label: who acts on it?

**In today's practice.** On-call rotations filter variety: the engineer on call absorbs most pages. A ticket workflow with fifteen states nobody reads fails the corollary. Teams keep their rules in experienced heads; here precedent is written down, matched by a script, and listed in a digest the owner can overrule.

### Near-decomposability and hierarchy

**What it says.** Herbert Simon observed that complex systems that work are usually nearly decomposable: built from parts whose internal interactions are strong and fast, and whose interactions with each other are weak and slow. Simon, "The Architecture of Complexity" (1962) and _The Sciences of the Artificial_ (1969).

**In HITLd.** Work is cut into items. Each declares the files it touches and runs in its own worktree ([part 5.2](design/0001-human-in-the-lead/05-execution.md#52-dispatch)). Loops nested by speed are Simon's hierarchy in time: fast loops settle before slow ones look. A large item can run its own small orchestrator ([part 19.3](design/0001-human-in-the-lead/19-viable-system-model.md#193-recursion)).

**In today's practice.** Service and team boundaries both aim for parts that change independently. But decomposition followed team lines, because the team was the unit of labour. Here the unit is the item, and decomposition follows the code: the files an item touches and the serial resources it needs.

### The viable system model

**What it says.** Stafford Beer's viable system model says any organization that keeps itself going in a changing world has five functions. Operations do the work. Coordination stops the parts colliding. Control allocates resources now. Intelligence looks outward and ahead. Policy decides what the system is. It also needs an audit channel and an alarm. Beer, _Brain of the Firm_ (1972) and _The Heart of Enterprise_ (1979).

**In HITLd.** The model is a completeness check ([part 19](design/0001-human-in-the-lead/19-viable-system-model.md)). Executors are operations; claims, locks and the merge queue are coordination; the orchestrator is control; intake and shaping are intelligence; the owner is policy. Independent tests and adversarial agents are the audit channel. A severe incident pages the owner through quiet hours: that is the alarm.

**In today's practice.** A healthy engineering organization has all five, spread across engineers, leads, managers and product. With people, each function needed a person. Here most are agents and scripts, and the owner holds policy.

### Leverage points and feedback delays

**What it says.** Meadows ranked the places to intervene in a system. Changing a parameter moves it least. Changing its rules, information flows or goals moves it most. Delay in a feedback loop causes oscillation, like a slow shower that overshoots hot, then cold. Meadows, "Leverage Points: Places to Intervene in a System" (1999); John Sterman, _Business Dynamics_ (2000).

**In HITLd.** Controllers move parameters, inside bounds the owner sets. Rules, decision rights and goals are the owner's alone, and each change to them is a decision with evidence ([part 11.2](design/0001-human-in-the-lead/11-metrics-and-control.md#112-who-moves-what)). Controllers act on leading indicators, such as a growing queue or a first failed check. Lagging ones, such as a defect a user finds later, audit the controllers.

**In today's practice.** Teams tune sprint length (a parameter) and see small effects; a change to the definition of done (a rule) changes everything downstream. Here measuring is cheap, so controllers can use the earliest signal.

### Batch size and cost of delay

**What it says.** Little's law: in a stable queue, average work in progress equals throughput times average time in the system. John D. C. Little (1961). Donald Reinertsen added cost of delay: the value lost while work is not done. Ordering independent jobs by cost of delay divided by size delivers the most value soonest, and small batches cut waiting and risk. Reinertsen, _The Principles of Product Development Flow_ (2009).

**In HITLd.** The objective discounts value by delay ([part 1.3](design/0001-human-in-the-lead.md#13-the-objective)). The ready queue is ordered by cost of delay over size, where size is a token estimate, and an item that unblocks others carries the cost of delay of everything behind it ([part 2.4](design/0001-human-in-the-lead/02-loops.md#24-prioritization)). The merge queue shrinks its batches when failures rise, so bisection stays cheap.

**In today's practice.** Kanban's WIP limits apply Little's law. But coordinating people was expensive, so work was batched into sprints and releases. With agents, starting and finishing an item costs little, so a batch can shrink to one item.

### Theory of constraints

**What it says.** Eliyahu Goldratt: a system's throughput is set by its tightest constraint. Find it, exploit it, subordinate everything else to it, then raise it, and repeat. Goldratt and Jeff Cox, _The Goal_ (1984).

**In HITLd.** The constraint is usually human attention, sometimes the merge queue. So attention is budgeted like tokens: a decision budget, digests, quiet hours, and interrupts only for questions that block the critical path ([part 2](design/0001-human-in-the-lead/02-loops.md#the-owners-attention-as-a-budget)). Each question comes framed for a fast decision: a recommendation, the options with their costs, and whether each can be undone ([part 4](design/0001-human-in-the-lead/04-decision-rights.md#the-decision-question)). The constraint is never flooded and never idle.

**In today's practice.** Teams meet it when one reviewer becomes the bottleneck. Processes built for engineers aimed to keep engineers busy. Here keeping agents busy only queues more questions in front of the owner.

### Goodhart's law

**What it says.** When a measure becomes a target, it stops being a good measure: Marilyn Strathern's 1997 wording of Charles Goodhart's observation.

**In HITLd.** Every target metric has a pair that gets worse if the first is gamed. Throughput is paired with change failure rate. Tokens per item is paired with first-pass yield. The share of questions settled by precedent is paired with how often the owner overrules them ([part 11.3](design/0001-human-in-the-lead/11-metrics-and-control.md#113-goodhart-pairs)).

**In today's practice.** Velocity inflates when it becomes a target, and coverage targets produce tests that assert nothing. People's gaming is limited by effort and conscience. Agents are optimizers with neither limit, and models have been seen stubbing tests to pass them ([part 20](design/0001-human-in-the-lead/20-prior-art.md#207-machine-learning)). So the guard is built into the measures.

### Principal and agent

**What it says.** A principal delegates work to an agent whose information and incentives differ. The principal cannot see everything, so it pays to monitor, and arranges things so that honest reporting is the agent's best move. Michael Jensen and William Meckling, "Theory of the Firm" (1976).

**In HITLd.** Briefs state intent and limits. Reports have a fixed shape and carry evidence: commands run and their results, benchmark run IDs, deviations, calls made ([part 5.6](design/0001-human-in-the-lead/05-execution.md#56-the-report-shape)). A report states evidence; it does not declare acceptance. Someone other than the author verifies the change ([part 6.2](design/0001-human-in-the-lead/06-verification.md#62-independent-verification)).

**In today's practice.** A definition of done, a pull request template and CI are monitoring. With people, trust built by working together covered most of the gap. An agent's report of success is not evidence, so monitoring is built in, and scripts make it cheap.

### Mission command

**What it says.** Leaders give intent (why, and what done looks like) and constraints (what not to do), and leave the method to the people closest to the work. Stephen Bungay, _The Art of Action_ (2010).

**In HITLd.** Each item carries its intent and a "done when" that is an executable check. The executor chooses how. It makes cheap-to-undo calls itself and lists them in its report. A call that is not its own becomes a question, and it carries on with everything that does not depend on the answer ([part 5](design/0001-human-in-the-lead/05-execution.md#the-executor-contract)).

**In today's practice.** User stories with acceptance criteria are intent and done-when; self-organizing teams are local autonomy. But a team acts on intent using context it has built up. A fresh agent has none, so intent is written down, and the knowledge base pays the onboarding cost ([part 8](design/0001-human-in-the-lead/08-knowledge-base.md)).

### One-way and two-way doors

**What it says.** Some decisions are hard or impossible to undo: take care over those. Most are easy to undo: make them fast, because being wrong costs little and waiting does not. Jeff Bezos, letter to Amazon shareholders for 2015 (2016).

**In HITLd.** One-way doors go to the owner: deleting user data, a file format others will write, a public package name. Two-way doors default to action. The agent holding the call decides and logs it; the owner sees it in a digest and can reverse it ([part 4.2](design/0001-human-in-the-lead/04-decision-rights.md#42-when-the-owner-is-involved)).

**In today's practice.** Feature flags turn one-way doors into two-way ones. Asking a colleague was cheap, so teams asked about everything. Here asking spends the constraint, so reversibility decides who decides.

### Boundaries and interfaces

**What it says.** A module boundary is a promise: what is inside may change; what crosses the boundary may not, without notice. David Parnas argued that each module should hide a decision likely to change ("On the Criteria To Be Used in Decomposing Systems into Modules", 1972). A version number is a message about the interface. Under semantic versioning, a major version says something you rely on may break.

**In HITLd.** A change to public surface (API, naming, formats, licensing) is a public commitment, so it goes to the owner. Minor and major releases are the owner's call. A routine patch release may follow a precedent the owner confirmed, because a patch never changes the interface ([part 2.7](design/0001-human-in-the-lead/02-loops.md#27-shipping)). HITLd versions its own executor contract, report shape, schemas and command output the same way ([part 16.5](design/0001-human-in-the-lead/16-packaging.md#165-releases-and-compatibility)).

**In today's practice.** API reviews, contract tests and deprecation policies. Here the implementation is read only when a trigger fires. A public surface change always is one, and the read covers the signatures and docs, not the implementation ([part 6.6](design/0001-human-in-the-lead/06-verification.md#66-when-a-human-reads-the-code)).

### Probes in complex domains

**What it says.** The Cynefin framework separates kinds of problem. In a clear or complicated domain, analysis finds the answer. In a complex one, cause and effect show only afterwards, so you probe, sense and respond: run small, safe experiments and amplify what works. David Snowden and Mary Boone, "A Leader's Framework for Decision Making" (2007).

**In HITLd.** When confidence is low and a cheap build would raise it, shaping runs a throwaway spike ([part 2.3](design/0001-human-in-the-lead/02-loops.md#23-shaping)). A study whose verdict would change the choice is ordered by the value of that information ([part 2.4](design/0001-human-in-the-lead/02-loops.md#24-prioritization)). A milestone can be a learning milestone, whose deliverable is a verdict rather than a feature ([part 21](design/0001-human-in-the-lead/21-scope.md)).

**In today's practice.** Spikes, build-measure-learn and A/B tests. Spikes cost engineers' time, so teams ran few. With agents, building two options in parallel and choosing by evidence is often cheaper than the meeting about them.

### Calibration and proper scoring

**What it says.** A forecaster is calibrated when stated confidence matches how often they are right: of everything they called 80% likely, about 80% happens. It improves with feedback. A proper scoring rule, such as the Brier score, gives the best expected score to whoever states what they actually believe. Glenn Brier, "Verification of Forecasts Expressed in Terms of Probability" (1950); Philip Tetlock and Dan Gardner, _Superforecasting_ (2015).

**In HITLd.** Every estimate is tracked for accuracy (bias) and precision (spread). A bias gets a scale factor; a spread needs better inputs ([part 1.4](design/0001-human-in-the-lead.md#14-accuracy-and-precision)). People's calls are recorded with an optional confidence and what they expected, outcomes are matched later, and each person gets a private calibration review ([part 23](design/0001-human-in-the-lead/23-people-in-the-lead.md)). The same kind of record sets the system's autonomy: more where it has been reliably right, less where it was corrected, always by the owner's decision ([part 4.6](design/0001-human-in-the-lead/04-decision-rights.md#46-autonomy-changes-with-the-record)).

**In today's practice.** Planning poker and velocity compare estimates with actuals for a team. Human effort is hard to score, so single estimates rarely are. Here each estimate and each judgement gets its outcome attached when one arrives.

### Constraints versus contributions

**What it says.** Noriaki Kano's model sorts qualities by how users respond. Must-be qualities cause anger when missing and earn nothing when present: a login that works. Performance qualities earn more the better they get: speed. Delighters earn a lot when present and cost nothing when absent. Kano and colleagues, "Attractive Quality and Must-Be Quality" (1984). The lesson: must-be qualities are constraints to satisfy, not value to maximize. Performance and delight are contributions, ranked by the outcome they bring. Joshua Seiden's _Outcomes Over Output_ adds: count changes in what users do, not features shipped.

**In HITLd.** The objective has this shape. Quality, relationships, attention and tokens are floors and ceilings that the system never trades for value. Inside them, it maximizes realized outcomes: shipped, verified and, where possible, observed ([part 1.3](design/0001-human-in-the-lead.md#13-the-objective)). Each project states, in its milestones, the outcome that would show it worked, and outcome sensing checks it after shipping ([part 2.10](design/0001-human-in-the-lead/02-loops.md#210-outcome-sensing)). In short: build what users want.

**In today's practice.** MoSCoW puts "must have" and "should have" on one ranked list, so a must-be quality can be traded against a feature. Outcome-tracking teams get the second half right. Here the constraints are checks and floors, and only contributions are ranked.

## Agile and friends, re-read

Each practice below got something right, and each made a trade-off that fit human labour. HITLd keeps the principle and changes the trade-off.

| Practice | Principle, and what it got right | Trade-off made for human labour | What HITLd does instead |
| --- | --- | --- | --- |
| **Sprints and planning** | A setpoint and a fast loop. A fixed timebox forces finishing and a regular check against a goal | Coordination was expensive, so it was batched into planning meetings | Continuous flow: items dispatch when ready. Milestones are outcome setpoints, ordered by dependency, not date |
| **Story points and velocity** | Calibration. Relative sizing is easier than absolute, and actuals are tracked | They estimate human effort, which is noisy and easy to inflate | Size is a token estimate. Actual tokens are measured per dispatch; accuracy and precision are tracked per item type |
| **Daily stand-up** | Coordination. Blockers surface early | Coordination through talk, paid for with everyone's attention | Coordination through the tracker (claims, declared files, locks) and the merge queue. A blocker is a decision item. No meeting |
| **Code review by people** | Independent verification. A second reader, and knowledge spreads | Reading cost on every change; the reviewer becomes the constraint | Independent acceptance tests, adversarial agents, a diverse review where it pays. People read when a trigger fires |
| **Kanban WIP limits** | Little's law. Less multitasking, and the constraint shows | None worth changing | Kept: on executors, on every loop's queue, and on the owner's decision queue, as the decision budget |
| **Retrospectives** | Double-loop learning: change the process, not only the product | Built on memory and opinion, held on the calendar | Kept as the slow loop. Proposals cite the ledger, name a Goodhart pair and are tested; the owner decides |
| **MoSCoW and priority lists** | Forces an explicit choice | One list mixes must-be qualities with features | Constraints (floors and done-when checks) versus contributions, ranked by cost of delay over size |
| **Release trains** | Regular, small batches give users a predictable rhythm | Releasing was costly, so it ran on a schedule | Release when the cost of delay of unreleased work exceeds the cost of a release |
| **Product owner** | One accountable voice for priorities | Decides by being present in meetings | Decision rights written as data. Questions are routed by rule, and each answer can become precedent |

## The shared pattern

The principles agree on one pattern ([part 1.3](design/0001-human-in-the-lead.md#the-objective-seen-through-several-frames)):

1. **Someone accountable sets intent and limits.** In HITLd, the owner sets direction, decision rights, budgets and floors.
2. **Others act with local autonomy.** Agents decide two-way doors, log them, and keep moving.
3. **Outcomes are measured against a proxy that can be gamed.** So every target has a Goodhart pair, and the system's changes to itself face evals it cannot see.
4. **Feedback flows to both the actors and the intent.** Fast loops tune the work. Slow loops tell the owner when the intent itself may be wrong.
5. **Autonomy is extended as trust is earned.** Area by area, from the record, and only by the owner's decision.

Scrum follows it too: a product owner sets the goal, the team self-organizes, velocity stands in for value, reviews and retrospectives close the loops. HITLd keeps the pattern and moves the trade-offs to where the scarcity now is: people's attention and judgement.

What comes out is legible. Every result can answer "who decided, and on what evidence?" That is what lets other people trust it.

## Further reading

[Part 20 of the design](design/0001-human-in-the-lead/20-prior-art.md) lists every idea the design uses, by field, with its source and where it is used. Good places to start:

- Donella H. Meadows, _Thinking in Systems_ (2008).
- Donald G. Reinertsen, _The Principles of Product Development Flow_ (2009).
- Eliyahu M. Goldratt and Jeff Cox, _The Goal_ (1984), a novel.
- Stafford Beer, _Brain of the Firm_ (1972).
