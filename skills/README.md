# Skills

Layer 2 sources in the `SKILL.md` format, one directory per skill ([design part 15.2](../docs/design/0001-human-in-the-lead/15-architecture.md#skills-in-the-agent-skills-format)). Portable front matter only (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`); harness-specific fields are added by packaging. Skills call `hitld`, never a harness feature.

The first milestone has `orchestrate/` (the orchestrator's run loop) and `execute/` (one dispatched item, per the executor contract), from piece (h). `npm run build` places them in the plugin with Claude Code front matter. The others listed in design part 16.1 follow in later milestones.
