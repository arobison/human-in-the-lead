---
id: HITLD-971
title: "Cut build systems to a pnpm core: keep HITLD-920 and 921 in rc.2, move 922, 923, 924 and 930 to rc.3"
kind: decision
state: done
created: 2026-11-23
project: HITLD-15
decider: owner
answer: "A. Keep 920 and 921, add a pnpm walk; move the rest: 920 and 921 stay, one new pnpm walk item, 922 to 924 and 930 move to rc.3"
answered_at: 2026-11-23T06:06:44.366Z
answered_via: question-tool
answered_by: owner
---

## Question

Which of the six build-systems and review-skill items stay in rc.2?

The owner said pnpm support must be in rc.2 (CesiumJS 2.0 is likely to move to pnpm). Install and the dependency trigger already know pnpm-lock.yaml; a pnpm profile as data (920), the trigger reading lockfile names from profiles (921) and a pnpm walk are what rc.2 adds. A new item for the pnpm walk is filed.

## Options and recommendation

- A. Keep 920 and 921, add a pnpm walk; move the rest: 920 and 921 stay, one new pnpm walk item, 922 to 924 and 930 move to rc.3
- B. Keep 920 to 923, move 924 and 930: All build-system code and guide examples stay
- C. Only a pnpm walk; move all six: Smallest

Recommended: Keep 920 and 921, add a pnpm walk; move the rest. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
