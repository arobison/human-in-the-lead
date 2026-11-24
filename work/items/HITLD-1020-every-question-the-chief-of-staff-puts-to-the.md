---
id: HITLD-1020
title: Every question the chief of staff puts to the owner goes through the question tool, never left open at the end of a reply
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
---

## Done when

- The chief-of-staff skill says that every question to the owner, of any kind (a decision item, a judgment call, a classification, a scope or placement choice, a yes or no on a side effect), is asked with the structured question tool (`AskUserQuestion` in Claude Code), one question per call or one call with several, with the recommendation first; and that a reply never ends in an open question, an 'if you want X, tell me', or a list of options for the owner to answer in prose.
- The skill says what to do when the harness has no question tool (send the text as before) and that a reply which only informs, with nothing for the owner to decide, asks nothing.
- The skill's 'The question tool' bullet no longer limits itself to decision items; the same rule appears in the orchestrate skill's note to the owner-facing relay if that skill repeats it. A test or eval case, if the skill checks cover wording of this kind, pins the rule.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner said on 2026-11-24: 'we need something in the CoS skill to remember to always use the question box to ask me questions, never to just leave them dangling in a response'. The skill already says to use the question tool for decision items and for design questions, but a question that is not a decision item (for example, whether to treat a pull request as ordinary or owner-held, put as 'tell me if you want') was left in prose in that session. [Certain: the same session did it twice on 2026-11-24.]

## Notes

rc.2. Skill change, so it needs the owner's own yes at merge. Edits the same file as HITLD-387 and HITLD-1015; build the three in order to avoid conflicts. Related: HITLD-387, HITLD-1015.
