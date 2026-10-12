import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toIso, toMs } from '@fizz/domain';
import { idGen } from '@fizz/domain/testing';
import type { ZonedTimestamp } from '@fizz/schemas';

import { createRestAlertController, type NotifierPort, type PlannedRestAlert } from '../src/alerts/rest-alerts';
import type { BackupFileStore, TextFile } from '../src/backup/backup-service';
import { createLiveActivityController, type LiveActivityPort } from '../src/live-activity/controller';
import { createExpoDatabaseHost } from '../src/data/expo-driver';
import { createPersonalFiles, type ContainerFileOps } from '../src/device/personal-files';
import type { AppServices } from '../src/services/app-services';
import { startApp, type StartupDeps, type StartupOutcome } from '../src/services/startup';
import { fakeHostDeps } from './fake-expo-sqlite';

/**
 * A whole app on real SQLite files (the expo-sqlite stand-in), with in-memory
 * backup files, a fake notifier and a controllable clock. Launch, force-close
 * and relaunch like the phone does.
 */
export const TZ = 'Europe/London';

export interface Harness {
  dir: string;
  clockMs: number;
  ids: () => string;
  backupFiles: Map<string, string>;
  pending: Map<string, PlannedRestAlert>;
  /** The notifier refuses to cancel every workout alert (Delete's `alerts` step). */
  alertsFail: boolean;
  /** Training database files can't be deleted (e.g. the old file after Delete's swap). */
  failDbRemove: boolean;
  /** Small files in Documents besides the backup record and the data ledger (prefs, coach settings, crash notes, damaged copies). */
  documents: Map<string, string>;
  /** `tmp/`: the document picker's copies (`<bundle>-Inbox/<name>`) and anything else temporary. */
  tmp: Map<string, string>;
  /** `Library/Caches/`. */
  cache: Map<string, string>;
  now: () => ZonedTimestamp;
  launch: () => Promise<Extract<StartupOutcome, { kind: 'ready' }>>;
  /** Launch and return whatever startup returned (`interruptedDelete` as Root passes it). */
  start: (extra?: { interruptedDelete?: 'finish' | 'leave'; /** Background backups wait for it (main's idle rule). */ idle?: () => Promise<void> }) => Promise<StartupOutcome>;
  /**
   * Every file in the app's container, by path: backups, the backup record,
   * the data ledger, other Documents files, tmp, Caches, and every SQLite
   * file (training, meta, probe; read as text so strings can be searched).
   */
  containerFiles: () => Map<string, string>;
  settle: (s: AppServices) => Promise<void>;
  forceClose: () => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * `start` is the phone's clock at first launch; `idStart` seeds its ID
 * generator. Two phones (a reinstall on another day) need both to differ,
 * as real installs do (review R1).
 */
export function createHarness(
  start = '2026-10-08T17:00:00.000Z',
  opts: {
    idStart?: number;
    coach?: StartupDeps['coach'];
    credentials?: StartupDeps['credentials'];
    personalFiles?: StartupDeps['personalFiles'];
    signOutTimeoutMs?: number;
    /** The data ledger can be damaged or failing in a test. */
    ledger?: TextFile;
    /** A fake Live Activity system; each launch gets a fresh controller over it, as a relaunch does. */
    liveActivity?: LiveActivityPort;
  } = {},
): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'fizz-harness-'));
  let dbNames = 0;
  let manifestText: string | null = null;
  // The Delete my data marker survives a force-close like any file in the container.
  let ledgerText: string | null = null;
  const open: AppServices[] = [];
  // The same Your-data file list as the phone (Root), over the in-memory container.
  const containerOps: ContainerFileOps = {
    removeDocuments(names, matching) {
      for (const n of [...h.documents.keys()]) if (names.includes(n) || names.includes(n.replace(/\.tmp$/, '')) || matching.test(n)) h.documents.delete(n);
      return Promise.resolve();
    },
    removeDatabaseFiles(name) {
      for (const n of [name, `${name}-wal`, `${name}-shm`]) rmSync(join(dir, n), { force: true });
      const left = [name, `${name}-wal`, `${name}-shm`].filter((n) => existsSync(join(dir, n)));
      return left.length > 0 ? Promise.reject(new Error(`Couldn’t delete ${left.join(', ')}`)) : Promise.resolve();
    },
    emptyTemporary() {
      h.tmp.clear();
      h.cache.clear();
      return Promise.resolve({ systemLeft: [] });
    },
  };
  const h: Harness = {
    dir,
    clockMs: toMs(start),
    ids: idGen(opts.idStart ?? 1),
    backupFiles: new Map(),
    pending: new Map(),
    alertsFail: false,
    failDbRemove: false,
    documents: new Map(),
    tmp: new Map(),
    cache: new Map(),
    now: () => ({ utc: toIso(h.clockMs), tz: TZ }),
    async launch() {
      const o = await h.start();
      if (o.kind !== 'ready') throw new Error(o.kind);
      return o;
    },
    containerFiles() {
      const all = new Map([...h.backupFiles].map(([n, t]) => [`backups/${n}`, t]));
      if (manifestText !== null) all.set('backup-state.json', manifestText);
      if (ledgerText !== null) all.set('data-ops.json', ledgerText);
      for (const [n, t] of h.documents) all.set(n, t);
      for (const [n, t] of h.tmp) all.set(`tmp/${n}`, t);
      for (const [n, t] of h.cache) all.set(`Caches/${n}`, t);
      for (const n of readdirSync(dir)) all.set(`SQLite/${n}`, readFileSync(join(dir, n), 'latin1'));
      return all;
    },
    async start(extra = {}) {
      const files: BackupFileStore = {
        write: (n, t) => {
          h.backupFiles.set(n, t);
          return Promise.resolve();
        },
        read: (n) => Promise.resolve(h.backupFiles.get(n) ?? null),
        remove: (n) => {
          h.backupFiles.delete(n);
          return Promise.resolve();
        },
        list: () => Promise.resolve([...h.backupFiles.keys()]),
      };
      const manifest: TextFile = {
        read: () => Promise.resolve(manifestText),
        write: (t) => {
          manifestText = t;
          return Promise.resolve();
        },
      };
      const notifier: NotifierPort = {
        schedule: (a) => {
          h.pending.set(a.identifier, a);
          return Promise.resolve();
        },
        cancel: (id) => {
          h.pending.delete(id);
          return Promise.resolve();
        },
        cancelAllWorkoutAlerts: (keep) => {
          if (h.alertsFail) return Promise.reject(new Error('1 scheduled alert(s) couldn’t be cancelled'));
          for (const id of [...h.pending.keys()]) if (id.startsWith('fizz.rest.') && id !== keep) h.pending.delete(id);
          return Promise.resolve();
        },
      };
      const hostDeps = fakeHostDeps(dir);
      const o = await startApp({
        host: createExpoDatabaseHost({
          ...hostDeps,
          deleteDatabase: (n) => (h.failDbRemove && n.startsWith('training-') ? Promise.reject(new Error(`EBUSY: ${n}`)) : hostDeps.deleteDatabase(n)),
        }),
        newDatabaseName: () => `training-${String(++dbNames)}.db`,
        backupFiles: files,
        backupManifest: manifest,
        now: h.now,
        newId: h.ids,
        app: { name: 'GymSmarter', version: '0.1.0', build: 'test' },
        locale: 'en-GB',
        restAlerts: createRestAlertController(notifier, opts.liveActivity ? { liveActivity: createLiveActivityController(opts.liveActivity, { tz: () => TZ }) } : {}),
        ...(opts.coach === undefined ? {} : { coach: opts.coach }),
        dataLedger: opts.ledger ?? {
          read: () => Promise.resolve(ledgerText),
          write: (t) => {
            ledgerText = t;
            return Promise.resolve();
          },
        },
        ...(opts.credentials === undefined ? {} : { credentials: opts.credentials }),
        personalFiles: opts.personalFiles ?? createPersonalFiles(containerOps),
        ...(opts.signOutTimeoutMs === undefined ? {} : { signOutTimeoutMs: opts.signOutTimeoutMs }),
        ...extra,
      });
      if (o.kind === 'ready') open.push(o.services);
      return o;
    },
    async settle(s) {
      for (let i = 0; i < 200 && s.backups.isRunning; i += 1) await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => setTimeout(r, 20));
    },
    async forceClose() {
      for (const s of open.splice(0)) {
        await h.settle(s);
        await s.close().catch(() => undefined);
      }
    },
    async cleanup() {
      await h.forceClose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return h;
}

/** First run: kg, a commercial gym from the preset, done. Returns the gym ID. */
export async function setUpGym(h: Harness, s: AppServices, preset: 'commercial' | 'home_dumbbells' = 'commercial'): Promise<string> {
  await s.setup.saveUnits('kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: s.coachingKnowledge.buildGymDraft(preset, 'kg') });
  await s.setup.complete();
  const gym = await s.yourData.currentGym();
  if (!gym) throw new Error('no gym');
  return gym.id;
}

export interface LoggedSet {
  load: number | null;
  reps: number;
  rpe?: number;
}

/**
 * Start an empty workout, add each exercise (by name) with the gym's first
 * compatible equipment, log the given sets, and finish. Returns the session ID.
 */
export async function logWorkout(h: Harness, s: AppServices, gymId: string, plan: { exercise: string; sets: LoggedSet[]; /** The item's name; default the first compatible one. */ equipment?: string }[]): Promise<string> {
  const started = await s.workout.start({ gymId, opId: `start-${String(h.clockMs)}`, checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  for (const item of plan) {
    const picks = await s.workout.pickerExercises(sessionId, item.exercise);
    const pick = picks.find((p) => p.exercise.name === item.exercise);
    if (!pick) throw new Error(`no exercise ${item.exercise}`);
    const chosen = item.equipment === undefined ? pick.equipment[0] : pick.equipment.find((e) => e.name === item.equipment);
    if (item.equipment !== undefined && chosen === undefined) throw new Error(`no ${item.equipment} for ${item.exercise}`);
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: chosen?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
    const ex = added.aggregate.exercises.at(-1);
    if (!ex) throw new Error('no exercise');
    // Sets may already be planned (built-in rule); add or remove to match.
    let own = added.aggregate.sets.filter((x) => x.sessionExerciseId === ex.id);
    for (let i = own.length; i < item.sets.length; i += 1) {
      const r = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: h.ids(), sessionExerciseId: ex.id, newSetId: h.ids(), setType: null });
      if (!r.ok) throw new Error(r.error.message);
      own = r.aggregate.sets.filter((x) => x.sessionExerciseId === ex.id);
    }
    for (const extra of own.slice(item.sets.length)) {
      const r = await s.workout.dispatch(sessionId, { type: 'delete_set', at: h.now(), opId: h.ids(), setId: extra.id, expectedSetVersion: extra.version });
      if (!r.ok) throw new Error(r.error.message);
    }
    const ordered = [...own].sort((a, b) => a.index - b.index).slice(0, item.sets.length);
    for (const [i, set] of item.sets.entries()) {
      const target = ordered[i];
      if (!target) throw new Error('no set');
      h.clockMs += 60_000;
      const values = {
        load: set.load === null ? null : { value: set.load, unit: ex.unit, convention: ex.loadConvention },
        reps: set.reps,
        durationS: null,
        rpe: set.rpe ?? null,
        rir: null,
      };
      const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${target.id}:0`, setId: target.id, values, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    }
  }
  h.clockMs += 60_000;
  const data = await s.workout.load(sessionId);
  const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: data?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  return sessionId;
}
