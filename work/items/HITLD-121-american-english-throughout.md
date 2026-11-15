---
id: HITLD-121
title: "American English throughout: prose, messages, identifiers, and a spelling check"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
needs: [HITLD-119]
---

## Why

The project mixes British spellings (enrol, enrolment, judgement, licence, behaviour, labelled, -ise endings) into its docs, skills, messages and some identifiers. The owner asked for American English, before v0.1.0-rc.1, when renaming identifiers is cheapest.

## Done when

- Prose everywhere (docs, design, guides, skills, templates, CLI messages, decision and question text, option labels such as "Enrol it") uses American spelling: enroll, enrollment, judgment, license (noun and verb), behavior, labeled, canceled, -ize and -yze endings.
- Identifiers follow: the `judgement` module, command and any field or key become `judgment`. Data people keep (tracker keys such as a project's `judgements`, settings keys, ledger or store fields) follow the rename rule of design 16.5: the old name is read with a warning for one minor release and a migration step rewrites files. Output names (commands, error codes, result fields) change with no fallback and are listed in the release note.
- `CONTRIBUTING.md` and the writing rules in the executor contract and skills say American English.
- `npm run check` runs a spelling check over tracked text files that fails on a short list of British forms (with an allowlist for quoted text and proper names), with a test.
- `npm run check`, the offline eval gate and `hitld work check` pass.
