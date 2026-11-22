import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SummaryScreen } from '../../src/screens/workout/SummaryScreen';
import type { AppServices } from '../../src/services/app-services';
import { FakeHealth } from '../fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';

/**
 * (Ben, 22 Nov; docs/design/prototypes/summary-v2-22nov.html, `Proposed`) The Summary v2 on a real-shaped Pull B:
 * real SQLite and services, a fake HealthKit. His earlier Pull B (Mon 9 Nov): pull-ups BW × 9, rows 95 × 10, lateral
 * raises 10 kg each × 12, lat pulldowns 75 × 12 (lat pulldowns on two more days, so a heavier set is a record). Sat
 * 21 Nov 17:21–18:13: one pull-up set of three (cut short), rows 97.5 × 8 (a best for 8 reps: rows are tracked at 8),
 * lateral raises × 13, lat pulldowns 80 × 12, linked to a Garmin strength workout (avg 128 bpm, 410 kcal).
 */

const MIN = 60_000;
const plain = (s: string) => s.replaceAll(' ', ' ');

let h: Harness;
let fake: FakeHealth;
beforeEach(() => {
  // Mon 9 Nov 2026, 17:00 in London (GMT).
  h = createHarness('2026-11-09T17:00:00.000Z');
  fake = new FakeHealth();
});
afterEach(async () => {
  await h.cleanup();
});

async function rename(s: AppServices, sessionId: string, name: string) {
  const a = (await s.workout.load(sessionId))?.aggregate;
  if (a === undefined) throw new Error('no workout');
  const r = await s.workout.dispatch(sessionId, { type: 'rename_session', at: h.now(), opId: h.ids(), name, expectedVersion: a.session.version });
  if (!r.ok) throw new Error(r.error.message);
}

/** Sat 21 Nov: each exercise's planned sets, the first `n` logged at `load × reps`; the rest left (cut short). */
async function pullB(s: AppServices, gymId: string, rows: { exercise: string; load: number | null; reps: number; n: number }[]): Promise<string> {
  const started = await s.workout.start({ gymId, opId: h.ids(), checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  for (const row of rows) {
    const pick = (await s.workout.pickerExercises(sessionId, row.exercise)).find((p) => p.exercise.name === row.exercise);
    if (pick === undefined) throw new Error(`no ${row.exercise}`);
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
    const ex = added.aggregate.exercises.at(-1);
    if (ex === undefined) throw new Error('no exercise');
    for (const w of added.aggregate.sets.filter((x) => x.sessionExerciseId === ex.id && x.setType === 'warmup')) {
      const d = await s.workout.dispatch(sessionId, { type: 'delete_set', at: h.now(), opId: h.ids(), setId: w.id, expectedSetVersion: w.version });
      if (!d.ok) throw new Error(d.error.message);
    }
    let work = added.aggregate.sets.filter((x) => x.sessionExerciseId === ex.id && x.setType !== 'warmup').sort((a, b) => a.index - b.index);
    // Sets as many as logged, when the plan had fewer.
    while (work.length < row.n) {
      const r = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: h.ids(), sessionExerciseId: ex.id, newSetId: h.ids(), setType: null });
      if (!r.ok) throw new Error(r.error.message);
      work = r.aggregate.sets.filter((x) => x.sessionExerciseId === ex.id && x.setType !== 'warmup' && x.status !== 'deleted').sort((a, b) => a.index - b.index);
    }
    for (const set of work.slice(0, row.n)) {
      h.clockMs += 3 * MIN;
      const values = { load: row.load === null ? null : { value: row.load, unit: ex.unit, convention: ex.loadConvention }, reps: row.reps, durationS: null, rpe: 8, rir: null };
      const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}:0`, setId: set.id, values, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    }
  }
  h.clockMs = Date.parse('2026-11-21T18:13:00.000Z');
  const a = (await s.workout.load(sessionId))?.aggregate;
  const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: a?.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  await rename(s, sessionId, 'Pull B');
  return sessionId;
}

describe('Summary v2 on Pull B (Ben, 22 Nov)', () => {
  it('title, date, three numbers, Garmin, Highlights (best, heaviest, cut short), Vs last time, Next time changed-only with per-row Undo', async () => {
    const launched = await h.launch({ health: { port: fake, buildIncludesHealth: true } });
    const s = launched.services;
    const gymId = await setUpGym(h, s);

    // Mon 9 Nov: Pull B.
    const first = await logWorkout(h, s, gymId, [
      { exercise: 'Pull-up', sets: [{ load: null, reps: 9 }, { load: null, reps: 9 }, { load: null, reps: 8 }] },
      { exercise: 'Barbell row', sets: [{ load: 95, reps: 10, rpe: 8 }, { load: 95, reps: 10, rpe: 8 }, { load: 95, reps: 10, rpe: 8 }] },
      { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12, rpe: 8 }, { load: 10, reps: 12, rpe: 8 }, { load: 10, reps: 12, rpe: 8 }] },
      { exercise: 'Lat pulldown', sets: [{ load: 75, reps: 12, rpe: 8 }, { load: 75, reps: 12, rpe: 8 }] },
    ]);
    await rename(s, first, 'Pull B');
    // Two more lat-pulldown days (a heavier set needs 3 earlier workouts to be a record).
    for (const date of ['2026-11-12T17:00:00.000Z', '2026-11-16T17:00:00.000Z']) {
      h.clockMs = Date.parse(date);
      await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 75, reps: 12, rpe: 8 }] }]);
    }
    // Rows tracked at 8 reps (Progress › Lifts).
    const rowId = (await s.workout.load(first))?.aggregate.exercises.find((e) => e.exerciseName === 'Barbell row')?.exerciseId ?? '';
    const version = (await s.reviews.progress())?.trainingVersion ?? 1;
    expect(await s.training.change({ kind: 'progress_lifts', exerciseIds: [rowId], reps: { [rowId]: 8 } }, version, h.ids())).toMatchObject({ ok: true });

    // Sat 21 Nov, 17:21.
    h.clockMs = Date.parse('2026-11-21T17:21:00.000Z');
    const startMs = h.clockMs;
    const sessionId = await pullB(s, gymId, [
      { exercise: 'Pull-up', load: null, reps: 8, n: 1 },
      { exercise: 'Barbell row', load: 97.5, reps: 8, n: 3 },
      { exercise: 'Lateral raise', load: 10, reps: 13, n: 3 },
      { exercise: 'Lat pulldown', load: 80, reps: 12, n: 2 },
    ]);
    // The Garmin strength workout, linked.
    const garmin = fake.addGarmin({ activityType: 50, startMs: startMs - 2 * MIN, endMs: startMs + 53 * MIN, sourceName: 'Connect', avgHeartRate: 128, activeKcal: 410 });
    await s.health.setSwitch('readActivities', true);
    await s.health.setSwitch('readHeartRate', true);
    await s.health.readNow();
    if ((await s.health.forWorkout(sessionId)).kind !== 'linked') expect((await s.health.link({ healthUuid: garmin, sessionId, opId: h.ids() })).ok).toBe(true);

    const r = await renderScreen(h, launched, SummaryScreen, { name: 'Summary', params: { sessionId } }, (t) => t.includes('Next time') && t.includes('Garmin'));
    expectHealthy(r);
    const text = plain(r.text());
    const at = (needle: string) => {
      const i = text.indexOf(needle);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return i;
    };

    // 1. Title and date.
    expect(text).toContain('Pull B done');
    expect(text).toMatch(/Sat 21 Nov · 0?5:21\s?PM–0?6:13\s?PM|Sat 21 Nov · 17:21–18:13/);
    // No plan in use: no plan line.
    expect(text).not.toContain('Week ');

    // 2. Three numbers: 52 min, 9 working sets, volume (rows 3 × 97.5 × 8 + raises 3 × 2 × 10 × 13 + pulldowns 2 × 80 × 12 =
    // 5,040 kg; the pull-ups are bodyweight, left out).
    expect(text).toContain('52|min|9|sets|5 t|volume');
    // The comparable workout (the last Pull B) wasn't the same saved workout or plan day: no arrow.
    expect(text).not.toMatch(/volume\|[↑↓]/);

    // 3. Garmin: only the values Health has.
    expect(text).toContain('Garmin · avg 128 bpm · 410 kcal');

    // 4. Highlights: the row's best for 8 reps, the pulldown's heaviest, the pull-up cut short; rings by kind.
    const hl = text.slice(at('Highlights'), at('Vs last time'));
    expect(hl).toContain('Barbell row|Best for 8 reps|97.5 kg × 8');
    expect(hl).toContain('Lat pulldown|Heaviest yet|80 kg × 12');
    expect(hl).toMatch(/Pull-up\|Cut short\|1 of \d sets/);
    expect(r.all((n) => n.props.testID === 'ring-best')).toHaveLength(2);
    expect(r.all((n) => n.props.testID === 'ring-short')).toHaveLength(1);

    // 5. Vs last time: best set today against the last time, a plain change.
    const vs = text.slice(at('Vs last time'), at('Next time'));
    expect(vs).toContain('Pull-up|Last: BW × 9 · Mon 9 Nov|BW × 8|↓ 1 rep');
    expect(vs).toContain('Barbell row|Last: 95 kg × 10 · Mon 9 Nov|97.5 kg × 8|↑ 2.5 kg · 2 fewer reps');
    expect(vs).toContain('Lateral raise|Last: 10 kg ea × 12 · Mon 9 Nov|10 kg ea × 13|↑ 1 rep');
    expect(vs).toContain('Lat pulldown|Last: 75 kg × 12 · Mon 16 Nov|80 kg × 12|↑ 5 kg');

    // 6. Next time: only what changes, each with its own Undo; Why? only behind a tap on the row.
    const next = text.slice(at('Next time'), at('How did it feel?'));
    expect(next).not.toContain('Why?');
    expect(next).not.toContain('Same ·');
    const undos = r.all((n) => typeof n.props.accessibilityLabel === 'string' && (n.props.accessibilityLabel).startsWith('Undo: keep ') && typeof n.props.onPress === 'function');
    expect(undos.length).toBeGreaterThanOrEqual(1);
    const firstUndo = undos[0]?.props.accessibilityLabel as string;
    const name = firstUndo.replace('Undo: keep ', '').replace(' as it was', '');
    await act(async () => {
      (undos[0]?.props.onPress as () => void)();
      await Promise.resolve();
    });
    await r.waitFor((t) => t.includes(`${name}|Same · `) && t.includes('Redo'), 'the held row');
    // That one row only: the others keep their Undo.
    expect(r.all((n) => typeof n.props.accessibilityLabel === 'string' && (n.props.accessibilityLabel).startsWith('Undo: keep ')).length).toBe(undos.length - 1);
    expect((await s.coach.ruleHolds(sessionId)).map((x) => [x.exerciseName, x.status])).toEqual([[name, 'applied']]);

    // 7. How did it feel? and Done.
    expect(at('How did it feel?')).toBeLessThan(at('|Done'));
    expect(r.errors).toEqual([]);
    await r.unmount();
  });
});
