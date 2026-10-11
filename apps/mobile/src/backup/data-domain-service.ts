import { z } from 'zod';

import { toMs } from '@fizz/domain';
import { exportDomain, sha256Hex, type AppInfo, type DataDomain, type DatabaseManager, type DomainCounts, type DomainSwitchOutcome } from '@fizz/persistence';
import type { Exercise, SessionAggregate, ZonedTimestamp } from '@fizz/schemas';

import { restAlertIdentifier, type RestAlertController } from '../alerts/rest-alerts';
import { localStamp } from '../format/dates';
import { describeWriteError, type BackupService, type CopyDestination, type TextFile } from './backup-service';

/**
 * Export, `Delete my data (keep coaching knowledge)` and `Reset coaching
 * knowledge` by data domain (CLAUDE.md rule 10; data-import-export §2.6,
 * §2.7, §3.6, §4.5; profile-and-settings §2.8). Pure TS with injected parts,
 * so the whole flow runs on Linux against real SQLite files.
 *
 * Delete, in order (§4.5; check 30). The safety net is `Save a copy to Files
 * first` on the screen: nothing of Ben's is kept on this phone.
 * 1. The confirmation's stamp must match the data (rule 5), else `stale`.
 * 2. A marker in the ledger. From here a force-close is finished by the next
 *    launch (`resumeInterrupted`) before anything is shown (check 31).
 * 3. `database`: the swap (one meta transaction: all or nothing), then the
 *    old file and the copy kept for Undo restore are removed. The marker
 *    then records the swap, so a resume never swaps again (it would delete
 *    anything logged since). Database first, unlike §4.5's order: a failure
 *    before the swap then deletes nothing (ADR 0022).
 * 4. `coach_sign_in`: the sign-in removed from this phone, revoked online
 *    where possible (bounded; offline is fine), every Keychain item deleted.
 *    First after the swap: Keychain items survive an uninstall, so nothing
 *    else may stand in their way (§4.5 step 1, review r3 B1).
 * 5. `alerts`: every scheduled workout alert cancelled, known to this run or
 *    not (a resume runs after a relaunch), and delivered ones cleared.
 * 6. `backups`: every backup file on this phone deleted, the backup record
 *    started again, one coaching-knowledge-only backup written.
 * 7. `settings_files`: Your-data files outside SQLite removed (coach
 *    connection settings, this phone's look and alert answers, crash notes,
 *    the probe database, picked-file copies in tmp, Caches).
 * 8. Marker cleared; the op ID recorded, so a repeat is a no-op, and any
 *    earlier delete left unfinished is marked done (review r3 S1).
 *
 * After the swap every step runs even when an earlier one fails, so one
 * stuck file never keeps the others (review r3 B1); the first failure is
 * the one reported. `Continue` at launch after steps kept failing records
 * them as unfinished; Data & backup then offers `Finish deleting`, which
 * re-runs only those steps, never the swap (review r2 S2).
 *
 * Reset: refused while a workout is unfinished (DX4, review r2 S3), stamp
 * check, a `before_reset` backup, then one swap that keeps every Your-data
 * row and one rollback generation (`Undo last reset`). Never touches
 * credentials.
 *
 * Neither the coach nor voice can call these (DX10).
 */

/** Keychain items, cleared on Delete (ios-platform-feasibility: they survive an uninstall). */
export interface CredentialPort {
  /**
   * Remove the sign-in from this phone, then return the online revoke still
   * to run (null: there was no sign-in). The revoke must not write anything
   * locally: it may answer after Delete stopped waiting (review S3).
   */
  signOut(): Promise<{ revokeOnline: (() => Promise<boolean>) | null }>;
  /** Delete every Keychain item GymSmarter owns, by its known keys. Throws if any is still there. */
  wipe(): Promise<void>;
}

/** Your-data files outside the database and the backup folder (settings, crash notes). Throws if one is left. */
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
  /** The unfinished workout, if any: Reset waits for it (DX4); `Finish deleting` leaves its alert alone. */
  activeWorkout?: () => Promise<SessionAggregate | null>;
  /** How long an online sign-out may take before it counts as not confirmed (default 10 s). */
  signOutTimeoutMs?: number;
}

/** The parts of Delete, in the order they run, for an honest message when one fails. */
export const DELETE_STEPS = ['database', 'coach_sign_in', 'alerts', 'backups', 'settings_files'] as const;
export type DeleteStep = (typeof DELETE_STEPS)[number];
/** The order before review r3 B1, for a ledger written by it: a failed step and every later one didn't run. */
const LEGACY_STEPS: readonly DeleteStep[] = ['database', 'alerts', 'backups', 'settings_files', 'coach_sign_in'];

/** The steps still to run, in run order. */
function inRunOrder(steps: Iterable<DeleteStep>): DeleteStep[] {
  const set = new Set(steps);
  return DELETE_STEPS.filter((s) => set.has(s));
}

const OpKind = z.enum(['delete_my_data', 'reset_coaching_knowledge']);
const StepSchema = z.enum(DELETE_STEPS);
const LedgerSchema = z.object({
  version: z.literal(1),
  pending: z
    .object({
      kind: z.literal('delete_my_data'),
      opId: z.string().min(1),
      startedAtUtc: z.string(),
      /** The database swap happened: a resume only finishes the clean-up, it never swaps again. */
      swapped: z.boolean().default(false),
      /** The step that failed first last time, for `Continue` at launch. */
      failedStep: StepSchema.nullable().default(null),
      /** Every step that failed last time (review r3 B1); absent in older ledgers. */
      failedSteps: z.array(StepSchema).optional(),
      /** The sign-out's online result from an earlier run, for the message once a resume finishes (the sign-in is gone by then). */
      signedOutOnline: z.boolean().nullable().optional(),
    })
    .nullable(),
  done: z.array(
    z.object({
      opId: z.string().min(1),
      kind: OpKind,
      atUtc: z.string(),
      /** False when a ChatGPT sign-in was removed from the phone but revoking it online wasn't confirmed. */
      signedOutOnline: z.boolean().nullable(),
      /** Ben chose `Continue` after this step kept failing at launch (the first that failed). */
      unfinished: StepSchema.nullable().default(null),
      /** Every step `Finish deleting` still has to run; absent in older ledgers (then `unfinished` and every later legacy step). */
      remaining: z.array(StepSchema).optional(),
    }),
  ),
});
type Ledger = z.infer<typeof LedgerSchema>;
type Pending = NonNullable<Ledger['pending']>;
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
  /**
   * `deleted`: the swap happened (Your data is gone) and `step` didn't
   * finish; the marker stays and the next launch finishes it. `false`:
   * nothing was deleted and there is no marker. `null`: the swap failed and
   * whether anything was deleted couldn't be checked; the marker stays.
   */
  | { ok: false; reason: 'failed'; message: string; deleted: boolean | null; step: DeleteStep | null };

/** What launch found (check 31). */
export type ResumeOutcome =
  | { kind: 'none' }
  /** An interrupted delete was finished: Ben's data and files are gone. `signedOutOnline` as in `DeleteOutcome`. */
  | { kind: 'finished'; signedOutOnline: boolean | null }
  /** The swap never happened; the marker was cleared. */
  | { kind: 'not_deleted'; message: string }
  /** The swap happened (`deleted: null`: couldn't be checked) but `step` failed again; the marker stays. */
  | { kind: 'unfinished'; deleted: true | null; step: DeleteStep; message: string };

/** The unfinished workout that blocks Reset (DX4). */
export interface WorkoutBlock {
  title: string;
  startedAtUtc: string;
  tz: string;
}

/** A delete left unfinished with `Continue` (review r2 S2). */
export interface DeleteLeftover {
  /** The first step still to run. */
  step: DeleteStep;
  /** Every step `Finish deleting` runs, in order (`coach_sign_in`: it signs out of ChatGPT). */
  steps: DeleteStep[];
  atUtc: string;
}

export type FinishLeftoverOutcome = { ok: true } | { ok: false; step: DeleteStep; message: string };

export type ResetOutcome =
  | { ok: true; duplicate: boolean; status: 'switched' | 'unchanged' }
  | { ok: false; reason: 'stale'; fresh: DataSummary }
  | { ok: false; reason: 'workout_unfinished'; block: WorkoutBlock }
  | { ok: false; reason: 'backup_failed'; message: string }
  | { ok: false; reason: 'failed'; message: string };

export type ExportKind = DataDomain;

export interface ExportFile {
  fileName: string;
  text: string;
  /** Rows in the file; 0: `Nothing to export` (§3.5). */
  records: number;
}

export type ExportSaveResult = { ok: true; fileName: string; destinationLabel: string } | { ok: false; reason: 'inside_app' | 'empty' | 'failed'; message: string };

export const EXPORT_FORMAT = 'fizz-export';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `fallback` when `p` hasn't settled within `ms` or rejects. `p` keeps running; its result is ignored. */
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

class StepFailed extends Error {
  constructor(
    readonly step: DeleteStep,
    readonly deleted: boolean | null,
    cause: unknown,
  ) {
    super(errorText(cause));
  }
}

/** What `Finish deleting` still has to run for a done entry. */
function remainingOf(d: DoneEntry): DeleteStep[] {
  if (d.unfinished === null) return [];
  if (d.remaining !== undefined) return inRunOrder(d.remaining);
  return inRunOrder(LEGACY_STEPS.slice(LEGACY_STEPS.indexOf(d.unfinished)));
}

/** Every step a pending delete's failure left undone. */
function failedOf(p: Pending): DeleteStep[] {
  if (p.failedSteps !== undefined && p.failedSteps.length > 0) return inRunOrder(p.failedSteps);
  return p.failedStep === null ? [...DELETE_STEPS] : inRunOrder(LEGACY_STEPS.slice(LEGACY_STEPS.indexOf(p.failedStep)));
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
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('The data ledger on this phone is damaged.');
    }
    const parsed = LedgerSchema.safeParse(json);
    if (!parsed.success) throw new Error('The data ledger on this phone is damaged.');
    return parsed.data;
  }

  /**
   * After Ben confirmed Delete or Reset (review N1): a damaged ledger is kept
   * aside and started again rather than refusing for ever. Without a way to
   * keep a copy it is still refused.
   */
  async function readLedgerConfirmed(): Promise<Ledger> {
    try {
      return await readLedger();
    } catch (e) {
      if (!deps.ledger.keepDamagedCopy) throw e;
      await deps.ledger.keepDamagedCopy(deps.now().utc.replace(/[:.]/g, '-'));
      await writeLedger(EMPTY);
      return EMPTY;
    }
  }

  async function writeLedger(l: Ledger): Promise<void> {
    await deps.ledger.write(JSON.stringify(l));
  }

  function remember(l: Ledger, entries: DoneEntry[]): Ledger {
    const ids = new Set(entries.map((e) => e.opId));
    return { ...l, pending: null, done: [...l.done.filter((d) => !ids.has(d.opId)), ...entries].slice(-KEEP_DONE) };
  }

  async function summaryNow(): Promise<DataSummary> {
    const [{ counts, stamp }, status] = await Promise.all([deps.manager.domainSummary(), deps.backups.getStatus()]);
    const copy = status.offPhone.lastCopy;
    return { counts, stamp, lastCopyToFiles: copy ? { atUtc: copy.atUtc, tz: copy.tz, destinationLabel: copy.destinationLabel } : null };
  }

  /**
   * Steps 3–8. Every step is safe to repeat. A failure before the swap
   * clears the marker (nothing was deleted); after it, every step still
   * runs and the marker stays with the steps that failed (review r3 B1).
   * `expectedStamp` (first run only): data changed since the confirmation,
   * so nothing is deleted and the marker is cleared.
   */
  async function finishDelete(
    start: Ledger & { pending: Pending },
    opIds: readonly string[],
    expectedStamp?: string,
  ): Promise<{ stale: true } | { stale: false; signedOutOnline: boolean | null }> {
    let l: Ledger & { pending: Pending } = start;
    /** Nothing after the swap ran (or it may not have happened): every step is left. */
    const abort = async (e: unknown, deleted: true | null): Promise<never> => {
      await writeLedger({ ...l, pending: { ...l.pending, failedStep: 'database', failedSteps: [...DELETE_STEPS] } }).catch(() => undefined);
      throw new StepFailed('database', deleted, e);
    };
    const failed: { step: DeleteStep; error: unknown }[] = [];
    if (!l.pending.swapped) {
      const swapped = await deps.manager.deleteYourData(expectedStamp === undefined ? {} : { expectedStamp }).catch(
        (e: unknown): DomainSwitchOutcome => ({ ok: false, error: { code: 'restore_failed', message: errorText(e) } }),
      );
      if (!swapped.ok && swapped.error.code === 'preview_stale') {
        await writeLedger({ ...l, pending: null });
        return { stale: true };
      }
      if (!swapped.ok) {
        // Did the switch happen? Only the clean-up after it can fail with nothing of Ben's left.
        const left = await deps.manager.domainSummary().then(
          (d) => d.counts.yourData.records,
          () => null,
        );
        if (left !== null && left > 0) {
          await writeLedger({ ...l, pending: null }).catch(() => undefined);
          throw new StepFailed('database', false, swapped.error.message);
        }
        // Couldn't check (review r2 N2): never say deleted, and clean up nothing. The marker stays, so a resume finishes it.
        if (left === null) return abort(swapped.error.message, null);
        // Swapped, but the old file is still there: the rest still runs.
        failed.push({ step: 'database', error: swapped.error.message });
      }
      l = { ...l, pending: { ...l.pending, swapped: true } };
      try {
        await writeLedger(l);
      } catch (e) {
        return abort(e, true);
      }
    } else {
      try {
        await deps.manager.forgetPrevious();
      } catch (e) {
        failed.push({ step: 'database', error: e });
      }
    }
    let signedOutOnline: boolean | null = null;
    for (const step of DELETE_STEPS) {
      if (step === 'database') continue;
      try {
        switch (step) {
          case 'coach_sign_in': {
            const now = await signOutAndWipe();
            // A resume finds nothing left to sign out: keep what the run that did it found.
            signedOutOnline = now ?? l.pending.signedOutOnline ?? null;
            l = { ...l, pending: { ...l.pending, signedOutOnline } };
            break;
          }
          case 'alerts':
            // Not `reconcile(null)`: after a relaunch this run doesn't know what is scheduled (review r2 S1).
            if (deps.restAlerts) await deps.restAlerts.cancelAll();
            break;
          case 'backups':
            await deps.backups.wipeOnPhone();
            break;
          case 'settings_files':
            if (deps.personalFiles) await deps.personalFiles.remove();
            break;
        }
      } catch (e) {
        failed.push({ step, error: e });
      }
    }
    const first = failed[0];
    if (first) {
      await writeLedger({ ...l, pending: { ...l.pending, failedStep: first.step, failedSteps: failed.map((f) => f.step) } }).catch(() => undefined);
      throw new StepFailed(first.step, true, first.error);
    }
    const atUtc = deps.now().utc;
    // Every step ran: an earlier delete left unfinished with `Continue` has nothing left either (review r3 S1).
    const cleared: Ledger = { ...l, done: l.done.map((d) => (d.kind === 'delete_my_data' && d.unfinished !== null ? { ...d, unfinished: null, remaining: [] } : d)) };
    await writeLedger(remember(cleared, opIds.map((opId) => ({ opId, kind: 'delete_my_data' as const, atUtc, signedOutOnline, unfinished: null }))));
    return { stale: false, signedOutOnline };
  }

  /** Step 4: the sign-in off this phone, revoked online where possible (bounded), every Keychain item deleted. */
  async function signOutAndWipe(): Promise<boolean | null> {
    if (!deps.credentials) return null;
    let signedOutOnline: boolean | null = null;
    try {
      const out = await deps.credentials.signOut();
      // Offline is fine (§4.5 step 1): the sign-in is already off this phone.
      if (out.revokeOnline !== null) signedOutOnline = await withTimeout(out.revokeOnline(), deps.signOutTimeoutMs ?? 10_000, false);
    } finally {
      // The wipe runs even when the sign-out threw: it is what clears the Keychain.
      await deps.credentials.wipe();
    }
    return signedOutOnline;
  }

  async function workoutBlock(): Promise<WorkoutBlock | null> {
    // A workout that can't be read doesn't block (as Restore, review S2 there).
    const a = deps.activeWorkout ? await deps.activeWorkout().catch(() => null) : null;
    if (!a) return null;
    return { title: a.session.routineName ?? 'Workout', startedAtUtc: a.session.startedAt.utc, tz: a.session.startedAt.tz };
  }

  /**
   * `Finish deleting` (review r2 S2): the steps left undone, never the swap.
   * Every step runs even when one fails (review r3 B1); the failed ones are
   * returned. Anything Ben made since `sinceUtc` (when he chose `Continue`)
   * is kept: backups recorded since, a later restore's Undo copy, the alert
   * of a workout in progress (review r3 N2).
   */
  async function runLeftover(steps: readonly DeleteStep[], sinceUtc: string): Promise<{ step: DeleteStep; error: unknown }[]> {
    const failed: { step: DeleteStep; error: unknown }[] = [];
    for (const step of inRunOrder(steps)) {
      try {
        switch (step) {
          case 'database':
            // A switch since then (restore, reset) already dropped the old file; its copy is Ben's new Undo.
            if (deps.manager.rollbackTarget.last === null) await deps.manager.forgetPrevious();
            break;
          case 'coach_sign_in':
            await signOutAndWipe();
            break;
          case 'alerts':
            if (deps.restAlerts) {
              const active = deps.activeWorkout ? await deps.activeWorkout().catch(() => null) : null;
              await deps.restAlerts.cancelAll(active ? restAlertIdentifier(active.session.id) : undefined);
            }
            break;
          case 'backups':
            await deps.backups.removeOnPhoneBefore(sinceUtc);
            break;
          case 'settings_files':
            if (deps.personalFiles) await deps.personalFiles.remove();
            break;
        }
      } catch (e) {
        failed.push({ step, error: e });
      }
    }
    return failed;
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
    const records = Object.values(body.tables).reduce((n, rows) => n + rows.length, 0);
    return { fileName: `${stem}-${localStamp(toMs(at.utc), at.tz)}.json`, text: JSON.stringify(file, null, 1), records };
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
          l = await readLedgerConfirmed();
        } catch (e) {
          return { ok: false, reason: 'failed', message: errorText(e), deleted: false, step: null };
        }
        const done = l.done.find((d) => d.opId === req.opId && d.kind === 'delete_my_data');
        if (done) return { ok: true, duplicate: true, signedOutOnline: done.signedOutOnline };
        let expectedStamp: string | undefined;
        let pending: Ledger & { pending: Pending };
        if (l.pending === null) {
          expectedStamp = req.stamp;
          const fresh = await summaryNow();
          if (fresh.stamp !== req.stamp) return { ok: false, reason: 'stale', fresh };
          // A backup in progress finishes first; `wipeOnPhone` then deletes it with the rest.
          await deps.backups.whenIdle();
          pending = { ...l, pending: { kind: 'delete_my_data', opId: req.opId, startedAtUtc: deps.now().utc, swapped: false, failedStep: null } };
          try {
            await writeLedger(pending);
          } catch (e) {
            return { ok: false, reason: 'failed', message: describeWriteError(e), deleted: false, step: null };
          }
        } else {
          // An earlier delete that didn't finish: this confirmation finishes it (review N3).
          pending = { ...l, pending: l.pending };
        }
        const opIds = [...new Set([pending.pending.opId, req.opId])];
        try {
          const r = await finishDelete(pending, opIds, expectedStamp);
          if (r.stale) return { ok: false, reason: 'stale', fresh: await summaryNow() };
          return { ok: true, duplicate: false, signedOutOnline: r.signedOutOnline };
        } catch (e) {
          if (e instanceof StepFailed) return { ok: false, reason: 'failed', message: e.message, deleted: e.deleted, step: e.step };
          return { ok: false, reason: 'failed', message: errorText(e), deleted: false, step: null };
        }
      });
    },

    /**
     * Launch: a delete that was interrupted is finished before anything is
     * shown (check 31). A ledger that can't be read is left alone here: Ben
     * hasn't confirmed anything this run.
     */
    resumeInterrupted(): Promise<ResumeOutcome> {
      return queued(async (): Promise<ResumeOutcome> => {
        let l: Ledger;
        try {
          l = await readLedger();
        } catch {
          return { kind: 'none' };
        }
        if (l.pending === null) return { kind: 'none' };
        try {
          const r = await finishDelete({ ...l, pending: l.pending }, [l.pending.opId]);
          return { kind: 'finished', signedOutOnline: r.stale ? null : r.signedOutOnline };
        } catch (e) {
          if (e instanceof StepFailed && e.deleted !== false) return { kind: 'unfinished', deleted: e.deleted, step: e.step, message: e.message };
          return { kind: 'not_deleted', message: errorText(e) };
        }
      });
    },

    /**
     * `Continue` on the launch screen after a resume kept failing: the
     * marker is cleared and the step recorded as unfinished, so the app
     * opens (rule 1), a later launch never retries over new data, and Data &
     * backup offers `Finish deleting`. When the swap may not have happened,
     * the data decides: still there means nothing was deleted (no record).
     */
    leaveInterrupted(): Promise<{ step: DeleteStep | null }> {
      return queued(async () => {
        const l = await readLedger();
        if (l.pending === null) return { step: null };
        if (!l.pending.swapped) {
          const left = await deps.manager.domainSummary().then(
            (d) => d.counts.yourData.records,
            () => null,
          );
          if (left !== null && left > 0) {
            await writeLedger({ ...l, pending: null });
            return { step: null };
          }
        }
        const remaining = failedOf(l.pending);
        const step = remaining[0] ?? 'database';
        await writeLedger(remember(l, [{ opId: l.pending.opId, kind: 'delete_my_data', atUtc: deps.now().utc, signedOutOnline: null, unfinished: step, remaining }]));
        return { step };
      });
    },

    /** The newest delete left unfinished with `Continue`, if any (Data & backup's warning line). */
    async leftover(): Promise<DeleteLeftover | null> {
      const l = await readLedger().catch(() => EMPTY);
      const entries = l.done.filter((d) => d.kind === 'delete_my_data' && d.unfinished !== null);
      const steps = inRunOrder(entries.flatMap(remainingOf));
      const newest = entries.at(-1);
      const step = steps[0];
      return newest && step ? { step, steps, atUtc: newest.atUtc } : null;
    },

    /** `Finish deleting`: re-run the clean-up left undone, never the swap. Safe to repeat. */
    finishLeftover(): Promise<FinishLeftoverOutcome> {
      return queued(async (): Promise<FinishLeftoverOutcome> => {
        let l: Ledger;
        try {
          l = await readLedger();
        } catch (e) {
          return { ok: false, step: 'database', message: errorText(e) };
        }
        const entries = l.done.filter((d) => d.kind === 'delete_my_data' && d.unfinished !== null);
        const steps = inRunOrder(entries.flatMap(remainingOf));
        const since = entries.reduce<string | null>((a, d) => (a === null || d.atUtc > a ? d.atUtc : a), null);
        if (steps.length === 0 || since === null) return { ok: true };
        const failed = await runLeftover(steps, since);
        const left = failed.map((f) => f.step);
        const mark: Ledger = {
          ...l,
          done: l.done.map((d) => (d.kind === 'delete_my_data' && d.unfinished !== null ? { ...d, unfinished: left[0] ?? null, remaining: left } : d)),
        };
        const first = failed[0];
        if (first) {
          await writeLedger(mark).catch(() => undefined);
          return { ok: false, step: first.step, message: errorText(first.error) };
        }
        try {
          await writeLedger(mark);
        } catch (e) {
          return { ok: false, step: steps[0] ?? 'database', message: describeWriteError(e) };
        }
        return { ok: true };
      });
    },

    /** `Reset coaching knowledge`. Your data is never changed; one rollback generation is kept (`Undo last reset`). */
    resetCoachingKnowledge(req: { opId: string; stamp: string }): Promise<ResetOutcome> {
      return queued(async (): Promise<ResetOutcome> => {
        let l: Ledger;
        try {
          l = await readLedgerConfirmed();
        } catch (e) {
          return { ok: false, reason: 'failed', message: errorText(e) };
        }
        if (l.done.some((d) => d.opId === req.opId && d.kind === 'reset_coaching_knowledge')) return { ok: true, duplicate: true, status: 'unchanged' };
        // A set logged while the files switch would be lost (store writes don't take the manager lock), and Undo would be blocked (review r2 S3).
        const block = await workoutBlock();
        if (block) return { ok: false, reason: 'workout_unfinished', block };
        const fresh = await summaryNow();
        if (fresh.stamp !== req.stamp) return { ok: false, reason: 'stale', fresh };
        await deps.backups.whenIdle();
        const backup = await deps.backups.backUpOnPhone('before_reset');
        if (!backup.ok) return { ok: false, reason: 'backup_failed', message: backup.error };
        const at = deps.now();
        const r = await deps.manager.resetKnowledge(deps.bundledKnowledge(at.utc), { expectedStamp: req.stamp, at });
        if (!r.ok) {
          if (r.error.code === 'preview_stale') return { ok: false, reason: 'stale', fresh: await summaryNow() };
          return { ok: false, reason: 'failed', message: r.error.message };
        }
        await writeLedger(remember(l, [{ opId: req.opId, kind: 'reset_coaching_knowledge', atUtc: deps.now().utc, signedOutOnline: null, unfinished: null }])).catch(() => undefined);
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
        if (file.records === 0) return { ok: false, reason: 'empty', message: 'Nothing to export' };
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
