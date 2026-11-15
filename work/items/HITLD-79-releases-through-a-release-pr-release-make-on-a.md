---
id: HITLD-79
title: "Releases through a release PR: release make on a branch, tag and release in CI behind the owner's approval"
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-79
release_note: `hitld release make --branch <name>` writes the release record on a release branch for a release pull request; merging it is the release, and the release workflow tags, attests and drafts it after the owner approves the run.
---

## Why

The owner works from cloud sessions and a phone: no terminal, and the session cannot push to main or push tags. Releases by hand are error-prone. The established pattern is a release pull request (release-please, Changesets): merging it is the release, and the same CI run tags that commit and creates the release. HITLd keeps its own release decision (the interface delta and release record, design 3.2 and 16.5) and adopts that pattern for the mechanics.

## Done when

- `hitld release make --branch <name>` writes the release record on a release branch made from main, with the same owner's-turn guard and the same checks as today, and never tags; the orchestrator pushes the branch and opens a release pull request showing the version, bump, notes and interface delta.
- Merging the release pull request is the release decision: the squash commit on main carries the record and the owner's sign-off (HITLD-59).
- One workflow run on a push to main that adds `work/releases/<tag>.md` creates the annotated tag on that exact commit, builds, attests provenance and drafts the GitHub release (a pre-release for a tag with a pre-release part). Tagging and releasing happen in the same run, so nothing depends on a tag push made with the Actions token triggering another workflow, and no long-lived token is stored.
- The tagging and release job runs in a `release` environment that requires the owner's approval, so nothing is tagged until the owner approves in GitHub.
- The workflow refuses a record whose version or tag already exists, whose tag is not the next one `release propose` would give, or that did not arrive through a pull request; a test covers the record-to-tag checks in Node, not only in YAML.
- The repository settings the owner applies are written down step by step: a ruleset so only the release workflow can create, move or delete `v*` tags; immutable releases; the `release` environment with the owner as required reviewer and self-review allowed.
- Design 16.5 and part 22 record the decision; `release make` on main keeps working for a person at a terminal.

## Notes

Sources: release-please's release pull request pattern; GitHub's supply-chain guidance (immutable releases, tag rulesets, environments with required reviewers, artifact attestations); the rule that events made with the Actions token do not start other workflows.

