import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COMMON_EXERCISE_IDS, NBSP, pickerSections } from '@fizz/domain';

import { createHarness, logWorkout, type Harness } from './harness';

/**
 * Fresh install to a second session through the app services (audit B1, B2,
 * B4, F4): a usable gym without a gym step, a first exercise with a plan and
 * a rest after every set, force-close during rest, Finish, and the next
 * session at the targets the Summary promised.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

describe('first run: install to first set', () => {
  it('a typical gym in one tap, once, with every item marked not checked; setup moves on', async () => {
    const { services: s } = await h.launch();
    expect((await s.setup.getState()).step).toBe('welcome');
    await s.setup.saveUnits('kg');
    const [a, b] = await Promise.all([s.setup.useTypicalGym(), s.setup.useTypicalGym()]);
    expect(a.ok && b.ok && a.gymId === b.gymId).toBe(true);
    const gyms = await s.yourData.gyms();
    expect(gyms.map((g) => [g.name, g.isDefault])).toEqual([['Main gym', true]]);
    const items = await s.yourData.equipment(gyms[0]?.id ?? '');
    expect(items.map((i) => i.kind).sort()).toEqual(['assisted_stack', 'barbell', 'bodyweight_station', 'dumbbells', 'plate_loaded_machine', 'weight_stack', 'weight_stack']);
    expect(items.every((i) => i.detailsSource === 'preset' && i.unit === 'kg')).toBe(true);
    expect((await s.setup.getState()).step).toBe('data');
    // Again later (Today's Start with no gym): the existing gym, nothing new.
    await s.setup.complete();
    expect((await s.setup.useTypicalGym()).gymId).toBe(a.ok ? a.gymId : '');
    expect(await s.yourData.gyms()).toHaveLength(1);
  });

  it('lb phone: the typical gym is in lb (45 lb bar), never converted', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('lb');
    await s.setup.useTypicalGym();
    const gym = (await s.yourData.gyms())[0];
    const bar = (await s.yourData.equipment(gym?.id ?? '')).find((i) => i.kind === 'barbell');
    expect(bar).toMatchObject({ unit: 'lb', barMass: 45 });
  });

  it('start → common lifts first → Bench press with 3 sets → log → rest → force-close → all done → Add exercise', async () => {
    let { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gym = await s.setup.useTypicalGym();
    await s.setup.complete();
    const gymId = gym.ok ? (gym.gymId ?? '') : '';
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;

    // Picker: the saved list first (fast), then the whole catalogue; common lifts on top.
    const quick = await s.workout.pickerExercises(sessionId, '');
    const full = await s.workout.pickerExercises(sessionId, '', { withCatalogue: true });
    expect(full.length).toBeGreaterThan(quick.length + 50);
    const sections = pickerSections(full, '', []);
    expect(sections.map((x) => x.title)).toEqual(['Common lifts', 'All exercises']);
    expect(sections[0]?.items.map((p) => p.exercise.id)).toEqual(COMMON_EXERCISE_IDS);
    const bench = sections[0]?.items[0];
    expect(bench?.exercise.name).toBe('Bench press');
    expect(bench?.equipment.map((e) => e.kind)).toEqual(['barbell']);

    const added = await s.workout.addExercise({ sessionId, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId: 'add-bench' });
    if (!added.ok) throw new Error(added.error.message);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    let v = s.workout.view(data, h.clockMs, null);
    expect(v.title).toBe('Push');
    expect(v.focus?.setCount).toBe(3);
    expect(v.primary).toEqual({ kind: 'enter', field: 'load', label: 'Enter load' });

    // Ben types 60: the label says exactly what will be saved.
    const edits = { setId: v.focus?.setId ?? '', values: { ...(v.focus?.draft ?? { load: null, reps: null, durationS: null, rpe: null, rir: null }), load: { value: 60, unit: 'kg' as const, convention: 'total' as const } } };
    v = s.workout.view(data, h.clockMs, edits);
    expect(plain(v.primary.label)).toBe('Log 60 kg × 6');
    h.clockMs += 30_000;
    const log1 = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v.focus?.opId ?? '', setId: v.focus?.setId ?? '', values: v.focus?.logValues ?? edits.values, restTimerId: h.ids() });
    expect(log1.ok).toBe(true);
    await h.settle(s);
    expect(h.pending.size).toBe(1);

    // Force-close during the rest; reopen: the rest is still running, set 2 is prefilled.
    await h.forceClose();
    h.clockMs += 20_000;
    const relaunch = await h.launch();
    s = relaunch.services;
    expect(relaunch.recovery?.openInto).toBe('active_workout');
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    v = s.workout.view(data, h.clockMs, null);
    expect(v.rest).toMatchObject({ kind: 'running', remainingMs: 160_000 });
    expect(plain(v.upNext)).toBe('Set 2 · 3–6 reps');
    expect(plain(v.primary.label)).toBe('Log 60 kg × 6');

    // Sets 2 and 3: the last one so far still rests, and the primary adds the next exercise.
    for (let i = 0; i < 2; i += 1) {
      h.clockMs += 200_000;
      data = await s.workout.load();
      if (!data) throw new Error('no workout');
      v = s.workout.view(data, h.clockMs, null);
      const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v.focus?.opId ?? '', setId: v.focus?.setId ?? '', values: v.focus?.logValues ?? edits.values, restTimerId: h.ids() });
      expect(r.ok).toBe(true);
    }
    await h.settle(s);
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    v = s.workout.view(data, h.clockMs, null);
    expect(v.focus).toBeNull();
    expect(v.rest).toMatchObject({ kind: 'running' });
    expect(v.primary).toEqual({ kind: 'add_exercise', label: 'Add exercise' });
    expect(h.pending.size).toBe(1);

    // A catalogue exercise not in the starter list is saved when added.
    const extra = (await s.workout.pickerExercises(sessionId, '', { withCatalogue: true })).find((p) => !COMMON_EXERCISE_IDS.includes(p.exercise.id) && p.equipment.length > 0);
    if (!extra) throw new Error('no catalogue exercise');
    const addExtra = await s.workout.addExercise({ sessionId, exerciseId: extra.exercise.id, equipmentId: extra.equipment[0]?.id ?? null, opId: 'add-extra' });
    expect(addExtra.ok).toBe(true);
    expect((await s.coachingKnowledge.exercises()).some((e) => e.id === extra.exercise.id)).toBe(true);

    // Finish cancels the rest alert.
    data = await s.workout.load();
    const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'fin', expectedVersion: data?.aggregate.session.version ?? 0, endedAt: null });
    expect(fin.ok).toBe(true);
    await h.settle(s);
    expect(h.pending.size).toBe(0);
  });
});

describe('next session (audit B2)', () => {
  it('Today previews the last workout with the Summary’s next targets, and Start uses them', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gym = await s.setup.useTypicalGym();
    await s.setup.complete();
    const gymId = gym.ok ? (gym.gymId ?? '') : '';
    expect(await s.next.preview(gymId)).toBeNull();

    const first = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 6, rpe: 7 }, { load: 60, reps: 6, rpe: 7 }, { load: 60, reps: 6, rpe: 8 }] },
      { exercise: 'Triceps pushdown', sets: [{ load: 30, reps: 12, rpe: 8 }, { load: 30, reps: 12, rpe: 8 }] },
    ]);
    const summary = await s.workout.summary(first);
    const benchNext = summary?.nextTime?.rows.find((e) => e.exerciseName === 'Bench press');
    expect(plain(benchNext?.target)).toBe('Target 62.5 kg × 3–6');

    // D-Today's lift highlight: the first weighted lift's top set, from the stored workout.
    const lift = await s.today.liftHighlight();
    expect(lift?.exerciseName).toBe('Bench press');
    expect(plain(lift?.text)).toBe('60 kg × 6');
    expect(lift?.points).toEqual([60]);

    h.clockMs += 2 * 86_400_000;
    const preview = await s.next.preview(gymId);
    expect(preview).toMatchObject({ sourceSessionId: first, title: 'Push', muscles: 'Chest · Triceps' });
    expect(preview?.exercises.map((e) => e.exerciseName)).toEqual(['Bench press', 'Triceps pushdown']);
    // Bench at the top of 3–6 at RPE ≤ 8: the built-in rule adds load (snapped to the bar and plates).
    expect(plain(preview?.exercises[0]?.line)).toBe('3 sets · 62.5 kg × 3–6 · 62.5 kg × 3–6 · 62.5 kg × 3–6');
    expect(await s.sessions.active()).toBeNull();

    const req = { gymId, opId: 'next-1', checkIn: null, nextOf: first };
    const [a, b] = [await s.workout.start(req), await s.workout.start(req)];
    expect(a.ok && b.ok && b.duplicate && a.aggregate.session.id === b.aggregate.session.id).toBe(true);
    const data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(data.aggregate.session.routineName).toBe('Push');
    const v = s.workout.view(data, h.clockMs, null);
    expect(v.title).toBe('Push');
    expect(v.openEnded).toBe(false);
    expect(plain(v.focus?.target)).toBe('Target (built-in rule) 62.5 kg · 3–6 reps');
    expect(plain(v.primary.label)).toBe('Log 62.5 kg × 6');
  });
});
