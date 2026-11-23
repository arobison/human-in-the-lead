---
id: HITLD-922
title: Release package version sources live in the ecosystem profile (JSON, TOML, properties, git tags), and a migration moves the existing declarations
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-898, HITLD-899, HITLD-920]
constraint_of: [HITLD-402 c?]
---

## Why

`release propose` reads the version only from a root `package.json` (`sourceVersion` in `core/lib/release/propose.mjs`), and `release migrate` and `install` default the source to `package.json`. The owner decided version sources move into the ecosystem profile (HITLD-912) and rc.2 reads JSON, TOML and properties files with git tags as the fallback (HITLD-913).

## Done when

- A profile's version source is a file, a format (`json`, `toml`, `properties`) and a key path, or `git-tag`; the parsers are built in and small, with no new dependency.
- `release propose`, `release make`, `release migrate` and `install` take the version from the matching package path's profile.
- A migration moves existing release-package version declarations into profiles without changing any version or tag, is a dry run by default and is safe to run twice.
- A test per format (Cargo.toml, pyproject.toml, gradle.properties, package.json) and one for the migration.
- A release-path change reaches main only with the owner's own yes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Decided in the build-systems walk-through of 2026-11-22: HITLD-886, 910 to 919 (the design item is HITLD-883, GitHub issue 553). Needs the release-package fixes (HITLD-898, 899) first, so the migration lands on a sound release path, and the schema (HITLD-920).

Moved from rc.2 to rc.3 by the owner's cut-line decision HITLD-971 (2026-11-23).
