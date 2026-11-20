---
id: HITLD-54
title: "The thin MCP server (`hitld mcp`)"
kind: work
state: proposed
created: 2026-11-14
project: HITLD-28
---

## Why

Design 15 and part 21: the MCP server is generated from the same command table as the command line, tools only. The Copilot cloud agent has tools but no general shell, and uses it.

## Done when

- `hitld mcp` serves every command that is allowed over MCP as a tool, generated from the command table. A new command appears without separate code.
- Only tools are offered, no resources or prompts.
- Commands that are refused over MCP (decision answers, `hitld config write`, `hitld env primary --reset`) are absent or refuse.
- A test calls the server over stdio and gets the same JSON as the command line for a read command.
- A test fails when a command exists in the table but not in the server, unless it is marked as not for MCP.

## Returned to proposed on 2026-11-20 (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (508,409): MCP server surface; decision answers refused over MCP. The decisions since then are stay in the harness and answers by proof (HITLD-540, 515); answers, proof and contributors (HITLD-515 to 517). The owner decided (HITLD-578) that the items the decisions change most return to `proposed` until reshaped, so the planner does not offer them; the owner promotes the item again once it is reshaped.
