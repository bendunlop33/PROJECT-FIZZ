import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Domain from '@fizz/domain';
import type { SessionCommand } from '@fizz/schemas';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Review r2 N1: `correctSet` when the session write throws after the pain
 * flag was written. The session service is wrapped so a test can make
 * `correct_set` throw before or after it commits.
 */
type FaultMode = 'none' | 'before' | 'after';
const fault = vi.hoisted((): { mode: FaultMode } => ({ mode: 'none' }));

vi.mock('@fizz/domain', async (importOriginal) => {
  const real = await importOriginal<typeof Domain>();
  return {
    ...real,
    createSessionService: (...args: Parameters<typeof real.createSessionService>) => {
      const svc = real.createSessionService(...args);
      return {
        ...svc,
        dispatch: async (sessionId: string, command: SessionCommand) => {
          if (command.type === 'correct_set' && fault.mode === 'before') throw new Error('disk I/O error');
          const r = await svc.dispatch(sessionId, command);
          if (command.type === 'correct_set' && fault.mode === 'after') throw new Error('disk I/O error');
          return r;
        },
      };
    },
  };
});

let h: Harness;
beforeEach(() => {
  h = createHarness();
  fault.mode = 'none';
});
afterEach(async () => {
  fault.mode = 'none';
  await h.cleanup();
});

async function firstBenchSet() {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const sessionId = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2].map(() => ({ load: 100, reps: 8, rpe: 7 })) }]);
  const set = (await s.workout.load(sessionId))?.aggregate.sets.filter((x) => x.status === 'completed').sort((x, y) => x.index - y.index)[0];
  if (!set) throw new Error('fixture');
  return { s, sessionId, set };
}

describe('correctSet when the session write throws (review r2 N1)', () => {
  it('a throw before the mark lands takes the flag back, so "wasn’t saved" is true; a retry flags once', async () => {
    const { s, sessionId, set } = await firstBenchSet();
    fault.mode = 'before';
    const r = await s.workout.correctSet({ sessionId, setId: set.id, expectedSetVersion: set.version, patch: { exclusions: ['pain'] }, opId: 'sheet' });
    expect(r).toEqual({ ok: false, stale: false, message: 'The change wasn’t saved. Try again.' });
    expect(await s.pain.active()).toEqual([]);

    fault.mode = 'none';
    const retry = await s.workout.correctSet({ sessionId, setId: set.id, expectedSetVersion: set.version, patch: { exclusions: ['pain'] }, opId: 'sheet' });
    expect(retry).toMatchObject({ ok: true, toast: 'Set 1: pain · not counted for records · pain flag on Bench press' });
    expect(await s.pain.active()).toHaveLength(1);
  });

  it('a throw after the mark landed keeps the flag and says it was saved', async () => {
    const { s, sessionId, set } = await firstBenchSet();
    fault.mode = 'after';
    const r = await s.workout.correctSet({ sessionId, setId: set.id, expectedSetVersion: set.version, patch: { exclusions: ['pain'] }, opId: 'sheet' });
    expect(r).toEqual({ ok: false, stale: true, message: 'Saved. Showing the latest.' });
    expect(await s.pain.active()).toHaveLength(1);
    expect((await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === set.id)?.exclusions).toEqual(['pain']);
  });
});
