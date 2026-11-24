---
id: HITLD-1019
title: The cache-variable check refuses credential, session and shell-startup stems and runner variables, before HITLD-925 exports the variable
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
---

## Done when

- `cacheVariableProblem` also refuses a suffixed cache name when a word before the suffix is one of: AUTH, SESSION, COOKIE, PRIVATE, CERT, PASS, PWD, VAULT, NETRC, OAUTH, JWT, BEARER, KRB, KERBEROS, SUDO, ASKPASS, CONFIG, ENV, SHELL, BASH, ZSH; a test per word.
- It refuses a name with the `RUNNER_` prefix (RUNNER_TOOL_CACHE puts what is cached on the PATH of GitHub Actions steps) and ZSH_CACHE_DIR (zsh sources files from it at startup); the switch words also include ENABLED, DISABLED, OFFLINE and FORCE.
- The HITLD-920 release note and the `schemas/ecosystem-profiles.schema.json` and `schemas/policy/ecosystems.schema.json` descriptions say what the rule names (credential, session, setting, switch, shell start-up) without claiming more than the code; the plugin copies are rebuilt.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Pull request 596 (HITLD-920) was merged on the owner's yes on 2026-11-24 with a convention filter, not a security boundary, for the cache variable allowlist. The third independent read listed names that still pass and that nothing real reads, plus two real variables that execute code: RUNNER_TOOL_CACHE and ZSH_CACHE_DIR. [Certain: these still pass the rule as merged, from the read of the code and its tests.] Nothing exports the variable yet, so there is no exposure today.

## Notes

rc.2, and it must merge before HITLD-925, which will export the variable to a worktree. Related: HITLD-920, HITLD-925.
