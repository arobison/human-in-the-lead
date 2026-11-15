// The issue body for a feedback record: the headings of the forms in .github/ISSUE_TEMPLATE/, in
// their order, as GitHub writes a submitted form ("### Heading", a blank line, the answer). A test
// parses each form and checks these headings against it, so filed and hand-written issues match.

/** The form headings in order, and where each comes from in the record. */
export const HEADINGS = Object.freeze([
  'HITLd version',
  'Harness',
  'Loop or area',
  'What happened',
  'What you expected',
  'Evidence',
]);

/** The form file for each kind of feedback. */
export const FORM_OF = Object.freeze({
  bug: '1-bug.yml',
  friction: '2-friction.yml',
  idea: '3-idea.yml',
  'worked-well': '4-worked-well.yml',
});

const EMPTY = '_No response_';

/** The forms' Harness options, by adapter ID; any other harness is "Other" and named. */
const HARNESS_OPTION = Object.freeze({
  'claude-code': 'Claude Code',
  'github-copilot': 'GitHub Copilot',
  copilot: 'GitHub Copilot',
});

/** The Harness answer for a record's harness. @param {{ name: string, version: string }} h */
export function harnessText(h) {
  const option = /** @type {Record<string, string>} */ (HARNESS_OPTION)[h.name];
  const label = option ?? `Other (${h.name})`;
  return h.version === 'unknown' ? label : `${label} ${h.version}`;
}

/**
 * The issue body for a record, from the record's own fields. This is the local, confidential text:
 * the generalizer's draft (core/lib/feedback/publish.mjs) replaces it before anything is published.
 * @param {Record<string, any>} r a valid feedback record
 * @returns {string}
 */
export function renderIssueBody(r) {
  const happened = [r.words, r.what_happened].filter(Boolean).join('\n\n');
  const evidence = r.evidence?.length ? `\`\`\`\n${r.evidence.join('\n')}\n\`\`\`` : EMPTY;
  const sections = [
    r.hitld_version,
    harnessText(r.harness),
    r.loop,
    happened,
    r.expected,
    evidence,
  ];
  return HEADINGS.map((h, i) => `### ${h}\n\n${sections[i] || EMPTY}\n`).join('\n');
}
