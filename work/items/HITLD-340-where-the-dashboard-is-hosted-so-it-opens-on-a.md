---
id: HITLD-340
title: Where the dashboard is hosted so it opens on a phone
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Private Artifact: A new item (HITLD-339) builds the republish step after the owner decides what private-store content may be hosted."
answered_at: 2026-11-16T17:17:29.970Z
answered_via: chat
answered_by: owner
---

## Question

Publish the dashboard to a private claude.ai Artifact (a stable link that a session republishes), rather than serve it from a cloud container?

A cloud container is reclaimed after idle time and has no public URL. A private Artifact has a stable link that opens on a phone. The other options were a public Pages site and a server on the owner's own computer.

## Options and recommendation

- A. Private Artifact: A new item (HITLD-339) builds the republish step after the owner decides what private-store content may be hosted.
- B. Keep the static file: The dashboard stays a file the owner opens by hand.

Recommended: Private Artifact. A stable private link works on a phone and a container server does not last.

## Answer

Recorded in the front matter once answered.
