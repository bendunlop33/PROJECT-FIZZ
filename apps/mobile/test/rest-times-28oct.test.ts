import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { restDefaultsOf, slotsOf, timeFitLineText } from '@fizz/domain';
import type { TrainingChange } from '@fizz/schemas';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, StepModel } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 28 Oct) Profile › Rest times on real SQLite: Ben's default rests saved on the training profile (Your data,
 * versioned, idempotent, kept across a relaunch, `Reset to defaults`), read by Your workout (rests, ~N min, the draft
 * Start plans from) and by the open workout's `+N min` levels; the open workout's own rests never change.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  const model = new StepModel([]);
  h = createHarness('2026-10-20T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${'message' in r ? String(r.message) : ''}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};

async function change(s: AppServices, c: TrainingChange, opId: string): Promise<void> {
  const snap = await s.training.snapshot();
  if (snap === null) throw new Error('no profile');
  const r = await s.training.change(c, snap.profile.version, opId);
  if (!r.ok) throw new Error(`not saved: ${r.reason}`);
}

/** Set up → Pull with barbell row as the main lift → Next: exercises. */
async function buildPull(s: AppServices, opId: string): Promise<BuilderSnapshot> {
  const base = await s.builder.initialSetup({ dayId: 'pull' });
  const row = (await s.builder.setupFacts(base)).mainLifts.find((m) => m.name === 'Barbell row');
  if (row === undefined) throw new Error('no barbell row');
  return ok(await s.builder.create({ ...base, mainLiftExerciseId: row.id }, opId)).snapshot;
}

describe('the setting', () => {
  it('none by default; one versioned, idempotent write per tap; a stale write is refused; kept across a relaunch; Reset clears', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const snap = await s.training.snapshot();
    if (snap === null) throw new Error('no profile');
    expect(snap.profile.restDefaultsS).toBeUndefined();

    const r = await s.training.change({ kind: 'rest_default', key: 'workingMain', seconds: 240 }, snap.profile.version, 'rt-main');
    if (!r.ok) throw new Error('not saved');
    expect(await s.training.change({ kind: 'rest_default', key: 'workingMain', seconds: 240 }, snap.profile.version, 'rt-main')).toMatchObject({ ok: true, profile: { version: r.profile.version } });
    expect(await s.training.change({ kind: 'rest_default', key: 'workingMain', seconds: 255 }, snap.profile.version, 'rt-stale')).toMatchObject({ ok: false, reason: 'stale' });
    expect(await s.training.change({ kind: 'rest_default', key: 'workingMain', seconds: 250 }, r.profile.version, 'rt-bad')).toMatchObject({ ok: false });

    const { services: again } = await h.launch();
    const after = await again.training.snapshot();
    expect(restDefaultsOf(after?.profile ?? null)).toEqual({ workingMain: 240 });
    await change(again, { kind: 'reset_rest_defaults' }, 'rt-reset');
    expect((await again.training.snapshot())?.profile.restDefaultsS).toBeUndefined();
  });
});

describe('Your workout and Start read it', () => {
  it('(Ben, 28 Oct) with rest presets 1:00 / 1:30 / 3:00 in his profile, the standard defaults are exact: top set 2:30, compound 2:00', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    expect((await s.training.snapshot())?.owner.restPresets.map((r) => r.seconds)).toEqual([60, 90, 180]);
    const b = await buildPull(s, 'build-presets');
    const main = slotsOf(b.workout.blocks).find((x) => x.main);
    if (main === undefined) throw new Error('no main lift');
    expect(b.rests[main.key]?.top).toBe(150);
    const compounds = slotsOf(b.workout.blocks).filter((x) => !x.main && b.facts[x.exerciseId]?.compound === true);
    expect(compounds.length).toBeGreaterThan(0);
    for (const c of compounds) expect(b.rests[c.key]?.working, b.facts[c.exerciseId]?.name).toBe(120);
  });

  it('a new Your workout: his main-lift and accessory rests; Start keeps them; the open workout keeps them after Reset', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] }]);
    h.clockMs += 4 * DAY;
    const std = await buildPull(s, 'build-std');
    const stdMain = slotsOf(std.workout.blocks).find((x) => x.main);
    if (stdMain === undefined) throw new Error('no main lift');

    for (const [key, seconds] of [['workingMain', 255], ['top', 285], ['backoff', 225], ['workingCompound', 150], ['workingIsolation', 105], ['warmup', 75]] as const) await change(s, { kind: 'rest_default', key, seconds }, `rt-${key}`);
    const mine = await buildPull(s, 'build-mine');
    const main = slotsOf(mine.workout.blocks).find((x) => x.main);
    if (main === undefined) throw new Error('no main lift');
    const r = mine.rests[main.key];
    expect(main.rows.some((x) => x.type === 'top') ? r?.top : r?.working).toBe(main.rows.some((x) => x.type === 'top') ? 285 : 255);
    for (const slot of slotsOf(mine.workout.blocks).filter((x) => !x.main)) {
      const role = mine.facts[slot.exerciseId];
      expect([150, 105], role?.name).toContain(mine.rests[slot.key]?.working);
    }

    const started = await s.builder.start(mine.draftId, { opId: 'start-mine', expectedVersion: mine.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    if (a === undefined) throw new Error('no workout');
    const rowOf = a.exercises.find((e) => e.exerciseName === 'Barbell row')?.id;
    const mainRests = a.sets.filter((x) => x.sessionExerciseId === rowOf && x.setType !== 'warmup').map((x) => [x.setType, x.rest.seconds] as const);
    expect(mainRests.length).toBeGreaterThan(0);
    for (const [type, sec] of mainRests) expect(sec, type).toBe(type === 'top' ? 285 : type === 'backoff' ? 225 : 255);

    await change(s, { kind: 'reset_rest_defaults' }, 'rt-reset');
    const open = await s.workout.load(a.session.id);
    expect(open?.aggregate.sets.map((x) => x.rest.seconds)).toEqual(a.sets.map((x) => x.rest.seconds));
  });
});

describe('the open workout’s +N min', () => {
  it('scales from his values: with his isolation 0:45, Minimum takes a 1:00 isolation rest to 0:30; standard leaves it; the main lift never', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    for (const name of ['Bench press', 'Lateral raise', 'Triceps pushdown']) {
      const picks = await s.workout.pickerExercises(sessionId, name);
      const pick = picks.find((p) => p.exercise.name === name) ?? picks[0];
      const added = await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: `add-${name}` });
      if (!added.ok) throw new Error(added.error.message);
      const row = added.aggregate.exercises.find((e) => e.exerciseId === pick?.exercise.id)?.id ?? '';
      for (let i = 1; i < 4; i += 1) {
        const more = await s.workout.addSet({ sessionId, sessionExerciseId: row, opId: `add-set-${name}-${String(i)}`, newSetId: h.ids() });
        if (!more.ok) throw new Error(more.error.message);
      }
    }
    const restLines = async () => {
      const data = await s.workout.load();
      if (!data) throw new Error('no workout');
      return (s.workout.timeFit(data, 2)?.lines ?? []).filter((l) => l.kind === 'rest');
    };
    expect((await restLines()).some((l) => l.name === 'Lateral raise')).toBe(false);
    const before = (await s.workout.load())?.aggregate.sets.map((x) => x.rest.seconds);
    await change(s, { kind: 'rest_default', key: 'workingIsolation', seconds: 45 }, 'rt-iso');
    expect((await s.workout.load())?.restDefaultsS).toEqual({ workingIsolation: 45 });
    // The setting alone changes none of the open workout's rests.
    expect((await s.workout.load())?.aggregate.sets.map((x) => x.rest.seconds)).toEqual(before);
    const lines = await restLines();
    expect(lines.filter((l) => l.name === 'Lateral raise').map(timeFitLineText)).toEqual(['Lateral raise rest 1:00 → 0:30']);
    expect(lines.some((l) => l.name === 'Bench press')).toBe(false);
  });
});

describe('screens', () => {
  const src = (p: string) => readFileSync(join(import.meta.dirname, '../src', p), 'utf8');
  it('Profile › Training has `Rest times`; the screen writes `rest_default` / `reset_rest_defaults` from the domain’s rows', () => {
    const profile = src('screens/profile/ProfileScreen.tsx');
    const training = profile.slice(profile.indexOf('<SectionHeader title="Training" />'), profile.indexOf('<SectionHeader', profile.indexOf('<SectionHeader title="Training" />') + 1));
    expect(training).toContain("navigation.navigate('RestTimes')");
    expect(src('navigation/AppNavigator.tsx')).toContain('name="RestTimes" component={RestTimesScreen}');
    const screen = src('screens/profile/RestTimesScreen.tsx');
    expect(screen).toContain("kind: 'rest_default'");
    expect(screen).toContain("kind: 'reset_rest_defaults'");
    expect(screen).toContain('restTimesView(restDefaultsOf(profile))');
    expect(screen).not.toContain('restPresets');
    // Rest when short on time: each option's times, and the main lift once.
    const short = src('screens/profile/RestWhenShortScreen.tsx');
    expect(short).toContain('subtitle={restLevelTimesLine(l, defaults)}');
    expect(short).toContain('mainLiftRestLine(defaults)');
    expect(short).not.toContain('restPresets');
    // A warm-up added in the workout rests his warm-up value when the exercise has none.
    expect(src('screens/workout/WorkoutEdits.tsx')).toContain('warmupRestS: p.latest()?.restDefaultsS?.warmup');
  });
});
