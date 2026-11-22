---
id: HITLD-754
title: "Release lines: the tag format"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. A tag template per line, default name@version: Templates such as {name}@{version}, {name}-v{version}, {name}/v{version} or v{version}; work check refuses templates that could match the same tag."
answered_at: 2026-11-22T02:03:11.622Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-752 question 2: how does a line declare its tag format?

No tag shape is standard across Go, npm, Rust, Python and C++; HITLD writes the tags and needs only a template it can fill and match.

## Options and recommendation

- A. A tag template per line, default name@version: Templates such as {name}@{version}, {name}-v{version}, {name}/v{version} or v{version}; work check refuses templates that could match the same tag.
- B. Fixed name@version only: One format.
- C. A short list of named styles: npm, go, cargo, plain.

Recommended: A tag template per line, default name@version. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
