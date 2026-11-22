---
id: HITLD-320
title: Clicking an item link in dashboard.html shows a loading-error page instead of the item file
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-192 c2]
---

## Why

Reported by the owner after reviewing the dashboard (PR #196, HITLD-62, merged): clicking an item link in a milestone drawer shows a page that says "Loading is taking longer than expected. There may be an issue with the content you're trying to load. The code itself may still be valid and functional." The owner viewed the file in the Claude app, outside a normal browser, and said it was good enough to merge and to sort out later in this item.

The links are plain anchors to the item file on the forge (`https://github.com/<owner>/<repo>/blob/HEAD/work/items/<file>.md`, from `origin`). The chief of staff has not reproduced the page and does not know the cause. Likely causes, none verified: the viewer sandbox blocks navigation away from the file or to github.com; a link needs `target="_blank"` and `rel="noopener noreferrer"`; the repository is private and the viewer has no session; the `HEAD` ref form.

## Done when

- The cause is found and written in the item: open the page in a normal browser and in the Claude app's viewer, and say which links work where.
- Item links work in a normal browser, and where the viewer cannot follow a link the page says so in the drawer (for example a copyable path) instead of failing silently.
- A test covers whatever attribute or form the fix needs (for example `target` and `rel` on the links).
- `npm run check` and `hitld work check` pass.

