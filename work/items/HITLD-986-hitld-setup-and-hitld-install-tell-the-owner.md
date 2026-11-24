---
id: HITLD-986
title: `hitld:setup` and `hitld install` tell the owner how to cap the chief of staff's compaction window, and `hitld check install` reports when none is set
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `hitld:setup` and the setup guide say how to set the auto-compact window for the chief-of-staff session: `/autocompact 250k` in the chat, or `autoCompactWindow` in `.claude/settings.json`, or `CLAUDE_CODE_AUTO_COMPACT_WINDOW` on the cloud environment (tokens, at least 100000, capped at the model's window); the guide names the trade-off (more compactions, less detail kept) and that standing state lives in the tracker, ledger and store.
- `hitld check install` prints a line `compaction window` with the value it finds in the project settings, the user settings or the environment variable, or `not set` with the guide's fix; a test covers each source and the unset case.
- The guide says to check the result with `/context`, because the documentation does not confirm how the window applies to a 1M-token session.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

A long chat costs context size times calls, so the cheapest cut that keeps the chat is a smaller window with durable state on disk. The cloud sessions set the percent override themselves, which beats one added to the environment; the window variable is the one an owner controls. Serves the owner, who pays for the chat.

## Notes

rc.3. From the owner's request of 2026-11-24 to keep the token use of the chief-of-staff chat down without breaking the long-running chat: one chief-of-staff session read billions of cache-read tokens in eight days, because every model call re-reads the whole context, so cost grows with context size times the number of calls.
