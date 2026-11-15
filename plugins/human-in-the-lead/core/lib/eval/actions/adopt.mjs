// Actions for the adopt scenarios (skills/adopt/SKILL.md): build the fixture project the skill
// adopts, run the git steps it runs, and read AGENTS.md back. The hitld commands themselves go
// through orchestrator.cli, which runs in consumer/ with a sandbox home. Every repository is built
// inside the sandbox.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureGit } from '../orchestrator-fixtures.mjs';
import { buildBareProject, buildTrackerProject } from '../adopt-fixtures.mjs';

/** The git subcommands a scenario may run: the ones the adopt skill runs, and reads. */
const GIT = [
  'status',
  'diff',
  'log',
  'rev-parse',
  'ls-files',
  'branch',
  'switch',
  'add',
  'commit',
  'merge',
];

/** The marker lines of the executor contract block. */
const BEGIN = /^<!-- hitld:contract begin /;
const END = /^<!-- hitld:contract end -->$/;

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'adopt.fixture': {
    description:
      'Build the project to adopt at consumer/ in the sandbox, committed on main: "tracker" (an in-repo tracker in HITLd format under tracker/, key APP, with its own scripts and views, and a tracker section in AGENTS.md) or "none" (code, CI and a CLAUDE.md, no AGENTS.md and no tracker). Both carry planted text that addresses an agent. Returns { root, files }.',
    input: {
      type: 'object',
      properties: { kind: { enum: ['tracker', 'none'] } },
      required: ['kind'],
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const root = join(ctx.sandbox, 'consumer');
      if (input.kind === 'tracker') buildTrackerProject(root);
      else buildBareProject(root);
      return { root: 'consumer', files: fixtureGit(root, 'ls-files').split('\n').length };
    },
  },

  'adopt.git': {
    description:
      'Run a git command in consumer/ (status, diff, log, rev-parse, ls-files, branch, switch, add, commit or merge). Returns { exit, lines }: the exit code and the output, one entry for each non-empty line.',
    input: {
      type: 'object',
      properties: {
        argv: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['argv'],
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const [sub, ...rest] = input.argv;
      if (!GIT.includes(sub)) throw new Error(`git ${sub} is not one an adopt scenario runs`);
      try {
        const out = fixtureGit(join(ctx.sandbox, 'consumer'), sub, ...rest);
        return { exit: 0, lines: out.split('\n').filter((l) => l !== '') };
      } catch (e) {
        const err = /** @type {{ status?: number, stderr?: string }} */ (e);
        return { exit: err.status ?? 1, lines: String(err.stderr ?? '').split('\n') };
      }
    },
  },

  'adopt.agents-md': {
    description:
      'Edit and read consumer/AGENTS.md as the adopt skill does after the owner\'s yes: add_rules appends a "## Project rules" section after the contract block (never inside its markers), and drop_section removes a "## <name>" section. Returns { headings, block_present, rules_after_block, rules_inside_block, missing } where missing lists the texts in keep that are no longer in the file.',
    input: {
      type: 'object',
      properties: {
        add_rules: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
        drop_section: { type: 'string', minLength: 1 },
        keep: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const path = join(ctx.sandbox, 'consumer', 'AGENTS.md');
      let lines = readFileSync(path, 'utf8').split('\n');
      if (input.drop_section) {
        const start = lines.findIndex((l) => l === `## ${input.drop_section}`);
        if (start >= 0) {
          let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
          if (end < 0) end = lines.length;
          // The contract block has its own heading: stop at its begin marker too.
          const marker = lines.findIndex((l, i) => i > start && BEGIN.test(l));
          if (marker >= 0 && marker < end) end = marker;
          lines = [...lines.slice(0, start), ...lines.slice(end)];
        }
      }
      if (input.add_rules) {
        const end = lines.findIndex((l) => END.test(l));
        if (end < 0) throw new Error('AGENTS.md has no contract block to add the rules after');
        const rules = [
          '',
          '## Project rules',
          '',
          ...input.add_rules.map((/** @type {string} */ r) => `- ${r}`),
        ];
        lines = [...lines.slice(0, end + 1), ...rules, ...lines.slice(end + 1)];
      }
      if (input.drop_section || input.add_rules) {
        writeFileSync(path, lines.join('\n').replace(/\n*$/, '\n'));
      }
      const text = readFileSync(path, 'utf8');
      const all = text.split('\n');
      const begin = all.findIndex((l) => BEGIN.test(l));
      const end = all.findIndex((l) => END.test(l));
      const rules = all.findIndex((l) => l === '## Project rules');
      return {
        headings: all.filter((l) => /^## /.test(l)),
        block_present: begin >= 0 && end > begin,
        rules_after_block: rules > end && end > begin,
        rules_inside_block: rules > begin && rules < end,
        missing: (input.keep ?? []).filter((/** @type {string} */ k) => !text.includes(k)),
      };
    },
  },
};
