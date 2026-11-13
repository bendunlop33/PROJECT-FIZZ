import { describe, expect, it } from 'vitest';

import { applyTrainingChange, newLiftTarget, newTrainingProfile, type LiftTargetChoice } from '@fizz/domain';
import type { TrainingProfile } from '@fizz/schemas';

import { createLiftTargetService } from '../src/services/lift-target-service';

/** Review S3: a history read error is unknown, never "nothing logged" (rule 6). */

const OWNER = '00000000-0000-4000-8000-000000000002';
const BENCH = '00000000-0000-4000-8000-0000000000b1';
const choice: LiftTargetChoice = { exerciseId: BENCH, name: 'Bench Press', convention: 'total', unit: 'kg', plateLoaded: false, lastDate: '2026-10-13' };

function profileWithTarget(): TrainingProfile {
  let p = newTrainingProfile({ id: '00000000-0000-4000-8000-000000000001', ownerId: OWNER, atUtc: '2026-10-13T08:00:00.000Z' });
  const at = { atUtc: '2026-10-13T09:00:00.000Z', nowYear: 2026, today: '2026-10-13' };
  for (const [i, c] of [{ kind: 'lift_targets_on', on: true } as const, { kind: 'set_lift_target', target: newLiftTarget({ id: 't1', choice, kind: 'one_rm', value: 100, unit: 'kg', reps: 1, byDate: null, atUtc: at.atUtc, today: at.today, setBy: 'ben' }, []) } as const].entries()) {
    const r = applyTrainingChange(p, c, { opId: `op-${String(i)}`, expectedVersion: p.version, ...at });
    if (!r.ok) throw new Error('setup');
    p = r.profile;
  }
  return p;
}

function service(history: () => Promise<null>) {
  const profile = profileWithTarget();
  return createLiftTargetService({
    training: { snapshot: () => Promise.resolve({ profile }) as never, change: () => Promise.reject(new Error('no writes')) },
    history,
    exercises: () => Promise.resolve(new Map()),
    now: () => ({ utc: '2026-10-20T09:00:00.000Z', tz: 'Europe/London' }),
  });
}

describe('lift targets when history can’t be read (review S3)', () => {
  it.each([
    ['throws', () => Promise.reject(new Error('db'))],
    ['returns nothing', () => Promise.resolve(null)],
  ])('history %s: rows read Couldn’t load, nothing can be added, the coach is told it is unknown', async (_label, history) => {
    const s = service(history);
    const view = await s.view();
    expect(view).toMatchObject({ on: true, historyUnreadable: true, canAdd: false });
    expect(view?.lines.map((l) => [l.detail, l.hit, l.progress])).toEqual([['Couldn’t load', null, null]]);
    expect((await s.forExercise(BENCH))?.line?.detail).toBe('Couldn’t load');
    expect(await s.coachViews()).toEqual([expect.objectContaining({ exercise: 'Bench Press', historyUnreadable: true, hit: null })]);
    const prepared = await s.prepare({ exercise: 'Bench Press', kind: 'one_rm', load: 105, unit: 'kg', reps: null, byDate: null }, { targetId: 'x', nowUtc: '2026-10-20T09:00:00.000Z' });
    expect(prepared.ok).toBe(false);
  });
});
