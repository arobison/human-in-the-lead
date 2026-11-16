---
id: HITLD-179
title: "Git identity and sign-off: where the owner's sign-off lives, what identity agents commit with, and what self-hosting changes"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-135]
---

## Why

Two kinds of commits need an identity, and nothing says where it comes from. The person file has no git identity key, so each container uses whatever git config it happens to have, and a cloud container has none. In the first self-hosted run a GitHub runner with no identity broke the merge queue's own `git merge` in a test (HITLD-133), and agent sessions have passed an identity on each command by hand. The DCO check accepts a pull request's agent commits (an `Agent-Role` or `Dispatch` trailer) without a sign-off, and requires a person's `Signed-off-by` on every commit pushed to main, so the approver signs the squash commit. `release make` signs with whichever git identity runs it. The owner has delegated merging tracker-only pull requests without asking, with their sign-off marked as delegated (HITLD-158, HITLD-159, HITLD-150). When HITLd runs its own development, the tool, the project and the maintainer are one, and some design rules that assume they differ need a stated special case. This item records the choices and brings them to the owner.

## Done when

- The owner decides, in a design walk-through (HITLD-135), one question at a time, and the answers are recorded as decisions before anything is built:
  - Where the owner's sign-off identity (a name and an email) lives: the person file, synced through the store (HITLD-162), the project's `policy.json`, or git's own config in each container. A public file may hold only the owner's public GitHub noreply address, never a personal one.
  - Which address it is, and how the personal address stays out of public history (the private term list and the commit guard).
  - What identity agent commits use: one fixed agent identity shipped with the plugin, so no container needs git config, or a per-machine setting.
  - What the merge queue, `release make`, `hitld work publish` and the claim and close commands use for author and sign-off.
  - What self-hosting changes: which design rules need a stated special case (the analysis is in the section below, and each point needs the owner's decision).
- The design (the DCO section, part 14, the person file in part 13 and the packaging part) says the chosen answer in one change the owner approves, and the schema, the plugin and the checks follow in build items.
- A test shows a container with no git config still commits and merges as the chosen agent identity, and that a sign-off made under the standing rule carries the delegated marker.

## Analysis the owner asked for

On 2026-11-16 an Opus agent at high effort analyzed this item at the owner's request. Its report is model output: each claim is tagged by what it rests on, and none of it is a decision. The chief of staff checked some claims against the repository and marks them verified.

**Sign-off and identity**
- Keep two identities apart. A fixed agent identity from the plugin, set through `GIT_AUTHOR_*` and `GIT_COMMITTER_*` on every `hitld` git call as the store's git calls already do, with an address on a reserved domain, added to the set of agent addresses in `core/lib/dco/check.mjs` so it never counts as a person's sign-off on main (that set holds one address today: verified). And the owner's sign-off pair, a name and the forge noreply address, as a new optional `signoff` key in the person file, read by the pull-request merge, delegated merges and `release make`.
- The DCO check enforces the delegation: a main commit carrying the delegation trailer (HITLD-159) may change only paths the cited decision allows, and otherwise fails.
- Alternatives that lose: git config in each container (it is what broke, and every container needs setup), and the pair in `policy.json` (public and the project's, while a sign-off is personal).
- Files that would change: `schemas/person.schema.json`, part 13.4, part 9.6, Q20, 16.5 Release mechanics, the Sign-off section of `CONTRIBUTING.md`, `core/lib/dco/check.mjs`, `buildCommit` in `core/lib/tracker/files/publish.mjs` (it runs `commit-tree` with no identity set, so it fails in a bare container: inferred, not run), `core/lib/release/make.mjs`, `core/lib/merge/queue.mjs`.
- Risk: the DCO is a personal certification, so a delegated sign-off certifies in advance. If the owner holds that each sign-off must be given when the change is made, HITLD-159's third option wins.
- Two gaps in the delegation as decided (HITLD-158 and HITLD-159): `work/releases/` is under `work/` (verified), and merging a release record is the release decision, so it should stay in `owner_paths`. And a pull request that touches only `work/` can write `answered_by: owner` into a decision item (the decision's answer is stored in the item: verified), while protected-core merges trust answered decisions (design 18.3, not checked): a delegated merge should check each changed answer against what `rights answer` recorded, or answers should be signed (HITLD-36, planned).

**The send gate**
- Design 10.2 says the orchestrator sends externally only through the send gate, only approved, and today's practice does not (the report's reading; the design text was not rechecked). `hitld work publish` prints the pull request for the session to open, outside any gate.
- Recommendation: gate it, because the repository is public, under a new routine class, "pull request on the project's own repository", that only an owner decision turns on. The gate runs `publish check`, requires the target to be the project's own origin, refuses executors, and, until `hitld` can call the forge from a cloud session, returns the approved text and its hash for the session to post exactly, with the pull-request merge refusing text that does not match the hash.
- Alternatives that lose: owner approval of each post (it spends the attention HITLD-158 set out to save), and declaring own-repository pull requests not outward (the threat model names pull requests as a place private names leak).
- Risk: the policy could become a rubber stamp. It must never cover replies to outsiders, which stay sensitive.
- Files that would change: design 9.3 and 10.2, 10.3 Limits, `core/lib/sendgate/gate.mjs`, `core/lib/cli/commands/work-publish.mjs`, a new section in `schemas/policy/`, and the Publishing steps of both skills. The gate is protected core, so the change is the owner's decision.

**Other rules that need a stated special case under self-hosting**
- `CONTRIBUTING.md` says "Agents open no pull request to main; the owner opens it or merges the branch" (line 41), and its release steps say the orchestrator opens a pull request (verified). Restate it.
- Which release runs the system: the pinned release runs orchestration, and this repository's latest code runs only in worktrees and CI. A tracker format change must also migrate `work/`, because the pinned release refuses data newer than it knows.
- The protected core on the pull-request path: the `Owner-Decision` trailer is enforced by the local queue, and HITLD-133 and HITLD-150 do not mention it (inferred). Delegated merges must never touch protected paths.
- Private names: the maintainer's other projects are consuming projects, so their names belong on the term list. If the term list cannot be read in a cloud container, publishing should refuse, not pass (a guess, the path was not read).
- The release reviewer: self-review in the `release` environment is already a stated special case; link it to HITLD-140. Feedback and the owner's own issues need no exception.

## Notes

Raised by the owner in the chief of staff session, who asked to file it as a design change proposal. The first recommendation to the owner was: the owner's sign-off pair in the person file, with the GitHub noreply address, and a fixed agent identity from the plugin. It is a recommendation, not a decision. It changes the person file schema and the plugin, so it needs the owner's walk-through first. Related: HITLD-148 (person settings in the store), HITLD-150, HITLD-133 (the merge queue).

