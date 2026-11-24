---
id: HITLD-994
title: "Spike: a Claude Code project as the chief-of-staff chat, tried on a throwaway project, with a written result and an owner decision on whether to adopt it"
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The owner creates a throwaway project at claude.ai/code on a copy of the repository (projects are single-user and made in the app, so this step is the owner's), and the spike records the plan the owner is on, because projects are in public beta on Pro, Max and Ultra only.
- The spike answers four questions with evidence, each as a line in the result: the project's coordinator can run `hitld` and git commands in the checkout; it can start a session, message it and read its result the way the chief of staff does with `create_session` and `send_message`; the commit guard's git hooks fire in a thread; and the repository's `.claude/settings.json` and plugin hooks are or are not applied to a thread.
- The spike measures the cost: `/context` size and cache-read tokens per day after about 200 turns of the coordinator, against the current chief-of-staff chat.
- The result is written as a short note on this item with a recommendation (adopt, adopt for the owner's own chat only, or do not adopt) and what would have to change in HITLD (HITLD-401 to 404, the orchestrate skill, the lease rules) if adopted; the owner decides, and the decision is recorded.
- `hitld work check` passes.

## Why

The owner wants a long-running chat with the chief of staff that does not grow in cost with its length. A project's coordinator is documented to work from recent messages, recent threads and project memory instead of its full history, which is that behaviour built in. The documentation does not say whether the coordinator has a shell, repository access or session control, so adopting it without a test could break the chief-of-staff flow in mid-run. Serves the owner, who pays for the chat, and the product, which cannot depend on a beta feature that Team and Enterprise plans do not have until a decision says how far to rely on it.

## Notes

rc.3 spike, after HITLD-986 to 993 (the settings-based cuts, which do not depend on projects). From the owner's question of 2026-11-24 whether the Claude Code projects feature helps. Sourced from one page, https://code.claude.com/docs/en/claude-projects.md (read by a subagent; the changelog was not checked): a project is one coordinator conversation that starts and tracks threads; project instructions up to 16,000 characters; project memory files; separate model and effort for coordinator and threads; threads read each repository's CLAUDE.md but not `.claude/settings.json` or `.mcp.json`; available at claude.ai/code, the desktop Code tab and mobile, not the terminal CLI, VS Code or JetBrains; no sharing; 500 new threads a day. Not run in the current rc.2 run: moving the chief of staff mid-run would risk the lease and handover rules (HITLD-794 to 796).
