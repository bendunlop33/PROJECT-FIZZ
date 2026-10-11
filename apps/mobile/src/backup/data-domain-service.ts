import { z } from 'zod';

import { toMs } from '@fizz/domain';
import { exportDomain, sha256Hex, type AppInfo, type DataDomain, type DatabaseManager, type DomainCounts } from '@fizz/persistence';
import type { Exercise, ZonedTimestamp } from '@fizz/schemas';

import type { RestAlertController } from '../alerts/rest-alerts';
import { localStamp } from '../format/dates';
import { describeWriteError, type BackupService, type CopyDestination, type TextFile } from './backup-service';

/**
 * Export, `Delete my data (keep coaching knowledge)` and `Reset coaching
 * knowledge` by data domain (CLAUDE.md rule 10; data-import-export §2.6,
 * §2.7, §3.6, §4.5; profile-and-settings §2.8). Pure TS with injected parts,
 * so the whole flow runs on Linux against real SQLite files.
 *
 * Delete, in order:
 * 1. The confirmation's stamp must match the data (rule 5), else `stale`.
 * 2. A backup on this phone (`before_delete`), checked. If it fails, nothing
 *    is deleted. Restore brings everything back from it.
 * 3. A marker in the ledger. From here a force-close is finished by the next
 *    launch (`resumeInterrupted`) before anything is shown (check 31).
 * 4. The database swap (one meta transaction: all or nothing), then the old
 *    file and the copy kept for Undo restore are removed.
 * 5. Rest alerts cancelled.
 * 6. Coach sign-out (revoke online where possible) and every Keychain item
 *    GymSmarter owns deleted; Your-data files outside SQLite removed (coach
 *    connection settings, this phone's look and alert answers).
 * 7. Marker cleared; the op ID recorded, so a repeat is a no-op.
 *
 * Reset: stamp check, a `before_reset` backup, then one swap that keeps every
 * Your-data row and one rollback generation. Never touches credentials.
 *
 * Neither the coach nor voice can call these (DX10).
 */

/** Keychain items, cleared on Delete (ios-platform-feasibility: they survive an uninstall). */
export interface CredentialPort {
  /** Revoke online where possible and delete the tokens. `hadSession`: there was a sign-in to end. */
  signOut(): Promise<{ revoked: boolean; hadSession: boolean }>;
  /** Delete every Keychain item GymSmarter owns, by its known keys. Throws if any is still there. */
  wipe(): Promise<void>;
}

/** Your-data files outside the database (settings, guide files). */
export interface PersonalFilesPort {
  remove(): Promise<void>;
}

export interface DataDomainDeps {
  manager: DatabaseManager;
  backups: BackupService;
  /** The delete marker and the op IDs already done. Writes must replace it atomically. */
  ledger: TextFile;
  now: () => ZonedTimestamp;
  app: AppInfo;
  /** This build's bundled coaching knowledge (the starter exercise list). */
  bundledKnowledge: (atUtc: string) => readonly Exercise[];
  credentials?: CredentialPort;
  personalFiles?: PersonalFilesPort;
  restAlerts?: RestAlertController;
  /** How long an online sign-out may take before it counts as not confirmed (default 10 s). */
  signOutTimeoutMs?: number;
}

const OpKind = z.enum(['delete_my_data', 'reset_coaching_knowledge']);
const LedgerSchema = z.object({
  version: z.literal(1),
  pending: z.object({ kind: z.literal('delete_my_data'), opId: z.string().min(1), startedAtUtc: z.string(), backupFileName: z.string() }).nullable(),
  done: z.array(
    z.object({
      opId: z.string().min(1),
      kind: OpKind,
      atUtc: z.string(),
      /** False when a ChatGPT sign-in was removed from the phone but revoking it online wasn't confirmed. */
      signedOutOnline: z.boolean().nullable(),
    }),
  ),
});
type Ledger = z.infer<typeof LedgerSchema>;
type DoneEntry = Ledger['done'][number];

const EMPTY: Ledger = { version: 1, pending: null, done: [] };
/** Op IDs remembered for duplicates. */
const KEEP_DONE = 20;

export interface DataSummary {
  counts: DomainCounts;
  /** Pass back with the confirmation; a mismatch is refused as stale. */
  stamp: string;
  /** The newest copy saved to Files, if any (the screens' off-phone line). */
  lastCopyToFiles: { atUtc: string; tz: string; destinationLabel: string } | null;
}

export type DeleteOutcome =
  | { ok: true; duplicate: boolean; signedOutOnline: boolean | null }
  | { ok: false; reason: 'stale'; fresh: DataSummary }
  | { ok: false; reason: 'backup_failed'; message: string }
  /** `pending`: the marker is set and the next launch finishes the delete. */
  | { ok: false; reason: 'failed'; message: string; pending: boolean };

export type ResetOutcome =
  | { ok: true; duplicate: boolean; status: 'switched' | 'unchanged' }
  | { ok: false; reason: 'stale'; fresh: DataSummary }
  | { ok: false; reason: 'backup_failed'; message: string }
  | { ok: false; reason: 'failed'; message: string };

export type ExportKind = DataDomain;

export interface ExportFile {
  fileName: string;
  text: string;
}

export type ExportSaveResult = { ok: true; fileName: string; destinationLabel: string } | { ok: false; reason: 'inside_app' | 'failed'; message: string };

export const EXPORT_FORMAT = 'fizz-export';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(fallback);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export function createDataDomainService(deps: DataDomainDeps) {
  let chain: Promise<unknown> = Promise.resolve();
  function queued<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  }

  /** A ledger that can't be read is treated as empty only when there is no file at all. */
  async function readLedger(): Promise<Ledger> {
    const text = await deps.ledger.read();
    if (text === null) return EMPTY;
    const parsed = LedgerSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error('The data ledger on this phone is damaged.');
    return parsed.data;
  }

  async function writeLedger(l: Ledger): Promise<void> {
    await deps.ledger.write(JSON.stringify(l));
  }

  function remember(l: Ledger, entry: DoneEntry): Ledger {
    return { ...l, pending: null, done: [...l.done.filter((d) => d.opId !== entry.opId), entry].slice(-KEEP_DONE) };
  }

  async function summaryNow(): Promise<DataSummary> {
    const [{ counts, stamp }, status] = await Promise.all([deps.manager.domainSummary(), deps.backups.getStatus()]);
    const copy = status.offPhone.lastCopy;
    return { counts, stamp, lastCopyToFiles: copy ? { atUtc: copy.atUtc, tz: copy.tz, destinationLabel: copy.destinationLabel } : null };
  }

  /**
   * Steps 4–7. Every step is safe to repeat; a throw leaves the marker for
   * the next launch. `expectedStamp` (first run only): data changed since the
   * backup, so nothing is deleted and the marker is cleared.
   */
  async function finishDelete(l: Ledger, opId: string, expectedStamp?: string): Promise<{ stale: true } | { stale: false; signedOutOnline: boolean | null }> {
    const swapped = await deps.manager.deleteYourData(expectedStamp === undefined ? {} : { expectedStamp });
    if (!swapped.ok && swapped.error.code === 'preview_stale') {
      await writeLedger({ ...l, pending: null });
      return { stale: true };
    }
    if (!swapped.ok) throw new Error(swapped.error.message);
    if (deps.restAlerts) await deps.restAlerts.reconcile(null, toMs(deps.now().utc)).catch(() => undefined);
    let signedOutOnline: boolean | null = null;
    if (deps.credentials) {
      const creds = deps.credentials;
      // Offline is fine (§4.5 step 1): the sign-in is removed from the phone either way.
      const out = await withTimeout(creds.signOut(), deps.signOutTimeoutMs ?? 10_000, { revoked: false, hadSession: true });
      signedOutOnline = out.hadSession ? out.revoked : null;
      await creds.wipe();
    }
    if (deps.personalFiles) await deps.personalFiles.remove();
    await writeLedger(remember(l, { opId, kind: 'delete_my_data', atUtc: deps.now().utc, signedOutOnline }));
    return { stale: false, signedOutOnline };
  }

  async function buildExport(kind: ExportKind): Promise<ExportFile> {
    const at = deps.now();
    const body = await deps.manager.store.db.read((q) => exportDomain(q, kind));
    const file = {
      format: EXPORT_FORMAT,
      formatVersion: 1,
      section: kind,
      createdAt: at,
      app: deps.app,
      schemaVersion: body.schemaVersion,
      tables: body.tables,
    };
    const stem = kind === 'your_data' ? 'fizz-my-data' : 'fizz-coaching-knowledge';
    return { fileName: `${stem}-${localStamp(toMs(at.utc), at.tz)}.json`, text: JSON.stringify(file, null, 1) };
  }

  return {
    summary: (): Promise<DataSummary> => summaryNow(),

    /**
     * `Delete my data (keep coaching knowledge)`. `opId` is minted once per
     * confirmation; a repeat (double tap, retry) returns the first result.
     */
    deleteMyData(req: { opId: string; stamp: string }): Promise<DeleteOutcome> {
      return queued(async (): Promise<DeleteOutcome> => {
        let l: Ledger;
        try {
          l = await readLedger();
        } catch (e) {
          return { ok: false, reason: 'failed', message: errorText(e), pending: false };
        }
        const done = l.done.find((d) => d.opId === req.opId && d.kind === 'delete_my_data');
        if (done) return { ok: true, duplicate: true, signedOutOnline: done.signedOutOnline };
        let expectedStamp: string | undefined;
        if (l.pending === null) {
          expectedStamp = req.stamp;
          const fresh = await summaryNow();
          if (fresh.stamp !== req.stamp) return { ok: false, reason: 'stale', fresh };
          await deps.backups.whenIdle();
          const backup = await deps.backups.backUpOnPhone('before_delete');
          if (!backup.ok) return { ok: false, reason: 'backup_failed', message: backup.error };
          if ((await summaryNow()).stamp !== req.stamp) return { ok: false, reason: 'stale', fresh: await summaryNow() };
          l = { ...l, pending: { kind: 'delete_my_data', opId: req.opId, startedAtUtc: deps.now().utc, backupFileName: backup.record.fileName } };
          try {
            await writeLedger(l);
          } catch (e) {
            return { ok: false, reason: 'failed', message: `Nothing was deleted. ${describeWriteError(e)}`, pending: false };
          }
        }
        const opId = l.pending?.opId ?? req.opId;
        try {
          const r = await finishDelete(l, opId, expectedStamp);
          if (r.stale) return { ok: false, reason: 'stale', fresh: await summaryNow() };
          return { ok: true, duplicate: opId !== req.opId, signedOutOnline: r.signedOutOnline };
        } catch (e) {
          return { ok: false, reason: 'failed', message: errorText(e), pending: true };
        }
      });
    },

    /**
     * Launch: a delete that was interrupted is finished before anything is
     * shown (check 31). `ran: false` when there was nothing to finish.
     */
    resumeInterrupted(): Promise<{ ran: boolean; ok: boolean; message: string | null }> {
      return queued(async () => {
        let l: Ledger;
        try {
          l = await readLedger();
        } catch (e) {
          return { ran: false, ok: false, message: errorText(e) };
        }
        if (l.pending === null) return { ran: false, ok: true, message: null };
        try {
          await finishDelete(l, l.pending.opId);
          return { ran: true, ok: true, message: null };
        } catch (e) {
          return { ran: true, ok: false, message: errorText(e) };
        }
      });
    },

    /** `Reset coaching knowledge`. Your data is never changed; one rollback generation is kept. */
    resetCoachingKnowledge(req: { opId: string; stamp: string }): Promise<ResetOutcome> {
      return queued(async (): Promise<ResetOutcome> => {
        let l: Ledger;
        try {
          l = await readLedger();
        } catch (e) {
          return { ok: false, reason: 'failed', message: errorText(e) };
        }
        if (l.done.some((d) => d.opId === req.opId && d.kind === 'reset_coaching_knowledge')) return { ok: true, duplicate: true, status: 'unchanged' };
        const fresh = await summaryNow();
        if (fresh.stamp !== req.stamp) return { ok: false, reason: 'stale', fresh };
        await deps.backups.whenIdle();
        const backup = await deps.backups.backUpOnPhone('before_reset');
        if (!backup.ok) return { ok: false, reason: 'backup_failed', message: backup.error };
        const r = await deps.manager.resetKnowledge(deps.bundledKnowledge(deps.now().utc), { expectedStamp: req.stamp });
        if (!r.ok) {
          if (r.error.code === 'preview_stale') return { ok: false, reason: 'stale', fresh: await summaryNow() };
          return { ok: false, reason: 'failed', message: r.error.message };
        }
        await writeLedger(remember(l, { opId: req.opId, kind: 'reset_coaching_knowledge', atUtc: deps.now().utc, signedOutOnline: null })).catch(() => undefined);
        return { ok: true, duplicate: false, status: r.status };
      });
    },

    /** `Export`: one domain as a JSON file (not restorable; backups are). */
    buildExport,

    /** Write an export to the folder Ben picked, then read it back to prove it landed. */
    async saveExportTo(dest: CopyDestination, kind: ExportKind): Promise<ExportSaveResult> {
      if (dest.insideApp) return { ok: false, reason: 'inside_app', message: 'That’s inside GymSmarter, so it’s lost with the app. Choose iCloud Drive or another folder.' };
      try {
        const file = await buildExport(kind);
        await dest.write(file.fileName, file.text);
        const back = await dest.read(file.fileName);
        if (back === null || sha256Hex(back) !== sha256Hex(file.text)) throw new Error('the file read back differently from what was written');
        return { ok: true, fileName: file.fileName, destinationLabel: dest.label };
      } catch (e) {
        return { ok: false, reason: 'failed', message: `Couldn’t create the file: ${describeWriteError(e)}` };
      }
    },
  };
}

export type DataDomainService = ReturnType<typeof createDataDomainService>;
