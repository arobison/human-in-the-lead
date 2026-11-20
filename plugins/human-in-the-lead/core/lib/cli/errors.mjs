// Every `error` code the `hitld` command can return (design part 16.2), each with its meaning.
//
// A failed command prints `{ "ok": false, "error": "<code>", "message": "<text>", ... }`. The code is
// the part scripts and agents match on: lowercase kebab-case, one code per meaning. The message is
// for people and may change. This map is the one list; the test in core/test/error-codes.test.mjs
// fails when a code in the source is not here or is not kebab-case, and the docs list these same
// names. A new code is a new entry here, with its meaning in one line.

/** Lowercase words joined by single hyphens. */
export const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** @type {Readonly<Record<string, string>>} */
export const ERROR_CODES = Object.freeze({
  // The command line itself
  usage:
    'The input is wrong: an unknown command, a missing or malformed argument, or a value out of range.',
  failed: 'The command stopped on an error it did not expect; the message says what.',
  'not-built': 'The command is in the table but is not built yet.',

  // Who may run it
  'not-permitted':
    'The caller may not run this command: an owner-only or orchestrator-only command run by an executor, or run outside the main session in the primary checkout.',
  'not-an-approver': 'The named person is not among policy feedback.approvers.',
  'not-a-decider': 'The named person is not among the deciders of that decision.',
  'not-owner-mode': 'The command is for merge.mode owner, and the project is not in it.',
  'not-a-dispatch':
    'The caller is not a live dispatched executor (HITLD_DISPATCH is unset, malformed or not live), so it may not use a secret task.',
  'task-not-granted': 'The dispatch role has no grant for that secret task.',

  // The project, its files and the run
  policy: 'policy.json is missing, invalid or not trusted.',
  settings: 'A settings file is invalid.',
  tracker: 'tracker.json is invalid.',
  'id-counter-unreachable':
    'A new ID is taken from the counter on the store repository, and it could not be reached or written; no ID was taken.',
  contract: 'The contract block in AGENTS.md could not be installed.',
  'not-a-repository': 'The working directory is not in a git repository.',
  'output-path':
    'The output directory is outside the repository and the private store, or the page would overwrite a file the report did not create.',
  'no-run': 'No orchestrator run has started; start one with hitld run start.',
  'no-eval-run': 'No stored eval run has that ID, or none is stored yet.',
  'invalid-eval-run': 'A stored eval run is not a valid eval result.',
  'setup-failed': "The worktree's setup commands failed.",
  'version-not-pinned':
    'This session runs another release of the plugin than the pin in .claude/settings.json names, so no run starts or resumes.',

  // The run lease and locks
  'lease-held': 'Another session holds the run lease.',
  'lease-lost': 'This session no longer holds the run lease: another session holds it.',
  'lease-host-mismatch':
    'This session holds the run lease, but on another host than the call gives; the lease is not lost.',
  'lease-released': 'This session released the run lease, so it can no longer record.',
  'lock-held': 'A named resource lock is held by someone else.',
  'lock-timeout': 'A named resource lock was not free before the wait ended.',

  // Ledger
  'invalid-event': 'The ledger event does not match its schema or lacks a field its kind needs.',
  'forbidden-event': 'The event kind is written only by the orchestrator, not by this caller.',
  'forbidden-field': 'The event carries a field this caller may not set.',
  'forbidden-correction': 'The correction would change an entry this caller may not correct.',
  'already-corrected':
    'The ledger event was already corrected; correct the event that corrected it, which now stands.',
  'no-estimate':
    'The dispatch carries no start estimate of its own (a follow-up): correct the earlier dispatch it reads its estimate from.',

  // Dispatch, handover and the merge queue
  'not-planned':
    'The item is not one the plan starts now (held, tier 0, no free slot, or not ready).',
  'disk-floor':
    "Free disk is below the machine file's disk_floor_mb, so no new work starts until space is freed.",
  'not-in-flight': 'The dispatch is not in flight.',
  'no-report-block':
    'An executor that reports by message (an interactive session) would get a brief without the communication block, because no session ID it could send its report to is known: pass --session or set HITLD_SESSION, or run in a harness that gives one.',
  'tokens-over-estimate':
    "The completion's token count is three times the dispatch's estimate or more; nothing was recorded. Give output plus fresh input (never cache reads), or confirm with --tokens-over-estimate.",
  'unknown-dispatch': 'The dispatch has no recorded harness reference, so it cannot be continued.',
  'still-running': 'The dispatch is still running; its completion notice comes first.',
  'handover-due': "This session's hand-over is due, so nothing new starts.",
  draining: 'Executors still report to this session, and no successor would hear of them.',
  cap: 'The maximum number of live executors is reached.',
  'merge-busy': 'The merge queue is held by another process.',
  'not-presented': 'The branch was not presented to the owner, or nothing has been presented yet.',
  'not-waiting': 'The branch is not waiting to merge.',
  stale: 'A presented branch changed after the owner saw it.',
  ambiguous:
    'The name matches more than one presented branch, or a branch other than the item was dispatched on.',
  'no-github-remote':
    'merge.via is pull-request, and the git remote merge.pull_request.remote names no GitHub repository.',

  // Decisions and precedents
  'invalid-question': 'The question does not match its schema or normalize.',
  'incomplete-question': 'The question does not stand alone; it lacks fields a decider needs.',
  'invalid-default':
    'The default if unanswered is not allowed here: not a two-way door, or not one of the options.',
  'invalid-decision': 'The decision record or answer is not valid.',
  'answer-matches-no-option':
    "The answer names none of the decision's options, or words that fit more than one; nothing was recorded.",
  'answer-question-changed':
    'The question the answer would apply to is not the one shown: its check code differs from the one given or last shown, the tracker item and the ask record disagree, or the device action it would apply is another; nothing was recorded.',
  'not-created': 'The tracker refused to create the decision item.',
  'not-a-decision': 'The ID names an item that is not a decision.',
  'not-open': 'The decision is not open.',
  'no-question-record': 'The question text is not recorded, so there is nothing to show.',
  'bad-narrowing': 'The precedent cannot be narrowed that way.',
  'invalid-precedent': 'The precedent does not match its schema.',
  'not-an-application':
    'The decision was not resolved by a precedent, so there is nothing to overrule.',
  'already-overruled': 'The decision was already overruled.',
  'no-precedent': 'The precedent is not in the store.',
  'invalid-exception': 'The exception it would add is not valid.',
  'sensitive-exception':
    'The exception is not derived from the reversed case and needs its own conditions.',
  'already-reversed': 'The call was already reversed.',
  'invalid-call': 'The logged call is empty or not valid.',
  'nothing-to-rate': 'No decision has been answered yet.',
  'not-found': 'The ID is not in the tracker or the store.',

  // Design walk-throughs
  'not-a-design':
    'The design has no questions section with Q<n> questions, or an open question lacks two options or a recommendation, or lists its recommendation after another option.',
  'already-decided': 'The design question is decided already; nothing was written.',
  'decision-not-for-question':
    "The decision is not the one filed for that design question: its title is not the question's; nothing was written.",
  'not-answered': 'The decision has no answer from the owner, so the question stays open.',
  'options-differ':
    "The decision offered a different number of options than the design question has, so the option picked cannot be named in the design's words.",
  'questions-open': 'Questions in the design wait for the owner, so it is not marked decided.',

  // Publishing tracker changes
  'main-changed':
    'The main branch changed a tracker file this session changed too, in a way this session has not seen; nothing was published.',
  'push-failed': 'The push of the new branch to the remote failed; nothing was published.',
  classification:
    "A file is above the repository's classification ceiling or holds the private store's address or device list; nothing was published.",

  // Feedback and the send gate
  'not-an-approval': 'The answer is not approve, edit or by-hand.',
  'not-approved': 'Only an approved publication from the send gate is sent.',
  'by-hand': 'The person posts this one themselves; nothing is sent.',
  'not-by-hand': 'The record was not approved by hand, so it takes no --url.',
  'not-an-issue': 'The URL is not an issue in the feedback repository.',
  'not-drafted': 'The record is not drafted, so it cannot be published.',
  'no-edits': 'The answer edit has no changed text.',
  'edits-need-edit': 'Changed text goes only with the answer edit.',
  'not-public': 'The edited draft holds material that is not public.',
  empty: 'The publication has no repository, title or body.',

  // Eval and baselines
  'no-scenarios': 'No scenario matches, or none is found.',
  'no-committed-baseline': 'The gate has no committed baseline to compare with.',
  'not-accepted': 'The run does not qualify as a baseline, or writing the baseline failed.',
  'no-commit': 'The run did not record the commit it ran on.',
  'dirty-tree': 'The run, or the checkout, has uncommitted changes.',
  'not-on-main': "The checkout is not on the main branch, or the run's commit is not on it.",

  // Releases
  'release-gates-open':
    'The release item for this version still needs an item or milestone that is not done or dropped.',
  'release-item-mismatch': 'The release item named is the release item for another version.',

  // Security and quarantine
  security: 'The security command stopped on an error; the message says what.',
  scanner: 'A scanner failed.',
  decision: 'The decision ID is not an answered owner decision that allows this.',
  quarantine: 'The quarantine file is invalid or the entry is refused.',
  'fix-item': 'The fix item is not an open work item in the tracker.',
  'already-quarantined': 'The test is already quarantined, and the entry has not expired.',
  'no-evidence': 'There is no recorded evidence that the test is flaky.',
  'fix-not-done': 'The fix item is not done and the entry has not expired.',

  // The private store
  'no-passphrase': 'No passphrase was given, or it is empty.',
  'no-identity': 'No age private key was given for a file that opens with one.',
  'no-recipients': 'No age public key was given to encrypt the export to.',
  'no-file': 'There is no export file at that path.',
  'age-header-invalid': 'The age header does not parse, or breaks a rule of the format.',
  'age-no-match': 'The header parses, but no key given opens it.',
  'age-mac-mismatch': 'A key opens the header, but its MAC is wrong: the header was changed.',
  'age-payload-invalid': 'The age payload does not decrypt and authenticate to its end.',
  'age-bad-recipient': 'An age public key does not parse, or cannot be used.',
  'age-bad-identity': 'An age private key does not parse.',
  'age-no-recipients': 'There is no age public key to encrypt to.',
  'age-no-identities': 'There is no age private key to decrypt with.',
  'bad-bech32': 'A Bech32 string, such as an age key, is malformed.',
  'bad-header': "The export file's header is not one this version reads.",
  'not-export': 'The file is not a hitld store export.',
  'unknown-format': 'The export format is not one this version reads.',
  'cannot-open':
    'The file does not open: the passphrase is wrong, or the file was changed or damaged.',
  damaged: 'The file is damaged.',
  'git-failed': 'A git command failed inside the store.',
  'bad-bundle': 'The bundle does not verify or does not match its manifest.',
  'bad-path': 'The export file is inside the store.',
  'another-project': 'The file is from another project.',
  'newer-schema': 'The file was written by a newer release; upgrade hitld first.',
  'store-changed': 'A file changed in the store during the import; nothing was merged.',
  conflict: 'The import stopped on a merge conflict; nothing was merged.',

  // The store remote
  'remote-moved': "The remote's head is not the one the push expected.",
  'remote-url-invalid': 'The remote URL is not one that is accepted.',
  'remote-unreachable': 'The remote cannot be reached.',
  'remote-version-missing': 'The remote no longer holds that version.',
  'remote-version-invalid': 'The version ID is not valid.',
  'remote-corrupt': 'What the remote holds does not match what was pushed.',
  'remote-too-large': 'The bytes are larger than the remote accepts.',
  'remote-argument-invalid': 'An argument to the remote is not valid.',
  'remote-dir-invalid': 'The local directory for the remote is not usable.',
  'remote-git-failed': 'A git command against the remote failed.',

  // Store devices
  'devices-fetch-failed':
    "The device requests on the store repository's hitld-devices branch could not be read.",
  'device-ask-refused':
    'A device decision could not be put to the owner: the tracker refused it, or the rules do not route it to the owner alone.',
  'device-name-invalid': 'A device name is not a short lower-case name.',
  'device-name-required': 'No device name was given and none could be made from the host name.',
  'device-name-taken': 'The device name is used by another key, approved or asking.',
  'device-unknown': 'No device the owner approved has that name.',
  'device-no-keychain': 'This machine has no OS keychain hitld can store the device key in.',
  'device-not-enrolled':
    'This device has no key, or the owner has not approved its key (or removed it), so it may not push.',

  // Pushing and pulling the store
  'no-remote':
    'No store address is set: set HITLD_STORE_REMOTE in a cloud environment, or run hitld store remote set <url> on a machine.',
  'nothing-to-push': 'The store holds no text to push yet.',
  'remote-not-format-2':
    "The remote's head is not an age file; nothing writes another format to a remote.",
  'remote-config-invalid': "This machine's override of the store's address is damaged.",
  'sync-state-invalid':
    'The file that records what this store last merged from the remote is damaged.',
  'store-pull-refused':
    'hitld run start or run resume stopped: the store remote answered, but its head does not open or merge. An unreachable remote does not stop a run; --no-sync goes on with the local store.',

  // The private term list
  'private-term':
    'The text holds a term from the private term list; the refusal names its kind and line, never the term.',
  'private-term-invalid':
    'A term is not one the private term list takes: too short or long, more than one line, or of an unknown kind.',
  'private-term-unknown': 'No term on the private term list has that ID or matches that term.',
  'private-list-invalid':
    'A line of the private term list does not read, so nothing is checked or committed until it is fixed.',

  // Secrets and the environment
  'secret-missing': 'No value is stored for a secret the task needs.',
  'spawn-failed': 'The task process could not start.',
  'task-undeclared': 'The task is not declared in policy.json env.secret_tasks.',
  'task-invalid': 'The declared task cannot run as written.',
  'worktree-mismatch': "The caller is not inside the dispatch's own worktree.",
  'project-unknown': 'HITLD_PROJECT_ID is not set or names no project.',
  'primary-unrecorded': 'No primary checkout is recorded for the project.',
  'primary-mismatch': 'The recorded primary checkout is not the one this process is in.',
});

/** An error that carries its design 16.2 code, so the command line prints it instead of `failed`. */
export class CodedError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'CodedError';
    this.code = code;
  }
}

/** @param {string} code */
export const isErrorCode = (code) => Object.hasOwn(ERROR_CODES, code);
