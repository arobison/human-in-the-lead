// Filers send an approved publication (design part 18.4). The send gate calls `create` and nothing
// else does. Tests and evals use the fake, which records what would be sent.
//
// The real filer shells out to the GitHub command line, `gh issue create`, with an argument list
// (never a shell string) and the body on standard input. The design names no tool or token for
// filing; gh brings its own sign-in, so HITLd holds no token.

import { execFileSync } from 'node:child_process';

/** @typedef {import('../sendgate/gate.mjs').Filer} Filer */
/** @typedef {import('../sendgate/gate.mjs').Publication} Publication */

/** HITLd's repository, where feedback is filed. */
export const FEEDBACK_REPO = 'arobison/human-in-the-lead';

/** An issue URL in a repository. @param {string} repo */
export const issueUrlPattern = (repo) =>
  new RegExp(`^https://github\\.com/${repo.replace(/[.]/g, '\\.')}/issues/[1-9][0-9]*$`);

/**
 * The real filer: `gh issue create`. It runs with the caller's environment, so gh uses the
 * person's own sign-in, and fails without one.
 * @param {{ env: NodeJS.ProcessEnv }} o @returns {Filer}
 */
export function ghFiler({ env }) {
  return {
    name: 'gh',
    create(p) {
      const args = ['issue', 'create', '--repo', p.repo, '--title', p.title, '--body-file', '-'];
      for (const label of p.labels) args.push('--label', label);
      /** @type {string} */
      let out;
      try {
        // Trust boundary: an external publication. Reached only through sendApproved, with an
        // ApprovedPublication's content; an argument list, so no shell reads the title.
        out = execFileSync('gh', args, {
          input: p.body,
          encoding: 'utf8',
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 60_000,
        });
      } catch (e) {
        const err = /** @type {{ code?: string, stderr?: string }} */ (e);
        if (err.code === 'ENOENT') {
          throw new Error(
            'the GitHub command line (gh) is not installed; answer by-hand to post it yourself',
          );
        }
        throw new Error(
          `gh issue create failed: ${String(err.stderr ?? '').trim() || 'no output'}`,
        );
      }
      const url = out.trim().split('\n').at(-1)?.trim() ?? '';
      if (!issueUrlPattern(p.repo).test(url)) {
        throw new Error(`gh issue create printed no issue URL for ${p.repo}`);
      }
      return { url };
    },
  };
}

/**
 * A fake filer that records what would be sent and answers with a made-up issue URL.
 * @param {{ sent?: Publication[], fail?: boolean }} [o]
 * @returns {Filer & { sent: Publication[] }}
 */
export function fakeFiler(o = {}) {
  const sent = o.sent ?? [];
  return {
    name: 'fake',
    sent,
    create(p) {
      if (o.fail) throw new Error('the fake filer was told to fail');
      sent.push({ repo: p.repo, title: p.title, body: p.body, labels: [...p.labels] });
      return { url: `https://github.com/${p.repo}/issues/${sent.length}` };
    },
  };
}
