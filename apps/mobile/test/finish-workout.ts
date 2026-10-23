import type { AppServices } from '../src/services/app-services';
import type { Harness } from './harness';

/** Log the first working set and finish, so the Summary reads the workout as done (and the next Start can run). */
export async function finishWorkout(h: Harness, s: AppServices, sessionId: string): Promise<void> {
  const a = (await s.workout.load(sessionId))?.aggregate;
  const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup');
  if (a === undefined || set === undefined) throw new Error('no set');
  const conv = a.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
  h.clockMs += 60_000;
  const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: conv }, reps: set.planned.reps?.min ?? 8, durationS: set.planned.durationS, rpe: 8, rir: null }, restTimerId: h.ids() });
  if (!logged.ok) throw new Error(logged.error.message);
  h.clockMs += 60_000;
  const now = await s.workout.load(sessionId);
  const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
}
