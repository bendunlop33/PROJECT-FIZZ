import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COMMON_EXERCISE_IDS, NBSP, pickerSections } from '@fizz/domain';

import { unitLockedText } from '../src/services/setup';
import { TARGETS_UNAVAILABLE } from '../src/services/workout-services';

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
    expect(items.map((i) => i.kind).sort()).toEqual(['assisted_stack', 'barbell', 'bench', 'bodyweight_station', 'dumbbells', 'ez_bar', 'kettlebell', 'plate_loaded_machine', 'rack', 'smith_machine', 'trap_bar', 'weight_stack', 'weight_stack']);
    expect(items.every((i) => i.detailsSource === 'preset' && i.unit === 'kg')).toBe(true);
    expect((await s.setup.getState()).step).toBe('data');
    // Again later (Today's Start with no gym): the existing gym, nothing new.
    await s.setup.complete();
    expect((await s.setup.useTypicalGym()).gymId).toBe(a.ok ? a.gymId : '');
    expect(await s.yourData.gyms()).toHaveLength(1);
  });

  it('an archived typical gym is never reused: Start makes a fresh one (review S5)', async () => {
    let { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const first = await s.setup.useTypicalGym();
    if (!first.ok || first.gymId === undefined) throw new Error('gym');
    const file = s.developer.databaseNames().current;
    await h.forceClose();
    const db = new DatabaseSync(join(h.dir, file));
    db.prepare("UPDATE gyms SET data = json_set(data, '$.archivedAtUtc', '2026-10-10T07:30:00.000Z') WHERE id = ?").run(first.gymId);
    db.close();
    s = (await h.launch()).services;
    const [a, b] = await Promise.all([s.setup.useTypicalGym(), s.setup.useTypicalGym()]);
    if (!a.ok || !b.ok) throw new Error('typical gym');
    expect(a.gymId).toBe(b.gymId);
    expect(a.gymId).not.toBe(first.gymId);
    expect((await s.yourData.gyms()).map((g) => g.id)).toEqual([a.gymId]);
  });

  it('lb phone: the typical gym is in lb (45 lb bar), never converted', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('lb');
    await s.setup.useTypicalGym();
    const gym = (await s.yourData.gyms())[0];
    const bar = (await s.yourData.equipment(gym?.id ?? '')).find((i) => i.kind === 'barbell');
    expect(bar).toMatchObject({ unit: 'lb', barMass: 45 });
  });

  it('Back to units after the gym is saved: a different unit is refused, the gym and profile stay in one unit (bug: lb shown, kg loads)', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    await s.setup.useTypicalGym();
    const r = await s.setup.saveUnits('lb');
    expect(r.ok).toBe(false);
    expect((await s.setup.getState()).profile?.preferredUnit).toBe('kg');
    const gym = (await s.yourData.gyms())[0];
    expect((await s.yourData.equipment(gym?.id ?? '')).every((i) => i.unit === 'kg')).toBe(true);
    // The same unit again is still fine (Continue on the locked step).
    expect(await s.setup.saveUnits('kg')).toEqual({ ok: true });
  });

  it('Step 1 over a saved gym: both unit cards read-only with `Gym saved in kg`', () => {
    expect(unitLockedText('kg')).toBe('Gym saved in kg');
    const src = readFileSync(join(__dirname, '..', 'src', 'screens', 'setup', 'SetupScreen.tsx'), 'utf8');
    expect(src).toContain("const unitLocked = gym !== null && gym !== 'skipped';");
    expect(src.match(/disabled=\{unitLocked\}/g)).toHaveLength(2);
    expect(src).toContain('unitLockedText(unit)');
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
    expect(plain(v.upNext)).toBe('Set 2 · 60 kg × 3–6');
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
    // Today's Up next rows: each starts with `Target` and matches what Start creates (premium-feel acceptance 3).
    expect(plain(preview?.targets[0]?.line)).toBe('Target 62.5 kg × 3–6 · 3 sets');
    expect(preview?.targets.every((t) => t.line.startsWith('Target ') || t.line.startsWith('No target'))).toBe(true);
    expect(await s.sessions.active()).toBeNull();

    const req = { gymId, opId: 'next-1', checkIn: null, nextOf: first };
    const [a, b] = [await s.workout.start(req), await s.workout.start(req)];
    expect(a.ok && b.ok && b.duplicate && a.aggregate.session.id === b.aggregate.session.id).toBe(true);
    const data = await s.workout.load();
    if (!data) throw new Error('no workout');
    // The derived title is shown, not stored as if Ben named it (review S3).
    expect(data.aggregate.session.routineName).toBe('Workout');
    expect((await s.today.view())?.main).toMatchObject({ title: 'Push' });
    const v = s.workout.view(data, h.clockMs, null);
    expect(v.title).toBe('Push');
    expect(v.openEnded).toBe(false);
    expect(plain(v.focus?.target)).toBe('Target 62.5 kg · 3–6 reps · RIR 1.5');
    expect(plain(v.primary.label)).toBe('Log 62.5 kg × 6');
  });

  it('pain in today’s check-in (no movement chosen) holds next-session loads (rule 9; review B2)', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gym = await s.setup.useTypicalGym();
    await s.setup.complete();
    const gymId = gym.ok ? (gym.gymId ?? '') : '';
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 6, rpe: 7 }, { load: 60, reps: 6, rpe: 7 }, { load: 60, reps: 6, rpe: 8 }] }]);
    h.clockMs += 2 * 86_400_000;
    // Without pain the rule would add load (see above). Today: pain, then `Not now` on the movement step.
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 2 });
    if (!ci.ok) throw new Error('check-in');
    const upd = await s.checkIns.update(ci.checkIn.id, { reasons: ['pain'] }, ci.checkIn.version, h.ids());
    if (!upd.ok) throw new Error('reasons');
    const r = await s.workout.start({ gymId, opId: 'next-pain', checkIn: { kind: 'answered', checkInId: ci.checkIn.id }, nextOf: first });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.notice).toBeUndefined();
    expect(r.aggregate.sets.map((x) => x.planned.load?.value)).toEqual([60, 60, 60]);
    const data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(plain(s.workout.view(data, h.clockMs, null).focus?.target)).toBe('Target 60 kg · 3–6 reps · RIR 1.5');
  });

  it('targets that can’t be worked out repeat last time and say so (review S2)', async () => {
    let { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gym = await s.setup.useTypicalGym();
    await s.setup.complete();
    const gymId = gym.ok ? (gym.gymId ?? '') : '';
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 6, rpe: 7 }, { load: 60, reps: 6, rpe: 7 }] }]);
    // A pain-flag record that fails to decode: the rule can't run, the workout still starts.
    const file = s.developer.databaseNames().current;
    await h.forceClose();
    const db = new DatabaseSync(join(h.dir, file));
    db.prepare("INSERT INTO pain_flags (id, owner_id, exercise_id, status, version, updated_at_utc, data) SELECT 'bad-flag', id, 'x', 'active', 1, '2026-10-10T07:00:00.000Z', '{}' FROM profiles LIMIT 1").run();
    db.close();
    s = (await h.launch()).services;
    h.clockMs += 86_400_000;
    const r = await s.workout.start({ gymId, opId: 'next-fail', checkIn: null, nextOf: first });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.notice).toBe(TARGETS_UNAVAILABLE);
    expect(r.aggregate.sets.map((x) => [x.planned.load?.value, x.planned.source])).toEqual([
      [60, 'repeat'],
      [60, 'repeat'],
    ]);
  });
});
