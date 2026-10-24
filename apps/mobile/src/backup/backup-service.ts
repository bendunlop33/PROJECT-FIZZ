import type { ZonedTimestamp } from '@fizz/schemas';
import { toMs } from '@fizz/domain';
import { createBackup, sha256HexAsync, timeSlicer, type AppInfo, type Slicer, type Store } from '@fizz/persistence';

import {
  backupFileName,
  emptyManifest,
  parseManifest,
  planRotation,
  serialiseManifest,
  AUTOMATIC_NAME,
  type BackupAttempt,
  type BackupManifest,
  type BackupRecord,
} from './manifest';
import { backupCovers, buildBackupStatus, newestBackup, type BackupStatus } from './status';

/**
 * Automatic backups on this phone, `Back up on this phone now` and
 * `Save a copy to Files` (data-import-export.md §2.1, §3.2, §4.1).
 *
 * No React Native here: storage is injected, so the whole flow (write,
 * verify, rotate, status) is tested on Linux. The phone bindings are in
 * `device/files.ts`.
 *
 * Never blocks logging: callers fire `backUpOnPhone` without awaiting, and
 * runs are queued one at a time. A failure is recorded and shown, never thrown.
 *
 * Never freezes the screen (backup review B1): a run starts once the UI is
 * idle, serialises and hashes in short slices, hashes the file once (the
 * read-back is compared as text), and rotation hashes only the file it is
 * about to delete, in slices too.
 */

/** Backup files in Fizz's own container. */
export interface BackupFileStore {
  write(name: string, text: string): Promise<void>;
  read(name: string): Promise<string | null>;
  remove(name: string): Promise<void>;
  /** Every file name in the backup folder (Delete my data removes them all). */
  list(): Promise<string[]>;
}

/** One small text file (the manifest). Writes must replace it atomically. */
export interface TextFile {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  /**
   * Keep the current (damaged) content beside the file under a new name
   * before it is started again (review S2), so there is something to look
   * at later. Returns the copy's name.
   */
  keepDamagedCopy?(suffix: string): Promise<string>;
}

/** A place outside Fizz that Ben picked (Files). */
export interface CopyDestination {
  /** Human label, e.g. `iCloud Drive › Fizz backups`. */
  label: string;
  /** True when the chosen folder is inside Fizz's container (lost with the app). */
  insideApp: boolean;
  write(name: string, text: string): Promise<void>;
  /** Read the file back, to prove it landed. */
  read(name: string): Promise<string | null>;
}

export interface BackupServiceDeps {
  store: () => Store;
  files: BackupFileStore;
  manifest: TextFile;
  now: () => ZonedTimestamp;
  app: AppInfo;
  locale?: string;
  /** Resolves when the UI is idle (after Finish's transition); each background run waits for it first. Default: start at once. */
  idle?: () => Promise<void>;
  /** Pauses long work so taps and renders run in between. Default: 8 ms slices. */
  slice?: Slicer;
}

export type BackupReason = BackupRecord['reason'];

/**
 * Runs Ben started and is waiting on (`Back up now`, the backup before an
 * import, the two before `Reset coaching knowledge`): they start at once.
 * Only background runs wait for the UI to be idle (fix-backup review N4).
 * `Save a copy to Files` is user-started too, and so is the backup after
 * `Delete my data` (`wipeOnPhone`, which never waits).
 */
export const USER_STARTED: ReadonlySet<BackupReason> = new Set(['manual', 'before_import', 'before_reset', 'kept_for_undo', 'after_delete']);

export type BackupRunResult = { ok: true; record: BackupRecord; deleted: string[] } | { ok: false; error: string };

export type CopyResult =
  | { ok: true; fileName: string; destinationLabel: string }
  | { ok: false; reason: 'inside_app' | 'failed'; message: string };

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Plain-language reason for a failed write (system-states §3.8). */
export function describeWriteError(e: unknown): string {
  const text = errorText(e);
  if (/no space|ENOSPC|disk is full|out of space/i.test(text)) return 'This iPhone is out of space.';
  return `The file couldn’t be written (${text.slice(0, 160)}).`;
}

export function createBackupService(deps: BackupServiceDeps) {
  const slice = deps.slice ?? timeSlicer();
  let chain: Promise<unknown> = Promise.resolve();
  let running = 0;
  let manifestProblem: string | null = null;
  /** The last manifest read or written, used when the file can't be read (review S2). */
  let lastKnown: BackupManifest | null = null;
  let damagedCopyKept = false;
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((l) => {
      l();
    });
  };

  function queued<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  }

  /**
   * `writable: false` when the record couldn't be read: it may still be fine
   * on disk, so nothing is written over it and nothing is rotated (review S2).
   */
  interface Loaded {
    manifest: BackupManifest;
    writable: boolean;
  }

  async function loadManifest(): Promise<Loaded> {
    let text: string | null;
    try {
      text = await deps.manifest.read();
    } catch (e) {
      manifestProblem = `The backup record couldn’t be read (${errorText(e)}). Data unchanged; it’s tried again next time.`;
      return { manifest: lastKnown ?? parseManifest(null).manifest, writable: false };
    }
    const read = parseManifest(text);
    if (read.problem !== null) {
      manifestProblem = read.problem;
      // A damaged record is started again, but a copy is kept first.
      if (text !== null && !damagedCopyKept && deps.manifest.keepDamagedCopy) {
        try {
          await deps.manifest.keepDamagedCopy(deps.now().utc.replace(/[:.]/g, '-'));
          damagedCopyKept = true;
        } catch {
          return { manifest: read.manifest, writable: false };
        }
      }
    }
    lastKnown = read.manifest;
    return { manifest: read.manifest, writable: true };
  }

  /** Save only over a record that was read (or is known damaged and copied). Returns false when skipped. */
  async function saveManifest(loaded: Loaded, m: BackupManifest): Promise<boolean> {
    lastKnown = m;
    if (!loaded.writable) return false;
    await deps.manifest.write(serialiseManifest(m));
    manifestProblem = null;
    damagedCopyKept = false;
    return true;
  }

  /** A name not used by the manifest or by any file already there (review S3). */
  async function freeName(
    at: ZonedTimestamp,
    kind: BackupRecord['kind'],
    recorded: Iterable<string>,
    exists: (name: string) => Promise<boolean>,
  ): Promise<string> {
    const taken = new Set(recorded);
    for (let i = 0; i < 100; i += 1) {
      const name = backupFileName(toMs(at.utc), at.tz, kind, taken);
      if (!(await exists(name))) return name;
      taken.add(name);
    }
    throw new Error('no free backup file name');
  }

  async function backUpNow(reason: BackupReason, source: Store | undefined): Promise<BackupRunResult> {
    const at = deps.now();
    const loaded = await loadManifest();
    const { manifest } = loaded;
    // The copy kept for Undo (review r5 B1) is never rotated: it may be the only place some data is.
    const kind: BackupRecord['kind'] = reason === 'manual' || reason === 'kept_for_undo' ? 'manual' : 'automatic';
    const attempt = (ok: boolean, error: string | null): BackupAttempt => ({ atUtc: at.utc, tz: at.tz, ok, error });
    let record: BackupRecord;
    let fileName: string;
    try {
      fileName = await freeName(
        at,
        kind,
        manifest.onPhone.files.map((f) => f.fileName),
        async (n) => (await deps.files.read(n)) !== null,
      );
      const store = source ?? deps.store();
      const created = await createBackup(store, { at, app: deps.app, slice });
      const counts = await store.countRecords();
      const { sha256 } = created;
      await deps.files.write(fileName, created.text);
      // Written and checked before anything older is deleted (§3.2 Rotation): byte for byte, so no second hash.
      const back = await deps.files.read(fileName);
      if (back !== created.text) throw new Error('the file read back differently from what was written');
      record = {
        fileName,
        kind,
        reason,
        createdAtUtc: at.utc,
        tz: at.tz,
        sha256,
        textLength: created.text.length,
        finishedWorkouts: created.counts.finishedWorkouts,
        finishedDigest: created.finishedWorkoutsDigest,
        loggedSets: created.counts.loggedSets,
        exercises: counts.exercises,
        integrityOk: created.integrity.ok,
        integrityIssues: created.integrity.issues.length,
      };
    } catch (e) {
      const error = describeWriteError(e);
      await saveManifest(loaded, { ...manifest, onPhone: { ...manifest.onPhone, lastAttempt: attempt(false, error) } }).catch(() => undefined);
      return { ok: false, error };
    }

    const files = [...manifest.onPhone.files, record];
    if (!loaded.writable) {
      // The record couldn't be read: keep this run in memory, delete nothing.
      await saveManifest(loaded, { ...manifest, onPhone: { files, lastAttempt: attempt(true, null) } });
      return { ok: true, record, deleted: [] };
    }
    const deleted: string[] = [];
    const kept: BackupRecord[] = [];
    const doomed = new Set(planRotation(files, manifest.keep, fileName).map((f) => f.fileName));
    for (const f of files) {
      if (!doomed.has(f.fileName)) {
        kept.push(f);
        continue;
      }
      // Delete only a file Fizz wrote: automatic name pattern AND the recorded checksum.
      try {
        const text = await deps.files.read(f.fileName);
        if (text === null) {
          deleted.push(f.fileName); // already gone: drop the record
        } else if (AUTOMATIC_NAME.test(f.fileName) && text.length === f.textLength && (await sha256HexAsync(text, slice)) === f.sha256) {
          await deps.files.remove(f.fileName);
          deleted.push(f.fileName);
        } else {
          kept.push(f);
        }
      } catch {
        kept.push(f);
      }
    }
    await saveManifest(loaded, { ...manifest, onPhone: { files: kept, lastAttempt: attempt(true, null) } });
    return { ok: true, record, deleted };
  }

  async function track<T>(fn: () => Promise<T>): Promise<T> {
    running += 1;
    notify();
    try {
      return await fn();
    } finally {
      running -= 1;
      notify();
    }
  }

  const service = {
    /**
     * Write a backup into Fizz's container, then rotate automatic files. Queued; never throws.
     * `source`: back up that store instead of the current one (the copy kept for Undo, review r5 B1).
     */
    backUpOnPhone(reason: BackupReason, opts: { source?: Store } = {}): Promise<BackupRunResult> {
      return track(() =>
        queued(async () => {
          try {
            if (deps.idle && !USER_STARTED.has(reason)) await deps.idle();
            return await backUpNow(reason, opts.source);
          } catch (e) {
            return { ok: false, error: describeWriteError(e) } as const;
          }
        }),
      );
    },

    /**
     * `Delete my data` (data-import-export §4.5 step 3; check 30): delete
     * every backup file on this phone (they hold Ben's data), start the
     * record again (copies, the last Files copy, trial run and reminder
     * answers), then write one backup of what is left: coaching knowledge
     * only. Queued behind any run in progress, so a backup that started
     * before the switch is deleted too. Safe to repeat. Throws when a file
     * is still there; a failed fresh backup is recorded, not thrown.
     */
    wipeOnPhone(): Promise<BackupRunResult> {
      return track(() =>
        queued(async () => {
          const names = new Set(await deps.files.list());
          const recorded = await deps.manifest.read().catch(() => null);
          for (const f of parseManifest(recorded).manifest.onPhone.files) names.add(f.fileName);
          for (const name of names) await deps.files.remove(name);
          const left = (await deps.files.list()).filter((n) => names.has(n));
          if (left.length > 0) throw new Error(`${String(left.length)} backup file(s) couldn’t be deleted`);
          const fresh = emptyManifest();
          await deps.manifest.write(serialiseManifest(fresh));
          lastKnown = fresh;
          manifestProblem = null;
          damagedCopyKept = false;
          notify();
          try {
            return await backUpNow('after_delete', undefined);
          } catch (e) {
            return { ok: false, error: describeWriteError(e) } as const;
          }
        }),
      );
    },

    /**
     * `Finish deleting` after Ben chose `Continue` on an unfinished delete
     * (review r2 S2): delete every backup file on this phone except those
     * recorded at or after `sinceUtc` (made from data logged since), and
     * forget what the record says about before then. Writes no new backup.
     * Refused when the record can't be read (new backups can't be told
     * apart). Throws when a file is still there.
     */
    removeOnPhoneBefore(sinceUtc: string): Promise<void> {
      return track(() =>
        queued(async () => {
          const { manifest, problem } = parseManifest(await deps.manifest.read());
          if (problem !== null) throw new Error(problem.replace(/;.*$/, '.'));
          const kept = manifest.onPhone.files.filter((f) => f.createdAtUtc >= sinceUtc);
          const keep = new Set(kept.map((f) => f.fileName));
          const names = new Set([...(await deps.files.list()), ...manifest.onPhone.files.map((f) => f.fileName)].filter((n) => !keep.has(n)));
          for (const name of names) await deps.files.remove(name);
          const left = (await deps.files.list()).filter((n) => names.has(n));
          if (left.length > 0) throw new Error(`${String(left.length)} backup file(s) couldn’t be deleted`);
          const since = (at: string | null) => (at !== null && at >= sinceUtc ? at : null);
          const lastCopy = manifest.offPhone.lastCopy !== null && manifest.offPhone.lastCopy.atUtc >= sinceUtc ? manifest.offPhone.lastCopy : null;
          const next: BackupManifest = {
            ...manifest,
            onPhone: { files: kept, lastAttempt: manifest.onPhone.lastAttempt !== null && manifest.onPhone.lastAttempt.atUtc >= sinceUtc ? manifest.onPhone.lastAttempt : null },
            offPhone: { ...manifest.offPhone, lastCopy, reminderDismissedAtUtc: since(manifest.offPhone.reminderDismissedAtUtc) },
            trialRunDoneAtUtc: since(manifest.trialRunDoneAtUtc),
          };
          await deps.manifest.write(serialiseManifest(next));
          lastKnown = next;
          manifestProblem = null;
          notify();
        }),
      );
    },

    /**
     * Launch catch-up (§3.2 "If iOS stops it, it runs again on the next
     * launch"): back up unless the newest backup holds exactly the finished
     * workouts there are now (B2: not just as many).
     */
    async ensureBackedUp(): Promise<BackupRunResult | null> {
      const { manifest } = await loadManifest();
      const store = deps.store();
      const counts = await store.countRecords();
      const newest = newestBackup(manifest.onPhone.files);
      if (newest === null ? counts.finishedWorkouts === 0 : backupCovers(newest, { finishedWorkouts: counts.finishedWorkouts, finishedDigest: await store.finishedWorkoutsDigest() })) {
        return null;
      }
      return service.backUpOnPhone('catch_up');
    },

    /** `Save a copy to Files`: a fresh backup written to the folder Ben picked, read back to prove it. */
    saveCopyTo(dest: CopyDestination): Promise<CopyResult> {
      return track(() =>
        queued(async (): Promise<CopyResult> => {
          if (dest.insideApp) {
            return { ok: false, reason: 'inside_app', message: 'That’s inside GymSmarter, so it’s lost with the app. Choose iCloud Drive or another folder.' };
          }
          const at = deps.now();
          let fileName: string;
          try {
            fileName = await freeName(at, 'manual', [], async (n) => (await dest.read(n)) !== null);
            const created = await createBackup(deps.store(), { at, app: deps.app, slice });
            await dest.write(fileName, created.text);
            const back = await dest.read(fileName);
            if (back !== created.text) throw new Error('the copy read back differently from what was written');
          } catch (e) {
            return { ok: false, reason: 'failed', message: `Couldn’t save the copy: ${describeWriteError(e)} Your data on this phone is fine.` };
          }
          const loaded = await loadManifest();
          const { manifest } = loaded;
          await saveManifest(loaded, {
            ...manifest,
            offPhone: { ...manifest.offPhone, lastCopy: { atUtc: at.utc, tz: at.tz, fileName, destinationLabel: dest.label } },
          });
          return { ok: true, fileName, destinationLabel: dest.label };
        }),
      );
    },

    async getStatus(): Promise<BackupStatus & { manifestProblem: string | null }> {
      const { manifest } = await loadManifest();
      const store = deps.store();
      const counts = await store.countRecords();
      const finishedDigest = await store.finishedWorkoutsDigest();
      const at = deps.now();
      const status = buildBackupStatus(manifest, {
        finishedWorkouts: counts.finishedWorkouts,
        finishedDigest,
        backingUp: running > 0,
        nowMs: toMs(at.utc),
        tz: at.tz,
        ...(deps.locale === undefined ? {} : { locale: deps.locale }),
      });
      return { ...status, manifestProblem };
    },

    /**
     * `Keep 7 / 14 / 30 / All copies` (DX9). Takes effect at the next
     * automatic backup: changing it never deletes a copy by itself.
     */
    setKeep(keep: number | null): Promise<boolean> {
      return queued(async () => {
        if (keep !== null && (!Number.isInteger(keep) || keep < 1 || keep > 1000)) return false;
        const loaded = await loadManifest();
        if (!loaded.writable) return false;
        const ok = await saveManifest(loaded, { ...loaded.manifest, keep });
        notify();
        return ok;
      });
    },

    markTrialRunDone(): Promise<void> {
      return queued(async () => {
        const loaded = await loadManifest();
        await saveManifest(loaded, { ...loaded.manifest, trialRunDoneAtUtc: deps.now().utc });
        notify();
      });
    },

    dismissOffPhoneReminder(): Promise<void> {
      return queued(async () => {
        const loaded = await loadManifest();
        const m = loaded.manifest;
        await saveManifest(loaded, { ...m, offPhone: { ...m.offPhone, reminderDismissedAtUtc: deps.now().utc } });
        notify();
      });
    },

    /** Resolves once every queued run has finished (a restore never races a backup). */
    whenIdle(): Promise<void> {
      return chain.then(() => undefined);
    },

    /** Re-render when a run starts or ends. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    get isRunning(): boolean {
      return running > 0;
    },
  };
  return service;
}

export type BackupService = ReturnType<typeof createBackupService>;
