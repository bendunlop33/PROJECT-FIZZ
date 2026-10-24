import { describe, expect, it } from 'vitest';
import {
  BUILDER_DAY_MIXES,
  TODAY_OTHER_SESSIONS,
  assembleTodayDraft,
  bandInsertIndex,
  buildFromSetup,
  canAutoPair,
  defaultBuilderMainLift,
  mergeSetupChange,
  orderSlots,
  pairSlots,
  recommendForSetup,
  singlesOf,
  splitInvalidAutoPairs,
  type BuilderBlock,
  type BuilderExerciseInfo,
  type BuilderSlot,
  type BuilderWorkout,
  type GroupCount,
  type TodayDay,
} from '../src/index';
import { catalogueWorld, type CatalogueWorld } from './builder-catalogue-fixture';

/**
 * Builder order and pairing (workout-builder-v3 §3.4, §3.5, §9 Q5; Ben,
 * 21 Oct: "Why is it suggesting superset on main lift rows. Also why is
 * main lift not first"). Over the real catalogue, every day mix × length ×
 * Supersets on/off × main lift set/unset:
 *   (a) the main lift is block 1, alone, never paired;
 *   (b) with no main lift, heavy compounds are never paired and lead the
 *       workout, the heaviest (on a bar) first;
 *   (c) block order is main → heavy compounds → other compounds →
 *       isolations → abs;
 *   (d) a builder pair never holds a heavy lift.
 */

const BACK_HISTORY = ['bodyweight-45-degree-back-extension', 'barbell-bent-over-row', 'barbell-shrug', 'dumbbell-rear-delt-fly', 'dumbbell-curl', 'cable-curl'];
const ROW = 'barbell-bent-over-row';

const names = (w: BuilderWorkout, info: (id: string) => BuilderExerciseInfo | null) => w.blocks.map((b) => b.slots.map((s) => `${info(s.exerciseId)?.name ?? s.exerciseId}${s.main ? ' (main)' : ''}`).join(' + '));

function rank(s: BuilderSlot, info: (id: string) => BuilderExerciseInfo | null): number {
  const i = info(s.exerciseId);
  if (s.main) return 0;
  if (i === null) return 3;
  if (i.group === 'Core') return 4;
  if (i.role !== 'compound') return 3;
  return i.heavy ? 1 : 2;
}

/** A bar lift's est. max in the world (null: not a whole-bar load). */
function barLoad(world: CatalogueWorld, id: string): number | null {
  const l = world.ctx().loads(id);
  return l.convention === 'total' ? l.e1rm : null;
}

/**
 * (a)–(d) for one workout; `order`: also check the §3.4 bands (c) and
 * heavy-first (b); `heaviest`: the lead bar lift is the heaviest known one
 * (a fresh build with no main lift).
 */
function expectRules(w: BuilderWorkout, world: CatalogueWorld, hasMain: boolean, label: string, opts: { order: boolean; heaviest?: boolean } = { order: true }): void {
  const { info } = world;
  const all = w.blocks.flatMap((b) => b.slots);
  const mains = all.filter((s) => s.main);
  // (a)
  if (hasMain) {
    expect(mains, label).toHaveLength(1);
    expect(w.blocks[0]?.slots.length, label).toBe(1);
    expect(w.blocks[0]?.slots[0]?.main, label).toBe(true);
  } else {
    expect(mains, label).toHaveLength(0);
  }
  // (d) and (a): no pair holds the main lift or a heavy lift.
  for (const b of w.blocks) {
    if (b.slots.length < 2) continue;
    expect(b.slots.some((s) => s.main), `${label}: main paired`).toBe(false);
    expect(b.slots.some((s) => info(s.exerciseId)?.heavy === true), `${label}: heavy paired: ${names(w, info).join(' | ')}`).toBe(false);
  }
  if (!opts.order) return;
  // (c) block leaders follow the bands.
  const ranks = w.blocks.map((b) => (b.slots[0] === undefined ? 9 : rank(b.slots[0], info)));
  expect(
    ranks.every((r, i) => i === 0 || r >= (ranks[i - 1] ?? 0)),
    `${label}: order ${names(w, info).join(' | ')}`,
  ).toBe(true);
  // (b) no main lift: a heavy compound leads, a barbell one first when there is one.
  if (!hasMain) {
    const heavy = all.filter((s) => rank(s, info) === 1);
    if (heavy.length > 0) {
      const first = w.blocks[0]?.slots[0];
      expect(first !== undefined && rank(first, info), `${label}: heavy first ${names(w, info).join(' | ')}`).toBe(1);
      if (heavy.some((s) => info(s.exerciseId)?.barbell === true)) expect(info(first?.exerciseId ?? '')?.barbell, `${label}: bar first ${names(w, info).join(" | ")}`).toBe(true);
      if (opts.heaviest === true && first !== undefined) {
        const top = Math.max(...heavy.map((s) => (info(s.exerciseId)?.barbell === true ? (barLoad(world, s.exerciseId) ?? -1) : -1)));
        if (top >= 0) expect(barLoad(world, first.exerciseId), `${label}: heaviest first ${names(w, info).join(' | ')}`).toBe(top);
      }
    }
  }
}

/** Every day Set up or Today can build: the split mixes, the Other sessions, an arms-only day. */
const ALL_MIXES: readonly (readonly [string, readonly GroupCount[]])[] = [
  ...Object.entries(BUILDER_DAY_MIXES),
  ...TODAY_OTHER_SESSIONS.map((o) => [`other:${o.id}`, o.groups] as const),
  ['arms', [{ group: 'Arms', count: 4 }]],
];

describe("Ben's Back day (Build B screenshot, 21 Oct)", () => {
  // His phone's starter Barbell row works lats and upper back only, so it shares nothing with a curl.
  const world = catalogueWorld({ starterFacts: true });
  const groups: GroupCount[] = [
    { group: 'Back', count: 4 },
    { group: 'Arms', count: 2 },
  ];

  it('exact case: before the fix this built "45° back extension + Dumbbell curl | Barbell row + Cable curl | Barbell shrug | Dumbbell rear-delt fly" (now a vertical pull, no near-duplicate curls; Ben, 23 Oct)', () => {
    // His set-up then was Biceps 2 (pre-D5): a stored `Biceps` row reads as Arms with only biceps (`armParts`).
    const w = buildFromSetup({ minutes: 40, mainLiftExerciseId: null, supersets: true, groups, armParts: ['biceps'] }, world.pool(BACK_HISTORY), world.ctx()).workout;
    // (Ben, 23 Oct) A vertical pull before the shrug (sub-roles), and never two near-duplicate curls (Cable curl ≈ Dumbbell curl).
    expect(names(w, world.info)).toEqual(['Barbell row', 'Assisted pull-up + Dumbbell curl', '45° back extension + Hammer curl', 'Dumbbell rear-delt fly']);
    // D5's Arms 2 on a back day: biceps first, then triceps.
    const d5 = buildFromSetup({ minutes: 40, mainLiftExerciseId: null, supersets: true, groups }, world.pool(BACK_HISTORY), world.ctx()).workout;
    expect(names(d5, world.info)).toEqual(['Barbell row', 'Assisted pull-up + Dumbbell curl', '45° back extension + Band triceps pushdown', 'Dumbbell rear-delt fly']);
    // §3.5's canPair still allows heavy + a light lift (Ben's own pair, advice only); the builder never makes it.
    expect(canAutoPair({ exerciseId: ROW, main: false }, { exerciseId: 'cable-curl', main: false }, world.info)).toBe(false);
  });

  it('Main lift none: Barbell row leads, alone; the vertical pull and back extension follow; curls pair only with light lifts', () => {
    const w = buildFromSetup({ minutes: 40, mainLiftExerciseId: null, supersets: true, groups }, world.pool(BACK_HISTORY), world.ctx()).workout;
    expect(w.blocks[0]?.slots.map((s) => s.exerciseId)).toEqual([ROW]);
    // (Ben, 23 Oct) The vertical pull comes in first (sub-roles), so the back extension follows it.
    expect(w.blocks.findIndex((b) => b.slots.some((s) => s.exerciseId === 'bodyweight-45-degree-back-extension'))).toBe(2);
    expectRules(w, world, false, 'ben none');
  });

  it('Main lift Barbell row: slot 1, alone', () => {
    const w = buildFromSetup({ minutes: 40, mainLiftExerciseId: ROW, supersets: true, groups }, world.pool(BACK_HISTORY), world.ctx()).workout;
    expect(w.blocks[0]?.slots.map((s) => [s.exerciseId, s.main])).toEqual([[ROW, true]]);
    expectRules(w, world, true, 'ben row');
  });

  it('Set up default main lift for Back with no plan day: Barbell row (never none)', () => {
    for (const history of [[], BACK_HISTORY]) {
      expect(defaultBuilderMainLift({ groups: ['Back', 'Arms', 'Core'], pool: world.pool(history), info: world.info, catalogueKeyOf: (id) => id })).toBe(ROW);
    }
  });
});

describe('defaultBuilderMainLift', () => {
  const world = catalogueWorld();
  const pick = (groups: Parameters<typeof defaultBuilderMainLift>[0]['groups'], pool = world.pool(), keyOf: (id: string) => string | null = (id) => id) =>
    defaultBuilderMainLift({ groups, pool, info: world.info, catalogueKeyOf: keyOf });

  it('each lead group gets its main compound; abs are skipped; an arms day has none', () => {
    expect(pick(['Chest', 'Arms', 'Core'])).toBe('barbell-bench-press');
    expect(pick(['Core', 'Legs'])).toBe('barbell-back-squat');
    expect(pick(['Shoulders'])).toBe('barbell-overhead-press');
    expect(pick(['Arms'])).toBeNull();
    expect(pick([])).toBeNull();
  });

  it('not at this gym (or pain-flagged: not in the pool): the next default, then a heavy compound, then any compound', () => {
    const without = (out: readonly string[]) => (g: Parameters<ReturnType<CatalogueWorld['pool']>>[0]) => world.pool()(g).filter((id) => !out.includes(id));
    expect(pick(['Back'], without([ROW]))).toBe('cable-lat-pulldown');
    // A custom row (no catalogue key) that is heavy wins over a light compound.
    const noKeys = () => null;
    const heavy = world.pool()('Back').find((id) => world.info(id)?.heavy === true);
    expect(pick(['Back'], world.pool(), noKeys)).toBe(heavy);
    const onlyLight = (g: Parameters<ReturnType<CatalogueWorld['pool']>>[0]) => world.pool()(g).filter((id) => world.info(id)?.heavy !== true);
    expect(pick(['Back'], onlyLight, noKeys)).toBe(onlyLight('Back').find((id) => world.info(id)?.role === 'compound'));
  });
});

describe('order and pairing rules over every day × length × Supersets × main lift', () => {
  const lengths = [15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90, 120];
  for (const starterFacts of [false, true]) {
    const world = catalogueWorld({ starterFacts });
    for (const history of [[], BACK_HISTORY, [...world.ids].reverse()]) {
      it(`Set up build (${starterFacts ? 'starter rows' : 'catalogue'}, history ${String(history.length)})`, () => {
        const pool = world.pool(history);
        for (const [day, mix] of ALL_MIXES) {
          const main = defaultBuilderMainLift({ groups: mix.map((g) => g.group), pool, info: world.info, catalogueKeyOf: (id) => id });
          // Only an arms day has no main compound.
          expect(main === null, day).toBe(day === 'arms');
          for (const minutes of lengths) {
            for (const supersets of [true, false]) {
              for (const mainLiftExerciseId of main === null ? [null] : [null, main]) {
                const label = `${day} ${String(minutes)} min supersets ${String(supersets)} main ${String(mainLiftExerciseId)}`;
                const rec = recommendForSetup(mix, { minutes, mainLiftExerciseId, supersets }, pool, world.ctx());
                for (const groups of [rec.groups, mix.map((g) => ({ ...g }))]) {
                  const r = buildFromSetup({ minutes, mainLiftExerciseId, supersets, groups }, pool, world.ctx());
                  expectRules(r.workout, world, mainLiftExerciseId !== null, label);
                  if (!supersets) expect(r.workout.blocks.every((b) => b.slots.length === 1), label).toBe(true);
                }
              }
            }
          }
        }
      });
    }

    it(`Today card: grow, abs on/off, accessories, Mix it up (${starterFacts ? 'starter rows' : 'catalogue'})`, () => {
      const pool = world.pool(BACK_HISTORY);
      for (const [day, mix] of ALL_MIXES) {
        const main = defaultBuilderMainLift({ groups: mix.map((g) => g.group), pool, info: world.info, catalogueKeyOf: (id) => id });
        for (const mainLiftExerciseId of main === null ? [null] : [null, main]) {
          const today: TodayDay = {
            key: `other:${day}`,
            kind: 'other',
            name: day,
            planId: null,
            dayIndex: null,
            splitDayId: day,
            templates: [{ routineId: null, version: null, label: day, mainLiftExerciseId, exerciseIds: [], minutes: 45, absPlan: true, supersetsPlan: true, groups: mix }],
          };
          for (const minutes of [20, 30, 45, 60, 90]) {
            for (const supersets of [true, false]) {
              for (const abs of [null, false]) {
                for (const accessories of ['focused', 'varied'] as const) {
                  for (const m of [0, 1, 2]) {
                    const label = `today ${day} ${String(minutes)} ss ${String(supersets)} abs ${String(abs)} ${accessories} mix ${String(m)} main ${String(mainLiftExerciseId)}`;
                    const d = assembleTodayDraft({
                      day: today,
                      controls: { mainLiftExerciseId, accessories, minutes, abs, supersets, mix: m },
                      ctx: world.ctx(),
                      pool,
                      mix: { candidates: pool, recentCountOnDay: new Map(), lastTwoOnDay: new Set(), lastDoneMs: new Map(), availableHere: () => true, painFlagged: () => false },
                    });
                    if (d === null) throw new Error(label);
                    // Mix it up swaps in place (same role, maybe heavier): pairing rules always; band order before a swap.
                    expectRules(d.workout, world, mainLiftExerciseId !== null, label, { order: m === 0 });
                  }
                }
              }
            }
          }
        }
      }
    });
  }
});

describe('the builder never re-pairs a heavy lift', () => {
  const world = catalogueWorld({ starterFacts: true });
  const slot = (exerciseId: string, main = false): BuilderSlot => ({ key: exerciseId, exerciseId, main, repRange: { min: 8, max: 12 }, rows: [], unit: 'kg', convention: 'total', source: 'none', startLight: null, anchorE1rm: null });

  it('pairSlots leaves heavy lifts single; orderSlots puts the heaviest bar lift first with no main lift', () => {
    const ordered = orderSlots([slot('bodyweight-45-degree-back-extension'), slot('cable-curl'), slot(ROW), slot('dumbbell-curl')], world.info);
    expect(ordered.map((s) => s.exerciseId)).toEqual([ROW, 'bodyweight-45-degree-back-extension', 'cable-curl', 'dumbbell-curl']);
    const blocks = pairSlots(singlesOf(ordered), world.info);
    expect(blocks[0]?.slots.map((s) => s.exerciseId)).toEqual([ROW]);
    expect(blocks.some((b) => b.slots.length > 1 && b.slots.some((s) => s.exerciseId === ROW))).toBe(false);
  });

  it('heaviest first among heavy lifts by known load when none is on a bar', () => {
    const facts = (id: string, heavy: boolean): BuilderExerciseInfo => ({ exerciseId: id, name: id, group: 'Legs', role: 'compound', heavy, part: 'quads', muscles: [id], angle: 'Quads', barbell: false });
    const info = (id: string) => facts(id, id !== 'light');
    const loads: Record<string, number> = { hack: 140, press: 200 };
    const load = (id: string): number | null => loads[id] ?? null;
    expect(orderSlots([slot('light'), slot('hack'), slot('press')], info, { load }).map((s) => s.exerciseId)).toEqual(['press', 'hack', 'light']);
  });

  it("splitInvalidAutoPairs splits a builder pair that now holds a heavy lift; Ben's own pairs stay", () => {
    const blocks: BuilderBlock[] = [
      { slots: [slot(ROW), slot('cable-curl')], auto: true },
      { slots: [slot('barbell-shrug'), slot('dumbbell-curl')], auto: false },
    ];
    const out = splitInvalidAutoPairs(blocks, world.info);
    expect(out.map((b) => b.slots.map((s) => s.exerciseId))).toEqual([[ROW], ['cable-curl'], ['barbell-shrug', 'dumbbell-curl']]);
  });

  it('a Supersets merge never pairs a heavy lift', () => {
    const pool = world.pool(BACK_HISTORY);
    const ctx = world.ctx();
    const groups: GroupCount[] = [
      { group: 'Back', count: 4 },
      { group: 'Arms', count: 2 },
    ];
    const prev = { minutes: 40, mainLiftExerciseId: null, supersets: false, groups, dayId: 'back', variationId: null };
    const built = buildFromSetup(prev, pool, ctx).workout;
    const merged = mergeSetupChange(prev, { ...prev, supersets: true }, built, pool, ctx);
    if (merged.kind !== 'merged') throw new Error('expected a merge');
    expectRules(merged.workout, world, false, 'merge', { order: false });
    expect(merged.workout.blocks.some((b) => b.slots.length > 1)).toBe(true);
  });
});

describe('heaviest bar lift first with no main lift (varied loads)', () => {
  const world = catalogueWorld({ starterFacts: true, variedLoads: true });
  it('every day × length × Supersets: the heaviest known bar lift leads', () => {
    const pool = world.pool();
    for (const [day, mix] of ALL_MIXES) {
      for (const minutes of [20, 30, 45, 60, 90]) {
        for (const supersets of [true, false]) {
          const groups = mix.map((g) => ({ ...g, count: g.group === 'Core' ? g.count : g.count + 1 }));
          const r = buildFromSetup({ minutes, mainLiftExerciseId: null, supersets, groups }, pool, world.ctx());
          expectRules(r.workout, world, false, `${day} ${String(minutes)} ss ${String(supersets)}`, { order: true, heaviest: true });
        }
      }
    }
  });
});

describe('Set up merges keep the order and pairing rules (review builder-order B1, S3)', () => {
  for (const starterFacts of [false, true]) {
    const world = catalogueWorld({ starterFacts });
    it(`group counts up and down, abs paired or off, length up (${starterFacts ? 'starter rows' : 'catalogue'})`, () => {
      const pool = world.pool(BACK_HISTORY);
      let checked = 0;
      for (const [day, mix] of ALL_MIXES) {
        const main = defaultBuilderMainLift({ groups: mix.map((g) => g.group), pool, info: world.info, catalogueKeyOf: (id) => id });
        for (const mainLiftExerciseId of main === null ? [null] : [null, main]) {
          for (const supersets of [true, false]) {
            for (const absOff of [false, true]) {
              for (const minutes of [30, 60]) {
                const groups = mix.filter((g) => !absOff || g.group !== 'Core').map((g) => ({ ...g, count: g.group === 'Core' && !absOff ? Math.max(1, g.count) : g.count }));
                const prev = { minutes, mainLiftExerciseId, supersets, groups, dayId: day, variationId: null };
                const built = buildFromSetup(prev, pool, world.ctx()).workout;
                const hasMain = mainLiftExerciseId !== null;
                const targets = [...new Set([...groups.map((g) => g.group), 'Back' as const, 'Arms' as const, 'Core' as const])];
                for (const g of targets) {
                  for (const delta of [1, 2, 3, -1]) {
                    const before = groups.find((x) => x.group === g)?.count ?? 0;
                    if (before + delta < 0) continue;
                    const nextGroups = groups.some((x) => x.group === g) ? groups.map((x) => (x.group === g ? { ...x, count: before + delta } : x)) : [...groups, { group: g, count: delta }];
                    const label = `${day} main ${String(mainLiftExerciseId)} ss ${String(supersets)} absOff ${String(absOff)} ${String(minutes)} min ${g} ${delta > 0 ? '+' : ''}${String(delta)}`;
                    const ctx = world.ctx();
                    const r = mergeSetupChange(prev, { ...prev, groups: nextGroups }, built, pool, ctx);
                    if (r.kind !== 'merged') continue;
                    expectRules(r.workout, world, hasMain, label);
                    // A second change on top (abs back on, another group up) keeps them too.
                    const again = mergeSetupChange({ ...prev, groups: nextGroups }, { ...prev, groups: nextGroups.map((x) => ({ ...x, count: x.count + 1 })) }, r.workout, pool, ctx);
                    if (again.kind === 'merged') expectRules(again.workout, world, hasMain, `${label} then all +1`);
                    checked += 1;
                  }
                }
                // Length up: more sets, same order and pairs.
                const longer = mergeSetupChange(prev, { ...prev, minutes: minutes + 30 }, built, pool, world.ctx());
                if (longer.kind === 'merged') expectRules(longer.workout, world, hasMain, `${day} ${String(minutes)} → ${String(minutes + 30)}`);
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(500);
    });
  }

  it("Ben's Back day, Main lift none, Back 1 → 4: Barbell row leads, compounds before the curl + abs pair", () => {
    const world = catalogueWorld({ starterFacts: true });
    const pool = world.pool(BACK_HISTORY);
    const ctx = world.ctx();
    const prev = {
      minutes: 60,
      mainLiftExerciseId: null,
      supersets: true,
      groups: [
        { group: 'Back' as const, count: 1 },
        { group: 'Arms' as const, count: 1 },
        { group: 'Core' as const, count: 1 },
      ],
      dayId: 'back',
      variationId: null,
    };
    const built = buildFromSetup(prev, pool, ctx).workout;
    const r = mergeSetupChange(prev, { ...prev, groups: prev.groups.map((g) => (g.group === 'Back' ? { ...g, count: 4 } : g)) }, built, pool, ctx);
    if (r.kind !== 'merged') throw new Error('expected a merge');
    const ns = names(r.workout, world.info);
    expect(ns[0]).toBe('Barbell row');
    expect(ns.findIndex((n) => n.includes('back extension'))).toBeGreaterThan(ns.findIndex((n) => n === 'Barbell row'));
    expect(ns[ns.length - 1]).toMatch(/Ab|abs|crunch|plank/i);
    expectRules(r.workout, world, false, 'ben merge');
  });
});

describe('bandInsertIndex', () => {
  const world = catalogueWorld({ starterFacts: true });
  const slot = (exerciseId: string, main = false): BuilderSlot => ({ key: exerciseId, exerciseId, main, repRange: { min: 8, max: 12 }, rows: [], unit: 'kg', convention: 'total', source: 'none', startLight: null, anchorE1rm: null });
  const blocks: BuilderBlock[] = [
    { slots: [slot('bodyweight-45-degree-back-extension')], auto: false },
    { slots: [slot('barbell-curl'), slot('bodyweight-ab-wheel-rollout')], auto: true },
  ];
  it('a heavy compound goes first; an isolation before the block holding abs; abs at the end; never above the main lift', () => {
    expect(bandInsertIndex(blocks, slot(ROW), world.info, ['Back'])).toBe(0);
    expect(bandInsertIndex(blocks, slot('dumbbell-rear-delt-fly'), world.info, ['Back'])).toBe(1);
    expect(bandInsertIndex(blocks, slot('cable-crunch'), world.info, ['Core'])).toBe(2);
    const withMain = [{ slots: [slot(ROW, true)], auto: false }, ...blocks];
    expect(bandInsertIndex(withMain, slot('barbell-seal-row'), world.info, ['Back'])).toBe(1);
    // Same band as the back extension (a compound): after it.
    expect(bandInsertIndex(withMain, slot('cable-lat-pulldown'), world.info, ['Back'])).toBe(2);
  });
});
