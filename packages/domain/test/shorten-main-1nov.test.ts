import { describe, expect, it } from 'vitest';
import { TrainingProfileSchema, type TrainingProfile } from '@fizz/schemas';

import {
  BUILDER_DAY_MIXES,
  applyTrainingChange,
  buildFromSetup,
  defaultRestS,
  estimateBuilderSeconds,
  fitToMinutes,
  mainLiftRestLine,
  newTrainingProfile,
  restAfterRows,
  restDefaultsOf,
  restTableOf,
  type BuilderContext,
  type BuilderSlot,
  type BuilderWorkout,
  type RestDefaults,
} from '../src/index';
import { context, pool } from './builder-v3-fixture';

/**
 * (Ben, 1 Nov) `Rest when short on time` › `Shorten main lift too`: off by default (the 27 Oct rule: the main lift's
 * rests never change for time). On: Medium ×0.8 and Minimum ×⅔ of his Rest times also apply to the main lift's
 * working, top-set and back-off rests, snapped to 15 s, never below 2:00.
 */

const fresh = (): TrainingProfile => newTrainingProfile({ id: '00000000-0000-4000-8000-000000000001', ownerId: '00000000-0000-4000-8000-000000000002', atUtc: '2026-11-01T08:00:00.000Z' });
const ON: RestDefaults = { shortenMain: true };
const all = (w: BuilderWorkout) => w.blocks.flatMap((b) => b.slots);

describe('the switch on the training profile', () => {
  it('absent by default; on is stored, off clears it; versioned, a repeated op ID writes once, a stale version is refused', () => {
    const p = fresh();
    expect(p.fitShortenMain).toBeUndefined();
    expect(restDefaultsOf(p).shortenMain).toBeUndefined();
    const meta = (opId: string, v: number) => ({ opId, expectedVersion: v, atUtc: '2026-11-01T09:00:00.000Z', nowYear: 2026, today: '2026-11-01' });
    const on = applyTrainingChange(p, { kind: 'fit_shorten_main', on: true }, meta('sm-1', p.version));
    if (!on.ok) throw new Error('not ok');
    expect(on.profile.fitShortenMain).toBe(true);
    expect(on.profile.version).toBe(p.version + 1);
    expect(TrainingProfileSchema.safeParse(on.profile).success).toBe(true);
    expect(restDefaultsOf(on.profile)).toEqual({ shortenMain: true });
    const again = applyTrainingChange(on.profile, { kind: 'fit_shorten_main', on: true }, meta('sm-1', p.version));
    expect(again.ok && again.profile.version).toBe(on.profile.version);
    expect(applyTrainingChange(on.profile, { kind: 'fit_shorten_main', on: false }, meta('sm-2', p.version)).ok).toBe(false);
    const off = applyTrainingChange(on.profile, { kind: 'fit_shorten_main', on: false }, meta('sm-3', on.profile.version));
    if (!off.ok) throw new Error('not ok');
    expect('fitShortenMain' in off.profile).toBe(false);
  });

  it('keeps Ben’s own rest defaults alongside it', () => {
    expect(restDefaultsOf({ restDefaultsS: { workingMain: 240 }, fitShortenMain: true })).toEqual({ workingMain: 240, shortenMain: true });
  });
});

describe('rest level math', () => {
  it('off: the main lift’s rests are the same at every level (27 Oct rule)', () => {
    for (const level of ['normal', 'shorter', 'shortest'] as const) {
      expect(restTableOf(level)).toMatchObject({ workingMain: 180, top: 150, backoff: 180 });
      expect(defaultRestS('working', 'main', level)).toBe(180);
    }
    expect(mainLiftRestLine()).toBe('Main lift 3:00');
  });

  it('on: Medium ×0.8 and Minimum ×⅔, snapped to 15 s, never below 2:00; accessories as before', () => {
    expect(restTableOf('normal', ON)).toMatchObject({ workingMain: 180, top: 150, backoff: 180 });
    // 180 × 0.8 = 144 → 150; 150 × 0.8 = 120; 180 × ⅔ = 120; 150 × ⅔ = 100 → floor 120.
    expect(restTableOf('shorter', ON)).toMatchObject({ workingMain: 150, top: 120, backoff: 150 });
    expect(restTableOf('shortest', ON)).toMatchObject({ workingMain: 120, top: 120, backoff: 120 });
    expect(restTableOf('shortest', ON)).toMatchObject({ workingCompound: restTableOf('shortest').workingCompound, workingIsolation: restTableOf('shortest').workingIsolation, round: restTableOf('shortest').round });
    expect(defaultRestS('top', 'main', 'shorter', ON)).toBe(120);
    expect(defaultRestS('backoff', 'main', 'shortest', ON)).toBe(120);
    expect(mainLiftRestLine(ON)).toBe('Main lift 3:00 · 2:30 · 2:00');
  });

  it('on: from Ben’s own Rest times (main 4:00, top 4:30, back-off 3:30)', () => {
    const bens: RestDefaults = { workingMain: 240, top: 270, backoff: 210, shortenMain: true };
    expect(restTableOf('shorter', bens)).toMatchObject({ workingMain: 195, top: 210, backoff: 165 });
    expect(restTableOf('shortest', bens)).toMatchObject({ workingMain: 165, top: 180, backoff: 135 });
    expect(mainLiftRestLine(bens)).toBe('Main lift 4:00 · 3:15 · 2:45');
    // A main rest already at 2:00 never goes lower.
    expect(restTableOf('shortest', { workingMain: 120, shortenMain: true }).workingMain).toBe(120);
  });

  it('a plan day’s stored main-lift rest shortens with the switch on, and only then; the slot’s own rest still wins', () => {
    const ctx = context();
    const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [...BUILDER_DAY_MIXES.chest] }, pool, ctx).workout;
    const main = all(w).find((s) => s.main) as BuilderSlot;
    const stored: BuilderSlot = { ...main, planRestS: { working: 180, top: 180, backoff: 180 } };
    const work = (rests: number[]) => rests.filter((_, i) => stored.rows[i]?.type !== 'warmup');
    expect(new Set(work(restAfterRows(stored, ctx.info, 'shortest')))).toEqual(new Set([180]));
    expect(new Set(work(restAfterRows(stored, ctx.info, 'shortest', ON)))).toEqual(new Set([120]));
    const own: BuilderSlot = { ...stored, restS: { working: 200, top: 200, backoff: 200 } };
    expect(new Set(work(restAfterRows(own, ctx.info, 'shortest', ON)))).toEqual(new Set([200]));
  });

  it('the fit: with the switch on Minimum shortens the main lift too, so the day is shorter at the same level', () => {
    const off = context();
    const on: BuilderContext = { ...off, restDefaultsS: ON };
    const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [...BUILDER_DAY_MIXES.chest] }, pool, off).workout;
    const shortest = { ...w, restLevel: 'shortest' as const };
    expect(estimateBuilderSeconds(shortest, on)).toBeLessThan(estimateBuilderSeconds(shortest, off));
    const minutes = Math.floor(estimateBuilderSeconds(shortest, on) / 60);
    const f = fitToMinutes(w, on, { minutes, mainGroup: 'Chest', grow: false, supersets: false });
    expect(f.workout.restLevel).toBe('shortest');
    const fm = all(f.workout).find((s) => s.main) as BuilderSlot;
    const working = restAfterRows(fm, on.info, f.workout.restLevel, ON).filter((_, i) => fm.rows[i]?.type !== 'warmup' && fm.rows[i + 1] !== undefined);
    expect(working.every((s) => s === 120)).toBe(true);
    expect(all(f.workout).filter((s) => !s.main).length).toBe(all(w).filter((s) => !s.main).length);
  });
});
