import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP } from '@fizz/domain';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/** Repeat last workout / Start from a past workout through the services (routines.md checks 13, 17). */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

describe('repeat a past workout', () => {
  it('lists past workouts, previews the targets, starts once per opId with nothing done', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 10 }, { load: 80, reps: 6 }] }]);
    h.clockMs += 86_400_000;
    const second = await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 45, reps: 10 }] }]);
    const list = (await s.repeat.candidates()).rows;
    expect(list.map((c) => [c.sessionId, c.exerciseNames, c.sets, c.gymName])).toEqual([
      [second, ['Lat pulldown'], 1, 'Main Gym'],
      [first, ['Bench press'], 2, 'Main Gym'],
    ]);

    h.clockMs += 86_400_000;
    const preview = await s.repeat.preview(first, gymId);
    expect(preview?.exercises.map((e) => [e.exerciseName, plain(e.line)])).toEqual([['Bench press', '2 sets · 60 kg × 10 · 80 kg × 6']]);
    expect(await s.sessions.active()).toBeNull();

    const req = { gymId, opId: 'repeat-1', checkIn: null, repeatOf: first };
    const [a, b] = [await s.workout.start(req), await s.workout.start(req)];
    expect(a.ok && b.ok && b.duplicate && a.aggregate.session.id === b.aggregate.session.id).toBe(true);
    const data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(data.aggregate.sets.every((x) => x.status === 'pending')).toBe(true);
    const v = s.workout.view(data, h.clockMs, null);
    expect(plain(v.focus?.target)).toBe('Target 60 kg · 10 reps @ RPE 8.5');
    expect(plain(v.primary.label)).toBe('Log 60 kg × 10');
    // One workout at a time.
    expect(await s.workout.start({ ...req, opId: 'repeat-2' })).toMatchObject({ ok: false, error: { code: 'session_already_active' } });
  });

  it('hotel gym with only dumbbells: Repeat plans no barbell load, keeps reps, and says so (review B1)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const benchDay = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 5 }] }]);
    const hotelId = h.ids();
    expect(await s.setup.saveGym({ gymId: hotelId, name: 'Hotel Gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).toEqual({ ok: true });
    const hotelKinds = (await s.yourData.equipment(hotelId)).map((e) => e.kind);
    expect(hotelKinds).not.toContain('barbell');

    h.clockMs += 86_400_000;
    const preview = await s.repeat.preview(benchDay, hotelId);
    expect(preview?.notes.map((n) => plain(n.text))).toEqual(['No load target · no barbell and plates here · last time 100 kg × 5']);
    expect(preview?.notes.some((n) => n.text.includes('Kept as done'))).toBe(false);

    const started = await s.workout.start({ gymId: hotelId, opId: 'repeat-hotel', checkIn: null, repeatOf: benchDay });
    if (!started.ok) throw new Error(started.error.message);
    const sets = started.aggregate.sets;
    expect(sets.map((x) => [x.status, x.planned.load, x.planned.reps])).toEqual([['pending', null, { min: 5, max: 5 }]]);
    const data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const v = s.workout.view(data, h.clockMs, null);
    expect(plain(v.focus?.target)).not.toContain('100 kg');
  });
});
