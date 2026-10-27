import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { REST_LEVEL_NAMES, fitRestLevelOf, timeFitLineText } from '@fizz/domain';

import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 27 Oct) Profile › Training › `Rest when short on time`: Standard rest | Medium rest | Minimum rest (default).
 * Saved on the training profile (Your data, versioned, idempotent), kept across a relaunch, and read by the
 * workout's `+N min` fit: accessory rests only as far as the setting, the main lift's rests never. Real SQLite.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function addWithSets(s: AppServices, sessionId: string, name: string, sets: number): Promise<void> {
  const picks = await s.workout.pickerExercises(sessionId, name);
  const pick = picks.find((p) => p.exercise.name === name) ?? picks[0];
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: `add-${name}` });
  if (!added.ok) throw new Error(added.error.message);
  const row = added.aggregate.exercises.find((e) => e.exerciseId === pick?.exercise.id)?.id ?? '';
  for (let i = 1; i < sets; i += 1) {
    const more = await s.workout.addSet({ sessionId, sessionExerciseId: row, opId: `add-set-${name}-${String(i)}`, newSetId: h.ids() });
    if (!more.ok) throw new Error(more.error.message);
  }
}

async function workout(s: AppServices): Promise<string> {
  const gymId = await setUpGym(h, s);
  const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  await addWithSets(s, sessionId, 'Bench press', 3);
  await addWithSets(s, sessionId, 'Incline dumbbell press', 4);
  await addWithSets(s, sessionId, 'Lat pulldown', 4);
  await addWithSets(s, sessionId, 'Lateral raise', 4);
  await addWithSets(s, sessionId, 'Triceps pushdown', 4);
  return sessionId;
}

async function setLevel(s: AppServices, level: 'normal' | 'shorter' | 'shortest', opId: string): Promise<void> {
  const snap = await s.training.snapshot();
  if (snap === null) throw new Error('no profile');
  const r = await s.training.change({ kind: 'fit_rest_level', level }, snap.profile.version, opId);
  if (!r.ok) throw new Error('not saved');
}

describe('Rest when short on time (Ben, 27 Oct)', () => {
  it('default Minimum rest; one versioned, idempotent write per tap; a stale write is refused; kept across a relaunch', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const snap = await s.training.snapshot();
    if (snap === null) throw new Error('no profile');
    expect(snap.profile.fitRestLevel).toBeUndefined();
    expect(REST_LEVEL_NAMES[fitRestLevelOf(snap.profile)]).toBe('Minimum rest');

    const r = await s.training.change({ kind: 'fit_rest_level', level: 'shorter' }, snap.profile.version, 'rest-medium');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await s.training.change({ kind: 'fit_rest_level', level: 'shorter' }, snap.profile.version, 'rest-medium')).toMatchObject({ ok: true, profile: { version: r.profile.version } });
    expect(await s.training.change({ kind: 'fit_rest_level', level: 'normal' }, snap.profile.version, 'rest-stale')).toMatchObject({ ok: false, reason: 'stale' });

    const { services: again } = await h.launch();
    const after = await again.training.snapshot();
    expect(after?.profile.fitRestLevel).toBe('shorter');
    expect(REST_LEVEL_NAMES[fitRestLevelOf(after?.profile ?? null)]).toBe('Medium rest');
  });

  it('the workout’s +N min fit reads it: a compound accessory 2:00 → 1:30 and no lower; Standard rest: no rest change, sets instead; the bench’s rests never', async () => {
    const { services: s } = await h.launch();
    await workout(s);
    const offerAt = async () => {
      const data = await s.workout.load();
      if (!data) throw new Error('no workout');
      const bench = data.aggregate.exercises.find((e) => e.exerciseName === 'Bench press')?.id ?? '';
      const o = s.workout.timeFit(data, 2);
      if (o === null) throw new Error('no offer');
      expect(o.lines.some((l) => l.sessionExerciseId === bench)).toBe(false);
      return o;
    };
    const rests = (o: Awaited<ReturnType<typeof offerAt>>) => o.lines.filter((l) => l.kind === 'rest').map(timeFitLineText);

    // Default (Minimum rest): the incline press (a compound accessory, 2:00) goes to 1:30, never lower; the lat
    // pulldown is already at 1:30 and stays; the isolations here are at 1:00 already.
    expect(rests(await offerAt())).toEqual(['Incline dumbbell press rest 2:00 → 1:30']);
    await setLevel(s, 'shorter', 'rest-medium');
    expect(rests(await offerAt())).toEqual(['Incline dumbbell press rest 2:00 → 1:30']);
    await setLevel(s, 'normal', 'rest-standard');
    const standard = await offerAt();
    expect(rests(standard)).toEqual([]);
    expect(standard.lines.some((l) => l.kind === 'sets')).toBe(true);
  });
});

describe('screens', () => {
  const src = (p: string) => readFileSync(join(import.meta.dirname, '../src', p), 'utf8');
  it('Profile › Training has the row; its screen offers the three levels by name and writes `fit_rest_level`', () => {
    const profile = src('screens/profile/ProfileScreen.tsx');
    const training = profile.slice(profile.indexOf('<SectionHeader title="Training" />'), profile.indexOf('<SectionHeader', profile.indexOf('<SectionHeader title="Training" />') + 1));
    expect(training).toContain("navigation.navigate('RestWhenShort')");
    expect(src('navigation/AppNavigator.tsx')).toContain('name="RestWhenShort" component={RestWhenShortScreen}');
    const screen = src('screens/profile/RestWhenShortScreen.tsx');
    expect(screen).toContain("kind: 'fit_rest_level'");
    expect(screen).toContain('FIT_REST_LEVEL_OPTIONS.map');
    expect(screen).toContain('REST_LEVEL_NAMES[l]');
  });
});
