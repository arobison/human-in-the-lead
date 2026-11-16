---
id: HITLD-144
title: An orchestrator's end-of-turn message reaches the chief of staff in a cloud session
kind: work
state: done
created: 2026-11-16
project: HITLD-15
claimed_by: D-17
release_note: An orchestrator started by a chief of staff sends its end-of-turn message with the harness's message tool every turn. New `hitld run woke` and `hitld run heard` record the chief of staff's wakes and the messages that reach it, and `hitld dispatch watch` reports `orchestrator_silent` when an orchestrator was woken or recorded work and no message followed within policy `orchestrator.silent_after_seconds` (default 900).
---

## Why

The chief-of-staff skill says that on the web, when an orchestrator's turn ends, its message to the chief of staff arrives. In the first self-hosted run it did not. The chief of staff received messages only when the orchestrator sent one with `send_message`. Each end-of-turn message, including a blocked executor report and a request for a decision, sat in the orchestrator's turn result, unseen, until the owner asked why the orchestrator was waiting. The orchestrator also ended turns asking the owner for input, although the owner talks only to the chief of staff and to interactive sessions.

## Done when

- The orchestrate skill tells an orchestrator started by a chief of staff to send its end-of-turn message with the harness's message tool, to the chief of staff's session ID given in its prompt, at the end of every turn. A turn that sends none is a defect the watchdog can see.
- The chief-of-staff skill's start prompt says the owner is not present, that the orchestrator decides operational calls itself and records them with `hitld rights log`, and that only real owner decisions go in `questions`.
- `hitld dispatch watch` (or `run status`) reports an orchestrator whose last turn ended with no message to the chief of staff, so the hourly check-in finds a stalled one without the owner asking.
- The skills' harness table says what actually delivers a turn's end on the web, and what does not.
- A test finds out whether a Stop hook in a cloud session can block the end of a turn until the message to the chief of staff has been sent, and whether any command a hook runs can send a message to another session. The same test covers an interactive executor session, whose end-of-turn report also does not reach its orchestrator without an explicit message (HITLD-147). The result is recorded here, and a hook is added only if it works; the skill and the watchdog remain the fallback.
- Tests or an eval scenario cover an orchestrator that ends a turn without sending, and one that asks the owner a question it should have decided.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Plan

Settled by the executor of D-17 (the item had none):

1. The orchestrate skill: the owner is not present; decide operational calls and record them with `hitld rights log`; send the end-of-turn message with the harness's message tool to the chief of staff's session ID, every turn.
2. The chief-of-staff skill: the start prompt says the same; the harness table says that on the web a turn's end delivers nothing and only a sent message arrives; the chief of staff runs `hitld run woke` after each message to `wake_to` and `hitld run heard` on each message from the orchestrator.
3. `hitld run woke` and `hitld run heard` write a machine-local record in the private store (`run/messages.json`, under `run/`, so it never leaves the chief of staff's machine, where it runs the watch; in the cloud its copy of the ledger may lag the orchestrator's, but this record is its own). `hitld dispatch watch` reports `orchestrator_silent`, with a wake message asking for the end-of-turn message, when the lease holder was woken or renewed the lease after the last message heard and has been quiet for policy `orchestrator.silent_after_seconds` (default 900, below the lease expiry of 1800, because an orchestrator waiting between wakes does not renew its lease). Without the record (no chief of staff) nothing is judged; a released lease is the successor path instead.
4. Tests in `core/test/watchdog.test.mjs`; the eval scenario `rights/operational-call-is-logged-not-asked`.
5. The hook test below, run for real; no hook ships in this change (see Notes).

## Notes

Raised by the owner in the chief of staff session. HITLD-86 (done) defines the chief of staff and the wake sources; this fixes how the end-of-turn message arrives in the cloud mapping. HITLD-109 needs this, since self-hosting runs this way from its first day.

### Hook test (D-17, 2026-11-16, a cloud session on Claude Code 2.1.325)

Run in the executor's own cloud session, an interactive tier-3 session started by the chief of staff, so it is also the HITLD-147 case. Hooks went in `.claude/settings.local.json` while the session ran; the file watcher picked them up at once (a PostToolUse hook fired on the next tool call). Every test message went to the orchestrator's session only.

- **A Stop hook can block the end of a turn.** A command Stop hook that printed `{"decision":"block","reason":...}` unless a marker file existed stopped the turn from ending and fed the reason back; the turn continued. A PostToolUse hook sees the tool name `mcp__claude-code-remote__send_message`, so it can set that marker when the message is sent, and the Stop hook can let the turn end only after it. The cloud environment's own Stop hook (the git check) blocks the same way, and both ran.
- **A hook can send a message to another session.** A hook of type `mcp_tool` (server `claude-code-remote`, tool `send_message`, `input` with `session_id` and `message`) delivered to the orchestrator: from PostToolUse, and from Stop, where `${last_assistant_message}` in `message` carried the turn's last words verbatim. A command hook has no supported way: the CLI has no command that sends to a session, and calling the session API with the container's credentials is not a supported path.
- **Interactive executor sessions (HITLD-147):** the same holds; this session's end-of-turn report reaches its orchestrator only through `send_message`, and either hook would close the gap there too.

No hook ships here. Both kinds work, but shipping one needs choices this item does not state: a Stop `mcp_tool` hook needs the chief of staff's (or orchestrator's) session ID in a settings file per session, since plugin hooks are fixed and the hook input does not name it; a blocking Stop hook needs to know which sessions owe a message, and a Stop hook that blocks repeatedly is capped by the harness (8 consecutive blocks, per the hooks documentation; not tested here). The skill and the watchdog are the fallback in the meantime.

