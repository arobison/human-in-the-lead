---
id: HITLD-920
title: The ecosystem schema and built-in profiles are data in policy.json, validated by work check, with explicit per-path mapping
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
release_note: "policy.json has an `ecosystems` section: `ecosystems.use` maps a profile to path globs (most specific wins) and holds the only install, build, test and publish commands, as owner configuration that this release validates and does not run; `ecosystems.profiles` adds the project's own profiles, which may extend a built-in one. Twelve built-in profiles (npm, pnpm, yarn, cargo, go, pip, uv, poetry, maven, gradle, bundler, composer) ship as data with no commands. `hitld work check` refuses an unknown profile, a version-source file that is not a repository path, a skip folder with a separator or `..`, a cache variable that is not on the cache allowlist (a known cache variable, or a name ending in _CACHE, _CACHE_DIR or _CACHE_FOLDER that names no credential, setting or switch and that the loader or git does not read), and a `use` glob that can never match or, without a wildcard, names no regular file in the checkout (write `web/**`, not `web`)."
claimed_by: D-01M85QAXBKVVZH09
---

## Why

Today HITLd's build-system knowledge is scattered: some commands are general, others assume npm. The owner decided ecosystems are described as data profiles (manifests, lockfiles, version sources, folders to skip, cache descriptions) with commands only in the project's own policy (HITLD-886), the settings live in a section of `policy.json` (HITLD-910), and mapping to paths is explicit (HITLD-911).

## Done when

- A schema for an `ecosystems` section of `policy.json`: the profiles in use with path globs (most specific wins), project-defined profiles that may extend a built-in one, and the install, build, test and publish command lists marked as owner-configuration (the only place a command may appear, as `env.worktree_setup` is today).
- Built-in profiles ship as data in the bundle for about a dozen ecosystems (npm, pnpm, yarn, cargo, go, pip, uv, poetry, maven, gradle, bundler, composer) with no commands; they are validated so a shipped profile can never run anything.
- `hitld work check` refuses an unknown profile, a version-source file that is not a repository path and a skip folder with a separator or `..`.
- A test per refusal. A policy or schema change reaches main only with the owner's own yes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Decided in the build-systems walk-through of 2026-11-22: HITLD-886, 910 to 919 (the design item is HITLD-883, GitHub issue 553). Smallest slice of the draft's step 1. Joins rc.2 as the owner decided (HITLD-918).

What reads `caches[].variable`: nothing yet. In this slice hitld only validates it (`hitld work check` and the built-in profiles' load check); nothing sets, exports or creates a folder from it. HITLD-925 has setup and checks export it, pointing at the tool's default folder or a machine-file path, and the disk report show the folder's size; the allowlist is what keeps that export from steering a tool.
