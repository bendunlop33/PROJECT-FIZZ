import type { Exercise, SessionAggregate, SessionCommand } from '@fizz/schemas';
import { reduceSession, startWorkout } from '../src/index';
import { at, barbell, exercise, GYM, id, idGen, kg, profile, routine, routineExercise, stack, template, values } from './fixtures';

/**
 * A realistic, large training history for performance tests (backup review):
 * `weeks` × `perWeek` finished workouts of 5 exercises × 4 working sets, every
 * set logged with load, reps and RPE. 2 years × 4/week = 416 workouts, 8,320 sets.
 */

export const HISTORY_EXERCISES: readonly Exercise[] = [
  exercise(200, 'Bench press', { defaultRestS: 120 }),
  exercise(204, 'Back squat', { defaultRestS: 180 }),
  exercise(201, 'Cable row', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' }),
  exercise(205, 'Lat pulldown', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' }),
  exercise(202, 'Face pull', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' }),
];

function historyRoutine() {
  return routine(
    HISTORY_EXERCISES.map((ex, i) => {
      const onBar = ex.defaultLoadConvention === 'total';
      return routineExercise(800 + i, {
        exerciseId: ex.id,
        equipmentId: onBar ? barbell().id : stack().id,
        order: i,
        setTemplates: [0, 1, 2, 3].map((n) =>
          template(8000 + i * 10 + n, { targetLoad: onBar ? kg(80 + i * 10) : kg(40, 'stack'), targetReps: { min: 6, max: 10 } }),
        ),
      });
    }),
  );
}

export function largeHistory(opts: { weeks?: number; perWeek?: number } = {}): SessionAggregate[] {
  const weeks = opts.weeks ?? 104;
  const perWeek = opts.perWeek ?? 4;
  const total = weeks * perWeek;
  const r = historyRoutine();
  const exercises = new Map(HISTORY_EXERCISES.map((e) => [e.id, e]));
  const gymEquipment = [barbell(), stack()];
  const owner = profile();
  const dayS = 86_400;
  const out: SessionAggregate[] = [];
  let timer = 5_000_000;
  for (let k = 0; k < total; k += 1) {
    // Oldest first, ending the day before T0; workouts ~1.75 days apart.
    const startS = -Math.round(((total - k) * 7 * dayS) / perWeek) + 3600;
    let s = startWorkout({
      opId: `hist-start-${String(k)}`,
      owner,
      gymId: GYM,
      routine: r,
      exercises,
      gymEquipment,
      at: at(startS),
      newId: idGen(1_000_000 + k * 100),
    }).aggregate;
    const apply = (cmd: SessionCommand) => {
      const res = reduceSession(s, cmd);
      if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
      s = res.state;
    };
    let t = startS + 60;
    let n = 0;
    while (s.session.activeSetId !== null) {
      const setId = s.session.activeSetId;
      const set = s.sets.find((x) => x.id === setId);
      timer += 1;
      apply({
        type: 'log_set',
        at: at(t),
        opId: `hist-${String(k)}-log-${String(n)}`,
        setId,
        values: values(set?.planned.load ?? kg(40, 'stack'), 6 + ((k + n) % 5), { rpe: 7 + ((k + n) % 4) * 0.5 }),
        restTimerId: id(timer),
      });
      t += 150;
      n += 1;
    }
    apply({ type: 'finish', at: at(t), opId: `hist-${String(k)}-finish`, expectedVersion: s.session.version, endedAt: null });
    out.push(s);
  }
  return out;
}

/**
 * Run `fn` while a 0 ms timer chain ticks, and report the longest gap between
 * ticks: how long the JS thread was blocked in one go (taps, timers and
 * renders wait that long on the phone).
 */
export async function measureBlocking<T>(fn: () => Promise<T>): Promise<{ result: T; totalMs: number; maxBlockMs: number }> {
  let last = performance.now();
  let maxBlockMs = 0;
  let running = true;
  const tick = () => {
    const now = performance.now();
    maxBlockMs = Math.max(maxBlockMs, now - last);
    last = now;
    if (running) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  const start = performance.now();
  const result = await fn();
  const totalMs = performance.now() - start;
  running = false;
  tick();
  return { result, totalMs, maxBlockMs };
}
