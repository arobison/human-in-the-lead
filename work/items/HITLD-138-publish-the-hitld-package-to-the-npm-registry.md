---
id: HITLD-138
title: "Publish the hitld package to the npm registry, from the release workflow"
kind: work
state: proposed
created: 2026-11-15
project: HITLD-15
needs: [HITLD-24]
---

## Why

HITLd ships today from git only: the plugin from this repository as its own Claude Code marketplace, pinned to a release tag, and the `hitld` command as a dev dependency installed from the git URL at that tag (HITLD-25). That needs no registry. A registry package would let a harness other than Claude Code, or a project that does not use the plugin, install `hitld` and its MCP server by name and version range, as design part 16 lists for "any harness with a shell". The owner chose git for now and the registry when such a consumer needs it.

## Done when

- `package.json` is no longer `private`, under a package name the owner chose, and its `files` list ships only the command, the core library, the schemas and the templates.
- The release workflow publishes the package to the npm registry after the owner approves the `release` environment, with npm trusted publishing (no stored token) and provenance, for the same version and tag as the release.
- A pre-release is published under a `next` dist-tag, and only a full release moves `latest`.
- Design part 16 and the install guide describe installing from the registry beside the git install, and the release notes say how.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Not a need of v0.1.0. Start it when a consumer needs `hitld` without the Claude Code plugin. A published version cannot be withdrawn after a short window, so the first publish waits for a full release, not a candidate.
