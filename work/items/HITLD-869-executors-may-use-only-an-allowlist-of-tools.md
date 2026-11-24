---
id: HITLD-869
title: Executors may use only an allowlist of tools and commands, and paths they may write are bounded
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-69 c2]
---

## Why

The review found that the guard looks at Bash only (`core/harness/claude-code/hooks/guard.mjs`), so for an executor the other tools are unguarded: `Write` to the security baseline, the quarantine file or `.git/config`; the GitHub connector's merge and push tools; session-spawning tools. The Bash rules also match command text, so quote-splitting (`git pu''sh`), variable expansion, `git send-pack`, scripts written then run, `gh pr merge --admin` and globbed paths pass.

## Done when

- For an executor, every tool other than an explicit allowlist is refused (file reads, edits inside its worktree, its allowed commands), including the forge connector's merge, push and settings tools and session-spawning tools.
- `Write` and `Edit` are bounded by path: not the security baseline, verdicts, the quarantine file, `.git/` contents, the project hook settings or policy files (this subsumes HITLD-857).
- Bash is an allowlist of parsed commands, not a deny-list of text; anything not on it is refused, and the refusal message says what is allowed.
- A test per bypass listed above, and the review's reproductions, are refused.
- The plugin copy matches. A guard change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Findings T2 and T4. HITLD-857 is folded in by the path rule. The forge item (HITLD-867) is the real control; this is defense in depth.
