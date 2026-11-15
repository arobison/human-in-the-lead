---
id: HITLD-54
title: "The thin MCP server (`hitld mcp`)"
kind: work
state: planned
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
