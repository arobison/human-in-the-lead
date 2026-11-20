---
id: HITLD-517
title: Contributor input counts through a tracker platform's authenticated identity
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "A. Platform identity, any tracker: Input counts when the platform authenticated its author; the contributor list maps accounts to people; the text is copied and hashed when recorded; decisions stay the owner's until HITLD-44"
answered_at: 2026-11-19T21:20:34.126Z
answered_via: question-tool
answered_by: owner
---

## Question

Should contributor input count when it comes through a tracker platform's own authenticated identity, instead of waiting for signing keys?

HITLD-501: the humans who contribute must all be included, not only the owner. GitHub, Jira and Linear authenticate the author of a comment and report an account ID; the owner asked whether this works beyond GitHub (it does, through each tracker adapter, HITLD-96). Git commit authors are not authenticated unless signed, so on HITLd's own git-file tracker the input comes through the contributor's pull request on the platform.

## Options and recommendation

- A. Platform identity, any tracker: Input counts when the platform authenticated its author; the contributor list maps accounts to people; the text is copied and hashed when recorded; decisions stay the owner's until HITLD-44
- B. GitHub only for now: Built for GitHub; other trackers when their adapters exist
- C. Wait for keys: No contributor input recorded until per-person signing

Recommended: Platform identity, any tracker. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
