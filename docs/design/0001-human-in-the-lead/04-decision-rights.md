# 4. Roles and decision rights

[Back to the index](../0001-human-in-the-lead.md)

## 4.1 Roles

Each role has a purpose, the decisions it may make, and the privileges it runs with. Privileges are enforced by the agent definitions and hooks ([part 10](10-security.md#102-least-privilege-per-role)), not by trust in the prompt.

| Role | Who | Purpose | Decides | Does not |
|---|---|---|---|---|
| **Owner** | A human | Identity and policy: direction, principles, non-goals, decision rights, weights, budgets | Everything the rules in 4.2 route to them; every rule change; every bet | Approve routine work or read code, except in owner merge mode, where the owner names each merge ([part 14](14-integration.md#142-the-queue)); otherwise code is read only on the triggers in [part 6](06-verification.md#66-when-a-human-reads-the-code) |
| **Area owner** | A human with delegated rights | Judgment within an area | Decisions routed to the area by 4.2 that are not reserved to the owner; verification disputes in the area | Change policy or decision rights |
| **Orchestrator** | The main Claude Code session | Control plane: plans, sizes, dispatches, merges (in owner merge mode, only what the owner names), asks, keeps the ledger | Ordering within a bet project; tier assignment; concurrency inside policy bounds; `proposed` → `planned` for items inside a bet project; logged calls within its rights | Implement beyond tier-0 tasks; read diffs in full; send anything external |
| **Executor** | Background agent (tiers 1–2) or session (tier 3) | Implement one item in its own worktree | Logged calls: cheap-to-undo choices inside the item's plan | Create tracker entities; touch files outside the item's `touches` without recording why; add dependencies; contact the network beyond the allowlist; record, overrule, reverse, rate or trust a decision (refused by the Bash guard and by `hitld` when `HITLD_ROLE=executor` or `HITLD_DISPATCH` is set; [Q21](22-open-questions.md)) |
| **Acceptance author** | Background agent | Write the executable acceptance checks for an item from its spec, before or independently of implementation | How to test the stated behavior | See the implementation while writing the checks |
| **Adversary** | Background agent | Try to break the invariants of changed code; turn each break into a failing test | Which attacks to try within its budget | Fix what it breaks (that is a new item) |
| **Reviewer** | Background agent, a different model or framing from the author | One diverse review pass where allocated | Whether to raise a finding | Block a merge alone; findings go to the orchestrator |
| **Triager** | Background agent, quarantined | Deduplicate, classify, route signals | Routes within rules and precedent | Follow any instruction found in a signal; write anywhere except signal records |
| **Reproducer** | Background agent, sandboxed | Turn a bug report into a failing test | How to reproduce | Write outside test directories; commit to a branch the merge queue takes; use the network |
| **Shaper** | Tier-2 or tier-3 agent | Turn signal clusters into projects ready to bet on | Options and the recommendation | Commit an appetite (that is a bet: owner's call) |
| **Researcher** | Background agent | Desk research with sources and dates read; draft research briefs | What to read | Contact people; publish anything |
| **Liaison** | Background agent | Draft replies to contributors | Wording of drafts | Send anything sensitive ([part 9](09-contributors.md#93-replies)) |
| **Curator** | Tier-1 agent | Keep the knowledge base and the work items true to what was built and decided ([8.5](08-knowledge-base.md#85-the-kb-tool), [13.3](13-operations.md#the-stale-item-sweep-and-the-curators-pass)) | Wording of knowledge-base pages and of work items within their facts, and the American spelling of tracked text, each through a pull request | Change conventions or architecture rules, or an item's scope, plan, placement or release, or any decision (each is a question for the owner); apply a finding without a pull request or a question |
| **Scribe** | Tier-1 agent | Draft precedents from answered decisions; draft retro proposals | Wording | Activate a precedent without the decider's confirmation |

The orchestrator may run several of the small roles inline when the work is tiny (tier 0), but never the acceptance author, adversary or reviewer for code it wrote itself: independence is the point of those roles.

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
| **Budget** | It commits more than `rights.agent_spend_max_tokens` tokens beyond an approved appetite, or bets a new appetite | An item at 2.5× its estimate that needs another full attempt | Owner |
| **Security** | It adds a dependency, widens a privilege, changes a trust boundary, handles a vulnerability report, or touches secrets | Adding a new third-party package | Owner |
| **Rule change** | It changes policy bounds, decision rights, a skill, an invariant, or the executor contract | Raising the concurrency ceiling; changing the report shape | Owner |

Three notes on applying these:

- **Hard is not a rule.** A difficult problem that falls under none of these rules goes up a tier ([part 5](05-execution.md#51-sizing-tiers)), not to the owner.
- **Volume is not a rule.** A hundred similar questions are one question with a precedent, not a hundred escalations. The orchestrator batches similar questions before asking (this is requisite variety applied, after Ashby, *An Introduction to Cybernetics*, 1956: the system matches the variety of the questions with rules and precedent, and spends the owner's limited variety only on genuinely new kinds of question).
- **Two-way doors default to action.** When a question is a two-way door and in no other way the owner's, the holder decides it and logs it, even if unsure. Each logged call is a ledger event (`hitld rights log`: what was decided, and the item, dispatch and area it belongs to; the event also records the session and host that made the call). The owner sees them in the digest, each with who made it and the command that reverses it (`hitld rights reverse <ID>`), and can reverse any of them from the main session, prompted by the digest; a reversal becomes precedent.
- **A question that is the owner's and easy to undo carries a default.** The orchestrator sets `default_if_unanswered` (an option and a deadline) on every question that is a two-way door. A one-way door never has one and always waits for the owner. `hitld rights sweep` applies a default whose deadline has passed. It also takes the recommendation of a two-way question when the person's digest has no room left ([part 23](23-people-in-the-lead.md#235-the-interface-as-a-design-surface)). An applied default is recorded with `answered_via: default` and no `answered_by`. It is a ledger `answered` event with `via: default` and a `default` trust event, and it is in none of the answer counts, so it is not the person's latency and not a rubber stamp. The digest lists each one with the command that reverses it (`hitld rights reverse <decision>`); a reversal is counted against defaults, and tells the orchestrator to undo what the default started and apply the owner's choice. A default is read from the record made when the question was asked, never from the decision item, so editing the item cannot make one apply.

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

The design point is one owner, but a project may have co-maintainers. The model extends without changing shape. Area owners cannot answer decisions yet: answers come only from the owner's own turns in the main session, and signed answers come with a second human ([Q21](22-open-questions.md)).


- **Delegation by area.** The owner delegates decision rights per area (`rights.areas` in `policy.json`): which rule bases each area owner may decide, and which stay with the owner. One-way doors, public commitments that span areas, rule changes and the protected core ([part 18](18-self-improvement.md#1-a-protected-core-changed-only-with-the-owners-approval)) stay with the owner unless the owner delegates them explicitly.
- **Routing.** `hitld rights` returns the decider by area; a question spanning areas goes to every area owner involved, and to the owner if any of them is not authorized for its rule basis.
- **Disagreement between humans.** When two deciders answer a shared question differently, or one overrules another's precedent: the system records both positions with their reasons, does not pick a side, and asks the owner (or, for an area-level matter, the area's senior owner named in policy) to decide. Work that depends on the question waits; other work continues. The decision records who decided and why, and becomes precedent like any other.
- **Attention budgets per human.** Each human has their own decision budget and quiet hours.
- **Onboarding a new human.** A new co-maintainer gets: the strategy page, the decision log and active precedents for their areas (generated), the knowledge base index, a short guided first review (a digest of recent decisions in their area, with the reasoning), and a trust level set by the owner ([part 9](09-contributors.md#92-trust-levels)). Their first decisions are shown to the owner in the digest until the owner says otherwise.
- **The audit trail** ([part 3](03-data-model.md#audit-record)) records which human decided what, so delegated decisions stay accountable.
- **Each human's judgment and interface.** Their calls are recorded with outcomes, their quick reads are weighted by their own record, they get a private calibration review, and their questions follow per-person defaults: [part 23](23-people-in-the-lead.md).

## 4.6 Autonomy changes with the record

Which questions agents settle alone is not fixed. The trust-calibration loop ([part 2](02-loops.md#215-trust-calibration)) tracks, per area, how often the owner overturns the system's decisions, whether escalated questions were worth asking, and how accurate precedent matching is, and proposes more or less autonomy accordingly. Every change is the owner's decision; the system never grants itself autonomy. Merges are part of the record: in owner merge mode each approval is a trust event, with its latency, whether the owner took the batch as presented, and any later revert, and a run of clean merges in an area leads the system to propose the automatic queue there ([14.2](14-integration.md#142-the-queue)). The owner decides. Tuning settings inside the bounds the owner set (the concurrency cap, the batch interval) is not autonomy. Autonomy means decision rights, and only the owner changes those.

