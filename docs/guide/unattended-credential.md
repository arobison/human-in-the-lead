# The credential detached executors run on

A detached executor is a headless `claude -p` that `hitld` starts as a process of its own, so it outlives the orchestrator's turn (design HITLD-746). Nobody watches it. Started on your interactive sign-in, it runs until that sign-in ends, and Claude Code says the sign-in can end at any time before a fixed date that renewing it does not move. Overnight, the run would stop with no one to see it.

Unattended runs need a long-lived credential: the token `claude setup-token` makes. Once it is stored as this page says, the launcher reads it at each start and gives it to that one executor as `CLAUDE_CODE_OAUTH_TOKEN`. Without one, the launcher refuses to start the executor and says why.

`hitld install`, on the first install (your `hitld:setup` script) and on each upgrade, reports whether unattended runs here have one (`unattended_credential` in its result), and if not, lists these steps under `next`. `hitld env status` shows the credential executors run on at any time.

## In a Claude Code cloud session

A cloud session needs none of the steps below. It runs on its own sign-in, which the platform manages: the credential is added to the session's requests on their way out, so nothing in the session holds it, and there is no end date to watch. When `CLAUDE_CODE_REMOTE` is set and none of the credentials in the environment that the launcher accepts is (see What `hitld env status` says), the launcher starts executors on it and reports `kind: cloud-session`. `hitld install` and `hitld env status` report it as `managed_by: platform`, with no end date and no warning. If one of those credentials is set as well, the run uses that one instead.

## 1. Make the token, in your own terminal

Run this yourself, in a terminal outside any agent session:

```bash
claude setup-token
```

Never run it from inside an agent's chat or an agent's shell: its output reaches the agent's transcript. The token prints on two lines, and only one of them may be masked, so part of it would be in the transcript in the clear.

The token is one value. When it is printed on two lines, join them with no break between them before you store it. Storing only one of the lines is the usual mistake; the length check in step 3 catches it.

## 2. Store it

Keep it in your operating system's keychain, under the service name `claude-code-oauth-token`. Each command below asks for the value, so it never goes in your shell history.

| System | Store it | Where it is kept |
|---|---|---|
| macOS | `security add-generic-password -a "$USER" -s claude-code-oauth-token -w` | the login Keychain |
| Windows | `cmdkey /generic:claude-code-oauth-token /user:%USERNAME% /pass` | Credential Manager |
| Linux | `secret-tool store --label='Claude Code OAuth token' service claude-code-oauth-token account "$USER"` | the Secret Service, through libsecret (GNOME Keyring, KWallet) |

On a machine with no keychain (a server with no Secret Service, for example), keep it in a file in this machine's `hitld` directory instead, which sits beside the private stores and is never synced to the store repository: `$XDG_DATA_HOME/human-in-the-lead/_machine/credentials/claude-code-oauth-token`, or `~/.local/share/human-in-the-lead/_machine/credentials/claude-code-oauth-token` without `XDG_DATA_HOME`. Readable by you only; the launcher refuses a file others can read.

```bash
dir="${XDG_DATA_HOME:-$HOME/.local/share}/human-in-the-lead/_machine/credentials"
mkdir -p "$dir" && chmod 700 "$dir"
(umask 077 && read -rs -p 'token: ' t && printf '%s' "$t" > "$dir/claude-code-oauth-token"; unset t; echo)
```

Never keep it in the project, in a log, or in an environment file the project tracks, and never `export` it in a shell profile: every program you start would carry it.

## 3. Check it without printing it

A length check shows whether all of it was stored, without showing it:

| System | Check |
|---|---|
| macOS | `security find-generic-password -s claude-code-oauth-token -w \| tr -d '\n' \| wc -c` |
| Linux | `secret-tool lookup service claude-code-oauth-token \| tr -d '\n' \| wc -c` |
| any | `hitld env status`: `credential.length` |

Compare it with the length of the token `claude setup-token` printed. `hitld env status` also says when the stored value does not start with `sk-ant-oat`, as these tokens do.

## What `hitld env status` says

`credential` names what executors run on, never its value:

- `long_lived: true` with `kind: oauth-token` and `source` (`keychain`, `credential-manager`, `secret-service` or `machine-file`) and `length`: the stored token.
- `long_lived: true` with `source: environment` and the `variable`: a credential the environment already gives Claude Code (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, a `CLAUDE_CODE_OAUTH_TOKEN` a cloud environment sets, or a cloud provider such as `CLAUDE_CODE_USE_BEDROCK`). The launcher uses it as it is.
- `long_lived: true`, `kind: cloud-session`, `managed_by: platform`, `variable: CLAUDE_CODE_REMOTE`: a Claude Code cloud session's own sign-in, with none of the credentials above set. No end date, no warning.
- `long_lived: false`, `kind: interactive`: none was found, and a warning says to make the token before an overnight run. When a headless run here started on the sign-in, Claude Code warned on its standard error when the sign-in ends ("this sign-in ends between 2026-12-14 and 2026-12-20", "can end at any time from now until 2026-12-20", or "may have ended between ..."). `sign_in_ends` holds those dates (`earliest`, `latest`), the file it was read from, and where they stand now: `state` is `ahead` with `days_left` before the earliest, `any-day-now`, or `ended`.

## How the launcher uses it

At each start of a detached executor, the launcher reads the token into that executor's environment only, as `CLAUDE_CODE_OAUTH_TOKEN`. It is never on a command line, in the launcher's own environment or in any output of the launcher's; the keychain tools run with no shell, so nothing traces them, their errors are discarded, and one that does not answer within 10 seconds counts as finding nothing. The launcher prints only the credential's kind and source, and exits once the executor has started.

What it does not protect: the executor itself holds the token, and so can whatever it runs. Claude Code does not take the variable out of its tools' environment by default (only with `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` set, which on Linux needs bubblewrap), so a command the executor runs, such as `env`, can print it, and what it prints lands in the run's transcript in the private store (`dispatch/results/`). The executor's process environment can also be read by your other processes (`ps eww`), as any process's can. Where `hitld` shows text from a run, such as the reason a run stopped or the output of `hitld env exec`, it redacts anything shaped like an Anthropic token or key (`sk-ant-...`). Treat the transcripts in the private store as holding the token, and revoke it if one leaves the machine.

With no credential, the launcher starts nothing, exits 1, and says where it looked and these steps, never a value.

## When it ends mid-run

If the token is revoked, or a run started on the interactive sign-in loses it, the executor cannot report. `hitld dispatch reconcile` reads its output, finds the credential failure, and records the dispatch as `blocked` with the reason (`blocked_by: credential`). Store a working token, then continue it with `hitld dispatch follow-up`; its commits are kept on its branch.

## Undo

Delete the stored token: `security delete-generic-password -a "$USER" -s claude-code-oauth-token` (macOS), `cmdkey /delete:claude-code-oauth-token` (Windows), `secret-tool clear service claude-code-oauth-token` (Linux), or the file. Executors then refuse to start until a credential is stored again.
