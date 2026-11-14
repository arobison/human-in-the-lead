# Security policy

## Reporting a vulnerability

Please report security problems privately, through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a vulnerability.

Include what you found, how to reproduce it, the HITLd version (`hitld --version`) and the harness you use. You will get an acknowledgement, and the fix and its disclosure are coordinated with you.

## What counts

HITLd runs agents with access to a repository, a private store and, through declared tasks, secrets. Reports are especially welcome for:

- a way for an executor, or text an agent reads (an issue, a fixture, a web page), to act as the owner: answer a decision, accept an eval baseline, merge, push, or change policy;
- a way for confidential material to reach a public repository or channel;
- a way around the guards, the send gate, the classification rules or the trusted loading of `policy.json`;
- secrets reaching a log, a report or the ledger.

The design's security model is in [part 10](docs/design/0001-human-in-the-lead/10-security.md).

## Supported versions

Before 1.0, only the latest release receives security fixes.
