# Moving the private store between machines and cloud sessions

For a project that you work on from more than one machine, or from cloud sessions whose containers are discarded when the session ends. Without a store remote, each machine keeps its own private store, and a cloud session starts with an empty ledger, an empty trust record and no calibration every time. Release tag: `v0.1.0-rc.1`. Read the [guide index](README.md) first if you have not: it says what `hitld` stands for in the commands below. The reasons for each choice are in [design 0003](../design/0003-private-store-remote.md).

## How it works

- **The store repository.** A private repository that you make, one for each project. It holds the store as encrypted files only. GitHub, and anyone with a token for that repository, cannot read the ledger, the trust record or a confidential decision.
- **Devices.** A device is a machine or a cloud environment that runs `hitld` for the project. Each has a key pair of its own. There is no shared password. Each pushed file is encrypted to every enrolled device, and any of them opens it with its own private key.
- **The device list.** `.human-in-the-lead/store-devices.json` in the project's repository holds each device's name and public key (safe to commit). A device is enrolled when its entry is on `main`, which happens only through your merge. A device that is not on `main`'s list cannot push.
- **When it moves.** `hitld run start` and `hitld run resume` pull. `hitld run checkpoint`, `hitld handover` and `hitld merge` push. The plugin's session hooks pull at the start of a session and push at its end, in case a session dies between checkpoints. You do nothing by hand once it is set up. Every move and every key is handled by `hitld`; no agent runs a store command, reads a key or decides when to sync, and an executor is refused each of these commands.

## Before you start

- The project is set up as in one of the other guides, and `hitld check policy` is `ok`.
- Its repository has a remote named `origin`, and `main` is on it. The push reads the device list from `origin/main`, so that a removed device is never sealed to.
- Run every command on this page in the project's own checkout (not in a linked worktree), in your own terminal or the main session. They are refused in a worktree and to an executor.

## Steps

### 1. The store repository (yours)

1. **Make an empty private repository** for this project's store, for example `example-owner/sample-app-store` on GitHub. No README, no files. Do not protect its branches against force pushes: pruning old files replaces the `hitld-store` branch.
2. **Check that you can reach it** with the git sign-in you already use (a credential helper or an ssh key). `hitld` runs plain `git` against the address and takes no token of its own:

   ```bash
   git ls-remote https://github.com/example-owner/sample-app-store.git
   ```

3. **Put the address in the project.** This writes `store.remote.url` into `.human-in-the-lead/policy.json`, which is what a fresh cloud container reads:

   ```bash
   hitld store remote set https://github.com/example-owner/sample-app-store.git --policy
   git diff .human-in-the-lead/policy.json
   ```

   The address is `https://host/owner/repo.git`, `ssh://git@host/owner/repo.git`, `git@host:owner/repo.git` or an absolute path. A password in it is refused (`remote-url-invalid`); sign in through git. Without `--policy` the address is recorded for this machine only, and the result prints the change to commit if a cloud session is to find it too.

   Commit `policy.json` with the next step's device list, so both reach `main` in one merge.

### 2. This machine, as a device

4. **Make its key.** The private key goes to the operating system's keychain (`security` on macOS, `secret-tool` on Linux, which needs a running Secret Service such as GNOME Keyring). It never goes on a command line or into a file. The public key is added to the device list:

   ```bash
   hitld store device init --name laptop
   ```

   `--name` takes lower-case letters, digits, `.`, `_` and `-`; the default is this machine's host name. Run again, it changes nothing. A machine with no keychain is refused (`device-no-keychain`): give it a key the way a cloud environment gets one (step 7), and set `HITLD_STORE_IDENTITY` in the environment of the shell that runs `hitld`.

5. **Commit and merge.** Commit the device list, and `policy.json` from step 3, and have them reach `main` through your own merge. That merge is the approval:

   ```bash
   git switch -c hitld/store-remote
   git add .human-in-the-lead/store-devices.json .human-in-the-lead/policy.json
   git commit -m "Enrol the laptop and set the store remote"
   ```

   Open and merge the pull request yourself, on GitHub or with git, as you do for any change of your own. Do not send it through the merge queue: the queue sends back any branch that changes the device list, so an agent's branch cannot enrol or remove a device.

6. **Push the store for the first time**, once the merge is on `main`:

   ```bash
   hitld store push
   ```

   `result` is `pushed`. From now on a checkpoint does this for you. A store that holds nothing yet, because no run has recorded anything here, is refused with `nothing-to-push`: start a run (`hitld run start`, which pulls an empty remote) and push at its first checkpoint (`hitld run checkpoint`) instead.

### 3. A cloud environment, as a device

One cloud environment is one device. Every session in that environment shares its key. Use your own personal environment.

7. **Make the key, on your own machine and not in a session.** `--cloud` writes nothing to disk or the keychain. It prints the private key once, in `identity`, and keeps no copy:

   ```bash
   hitld store device init --cloud --name cloud-main
   ```

   Copy the `identity` value (it starts with `AGE-SECRET-KEY-1`) straight to the next step. Run this in a terminal that nothing records. Do not run it through an agent: the result would sit in the session's transcript.

8. **Set it in the environment.** In the cloud environment menu (in the session's title bar), choose Edit, and add an environment variable named `HITLD_STORE_IDENTITY` whose value is that key. Environment variables there are stored in plain text, visible to you, and read by every process in the container: see "What this protects" below. While you are there, check that Network access lets the container reach the store repository's host (`github.com` for GitHub). Start the session with the store repository attached as well as the project's, so the session's own git sign-in covers it. No new token is needed.

   If `init --cloud` is run in a shell that already has `HITLD_STORE_IDENTITY` set, it enrols that key and shows nothing secret.

9. **Enrol it.** The command in step 7 added the device to `.human-in-the-lead/store-devices.json`. Commit that file and have it reach `main` through your merge, as in step 5.

10. **Let an enrolled device push once more.** A pushed file is encrypted to the devices on `main`'s list when it is pushed, so the file already on the remote cannot be opened by the new device. After the enrolment reaches `main`, `hitld store status` on a device that is already enrolled shows `push_due: true` with `push_reason: recipients-changed`, even though nothing new is in its store. The next push by any enrolled device seals the whole store to the new list: `hitld run checkpoint` does it, the session-end hook does it, or run it yourself:

    ```bash
    hitld store push
    ```

    `result` is `pushed`, and `recipients` counts the new device. Nothing is pruned: only a removal prunes.

11. **Start a cloud session in that environment.** `hitld run start` or `hitld run resume` pulls the store first, rebuilds the run state from the ledger if the container has none, and takes the lease. The ledger, trust record and open decisions are there.

## Check that it worked

On each device:

```bash
hitld store status
hitld store device list
```

`store status` should show:

- `remote.source`: `policy` (or `machine`, if you set an override), and the `url` you set (`hitld store remote show` prints the same);
- `device.enrolled`: `true`, and `device.recipients`: the number of devices on `main`;
- `push_due` and `pull_due`: `false` once the device has synced. `pull_due: true` means the remote has something this device has not merged; run `hitld store pull`. `remote_error` is set, and `pull_due` is `null`, when the remote cannot be reached.

`store device list` shows the devices on `main`, which one is this device, any change in your working tree that is not on `main` yet, and `rotation.pending`.

Then a round trip. On the machine that is already enrolled, record something and push; on the other device, pull:

```bash
hitld store push
hitld store pull
```

The pull reports `fast-forward` or `merged`, and `changed` lists the files. `up-to-date` means there was nothing new, and `empty` means nothing has been pushed yet.

If a pull is refused with `age-no-match`, the file on the remote was pushed before this device's enrolment reached `main`. Step 10 fixes it: `hitld store status` on an enrolled device shows `push_reason: recipients-changed` until it has pushed.

## When something is refused

| `error` | What it means | What to do |
|---|---|---|
| `device-not-enrolled` | This device's key is not on `main`'s device list, or it has no key | Enrol it (step 4 or 7), merge, and push again |
| `devices-fetch-failed` | A push could not fetch `main` from `origin` to read the list | Fix the connection to the project's repository, then push again. Nothing was pushed |
| `age-no-match` | The remote's file was not encrypted to this device's key | If the device is new, an enrolled device must push once (step 10). A removed device sees this by design |
| `store-pull-refused` | `run start` or `run resume` pulled, and the remote's file does not open or merge | Read `cause` in the result. Fix it, or go on with the local store using `--no-sync` if you decide to |
| `lease-held` | The ledger shows another machine took the run's lease and never released it | See below |
| `nothing-to-push` | The store holds no text yet | Record something first: start a run, then checkpoint |
| `conflict` | The two stores changed the same file in ways that cannot merge | The result names the paths. Nothing was merged or pushed |
| `remote-unreachable` | The store repository cannot be reached | A run starts or resumes on the local store and says so. The next push carries the work |
| `remote-url-invalid` | The address is not `https`, `ssh`, a scp-style path or an absolute path, or it holds a password | Fix the address |
| `device-no-keychain` | This machine has no keychain `hitld` can store a key in | Use step 7's way of making a key |
| `not-permitted` | An executor, or a linked worktree, ran a store command | Run it as yourself, in the primary checkout |

**`lease-held`.** The run lease is the lock across machines. When a pull shows that another machine took the lease and never released it, `hitld` refuses to start or resume, however old the lease is, because a dead session cannot be told from a working one. The message names the holder. The way on is the holder's `hitld handover`, which pushes after it releases the lease; or `hitld run retire --holder <session>` when you know that session is gone; or your own `--force` on `run resume` (`--replace` on `run start`).

## Removing a device

A removed device can open nothing that is pushed after its removal reaches `main`. What it already pulled, it keeps: removal protects what comes after.

1. **Remove it from the list:**

   ```bash
   hitld store device remove cloud-main
   ```

   The result says `rotation: pending`.

2. **Commit `.human-in-the-lead/store-devices.json` and merge it,** as in step 5.
3. **Push from a device that is still enrolled:**

   ```bash
   hitld store push
   ```

   This push is encrypted to the remaining devices only. It replaces the remote's head even with nothing new, and prunes every older file, because those were encrypted to the removed key. Each file holds the store's whole history, so nothing is lost. `rotation.rotated` in the result names the device, and `hitld store device list` shows no `rotation.pending` any more.
4. **Take the key away** so it cannot be used again: delete the `HITLD_STORE_IDENTITY` variable from the cloud environment, or delete the keychain entry on a machine (below).

**What rotation means here.** There is no shared secret to change on the other devices. Rotating means two things: the next push does not include the removed key, and the files that did are pruned. The storage provider removes unreachable objects on its own schedule, so pruning bounds the branch but does not erase at once. If a key leaked, treat everything that device could open until the removal as read.

**Making a new key for the same machine.** Removing a device does not remove its key from the keychain, and `hitld store device init` re-enrols the key that is there. To start with a new key, delete the entry first, then run `init`:

```bash
# macOS
security delete-generic-password -s hitld-store-sample-app -a device-identity
# Linux
secret-tool clear service hitld-store-sample-app account device-identity
```

The service name is `hitld-store-` and the project ID from `policy.json`.

## What this protects, and what it does not

- **The storage provider, and a leaked token for the store repository,** see ciphertext, the sizes of files, when they were pushed, and file names that are only a sequence number and a hash. A token still lets someone delete or replace files. A replaced file fails to merge. A deletion loses data until another device pushes again.
- **A stolen laptop:** remove the device. It keeps what it pulled.
- **A cloud device's key is an environment variable, and any process in that container can read it.** That includes every tool call a session makes. Encryption protects the store at the provider and keeps your devices apart from each other. It does not protect the store from a session that already holds a key. Inside a session, the network allowlist and least privilege are the defence, so keep the environment's allowed hosts short.
- **Use a personal environment.** Everyone who can use or edit an environment can read its variables. Do not put a device key in one that is shared with an organization.
- **An executor** cannot run a store command, and `hitld` never prints a private key except the one `init --cloud` prints to you.

## Undo it

Each step has its own undo. None of them deletes a store on any machine.

- **Stop using the remote on this machine:** `hitld store remote clear` removes this machine's override. If the address is in `policy.json`, revert the commit that added it, or remove `store.remote` from the file and commit that. With no address, the run commands and the hooks do nothing about the store, and say nothing.
- **Remove a device:** the steps in "Removing a device", then delete its key.
- **Remove the keychain entry** of a local device with the command above, once its device is removed.
- **Take back the device list and the address entirely:** `git revert` the commits from steps 3 and 5.
- **Delete the store repository** on GitHub. The stores on your machines stay as they are, and a new repository can be set up later with step 3 and a push.
- **Delete a local store** only if you want its ledger gone for good: `~/.local/share/human-in-the-lead/<project ID>/`. With the remote set, the next pull on that machine restores it.
