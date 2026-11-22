---
id: HITLD-913
title: rc.2 reads JSON, TOML and properties version files; git tags are the fallback
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. JSON, TOML and properties; tags as fallback: Small parsers, no dependency."
answered_at: 2026-11-22T20:51:25.491Z
answered_via: question-tool
answered_by: owner
---

## Question

Which version-file formats does rc.2 read (HITLD-883 decision 5 of 12)?

Covers Cargo, Python and Gradle with small built-in parsers and no dependency; Maven and regex sources wait.

## Options and recommendation

- A. JSON, TOML and properties; tags as fallback: Small parsers, no dependency.
- B. Also XML and regex: Covers Maven; adds size and risk.
- C. JSON only in rc.2: Smallest change.

Recommended: JSON, TOML and properties; tags as fallback. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
