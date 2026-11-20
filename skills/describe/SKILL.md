---
name: describe
description: Write the description of a human-in-the-lead tracker entity (a work, decision or external item, a project, or a milestone) so that the executor who reads it through a brief and the person who decides on it need nothing else. Says what each part is for, with short good and poor examples, and the rubric the description-quality eval grades by. Use before you file or reword an item, project or milestone with `hitld work new`, `hitld rights ask` or by hand.
license: Apache-2.0
compatibility: Needs the hitld command line (Node 22.13 or later).
metadata:
  version: 0.0.0
  built_by: HITLD-75
---

# Write a tracker description

Every description you write is read many times: by executors through their briefs, by the curator, and by the person deciding. A thin or vague one costs tokens, questions back and rework, and a milestone outcome no one can check can never be done. Write each part for the reader who has only this entity and the design it points to.

`hitld work check` warns about the mechanical problems below (`description (<rule>)` in its `warnings`). A warning is not a refusal; fix it before you publish. Whether a description is good is graded against the rubric at the end, by a model other than the one that wrote it (the eval category `description-quality`).

## For every entity

- **Plain and precise.** Short sentences, American English, the design's own terms. Say what changes for whom, not how hard it was.
- **No time estimates.** No hours, days, story points or "quick". Size is set at sizing, in tokens (`estimate_tokens`). Rule: `time-estimate`.
- **No history of how a decision was reached.** Not "after discussion", "on the call", "we first thought". State what was decided and cite the decision item by ID. A dated follow-up section that records a later decision and its ID is fine. Rule: `decision-history`.
- **Private things by role.** "The store repository", "a device", never their names. The commit guard refuses a term from the private term list; the check reports it in a draft as `forbidden-word`, naming its kind and line, never the term.
- **Point, do not restate.** Cite the design section (`design 3.2`, a path and heading) rather than copying it; the brief points there too.

## Items

### Work items

| Part | What it is for | How to write it |
|---|---|---|
| **Why** | The outcome and who it serves | One to three sentences: the problem in the user's terms, who has it, what is different once the item is done. Rule: `missing-why` |
| **Done when** | The acceptance criterion; the executor stops when it holds, the reviewer checks it | One bullet per check a reader can run, see or count: a command and its result, a file, a state, a number, a refusal. Rules: `missing-done-when`, `unobservable-done-when` |
| **Plan** | Where the approach is decided | A pointer to a design section, or the plan in a few bullets. Not a diary |
| **Notes** | Anything else a reader needs | Constraints, related items by ID, known traps. Not the conversation that produced the item |

Good:

> ## Why
>
> A config file with an unknown key loads silently today, so a typo turns a setting off without notice. People who edit `policy.json` by hand need to see the mistake.
>
> ## Done when
>
> - `hitld check policy` refuses a policy file with an unknown key, naming the key and the line.
> - A test loads a fixture with a misspelled key and asserts the refusal.

Poor (no Why; the first line is vague, the second only says the work is done, and it carries an estimate and history):

> ## Done when
>
> - Config handling is more robust.
> - Validation is implemented.
>
> After discussion on the call we agreed this should take about two days.

### Decision items

`hitld rights ask` writes the shape: **Question** (one question, answerable by choosing), **Options and recommendation** (each option with its consequence, the recommendation first and why), **Answer** (filled when answered). Put the context a decider needs in the question itself; no history of who asked whom.

### External items

**Waiting on** names who does the work (the owner, a contributor, a vendor, an upstream project) and what it is. **Done when** says how anyone can tell it happened. Rule: `missing-waiting-on`.

## Projects

| Part | What it is for | How to write it |
|---|---|---|
| **Summary** | What the project is, for someone who reads nothing else | The problem in the user's terms and the outcome, in two to four sentences. Rule: `missing-summary` |
| **Outcome** | What is true for users when the project's milestones are done | Stated on its milestones (below); the summary names it in words |

Good: "Consuming projects cannot see why a dispatch was refused. When this is done, every refusal names its rule and the setting that would change it, and the dashboard shows the last ten."

Poor: "Improvements to dispatch. Various fixes and cleanup."

An **initiative** is now a milestone with no parent, a long outcome whose constraints are other milestones (design 3.2, HITLD-90). Write it as a milestone.

## Milestones (and initiatives)

| Part | What it is for | How to write it |
|---|---|---|
| **Outcome** | The state for users, or the question answered | One sentence. Named by its outcome, never a number or phase. Rule: `missing-outcome` |
| **Done-when clauses** | The predicates that make the outcome true | Each clause `cN:` is an outcome a check can observe ("a new user installs the plugin and dispatches a first item without help"), not a list of outputs ("the docs are finished"). Rules: `missing-clauses`, `unobservable-done-when` |
| **Check** | The independent check that the outcome holds | `demo`, `integration-test` or `study`, then what it runs and what it must show. Someone other than the items' authors runs it. Rule: `missing-check` |

Good: outcome "A config mistake is explained where it is made"; clause "c1: `hitld check policy` names the key and line for each of the seeded mistakes in the fixture"; check "integration-test: the seeded-mistakes fixture, run by the acceptance author".

Poor: outcome "Phase 2"; clause "c1: Config work is finished"; no check.

## The rubric

The description-quality eval grades a draft on these, each pass or fail; a draft passes when it fails none. The judge is a different model from the writer.

1. **Purpose.** The reader can say what changes for whom (Why, Summary or Outcome).
2. **Checkable.** Each Done-when line or clause names something to run, see or count.
3. **Bounded.** The scope is clear enough that an executor would not have to ask what is in or out.
4. **Pointed.** It cites the design or decisions it depends on, by section or ID, instead of restating them.
5. **Clean.** No time estimate, no history of how a decision was reached, nothing private by name.

When an executor sends a question back, deviates because the scope was unclear, or the owner rewrites what you wrote, that is evidence the description failed one of these. Fix the entity, and when the same rule keeps failing, propose a change to this guide.
