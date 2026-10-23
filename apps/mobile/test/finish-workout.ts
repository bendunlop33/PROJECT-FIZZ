import type { AppServices } from '../src/services/app-services';
import type { Harness } from './harness';

/** Log the first working set and finish, so the Summary reads the workout as done (and the next Start can run). A bodyweight set with no planned load logs 0 (no external load). */
export async function finishWorkout(h: Harness, s: AppServices, sessionId: string): Promise<void> {
  const a = (await s.workout.load(sessionId))?.aggregate;
  const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup');
  if (a === undefined || set === undefined) throw new Error('no set');
  const conv = a.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
  h.clockMs += 60_000;
  const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: conv === 'bodyweight' ? 0 : 20, unit: 'kg', convention: conv }, reps: set.planned.reps?.min ?? 8, durationS: set.planned.durationS, rpe: 8, rir: null }, restTimerId: h.ids() });
  if (!logged.ok) throw new Error(logged.error.message);
  h.clockMs += 60_000;
  const now = await s.workout.load(sessionId);
  const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
}

/**
 * (D1) Start a builder draft as it stands (one tap), log a set and finish, then read the Summary's `Keep for next
 * time?` lines (none: no row). Replaces the retired Start prompt in tests that check Time and Today's own drafting are
 * never offered for the plan.
 */
export async function keepLinesAfterStart(h: Harness, s: AppServices, snap: { draftId: string; version: number }, gymId: string): Promise<string[]> {
  const r = await s.builder.start(snap.draftId, { opId: h.ids(), expectedVersion: snap.version, gymId, checkIn: null });
  if (!r.ok) throw new Error(r.message);
  await finishWorkout(h, s, r.sessionId);
  const view = await s.builder.keepNextTimeOf(r.sessionId);
  return view?.state === 'open' ? view.lines : [];
}
