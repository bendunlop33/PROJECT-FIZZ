import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf, TIME_STEP_RULES, workingCount } from '@fizz/domain';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import { workoutView } from '../src/builder/builder-view';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 2 Nov: "When I add or subtract time from the next up workout it jumps massively and doesn't allow me to select
 * say a 5 or 10 min workout longer") Your workout's Time `−`/`+` as the screen taps it (the view's step, `grow` on `+`,
 * `step` on both), on real SQLite through the builder service, offline: every tap lands within 3 minutes of its
 * 5-minute step, both ways, the next tap steps from the length held, each tap is one versioned write with its own op
 * ID (a replay changes nothing, a stale version is refused), and Undo puts the workout back as it was.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-05T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const opened = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status === 'written' || r.status === 'replayed') return r.snapshot;
  throw new Error(`write ${r.status}: ${r.message}`);
};

/** A five-exercise push day saved from a logged workout (bench, incline DB, face pull, pushdown, lateral raise). */
async function pushDay(s: AppServices) {
  const gymId = await setUpGym(h, s);
  const three = (load: number, reps: number) => [0, 1, 2].map(() => ({ load, reps, rpe: 8 }));
  const sid = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: three(100, 6) },
    { exercise: 'Incline dumbbell press', sets: three(27.5, 9) },
    { exercise: 'Face pull', sets: three(20, 12) },
    { exercise: 'Triceps pushdown', sets: three(30, 12) },
    { exercise: 'Lateral raise', sets: three(8, 12) },
  ]);
  h.clockMs += DAY;
  const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId: sid }, name: 'Push B', addToRotation: true, opId: 'save-push-b' });
  if (!r.ok) throw new Error(r.message);
  return r.routine;
}

/** One tap as BuilderWorkoutScreen's `setTime({ dir })` makes it. */
async function tap(s: AppServices, snap: BuilderSnapshot, dir: -1 | 1, opId: string): Promise<{ snap: BuilderSnapshot; to: number }> {
  const t = workoutView(snap).time;
  const to = dir < 0 ? t.less : t.more;
  if (to === null) throw new Error(`no step ${String(dir)}`);
  const r = await s.builder.setTime(snap.draftId, to, { opId, expectedVersion: snap.version, step: dir, ...(dir > 0 ? { grow: true } : {}) });
  return { snap: opened(r), to };
}

const sets = (x: BuilderSnapshot) => slotsOf(x.workout.blocks).reduce((n, sl) => n + workingCount(sl), 0);

describe('Your workout Time ± lands near each 5-minute step (Ben, 2 Nov)', () => {
  it('up four taps and down eight: each lands within 3 minutes of its step, steps stay 5 minutes apart', async () => {
    const { services: s } = await h.launch();
    const routine = await pushDay(s);
    let snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-step'));
    const start = snap.minutes;
    const log: string[] = [`start ${String(start)}`];
    for (const [i, dir] of ([1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1] as const).entries()) {
      const before = snap.minutes;
      const heldBefore = snap.setup.minutes;
      const r = await tap(s, snap, dir, `tap-${String(i)}`);
      snap = r.snap;
      log.push(`${dir > 0 ? '+' : '−'} ${String(before)} → ${String(r.to)}: ${String(snap.minutes)}`);
      // Moves the way asked, lands within 3 of the length it fitted to; that length is a 5-minute step.
      if (dir > 0) expect(snap.minutes, log.join('\n')).toBeGreaterThan(before);
      else expect(snap.minutes, log.join('\n')).toBeLessThan(before);
      expect(snap.setup.minutes % 5).toBe(0);
      expect(Math.abs(snap.minutes - snap.setup.minutes), log.join('\n')).toBeLessThanOrEqual(TIME_STEP_RULES.nearMin);
      // Steps from the held length: 5 minutes on from the last one (after the first tap off the opening length).
      if (i > 0 && i !== 4) expect(Math.abs(snap.setup.minutes - heldBefore), log.join('\n')).toBe(5);
      // No warning tone for Time's own landing.
      expect(workoutView(snap).time.over).toBe(false);
      expect(workoutView(snap).overLine).toBeNull();
    }
    // The main lift's working sets are never cut for time.
    const bench = slotsOf(snap.workout.blocks).find((sl) => sl.main);
    expect(workingCount(bench ?? { rows: [] })).toBeGreaterThanOrEqual(3);
  });

  it('a tap is one versioned write: its op ID again is a replay (nothing more changes), an old version is refused', async () => {
    const { services: s } = await h.launch();
    const routine = await pushDay(s);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-idem'));
    const to = workoutView(snap0).time.more ?? 0;
    const first = opened(await s.builder.setTime(snap0.draftId, to, { opId: 'plus-1', expectedVersion: snap0.version, grow: true, step: 1 }));
    expect(sets(first)).toBeGreaterThan(sets(snap0));
    const again = await s.builder.setTime(snap0.draftId, to, { opId: 'plus-1', expectedVersion: snap0.version, grow: true, step: 1 });
    expect(again.status).toBe('replayed');
    expect((await s.builder.read(snap0.draftId))?.version).toBe(first.version);
    const stale = await s.builder.setTime(snap0.draftId, to + 5, { opId: 'plus-stale', expectedVersion: snap0.version, grow: true, step: 1 });
    expect(stale.status).not.toBe('written');
    expect((await s.builder.read(snap0.draftId))?.version).toBe(first.version);
  });

  it('survives a restart: the held length and the fit read back, and the next tap steps on from them', async () => {
    const { services: s } = await h.launch();
    const routine = await pushDay(s);
    let snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-restart'));
    snap = (await tap(s, snap, -1, 'cut-1')).snap;
    snap = (await tap(s, snap, -1, 'cut-2')).snap;
    const held = snap.setup.minutes;
    const { services: s2 } = await h.launch();
    const back = await s2.builder.read(snap.draftId);
    if (back === null) throw new Error('no draft');
    expect(back.setup.minutes).toBe(held);
    expect(back.minutes).toBe(snap.minutes);
    const next = (await tap(s2, back, -1, 'cut-3')).snap;
    expect(next.setup.minutes).toBe(held - 5);
    expect(Math.abs(next.minutes - next.setup.minutes)).toBeLessThanOrEqual(TIME_STEP_RULES.nearMin);
  });

  it('Undo (the Time detail) after several taps puts the workout back as it opened', async () => {
    const { services: s } = await h.launch();
    const routine = await pushDay(s);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-undo'));
    let snap = snap0;
    for (const [i, dir] of ([-1, -1, -1] as const).entries()) snap = (await tap(s, snap, dir, `cut-u-${String(i)}`)).snap;
    expect(snap.time?.changes.length ?? 0).toBeGreaterThan(0);
    const undo = workoutView(snap).time.undoMinutes;
    if (undo === null) throw new Error('no undo');
    const back = opened(await s.builder.setTime(snap.draftId, undo, { opId: 'undo-all', expectedVersion: snap.version }));
    expect(back.time).toBeNull();
    expect(slotsOf(back.workout.blocks).map((sl) => `${sl.exerciseId}×${String(workingCount(sl))}`)).toEqual(slotsOf(snap0.workout.blocks).map((sl) => `${sl.exerciseId}×${String(workingCount(sl))}`));
  });

  it('the screen sends `step` with each tap and none with Undo (source)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'screens', 'builder', 'BuilderWorkoutScreen.tsx'), 'utf8');
    expect(src).toContain("const tap = 'to' in step ? {} : { step: step.dir };");
  });
});
