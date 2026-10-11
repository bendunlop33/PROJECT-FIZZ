import { toMs } from '@fizz/domain';
import type { BackupError, DatabaseManager, LastSwitch, RestorePreview } from '@fizz/persistence';
import type { SessionAggregate, ZonedTimestamp } from '@fizz/schemas';

import type { RestAlertController } from '../alerts/rest-alerts';
import type { BackupFileStore } from './backup-service';
import type { BackupRecord } from './manifest';

/**
 * Restore, Undo restore and Check a backup (data-import-export.md §2.3, §2.4,
 * §4.2; ADR 0005). Pure TS with injected parts, so the whole flow runs on
 * Linux against real SQLite files.
 *
 * - Restore and Undo restore are refused while a workout is unfinished (DX4):
 *   both replace the history that workout reads. Exception (PM decision on
 *   SP2): Undo is allowed when the unfinished workout came in with the
 *   restored data and hasn't been touched since.
 * - Before the switch, pending backups finish and the rest alert is
 *   cancelled; afterwards the app relaunches its services from the new
 *   database (normal cold-start logic, flow §4.2).
 * - Check never changes the database, its pointer or the rollback target.
 * - Imported files are data, never instructions (rule 8): the persistence
 *   layer validates every table, column and record.
 */

export interface RestoreServiceDeps {
  manager: DatabaseManager;
  backupFiles: BackupFileStore;
  now: () => ZonedTimestamp;
  /** The unfinished workout, if any (blocks restore and undo). */
  activeWorkout: () => Promise<SessionAggregate | null>;
  /** Backups on this phone, newest first (from the backup record). */
  copiesOnPhone: () => Promise<BackupRecord[]>;
  /** Resolves when no backup is being written (a restore never races one). */
  backupsIdle: () => Promise<void>;
  restAlerts?: RestAlertController;
}

export interface RestoreBlock {
  title: string;
  startedAtUtc: string;
  tz: string;
}

export type CheckFileResult =
  | { ok: true; preview: RestorePreview; restorable: boolean; issues: readonly { path: string; message: string }[] }
  | { ok: false; error: BackupError };

export type RestoreResult =
  | { ok: true; status: 'restored' | 'unchanged'; preview: RestorePreview }
  /** The data changed since the preview (review S5): nothing was switched; `fresh` is the new full check to show and confirm again. */
  | { ok: false; reason: 'stale'; fresh: CheckFileResult }
  | { ok: false; reason: 'workout_unfinished'; block: RestoreBlock }
  | { ok: false; reason: 'failed'; error: BackupError };

export type UndoResult = { ok: true } | { ok: false; reason: 'workout_unfinished'; block: RestoreBlock } | { ok: false; reason: 'failed'; error: BackupError };

/** An unexpected throw (I/O, a closed database) becomes a plain failure: nothing was switched (review S3). */
function failed(e: unknown): { ok: false; reason: 'failed'; error: BackupError } {
  return { ok: false, reason: 'failed', error: { code: 'restore_failed', message: `Restore failed; ${e instanceof Error ? e.message : String(e)}.` } };
}

export function createRestoreService(deps: RestoreServiceDeps) {
  async function block(): Promise<RestoreBlock | null> {
    // An unfinished workout that can't even be read doesn't block: restoring is the way out (review S2).
    const a = await deps.activeWorkout().catch(() => null);
    if (!a) return null;
    return { title: a.session.routineName ?? 'Workout', startedAtUtc: a.session.startedAt.utc, tz: a.session.startedAt.tz };
  }

  /**
   * Undo restore is blocked by an unfinished workout only when Ben started or
   * continued it after the last switch (PM decision on SP2, review S6). One
   * that came in with the restored data and hasn't been touched since doesn't
   * block: Undo swaps databases, so it stays in the restored copy.
   */
  async function undoBlock(): Promise<RestoreBlock | null> {
    const a = await deps.activeWorkout().catch(() => null);
    if (!a) return null;
    const last = deps.manager.rollbackTarget.last;
    const cameWithSwitch = last !== null && a.session.startedAt.utc <= last.atUtc && a.session.lastActivityAtUtc <= last.atUtc;
    if (cameWithSwitch) return null;
    return { title: a.session.routineName ?? 'Workout', startedAtUtc: a.session.startedAt.utc, tz: a.session.startedAt.tz };
  }

  /** Cancel anything scheduled from the data being replaced (§4.2), then wait for backups. */
  async function quiesce(): Promise<void> {
    if (deps.restAlerts) await deps.restAlerts.reconcile(null, toMs(deps.now().utc)).catch(() => undefined);
    await deps.backupsIdle();
  }

  return {
    /** Restore is unavailable while a workout is unfinished (DX4). Check is always available. */
    blockedBy: block,

    /** Undo restore: blocked only by a workout started or continued since the last switch (S6). */
    undoBlockedBy: undoBlock,

    copiesOnPhone: () => deps.copiesOnPhone(),

    /** A backup on this phone, by its recorded file name. Null when it's gone. */
    readOnPhone: async (fileName: string): Promise<string | null> => {
      try {
        return await deps.backupFiles.read(fileName);
      } catch {
        return null;
      }
    },

    /** `Check a backup`: verify, rebuild in a scratch file, integrity-check, discard. */
    check: (text: string): Promise<CheckFileResult> => deps.manager.check(text).catch((e: unknown) => ({ ok: false as const, error: failed(e).error })),

    /** Step 2–3 of a restore: the same full check, so the preview says `Checked: complete, no damaged records`. */
    prepare: (text: string): Promise<CheckFileResult> => deps.manager.check(text).catch((e: unknown) => ({ ok: false as const, error: failed(e).error })),

    /**
     * `previewStamp` is the `stamp` of the preview Ben confirmed. A restore
     * never runs against data that changed since (review S5).
     */
    async restore(text: string, previewStamp: string): Promise<RestoreResult> {
      try {
        const b = await block();
        if (b) return { ok: false, reason: 'workout_unfinished', block: b };
        await quiesce();
        const r = await deps.manager.restore(text, deps.now(), { expectedStamp: previewStamp });
        if (!r.ok && r.error.code === 'preview_stale') return { ok: false, reason: 'stale', fresh: await deps.manager.check(text) };
        if (!r.ok) return { ok: false, reason: 'failed', error: r.error };
        return { ok: true, status: r.status, preview: r.preview };
      } catch (e) {
        return failed(e);
      }
    },

    /** Free the checked backup held for Restore; the restore screen calls it when it closes (N2). */
    forgetChecked: (): void => {
      deps.manager.forgetChecked();
    },

    rollbackTarget: (): { available: boolean; last: LastSwitch | null } => deps.manager.rollbackTarget,

    async undo(): Promise<UndoResult> {
      try {
        const b = await undoBlock();
        if (b) return { ok: false, reason: 'workout_unfinished', block: b };
        await quiesce();
        const r = await deps.manager.rollback(deps.now());
        return r.ok ? { ok: true } : { ok: false, reason: 'failed', error: r.error };
      } catch (e) {
        return failed(e);
      }
    },

    /** A restore was building a file when Fizz last closed; the data is as it was before. */
    get interruptedRestore(): boolean {
      return deps.manager.interruptedRestore;
    },
  };
}

export type RestoreService = ReturnType<typeof createRestoreService>;
