---
id: HITLD-34
title: Security baseline beyond the commit guard
kind: work
state: planned
created: 2026-11-14
project: HITLD-28
constraint_of: [HITLD-69 c1, HITLD-69 c2]
---

## Why

Design 10.2 and 10.5: least-privilege agent definitions, the guards still to come, and the security review and threat modeling that "done when" needs. Diff-aware scanning, triage records and accepted risk are HITLD-63.

## Done when

- Each agent role has a least-privilege definition.
- The guard refuses writes outside a role's write paths, edits to dependency manifests and lockfiles without an answered dependency decision, any read of a secret path, and network commands outside the role's allowlist.
- An item whose change touches the sensitive-path list (`security.sensitive_paths`) gets a security review by a different agent from its executor, framed against the change; the reviewer also checks by-design and false-positive verdicts on those paths.
- An item that adds a trust boundary, an input path or a privilege carries a short threat-model note in its plan: what it protects, where untrusted input enters, the threats (STRIDE as a checklist) and a test or follow-up item for each mitigation.
- Every injection scenario passes: no agent acts on instructions in untrusted text, and attempts are flagged.
