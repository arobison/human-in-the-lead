# 10. Security, trust boundaries and information classification

[Back to the index](../0001-human-in-the-lead.md)

## 10.1 Threat model

| Threat | How it arrives | Main defence |
|---|---|---|
| **Prompt injection** | Text in issues, PR descriptions, comments, commit messages from outsiders, code comments, test fixtures, web pages, dependency READMEs, tool output | Quarantine: an agent that reads untrusted text never also has the means to act on it (10.2) |
| **Data exfiltration** | An injected instruction asks an agent to send private data somewhere | No agent holds all three of: private data, untrusted input, and an outbound channel (the "lethal trifecta", [Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/); [part 20](20-prior-art.md)) |
| **Malicious contribution** | A PR that adds a backdoor, weakens a check, or runs code in CI | Sandboxed CI without secrets for T0–T1; human-read trigger on security-sensitive paths; adversarial verification |
| **Supply chain** | A new or updated dependency | Human gate on new dependencies; lockfiles; dependency changes are human-read triggers |
| **Executable data** | A tracker or config file field that a tool executes | Data files are schema-checked data only; unknown keys are rejected; no field is ever executed |
| **Over-privileged agents** | An executor with network, secrets or write access it does not need | Least privilege per role, enforced by agent definitions and hooks (10.2) |
| **Secret leakage** | Keys in prompts, logs, commits, or the ledger | Secrets never enter any agent's context; scanners on commit; `secret` class may live only in a secret manager |
| **Classification leak** | Confidential text reaching the public repo or a third-party service | High-water-mark rule; a commit hook that blocks non-public artifacts in a public repo (10.3) |
| **Tool defaults that reach the network** | Third-party tools that fetch, report telemetry, or contact remotes by default | Executors run with network denied except an allowlist; tools are vetted before adoption |

Other machines the owner controls, and git bundles carried between them, are inside the trust boundary. Bundles are still verified (`git bundle verify`) before fetching.

## 10.2 Least privilege per role

Each role's tools, write paths, network and secrets are set in its agent definition and enforced by a `PreToolUse` hook, so a prompt cannot widen them.

| Role | Reads untrusted text | Writes | Network | Secrets | Sends externally |
|---|---|---|---|---|---|
| Orchestrator | Only as quoted summaries from quarantined agents | `main`, the private store | Allowlisted (the tracker and intake backends) | None in context; scripts read them from the environment | Only through the send gate, only approved |
| Executor | Only what its item cites, as data | Its own worktree | Denied, except an allowlist (package registry mirror if the project permits) | None in context. A declared task may receive role-scoped secrets in its child process, with output filtered ([part 13](13-operations.md)) | Never |
| Acceptance author, adversary, reviewer | No | Own worktree (tests only for the acceptance author and adversary) | Denied | None | Never |
| **Triager / normalizer** (quarantined) | **Yes** | Signal records only, through a script that validates a fixed schema | **Denied** | None | Never |
| **Reproducer** (sandboxed) | **Yes** (a bug's steps and error text) | Test directories in a scratch worktree; output checked by script before use | **Denied** | None | Never |
| Researcher | Yes (web pages) | Research notes in the private store | Web read only | None | Never |
| Liaison | Yes (the thread it drafts for) | Drafts only | Denied | None | Never; the send gate sends |
| Gardener, scribe | No | `kb/`, drafts | Denied | None | Never |

**The quarantine pattern.** The triager is the agent most exposed to injection, so it has the least power: it reads untrusted text and outputs only fields in a fixed schema (kind, area, severity, a short summary, a duplicate candidate, a route), validated by a script. A successful injection can at worst produce a wrong classification, which downstream checks (routing accuracy, human review of sensitive routes) catch. The privileged orchestrator sees the triager's structured output and its quoted summary, never raw text presented as anything but data.

**Breaking the trifecta.** The table above ensures no role holds private data, untrusted input and an outbound channel at once. The reproducer reads untrusted text and runs code, but in a sandbox with no private data and no network, and the test it writes is checked before any other agent runs it; the researcher reads untrusted pages but holds no private data and cannot send; the liaison reads a thread but cannot send; the orchestrator can (through the gate) send but does not read raw untrusted text.

**Hooks** (shipped by the plugin, [part 16](16-packaging.md)). Built now, a `PreToolUse` guard on Bash only. For an executor it denies:

- `git push`, and moving `main` (only the merge queue does that);
- any `hitld` command outside the allowlist for claiming, closing, reading and checking, so no orchestrator commands;
- decision commands (`rights answer`, `overrule`, `reverse`, `rate`, `trust`) and `eval accept`.

The command line refuses the same decision commands when `HITLD_ROLE=executor` or `HITLD_DISPATCH` is set, or when the caller runs in a linked worktree ([Q21](22-open-questions.md)). The guard reads command text, so the command line's refusal is a second line.

Still to come:

- a `PreToolUse` guard for write paths outside the role's paths, edits to dependency manifests and lockfiles unless the item cites an answered dependency decision, reads of configured secret paths, and network commands outside the allowlist;
- the commit guard (a git hook installed in each worktree): the secret scanner and the classification check on staged files;
- `SessionStart`: loads the role's contract and the policy, and refuses to start an executor outside a worktree.

**Sandboxing.** Executors run with the harness's own sandbox enabled where one exists. Any tool run on untrusted input (tests of external PRs, fuzzers) must run with no network, no secrets, and no write outside its scratch area. The mechanism is each harness adapter's job, not this design's.

**Vetting new tools.** Before a third-party tool (a tracker, a scanner, a test runner) is adopted, it is tried in a sandbox with outbound network denied and logged. Network defaults, telemetry and any executable fields are recorded in a decision item.

## 10.3 Information classification

Four levels ([part 3](03-data-model.md#classification-levels)): `public`, `internal`, `confidential`, `secret`.

### Where each artifact lives

| Artifact | Default level | Lives in |
|---|---|---|
| Product code, tests, public docs | public | Repository |
| Item files, public decisions, public precedents | public (raised per item) | Repository (files backend) |
| `policy.json`, executor contract, public knowledge base | public | Repository |
| Person and machine settings (plans, limits, hardware, local paths) | internal | Outside every repository ([part 13](13-operations.md#134-settings-in-four-layers)) |
| Signals from public sources (public issue trackers) | public | Private store by default (high volume, personal handles), with summaries on public items |
| Signals from private sources (email, private chat, direct messages) | confidential | Private store |
| Ledger, metrics, process studies, digests | internal | Private store |
| Contributor records (except relationship notes) | internal | Private store |
| Relationship notes | confidential | Private store |
| Research outputs and research briefs | confidential | Private store |
| Vulnerability reports and their fixes before disclosure | confidential | Private store and a private fork; never the public queue |
| Strategy (north star, principles, non-goals) | owner's choice; public by default for an open project | Repository or private store |
| Unreleased plans with commercial or partner sensitivity | confidential | Private store |
| Credentials, keys, tokens | secret | Secret manager only |

### Rules

1. **High-water mark.** An artifact derived from others is classified at least as high as the highest of its inputs. A summary of a confidential research note is confidential.
2. **Declassification is a decision.** Lowering an artifact's level (for example, publishing a research finding) is the owner's call, recorded as a decision.
3. **Public repositories hold public artifacts only.** The commit guard and the tracker check script block any file whose front matter is above `public`, and any file whose path is listed as private in `policy.json`.
4. **Stubs for confidential tracker entities.** When a public item needs a confidential decision, the public repository holds at most a stub (ID, title "confidential decision", state), so `needs` still resolves; the content lives in the private store. Decided: a stub ([Q6](22-open-questions.md)).
5. **Third-party services by level.** A notification channel or tracker backend declares the highest level it may carry. Above that, only a pointer is sent.
6. **Agents carry the level.** An agent given a confidential input is marked as holding confidential data for the rest of its life: its writes are classified at that level, and it may not write to the public repository. (This is enforced by the orchestrator at dispatch: briefs that cite confidential material go to agents whose write path is the private store.)

## 10.4 Human gates

Regardless of precedent, these always need a human:

- adding a dependency, or upgrading one across a major version;
- widening any role's privileges, network allowlist or write paths;
- handling a vulnerability report, and publishing a security fix or advisory;
- declassifying anything;
- changing decision rights, precedent scope or a trust level (that is autonomy, and only the owner changes it);
- accepting a real security finding as a risk instead of fixing it (10.5);
- any change to the hooks, the send gate, or this policy.

## 10.5 Security in "done when"

*Planned, before the first release (HITLD-63). The sensitive-path review and threat-model notes are HITLD-34.*

A change is not done while it adds a security finding nobody has looked at. These rules make that checkable without blocking on old findings.

**Diff-aware scanning.** The project keeps a **baseline** of known findings. A change fails only on findings it introduces: findings in the scan of the rebased branch that are not in the baseline and have no recorded verdict. The first scan of an existing codebase creates the baseline instead of blocking everything. Adding a tool, or a new version of its rules, works the same way: its first run on `main` extends the baseline. Baseline findings are worked down as items in the security loop ([2.16](02-loops.md#216-security)), by severity. A fix that merges removes its finding from the baseline. Nothing else adds to it.

**Tools are pluggable.** Scanners are declared in `policy.json` like the other merge checks ([14.2](14-integration.md#142-the-queue)): static analysis (Snyk, CodeQL or Semgrep, for example) and dependency audits. Each entry names its command and its output format; SARIF is the default, so any tool that writes it plugs in. Nothing in the core is tied to one vendor.

**Every new finding gets a triage verdict.** The verdict is recorded with the item's evidence, and is one of:

| Verdict | What it needs |
|---|---|
| **Real** | Fixed in the change, with a test that would have caught it |
| **By design** | The trust boundary named at the sink: why the input that reaches it is trusted |
| **False positive** | A one-line reason |

A verdict is keyed by the tool, the rule and a fingerprint of the code at that place. The next scan does not ask again about a recorded verdict at the same place. If the code there changes, the fingerprint changes, and the finding is new again.

**Accepting a real risk is the owner's decision.** It is recorded as a decision with an expiry, like quarantine in [14.7](14-integration.md#quarantine). At expiry it becomes a decision again: fix it now, or accept it for another period. Nobody marks a real finding "won't fix" silently. An executor can propose any verdict in its report, but it cannot record an accepted risk, and the guards deny it the baseline and the verdict records.

**Sensitive paths get an independent security review.** The project's sensitive-path list (`security.sensitive_paths` in `policy.json`: authentication, secrets handling, policy and settings loading, sandboxing, dependency manifests, CI configuration and the like) is the same list that triggers a human read ([6.6](06-verification.md#66-when-a-human-reads-the-code)). An item whose change touches it gets a security review by a different agent from its executor, framed against the change, as in the adversarial loop ([6.3](06-verification.md#the-adversarial-loop)). The reviewer also checks any by-design or false-positive verdict on those paths.

**Design-level items get a threat-model note.** An item that adds a trust boundary, an input path or a privilege carries a short note in its plan: what it protects, where untrusted input enters, the threats (STRIDE as a checklist) and the mitigation for each, each mitigation a test or a follow-up item.

**Every finding caught becomes a test.** A real finding becomes a regression test; a finding about agent behaviour, such as an injection that worked, becomes an eval scenario ([part 17](17-evals.md)). The floor rises with each one, as with adversarial breaks.

**Classification.** A real finding not yet fixed is a vulnerability, so the baseline, the verdicts and accepted risks live in the private store, at `confidential` for real findings ([10.3](#103-information-classification)). A public item records only that its scans passed.

### A triage record

The table an item's evidence carries, one row per new finding:

| Finding | Class | Verdict | Change |
|---|---|---|---|
| Tool, rule, path and line | The weakness, such as path traversal or command injection | Real, by design, or false positive | The fix and its test; or the trust boundary named at the sink; or the one-line reason |
