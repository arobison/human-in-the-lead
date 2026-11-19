---
id: HITLD-532
title: An executor is stuck or over by progress and budget, with a wall-clock backstop
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "A. Progress and budget, with a wall-clock backstop: Stuck means no progress events for a set time; over means the token budget is spent; a wide wall-clock limit stays only as a backstop for sessions that report nothing"
answered_at: 2026-11-19T21:53:37.026Z
answered_via: question-tool
answered_by: owner
---

## Question

How should the system decide an executor is stuck or over?

HITLD-493: executors are judged stuck by wall-clock limits (dispatch.stall_after 1800 seconds, dispatch.deadline 14400) although a session's event stream shows progress (tool calls, commits, tokens).

## Options and recommendation

- A. Progress and budget, with a wall-clock backstop: Stuck means no progress events for a set time; over means the token budget is spent; a wide wall-clock limit stays only as a backstop for sessions that report nothing
- B. Keep the wall-clock limits: Simple, but kills a slow executor that is making progress
- C. Budget only: Only the token budget ends an executor

Recommended: Progress and budget, with a wall-clock backstop. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
