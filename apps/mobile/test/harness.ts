import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toIso, toMs } from '@fizz/domain';
import { idGen } from '@fizz/domain/testing';
import type { ZonedTimestamp } from '@fizz/schemas';

import { createRestAlertController, type NotifierPort, type PlannedRestAlert } from '../src/alerts/rest-alerts';
import type { BackupFileStore, TextFile } from '../src/backup/backup-service';
import { createExpoDatabaseHost } from '../src/data/expo-driver';
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
  now: () => ZonedTimestamp;
  launch: () => Promise<Extract<StartupOutcome, { kind: 'ready' }>>;
  settle: (s: AppServices) => Promise<void>;
  forceClose: () => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * `start` is the phone's clock at first launch; `idStart` seeds its ID
 * generator. Two phones (a reinstall on another day) need both to differ,
 * as real installs do (review R1).
 */
export function createHarness(start = '2026-10-08T17:00:00.000Z', opts: { idStart?: number; coach?: StartupDeps['coach'] } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'fizz-harness-'));
  let dbNames = 0;
  let manifestText: string | null = null;
  const open: AppServices[] = [];
  const h: Harness = {
    dir,
    clockMs: toMs(start),
    ids: idGen(opts.idStart ?? 1),
    backupFiles: new Map(),
    pending: new Map(),
    now: () => ({ utc: toIso(h.clockMs), tz: TZ }),
    async launch() {
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
      };
      const o = await startApp({
        host: createExpoDatabaseHost(fakeHostDeps(dir)),
        newDatabaseName: () => `training-${String(++dbNames)}.db`,
        backupFiles: files,
        backupManifest: manifest,
        now: h.now,
        newId: h.ids,
        app: { name: 'GymSmarter', version: '0.1.0', build: 'test' },
        locale: 'en-GB',
        restAlerts: createRestAlertController(notifier),
        ...(opts.coach === undefined ? {} : { coach: opts.coach }),
      });
      if (o.kind !== 'ready') throw new Error(o.kind);
      open.push(o.services);
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
