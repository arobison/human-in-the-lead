// The DCO check (Q20, HITLD-59). Pure functions over parsed commits, plus a reader that gets the
// commits from git. No dependencies, so a test can run it on fixture histories.
//
// Two modes:
//   pr    each commit of a pull request. A commit by a person carries a `Signed-off-by` matching
//         its author's email. An agent commit (an `Agent-Role:` or `Dispatch:` trailer) is accepted
//         without one. A merge commit (main merged into the branch) is exempt.
//   main  each commit pushed to main. It carries a `Signed-off-by` from a person, not an agent
//         noreply address. This is where the approver's sign-off on an agent pull request is
//         enforced: the repository allows squash merges only, and the approver signs the squash
//         commit's message. A merge commit made by the merge button is exempt.

import { execFileSync } from 'node:child_process';

/**
 * @typedef {object} Commit
 * @property {string} sha
 * @property {string[]} parents
 * @property {string} authorName
 * @property {string} authorEmail
 * @property {string} message  The full message, subject and body.
 */

/**
 * @typedef {object} Finding
 * @property {string} sha
 * @property {string} subject
 * @property {string} problem
 * @property {string} fix
 */

/** @typedef {'pr' | 'main'} Mode */

const SIGNED_OFF = /^Signed-off-by:[ \t]*(\S.*?)[ \t]*<([^<>\s]+)>[ \t]*$/gm;
const AGENT_TRAILER = /^(?:Agent-Role|Dispatch):[ \t]*\S/m;
const AGENT_EMAILS = new Set(['noreply@anthropic.com']);
const ZERO_SHA = /^0+$/;

/** @param {string} email */
export const isAgentEmail = (email) => {
  const e = email.toLowerCase();
  return AGENT_EMAILS.has(e) || /\[bot\]@/.test(e);
};

/** @param {string} message @returns {{ name: string, email: string }[]} */
export const signoffs = (message) =>
  [...message.matchAll(SIGNED_OFF)].map((m) => ({ name: m[1], email: m[2] }));

/** @param {string} message */
export const isAgentCommit = (message) => AGENT_TRAILER.test(message);

/** @param {Commit} c */
export const isMergeCommit = (c) => c.parents.length > 1;

/** @param {Commit} c @returns {string} */
const subjectOf = (c) => c.message.split('\n', 1)[0];

/**
 * @param {Commit[]} commits
 * @param {Mode} mode
 * @returns {{ findings: Finding[], exempt: string[], checked: number }}
 */
export const checkCommits = (commits, mode) => {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[]} */
  const exempt = [];
  for (const c of commits) {
    if (isMergeCommit(c)) {
      exempt.push(c.sha);
      continue;
    }
    const signed = signoffs(c.message);
    const subject = subjectOf(c);
    if (mode === 'pr') {
      if (isAgentCommit(c.message)) continue;
      const mine = signed.some((s) => s.email.toLowerCase() === c.authorEmail.toLowerCase());
      if (!mine) {
        findings.push({
          sha: c.sha,
          subject,
          problem: signed.length
            ? `Signed-off-by does not match the author <${c.authorEmail}>`
            : 'no Signed-off-by line',
          fix: 'git commit --amend -s for the last commit, or git rebase --signoff <base> for several, then push the branch again',
        });
      }
    } else if (!signed.some((s) => !isAgentEmail(s.email))) {
      findings.push({
        sha: c.sha,
        subject,
        problem: signed.length
          ? 'Signed-off-by is from an agent only; a person must sign off'
          : 'no Signed-off-by line',
        fix: 'the approver adds their Signed-off-by to the squash commit message when merging the pull request',
      });
    }
  }
  return { findings, exempt, checked: commits.length };
};

const FIELD = '\u0000';
const RECORD = '\u001e';
const FORMAT = ['%H', '%P', '%an', '%ae', '%B'].join('%x00') + '%x1e';

/** @param {string} repo @param {string[]} args */
const git = (repo, args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** @param {string} out @returns {Commit[]} */
const parse = (out) =>
  out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim() !== '')
    .map((r) => {
      const [sha, parents, authorName, authorEmail, message] = r.split(FIELD);
      return {
        sha,
        parents: parents.split(' ').filter(Boolean),
        authorName,
        authorEmail,
        message: message.replace(/\n+$/, ''),
      };
    });

/** @param {string} repo @param {string} sha */
const hasCommit = (repo, sha) => {
  try {
    git(repo, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

/**
 * The commits in `from..to`, oldest first. An all-zero or unknown `from` (a new branch, or a
 * forced push whose old tip is gone) reads only `to`, never all of history.
 * @param {string} repo @param {string | undefined} from @param {string} to
 * @returns {Commit[]}
 */
export const readCommits = (repo, from, to) => {
  const known = from !== undefined && from !== '' && !ZERO_SHA.test(from) && hasCommit(repo, from);
  const args = known
    ? ['log', '--reverse', `--format=${FORMAT}`, `${from}..${to}`]
    : ['log', '-n', '1', `--format=${FORMAT}`, to];
  return parse(git(repo, args));
};

/** @param {{ findings: Finding[], exempt: string[], checked: number }} r @param {Mode} mode */
export const formatReport = (r, mode) => {
  const lines = [
    `DCO check (${mode}): ${r.checked} commit(s), ${r.findings.length} failing, ${r.exempt.length} merge commit(s) exempt.`,
    mode === 'pr'
      ? 'Exempt: merge commits (main merged into the branch). Accepted without a sign-off: agent commits (an Agent-Role or Dispatch trailer).'
      : 'Exempt: a merge commit made by the merge button. Squash merges are the rule; the approver signs the squash commit.',
  ];
  for (const f of r.findings) {
    lines.push('', `FAIL ${f.sha.slice(0, 12)} ${f.subject}`, `  ${f.problem}`, `  Fix: ${f.fix}`);
  }
  return lines.join('\n');
};
