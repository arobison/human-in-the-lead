---
id: HITLD-146
title: The chief of staff answers questions about HITLd from the design and code, with the source cited
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

The chief of staff answers the owner's questions about how HITLd works, and the owner acts on those answers. Nothing in its skill tells it to check the design or the code first, so it answers from memory unless it chooses to look. In the first self-hosted run it told the owner a store device was unapproved from a stale local copy, and described the executor cap from the machine profile before reading the design that says what the cap counts. Both answers were wrong or incomplete, and both were stated plainly. The design describes a knowledge base for exactly this (design part 8), and the `hitld kb` tool that makes it cheap is not built yet (HITLD-55).

## Done when

- The chief-of-staff and orchestrate skills say that a claim about how HITLd works, what a command does, what is built, or what state a thing is in is checked before it is made. The sources are the design (`docs/design/`), the guides (`docs/guide/`), the code and the output of a `hitld` command, and the answer names the file and section or the command it rests on.
- A claim that was not checked is said to be unchecked, in the same sentence, and a claim about state that can change (a store, a lease, a pull request) is read from the live source in that turn, not from an earlier one.
- Where `hitld kb search` exists (HITLD-55), the skills name it as the first lookup. Until then they name `docs/design/` and a text search.
- An offline eval scenario, in the end-to-end runner (HITLD-57), asks a design question on a fixture repository whose design says one thing and whose most common default says another, and a second whose answer needs a command's live output. It grades whether the answer matches the fixture, cites a source that exists, and reads live state. A deliberately degraded skill that omits the rule fails it.
- Tests or the skill checks of the plugin build confirm the rule is in both skills and in the plugin copies.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. The rule is an instruction, so it helps only as far as it is followed; the eval is what measures that. It complements HITLD-55, which makes citing the design a single command, and HITLD-75, which grades what agents write into the tracker. It does not block HITLD-109.
