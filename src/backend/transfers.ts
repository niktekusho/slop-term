import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SFTPWrapper, Stats } from 'ssh2';
import {
  unfinished,
  type BackendEvent,
  type ConflictChoice,
  type FileSide,
  type TabId,
  type Transfer,
} from '../shared/ipc.ts';
import { call, join } from './sftp.ts';

/**
 * `from` and `to` are the source and target paths, local or remote by direction. `abort` ends a running transfer.
 * `resolved` means its conflict check ran, so a retry goes to the target that check chose without asking again.
 */
type Item = {
  transfer: Transfer;
  from: string;
  to: string;
  resolved?: true;
  abort?(): void;
};
type Answer = { choice: ConflictChoice; all: boolean };
/** What a transfer copies, by path relative to its source with `/` between names. '' is the source itself. */
type Contents = { folders: string[]; files: { path: string; size: number }[] };

const progressMs = 200;

const remoteName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const localJoin = (base: string, rel: string) =>
  rel ? path.join(base, ...rel.split('/')) : base;
const remoteJoin = (base: string, rel: string) =>
  rel ? join(base, rel) : base;

/** `report (1).txt`: the number goes before a file's extension. */
function numbered(name: string, n: number, folder: boolean) {
  const dot = folder ? -1 : name.lastIndexOf('.');
  return dot > 0
    ? `${name.slice(0, dot)} (${n})${name.slice(dot)}`
    : `${name} (${n})`;
}

// ponytail: links and special files inside a folder are skipped; a link the user picked is followed.
async function localContents(source: string): Promise<Contents> {
  const top = await stat(source);
  if (!top.isDirectory())
    return { folders: [], files: [{ path: '', size: top.size }] };
  const contents: Contents = { folders: [''], files: [] };
  const entries = await readdir(source, {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    const full = path.join(entry.parentPath, entry.name);
    const rel = path.relative(source, full).split(path.sep).join('/');
    if (entry.isDirectory()) contents.folders.push(rel);
    else if (entry.isFile())
      contents.files.push({ path: rel, size: (await stat(full)).size });
  }
  // A parent comes before its subfolders, so each mkdir finds its parent.
  contents.folders.sort((a, b) => a.length - b.length);
  return contents;
}

async function remoteContents(
  sftp: SFTPWrapper,
  source: string,
): Promise<Contents> {
  const top = await call<Stats>((done) => sftp.stat(source, done));
  if (!top.isDirectory())
    return { folders: [], files: [{ path: '', size: top.size }] };
  const contents: Contents = { folders: [''], files: [] };
  const walk = async (rel: string): Promise<void> => {
    const entries = await call<{ filename: string; attrs: Stats }[]>((done) =>
      sftp.readdir(remoteJoin(source, rel), done),
    );
    for (const { filename, attrs } of entries) {
      const inside = rel ? `${rel}/${filename}` : filename;
      if (attrs.isDirectory()) {
        contents.folders.push(inside);
        await walk(inside);
      } else if (attrs.isFile())
        contents.files.push({ path: inside, size: attrs.size });
    }
  };
  await walk('');
  return contents;
}

/**
 * One Tab's transfer queue: one file at a time, each item on a new SFTP channel from `channel`.
 * A batch first asks about every target that exists, then transfers.
 */
export function createTransfers(
  tab: TabId,
  emit: (event: BackendEvent) => void,
  channel: () => Promise<SFTPWrapper>,
) {
  // Queued, running and failed items, which a cancel or retry finds by id.
  const items = new Map<string, Item>();
  const batches: Item[][] = [];
  let running = false;
  let answer: ((answer?: Answer) => void) | undefined;
  let nextId = 1;

  const update = (item: Item, patch: Partial<Transfer>) => {
    Object.assign(item.transfer, patch);
    if (item.transfer.state === 'done' || item.transfer.state === 'cancelled')
      items.delete(item.transfer.id);
    emit({ type: 'transfer', tab, transfer: { ...item.transfer } });
  };
  const failQueued = (batch: Item[], reason: string) => {
    for (const item of batch)
      if (item.transfer.state === 'queued')
        update(item, { state: 'failed', reason });
  };

  async function resolveConflicts(batch: Item[]) {
    const sftp = await channel();
    try {
      const remote = (p: string) => call<Stats>((done) => sftp.stat(p, done));
      const exists = (upload: boolean, p: string) =>
        (upload ? remote(p) : stat(p)).then(
          () => true,
          () => false,
        );
      const conflicts = [];
      for (const item of batch) {
        const upload = item.transfer.direction === 'upload';
        const target = await (upload ? remote(item.to) : stat(item.to)).catch(
          () => undefined,
        );
        if (!target) {
          item.resolved = true;
          continue;
        }
        const source = await (upload ? stat(item.from) : remote(item.from));
        const side = (s: typeof source): FileSide => ({
          size: s.size,
          modified: 'mtimeMs' in s ? s.mtimeMs : s.mtime * 1000,
        });
        const [local, host] = upload ? [source, target] : [target, source];
        conflicts.push({
          item,
          folder: target.isDirectory(),
          local: side(local),
          remote: side(host),
        });
      }
      let all: ConflictChoice | undefined;
      for (const [
        i,
        { item, folder, local, remote: host },
      ] of conflicts.entries()) {
        if (item.transfer.state !== 'queued') continue;
        const others = conflicts
          .slice(i + 1)
          .filter((c) => c.item.transfer.state === 'queued').length;
        let choice = all;
        if (!choice) {
          const got = await new Promise<Answer | undefined>((resolve) => {
            answer = resolve;
            emit({
              type: 'conflict',
              tab,
              conflict: {
                name: item.transfer.name,
                local,
                remote: host,
                others,
              },
            });
          });
          // A void question: the drop that voided it failed the items.
          if (!got) return;
          choice = got.choice;
          if (got.all) all = choice;
        }
        if (choice === 'skip') update(item, { state: 'cancelled' });
        else if (choice === 'keep') {
          const upload = item.transfer.direction === 'upload';
          const into = item.transfer.folder;
          let name = item.transfer.name;
          for (let n = 1; ; n++) {
            name = numbered(item.transfer.name, n, folder);
            item.to = upload ? join(into, name) : path.join(into, name);
            if (!(await exists(upload, item.to))) break;
          }
          update(item, { name, ...(!upload && { local: item.to }) });
        }
        item.resolved = true;
      }
    } finally {
      sftp.end();
    }
  }

  async function transfer(item: Item) {
    const started = Date.now();
    const upload = item.transfer.direction === 'upload';
    let sftp: SFTPWrapper | undefined;
    update(item, { state: 'running', bytes: 0, speed: 0, reason: undefined });
    try {
      sftp = await channel();
      const open = sftp;
      item.abort = () => open.end();
      // A host that closes the channel mid-copy can leave fastPut's callback uncalled: ssh2 then sends a CLOSE no one answers.
      const closed = new Promise<never>((_, reject) =>
        open.once('close', () =>
          reject(new Error('The host closed the transfer channel.')),
        ),
      );
      closed.catch(() => {});
      if (item.transfer.state !== 'running') return;
      const { folders, files } = await (upload
        ? localContents(item.from)
        : remoteContents(sftp, item.from));
      const total = files.reduce((sum, f) => sum + f.size, 0);
      update(item, { total });
      for (const folder of folders)
        if (upload)
          // An existing folder is merged into: a folder that really failed fails its first file.
          await call((done) =>
            open.mkdir(remoteJoin(item.to, folder), done),
          ).catch(() => {});
        else await mkdir(localJoin(item.to, folder), { recursive: true });
      let done = 0;
      let shown = 0;
      const speed = (bytes: number) =>
        Math.round(bytes / Math.max((Date.now() - started) / 1000, 0.001));
      for (const file of files) {
        const step = (sent: number) => {
          if (Date.now() - shown < progressMs) return;
          shown = Date.now();
          update(item, { bytes: done + sent, speed: speed(done + sent) });
        };
        await Promise.race([
          closed,
          call((cb) =>
            upload
              ? open.fastPut(
                  localJoin(item.from, file.path),
                  remoteJoin(item.to, file.path),
                  { step },
                  cb,
                )
              : open.fastGet(
                  remoteJoin(item.from, file.path),
                  localJoin(item.to, file.path),
                  { step },
                  cb,
                ),
          ),
        ]);
        done += file.size;
      }
      update(item, { state: 'done', bytes: done, speed: speed(done) });
    } catch (e) {
      // A cancel or a drop already set the state.
      if (item.transfer.state === 'running')
        update(item, { state: 'failed', reason: (e as Error).message });
    } finally {
      item.abort = undefined;
      sftp?.end();
    }
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      for (let batch; (batch = batches.shift()); ) {
        const unresolved = batch.filter((item) => !item.resolved);
        if (unresolved.length)
          await resolveConflicts(unresolved).catch((e: Error) =>
            failQueued(unresolved, e.message),
          );
        for (const item of batch)
          if (item.transfer.state === 'queued') await transfer(item);
      }
    } finally {
      running = false;
    }
  }

  return {
    enqueue(
      direction: Transfer['direction'],
      sources: string[],
      folder: string,
    ) {
      const batch = sources.map((from) => {
        const upload = direction === 'upload';
        const name = upload ? path.basename(from) : remoteName(from);
        const to = upload ? join(folder, name) : path.join(folder, name);
        const item: Item = {
          from,
          to,
          transfer: {
            id: String(nextId++),
            direction,
            name,
            folder,
            local: upload ? from : to,
            bytes: 0,
            total: 0,
            speed: 0,
            state: 'queued',
          },
        };
        items.set(item.transfer.id, item);
        update(item, {});
        return item;
      });
      batches.push(batch);
      void run();
    },

    cancel(id: string) {
      const item = items.get(id);
      if (!item || !unfinished(item.transfer)) return;
      update(item, { state: 'cancelled' });
      // ponytail: the partly written target stays.
      item.abort?.();
    },

    retry(id: string) {
      const item = items.get(id);
      if (item?.transfer.state !== 'failed') return;
      update(item, { state: 'queued', bytes: 0, speed: 0, reason: undefined });
      batches.push([item]);
      void run();
    },

    answer(choice: ConflictChoice, all: boolean) {
      if (!answer) return;
      answer({ choice, all });
      answer = undefined;
      emit({ type: 'conflict', tab });
    },

    /** Fails every queued and running item, which stays retryable, and voids an open conflict question. */
    fail(reason: string) {
      batches.length = 0;
      if (answer) {
        answer();
        answer = undefined;
        emit({ type: 'conflict', tab });
      }
      for (const item of items.values())
        if (unfinished(item.transfer)) {
          update(item, { state: 'failed', reason });
          item.abort?.();
        }
    },
  };
}
