---
id: HITLD-982
title: Each GitHub release carries an `npm pack` tarball, and the install docs show the tarball URL first so a consumer's lockfile records an integrity hash
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-64 c?]
---

## Done when

- The release workflow attaches the `npm pack` tarball of the version to the GitHub release; a test or a dry run of the workflow shows the asset name.
- `hitld install` and the setup guide show the tarball URL form first and say why: npm records an `integrity` hash for it, and records none for a git dependency.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

A consumer that installs hitld from a git tag gets a lockfile entry with no integrity hash, which supply-chain policies often refuse. It serves consumers with such policies, and the release pipeline that stages their packages.

## Notes

GitHub issue 575. rc.3, with HITLD-893 (the release job builds without install scripts and attests the artifact). A registry package with trusted publishing and provenance comes later. Release path: needs the owner's yes before merge.
