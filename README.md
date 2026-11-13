# slop-term

SSH, SFTP and local shell client for Windows and macOS.

## Run the app

Close slop-term if it is running, then from the repo root:

```sh
pnpm install
pnpm install-app
```

This builds the app and copies it to your user's apps folder, replacing the previous copy:

- Windows: `%LOCALAPPDATA%\Programs\slop-term\`, with a Start menu shortcut named slop-term.
- macOS: `~/Applications/slop-term.app`, which Spotlight and Launchpad list.

Run `pnpm install-app` again after pulling changes.

To uninstall, delete the folder above. On Windows, also delete `%APPDATA%\Microsoft\Windows\Start Menu\Programs\slop-term.lnk`. Settings and sessions stay in `%APPDATA%\slop-term` or `~/Library/Application Support/slop-term`.

For development, `pnpm start` runs the app from source.
