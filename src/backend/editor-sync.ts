import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SFTPWrapper, Stats } from 'ssh2';
import type {
  BackendEvent,
  EditorQuestion,
  Settings,
  TabId,
  Transfer,
  UnsentEdit,
} from '../shared/ipc.ts';
import { openInEditor } from './editor.ts';
import { call, whenClosed } from './sftp.ts';

/**
 * `sent` is the SHA-256 of the content the remote file had at the last download or upload:
 * a local copy with another hash has a save to upload. `approved` is a yes to "upload?" that a drop held back.
 */
type Edit = {
  transfer: Transfer;
  remote: string;
  file: string;
  sent?: string;
  /** Size and modified time (s) of the remote file at the last download or upload, which a file over `hashLimit` compares. */
  base?: { size: number; mtime: number };
  approved?: true;
  watcher?: FSWatcher;
};

const progressMs = 200;
const hashLimit = 10 * 1024 * 1024;
const chunkBytes = 32 * 1024;
// Editors save in several writes, or by writing a temp file and renaming it over the copy.
const settleMs = 300;
// One count for every Tab's sync: a local shell Tab has one per host its pane reached, and their rows share one list.
let nextId = 1;

const sha256 = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');
const remoteName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const baseOf = (stats: Stats) => ({ size: stats.size, mtime: stats.mtime });

const removeCopy = (dir: string) =>
  Promise.all([
    rm(dir, { recursive: true, force: true }),
    rm(`${dir}.json`, { force: true }),
  ]);

/** What a copy's `<folder>.json`, beside its folder, records for the startup check. */
type Manifest = { alias: string; remote: string; sent: string };

/**
 * Lists the copies in `root` whose content differs from what last reached the host, and deletes the others.
 * A folder without a manifest never finished its download; a manifest without a folder outlived its Tab.
 */
export async function recoverEdits(root: string): Promise<UnsentEdit[]> {
  const unsent: UnsentEdit[] = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (!entry.isDirectory()) {
      if (!entries.some((e) => `${e.name}.json` === entry.name))
        await rm(full, { force: true });
      continue;
    }
    const manifest = await readFile(`${full}.json`, 'utf8')
      .then((text) => JSON.parse(text) as Manifest)
      .catch(() => undefined);
    const file = manifest && path.join(full, remoteName(manifest.remote));
    const local = file && (await readFile(file).catch(() => undefined));
    if (manifest && file && local && sha256(local) !== manifest.sent)
      unsent.push({ alias: manifest.alias, remote: manifest.remote, file });
    else await removeCopy(full);
  }
  return unsent;
}

/** One Tab's editor-sync files. Copies live in `root`, one folder each; each step runs on a new SFTP channel from `channel`. */
export function createEditorSync(
  tab: TabId,
  emit: (event: BackendEvent) => void,
  channel: () => Promise<SFTPWrapper>,
  root: string,
  settings: () => Promise<Settings>,
  alias: () => string,
) {
  const edits = new Map<string, Edit>();
  // A drop or a close resolves the open question to none.
  let question: { id: string; resolve(upload?: boolean): void } | undefined;
  let online = true;
  // One step at a time: a save waits for the download, and two saves upload in order.
  let steps = Promise.resolve();
  const enqueue = (run: () => Promise<void>) => {
    steps = steps.then(run);
  };

  const update = (edit: Edit, patch: Partial<Transfer>) => {
    Object.assign(edit.transfer, patch);
    emit({ type: 'transfer', tab, transfer: { ...edit.transfer } });
  };

  const endQuestion = (upload?: boolean) => {
    if (!question) return;
    question.resolve(upload);
    question = undefined;
    emit({ type: 'editorSave', tab });
  };

  /** Runs `copy` on a new channel with progress on the row. */
  async function move(
    edit: Edit,
    copy: (
      sftp: SFTPWrapper,
      progress: (bytes: number) => void,
    ) => Promise<void>,
  ) {
    const started = Date.now();
    let shown = 0;
    update(edit, { state: 'running', bytes: 0, speed: 0, reason: undefined });
    const sftp = await channel();
    try {
      await Promise.race([
        whenClosed(sftp),
        copy(sftp, (bytes) => {
          if (Date.now() - shown < progressMs) return;
          shown = Date.now();
          const seconds = Math.max((Date.now() - started) / 1000, 0.001);
          update(edit, { bytes, speed: Math.round(bytes / seconds) });
        }),
      ]);
    } finally {
      sftp.end();
    }
  }

  const remoteStat = (sftp: SFTPWrapper, edit: Edit) =>
    call<Stats>((done) => sftp.stat(edit.remote, done));

  // A closed Tab's copy is gone: its manifest must not come back.
  const record = async (edit: Edit, sent: string) => {
    edit.sent = sent;
    if (!edits.has(edit.transfer.id)) return;
    const manifest: Manifest = { alias: alias(), remote: edit.remote, sent };
    await writeFile(
      `${path.dirname(edit.file)}.json`,
      JSON.stringify(manifest),
    );
  };

  async function download(edit: Edit) {
    await move(edit, async (sftp, progress) => {
      const stats = await remoteStat(sftp, edit);
      update(edit, { total: stats.size });
      await call((done) =>
        sftp.fastGet(edit.remote, edit.file, { step: progress }, done),
      );
      edit.base = baseOf(stats);
    });
    await record(edit, sha256(await readFile(edit.file)));
    update(edit, { state: 'done', bytes: edit.transfer.total });
  }

  /** Whether the remote file differs from the last download or upload. A file gone from the host changed too. */
  async function changed(edit: Edit) {
    const sftp = await channel();
    try {
      const now = await remoteStat(sftp, edit).catch(() => undefined);
      if (!now) return true;
      if (now.size > hashLimit)
        return now.size !== edit.base?.size || now.mtime !== edit.base.mtime;
      const hash = createHash('sha256');
      for await (const chunk of sftp.createReadStream(edit.remote))
        hash.update(chunk as Buffer);
      return hash.digest('hex') !== edit.sent;
    } finally {
      sftp.end();
    }
  }

  async function ask(edit: Edit, reason: EditorQuestion['reason']) {
    const upload = await new Promise<boolean | undefined>((resolve) => {
      question = { id: edit.transfer.id, resolve };
      emit({
        type: 'editorSave',
        tab,
        question: { id: edit.transfer.id, name: edit.transfer.name, reason },
      });
    });
    if (upload === undefined) throw new Error('The Tab disconnected.');
    return upload;
  }

  // Uploads the bytes it hashed: a save that lands meanwhile is the next step's.
  async function save(edit: Edit) {
    const local = await readFile(edit.file).catch(() => undefined);
    if (!local || sha256(local) === edit.sent) return;
    if (!edit.approved && !(await settings()).uploadOnSave) {
      if (!(await ask(edit, 'save'))) return;
      edit.approved = true;
    }
    if ((await changed(edit)) && !(await ask(edit, 'changed'))) {
      edit.approved = undefined;
      return;
    }
    update(edit, { total: local.length });
    await move(edit, async (sftp, progress) => {
      let bytes = 0;
      const chunks = function* () {
        for (; bytes < local.length; progress(bytes)) {
          const chunk = local.subarray(bytes, bytes + chunkBytes);
          bytes += chunk.length;
          yield chunk;
        }
      };
      await pipeline(
        Readable.from(chunks()),
        sftp.createWriteStream(edit.remote),
      );
      edit.base = baseOf(await remoteStat(sftp, edit));
    });
    edit.approved = undefined;
    await record(edit, sha256(local));
    update(edit, {
      state: 'done',
      bytes: local.length,
      edit: { ...edit.transfer.edit!, uploaded: Date.now() },
    });
  }

  async function begin(edit: Edit) {
    await download(edit);
    const app = await openInEditor(edit.file, (await settings()).editor);
    update(edit, { edit: { app } });
    let settling: NodeJS.Timeout | undefined;
    edit.watcher = watch(path.dirname(edit.file), () => {
      clearTimeout(settling);
      settling = setTimeout(() => run(edit), settleMs);
    });
  }

  /**
   * Downloads and opens a file not open in the editor yet, else uploads its save.
   * A save that fails offline waits as `queued`; a download fails and stays retryable, as a transfer does.
   */
  const run = (edit: Edit) =>
    enqueue(async () => {
      try {
        await (edit.watcher ? save(edit) : begin(edit));
      } catch (e) {
        update(
          edit,
          online || !edit.watcher
            ? { state: 'failed', reason: (e as Error).message }
            : { state: 'queued', reason: undefined },
        );
      }
    });

  return {
    /** Voids the open question. A save that failed as the connection went, before this event, waits too. */
    dropped() {
      online = false;
      endQuestion();
      for (const edit of edits.values())
        if (edit.watcher && edit.transfer.state === 'failed')
          update(edit, { state: 'queued', reason: undefined });
    },

    connected() {
      online = true;
      for (const edit of edits.values())
        if (edit.transfer.state === 'queued' && edit.watcher) run(edit);
    },

    /** Stops watching and deletes every copy, with any save not uploaded yet. */
    async close() {
      const closing = [...edits.values()];
      edits.clear();
      endQuestion();
      await Promise.all(
        closing.map((edit) => {
          edit.watcher?.close();
          return removeCopy(path.dirname(edit.file));
        }),
      );
    },

    retry(id: string) {
      const edit = edits.get(id);
      if (edit?.transfer.state === 'failed') run(edit);
    },

    answer(id: string, upload: boolean) {
      if (question?.id === id) endQuestion(upload);
    },

    /** A file already open shows its copy in the editor again, so two copies never upload over each other. */
    async open(remote: string) {
      const existing = [...edits.values()].find((e) => e.remote === remote);
      if (existing?.watcher) {
        await openInEditor(existing.file, (await settings()).editor);
        return;
      }
      if (existing) return;
      await mkdir(root, { recursive: true });
      const dir = await mkdtemp(path.join(root, 'edit-'));
      const name = remoteName(remote);
      const edit: Edit = {
        remote,
        file: path.join(dir, name),
        transfer: {
          id: `edit-${nextId++}`,
          direction: 'download',
          name,
          folder: remote.slice(0, remote.lastIndexOf('/')) || '/',
          local: path.join(dir, name),
          bytes: 0,
          total: 0,
          speed: 0,
          state: 'queued',
          edit: { app: '' },
        },
      };
      edits.set(edit.transfer.id, edit);
      run(edit);
    },
  };
}
