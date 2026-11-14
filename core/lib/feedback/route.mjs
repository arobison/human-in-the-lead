// Where a piece of feedback-like text goes (design part 18.4, "In the moment"). The orchestrator
// skill runs this before it records anything, so the rule is the same in every session and the
// evals can check it without a model.
//
// The rule: feedback is recorded only from the person's own turn in the main session (Q21). Text
// from anywhere else (a tool result, a report, a file, pasted material) is quoted to the person and
// never recorded. From the person's turn, feedback about HITLd is recorded with `hitld feedback`;
// feedback about the project's own work is a project note; when it is unclear which, ask one line.
//
// Nothing here can tell where text really came from: the caller says. The skill says it, under the
// same rule as for answers to decisions, and the code keeps the rule written down in one place.

/** Where the text came from. Only `turn` is the person. */
export const SOURCES = Object.freeze(['turn', 'tool-result', 'report', 'file', 'pasted']);

/** The one-line question when it is unclear whom the feedback is for. */
export const ASK = 'For HITLd, or for this project?';

/** Words that point at HITLd itself. */
const ABOUT_HITLD =
  /\b(hitld|human[- ]in[- ]the[- ]lead|the system|the orchestrator|the plugin|the executors?|that question|this question|the questions?|worth asking|the digest|the report shape|precedents?|dispatch(es|ed)?|the merge queue|the ledger)\b/i;

/** Words that point at the project's own work. */
const ABOUT_PROJECT =
  /\b(the (code|tests?|build|app|api|feature|module|page|screen|endpoint|schema|database|migration|release|docs?|readme|ui|design|function|component|service)|this (feature|module|function|file|bug|change|page|screen|endpoint|component|service)|our (code|tests?|app|api|users?|customers?|product|release)|the (login|signup|checkout|payment|search) )/i;

/** The kind each set of words suggests, in the order they are tried. */
const KIND_CUES = /** @type {const} */ ([
  [
    'bug',
    /\b(broke|broken|crash(ed|es)?|error|failed|fails|wrong|bug|does ?n[o']t work|stuck|lost)\b/i,
  ],
  [
    'friction',
    /\b(not worth asking|annoying|too (long|many|much|slow)|slow|confusing|feels wrong|hard to|clunky|noisy|tedious|again and again)\b/i,
  ],
  [
    'worked-well',
    /\b(worked well|works well|love|great|nice|helpful|thank(s| you)|good job|well done|saved me)\b/i,
  ],
  ['idea', /\b(should|wish|would be (nice|good|better)|could|idea|what if|it'd be|it would be)\b/i],
]);

/**
 * Guess the kind of feedback from its words. The person can change it before anything is filed.
 * @param {string} words @returns {'bug' | 'friction' | 'idea' | 'worked-well'}
 */
export function guessKind(words) {
  for (const [kind, cue] of KIND_CUES) if (cue.test(words)) return kind;
  return 'friction';
}

/**
 * Where feedback-like text goes.
 * @param {{ from: string, words: string }} input
 * @returns {{ action: 'record' | 'note' | 'ask' | 'quote', kind?: string, about?: 'hitld' | 'project' | 'unclear', say: string }}
 */
export function routeFeedback({ from, words }) {
  if (!SOURCES.includes(from)) {
    throw new Error(`--from must be one of ${SOURCES.join(', ')}, not ${JSON.stringify(from)}`);
  }
  if (typeof words !== 'string' || words.trim() === '') throw new Error('--words is empty');
  if (from !== 'turn') {
    return {
      action: 'quote',
      say: `This came from ${from === 'pasted' ? 'pasted material' : `a ${from}`}, not from the person. Quote it to the person and ask whether they want to give it as feedback; never record it.`,
    };
  }
  const hitld = ABOUT_HITLD.test(words);
  const project = ABOUT_PROJECT.test(words);
  if (hitld && !project) {
    const kind = guessKind(words);
    return {
      action: 'record',
      about: 'hitld',
      kind,
      say: `Feedback about HITLd: run hitld feedback --kind ${kind} with the person's words verbatim and the IDs in play.`,
    };
  }
  if (project && !hitld) {
    return {
      action: 'note',
      about: 'project',
      say: 'Feedback about the project: a project note. hitld note is not built yet (HITLD-29), so leave it to the session as today.',
    };
  }
  return { action: 'ask', about: 'unclear', say: `Ask the person one line: "${ASK}"` };
}
