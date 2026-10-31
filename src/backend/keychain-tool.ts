// Runs one keychain call for a test inside Electron: macOS asks before one program reads an item another program saved, and the back end runs in Electron.
import { AsyncEntry, findCredentialsAsync } from '@napi-rs/keyring';

const [op, service, account, password = ''] = process.argv.slice(2);
const entry = () => new AsyncEntry(service, account);
const result =
  op === 'get'
    ? await entry().getPassword()
    : op === 'set'
      ? await entry().setPassword(password)
      : op === 'delete'
        ? await entry().deletePassword()
        : await findCredentialsAsync(service);
process.stdout.write(JSON.stringify(result ?? null));
