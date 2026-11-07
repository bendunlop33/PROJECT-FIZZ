import { join } from 'node:path';

import { bundledCatalogue, toExerciseRow } from '@fizz/catalogue';
import { catalogueExerciseId, equipmentHere, reduceSession, startWorkout, toIso } from '@fizz/domain';
import { id, idGen, routine, routineExercise, template } from '@fizz/domain/testing';
import { openStore } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { Exercise, Load, SessionAggregate, SessionCommand } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Ben's realistic phone for the perf lane (23 Oct "so slow"): years of FitNotes-sized history on one
 * gym (`sessions` workouts of ~26 logged sets each; 800 → ~21k sets) in a 4-day upper/lower rotation of
 * catalogue exercises (barbell, per-hand dumbbells, stacks), written straight into the training
 * database as finished workouts, then an applied 4-day builder plan on top (built from that history).
 */

/** The rotation: catalogue key, base load (kg; per hand for dumbbells), working sets. */
const ROTATION: readonly (readonly [string, number, number][])[] = [
  [
    ['barbell-bench-press', 70, 4],
    ['barbell-bent-over-row', 60, 4],
    ['barbell-overhead-press', 40, 3],
    ['cable-lat-pulldown', 55, 4],
    ['dumbbell-lateral-raise', 8, 4],
    ['cable-rope-triceps-pushdown', 25, 3],
    ['dumbbell-curl', 12, 3],
  ],
  [
    ['barbell-back-squat', 90, 4],
    ['barbell-romanian-deadlift', 80, 4],
    ['machine-leg-press', 140, 4],
    ['machine-lying-leg-curl', 40, 4],
    ['machine-standing-calf-raise', 60, 4],
    ['cable-crunch', 30, 3],
  ],
  [
    ['dumbbell-incline-bench-press', 26, 4],
    ['cable-seated-row', 55, 4],
    ['dumbbell-seated-shoulder-press', 20, 4],
    ['cable-face-pull', 20, 4],
    ['ez-bar-skull-crusher', 30, 3],
    ['dumbbell-hammer-curl', 14, 3],
    ['machine-pec-deck', 45, 3],
  ],
  [
    ['barbell-deadlift', 120, 4],
    ['barbell-front-squat', 60, 4],
    ['dumbbell-bulgarian-split-squat', 16, 3],
    ['machine-leg-extension', 50, 4],
    ['machine-seated-leg-curl', 45, 4],
    ['machine-seated-calf-raise', 40, 4],
  ],
];

export interface BigDataset {
  h: Harness;
  s: AppServices;
  gymId: string;
  sessions: number;
  sets: number;
}

const DAY_MS = 86_400_000;

/**
 * A harness (real SQLite files) with `sessions` finished workouts ending yesterday, one gym, and (when
 * `plan`) an applied 4-day builder plan. The clock is Monday 19 Oct 2026, 07:00 UTC.
 */
export async function bigDataset(opts: { sessions?: number; plan?: boolean } = {}): Promise<BigDataset> {
  const total = opts.sessions ?? Number(process.env['FIZZ_PERF_SESSIONS'] ?? 800);
  const h = createHarness('2026-10-19T07:00:00.000Z', { idStart: 1 });
  let { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const profile = await s.yourData.profile();
  if (profile === null) throw new Error('no profile');
  const dbName = s.developer.databaseNames().current;
  await h.forceClose();

  // Straight into the training file, as a FitNotes import leaves it (finished workouts with logged sets).
  const store = await openStore(openNodeDriver(join(h.dir, dbName)));
  const equipment = await store.repos.equipment.listByGym(gymId);
  const at = '2026-10-10T00:00:00.000Z';
  const byKey = new Map<string, Exercise>();
  for (const entry of bundledCatalogue().catalogue.entries) {
    const row = toExerciseRow(entry, at);
    if (row.ok) byKey.set(entry.key, row.exercise);
  }
  const nowMs = h.clockMs;
  let sets = 0;
  let timer = 90_000_000;
  for (let k = 0; k < total; k += 1) {
    const day = ROTATION[k % ROTATION.length] ?? [];
    // ~4 a week, oldest first, the last one yesterday evening.
    const startMs = nowMs - Math.round(((total - k) * 7 * DAY_MS) / 4) - 12 * 3_600_000 + 3_600_000 * 18;
    const progress = 0.8 + (0.4 * k) / total;
    const exercises = new Map<string, Exercise>();
    const rows = day.flatMap(([key, base, n], i) => {
      const e = byKey.get(key);
      if (e === undefined) throw new Error(`no catalogue ${key}`);
      exercises.set(e.id, e);
      const convention = e.defaultLoadConvention;
      const load: Load = { value: Math.round(base * progress), unit: 'kg', convention };
      const item = equipmentHere(e, { gym: { id: gymId, name: 'Main Gym', equipment } }).equipment;
      return [
        routineExercise(70_000 + i, {
          exerciseId: e.id,
          equipmentId: item?.id ?? null,
          order: i,
          setTemplates: Array.from({ length: n }, (_, j) => template(700_000 + i * 10 + j, { targetLoad: load, targetReps: { min: 6, max: 10 } })),
        }),
      ];
    });
    const r = { ...routine(rows), id: id(60_000 + (k % ROTATION.length)), ownerId: profile.id, name: ['Upper A', 'Lower A', 'Upper B', 'Lower B'][k % 4] ?? 'Workout' };
    const zoned = (ms: number) => ({ utc: toIso(ms), tz: profile.timezone });
    let a: SessionAggregate = startWorkout({ opId: `big-start-${String(k)}`, owner: profile, gymId, routine: r, exercises, gymEquipment: equipment, at: zoned(startMs), newId: idGen(10_000_000 + k * 200) }).aggregate;
    const apply = (cmd: SessionCommand) => {
      const res = reduceSession(a, cmd);
      if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
      a = res.state;
    };
    let t = startMs + 60_000;
    let n = 0;
    while (a.session.activeSetId !== null) {
      const setId = a.session.activeSetId;
      const set = a.sets.find((x) => x.id === setId);
      const ex = a.exercises.find((e) => e.id === set?.sessionExerciseId);
      const unilateral = a.exercises.find((e) => e.id === set?.sessionExerciseId)?.laterality === 'unilateral';
      timer += 1;
      apply({
        type: 'log_set',
        at: zoned(t),
        opId: `big-${String(k)}-log-${String(n)}`,
        setId,
        values: { load: set?.planned.load ?? (ex === undefined || ex.loadConvention === 'bodyweight' ? null : { value: 20, unit: ex.unit, convention: ex.loadConvention }), reps: 6 + ((k + n) % 5), durationS: null, rpe: 7 + ((k + n) % 4) * 0.5, rir: null },
        restTimerId: id(timer),
        ...(unilateral && set?.pairedWithSetId === null ? { side: 'left' as const } : {}),
      });
      t += 150_000;
      n += 1;
    }
    apply({ type: 'finish', at: zoned(t), opId: `big-${String(k)}-finish`, expectedVersion: a.session.version, endedAt: null });
    sets += a.sets.filter((x) => x.status === 'completed').length;
    const saved = await store.repos.sessions.save(a, null);
    if (!saved.ok) throw new Error(`history ${String(k)} not saved`);
  }
  await store.close();

  ({ services: s } = await h.launch());
  if (opts.plan !== false) {
    const session = await s.planBuilder.open();
    if (session === null) throw new Error('no builder');
    const answers = { ...session.answers, split: 'ul' as const, sessions: 4, days: [0, 1, 3, 4] };
    const built = await s.planBuilder.save(session, answers, null, h.ids());
    if (!built.ok) throw new Error(`not built: ${built.reason}`);
    const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
    if (!applied.ok) throw new Error('not applied');
  }
  return { h, s, gymId, sessions: total, sets };
}

/** The catalogue ID of a rotation exercise (for tests that need one). */
export const bigDatasetExerciseId = (key: string): string => catalogueExerciseId(key);
