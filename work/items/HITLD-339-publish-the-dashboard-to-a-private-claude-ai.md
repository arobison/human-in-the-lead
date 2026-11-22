---
id: HITLD-339
title: Publish the dashboard to a private claude.ai Artifact so it opens on a phone
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-192 c2]
---

## Done when



- A session republishes the generated dashboard to one private claude.ai Artifact at a stable link, each time the dashboard is regenerated, so the owner reads it on a phone without a file or a server.
- Before the first publish, the item says what the page holds from the private store and what from the public tracker, and the owner has decided what may be hosted off the repository. Private-store content stays off the page unless the owner decides otherwise.
- The page stays one file with no network request (design 12.4); the Artifact host's own page wrapper is the only addition, and the item says how the page's content policy and inline script behave inside it.
- The publish step is a documented command or skill step, not hand work, and says who may run it (the chief of staff, not executors).
- `npm run check` and `hitld work check` pass.

## Why

The owner asked on 2026-11-16 whether the dashboard could be something other than a static file and still be easy to use, and whether a cloud session could run a small web server reachable from a phone. The chief of staff's answer: a cloud container is reclaimed after idle time and has no public URL, so a server there is not a durable link; a private Artifact is. The owner chose the private Artifact (decision HITLD-340).

## Notes

Open points, to walk through with the owner before building:

- What the dashboard writes from the private store, and whether any of it may be hosted off the repository.
- Whether the Artifact's runtime capabilities (live data, owner input) are worth using, or the page stays a republished snapshot.
- Where the publish step runs and how often (every regeneration, or on request).
- Whether the viewer's handling of item links (HITLD-320) differs inside an Artifact.

Not taken: a public Pages site (the page would be public), and `hitld dashboard --serve` on the owner's computer (not reachable from a phone away from it). Design 12 changes to say where the page may be hosted.
