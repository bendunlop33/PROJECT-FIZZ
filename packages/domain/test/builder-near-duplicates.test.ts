import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILDER_DAY_MIXES,
  adviseBuilder,
  applyBuilderEdit,
  autoPickClash,
  buildFromSetup,
  buildPlanFromAnswers,
  builderInfoOf,
  makeSlot,
  mixItUpPick,
  mixItUpShortlist,
  movementKeyOf,
  nearDuplicate,
  nearDuplicateIds,
  nearDuplicatePairs,
  recommendForSetup,
  similarLast,
  similarityFactsOf,
  slotsOf,
  trapsIsolation,
  type BuilderExerciseInfo,
  type BuilderGroupName,
  type BuilderPool,
  type BuilderWorkout,
  type SimilarityFacts,
  type WarmupExerciseFacts,
} from '../src/index';
import { catalogueWorld } from './builder-catalogue-fixture';
import { HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';

/**
 * Near-duplicates (Ben, 23 Oct: a code-built Back day had Barbell shrug AND Dumbbell shrug, "1 compound · 5
 * isolation"; "shouldn't suggest two very similar exercises"). Run on the real bundled catalogue.
 */

interface Raw {
  key: string;
  name: string;
  family?: string;
  movementPattern: string;
  mechanic?: 'compound' | 'isolation';
  primaryMuscles: string[];
  compatibleEquipment: string[];
  measurement: string;
}

const DIR = join(__dirname, '../../catalogue/data/exercises');
const RAW: ReadonlyMap<string, Raw> = new Map(
  readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Raw)
    .map((e) => [e.key, e] as const),
);

const world = catalogueWorld();
const dup = (a: string, b: string): boolean => nearDuplicateIds(a, b, world.info);
const info = (id: string): BuilderExerciseInfo => {
  const i = world.info(id);
  if (i === null) throw new Error(`no info for ${id}`);
  return i;
};

describe('nearDuplicate: from the catalogue (family, primary muscles), not a hand list', () => {
  it('shrugs: barbell and dumbbell are one movement', () => {
    expect(dup('barbell-shrug', 'dumbbell-shrug')).toBe(true);
    expect(dup('barbell-shrug', 'barbell-bent-over-row')).toBe(false);
    expect(dup('dumbbell-shrug', 'barbell-upright-row')).toBe(false);
  });

  it('curls: the same curl on another implement is; a hammer curl (brachialis first) is not', () => {
    expect(dup('barbell-curl', 'dumbbell-curl')).toBe(true);
    expect(dup('ez-bar-curl', 'dumbbell-curl')).toBe(true);
    expect(dup('cable-curl', 'barbell-curl')).toBe(true);
    expect(dup('ez-bar-preacher-curl', 'machine-preacher-curl')).toBe(true);
    expect(dup('dumbbell-hammer-curl', 'dumbbell-curl')).toBe(false);
    expect(dup('barbell-reverse-curl', 'barbell-curl')).toBe(false);
  });

  it('presses: incline dumbbell ≈ incline barbell ≈ Smith incline; flat ≠ incline; a machine chest press ≈ the bench (override)', () => {
    expect(dup('dumbbell-incline-bench-press', 'barbell-incline-bench-press')).toBe(true);
    expect(dup('smith-machine-incline-press', 'dumbbell-incline-bench-press')).toBe(true);
    expect(dup('barbell-bench-press', 'dumbbell-bench-press')).toBe(true);
    expect(dup('barbell-bench-press', 'barbell-incline-bench-press')).toBe(false);
    expect(dup('barbell-bench-press', 'machine-chest-press')).toBe(true);
    expect(dup('machine-incline-chest-press', 'dumbbell-incline-bench-press')).toBe(true);
    // Close-grip leads with the triceps; flys are another movement.
    expect(dup('barbell-bench-press', 'barbell-close-grip-bench-press')).toBe(false);
    expect(dup('barbell-bench-press', 'cable-fly')).toBe(false);
    expect(dup('dumbbell-seated-shoulder-press', 'barbell-overhead-press')).toBe(true);
  });

  it('rows: one row is enough (lats + upper back in either order); a row is not a pulldown; a pulldown ≈ a pull-up (override)', () => {
    expect(dup('barbell-bent-over-row', 'cable-seated-row')).toBe(true);
    expect(dup('barbell-bent-over-row', 'machine-chest-supported-row')).toBe(true);
    expect(dup('dumbbell-one-arm-row', 'dumbbell-chest-supported-row')).toBe(true);
    expect(dup('barbell-bent-over-row', 'cable-lat-pulldown')).toBe(false);
    expect(dup('cable-lat-pulldown', 'bodyweight-pull-up')).toBe(true);
    expect(dup('cable-lat-pulldown', 'machine-assisted-pull-up')).toBe(true);
    expect(dup('cable-lat-pulldown', 'cable-straight-arm-pulldown')).toBe(false);
    expect(dup('cable-face-pull', 'dumbbell-rear-delt-fly')).toBe(false);
  });

  it('calves, raises, legs', () => {
    expect(dup('machine-seated-calf-raise', 'machine-standing-calf-raise')).toBe(true);
    expect(dup('dumbbell-lateral-raise', 'cable-lateral-raise')).toBe(true);
    expect(dup('barbell-romanian-deadlift', 'dumbbell-romanian-deadlift')).toBe(true);
    expect(dup('barbell-romanian-deadlift', 'barbell-deadlift')).toBe(false);
    expect(dup('barbell-back-squat', 'barbell-front-squat')).toBe(false);
    expect(dup('machine-lying-leg-curl', 'machine-seated-leg-curl')).toBe(true);
  });

  it('never an exercise with itself; unknown exercises never are', () => {
    expect(dup('barbell-shrug', 'barbell-shrug')).toBe(false);
    expect(dup('barbell-shrug', 'not-an-exercise')).toBe(false);
  });

  it("one of Ben's own (no family) by its name without the implement: `Dumbbell Shrugs` ≈ Barbell shrug", () => {
    const mine: SimilarityFacts = { name: 'DB Shrugs', family: null, primaryMuscles: ['traps'], mechanic: 'isolation' };
    expect(movementKeyOf(mine)).toBe('shrug');
    expect(nearDuplicate(mine, similarityFactsOf(info('barbell-shrug')))).toBe(true);
    expect(movementKeyOf({ name: 'Smith machine bench presses', family: null })).toBe('bench_press');
    expect(nearDuplicate({ name: 'Cable Curls', primaryMuscles: ['biceps'] }, { name: 'EZ bar curl', primaryMuscles: ['biceps'] })).toBe(true);
    expect(nearDuplicate({ name: 'Hammer curl', primaryMuscles: ['biceps'] }, { name: 'EZ bar curl', primaryMuscles: ['biceps'] })).toBe(false);
  });

  it('traps isolations: at most one goes in by itself (a Y-raise after a shrug)', () => {
    expect(trapsIsolation(similarityFactsOf(info('barbell-shrug')))).toBe(true);
    expect(trapsIsolation(similarityFactsOf(info('dumbbell-incline-y-raise')))).toBe(true);
    expect(trapsIsolation(similarityFactsOf(info('barbell-upright-row')))).toBe(false);
    expect(autoPickClash('dumbbell-incline-y-raise', ['barbell-shrug'], world.info)).toEqual({ kind: 'traps_cap', of: 'barbell-shrug' });
    expect(autoPickClash('dumbbell-shrug', ['barbell-shrug'], world.info)).toEqual({ kind: 'near_duplicate', of: 'barbell-shrug' });
    expect(autoPickClash('cable-lat-pulldown', ['barbell-shrug', 'barbell-bent-over-row'], world.info)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Back day builds

/** Gyms by the kinds of kit they have. */
const GYMS: Readonly<Record<string, ReadonlySet<string> | null>> = {
  full: null,
  dumbbells_cables: new Set(['dumbbells', 'weight_stack', 'bodyweight_station', 'band']),
  barbell_rack: new Set(['barbell', 'ez_bar', 'dumbbells', 'bodyweight_station']),
  machines: new Set(['weight_stack', 'plate_loaded_machine', 'assisted_stack', 'bodyweight_station']),
};

/** Ben's history as on the 23 Oct screenshot: both shrugs, rear-delt work, a row, two curls. */
const BEN_23 = ['barbell-shrug', 'dumbbell-shrug', 'dumbbell-rear-delt-fly', 'machine-reverse-pec-deck', 'barbell-bent-over-row', 'dumbbell-curl', 'cable-curl', 'cable-crunch'];

function gymPool(kinds: ReadonlySet<string> | null, history: readonly string[]): BuilderPool {
  const base = world.pool(history);
  return (g: BuilderGroupName) => base(g).filter((id) => kinds === null || (RAW.get(id)?.compatibleEquipment ?? []).some((k) => kinds.has(k)));
}

const verticalPull = (id: string): boolean => {
  const i = world.info(id);
  return i !== null && i.group === 'Back' && i.angle === 'Lats' && i.role === 'compound';
};
const ids = (w: BuilderWorkout): string[] => slotsOf(w.blocks).map((s) => s.exerciseId);

function expectNoDuplicates(list: readonly string[], label: string): void {
  expect(nearDuplicatePairs(list, world.info), label).toEqual([]);
  expect(list.filter((id) => trapsIsolation(similarityFactsOf(info(id)))).length, label).toBeLessThanOrEqual(1);
}

describe('Back day (Ben, 23 Oct): a vertical pull, at most one shrug, no near-duplicates', () => {
  it("Ben's screenshot case: his history has both shrugs; the build has a pulldown or pull-up, one shrug at most, two curls never", () => {
    const pool = gymPool(null, BEN_23);
    const groups = BUILDER_DAY_MIXES.back.map((g) => ({ ...g }));
    for (const main of [null, 'barbell-bent-over-row']) {
      const w = buildFromSetup({ minutes: 60, mainLiftExerciseId: main, supersets: true, groups }, pool, world.ctx(), { trim: false }).workout;
      const list = ids(w);
      expectNoDuplicates(list, `main ${String(main)}`);
      expect(list.some(verticalPull), `main ${String(main)}: ${list.join(', ')}`).toBe(true);
      const back = list.filter((id) => world.info(id)?.group === 'Back');
      expect(back.filter((id) => world.info(id)?.role === 'compound').length).toBeGreaterThanOrEqual(2);
    }
  });

  for (const [gym, kinds] of Object.entries(GYMS)) {
    it(`${gym}: every length, Supersets on/off, with and without his history`, () => {
      for (const history of [[], BEN_23]) {
        const pool = gymPool(kinds, history);
        const hasPull = pool('Back').some(verticalPull);
        const row = pool('Back').find((id) => world.info(id)?.angle === 'Mid-back' && world.info(id)?.role === 'compound') ?? null;
        for (const minutes of [30, 45, 60, 75, 90]) {
          for (const supersets of [true, false]) {
            for (const main of [null, row]) {
              const label = `${gym} history ${String(history.length)} ${String(minutes)} min ss ${String(supersets)} main ${String(main)}`;
              const rec = recommendForSetup(BUILDER_DAY_MIXES.back, { minutes, mainLiftExerciseId: main, supersets }, pool, world.ctx());
              // The recommendation for the length, fitted; and the full day mix as picked (an over-asked mix is then cut
              // by the time fit's least-training-lost rule, D9, which weighs sets, not sub-roles).
              for (const [groups, trim] of [[rec.groups, true], [BUILDER_DAY_MIXES.back.map((g) => ({ ...g })), false]] as const) {
                const list = ids(buildFromSetup({ minutes, mainLiftExerciseId: main, supersets, groups }, pool, world.ctx(), { trim }).workout);
                expectNoDuplicates(list, label);
                const back = list.filter((id) => world.info(id)?.group === 'Back');
                // A vertical pull whenever the Back part has room for two exercises and the gym has one.
                if (hasPull && back.length >= 2) expect(back.some(verticalPull), `${label}: ${back.join(', ')}`).toBe(true);
              }
            }
          }
        }
      }
    });
  }
});

describe('every day mix on the catalogue: no near-duplicates, at most one traps isolation', () => {
  it('all days × lengths × Supersets × history', () => {
    for (const history of [[], BEN_23, [...world.ids].reverse()]) {
      const pool = world.pool(history);
      for (const [day, mix] of Object.entries(BUILDER_DAY_MIXES)) {
        for (const minutes of [30, 60, 90]) {
          for (const accessories of [undefined, 'focused', 'varied'] as const) {
            const w = buildFromSetup({ minutes, mainLiftExerciseId: null, supersets: true, groups: mix.map((g) => ({ ...g })), ...(accessories === undefined ? {} : { accessories }) }, pool, world.ctx()).workout;
            expectNoDuplicates(ids(w), `${day} ${String(minutes)} ${String(accessories)} history ${String(history.length)}`);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Mix it up

describe('Mix it up never picks a near-duplicate', () => {
  const back = (): BuilderWorkout => {
    const ctx = world.ctx();
    return { restLevel: 'normal', blocks: ['barbell-bent-over-row', 'cable-lat-pulldown', 'barbell-shrug', 'dumbbell-rear-delt-fly'].map((id, i) => ({ slots: [makeSlot(id, { main: i === 0 }, ctx)], auto: false })) };
  };

  it('swapping the rear-delt fly: Dumbbell shrug (like the Barbell shrug in) is never offered', () => {
    const w = back();
    const fly = slotsOf(w.blocks).find((s) => s.exerciseId === 'dumbbell-rear-delt-fly');
    if (fly === undefined) throw new Error('no fly');
    const list = mixItUpShortlist({
      target: fly,
      candidates: world.pool()('Back'),
      info: world.info,
      availableHere: () => true,
      painFlagged: () => false,
      lastTwoOnDay: new Set(),
      inWorkout: new Set(ids(w)),
      lastDoneMs: new Map(),
    });
    expect(list).not.toContain('dumbbell-shrug');
    expect(list).not.toContain('dumbbell-incline-y-raise');
    for (const id of list) expect(autoPickClash(id, ids(w).filter((x) => x !== fly.exerciseId), world.info), id).toBeNull();
  });

  it('over built workouts: the pick never near-duplicates what stays', () => {
    for (const history of [[], BEN_23]) {
      const pool = world.pool(history);
      for (const [day, mix] of Object.entries(BUILDER_DAY_MIXES)) {
        const w = buildFromSetup({ minutes: 75, mainLiftExerciseId: null, supersets: false, groups: mix.map((g) => ({ ...g })) }, pool, world.ctx()).workout;
        for (const varied of [true, false]) {
          const p = mixItUpPick({ workout: w, candidates: pool, info: world.info, availableHere: () => true, painFlagged: () => false, lastTwoOnDay: new Set(), lastDoneMs: new Map(), recentCountOnDay: new Map(), varied });
          if (p === null) continue;
          const staying = ids(w).filter((id) => id !== p.slot.exerciseId);
          expect(autoPickClash(p.exerciseId, staying, world.info), `${day} → ${p.exerciseId}`).toBeNull();
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Ben's own Add: shown, flagged, never blocked

describe("Ben's own Add / Swap: shown last and flagged, never blocked", () => {
  it('Swap / Add puts near-duplicates last, marked with the one they are like', () => {
    const r = similarLast(['dumbbell-shrug', 'cable-lat-pulldown', 'cable-seated-row', 'cable-face-pull'], ['barbell-shrug', 'barbell-bent-over-row'], world.info);
    expect(r.order).toEqual(['cable-lat-pulldown', 'cable-face-pull', 'dumbbell-shrug', 'cable-seated-row']);
    expect([...r.similarTo]).toEqual([
      ['dumbbell-shrug', 'Barbell shrug'],
      ['cable-seated-row', 'Barbell row'],
    ]);
  });

  it('adding a near-duplicate himself works, with advice (not recommended) naming the other', () => {
    const ctx = world.ctx();
    const one: BuilderWorkout = { restLevel: 'normal', blocks: [{ slots: [makeSlot('barbell-shrug', { main: false }, ctx)], auto: false }] };
    const two = applyBuilderEdit(one, { kind: 'add_exercise', exerciseId: 'dumbbell-shrug' }, ctx);
    if (!two.ok) throw new Error(two.reason);
    expect(ids(two.workout)).toEqual(['barbell-shrug', 'dumbbell-shrug']);
    expect(two.advice).toMatchObject({ kind: 'near_duplicate', a: { name: 'Barbell shrug' }, b: { name: 'Dumbbell shrug' }, fix: { kind: 'remove' } });
    expect(adviseBuilder(two.workout.blocks, world.info).filter((a) => a.kind === 'near_duplicate')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Plan builder

describe('plan builder: no day has near-duplicates (Ben, 23 Oct)', () => {
  const factsOf = (key: string): WarmupExerciseFacts | null => {
    const e = RAW.get(key);
    return e === undefined ? null : { catalogueKey: key, family: e.family ?? null, movementPattern: e.movementPattern, mechanic: e.mechanic ?? null, primaryMuscles: e.primaryMuscles, measurement: e.measurement };
  };
  const sim = (key: string): SimilarityFacts => {
    const e = RAW.get(key);
    const i = e === undefined ? null : builderInfoOf({ ...e, id: key } as unknown as Parameters<typeof builderInfoOf>[0]);
    return i === null ? { name: key, primaryMuscles: [] } : similarityFactsOf(i);
  };

  it('every split, sessions 2–6, lengths, supersets', () => {
    let days = 0;
    for (const sessions of [2, 3, 4, 5, 6]) {
      for (const minutes of [45, 60, 90]) {
        for (const supersets of [true, false]) {
          for (const split of [null, 'ppl', 'ul', 'full', 'body'] as const) {
            const plan = buildPlanFromAnswers({ answers: answers({ sessions, minutes, supersets, ...(split === null ? {} : { split }) }), profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, factsOf, nowMs: NOW });
            for (const d of plan.days) {
              days += 1;
              const keys = d.exercises.map((e) => e.key);
              const label = `${String(sessions)} × ${String(minutes)} ss ${String(supersets)} ${String(split)} ${d.focus}: ${keys.join(', ')}`;
              for (const [a, x] of keys.entries()) {
                for (const y of keys.slice(a + 1)) expect(nearDuplicate(sim(x), sim(y)), label).toBe(false);
              }
              expect(keys.filter((k) => trapsIsolation(sim(k))).length, label).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
    expect(days).toBeGreaterThan(100);
  });
});
