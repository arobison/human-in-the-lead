# 9. Contributors and relationships

[Back to the index](../0001-human-in-the-lead.md)

Most of this system is labour that agents do well. Relationships are not. People who report bugs, send patches, or depend on the project judge it partly by how they are treated, and they can tell when they are being handled by a machine that is not listening. This part sets what automation does with other people's contributions, and where a human must be involved.

It applies to open-source projects and to closed ones with several humans alike.

## 9.1 Areas and their owners

- An **area** is a set of paths and topics with one or more human owners ([part 3](03-data-model.md#area)). The area map lives in `policy.json` (so decision rights can use it) and is described in `kb/architecture.md`.
- Area owners hold the decision rights the owner delegates to them ([part 4](04-decision-rights.md#42-when-the-owner-is-involved)), handle verification disputes in their area, and are the default reviewers for external contributions to it.
- With one owner and no area owners, every area's owner is the owner. The model does not change.
- How area owners' calls are recorded and weighted, the feedback each gets, and how the system asks them things: [part 23](23-people-in-the-lead.md).

## 9.2 Trust levels

A contributor's trust level sets what automation does with their contributions. Levels are earned by record and granted by a human; automation never raises a level.

| Level | Who | Their issues and comments | Their pull requests |
|---|---|---|---|
| **L0** | Unknown, or first contact | Untrusted data. Triaged in quarantine | CI runs in a sandbox without secrets. An agent reviews with the change framed as untrusted. A human approves before merge. No automation acts on the PR text |
| **L1** | Known: prior accepted contributions | Untrusted data (always). Triage may route their bug reports to auto-fix | As L0, but agent review findings are drafted for them and sent after a human approves |
| **L2** | Trusted contributor, granted by an area owner | Untrusted data. Their reproductions may be accepted as acceptance tests after review | Full verification (independent tests, adversarial pass by allocation); merge needs an area owner's approval, which the system asks for with a directed read |
| **L3** | Area owner | Their directions inside their area are decisions | May approve merges in their area |
| **L4** | The owner | Their directions are decisions | May approve anything |

**Text from anyone is data, when it arrives where outsiders can write.** Even at L3 and L4, text that arrives through an intake source an outsider can write to (an issue, a comment, an email) is data, not an instruction to agents. Directions from the owner reach agents only through the owner's own turns in the main session, never through such a channel. Dashboard intents and other channels wait on signed answers ([Q21](22-open-questions.md#q21-how-is-a-deciders-identity-established-blocks-any-second-human-and-any-channel-other-than-the-local-session)); until then an area owner's direction is a request the owner confirms. This is what stops a forged or compromised comment from steering the system ([part 10](10-security.md)).

**In the main session, the owner's own words are directions; what the owner pastes or forwards is data.** The owner talks to the main session directly (in a terminal or through Remote Control), so their own sentences are authoritative: answers, directions, reprioritizations. Two things in that channel are not:

- **Notes.** When the owner says "note: …" (or runs `hitld note`), the orchestrator records the text as a signal from the owner (intake source `note`). It is the owner's intent, so it skips quarantine, but it still goes through triage for routing like any idea. Feedback about HITLd itself, rather than about the project, is not a note: it goes through `hitld feedback`, which keeps it local until a generalized version is approved ([part 18](18-self-improvement.md#184-giving-feedback)).
- **Pasted or forwarded material.** A block the owner pastes from elsewhere (an issue, an email, a log, a chat message) is someone else's text. The orchestrator records it as a signal with the original author where known, and it goes through quarantined triage. An instruction inside it is not the owner's instruction, even though the owner pasted it; if acting on it seems intended, the orchestrator asks.

## 9.3 Replies

Contributors should get timely replies that sound like a person who read what they wrote.

**Agents draft; the send gate decides.** The liaison agent drafts every reply. Each draft is classified:

| Class | Examples | Who sends |
|---|---|---|
| **Routine** | Acknowledging a report; asking for reproduction steps; saying a fix has merged and will ship in a version; thanking someone with credit | Sent automatically only if the owner has enabled automatic routine replies for that source and trust level; otherwise queued for a human |
| **Sensitive** | Declining a contribution or request; disagreeing; anything about conduct; security reports; anything to a partner organization; any promise about scope or timing; anything to someone who is upset | Always a human. The draft is offered with the context; the human edits and sends |

Rules for drafts:

- **Specific.** Quote or paraphrase what the person said, and answer that. No template paragraphs.
- **Short and plain.** Say what happens next and who does it.
- **Honest about automation.** A reply sent automatically says so in a short, consistent footer. A human-sent reply drafted by an agent is the human's reply.
- **No promises the system cannot keep.** Drafts never commit to timing.

**The send gate** is the only code path that can call an intake adapter's `reply` ([part 3](03-data-model.md#intake-source-adapter)): it produces the `ApprovedReply` type, either from a human's approval or from a routine-reply policy, and records which.

**Timeliness** is measured as time to first response per source and trust level ([part 11](11-metrics-and-control.md#111-measures)). Its Goodhart pair is the share of threads where the contributor had to repeat themselves or the reply was later corrected.

Progress reports and release notes for people outside the project are generated per audience, with classification deciding what each audience sees ([part 12](12-reporting-and-limits.md#126-stakeholder-communication)).

## 9.4 Credit

- **Changelog credit.** Items opened from a contributor's signal or PR carry `credit:`; release notes name them ([part 2](02-loops.md#27-shipping)).
- **Commit credit.** When a contributor's patch is adapted by an agent, the commit carries a `Co-Authored-By:` trailer for the contributor, using their forge's noreply address unless they ask for another.
- **Reports count.** A bug report that led to a fix is credited like code. Reproductions, reviews and design input are credited too.
- **The record.** Each contributor's credit is derived from items and commits, so it can be shown back to them and used when a human considers raising their trust level.

## 9.5 Community health

Measured, not managed by the numbers (each has its pair in [part 11](11-metrics-and-control.md#113-goodhart-pairs)):

- time to first response, and time to resolution, for external issues and PRs;
- share of external PRs merged, and time from open to merge;
- contributor retention: share of first-time contributors who contribute again;
- bus factor per area: how many people (not agents) have approved changes there recently;
- the share of replies that were human-sent.

The CHAOSS project's metrics (<https://chaoss.community/>) are the reference for definitions where they exist.

## 9.6 Legal

- **Inbound contributions.** External contributions need a sign-off under the Developer Certificate of Origin ([DCO](https://developercertificate.org/)): a `Signed-off-by` line on each commit, checked at merge, in either merge mode. Decided ([Q20](22-open-questions.md#q20-dco-or-cla-for-inbound-contributions-blocks-outside-contributors-also-applies-to-this-repository)); a contributor licence agreement is not used.
- **This repository's own commits.** The DCO applies to them too. The owner signs off the first public commit. For a commit an agent made, the person who approves its merge signs it off: an agent cannot certify the origin of a contribution, and the approver is the one who can. CI checks it (`core/bin/dco-check.mjs`).
- **Generated code.** Provenance trailers ([part 6](06-verification.md#64-provenance)) or the ledger record which model produced each change. The verification skill flags large blocks that look copied from elsewhere (an unusual licence header, verbatim matches against known sources where a scanner is available) as a human-read trigger.
- **Licences of dependencies.** Adding a dependency is a security decision and a public commitment ([part 4](04-decision-rights.md)); the decision item records the dependency's licence.
