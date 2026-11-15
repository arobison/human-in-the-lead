// Milestone c5 (design 0003 section 14): no skill or agent prompt mentions a key, a passphrase or a
// store file path, and every store move in the skills is a `hitld` command or a hook. Every move
// of the private store and all key handling is deterministic `hitld` code, so an agent that forgets
// a step, or is talked into another one, cannot leak or lose the store.
//
// What is read: the skills, the templates and the agents as the plugin carries them (the agents
// that packaging generates included), and the briefs the code builds for an executor. A prompt may
// name a `hitld` command and its flags. It may not name a secret, where one is kept or a way to
// supply one, nor a file of the store, nor a way to move the store that is not `hitld`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { sizeItem } from '../lib/dispatch/sizing.mjs';
import { renderBrief } from '../lib/dispatch/brief.mjs';
import { expectedFiles } from '../lib/packaging/build.mjs';

/**
 * Where a key, a passphrase or a way to supply one is named.
 * @type {[RegExp, string][]}
 */
const SECRETS = [
  [/AGE-SECRET-KEY-1/i, 'an age private key'],
  [/\bage1[02-9ac-hj-np-z]{20,}/, 'an age public key'],
  [/HITLD_STORE_IDENTITY/, 'the variable a device key arrives in'],
  [/HITLD_STORE_PASSPHRASE/, 'the variable a passphrase arrives in'],
  [/--identity-fd\b|--passphrase-fd\b/, 'a flag that supplies a secret'],
  [/--recipient\b/, 'a flag that names a key'],
  [/\bpassphrase\b/i, 'a passphrase'],
  [/\bprivate key\b/i, 'a private key'],
  [/\b(?:device|identity) key\b/i, 'a device key'],
  [/\bkeychain\b|\bsecret-tool\b|\bage-keygen\b/i, 'where a key is kept or made'],
];

/**
 * The private store's own files and the places it lives.
 * @type {[RegExp, string][]}
 */
const STORE_PATHS = [
  [/store-devices\.json/, 'the device list'],
  [/hitld-(?:sync|remote)\.json/, "the store's machine-local records"],
  [/rotations\.jsonl/, 'the rotation record'],
  [/\.bundle\b|\.hitld\b/, 'a bundle or an export file'],
  [/\bhitld-store\b(?!-)/, "the remote's branch"],
  [/\bledger\.jsonl\b|\brun-state\.json\b|\bprimary-checkout\.json\b/, 'a file of the store'],
  [/\.local\/share\/human-in-the-lead|XDG_DATA_HOME/, "the store's directory"],
];

/**
 * What a prompt says that it may not.
 * @param {string} text
 * @returns {string[]}
 */
export function secretsIn(text) {
  return [...SECRETS, ...STORE_PATHS]
    .filter(([pattern]) => pattern.test(text))
    .map(([pattern, what]) => `${what} (${pattern})`);
}

/**
 * The commands in a text: the lines of fenced blocks and the inline code spans.
 * @param {string} text
 * @returns {string[]}
 */
function commandsIn(text) {
  /** @type {string[]} */
  const found = [];
  for (const block of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    found.push(
      ...block[1]
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    );
  }
  const bare = text.replace(/```[\s\S]*?```/g, '');
  for (const span of bare.matchAll(/`([^`\n]+)`/g)) found.push(span[1].trim());
  return found;
}

/** A command that runs hitld, with or without environment assignments in front of it. */
const IS_HITLD = /^(?:[A-Z_][A-Z0-9_]*=\S+\s+)*(?:node\s+\S*hitld\.mjs|hitld)\b/;

/** A command that moves, copies or opens the store, or that has the word store in it. */
const MOVES = /\b(?:cp|mv|scp|rsync|curl|wget|tar|zip|unzip|cat|age|sftp|aws|gsutil|rclone)\b/;

/**
 * The store moves in a text that are not a hitld command. A move is a shell command that names the
 * store, or a sentence that says to copy, carry, send or sync the store and has no hitld command
 * in it.
 * @param {string} text
 * @returns {string[]}
 */
export function foreignMoves(text) {
  /** @type {string[]} */
  const bad = [];
  for (const command of commandsIn(text)) {
    if (IS_HITLD.test(command)) continue;
    if (/\bstore\b/i.test(command) && MOVES.test(command)) bad.push(command);
    if (/\bgit\b.*\b(?:push|pull|fetch|clone)\b.*\bstore\b/i.test(command)) bad.push(command);
  }
  const prose = text.replace(/```[\s\S]*?```/g, ' ');
  for (const sentence of prose.split(/(?<=[.!?])\s+|\n\s*\n|\n\s*[-*\d]+[.)]?\s/)) {
    if (/`hitld\b/.test(sentence)) continue;
    if (
      /\b(?:copy|copies|copied|carry|carries|carried|move|moves|moved|send|sends|upload|download|sync|syncs|synced|push|pushes|pushed|pull|pulls|pulled|export|exports|import|imports)\b[^.\n`]*\b(?:private store|the store|its store|store files?)\b/i.test(
        sentence,
      ) ||
      /\b(?:private store|the store)\b[^.\n`]*\b(?:copied|carried|moved|synced|uploaded|downloaded|pushed|pulled)\b/i.test(
        sentence,
      )
    ) {
      bad.push(sentence.trim());
    }
  }
  return bad;
}

/** The skills, templates and agents as the plugin carries them. @returns {Map<string, string>} */
function prompts() {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const [path, content] of expectedFiles()) {
    const p = path.split('\\').join('/');
    if (!/^(skills|templates|agents)\//.test(p)) continue;
    out.set(p, typeof content === 'string' ? content : content.toString('utf8'));
  }
  return out;
}

/**
 * The briefs the code builds for an executor: each tier, with and without a plan, in a worktree
 * and not, for an area the owner reviews and one with a knowledge-base pointer.
 * @returns {Map<string, string>}
 */
function briefs() {
  const { policy, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'sample-app', key: 'SAM' },
    store: { remote: { required: true } },
    dispatch: { owner_review_areas: ['ui'], brief_kb: { api: ['kb/areas/api.md'] } },
  });
  if (!policy) throw new Error(JSON.stringify(errors));
  const base = { kind: 'work', state: 'planned', classification: 'public' };
  const plan = '\n## Done when\n\n`npm test` passes.\n\n## Plan\n\nChange `src/a.js`.\n';
  const items = [
    { ...base, id: 'SAM-1', area: 'api', touches: ['src/a.js'], body: plan },
    {
      ...base,
      id: 'SAM-2',
      area: 'ui',
      touches: ['src/**'],
      body: '\n## Done when\n\nIt works.\n',
    },
    { ...base, id: 'SAM-3', tier_override: 3, touches: ['src/a.js'], body: plan },
  ];
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const it of items) {
    for (const isolation of /** @type {const} */ (['worktree', 'none'])) {
      out.set(
        `brief for ${it.id} (${isolation})`,
        renderBrief({
          item: { ...it, path: `work/items/${it.id}-x.md` },
          sizing: sizeItem(it, policy),
          dispatch: 'D-1',
          branch: `hitld/${it.id}-x`,
          policy,
          isolation,
          worktree: isolation === 'none' ? '/work/tree' : null,
        }),
      );
    }
  }
  return out;
}

test('there are prompts to read: the skills, the templates, the agents and the briefs', () => {
  const found = [...prompts().keys()];
  for (const want of [
    'skills/adopt/SKILL.md',
    'skills/orchestrate/SKILL.md',
    'skills/execute/SKILL.md',
    'skills/chief-of-staff/SKILL.md',
    'templates/AGENTS.contract.md',
    'agents/generalizer.md',
    'agents/executor-tier1.md',
    'agents/executor-tier2.md',
  ]) {
    assert.ok(found.includes(want), `${want} is read`);
  }
  assert.ok(briefs().size >= 6);
});

test('c5: no skill, template, agent or brief mentions a key, a passphrase or a store file', () => {
  /** @type {string[]} */
  const bad = [];
  for (const [name, text] of [...prompts(), ...briefs()]) {
    for (const what of secretsIn(text)) bad.push(`${name}: ${what}`);
  }
  assert.deepEqual(bad, []);
});

test('c5: every store move in the skills, templates and agents is a hitld command', () => {
  /** @type {string[]} */
  const bad = [];
  for (const [name, text] of [...prompts(), ...briefs()]) {
    for (const move of foreignMoves(text)) bad.push(`${name}: ${move}`);
  }
  assert.deepEqual(bad, []);
});

test('c5: the skills do name the hitld commands that move the store', () => {
  const all = prompts();
  const adopt = commandsIn(/** @type {string} */ (all.get('skills/adopt/SKILL.md')));
  const orchestrate = commandsIn(/** @type {string} */ (all.get('skills/orchestrate/SKILL.md')));
  assert.ok(
    adopt.some((c) => /^hitld store remote set\b/.test(c)),
    'adopt: store remote set',
  );
  assert.ok(
    adopt.some((c) => /^hitld store device init\b/.test(c)),
    'adopt: store device init',
  );
  assert.ok(
    adopt.some((c) => /^hitld store status\b/.test(c)),
    'adopt: store status',
  );
  assert.ok(
    orchestrate.some((c) => /^hitld run checkpoint\b/.test(c)),
    'orchestrate: checkpoint',
  );
  assert.ok(
    orchestrate.some((c) => /^hitld handover\b/.test(c)),
    'orchestrate: handover',
  );
});

test('the scan catches what it is for', () => {
  // Each of these is a prompt that must be refused.
  for (const text of [
    'Set HITLD_STORE_IDENTITY to the key before you push.',
    'Ask the owner for the passphrase and pass it with --passphrase-fd 0.',
    'The key is in AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ.',
    'Read the private key from the keychain.',
    'Edit .human-in-the-lead/store-devices.json by hand.',
    'The ledger is ledger.jsonl in the private store directory.',
    'Look in ~/.local/share/human-in-the-lead/sample-app/.',
    'Upload the bundle: `hitld store export out.bundle`.',
  ]) {
    assert.notDeepEqual(secretsIn(text), [], text);
  }
  for (const text of [
    'Run `scp -r ~/.local/share/human-in-the-lead/sample-app other:/store`.',
    '```bash\nrsync -a store/ host:store/\n```',
    '```bash\ngit push store main\n```',
    'Copy the private store to the other machine.',
    'Then carry the store across and sync it by hand.',
  ]) {
    assert.notDeepEqual(foreignMoves(text), [], text);
  }
  // And these are fine: a hitld command, and a hitld command named in a sentence.
  for (const text of [
    'Run `hitld store remote set <url> --policy` and then `hitld store status`.',
    'When the project has a store remote, `hitld run start` pulls the private store first and `hitld run checkpoint` pushes it.',
    '```bash\nhitld store device init --cloud --name cloud-main\n```',
    'The owner creates a private repository for the store and gives its URL.',
    'Run `hitld store push` and read `store_sync` in the result.',
  ]) {
    assert.deepEqual([...secretsIn(text), ...foreignMoves(text)], [], text);
  }
});
