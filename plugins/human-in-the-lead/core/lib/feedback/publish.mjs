// Publishing feedback (design part 18.4, "Generalized, then approved"; 18.3, guardrail 5).
//
// 1. The generalizer agent drafts a public version of a waiting record. Its output is untrusted
//    until classified: `recordDraft` checks its shape, takes its classification, and screens it
//    for anything from the record's context (project names, paths, people, IDs, the person's own
//    words). A draft that is not public, or that the screen catches, is `withheld` with the
//    reason and never filed.
// 2. `pending` shows each draft beside the person's words, with what the person should know
//    before approving.
// 3. `answerPublication` takes the person's answer. Approve, edit or by-hand goes through the send
//    gate (core/lib/sendgate/gate.mjs), which alone can make the approval and alone calls the
//    filer. Drop marks the record dropped. Only the draft's public text is sent: the record, and
//    the person's words in it, never leave the machine.

import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { findRepoRoot } from '../policy/policy.mjs';
import {
  GateRefusal,
  approvePublication,
  approvalRefusal,
  parseAnswer,
  sendApproved,
} from '../sendgate/gate.mjs';
import { findTerms, matchMessage } from '../guard/private-terms.mjs';
import { PrivateTermsError, loadTerms } from '../store/private-terms.mjs';
import { FEEDBACK_REPO, issueUrlPattern } from './filer.mjs';
import { assertPrivate, checkRecord, keyOf, readRecord, readRecords } from './record.mjs';
import { HEADINGS, harnessText } from './render.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('./record.mjs').FeedbackRecord} FeedbackRecord
 * @typedef {import('../sendgate/gate.mjs').Filer} Filer
 * @typedef {{ cwd: string, env: NodeJS.ProcessEnv }} Ctx
 * @typedef {{ names: string[], people: string[], paths: string[], ids: string[], tokens: string[] }} Context
 */

/** The issue title prefix of each form, so filed and hand-written issues read alike. */
export const TITLE_PREFIX = Object.freeze({
  bug: 'bug: ',
  friction: 'friction: ',
  idea: 'idea: ',
  'worked-well': 'worked well: ',
});

/** The footer on every filed issue. */
export const FOOTER =
  '---\n_Filed with `hitld feedback` and approved by a person before it was sent. The text was generalized from feedback given in a project; it holds none of that project’s material._';

/** What the person is told before approving (design 18.4). */
export const NOTICE =
  'The issue will be public, under your GitHub identity. That identity and the timing can show that you use HITLd, even though the text is generalized. To post it from an account you choose, answer by-hand: you get the text to copy, and the record is filed once you give the issue URL.';

/** The draft fields the generalizer writes. */
const DRAFT_FIELDS = Object.freeze([
  'title',
  'loop',
  'what_happened',
  'expected',
  'evidence',
  'classification',
  'reason',
]);
const CLASSES = Object.freeze(['public', 'internal', 'confidential', 'secret']);
const LIMITS = Object.freeze({
  title: 120,
  loop: 120,
  what_happened: 4000,
  expected: 2000,
  evidence: 4000,
  reason: 1000,
});

/** HITLd's own names: never project context, whoever mentions them. */
const OWN = new Set([
  'hitld',
  'human-in-the-lead',
  '.human-in-the-lead',
  'policy.json',
  'tracker.json',
  'agents.md',
  'skill.md',
  'claude.md',
  'node.js',
  'hitld.mjs',
  'arobison/human-in-the-lead',
]);

const ID_SHAPE = /\b([A-Z][A-Z0-9]*)-[1-9][0-9]*\b/g;
const PATH_LIKE = /(?:~|\.{1,2})?\/?[\w.@-]+(?:\/[\w.@-]+)+\/?/g;
const FILE_LIKE = /\b[\w-]{2,}\.[a-z][a-z0-9]{0,5}\b/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const HANDLE = /(?:^|[^\w@`/])@([A-Za-z0-9][\w-]{0,38})/g;
const URL = /https?:\/\/[^\s)>\]]+/g;
const BACKTICKED = /`([^`\n]+)`/g;
const HEX = /\b[0-9a-f]{7,40}\b/g;
const ABSOLUTE_PATH = /(?:^|[\s(`'"=])(?:~\/|\/[\w.-]+\/[\w.-]|[A-Za-z]:\\)/;

/** @param {string} s */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** @param {Iterable<string>} xs */
const uniq = (xs) =>
  [...new Set([...xs].map((x) => x.trim()).filter((x) => x.length >= 3))].filter(
    (x) => !OWN.has(x.toLowerCase()),
  );

/**
 * Tokens in free text that name something particular: code spans, paths, file names, emails,
 * handles, URLs and IDs.
 * @param {string} text
 */
function particulars(text) {
  /** @type {string[]} */
  const out = [];
  for (const re of [BACKTICKED, FILE_LIKE, EMAIL, URL, ID_SHAPE]) {
    for (const m of text.matchAll(re)) out.push(re === BACKTICKED ? m[1] : m[0]);
  }
  // A slash alone ("and/or") is not a path: it needs a dot, or to start at a root.
  for (const m of text.matchAll(PATH_LIKE)) if (/^[~./]|\./.test(m[0])) out.push(m[0]);
  for (const m of text.matchAll(HANDLE)) out.push(m[1]);
  return out;
}

/**
 * What the deterministic screen looks for: the project's names, its people and paths, the IDs in
 * the record, and the particular tokens in the person's words and the record's evidence.
 * @param {FeedbackRecord} record
 * @param {{ cwd: string, policy?: Record<string, any> | null, store?: PrivateStore, env?: NodeJS.ProcessEnv }} o
 * @returns {Context}
 */
export function recordContext(record, o) {
  const names = [];
  const people = [];
  const paths = [];
  const project = o.policy?.project;
  if (project?.id) names.push(project.id);
  const root = findRepoRoot(o.cwd);
  if (root) {
    paths.push(root);
    names.push(basename(root));
    const remote = git(root, ['remote', 'get-url', 'origin']);
    const m = /[:/]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote);
    if (m) {
      people.push(m[1]);
      names.push(m[2]);
    }
    people.push(git(root, ['config', 'user.name']), git(root, ['config', 'user.email']));
  }
  if (o.store) paths.push(o.store.root);
  if (o.env?.HOME) paths.push(o.env.HOME);
  const ids = [...(record.refs ?? [])];
  const tokens = [];
  for (const text of [record.words, record.expected, record.loop].filter(Boolean)) {
    tokens.push(...particulars(text));
  }
  for (const line of [...(record.evidence ?? []), record.what_happened ?? '']) {
    for (const m of line.matchAll(ID_SHAPE)) ids.push(m[0]);
    for (const m of line.matchAll(HEX)) tokens.push(m[0]);
    for (const w of line.split(/\s+/)) if (w.includes('/')) tokens.push(w);
  }
  return {
    names: uniq(names),
    people: uniq(people),
    paths: uniq(paths),
    ids: uniq(ids),
    tokens: uniq(tokens),
  };
}

/** Lower-case words of a text. @param {string} s */
const wordsOf = (s) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/**
 * Whether the draft repeats the person's words: all of them, or any run of ten in a row.
 * @param {string} draft @param {string} words
 */
function repeatsWords(draft, words) {
  const d = ` ${wordsOf(draft).join(' ')} `;
  const w = wordsOf(words);
  if (w.length >= 3 && w.length <= 10) return d.includes(` ${w.join(' ')} `);
  for (let i = 0; i + 10 <= w.length; i++) {
    if (d.includes(` ${w.slice(i, i + 10).join(' ')} `)) return true;
  }
  return false;
}

/**
 * The deterministic screen: why a draft's text is not fit to publish, beside the generalizer's own
 * judgment. Empty when nothing was found.
 * @param {string} text the draft's text, every field joined
 * @param {FeedbackRecord} record @param {Context} context
 * @returns {string[]}
 */
export function screenText(text, record, context) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} what @param {string[]} terms */
  const check = (what, terms) => {
    for (const t of terms) {
      if (new RegExp(`(?<![\\w-])${escape(t)}(?![\\w-])`, 'i').test(text)) {
        found.push(`it holds ${what} (${JSON.stringify(t)})`);
      }
    }
  };
  check("the project's name", context.names);
  check('a person from the project', context.people);
  check('a path from the project', context.paths);
  check('an ID from the record', context.ids);
  check("a name, path or handle from the person's words or the evidence", context.tokens);
  for (const m of text.matchAll(ID_SHAPE)) {
    if (m[1] !== 'HITLD') found.push(`it holds an ID (${m[0]}); a public draft names no IDs`);
  }
  if (ABSOLUTE_PATH.test(text)) found.push('it holds an absolute or home path');
  if (EMAIL.test(text)) found.push('it holds an email address');
  for (const m of text.matchAll(HANDLE)) {
    found.push(`it mentions @${m[1]}; a public draft mentions no one`);
  }
  for (const m of text.matchAll(URL)) {
    if (!m[0].startsWith(`https://github.com/${FEEDBACK_REPO}`)) {
      found.push(`it holds a link outside HITLd (${m[0]})`);
    }
  }
  if (repeatsWords(text, record.words)) {
    found.push("it repeats the person's words; the draft says it in its own words");
  }
  return [...new Set(found)];
}

/**
 * Check the shape of a draft from the generalizer: untrusted input. Returns the clean draft or
 * throws, naming what is wrong (never echoing the text).
 * @param {unknown} input @returns {Record<string, string>}
 */
export function checkDraftShape(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('the draft must be a JSON object');
  }
  const d = /** @type {Record<string, unknown>} */ (input);
  const unknown = Object.keys(d).filter((k) => !DRAFT_FIELDS.includes(k));
  if (unknown.length) throw new Error(`the draft has unknown fields: ${unknown.join(', ')}`);
  /** @type {Record<string, string>} */
  const out = {};
  for (const k of DRAFT_FIELDS) {
    if (d[k] === undefined || d[k] === null || d[k] === '') continue;
    if (typeof d[k] !== 'string') throw new Error(`the draft's ${k} must be text`);
    const v = /** @type {string} */ (d[k]).trim();
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) {
      throw new Error(`the draft's ${k} holds control characters`);
    }
    const max = /** @type {Record<string, number>} */ (LIMITS)[k];
    if (max && v.length > max) throw new Error(`the draft's ${k} is longer than ${max} characters`);
    if (v) out[k] = v;
  }
  for (const k of ['title', 'what_happened', 'classification']) {
    if (!out[k]) throw new Error(`the draft needs ${k}`);
  }
  if (/\n/.test(out.title)) throw new Error("the draft's title is one line");
  if (!CLASSES.includes(out.classification)) {
    throw new Error(`the draft's classification must be one of ${CLASSES.join(', ')}`);
  }
  return out;
}

/** The text of a draft that would be published, every field joined. @param {Record<string, string>} d */
const draftText = (d) =>
  [d.title, d.loop, d.what_happened, d.expected, d.evidence].filter(Boolean).join('\n');

/** @param {PrivateStore} store @param {string} cwd @param {FeedbackRecord} next */
function save(store, cwd, next) {
  const problems = checkRecord(next);
  if (problems.length) throw new Error(`the record is not valid: ${problems.join('; ')}`);
  assertPrivate(store, cwd, keyOf(next.id));
  // Trust boundary: the private store, outside every checkout (assertPrivate above).
  store.write(keyOf(next.id), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** @param {FeedbackRecord} r */
function withoutOutcome(r) {
  const next = { ...r };
  delete next.reason;
  delete next.url;
  delete next.approval;
  return next;
}

/**
 * Record the generalizer's draft for a waiting record. A draft that is not public, or that the
 * screen catches, makes the record `withheld` with the reason; otherwise it is `drafted`. A
 * withheld record takes a new draft, so the generalizer can try again.
 * @param {PrivateStore} store @param {string} id @param {unknown} input
 * @param {{ ctx: Ctx, policy?: Record<string, any> | null, now?: () => Date }} o
 */
export function recordDraft(store, id, input, o) {
  const record = readRecord(store, id);
  if (!['local', 'drafted', 'withheld'].includes(record.state)) {
    throw new Error(
      `${id} is ${record.state}; only a local, drafted or withheld record takes a draft`,
    );
  }
  const draft = checkDraftShape(input);
  const context = recordContext(record, {
    cwd: o.ctx.cwd,
    policy: o.policy,
    store,
    env: o.ctx.env,
  });
  /** @type {string[]} */
  const reasons = [];
  if (draft.classification !== 'public') {
    reasons.push(
      `the generalizer classified it ${draft.classification}${draft.reason ? `: ${draft.reason}` : ''}`,
    );
  }
  reasons.push(...screenText(draftText(draft), record, context));
  const { reason: _why, ...fields } = draft;
  const stored = { ...fields, drafted_at: (o.now?.() ?? new Date()).toISOString() };
  /** @type {FeedbackRecord} */
  const next = {
    ...withoutOutcome(record),
    draft: stored,
    state: reasons.length ? 'withheld' : 'drafted',
    ...(reasons.length ? { reason: `Not public: ${reasons.join('; ')}.` } : {}),
  };
  save(store, o.ctx.cwd, next);
  return { record: next, withheld: reasons.length > 0, reasons };
}

/**
 * The public issue for a drafted record: the forms' headings, the version and harness from the
 * record (HITLd's own data), everything else from the draft, and the footer.
 * @param {FeedbackRecord} record @param {Record<string, string>} draft
 * @returns {{ repo: string, title: string, body: string, labels: string[] }}
 */
export function publication(record, draft) {
  const EMPTY = '_No response_';
  const evidence = draft.evidence ? `\`\`\`\n${draft.evidence}\n\`\`\`` : EMPTY;
  const sections = [
    record.hitld_version,
    harnessText(record.harness),
    draft.loop,
    draft.what_happened,
    draft.expected,
    evidence,
  ];
  const body = HEADINGS.map((h, i) => `### ${h}\n\n${sections[i] || EMPTY}\n`).join('\n');
  return {
    repo: FEEDBACK_REPO,
    title: `${/** @type {Record<string, string>} */ (TITLE_PREFIX)[record.kind]}${draft.title}`,
    body: `${body}\n${FOOTER}\n`,
    labels: ['feedback', record.kind],
  };
}

/**
 * The drafted records waiting for the person, each draft beside the person's words, and the
 * withheld ones with their reasons.
 * @param {PrivateStore} store
 */
export function pending(store) {
  const { records, problems } = readRecords(store);
  const drafted = records.filter((r) => r.state === 'drafted');
  return {
    waiting: drafted.map((r) => ({
      id: r.id,
      kind: r.kind,
      words: r.words,
      ...(r.approval ? { approved_by_hand: r.approval.by } : {}),
      issue: publication(r, r.draft),
    })),
    to_draft: records.filter((r) => r.state === 'local').map((r) => r.id),
    withheld: records
      .filter((r) => r.state === 'withheld')
      .map((r) => ({ id: r.id, reason: r.reason })),
    problems,
    notice: NOTICE,
  };
}

/**
 * Refuse a publication that holds a term from the private term list (design part 10.3, rule 7),
 * naming the kind and line of each, in the title or the body, and never the term. A list that does
 * not read refuses too: nothing is sent unchecked.
 * @param {PrivateStore} store @param {{ title: string, body: string }} content
 * @param {{ ctx: Ctx, policy: Record<string, any> }} o
 */
function refuseIfPrivate(store, content, o) {
  /** @type {ReturnType<typeof loadTerms>} */
  let terms;
  try {
    terms = loadTerms({
      store,
      projectId: String(o.policy.project?.id ?? ''),
      env: o.ctx.env,
    });
  } catch (e) {
    if (e instanceof PrivateTermsError) {
      throw new GateRefusal(
        e.code,
        `nothing is sent: the private term list could not be checked (${e.message})`,
      );
    }
    throw e;
  }
  const found = [
    ['title', content.title],
    ['body', content.body],
  ].flatMap(([where, text]) => findTerms(text, terms.matchers).map((m) => matchMessage(m, where)));
  if (found.length) {
    throw new GateRefusal(
      'private-term',
      `nothing is sent: the issue holds ${found.length} private term(s) from the private term list (${found.join('; ')}). Edit the draft to refer to each by its role, then answer again`,
    );
  }
}

/**
 * The person's answer on one drafted record: approve, edit (the person's changes, then approve),
 * by-hand (approve; the person posts it), drop. With --url, the issue the person posted by hand.
 * @param {PrivateStore} store @param {string} id
 * @param {{ answer?: string, by?: string, url?: string, edits?: Record<string, string | undefined> }} input
 * @param {{ ctx: Ctx, policy: Record<string, any>, filer: Filer, now?: () => Date }} o
 */
export async function answerPublication(store, id, input, o) {
  // The gate's own refusal, first: nothing about the record is read for a caller it refuses.
  const why = approvalRefusal(o.ctx);
  if (why) {
    throw new GateRefusal(
      'not-permitted',
      `publishing is approved only by a person, through the main session in the primary checkout (${why}); an executor puts it in its report`,
    );
  }
  const record = readRecord(store, id);
  const by = input.by ?? 'owner';
  const approvers = /** @type {string[]} */ (o.policy.feedback?.approvers ?? ['owner']);

  if (input.url !== undefined) {
    if (record.state !== 'drafted' || record.approval?.mode !== 'by-hand') {
      throw new GateRefusal(
        'not-by-hand',
        `${id} was not approved by-hand; only a record the person posted themselves takes --url`,
      );
    }
    if (!approvers.includes(by)) {
      throw new GateRefusal(
        'not-an-approver',
        `${by} may not approve this (policy feedback.approvers: ${approvers.join(', ')})`,
      );
    }
    if (!issueUrlPattern(FEEDBACK_REPO).test(input.url)) {
      throw new GateRefusal(
        'not-an-issue',
        `--url must be an issue in ${FEEDBACK_REPO}, such as https://github.com/${FEEDBACK_REPO}/issues/12`,
      );
    }
    const next = save(store, o.ctx.cwd, { ...record, state: 'filed', url: input.url });
    return { record: next, filed: true, sent: false };
  }

  if (record.state !== 'drafted') {
    throw new GateRefusal(
      'not-drafted',
      `${id} is ${record.state}; only a drafted record is published${record.state === 'withheld' ? ` (${record.reason})` : ''}`,
    );
  }
  const answer = String(input.answer ?? '');
  const mode = parseAnswer(answer);
  if (mode === 'drop') {
    const next = save(store, o.ctx.cwd, { ...withoutOutcome(record), state: 'dropped' });
    return { record: next, filed: false, sent: false };
  }

  /** @type {Record<string, string>} */
  let draft = record.draft;
  const edits = Object.fromEntries(
    Object.entries(input.edits ?? {}).filter(([, v]) => typeof v === 'string'),
  );
  if (mode === 'edit') {
    if (!Object.keys(edits).length) {
      throw new GateRefusal(
        'no-edits',
        'edit needs the changed text: --title, --what-happened, ...',
      );
    }
    const { drafted_at, ...fields } = record.draft;
    draft = { ...checkDraftShape({ ...fields, ...edits }), drafted_at };
    // The person's changes are screened like the generalizer's draft: a public issue holds no
    // project material, whoever wrote it. A catch leaves the record drafted.
    const context = recordContext(record, {
      cwd: o.ctx.cwd,
      policy: o.policy,
      store,
      env: o.ctx.env,
    });
    const reasons = screenText(draftText(draft), record, context);
    if (reasons.length) {
      throw new GateRefusal('not-public', `the edited draft is not public: ${reasons.join('; ')}`);
    }
  } else if (Object.keys(edits).length) {
    throw new GateRefusal('edits-need-edit', 'changed text goes with the answer edit');
  }

  // Before anything is approved or sent: the issue is checked against the private term list, as
  // hitld publish check does. The refusal names each term's kind and line, never the term.
  if (mode !== null) refuseIfPrivate(store, publication(record, draft), o);

  const approved = approvePublication({
    subject: id,
    content: publication(record, draft),
    answer,
    by,
    approvers,
    ctx: o.ctx,
    now: o.now,
  });
  /** @type {FeedbackRecord} */
  const approvedRecord = { ...withoutOutcome(record), draft, approval: { ...approved.approval } };
  if (approved.approval.mode === 'by-hand') {
    const next = save(store, o.ctx.cwd, approvedRecord);
    return { record: next, filed: false, sent: false, issue: approved.content };
  }
  const { url } = await sendApproved(approved, o.filer);
  const next = save(store, o.ctx.cwd, { ...approvedRecord, state: 'filed', url });
  return { record: next, filed: true, sent: true };
}
