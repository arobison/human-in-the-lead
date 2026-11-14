// The send gate (design part 9.3): the only code path that sends anything outside the machine on
// a person's behalf. Filing feedback is the first user (design part 18.4); replies to contributors
// reuse it later.
//
// An ApprovedPublication is a value only `approvePublication` can make, and it makes one only from
// a person's answer, by a person the policy lets approve, in a process that is not an executor's.
// `sendApproved` refuses anything else, so no caller can hand the filer a look-alike object. The
// answer is taken exactly as answers to decisions are (`hitld rights answer`, design part 22,
// Q21): only from the person's own turn in the main session, with the same guards. The executor
// refusal is the decisions' own (core/lib/cli/executor.mjs); the plugin's Bash guard is the first
// line, since it denies executors every hitld command outside their short list.
//
// This file is part of the protected core (design 18.3, guardrail 1): the send gate.

import { executorSignal } from '../cli/executor.mjs';

/**
 * @typedef {{ repo: string, title: string, body: string, labels: readonly string[] }} Publication
 * @typedef {'approve' | 'edit' | 'by-hand'} ApprovalMode
 * @typedef {{ by: string, at: string, via: 'main-session', mode: ApprovalMode, answer: string }} Approval
 * @typedef {{ kind: 'approved-publication', subject: string, content: Readonly<Publication>, approval: Readonly<Approval> }} ApprovedPublication
 *
 * @typedef {object} Filer what sends an approved publication; tests and evals use a fake
 * @property {string} name
 * @property {(p: Readonly<Publication>) => { url: string } | Promise<{ url: string }>} create
 */

/** Every ApprovedPublication this process has made. A WeakSet: nothing can be added from outside. */
const issued = new WeakSet();

/** A refusal with a stable code, which the command reports as data. */
export class GateRefusal extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The answers the gate understands, by their first word. */
const ANSWER_WORDS = Object.freeze({
  approve: 'approve',
  approved: 'approve',
  yes: 'approve',
  y: 'approve',
  file: 'approve',
  edit: 'edit',
  drop: 'drop',
  no: 'drop',
  n: 'drop',
  'by-hand': 'by-hand',
  myself: 'by-hand',
});

/**
 * What a person's answer means: approve, edit (approve with the person's changes), drop, or
 * by-hand (approve, and the person posts it themselves). Null when it is none of these: the gate
 * never guesses an approval.
 * @param {string} answer @returns {ApprovalMode | 'drop' | null}
 */
export function parseAnswer(answer) {
  const first = String(answer ?? '')
    .trim()
    .toLowerCase()
    .split(/[\s,.:;!]+/)[0];
  return /** @type {Record<string, ApprovalMode | 'drop'>} */ (ANSWER_WORDS)[first] ?? null;
}

/**
 * Why this process may not take a person's approval, or null: the guard on decision answers
 * (`hitld rights answer`), unchanged. A dispatch's environment or a linked worktree refuses.
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} ctx
 */
export const approvalRefusal = (ctx) => executorSignal(ctx.env, ctx.cwd);

/**
 * Make an ApprovedPublication from a person's answer.
 * @param {{ subject: string, content: Publication, answer: string, by: string, approvers: readonly string[],
 *   ctx: { cwd: string, env: NodeJS.ProcessEnv }, now?: () => Date }} o
 * @returns {ApprovedPublication}
 */
export function approvePublication(o) {
  const why = approvalRefusal(o.ctx);
  if (why) {
    throw new GateRefusal(
      'not_permitted',
      `publishing is approved only by a person, through the main session in the primary checkout (${why}); an executor puts it in its report`,
    );
  }
  if (!o.approvers.includes(o.by)) {
    throw new GateRefusal(
      'not_an_approver',
      `${o.by} may not approve this (policy feedback.approvers: ${o.approvers.join(', ') || 'none'})`,
    );
  }
  const mode = parseAnswer(o.answer);
  if (mode === null || mode === 'drop') {
    throw new GateRefusal(
      'not_an_approval',
      `${JSON.stringify(o.answer)} is not an approval: answer approve, edit, by-hand or drop`,
    );
  }
  for (const k of /** @type {const} */ (['repo', 'title', 'body'])) {
    if (typeof o.content[k] !== 'string' || o.content[k].trim() === '') {
      throw new GateRefusal('empty', `the publication has no ${k}`);
    }
  }
  /** @type {ApprovedPublication} */
  const value = Object.freeze({
    kind: /** @type {const} */ ('approved-publication'),
    subject: o.subject,
    content: Object.freeze({
      repo: o.content.repo,
      title: o.content.title,
      body: o.content.body,
      labels: Object.freeze([...o.content.labels]),
    }),
    approval: Object.freeze({
      by: o.by,
      at: (o.now?.() ?? new Date()).toISOString(),
      via: /** @type {const} */ ('main-session'),
      mode,
      answer: o.answer,
    }),
  });
  issued.add(value);
  return value;
}

/** Whether a value is an ApprovedPublication this gate made. @param {unknown} value */
export const isApprovedPublication = (value) =>
  typeof value === 'object' && value !== null && issued.has(value);

/**
 * Send an approved publication with the filer. The only call of a filer's `create`.
 * @param {unknown} value @param {Filer} filer
 * @returns {Promise<{ url: string }>}
 */
export async function sendApproved(value, filer) {
  if (!isApprovedPublication(value)) {
    throw new GateRefusal(
      'not_approved',
      'only an approved publication from the send gate is sent',
    );
  }
  const approved = /** @type {ApprovedPublication} */ (value);
  if (approved.approval.mode === 'by-hand') {
    throw new GateRefusal('by_hand', 'the person posts this one themselves; nothing is sent');
  }
  // Trust boundary: an external publication. Only the approved content leaves the machine.
  const result = await filer.create(approved.content);
  if (!result || typeof result.url !== 'string' || result.url === '') {
    throw new Error(`the ${filer.name} filer returned no issue URL`);
  }
  return { url: result.url };
}
