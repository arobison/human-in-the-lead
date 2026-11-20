# 8. The knowledge base

[Back to the index](../0001-human-in-the-lead.md)

## 8.1 Why it exists

Every fresh agent pays to learn the codebase. With many agents working at once, that **onboarding cost** recurs on every dispatch. The knowledge base exists to cut it: an executor that can read one short, current note instead of exploring twenty files starts editing sooner and makes fewer wrong assumptions.

So the knowledge base is measured like a cost lever ([8.6](#86-measures)): **onboarding tokens before the first edit** is its primary measure, and **knowledge that existed but was not found** is its main failure signal.

## 8.2 Markdown in git is the source of truth

The knowledge base is a set of small markdown files in git. That does not change as it grows. Any search index is a derived cache that can be deleted and rebuilt ([8.5](#retrieval)).

The reasoning:

- **At scale, the failure is curation, not search speed.** A large knowledge base goes wrong through duplicates, stale notes, contradictions between notes, and notes nobody knows exist. A vector index does not fix any of those; it can hide them, by returning a plausible stale note with confidence.
- **Coding agents retrieve by agentic search.** Several current coding agents find what they need by listing, grepping and reading files, iterating as they learn, rather than by querying a vector index. Anthropic's published guidance on context engineering describes this "just in time" retrieval with lightweight identifiers (paths, queries) that the agent follows as needed, and the Claude Code team and Cline have said publicly that they chose agentic search over embedding indexes for code. Sources are listed after this list.
- **Files fit everything else.** They are versioned with the code, reviewable in the same change, readable on a phone, portable across harnesses, and need no infrastructure, which keeps the plugin open-source friendly.

**Sources for agentic search** (links and dates as cited; check each before relying on it): Anthropic Engineering, "Effective context engineering for AI agents" (2025), <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>; the Latent Space podcast with Cat Wu and Boris Cherny, "Claude Code: Anthropic's Agent in Your Terminal" (an episode page, not a benchmark), <https://www.latent.space/p/claude-code>, where the evidence described is internal impressions; the Cline blog post on why Cline does not index a codebase (2025), <https://cline.bot/blog/why-cline-doesnt-index-your-codebase-and-why-thats-a-good-thing>. A counterpoint: the Cursor blog post on semantic search for agents (2025), <https://cursor.com/blog/semsearch>, reports that adding semantic search to grep improved answers, in the vendor's own tests; this is why the hybrid retriever exists as an option.

## 8.3 Structure

Public notes live in the repository under `kb/`. Confidential notes live in the private store under the same structure, with the same tools.

```
kb/
  index.md            # read first: one line per note, grouped by area
  glossary.md         # project terms and their synonyms
  strategy.md         # north star, principles, non-goals, portfolio categories (owner-written)
  architecture.md     # the map: modules, what each is for, how data flows, owners
  areas/<area>/       # small notes per area: key files, invariants, oracles, pitfalls
  conventions/        # decisions tools do not enforce: naming, test layout, style
  playbooks/          # how to do a recurring task: add a backend, add a benchmark, cut a release
  decisions.md        # generated index of answered decisions and active precedents
```

### The index, read first

`kb/index.md` has one line per note, grouped by area: the path and the note's one-line summary. It is generated from the notes' front matter, never edited by hand.

- **One index per store.** The public store has a public index and the private store has a private one. A brief merges them only for agents cleared to that level. The public index never lists a confidential note.
- **Briefs point at notes, not at the index.** The orchestrator picks notes for a brief by the item's `area` and `touches` using the index ([8.4](#84-how-briefs-use-it)), so most executors read two or three specific notes and never search.
- **The index has a token budget** (`kb.index_tokens_max`). An executor that needs to search reads the index first, so its size is a cost on every such search. When it exceeds the budget, it splits by area: a top-level index of areas, and one index per area.

### Small, linked notes

- **One topic per note**, within a size budget (`kb.note_tokens_max`). An executor reads a note whole, so length is cost.
- **Pointers, not copies.** A note points to the authoritative source (a file, a function, a design section, a decision) instead of restating it. Restated facts drift.
- **Links between notes** are relative markdown links, checked by the tool.
- **Decisions are not duplicated.** `decisions.md` is generated from decision items and precedents. The knowledge base explains; the tracker records.
- **Strategy is the owner's.** `strategy.md` is written by the owner, or drafted by an agent and approved as a decision.

### Front matter

```yaml
---
summary: How the HTTP client caches responses and when entries are invalidated.
areas: [http]
tags: [cache, invalidation]
owner: C-1                       # human accountable for its accuracy
checked: 2026-11-14              # date last verified, for people
checked_at: 3f9c2a1              # merged commit it was verified against, for scripts
sources: ["src/http/cache/**", "docs/design/0012-response-cache.md"]
links: [../conventions/caching.md]
supersedes: [areas/http/old-cache.md]
classification: public
---
```

`supersedes` lets a replacement note retire an old one explicitly: the tool flags any remaining links to a superseded note, and the index omits it.

### The glossary handles vocabulary mismatch

The commonest reason an agent fails to find a note is that it searched for a different word than the note uses. `glossary.md` lists each project term with its synonyms and near-synonyms (the words a newcomer, a user or another codebase would use) and links the notes that define it. The `kb search` tool expands queries through the glossary, and executors are told to read it before searching.

## 8.4 How briefs use it

- The orchestrator picks notes for a brief by the item's `area` and `touches`: the area's notes whose `sources` overlap the item's `touches`, any playbook tagged for the item's kind of task, and pitfalls tagged for those paths. This is a script lookup over the front matter, so it costs the orchestrator almost nothing.
- Briefs cite notes by path and anchor so executors read only what matters.
- **Stale notes are marked in briefs** ("stale since 3f9c2a1; verify against sources"), so the executor treats them as leads, not facts.
- **Misses feed back.** An executor's report may include a `kb_miss:` line under deviations: a fact it had to discover, and whether a note already held it ("existed but not found") or not ("missing"). The learning loop counts both per area. The `kb_miss:` line is not in the report format yet.

## 8.5 The `kb` tool

Part of the `hitld` command line ([part 15](15-architecture.md)). `search`, `index`, `stale`, `links` and `check` are in "One signal end to end" (not yet built); `orphans` and `reindex` come later ([part 21](21-scope.md)):

| Command | Does |
|---|---|
| `hitld kb search <terms> [--area a] [--tag t]` | Searches through the configured retriever, with glossary expansion |
| `hitld kb index` | Regenerates `index.md` and `decisions.md` |
| `hitld kb stale` | Notes whose `sources` changed since `checked_at`, ordered by how often briefs cited them |
| `hitld kb reindex` | Rebuilds the hybrid retriever's derived index from the markdown (only when `kb.retriever` is `hybrid`) |
| `hitld kb orphans` | Notes no brief, index entry or other note links to |
| `hitld kb links` | Broken links, and links to superseded notes |
| `hitld kb check` | All of the above plus front-matter schema and size budgets; runs at merge, in either merge mode |

**`checked_at` is stamped at merge** with the merged commit, not the executor branch's commit. A hash that is not reachable counts as stale.

**Freshness is computed, not guessed.** A note is stale when any file matching its `sources` has changed since `checked_at` (`git diff --quiet <checked_at> HEAD -- <sources>`). The `checked` date is for people. A note with no `sources` falls back to an age limit (`kb.max_age_unsourced`).

**Curation.** After each merge batch, a curator dispatch (its model and effort from the cascade, [5.1](05-execution.md#51-execution-profiles)) re-verifies the most-cited stale notes against their sources, updates them, and resets `checked` and `checked_at`. Its edits go through items and the merge like any other change; it makes no automatic edits outside that path. A note whose meaning changed is flagged to its owner. Notes uncited for `kb.prune_after_dispatches` dispatches are proposed for removal. The same curator reads the work items after merge batches ([13.3](13-operations.md#the-stale-item-sweep-and-the-curators-pass)). This upkeep is the first of the curator's three jobs; applying changes the owner has decided (design and docs updates among them) and plan audits are the other two, decided and not yet built (HITLD-587, HITLD-583, [13.3](13-operations.md#the-stale-item-sweep-and-the-curators-pass)).

**Contradiction pass.** Periodically (`kb.contradiction_every` merge batches), an agent reads notes that share an area or tag and flags pairs that contradict each other, or contradict their sources. Each flag becomes an item for the note owner: merge, supersede, or correct.

### Retrieval

Retrieval is **pluggable**, selected in `policy.json` (`kb.retriever`):

| Retriever | What it is | Infrastructure |
|---|---|---|
| **`grep+index`** (default) | Glossary-expanded grep over notes and front matter, ranked by area match, tag match and citation count; the index read first | None |
| **`hybrid`** (optional) | Keyword ranking (BM25) plus embeddings, fused by reciprocal rank fusion, over the same notes | A local, derived index file (for example SQLite with full-text search and a vector column), rebuilt from the markdown at any time by `hitld kb reindex` |

Rules for the hybrid index:

- **It is a cache, never the source of truth.** It lives outside the tracked tree (in the private store or a cache directory), can be deleted at any time, and is rebuilt from markdown.
- **Classification applies to embeddings.** Embedding a note sends its text to whatever computes the embedding. Notes above `public` are embedded only by a local model or a service cleared for their level ([part 10](10-security.md#103-information-classification)).
- **The same retriever interface serves intake deduplication** ([part 2](02-loops.md#22-triage)), which compares stranger-written signals with each other and with existing items.

**When to add the hybrid index.** It is added for a project when measurements say so, not by default:

1. **Intake deduplication**, likely first. Duplicate bug reports are written by different strangers in different words, which is where keyword search is weakest. When the triage loop's missed-duplicate rate (duplicates found later that triage did not link) exceeds `triage.missed_duplicate_max`, the hybrid retriever is enabled for signals.
2. **"Existed but not found" keeps recurring** in a given area despite the index and glossary being current (`kb.not_found_max` per period).
3. **The index exceeds its token budget** in briefs even after splitting by area.

Enabling it is a policy change inside bounds the owner sets, so the decision is recorded and its effect on the measures below is tested as a process study.

## 8.6 Measures

| Measure | Definition |
|---|---|
| **Onboarding tokens** | Tokens an executor consumed before its first edit ([part 11](11-metrics-and-control.md#111-measures)), by area |
| **Existed but not found** | `kb_miss` reports where a note already held the fact, per area, collected in retros |
| **Missing knowledge** | `kb_miss` reports where no note held the fact |
| **Index size** | `index.md` (and per-area indexes) in tokens, against the budget |
| **Staleness** | Stale notes, weighted by citation count |
| **Contradictions open** | Flags from the contradiction pass not yet resolved |

Goodhart pair: onboarding tokens must not fall at the expense of first-pass yield (a brief that skips needed context fails later).

## 8.7 Where existing project material fits

A project often already has documentation and design documents. Adoption does not move them: existing pages become knowledge-base notes by adding front matter as they are next touched, and the generated index lists them where they are. The curator's loop starts with the pages briefs cite most.
