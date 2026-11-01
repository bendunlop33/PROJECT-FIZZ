import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';
import type { TrainingChange } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { BuilderSnapshot } from '../src/builder/builder-service';
import { CONNECTED, StepModel } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 1 Nov) `Rest when short on time` › `Shorten main lift too` on real SQLite: saved on the training profile
 * (versioned, idempotent, kept across a relaunch) and read by Your workout's estimate and Time fit: with it on,
 * Minimum rest also shortens the main lift's rests (never below 2:00), so the same draft estimates shorter.
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

async function buildPull(s: AppServices, opId: string): Promise<BuilderSnapshot> {
  const base = await s.builder.initialSetup({ dayId: 'pull' });
  const row = (await s.builder.setupFacts(base)).mainLifts.find((m) => m.name === 'Barbell row');
  if (row === undefined) throw new Error('no barbell row');
  return ok(await s.builder.create({ ...base, mainLiftExerciseId: row.id }, opId)).snapshot;
}

const mainWorking = (snap: BuilderSnapshot): number | undefined => {
  const main = slotsOf(snap.workout.blocks).find((x) => x.main);
  if (main === undefined) throw new Error('no main lift');
  const r = snap.rests[main.key];
  return main.rows.some((x) => x.type === 'top') ? r?.top : r?.working;
};

describe('Shorten main lift too (Ben, 1 Nov)', () => {
  it('off by default; on and off are versioned writes; kept across a relaunch', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    expect((await s.training.snapshot())?.profile.fitShortenMain).toBeUndefined();
    await change(s, { kind: 'fit_shorten_main', on: true }, 'sm-on');
    const { services: again } = await h.launch();
    expect((await again.training.snapshot())?.profile.fitShortenMain).toBe(true);
    await change(again, { kind: 'fit_shorten_main', on: false }, 'sm-off');
    expect((await again.training.snapshot())?.profile.fitShortenMain).toBeUndefined();
  });

  it('Your workout: at Minimum rest the main lift keeps 3:00 with it off; with it on the same draft rests 2:00 and estimates shorter', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] }]);
    h.clockMs += 4 * DAY;
    const built = await buildPull(s, 'build-1');
    const normalMain = mainWorking(built);
    // Short enough that the fit takes rests to Minimum.
    const short = ok(await s.builder.setTime(built.draftId, 30, { opId: 'time-30', expectedVersion: built.version })).snapshot;
    expect(short.workout.restLevel).toBe('shortest');
    expect(mainWorking(short)).toBe(normalMain);

    await change(s, { kind: 'fit_shorten_main', on: true }, 'sm-on');
    const after = await s.builder.read(built.draftId);
    if (after === null) throw new Error('no draft');
    expect(after.workout.restLevel).toBe('shortest');
    expect(mainWorking(after)).toBe(120);
    expect(after.minutes).toBeLessThan(short.minutes);
  });
});

describe('screen', () => {
  it('Rest when short on time has the switch, writes `fit_shorten_main`, and shows the main lift line from the domain', () => {
    const screen = readFileSync(join(import.meta.dirname, '../src/screens/profile/RestWhenShortScreen.tsx'), 'utf8');
    expect(screen).toContain("kind: 'fit_shorten_main'");
    expect(screen).toContain('SHORTEN_MAIN_COPY.label');
    expect(screen).toContain('mainLiftRestLine(defaults)');
  });
});
