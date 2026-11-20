# 6. Verification: the compiler model

[Back to the index](../0001-human-in-the-lead.md)

## 6.1 The model

When programmers moved from assembly to C, and from C to C++, many read the generated code under the hood until use and testing had built enough trust in the compiler. Today few people read generated assembly, and they do it with a specific question, when a compiler bug is suspected. The trust rests on evidence that accumulated over time: test suites, differential testing against other compilers, fuzzing, years of use with few escaped defects, and a clear process for what happens when a defect is found.

Generated code goes through the same transition, area by area. Early on, people read more: owner merge mode, where the owner names each merge, is that stage. As the evidence accumulates, reading drops to the triggers in 6.6. **People do not read generated code unless a trigger says they must**, once an area has the record. Confidence comes from:

1. **Independent verification**: the code's author does not write its acceptance tests (6.2).
2. **Strong tests**: property-based, metamorphic and differential tests, fuzzing, and mutation testing to measure how strong the tests are (6.3).
3. **Adversarial agents** that try to break invariants, each break becoming a permanent regression test (6.3).
4. **Provenance**: every change traceable to its item, brief, model and evidence (6.4).
5. **Reliability over time**: escaped defects and reliability growth per area, which set how much scrutiny each area gets (6.5).

The difference from a compiler is that this "compiler" changes (new models, new skills) and its errors are correlated (agents from one model tend to share blind spots). So verification must be **diverse** (different models or framings for author, tester, adversary and reviewer) and the reliability record must be **reset or re-earned** when the model changes, or when a skill change alters behavior (6.5).

## 6.2 Independent verification

- **Acceptance checks come from the spec, not the code.** For work items whose "done when" is not already an existing test, an acceptance author agent writes the checks from the item file and its plan section, without seeing the implementation. It runs before or in parallel with the executor. The executor may add its own tests, but its tests do not count toward acceptance.
- **Until the acceptance author exists** (a later milestone, [part 21](21-scope.md)), dispatch goes ahead without one. Acceptance evidence is then the executor's tests, plus the full suite in the merge, plus the owner's review in owner merge mode.
- **Reproduced bugs come with their test.** A bug triaged into a failing test ([part 2](02-loops.md#22-triage)) already has its acceptance check, written before the fix.
- **The author does not judge its own work.** Verification is run by the merge queue's scripts and by separate agents. The executor's report states evidence; it does not declare acceptance.
- **Security is part of "done when"** ([10.5](10-security.md#105-security-in-done-when); the scans and triage records are built, HITLD-63, and the sensitive-path review and threat-model notes are planned, HITLD-34). The merge checks scan the change against the project's baseline of known findings, so a change fails only on findings it introduces. Each new finding needs a recorded triage verdict in the item's evidence: real (fixed, with a test that would have caught it), by design (the trust boundary named at the sink) or false positive (a one-line reason). Accepting a real risk is the owner's decision, with an expiry. An item that touches the sensitive-path list gets an independent security review by a different agent; a design-level item carries a short threat-model note.
- **Diversity.** The acceptance author, adversary and reviewer use a different model from the executor where one is available, or at least a different framing (a prompt that sets them against the change rather than alongside it).

## 6.3 Test kinds and the adversarial loop

### Kinds of test

| Kind | What it checks | Where it pays |
|---|---|---|
| **Example tests** | Specific inputs give specific outputs | Everywhere; the baseline |
| **Property-based** | An invariant holds for generated inputs (round trips, ordering, conservation, idempotence) | Data structures, serialization, math, caches |
| **Metamorphic** | A known relation between outputs holds when the input is transformed, without knowing the right output | Where no oracle exists. For a search index: the same documents added in a different order give the same results; adding an unrelated document does not change the ranking of the others; splitting a document in two does not change which terms match |
| **Differential** | Two implementations agree: the new against an oracle (a previous version, a reference implementation, a simple slow version) | Rewrites, optimizations, ports |
| **Fuzzing** | No crashes, hangs or sanitizer errors on mutated inputs | Parsers, loaders, anything that reads external files |
| **Mutation testing** | The tests catch deliberately introduced faults in the changed code | Measuring test strength, not product correctness |
| **Architecture fitness functions** | Architectural rules hold: dependency direction, module boundaries, size budgets, performance budgets (through the benchmark tool) | Every merge batch |

The skills include templates for each kind, and the knowledge base records, per area, which oracles and relations exist.

**Mutation testing on the diff.** Running mutation testing on a whole large codebase is expensive. The verification skill runs it on the lines a change touched (the approach Petrović and Ivanković describe in "State of Mutation Testing at Google", ICSE-SEIP 2018), and reports surviving mutants. A surviving mutant in changed code is a finding: either the tests are missing a case, or the code is dead. The mutation score on changed lines is tracked per area; its Goodhart pair is test runtime and flake rate.

### The adversarial loop

1. Each area has an **invariant registry** in the knowledge base: the properties that must always hold (for example, "the cache never returns a report built for a different key"; "output is deterministic for a fixed seed"). Each invariant has a "checked" date.
2. For changes in an area with allocated adversarial budget, an adversary agent receives the change, the area's invariants, and the existing tests. Its job is to break an invariant: find an input, sequence or configuration that violates it.
3. **Every break becomes a failing test** committed to the regression suite, as does every security finding caught by a scan or a security review ([10.5](10-security.md#105-security-in-done-when)); a break in agent behavior becomes an eval scenario. The fix is a new item (or a follow-up to the same executor). The test stays unless a decision retires it; a flaky one is handled as in [part 14.7](14-integration.md#147-flaky-tests). This is how the system improves itself: each found defect permanently raises the floor.
4. An adversary that finds an unregistered invariant (behavior that seems to matter but is not listed) proposes it for the registry; adding it is the area owner's call (the owner's, until area owners can answer; [Q21](22-open-questions.md)).
5. Adversarial budget per area is set by the review-allocation controller from defect yield per token ([part 11](11-metrics-and-control.md#114-feedback-controllers)), with a floor so that every area is probed sometimes.

### Review

One **diverse review pass**, only where it pays: the review-allocation controller sets a review probability per area and execution profile from the yield of past reviews (confirmed findings per review token), with a floor for exploration. A reviewer's findings go to the orchestrator, which sends confirmed ones back to the executor as a follow-up. Reviews never block alone; a disputed finding goes to the area owner (the owner, until area owners can answer; [Q21](22-open-questions.md)).

## 6.4 Provenance

Every commit made by an agent carries git trailers:

```
Work-Item: W-214
Dispatch: D-3071
Agent-Role: executor
Agent-Model: <model id>
Agent-Effort: high
Brief: sha256:9c1e…        (later)
Plugin-Version: 0.1.0      (later)
Evidence: R-1251           (later)
```

The built trailers are the first five. `Brief`, `Plugin-Version` and `Evidence` follow with the "Verification depth" milestone ([part 21](21-scope.md)).

- The trailers link each line of code to its item, its brief (in the ledger by hash), the model that wrote it, and the evidence that verified it. `git log` and `git blame` answer "who wrote this and why" for generated code.
- All of the trailers, `Brief`, `Plugin-Version` and `Evidence` included once built, appear in public commits ([Q5](22-open-questions.md)). The ledger holds the same links privately.
- A later milestone adds signed attestations in the [SLSA](https://slsa.dev/) v1.0 provenance format (an in-toto predicate) for releases, so consumers of the project's packages can verify how they were built.

## 6.5 Reliability over time

- **Escaped defects** are defects found after merge: by users, by later tests, by adversaries probing old code, or by incidents. Each is linked to the commit that introduced it (by bisection or blame) and therefore, through provenance, to its item, execution profile, model and skill versions.
- **Change failure rate** is the share of merged items that later needed a revert or a fix that cites them.
- **Reliability growth per area.** For each area, the system tracks cumulative escaped defects against cumulative changes. When the defect discovery rate falls as changes accumulate (in the Crow-AMSAA model, a growth parameter below 1; see MIL-HDBK-189C, *Reliability Growth Management*), the area's reliability is growing. An area's reliability sets its human-read sampling rate, its adversarial floor and its auto-fix eligibility.
- **Re-earning trust.** A major change resets the affected areas' sampling rates to the defaults until enough new samples accumulate (`verification.recalibration_samples`). A change is major when it is a new model, or a skill change that the eval gate ([part 17](17-evals.md)) flags as changing behavior.

## 6.6 When a human reads the code

A human (the area owner or the owner; the owner alone, until area owners can answer) reads generated code only when one of these triggers fires. Each read is **directed**: the system presents the smallest region of the diff that matters and the specific question to answer, and the read counts against the attention budget.

| Trigger | What gets read | Question |
|---|---|---|
| **Security-sensitive paths** (the sensitive-path list, `security.sensitive_paths`: authentication, sandboxing, secrets handling, policy and settings loading, cryptography, dependency manifests, CI configuration) | The changed region | Does this widen what anything can access? |
| **Public surface change** (API, formats, naming) | The public signatures and docs, not the implementation | Is this the commitment we want? |
| **Escaped defect in the area** | Sampled changes in the area until its reliability recovers | What class of mistake is getting through, and which rule should change? |
| **Verification disagreement** (an adversary or reviewer finding the author disputes, or a surviving mutant that cannot be killed) | The disputed region | Who is right? |
| **Random audit sample**, at the area's sampling rate | One change | Does anything surprise you? (Findings feed rule changes) |
| **New dependency** | The manifest change and the package's provenance | Do we accept this dependency? |
| **Provenance or licensing concern** (a large block that looks copied, an unusual license header) | The block | Can we ship this? |
| **Owner-reviewed UI work** | The running UI, not the code | Is this what you want people to see? |
| **First changes after a model or skill change** in an area | A sample | Is the new configuration as good as the old? |

Nothing else triggers a read. In particular, size and complexity do not: a large, well-tested change in a reliable area is not read.

In owner merge mode, these reads ride on the merge question ([14.2](14-integration.md#142-the-queue)): each green branch is presented with the reads its triggers call for, and a branch no trigger fires on carries none. The merge queue fires the triggers it can see in the diff: security-sensitive paths (`dispatch.sensitive_globs`), public surface (`merge.public_globs`), a new dependency (a changed dependency manifest) and owner-reviewed UI work (`dispatch.owner_review_areas`). The others need records not yet kept, such as an area's escaped defects and sampling rate.
