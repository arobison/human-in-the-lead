# 4. Roles and decision rights

[Back to the index](../0001-human-in-the-lead.md)

## 4.1 Roles

Each role has a purpose, the decisions it may make, and the privileges it runs with. Privileges are enforced by the agent definitions and hooks ([part 10](10-security.md#102-least-privilege-per-role)), not by trust in the prompt.

| Role | Who | Purpose | Decides | Does not |
|---|---|---|---|---|
| **Owner** | A human | Identity and policy: direction, principles, non-goals, decision rights, weights, budgets | Everything the rules in 4.2 route to them; every rule change; every bet | Approve routine work or read code, except in owner merge mode, where the owner names each merge ([part 14](14-integration.md#142-the-queue)); otherwise code is read only on the triggers in [part 6](06-verification.md#66-when-a-human-reads-the-code) |
| **Area owner** | A human with delegated rights | Judgment within an area | Decisions routed to the area by 4.2 that are not reserved to the owner; verification disputes in the area | Change policy or decision rights |
| **Chief of staff** | The session the owner talks to ([13.1](13-operations.md#the-chief-of-staff-and-disposable-orchestrators)) | Keep the conversation with the owner; relay questions and digests; start orchestrators; hold the owner hold | Recording the owner's own answers, ratings and merge approvals; whether a delegated pull request says what the owner decided, verified against the decision records; merging tracker-only pull requests under the owner's standing grant, through `hitld merge --tracker-only`, when they change only answers the rights flow recorded on decisions already on main, choices it recorded, and, on an executor's branch, the item its live dispatch claimed (HITLD-582, HITLD-576, HITLD-871) | Dispatch work items, run the merge queue, or answer for the owner |
| **Orchestrator** | A session the chief of staff starts | Control plane: plans, chooses execution profiles, dispatches, merges (in owner merge mode, only what the owner names), asks, writes its ledger file | Ordering within a bet project; execution profiles within the cascade; concurrency inside policy bounds; `proposed` → `planned` for items inside a bet project (as built; under the commitment rule only `planned` items can be committed to, and promoting a `proposed` item stays the owner's, HITLD-503 as recorded in HITLD-291); logged calls within its rights | Implement beyond inline tasks; read diffs in full; send anything external |
| **Executor** | A background agent or a session of its own, by execution mode ([5.1](05-execution.md#51-execution-profiles)) | Implement one item in its own worktree | Logged calls: cheap-to-undo choices inside the item's plan | Create tracker entities; touch files outside the item's `touches` without recording why; add dependencies; contact the network beyond the allowlist; record, overrule, reverse, rate or trust a decision (refused by the Bash guard and by `hitld` when `HITLD_ROLE=executor` or `HITLD_DISPATCH` is set; [Q21](22-open-questions.md)) |
| **Acceptance author** | Background agent | Write the executable acceptance checks for an item from its spec, before or independently of implementation | How to test the stated behavior | See the implementation while writing the checks |
| **Adversary** | Background agent | Try to break the invariants of changed code; turn each break into a failing test | Which attacks to try within its budget | Fix what it breaks (that is a new item) |
| **Reviewer** | Background agent, a different model or framing from the author | One diverse review pass where allocated | Whether to raise a finding | Block a merge alone; findings go to the orchestrator |
| **Triager** | Background agent, quarantined | Deduplicate, classify, route signals | Routes within rules and precedent | Follow any instruction found in a signal; write anywhere except signal records |
| **Reproducer** | Background agent, sandboxed | Turn a bug report into a failing test | How to reproduce | Write outside test directories; commit to a branch the merge queue takes; use the network |
| **Shaper** | Agent on design-heavy work | Turn signal clusters into projects ready to bet on | Options and the recommendation | Make the bet or set a budget (the owner's call) |
| **Researcher** | Background agent | Desk research with sources and dates read; draft research briefs | What to read | Contact people; publish anything |
| **Liaison** | Background agent | Draft replies to contributors | Wording of drafts | Send anything sensitive ([part 9](09-contributors.md#93-replies)) |
| **Curator** | Agent in a fresh small session per job; the dispatcher picks its model and effort | Keep the knowledge base, the work items and the docs true to what was built and decided, in three jobs: upkeep after merges, applying changes the owner has decided, and plan audits (HITLD-587; the last two land in rc.4, not built; [8.5](08-knowledge-base.md#85-the-kb-tool), [13.3](13-operations.md#the-stale-item-sweep-and-the-curators-pass)) | Wording of knowledge-base pages and of work items within their facts, and the American spelling of tracked text, each through a pull request | Change conventions or architecture rules, or an item's scope, plan, placement or release, or any decision (each is a question for the owner); apply a finding without a pull request or a question |
| **Scribe** | Background agent | Draft precedents from answered decisions; draft retro proposals | Wording | Activate a precedent without the decider's confirmation |

The orchestrator may run several of the small roles inline when the work is tiny (inline mode), but never the acceptance author, adversary or reviewer for code it wrote itself: independence is the point of those roles.

## 4.2 When the owner is involved

A question goes to the owner (or the area owner, where the rules allow) when **any one** of these holds. Otherwise the agent that holds the question decides it, records it as a logged call, and moves on.

| Rule | The question is theirs when… | Example | Default decider |
|---|---|---|---|
| **One-way door** | Undoing it later is expensive or impossible | Deleting user data; a file format others will write; publishing a package name | Owner |
| **Blast radius** | It changes more than one area, or behavior users rely on, or the build and release pipeline | Changing a core data structure many modules use | Owner if cross-area; area owner if within one area |
| **Public commitment** | It creates or changes something outsiders will depend on: API, naming, file formats, licensing, security posture, deprecations, version semantics | Renaming a public function; adding a dependency with a new license | Owner |
| **Novelty** | No precedent matches, and the principles do not settle it | The first time a contributor asks for a capability outside every non-goal and every roadmap item | Owner if it touches direction; area owner otherwise |
| **Conflicting evidence** | Studies, measurements or credible sources disagree, and the choice depends on which is right | Two benchmark studies with opposite verdicts on an approach | Area owner; owner if cross-area |
| **Relationship** | A person outside the system will read it as coming from the owner or the project, and it is sensitive: a decline, a criticism, a conflict, a promise, anything to a partner organization, a code-of-conduct matter | Declining a large external PR | Owner (or the area owner the owner names for routine contributor matters) |
| **Budget** | It commits more than `rights.agent_spend_max_tokens` tokens beyond an approved budget, or sets a new budget (a budget is what the owner allows a commitment to spend, HITLD-577) | An item at 2.5× its estimate that needs another full attempt | Owner |
| **Security** | It adds a dependency, widens a privilege, changes a trust boundary, handles a vulnerability report, or touches secrets | Adding a new third-party package | Owner |
| **Rule change** | It changes policy bounds, decision rights, a skill, an invariant, or the executor contract | Raising the concurrency ceiling; changing the report shape | Owner |

Three notes on applying these:

- **Hard is not a rule.** A difficult problem that falls under none of these rules goes up the model-and-effort cascade ([part 5](05-execution.md#51-execution-profiles)), not to the owner.
- **Volume is not a rule.** A hundred similar questions are one question with a precedent, not a hundred escalations. The orchestrator batches similar questions before asking (this is requisite variety applied, after Ashby, *An Introduction to Cybernetics*, 1956: the system matches the variety of the questions with rules and precedent, and spends the owner's limited variety only on genuinely new kinds of question).
- **Two-way doors default to action.** When a question is a two-way door and in no other way the owner's, the holder decides it and logs it, even if unsure. Each logged call is a ledger event (`hitld rights log`: what was decided, and the item, dispatch and area it belongs to; the event also records the session and host that made the call). The owner sees them in the digest, each with who made it and the command that reverses it (`hitld rights reverse <ID>`), and can reverse any of them from the main session, prompted by the digest; a reversal becomes precedent.
- **A question that is the owner's and easy to undo carries a default.** The orchestrator sets `default_if_unanswered` (an option and a deadline) on every question that is a two-way door. A one-way door never has one and always waits for the owner. `hitld rights sweep` applies a default whose deadline has passed. It also takes the recommendation of a two-way question when the person's digest has no room left ([part 23](23-people-in-the-lead.md#235-the-interface-as-a-design-surface)). An applied default is recorded with `answered_via: default` and no `answered_by`. It is a ledger `answered` event with `via: default` and a `default` trust event, and it is in none of the answer counts, so it is not the person's latency. The digest lists each one with the command that reverses it (`hitld rights reverse <decision>`); a reversal is counted against defaults, and tells the orchestrator to undo what the default started and apply the owner's choice. A default is read from the record made when the question was asked, never from the decision item, so editing the item cannot make one apply.

### The decision question

Every question to a decider stands alone, so it can be answered from a phone without opening anything.

```
W-412  Decision · blocks 3 items on the critical path · two-way door

Should the report cache key include the database schema version?

Context: Keys without it are stable across schema migrations, so the cache
survives upgrades. One reported bug (SIG-88) came from a migration that
changed a report's columns between versions.

Recommend: A. Include the schema version. Correctness beats a cold cache
after upgrades, which is rare.

  A. Include it: always correct; cache rebuilds after migrations.
  B. Exclude it: faster after upgrades; rare stale-report bugs.
  C. Include it only for migrations known to change columns: both, at the
     cost of a list to maintain.

Future cases like this (cache keys vs. external versions): treat the same way? (yes / just this one)

Check code: 7f3a91c2
```

The last line is the **precedent offer** (4.3). The owner can answer `A`, `A yes`, `B just this one`, or with the words of one option's label ("enroll it"). An answer that names no option is refused, and nothing is recorded: no ledger event, no trust event, no change to the item, and no change to who may read the store. The refusal (`answer-matches-no-option`) lists the options. Words match a label only when they are the whole label, after filler words ("it", "the", "please") and simple spelling variants ("enroll" for "enroll") are set aside; a word the label lacks, such as "not", means no match. When the words fit more than one option, the answer is refused too. A letter names an option only on its own: the whole answer, after "option", before punctuation, or before the reply to the precedent offer (`A`, `option B`, `B.`, `A yes`). As the first word of a sentence it is a word, in either case: "a different idea" names no option. A reason goes after the letter or the label (`A, because ...`).

**An answer is bound to the question as shown.** Each question ends with a short **check code**: eight hex digits of a hash of its question, context and options and, for a store device decision, the action, the device's name and its key's fingerprint. It is recorded with the question in the private store (`rights/asked/<ID>.json`), and every place a question is shown shows it: `hitld rights ask --send`, `hitld rights show`, the digest, and the device commands that ask. The session that shows a question records the code it showed (`rights/shown.jsonl`, by session). `hitld rights answer <ID> --answer <answer> [--code <code>]` refuses with `answer-question-changed`, and records nothing, when:

- the code given, or without one the code this session last showed for that ID, is not the ask record's;
- the tracker item and the ask record are not the same question (its title, its question text, its options);
- the action the answer would apply is not the one asked: for a device decision, the action, the device's name and the fingerprint of the waiting device decision must be the ones in the record. Another device decision filed under the same ID is not settled by the answer; the result says so, and it is asked again under an ID of its own.

This is how an owner-mode merge approval is bound to the batch it presents ([14.2](14-integration.md#142-the-queue)): the answer names what was shown, and a changed question is never answered by an answer to the old one. Two sessions that filed under one ID therefore never have one answer applied to the other's question.

**The harness's question tool.** Where the harness has a structured question tool, the orchestrate and chief-of-staff skills ask each decision with it: the ID, the question and the check code in the question, one choice per option, the recommendation first, and the full text beside it. The option the owner picks there is the owner's own answer in that session, and is recorded with its code (`--via question-tool`). The owner may still type their own words; they follow the matching rule above.

**Filed before it is asked** (HITLD-542). Before each question is shown, the chief of staff writes it to the tracker as a pending decision (question, options, recommendation). A question box that a worker restart drops is asked again on resume from that record, and the owner's answer closes it. *Decided, not built (HITLD-543).*

## 4.3 Precedent

Answered decisions become **precedent**: rules that resolve matching future questions without asking. This is case law for the project.

### Creating a precedent

1. When a decision is answered, the scribe drafts a precedent: the rule ("when *conditions*, do *action*"), the conditions in structured form where possible, the exceptions, and the scope (project or one area).
2. **The decider confirms the generalization** (decided: [Q3](22-open-questions.md)). The decision's answer covers the case; the generalization is the agent's inference and could overreach. So the draft goes back with the answer's acknowledgement (or rides in the question as the precedent offer above, to save a round trip). The decider can accept, narrow ("only for cache keys"), or decline ("just this one").
3. A confirmed precedent becomes `active`, gets an ID, and is indexed by its structured conditions.

### Applying a precedent

When any agent holds a question that would go to a decider:

1. It queries the precedent index by structured conditions (area, item kind, rights basis, path globs, tags). This is a script, so it costs few tokens.
2. For candidates, it judges whether the plain-language conditions and exceptions fit. If one precedent fits clearly, the question is **resolved by precedent**: the answer is applied, the decision item (if one was created) is closed with `resolved_by_precedent`, and the application is listed in the next digest.
3. If more than one precedent fits and they disagree, or the fit is uncertain, the question goes to the decider with the candidate precedents cited. Answering it narrows or reconciles them.

### Keeping precedent healthy

- **Overrules.** The owner can reverse any application, from the main session (`hitld rights overrule`), prompted by the digest, which lists the applications. A reversal narrows the precedent (adds an exception) or retires it, and the reversal itself is recorded.
- **Strength.** A precedent's applications and overrules are derived counts. A precedent with overrules above `precedent.overrule_max` share is put to the owner for review.
- **Freshness.** A precedent records the policy version and date it was last checked. When the owner changes principles or non-goals, precedents that cite the changed text are flagged for review.
- **Goodhart pair.** The auto-resolution rate (share of questions resolved by precedent) is only good while the overrule rate stays low. Both are reported together ([part 11](11-metrics-and-control.md#113-goodhart-pairs)).
- **Classification.** A precedent from a confidential decision is confidential and lives in the private store; its rule can still be applied, but it is cited by ID only in public artifacts.

## 4.4 Decision rights are data

The rules in 4.2 are encoded in `policy.json` (`rights.*`): thresholds (`agent_spend_max_tokens`), the area map, which areas have area owners, and which rule bases area owners may decide. The orchestrator's skill applies them through a script that takes a question's attributes and returns the decider and the rule that fired. Changing any of it is itself a rule change: the owner's decision.

## 4.5 Several humans in the lead

The design point is one owner, but a project may have co-maintainers. The model extends without changing shape.

**An answer counts by a checkable proof, not by its channel** (HITLD-515). One answer record carries a proof field: today the proof is the harness-attested turn of the person in their own session; later it is the person's own signature. The session, a web page or any other client only carries the proof, and a write without one is data, not an answer. Which key signs answers (a device key with the person known by enrollment, or a separate person key) is not decided: it is settled when the store's device-approval migration is designed (HITLD-516, HITLD-333). Until then answers come only from the owner's own turns in the main session, and area owners cannot answer decisions yet ([Q21](22-open-questions.md)). *Decided, not built (HITLD-564).*

**Contributor input counts through a tracker platform's authenticated identity** (HITLD-517). Input on a proposal counts when the platform (GitHub, Jira, Linear, through its tracker adapter) authenticated its author; the contributor list maps platform accounts to people; the text is copied and hashed when recorded, because platforms let authors edit or delete a comment; an integration or bot account is not a person. On a git-file tracker the input comes through the contributor's pull request on the platform, since git commit authors are not authenticated unless signed. It is input only: deciding stays with the owner until HITLD-44 says who else decides (HITLD-501, not built).


- **Delegation by area.** The owner delegates decision rights per area (`rights.areas` in `policy.json`): which rule bases each area owner may decide, and which stay with the owner. One-way doors, public commitments that span areas, rule changes and the protected core ([part 18](18-self-improvement.md#1-a-protected-core-changed-only-with-the-owners-approval)) stay with the owner unless the owner delegates them explicitly.
- **Routing.** `hitld rights` returns the decider by area; a question spanning areas goes to every area owner involved, and to the owner if any of them is not authorized for its rule basis.
- **Disagreement between humans.** When two deciders answer a shared question differently, or one overrules another's precedent: the system records both positions with their reasons, does not pick a side, and asks the owner (or, for an area-level matter, the area's senior owner named in policy) to decide. Work that depends on the question waits; other work continues. The decision records who decided and why, and becomes precedent like any other.
- **Attention budgets per human.** Each human has their own decision budget and quiet hours.
- **Onboarding a new human.** A new co-maintainer gets: the strategy page, the decision log and active precedents for their areas (generated), the knowledge base index, a short guided first review (a digest of recent decisions in their area, with the reasoning), and a trust level set by the owner ([part 9](09-contributors.md#92-trust-levels)). Their first decisions are shown to the owner in the digest until the owner says otherwise.
- **The audit trail** ([part 3](03-data-model.md#audit-record)) records which human decided what, so delegated decisions stay accountable.
- **Each human's judgment and interface.** Their calls are recorded with outcomes, their quick reads are weighted by their own record, they get a private calibration review, and their questions follow per-person defaults: [part 23](23-people-in-the-lead.md).

## 4.6 Autonomy changes with the record

Which questions agents settle alone is not fixed. Each process that acts without asking registers its kinds of decision with the trust engine ([2.15](02-loops.md#215-trust-calibration)), which keeps each kind's supervision mode and its evidence, per project, and proposes an unlock to the owner as a decision when a kind meets its bar. What a miss does depends on the kind: merging re-locks at once and starts its evidence again from zero (HITLD-479), a commitment kind drops one mode (HITLD-506), and other processes register their own rule (HITLD-525). Every change is the owner's decision; the system never grants itself autonomy. Tuning settings inside the bounds the owner set (the concurrency ceiling, the batch interval) is not autonomy. Autonomy means decision rights, and only the owner changes those. *Decided, not built (HITLD-552 to HITLD-556):* until the engine is built, nothing beyond the owner's standing delegations acts without asking.

**Merging without asking** (HITLD-472). The authority rests on risk first, and history only widens what counts as low risk; a count of approvals is not the signal (HITLD-473). Some kinds of change never merge without the owner's yes, whatever their history: data formats; the public interface and policy; skills, hooks and agent contracts; security and rights (HITLD-474). Docs, comments and wording; tests and fixtures; code changes with their own tests; and dashboard and report presentation may become eligible (HITLD-475). A change merges without asking only when both gates pass: its kind has earned the unlock bar, and the change itself is verifiable (HITLD-518). The detail is in [14.2](14-integration.md#142-the-queue).

**Committing to work** (HITLD-291). The unit of autonomy is **a goal under a budget** (HITLD-503): the owner signs off a goal and its budget once, and the system commits to the `planned` items that serve the goal, in critical-path order, stopping when the goal is met, the budget is spent or the quota gate says stop. Promoting a `proposed` item stays the owner's.

- **The goal and its budget** (HITLD-522). A goal is an existing milestone or release item, which already has an outcome and checkable "done when" clauses. The budget (tokens, time, the owner's attention) lives in a **commitment decision** the owner signs, with the goal and the mode for each kind of commitment. A new budget is a new decision, and it carries an answer's proof ([4.5](#45-several-humans-in-the-lead)). The quota gate's reserve always wins over any budget.
- **Kinds of commitment, all on the scale of trust** (HITLD-504). One-way-door builds (data and store formats, public commands and settings, security and rights), an item that is a big share of the budget, and changes to a public promise start at asking first; patch releases may eventually go out without the owner's yes. An item the owner holds stays held in every mode.
- **Three modes in a chain** (HITLD-505, HITLD-527). Ask first; tell the owner, then proceed unless they object within a window; proceed and report afterward. Each kind of commitment earns its own mode. The objection window counts the owner's awake time (quiet hours pause it), is set per kind in the signed commitment decision with a default of 4 hours, and the owner objects by any reply or by putting the item on hold; silence proceeds only after the window (HITLD-523).
- **Evidence** (HITLD-506). Finished within budget, an estimate close to the measured cost, an item later dropped or abandoned as the wrong work, and the owner's report, on top of the engine's shared signals.
- **When a commitment ends** (HITLD-524). At first the system stops, and the chief of staff confers with the owner, who decides the next goal and budget. Choosing the next goal among existing ones is itself a kind of commitment that earns modes by the same machinery, and creating a new goal is a separate kind; each step is the owner's to grant through an unlock proposal.

**Escalation fixes** are their own kind ([2.4](02-loops.md#24-prioritization)), and **tracker edits** by the chief of staff and the curator, with **tracker-only merges**, start as the owner's initial grants (HITLD-576).

**A preference never widens authority** (HITLD-569). How the owner likes to work (style and process) is its own person-level record, written from the owner's own words or from proposals the owner confirmed, and loaded by the chief of staff in any harness; harness memory is only a cache of it. It is not precedent: anything in it that would widen what the system does alone becomes an unlock proposal instead. *Decided, not built (HITLD-570).*

*As built:* in owner merge mode each approval is recorded as a trust event per area, with its latency, whether the owner took the batch as presented, and any later revert, and after `merge.propose_queue_after` clean merges in a row in an area the system proposes the automatic queue there ([14.2](14-integration.md#142-the-queue)). The trust engine replaces that rule; past approval counts do not count toward the new bar (HITLD-520).
