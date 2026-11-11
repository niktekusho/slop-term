import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2';
import type { Listing } from '../shared/ipc.ts';

export const call = <T = void>(
  run: (done: (err: Error | null | undefined, value: T) => void) => void,
) =>
  new Promise<T>((resolve, reject) =>
    run((err, value) => (err ? reject(err) : resolve(value))),
  );

/** Rejects when the channel closes. A host that closes it mid-copy can leave fastPut's callback uncalled: ssh2 then sends a CLOSE no one answers. */
export function whenClosed(sftp: SFTPWrapper) {
  const closed = new Promise<never>((_, reject) =>
    sftp.once('close', () =>
      reject(new Error('The host closed the transfer channel.')),
    ),
  );
  closed.catch(() => {});
  return closed;
}

export const join = (folder: string, name: string) =>
  `${folder === '/' ? '' : folder}/${name}`;

// ponytail: setuid, setgid and sticky bits don't show.
function permissions(attrs: Stats) {
  const type = attrs.isDirectory() ? 'd' : attrs.isSymbolicLink() ? 'l' : '-';
  const bits = [...'rwxrwxrwx']
    .map((c, i) => (attrs.mode & (1 << (8 - i)) ? c : '-'))
    .join('');
  return type + bits;
}

const readdir = (sftp: SFTPWrapper, folder: string) =>
  call<FileEntryWithStats[]>((done) => sftp.readdir(folder, done));

/** Folder, file and link operations of the SFTP pane. Paths are absolute, except that `list` resolves a relative one from the home folder. */
export function sftpFiles(sftp: SFTPWrapper) {
  // Readdir reports a link itself: only a stat of its target tells a link to a folder. A broken link is a file.
  const isFolder = async (path: string, attrs: Stats) =>
    attrs.isDirectory() ||
    (attrs.isSymbolicLink() &&
      (await call<Stats>((done) => sftp.stat(path, done)).then(
        (s) => s.isDirectory(),
        () => false,
      )));

  async function measure(path: string, attrs: Stats) {
    if (!attrs.isDirectory()) return { files: 1, bytes: attrs.size };
    let files = 0;
    let bytes = 0;
    for (const entry of await readdir(sftp, path)) {
      const inside = await measure(join(path, entry.filename), entry.attrs);
      files += inside.files;
      bytes += inside.bytes;
    }
    return { files, bytes };
  }

  async function remove(path: string, attrs: Stats): Promise<void> {
    if (!attrs.isDirectory()) return call((done) => sftp.unlink(path, done));
    for (const entry of await readdir(sftp, path))
      await remove(join(path, entry.filename), entry.attrs);
    await call((done) => sftp.rmdir(path, done));
  }

  const lstat = (path: string) => call<Stats>((done) => sftp.lstat(path, done));

  return {
    async list(path = '.'): Promise<Listing> {
      const at = await call<string>((done) => sftp.realpath(path, done));
      const entries = await readdir(sftp, at);
      const files = await Promise.all(
        entries.map(async ({ filename, attrs }) => ({
          name: filename,
          folder: await isFolder(join(at, filename), attrs),
          size: attrs.size,
          modified: attrs.mtime * 1000,
          permissions: permissions(attrs),
        })),
      );
      return { path: at, files };
    },
    rename: (from: string, to: string) =>
      call((done) => sftp.rename(from, to, done)),
    makeFolder: (path: string) => call((done) => sftp.mkdir(path, done)),
    measure: (paths: string[]) =>
      Promise.all(paths.map(async (p) => measure(p, await lstat(p)))),
    async remove(paths: string[]) {
      for (const p of paths) await remove(p, await lstat(p));
    },
  };
}
