# Can a KeePass database be a Credential provider?

Research for ticket `issues/19-keepass-provider.md`. Gathered 2026-10-20 on Windows 11 x64. Nothing was tested on macOS. No real database was opened. All tests used throwaway files in a scratch folder outside the repo.

## Summary

- Yes. There are two workable ways in: read the `.kdbx` file in-process with `kdbxweb`, or ask a running KeePassXC over its browser-integration protocol. `keepassxc-cli` and the KeePass 2 plugins are worse on every point that matters here.
- `kdbxweb` 2.1.1 (MIT) ran in Node 22 and in Electron 44.9.0 as Node. It created, read and rewrote a KDBX 4 file with Argon2id and a key file, and it read and rewrote a KDBX 3.1 file that `keepassxc-cli` 2.7.12 made. `keepassxc-cli` then read both files back with the changed passwords.
- `kdbxweb` costs slop-term two things. The app has to ask for the master password (and key file), which clashes with the "no cache" rule from ticket 08. And its XML dependency `@xmldom/xmldom` 0.7.x has open advisories, so the project needs an npm `overrides` pin to 0.8.15.
- The KeePassXC protocol never shows the master password to slop-term. KeePassXC does the unlock, including YubiKey, and asks the user to approve access. It can fetch an entry by UUID and update it by UUID. It only works with KeePassXC, the user has to turn on browser integration, and KeePassXC must be running.
- The entry UUID is a stable id. Both ways in expose it.
- Writing while KeePassXC has the file open is mostly safe, because KeePassXC watches the file and reloads or merges. A file-sync tool can still create conflict copies that nobody merges.

Recommendation: go through KeePassXC's browser protocol if the user's KeePass app is KeePassXC, which it is on this machine. Use `kdbxweb` only if the user wants slop-term to work without KeePassXC running. Details below.

## What is installed here

Found by listing `C:\Program Files`, `winget list`, the uninstall registry keys and `%APPDATA%`.

| App | Version | Where |
|---|---|---|
| KeePassXC | 2.7.12 (winget `KeePassXCTeam.KeePassXC`) | `C:\Program Files\KeePassXC`, with `KeePassXC.exe`, `keepassxc-cli.exe`, `keepassxc-proxy.exe` |
| KeeWeb | 1.18.6 (winget `KeeWeb.KeeWeb`, 1.18.7 available) | `C:\Program Files\KeeWeb`. KeeWeb is the app `kdbxweb` was written for. |

KeePass 2 (keepass.info) is not installed. Neither app was running. `keepassxc-cli` is not on `PATH`. `%APPDATA%\KeePassXC\keepassxc.ini` has no `[Browser]` section, so browser integration is off. It defaults to off.

## Way 1: read the file with kdbxweb

Package facts, from the npm registry and the [repo](https://github.com/keeweb/kdbxweb):

| Package | Version | Licence | Note |
|---|---|---|---|
| kdbxweb | 2.1.1, published 2021-09-06 | MIT | Last commit 2024-12-24, 15 open issues, not archived |
| @xmldom/xmldom | 0.7.13 by default | MIT | `npm audit` lists 15 advisories for `<=0.8.14`, some high |
| fflate | 0.7.5 | MIT | Compression |
| hash-wasm | 4.12.0 | MIT | Argon2 in WebAssembly, my choice for the test |

The README says it supports "Kdbx3 and Kdbx4". Argon2 "is not compiled into the library because there's no universal way to provide a fast implementation", so the app passes one in with `CryptoEngine.setArgon2Impl` ([README](https://github.com/keeweb/kdbxweb)). The bundled code accepts minor versions up to 4.1 when reading (`LastMinorVersions = {3: 1, 4: 1}` in `dist/kdbxweb.js`) and knows the 4.1 fields `Tags`, `QualityCheck` and `PreviousParentGroup`. I did not test a 4.1 file.

Test (`test.js` in the scratch folder), same results in Node 22.22.0 and Electron 44.9.0 with `ELECTRON_RUN_AS_NODE=1`:

| Step | Result |
|---|---|
| Create KDBX 4, Argon2id, password plus a random v2 key file | saved in 37 to 47 ms |
| Reload, find the entry by UUID, read user and password | pass, 8 ms load |
| Change the password with `pushHistory()`, save, reload | pass, one history item |
| Wrong master password | throws `KdbxError` with code `InvalidKey` |
| Open a KDBX 3.1 file made by `keepassxc-cli db-create`, change the password, save | pass |
| `keepassxc-cli show` on both files after the writes | shows the new passwords and the same UUIDs |

The test KDF settings were the library defaults, so a real database with a slower Argon2 setting will take longer to open.

The xmldom fix: with `"overrides": {"@xmldom/xmldom": "0.8.15"}` the same test passed and `npm audit` reported 0 vulnerabilities. With 0.9.12 `kdbxweb` fails on save with "errorHandler object is no longer supported, switch to onError!". So 0.8.x is the ceiling until `kdbxweb` changes. The XML is only parsed after decryption, so an attacker would need a database the user can unlock.

How unlocking works with this way in:

- Master password and key file: supported, tested.
- Windows user account: this is KeePass 2 only. It ties the key to the user's DPAPI keys, and the database can't be opened from another account or after the account is deleted ([keepass.info keys](https://keepass.info/help/base/keys.html)). `kdbxweb` has no support for it.
- YubiKey challenge-response (KeePassXC, KeeWeb): `Credentials` takes a `challengeResponseFunction` ([README](https://github.com/keeweb/kdbxweb)), but slop-term would have to talk to the YubiKey itself through a native USB library. Not tested.

The cost for slop-term: the app holds the master password. Ticket 08 says the app reads secrets on every connect and caches nothing. That leaves three choices. The app can ask for the master password on every connect, which is tedious. It can store the master password in the OS keychain, as it does for the TPM HMAC keys, which lowers the database's protection to the keychain's. Or it can keep the opened database in memory for the session, which breaks the "no cache" rule.

## Way 2: KeePassXC browser protocol

The protocol is documented in [keepassxc-protocol.md](https://github.com/keepassxreboot/keepassxc-browser/blob/develop/keepassxc-protocol.md). I read the KeePassXC 2.7.12 source for the details the document leaves out. Nothing here was tested, because browser integration is off on this machine and I did not change the user's KeePassXC settings.

Transport. `keepassxc-proxy` is a small native-messaging host that forwards to a local socket in KeePassXC. slop-term can connect to that socket directly. On Windows the name is `org.keepassxc.KeePassXC.BrowserServer_<USERNAME>`, a named pipe. On macOS it is `org.keepassxc.KeePassXC.BrowserServer` in the user's temp folder (`getLocalServerPath` in [BrowserShared.cpp](https://github.com/keepassxreboot/keepassxc/blob/2.7.12/src/browser/BrowserShared.cpp)). Messages are JSON, encrypted with a NaCl box (`tweetnacl`, 1.0.3, Unlicense, works for this). [git-credential-keepassxc](https://github.com/Frederick888/git-credential-keepassxc) (GPL-3) is a non-browser client that uses the same protocol, so the approach has a working precedent.

Actions that matter, from `handleAction` in [BrowserAction.cpp](https://github.com/keepassxreboot/keepassxc/blob/2.7.12/src/browser/BrowserAction.cpp) and [BrowserService.cpp](https://github.com/keepassxreboot/keepassxc/blob/2.7.12/src/browser/BrowserService.cpp):

- `associate` happens once. KeePassXC shows "New key association request" and the user names the client and clicks "Save and allow access". The key is stored in the database's metadata, so it travels with the file.
- `test-associate` checks the stored association on each connect.
- `get-logins` searches by URL, but `shouldIncludeEntry` also accepts `keepassxc://by-uuid/<hex uuid>` and `keepassxc://by-path/<path>`. Each returned entry has `uuid`, `login`, `password`, `name` and `group`. The first time a client asks for an entry, KeePassXC shows an access-control dialog unless "Always allow access" is on.
- `set-login` with an empty `uuid` creates an entry. With a `uuid` it updates that entry. KeePassXC asks "Update Entry" (Cancel is the default) unless "Always allow updating" is on.
- `delete-entry` exists.
- Locked database: every request can carry `triggerUnlock`. KeePassXC then raises its window and shows the unlock dialog. If the database stays locked the reply is `ERROR_KEEPASS_DATABASE_NOT_OPENED`.

What this means for slop-term:

- slop-term never sees the master password, key file or YubiKey. KeePassXC handles every unlock method it supports.
- Read, write and delete all exist, and the KeePassXC dialogs give the user a confirmation step on writes.
- Writes go through KeePassXC itself, so there is no file conflict with the open app.
- Every read needs KeePassXC running with the right database unlocked. A closed KeePassXC is a read failure with a reason ("KeePassXC isn't running"), which ticket 08 point 5 already covers.
- It works with KeePassXC only, on Windows, macOS and Linux. It does not work with KeePass 2 or KeeWeb.
- KeePassXC is GPL-2 or GPL-3 ([COPYING](https://github.com/keepassxreboot/keepassxc/blob/2.7.12/COPYING)). Talking to it over a socket does not put slop-term under the GPL.

Not checked: the exact byte framing on the socket, and how KeePassXC picks a database when several are open. The protocol document and git-credential-keepassxc are the place to confirm both before building.

## Rejected ways in

`keepassxc-cli`. It opens the file itself and does not talk to the running GUI. Every call needs the master password on stdin, plus `-k` for a key file or `-y slot[:serial]` for a YubiKey (`keepassxc-cli show --help`). So it has the same master-password problem as `kdbxweb`, adds a process spawn per read, and needs KeePassXC installed. Its only gain is YubiKey support without a native library in slop-term. Its paths are `C:\Program Files\KeePassXC\keepassxc-cli.exe` and, on macOS, inside `KeePassXC.app`. One oddity: `db-create` made KDBX 3.1 with the AES KDF here, even with `-t 300`.

KeePassHttp. KeePassXC deprecated it in 2.3.0 and removed it in 2.4.0 (2019-03-19) ([CHANGELOG](https://github.com/keepassxreboot/keepassxc/blob/2.7.12/CHANGELOG.md)). The [plugin repo](https://github.com/pfn/keepasshttp) (GPL-3) was last pushed 2023-01-21 and has 209 open issues.

KeePassRPC. It is a KeePass 2 plugin for the Kee browser add-on. It runs a local WebSocket server (Fleck2, in `KeePassRPCServer.cs`) ([repo](https://github.com/kee-org/keepassrpc), GPL-2). The latest release is v2.0.2 from 2024-06-12. KeePass 2 is a .NET app that runs on macOS only through Mono ([keepass.info setup](https://keepass.info/help/v2/setup.html)). KeePass 2 isn't installed here, so this way in has no user today.

## Stable entry id

Every KDBX entry has a 16-byte UUID that survives renames, moves between groups and edits. The same entry shows up in three spellings:

- `kdbxweb`: `entry.uuid.id`, base64, for example `BbLM0Qq8RpWy9KwgsqV2pA==`.
- `keepassxc-cli show`: `{05b2ccd1-0abc-4695-b2f4-ac20b2a576a4}`.
- Browser protocol: 32 hex digits without dashes (`entry->uuidToHex()`).

The test confirmed these are the same bytes. A Credential reference could be `{provider: "keepass", entry: "<32 hex digits>", kind}`. With `kdbxweb` the reference also needs to say which file. The per-machine `settings.json` can hold the path, as it holds the TPM base URL, because the path differs between Windows and macOS. With the browser protocol, KeePassXC answers from the open database, and `get-databasehash` can confirm it is the expected one.

## Writing while the file is open, and file sync

KeePassXC watches its database file. `AutoReloadOnChange` defaults to true, and `UseAtomicSaves` defaults to true ([Config.cpp](https://github.com/keepassxreboot/keepassxc/blob/2.7.12/src/core/Config.cpp)). On an outside change it reopens the file. If the file hash changed, `reloadDatabaseFile` can merge its own unsaved changes into the new file with its `Merger`. It skips the reload while the user is editing an entry or group, and retries on the next save ([DatabaseWidget.cpp](https://github.com/keepassxreboot/keepassxc/blob/2.7.12/src/gui/DatabaseWidget.cpp)). KeePass 2 checks on Save whether the file changed and offers to overwrite or synchronize. It merges per entry by last modification time and keeps the losing version as history ([keepass.info sync](https://keepass.info/help/v2/sync.html)).

So a `kdbxweb` write is safe enough if slop-term does three things: reload the file right before the write, keep the entry's UUID and push the old version to history, and save to a temp file then rename it over the original. `kdbxweb` also has `db.merge(remoteDb)`. Its README warns that history merges correctly "only with one central replica". I did not test a write while KeePassXC had the file open.

A file-sync tool (OneDrive, Dropbox, Syncthing) is the larger risk. If two machines save before the tool syncs, the tool keeps one file and writes the other as a conflict copy. Neither KeePassXC nor `kdbxweb` merges those copies on their own. The browser-protocol way avoids this from slop-term's side, because the write goes through KeePassXC like any edit the user makes there.

## Licences

| Piece | Licence |
|---|---|
| kdbxweb, @xmldom/xmldom, fflate, hash-wasm | MIT |
| tweetnacl | Unlicense |
| KeePassXC | GPL-2 or GPL-3. Used over a socket, not linked. |
| KeePassRPC | GPL-2 |
| KeePassHttp | GPL-3 |
| git-credential-keepassxc | GPL-3. Read as a reference, don't copy code. |
