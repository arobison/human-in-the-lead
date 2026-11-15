---
id: HITLD-140
title: "The Release workflow refuses to run when the release environment has no required reviewer"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

The owner's approval in the `release` environment is meant to gate every release made through a release pull request (design 16.5). For v0.1.0-rc.1 the reviewer rule had been set on an environment with a similar name, and GitHub created `release` with no rules when the workflow first used it, so it had no required reviewer, so the `release` job tagged, built, attested and drafted with no approval, and nothing reported it. The workflow trusted a repository setting that nothing checked. Publishing the draft stayed the owner's step, so no release went out unseen, but the tag was pushed without the owner's approval.

## Done when

- The `record` job reads the `release` environment's protection rules through the GitHub API before the `release` job starts, and fails the run when the environment is missing or has no required reviewer, with a message that says how to add one (Settings, Environments, `release`, Required reviewers).
- The check runs in a script with a test for a protected environment, one with no reviewer, a missing environment and an API error (which also fails closed).
- `CONTRIBUTING.md` (Releases) and design part 16.5 say the run refuses without a required reviewer.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

A need of v0.1.0-rc.2 (HITLD-137), the owner's decision from the main session. If the workflow token cannot read the environment's protection rules, the item records that and the check uses the narrowest token that can, never a stored long-lived one without the owner's decision.
