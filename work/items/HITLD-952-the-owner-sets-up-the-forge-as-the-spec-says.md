---
id: HITLD-952
title: "The owner sets up the forge as the spec says: GitHub Apps per role, rulesets for main, branches and tags, the release environment, and records the baseline"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
---

## Why

Two security reviews concluded that hook guards cannot stop a hostile executor and the forge must enforce the boundaries (HITLD-867, 888). The settings are the owner's to apply. The owner decided: one GitHub App per role (HITLD-944), executors push to this repository on `hitld/*` branches with a fork as the later hardening (HITLD-945), approvals stay recorded by the chief of staff so no code-owner review is required (HITLD-946), no owner bypass on main (HITLD-947), the by-hand tag path removed (HITLD-948), a release App whose key lives only in the release environment (HITLD-949), signed commits on main if a one-time test passes (HITLD-950), and local executors in a separate OS user or sandbox (HITLD-951).

## Done when

The owner does these in order, each recorded here as done with its date; the way back for every step is to set the ruleset to Disabled or re-apply the saved value.
1. Baseline: create a read-only fine-grained token (Administration, Actions, Contents, Metadata read; 90-day expiry) and save the output of the rulesets, environments, Actions permissions, workflow permissions, deploy keys and collaborators calls.
2. Actions settings: allow GitHub-created actions plus the pinned scorecard action; require full-SHA pinning; default workflow permissions read-only; Actions may not create or approve pull requests.
3. General: squash merging only, auto-merge off, delete head branches on.
4. No repository secrets, no deploy keys, no collaborators; review every installed app with write access, including the one behind the cloud connector.
5. Create three GitHub Apps on the owner's account, webhook off, installed on this repository only: `hitld-queue` (Contents, Pull requests write; Checks, Statuses, Metadata read), `hitld-executor` (Contents and Pull requests write, Metadata read; no Workflows, Administration, Actions, Checks or Statuses), `hitld-release` (Contents write, Metadata read; its key a secret of the `release` environment only).
6. Move the merge queue to `hitld-queue` and prove one merge before any ruleset is active.
7. Ruleset A on `main`, empty bypass: restrict deletions, block force pushes, require linear history, require signed commits (dropped if the queue's squash merge is refused), require a pull request with squash, require the named status checks from GitHub Actions (check, typecheck, format, tests, evals, tracker, dco, public, Analyze (actions), Analyze (javascript-typescript)), up to date. No code-owner review (HITLD-946).
8. Ruleset B on `main`: restrict updates, bypass `hitld-queue` only.
9. Ruleset C on all branches except `hitld/**`, `dependabot/**` and `main`: restrict creations, updates and deletions, block force pushes. Ruleset D on `hitld/**`: block force pushes, no bypass.
10. Tag ruleset on `v*`: restrict creations, updates and deletions, block force pushes; bypass `hitld-release` only. Do this after the release workflow change (HITLD-888) has merged.
11. `release` environment: required reviewer is the owner, admin bypass off, branch `main` only.
12. Issue executor credentials from `hitld-executor` and run the proof: a push to main, a tag push, a pull request merge and a workflow change are each refused with an executor credential, and a push to its own `hitld/` branch is accepted; the results are recorded here and in HITLD-867 and 888.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable forge-enforcement spec (2026-11-22) and the owner's walk-through decisions HITLD-944 to 951. Several settings are guesses about GitHub behavior on a user-owned repository (push rulesets by path, the bypass picker listing an App, an App's merge counting as an update, signed squash merges): each is confirmed in the UI at its step and the item records which held. The owner-side item; code is HITLD-953 to 956.
