# Moving the private store between machines and cloud sessions

For a project that you work on from more than one machine, or from cloud sessions whose containers are discarded when the session ends. Without a store remote, each machine keeps its own private store, and a cloud session starts with an empty ledger, an empty trust record and no calibration every time. Release tag: `v0.1.0-rc.1`. Read the [guide index](README.md) first if you have not: it says what `hitld` stands for in the commands below. The reasons for each choice are in [design 0003](../design/0003-private-store-remote.md).

## How it works

- **The store repository.** A private repository that you make, one for each project. It holds the store as encrypted files only. GitHub, and anyone with a token for that repository, cannot read the ledger, the trust record or a confidential decision.
- **Nothing about it in the project's repository.** The project's repository may be public. It never names the store repository, and it never lists the devices that can read the store. The address is in an environment variable or your own settings file, outside every repository.
- **Devices.** A device is a machine or a cloud environment that runs `hitld` for the project. Each has a key pair of its own. There is no shared password. Each pushed file is encrypted to every device you approved, and any of them opens it with its own private key.
- **You approve each device.** A new device asks: it puts its name and public key on the store repository's `hitld-devices` branch. That request counts for nothing by itself. A device you already approved turns it into a question for you, and only your own answer enrols the device. Your answer is kept inside the encrypted store, so every device learns it on its next pull. No default, no precedent and no agent ever answers it for you.
- **When it moves.** `hitld run start` and `hitld run resume` pull. `hitld run checkpoint`, `hitld handover` and `hitld merge` push. The plugin's session hooks pull at the start of a session and push at its end, in case a session dies between checkpoints. You do nothing by hand once it is set up. Every move and every key is handled by `hitld`; no agent runs a store command, reads a key or decides when to sync, and an executor is refused each of these commands.

## Before you start

- The project is set up as in one of the other guides, and `hitld check policy` is `ok`.
- The tracker has one open project for device questions to be filed under (`hitld work new --kind project`, on `main`). With more than one open project, give `--parent <project ID>` to the device commands below.
- Run every command on this page in the project's own checkout (not in a linked worktree), in your own terminal or the main session. They are refused in a worktree and to an executor.

## Steps

### 1. The store repository (yours)

1. **Make an empty private repository** for this project's store, for example `example-owner/sample-app-store` on GitHub. No README, no files. Do not protect its branches: pruning old files replaces the `hitld-store` branch, and each new device adds its request to the `hitld-devices` branch.
2. **Check that you can reach it** with the git sign-in you already use (a credential helper or an ssh key). `hitld` runs plain `git` against the address and takes no token of its own:

   ```bash
   git ls-remote https://github.com/example-owner/sample-app-store.git
   ```

3. **Give this machine the address.** On a local machine it goes in your person file (`~/.config/human-in-the-lead/person.json`), under the project's ID:

   ```bash
   hitld store remote set https://github.com/example-owner/sample-app-store.git
   ```

   The address is `https://host/owner/repo.git`, `ssh://git@host/owner/repo.git`, `git@host:owner/repo.git` or an absolute path. A password in it is refused (`remote-url-invalid`); sign in through git. `--machine` records it for this machine's store only instead. A cloud environment gets it from a variable (step 8).

   If you want every machine and session to warn when it has no address, set `"store": { "remote": { "required": true } }` in `policy.json`. That is the only store setting `policy.json` holds. A `store.remote.url` there is refused by `hitld check policy` and by the commit guard.

   The command also puts the address, the repository's `owner/name` and its name on the private term list, in the private store. From then on, a commit, a merge or `hitld publish check` refuses text that names them. Write "the store repository" instead. `hitld private list` shows what is on the list, masked; `hitld private remove <ID>` takes a term off, for example a repository name so common that it matches ordinary words.

### 2. This machine, as the first device

4. **Make its key, and let it ask.** The private key goes to the operating system's keychain (`security` on macOS, `secret-tool` on Linux, which needs a running Secret Service such as GNOME Keyring). It never goes on a command line or into a file. The request goes to the store repository:

   ```bash
   hitld store device init --name laptop
   ```

   `--name` takes lower-case letters, digits, `.`, `_` and `-`; the default is this machine's host name. The result shows `fingerprint`, a short form of the public key. Run again, it changes nothing. A machine with no keychain is refused (`device-no-keychain`): give it a key the way a cloud environment gets one (step 7), and set `HITLD_STORE_IDENTITY` in the environment of the shell that runs `hitld`.

   Because no device is approved yet and the store repository is empty, this first device asks you itself: the result has `decision`, with its ID and the question. The question names the device only by its fingerprint, since the decision is filed in the project's tracker.

5. **Answer it, yourself.** Check that the fingerprint in the question is the one `init` showed, then:

   ```bash
   hitld rights answer <decision ID> --answer A
   ```

   `A` enrols the device; `B` refuses it. The result's `device.event` is `approved`. In a session, give the answer in your own message; the session records it with this command. An answer that arrives in a file, a tool result or another session is not yours, and nothing applies one by default.

6. **Push the store for the first time:**

   ```bash
   hitld store push
   ```

   `result` is `pushed`, and `recipients` is 1. From now on a checkpoint does this for you. Before your answer, the push is refused (`device-not-enrolled`).

### 3. A cloud environment, as a device

One cloud environment is one device. Every session in that environment shares its key. Use your own personal environment.

7. **Make the key, on your own machine and not in a session.** `--cloud` writes nothing to disk or the keychain. It prints the private key once, in `identity`, keeps no copy, and puts the device's request on the store repository:

   ```bash
   hitld store device init --cloud --name cloud-main
   ```

   Copy the `identity` value (it starts with `AGE-SECRET-KEY-1`) straight to the next step, and note the `fingerprint`. Run this in a terminal that nothing records. Do not run it through an agent: the result would sit in the session's transcript.

   If `init --cloud` is run in a shell that already has `HITLD_STORE_IDENTITY` set (in the cloud session itself, say), it asks for that key and shows nothing secret.

8. **Set it in the environment.** In the cloud environment menu (in the session's title bar), choose Edit, and add two environment variables: `HITLD_STORE_IDENTITY`, whose value is that key, and `HITLD_STORE_REMOTE`, whose value is the store repository's address from step 3. Environment variables there are stored in plain text, visible to you, and read by every process in the container: see "What this protects" below. While you are there, check that Network access lets the container reach the store repository's host (`github.com` for GitHub). Start the session with the store repository attached as well as the project's, so the session's own git sign-in covers it. No new token is needed.

9. **Approve it.** On a device you already approved (this machine, or the session that drives the project), put the request to yourself:

   ```bash
   hitld store device ask
   ```

   Each waiting request becomes a decision in `asked`, with its question. Check that the fingerprint is the one from step 7, and answer it as in step 5. A request you do not recognise is one to refuse (`B`): anyone who can write the store repository can add one, and a refused key never asks again.

10. **Let an approved device push once more.** A pushed file is encrypted to the devices approved when it is pushed, so the file already on the remote cannot be opened by the new device. After your answer, `hitld store status` on the device you answered on shows `push_due: true`. Its next push seals the whole store to the new set of devices: `hitld run checkpoint` does it, the session-end hook does it, or run it yourself:

    ```bash
    hitld store push
    ```

    `result` is `pushed`, and `recipients` counts the new device. Nothing is pruned: only a removal prunes.

11. **Start a cloud session in that environment.** `hitld run start` or `hitld run resume` pulls the store first, rebuilds the run state from the ledger if the container has none, and takes the lease. The ledger, trust record, open decisions and your approvals are there.

## Check that it worked

On each device:

```bash
hitld store status
hitld store device list
```

`store status` should show:

- `remote.source`: `person` on a machine where you ran `hitld store remote set`, `environment` in a cloud environment (or `machine`, for an override), and the `url` you set (`hitld store remote show` prints the same);
- `device.enrolled`: `true`, and `device.recipients`: the number of devices you approved;
- `devices.requests`: requests not yet put to you, and `devices.decisions`: questions waiting for your answer, each with the command that answers it;
- `push_due` and `pull_due`: `false` once the device has synced. `pull_due: true` means the remote has something this device has not merged; run `hitld store pull`. `remote_error` is set, and `pull_due` is `null`, when the remote cannot be reached.

`store device list` shows the same devices, each marked `approved`, `requested` or `waiting-for-owner`, which one is this device, and `rotation.pending`.

Then a round trip. On a device that is already approved, record something and push; on the other device, pull:

```bash
hitld store push
hitld store pull
```

The pull reports `fast-forward` or `merged`, and `changed` lists the files. `up-to-date` means there was nothing new, and `empty` means nothing has been pushed yet.

If a pull is refused with `age-no-match`, the file on the remote was pushed before your approval of this device. Step 10 fixes it.

## When something is refused

| `error` | What it means | What to do |
|---|---|---|
| `device-not-enrolled` | You have not approved this device's key, or it has no key, or you removed it | Ask (step 4 or 7), approve (step 9), and let an approved device push (step 10) |
| `device-ask-refused` | A device question could not be filed: the tracker has no single open project, or the rules do not send it to you alone | Give `--parent <project ID>`, or read the message |
| `devices-fetch-failed` | The device requests on the store repository could not be read | Fix the connection to the store repository, then run it again |
| `age-no-match` | The remote's file was not encrypted to this device's key | If the device is new, an approved device must push once (step 10). A removed device sees this by design |
| `store-pull-refused` | `run start` or `run resume` pulled, and the remote's file does not open or merge | Read `cause` in the result. Fix it, or go on with the local store using `--no-sync` if you decide to |
| `lease-held` | The ledger shows another machine took the run's lease and never released it | See below |
| `nothing-to-push` | The store holds no text yet | Record something first: start a run, then checkpoint |
| `conflict` | The two stores changed the same file in ways that cannot merge | The result names the paths. Nothing was merged or pushed |
| `remote-unreachable` | The store repository cannot be reached | A run starts or resumes on the local store and says so. The next push carries the work |
| `remote-url-invalid` | The address is not `https`, `ssh`, a scp-style path or an absolute path, or it holds a password | Fix the address |
| `no-remote` | No address is set here | Step 3, or `HITLD_STORE_REMOTE` in a cloud environment |
| `device-no-keychain` | This machine has no keychain `hitld` can store a key in | Use step 7's way of making a key |
| `not-permitted` | An executor, or a linked worktree, ran a store command | Run it as yourself, in the primary checkout |

**`lease-held`.** The run lease is the lock across machines. When a pull shows that another machine took the lease and never released it, `hitld` refuses to start or resume, however old the lease is, because a dead session cannot be told from a working one. The message names the holder. The way on is the holder's `hitld handover`, which pushes after it releases the lease; or `hitld run retire --holder <session>` when you know that session is gone; or your own `--force` on `run resume` (`--replace` on `run start`).

## Removing a device

A removed device can open nothing that is pushed after you approve its removal. What it already pulled, it keeps: removal protects what comes after.

1. **Ask to remove it**, on a device that stays:

   ```bash
   hitld store device remove cloud-main
   ```

   The result has `decision`, a question for you like the one in step 5.

2. **Answer it** with `A`, as in step 5. `device.event` is `removed`.
3. **Push from a device that stays:**

   ```bash
   hitld store push
   ```

   This push is encrypted to the remaining devices only. It replaces the remote's head even with nothing new, and prunes every older file, because those were encrypted to the removed key. Each file holds the store's whole history, so nothing is lost. `rotation.rotated` in the result names the device, and `hitld store device list` shows no `rotation.pending` any more.
4. **Take the key away** so it cannot be used again: delete the `HITLD_STORE_IDENTITY` variable from the cloud environment, or delete the keychain entry on a machine (below).

**What rotation means here.** There is no shared secret to change on the other devices. Rotating means two things: the next push does not include the removed key, and the files that did are pruned. The storage provider removes unreachable objects on its own schedule, so pruning bounds the branch but does not erase at once. If a key leaked, treat everything that device could open until the removal as read.

**Making a new key for the same machine.** A removed or refused key never asks again, and `hitld store device init` uses the key that is in the keychain. To start with a new key, delete the entry first, then run `init`:

```bash
# macOS
security delete-generic-password -s hitld-store-sample-app -a device-identity
# Linux
secret-tool clear service hitld-store-sample-app account device-identity
```

The service name is `hitld-store-` and the project ID from `policy.json`.

## What this protects, and what it does not

- **The storage provider, and a leaked token for the store repository,** see ciphertext, the sizes of files, when they were pushed, file names that are only a sequence number and a hash, and the devices' requests (names and public keys). A token still lets someone delete or replace files. A replaced file fails to merge. A deletion loses data until another device pushes again.
- **Someone who can write the store repository, but holds no device key,** can add a request. It reaches you only as a question with a fingerprint, and nothing is encrypted to it unless you answer yes. They cannot write an approval: approvals are inside the encrypted store.
- **A process that holds an approved key can write the store, approvals included.** Your answer guards against the case above, not against a device you already approved. If you think a device's key leaked, remove it.
- **A stolen laptop:** remove the device. It keeps what it pulled.
- **A cloud device's key is an environment variable, and any process in that container can read it.** That includes every tool call a session makes. Encryption protects the store at the provider and keeps your devices apart from each other. It does not protect the store from a session that already holds a key. Inside a session, the network allowlist and least privilege are the defence, so keep the environment's allowed hosts short.
- **Use a personal environment.** Everyone who can use or edit an environment can read its variables. Do not put a device key in one that is shared with an organization.
- **An executor** cannot run a store command or answer a decision, and `hitld` never prints a private key except the one `init --cloud` prints to you.
- **The store's address and the devices' names stay out of public text.** They are on the private term list, which the commit hooks, the merge and `hitld publish check` check text against, and CI refuses a committed address or device list. A name nobody put on the list is not caught: add one with `hitld private add <term>`.

## Undo it

Each step has its own undo. None of them deletes a store on any machine.

- **Stop using the remote on this machine:** `hitld store remote clear` takes the address out of your person file (`--machine` removes this machine's override). In a cloud environment, delete the `HITLD_STORE_REMOTE` variable. With no address, the run commands and the hooks do nothing about the store, and say nothing, unless `policy.json` sets `store.remote.required`, when they say there is no address.
- **Remove a device:** the steps in "Removing a device", then delete its key.
- **Remove the keychain entry** of a local device with the command above, once its device is removed.
- **Delete the store repository** on GitHub. The stores on your machines stay as they are, and a new repository can be set up later with step 3, a first device and a push.
- **Delete a local store** only if you want its ledger gone for good: `~/.local/share/human-in-the-lead/<project ID>/`. With the remote set, the next pull on that machine restores it.

## A project that kept the address or the device list in its repository

An older setup put the address in `policy.json` as `store.remote.url`, and the device list in `.human-in-the-lead/store-devices.json`. Every `hitld` command now refuses that `policy.json`, `hitld check policy` refuses the device list, and the commit guard refuses both, each with a message saying where it goes. Move them:

1. On each machine, `hitld store remote set <url>`. In each cloud environment, add `HITLD_STORE_REMOTE`.
2. Remove `store.remote.url` from `policy.json` (keep `"required": true` if you want the warning).
3. On one device first, run `hitld store device init` (with `--cloud` for a cloud environment). It uses the key the device already has, merges the remote's head, finds no approval in it, and asks you itself. Answer, and let it push. Then run `hitld store device init` on each other device, and `hitld store device ask` on the first one. Answer each question.
4. `git rm .human-in-the-lead/store-devices.json`, commit both changes and merge them.

The project's git history still holds the old address and list. Rewriting history is your choice; `hitld` does not do it.
