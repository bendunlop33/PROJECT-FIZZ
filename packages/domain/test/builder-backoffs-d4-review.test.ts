import { describe, expect, it } from 'vitest';
import { DraftPlanSchema } from '@fizz/schemas';
import {
  BACKOFF_BANDS,
  applyVariation,
  changeSetType,
  editSetRow,
  fromDraftPlan,
  reloadSlotLoads,
  setRowsFor,
  setWorkingCount,
  slotAtNewGym,
  toDraftPlan,
  type BuilderContext,
  type BuilderSetRow,
  type BuilderSlot,
  type DraftCodecContext,
  type MainFocus,
  type RowPatch,
  type SetRowsInput,
  type SlotLoadInput,
} from '../src/index';
import { cable, info, loadInput } from './builder-v3-fixture';
import { id } from './fixtures';

/**
 * Review of D4 (batch 23 Oct, track loads): B1 (the ratchet), B2 (a top reps or RPE edit), B3 (the band's lower edge
 * made back-offs heavier than their reps and RPE allow), the MEDIUM and LOW findings. A back-off Ben didn't type is a
 * function of the slot's top as it is now, worked out the same way on every path, never of the edits before.
 */

const FOCI: MainFocus[] = ['strength', 'balanced', 'muscle'];
const rule100 = { ruleTarget: { value: 100, reps: 6, rpe: 8 } };
/** Est. max from 100 × 6 @ 8 (Epley, RIR 2). */
const E1RM = 100 * (1 + 8 / 30);

const benchIn = (load: Partial<SlotLoadInput>, over: Partial<SetRowsInput> = {}): SetRowsInput => ({
  main: true,
  role: 'compound',
  barbell: true,
  workingSets: 3,
  repRange: { min: 6, max: 8 },
  load: loadInput(load),
  ...over,
});
const slotOf = (input: SetRowsInput): BuilderSlot => {
  const r = setRowsFor(input);
  return { key: 'k', exerciseId: 'x', main: input.main, repRange: input.repRange, rows: r.rows, unit: r.unit, convention: r.convention, source: r.source, startLight: r.startLight, anchorE1rm: r.anchorE1rm };
};
const work = (rows: readonly BuilderSetRow[]) => rows.filter((r) => r.type !== 'warmup');
const top = (s: BuilderSlot) => s.rows.find((r) => r.type === 'top')?.load ?? null;
const backoffs = (s: BuilderSlot) => s.rows.filter((r) => r.type === 'backoff').map((r) => r.load);
const topIndex = (s: BuilderSlot) => s.rows.findIndex((r) => r.type === 'top');
const edit = (s: BuilderSlot, i: number, patch: RowPatch, load: SlotLoadInput): BuilderSlot => {
  const r = editSetRow(s, i, patch, load);
  if (!r.ok) throw new Error(r.reason);
  return r.slot;
};
const typeTop = (s: BuilderSlot, kg: number, load: SlotLoadInput) => edit(s, topIndex(s), { kind: 'load', value: kg }, load);
/** `Gym changed` to the same bar: what every path agrees the slot's working sets are. */
const regym = (s: BuilderSlot, load: SlotLoadInput) => work(reloadSlotLoads(s, { role: 'compound', barbell: true }, load).rows).map((r) => r.load);
/** Rounded down on the fixture bar (2.5 kg steps). */
const down = (v: number) => Math.floor(v / 2.5 + 1e-9) * 2.5;
const built: Record<MainFocus, number> = { strength: 95, balanced: 95, muscle: 90 };

describe('B1: back-offs follow today’s top, measured from the top they were worked out from (no ratchet)', () => {
  for (const focus of FOCI) {
    const load = loadInput({ ...rule100, mainFocus: focus });
    const base = () => slotOf(benchIn({ ...rule100, mainFocus: focus }));

    it(`${focus}: 100 → 110 → 100 puts the back-offs back (${String(built[focus])}); again and again never compounds`, () => {
      let s = base();
      expect(top(s)).toBe(100);
      expect(backoffs(s)).toEqual([built[focus], built[focus]]);
      s = typeTop(s, 110, load);
      expect(backoffs(s)).toEqual([built[focus], built[focus]]);
      s = typeTop(s, 100, load);
      expect(backoffs(s)).toEqual([built[focus], built[focus]]);
      for (let k = 0; k < 3; k += 1) {
        s = typeTop(typeTop(s, 105, load), 100, load);
        expect(top(s)).toBe(100);
        expect(backoffs(s)).toEqual([built[focus], built[focus]]);
      }
      expect(regym(s, load)).toEqual(work(s.rows).map((r) => r.load));
    });

    it(`${focus}: a lighter top lands on the same back-offs whatever came before (90 direct = 110 then 90 = 95 then 90)`, () => {
      const direct = typeTop(base(), 90, load);
      const viaHeavier = typeTop(typeTop(base(), 110, load), 90, load);
      const viaLighter = typeTop(typeTop(base(), 95, load), 90, load);
      // The back-off as built × 90 / 100, rounded down: Strength / Balanced 95 → 85.5 → 85; Muscle 90 → 81 → 80.
      const want = focus === 'muscle' ? 80 : 85;
      for (const s of [direct, viaHeavier, viaLighter]) {
        expect(top(s)).toBe(90);
        expect(backoffs(s)).toEqual([want, want]);
        expect(regym(s, load)).toEqual(work(s.rows).map((r) => r.load));
      }
    });
  }

  it('pain hold (cap 90): built 90 / 85; Ben types 95 (May hurt) → 90, then 90 again → 85, not 80', () => {
    const load = loadInput({ ...rule100, painCap: 90 });
    let s = slotOf(benchIn({ ...rule100, painCap: 90 }));
    expect(top(s)).toBe(90);
    expect(backoffs(s)).toEqual([85, 85]);
    const r = editSetRow(s, topIndex(s), { kind: 'load', value: 95 }, load);
    if (!r.ok) throw new Error(r.reason);
    expect(r.mayHurt).toBe(true);
    s = r.slot;
    // 95 × 95 / 100 = 90.25, held at the pain cap → 90; never above the hold.
    expect(backoffs(s)).toEqual([90, 90]);
    s = typeTop(s, 90, load);
    expect(backoffs(s)).toEqual([85, 85]);
    expect(regym(s, load)).toEqual(work(s.rows).map((r) => r.load));
  });

  it('a back-off Ben typed keeps his kg through every top change; the others still follow the top', () => {
    const load = loadInput(rule100);
    let s = slotOf(benchIn(rule100));
    const bi = s.rows.findIndex((r) => r.type === 'backoff');
    s = edit(s, bi, { kind: 'load', value: 92.5 }, load);
    s = typeTop(typeTop(typeTop(s, 110, load), 90, load), 100, load);
    expect(backoffs(s)).toEqual([92.5, 95]);
  });
});

describe('B2: a top reps, RPE or type edit moves the back-offs with the top, never at or above it', () => {
  const cases: [string, RowPatch, number][] = [
    ['top reps 6 → 10', { kind: 'reps', reps: 10 }, 90],
    ['top reps 6 → 8', { kind: 'reps', reps: 8 }, 95],
    ['top RPE 8 → 6', { kind: 'rpe', rpe: 6 }, 95],
  ];
  // Below the new top as worked out from the anchor: Balanced 4 %, Strength 2 %, Muscle 8 %, rounded down.
  const want: Record<MainFocus, Record<number, number>> = {
    strength: { 90: 87.5, 95: 92.5 },
    balanced: { 90: 85, 95: 90 },
    muscle: { 90: 82.5, 95: 85 },
  };
  for (const focus of FOCI) {
    const load = loadInput({ ...rule100, mainFocus: focus });
    for (const [name, patch, t] of cases) {
      it(`${focus}: ${name} → top ${String(t)}, back-offs ${String(want[focus][t])}; Gym changed agrees`, () => {
        const s0 = slotOf(benchIn({ ...rule100, mainFocus: focus }));
        const s = edit(s0, topIndex(s0), patch, load);
        expect(top(s)).toBe(t);
        expect(backoffs(s)).toEqual([want[focus][t], want[focus][t]]);
        for (const b of backoffs(s)) expect(b ?? Infinity).toBeLessThanOrEqual(down(t * (1 - BACKOFF_BANDS[focus].min)));
        expect(regym(s, load)).toEqual(work(s.rows).map((r) => r.load));
      });
    }
  }

  it('a top Ben typed keeps its kg on a reps edit; the back-offs are worked out below the top at those reps', () => {
    const load = loadInput(rule100);
    const s = edit(typeTop(slotOf(benchIn(rule100)), 100, load), topIndex(slotOf(benchIn(rule100))), { kind: 'reps', reps: 10 }, load);
    expect(top(s)).toBe(100);
    for (const b of backoffs(s)) expect(b ?? Infinity).toBeLessThan(100);
    expect(regym(s, load)).toEqual(work(s.rows).map((r) => r.load));
  });

  it('a back-off made Top: the old top turns back-off, every back-off below the new top', () => {
    const load = loadInput(rule100);
    const s0 = slotOf(benchIn(rule100));
    const last = s0.rows.length - 1;
    const r = changeSetType(s0, last, 'top', load);
    if (!r.ok) throw new Error(r.reason);
    const t = top(r.slot) ?? 0;
    expect(t).toBe(100);
    for (const b of backoffs(r.slot)) expect(b ?? Infinity).toBeLessThanOrEqual(down(t * 0.96));
  });

  it('+ set and a plan variation’s set count on a main lift with only a top: the copy is a back-off below the top (review S3)', () => {
    const load = loadInput(rule100);
    const one = slotOf(benchIn(rule100, { workingSets: 1 }));
    expect(backoffs(setWorkingCount(one, 3, load))).toEqual([95, 95]);
    const ctx: BuilderContext = { info, loads: () => load, newKey: (e) => e };
    const v = applyVariation({ restLevel: 'normal', blocks: [{ slots: [one], auto: false }] }, [{ kind: 'set_count', exerciseId: 'x', n: 3 }], ctx);
    const slot = v.workout.blocks[0]?.slots[0];
    if (slot === undefined) throw new Error('no slot');
    expect(top(slot)).toBe(100);
    expect(backoffs(slot)).toEqual([95, 95]);
  });
});

describe('B3: a back-off keeps what its reps and RPE give; the band’s lower edge is only a check', () => {
  it('Balanced / Strength 12 @ 8 → 85 and 15 @ 8 → 80; Muscle 15 @ 8 → 80 (not 90 / 85, past failure)', () => {
    for (const focus of FOCI) {
      const load = loadInput({ ...rule100, mainFocus: focus });
      const s0 = slotOf(benchIn({ ...rule100, mainFocus: focus }));
      const bi = s0.rows.findIndex((r) => r.type === 'backoff');
      expect(edit(s0, bi, { kind: 'reps', reps: 12 }, load).rows[bi]?.load).toBe(85);
      expect(edit(s0, bi, { kind: 'reps', reps: 15 }, load).rows[bi]?.load).toBe(80);
    }
  });

  it('Your workout, feasible: every focus, reps 3–15, RPE 6–10, the kg × (1 + (reps + RIR) / 30) ≤ est. max, below the top', () => {
    for (const focus of FOCI) {
      for (let reps = 3; reps <= 15; reps += 1) {
        for (const rpe of [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]) {
          const load = loadInput({ ...rule100, mainFocus: focus });
          const s0 = slotOf(benchIn({ ...rule100, mainFocus: focus }));
          const bi = s0.rows.findIndex((r) => r.type === 'backoff');
          const kg = edit(edit(s0, bi, { kind: 'reps', reps }, load), bi, { kind: 'rpe', rpe }, load).rows[bi]?.load ?? Infinity;
          expect(kg * (1 + (reps + 10 - rpe) / 30)).toBeLessThanOrEqual(E1RM + 1e-6);
          expect(kg).toBeLessThan(100);
        }
      }
    }
  });

  it('after Ben types a heavier top (115), re-entering a back-off’s reps keeps 95, not 102.5 (HT8)', () => {
    const load = loadInput(rule100);
    const s = typeTop(slotOf(benchIn(rule100)), 115, load);
    const bi = s.rows.findIndex((r) => r.type === 'backoff');
    expect(edit(s, bi, { kind: 'reps', reps: 8 }, load).rows[bi]?.load).toBe(95);
  });
});

describe('MEDIUM (a): with a heavier top Ben typed, an easier back-off is lighter, never heavier', () => {
  it('top 110 typed: back-off reps 8 → 10 gives 90; RPE 8 → 7 gives 92.5 (both were 97.5)', () => {
    const load = loadInput(rule100);
    const s = typeTop(slotOf(benchIn(rule100)), 110, load);
    const bi = s.rows.findIndex((r) => r.type === 'backoff');
    expect(edit(s, bi, { kind: 'reps', reps: 10 }, load).rows[bi]?.load).toBe(90);
    expect(edit(s, bi, { kind: 'rpe', rpe: 7 }, load).rows[bi]?.load).toBe(92.5);
  });
});

describe('LOW: a drop set follows the set it drops from', () => {
  it('top 100 + drop 77.5: Ben types 70 → drop 52.5; 100 again → 77.5', () => {
    const load = loadInput(rule100);
    const one = slotOf(benchIn(rule100, { workingSets: 1 }));
    const s0: BuilderSlot = { ...one, rows: [...one.rows, { type: 'drop', reps: 10, load: 77.5, rpe: 9 }] };
    const s1 = typeTop(s0, 70, load);
    expect(work(s1.rows).map((r) => [r.type, r.load])).toEqual([
      ['top', 70],
      ['drop', 52.5],
    ]);
    expect(work(typeTop(s1, 100, load).rows).map((r) => r.load)).toEqual([100, 77.5]);
  });
});

describe('a saved workout’s own back-offs (no anchor): the same % from the top they were saved for', () => {
  const load = loadInput(rule100);
  const saved = (): BuilderSlot => ({
    key: 'k',
    exerciseId: 'x',
    main: true,
    repRange: { min: 5, max: 5 },
    unit: 'kg',
    convention: 'total',
    source: 'saved',
    startLight: null,
    anchorE1rm: null,
    rows: [
      { type: 'top', reps: 5, load: 100, rpe: 8 },
      { type: 'backoff', reps: 5, load: 90, rpe: 8 },
      { type: 'backoff', reps: 5, load: 90, rpe: 8 },
      { type: 'drop', reps: 10, load: 70, rpe: 9 },
    ],
  });

  it('110 → 100 → 80 → 100: back-offs 90, 90, 70, 90; the drop follows the last back-off', () => {
    let s = typeTop(saved(), 110, load);
    expect(work(s.rows).map((r) => r.load)).toEqual([110, 90, 90, 70]);
    s = typeTop(s, 100, load);
    expect(work(s.rows).map((r) => r.load)).toEqual([100, 90, 90, 70]);
    s = typeTop(s, 80, load);
    // 90 × 80 / 100 = 72 → 70 on the bar; the drop 70 × 0.78 = 54.6 → 52.5.
    expect(work(s.rows).map((r) => r.load)).toEqual([80, 70, 70, 52.5]);
    s = typeTop(s, 100, load);
    expect(work(s.rows).map((r) => r.load)).toEqual([100, 90, 90, 70]);
  });

  it('a force-close keeps the top they were saved for (codec): 110 typed, read back, then 100 → 90 again', () => {
    const codec: DraftCodecContext = { info, catalogueIdOf: (e) => e, checkedOnOf: () => null };
    const s = { ...typeTop(saved(), 110, load), key: id(8801), exerciseId: id(8802) };
    const plan = toDraftPlan({ restLevel: 'normal', blocks: [{ slots: [s], auto: false }] }, codec);
    const parsed = DraftPlanSchema.safeParse(plan);
    expect(parsed.error?.issues ?? []).toEqual([]);
    const back = fromDraftPlan(plan).blocks[0]?.slots[0];
    if (back === undefined) throw new Error('lost');
    expect(back.rows.filter((r) => r.type === 'backoff').map((r) => r.backoffFrom)).toEqual([
      { load: 90, top: 100 },
      { load: 90, top: 100 },
    ]);
    expect(backoffs(typeTop(back, 100, load))).toEqual([90, 90]);
    expect(backoffs(typeTop(back, 90, load))).toEqual([80, 80]);
  });

  it('never above today’s top (a saved back-off heavier than the top Ben types)', () => {
    const s = typeTop({ ...saved(), rows: [{ type: 'top', reps: 5, load: 100, rpe: 8 }, { type: 'backoff', reps: 5, load: 100, rpe: 8 }] }, 97.5, load);
    expect(backoffs(s)).toEqual([97.5]);
  });

  it('Gym changed on an edited saved slot: a lighter top Ben kept lowers the planned back-offs by the same % (not 90 over 80)', () => {
    const planned = saved();
    const mine = typeTop(saved(), 80, load);
    const base = { ...mine, rows: mine.rows.map((r) => ({ ...r })) };
    const r = slotAtNewGym(mine, planned, base, true, load);
    expect(r.fromPlanned).toBe(true);
    expect(work(r.slot.rows).map((x) => x.load)).toEqual([80, 70, 70, 52.5]);
    // Without the load inputs (older callers), as before.
    expect(work(slotAtNewGym(mine, planned, base, true).slot.rows).map((x) => x.load)).toEqual([80, 90, 90, 70]);
  });
});

describe('every path agrees after any sequence of edits (Your workout vs Gym changed)', () => {
  it('300 seeded edits per focus: untyped back-offs below the top, feasible, and equal to Gym changed’s', () => {
    for (const focus of FOCI) {
      const load = loadInput({ ...rule100, mainFocus: focus });
      let s = slotOf(benchIn({ ...rule100, mainFocus: focus }));
      let seed = 23;
      const rnd = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
      };
      const pick = <T,>(xs: readonly T[]): T => xs[rnd(xs.length)] as T;
      for (let step = 0; step < 300; step += 1) {
        const ti = topIndex(s);
        const bis = s.rows.map((r, i) => (r.type === 'backoff' ? i : -1)).filter((i) => i >= 0);
        const kind = rnd(5);
        if (kind === 0) s = typeTop(s, pick([85, 90, 95, 100, 105, 110, 115]), load);
        else if (kind === 1) s = edit(s, ti, { kind: 'reps', reps: pick([4, 5, 6, 8, 10]) }, load);
        else if (kind === 2) s = edit(s, ti, { kind: 'rpe', rpe: pick([7, 7.5, 8, 9]) }, load);
        else if (kind === 3) s = edit(s, pick(bis), { kind: 'reps', reps: pick([5, 6, 8, 10, 12]) }, load);
        else s = edit(s, pick(bis), { kind: 'rpe', rpe: pick([6, 7, 8, 9]) }, load);
        const t = top(s) ?? 0;
        for (const r of s.rows) {
          if (r.type !== 'backoff' || r.typed === true) continue;
          const kg = r.load ?? Infinity;
          expect(kg).toBeLessThan(t);
          expect(kg).toBeLessThanOrEqual(down(t * (1 - BACKOFF_BANDS[focus].min)) + 1e-9);
          expect(kg * (1 + (r.reps + 10 - (r.rpe ?? 8)) / 30)).toBeLessThanOrEqual(E1RM + 1e-6);
        }
        expect(regym(s, load)).toEqual(work(s.rows).map((r) => r.load));
      }
    }
  });
});

describe('a stack’s max still bounds the top', () => {
  it('a stack top capped at 100: back-offs below it after a top edit', () => {
    const load = loadInput({ equipment: cable, convention: 'stack', ruleTarget: { value: 130, reps: 6, rpe: 8 } });
    const s0 = slotOf({ main: true, role: 'compound', barbell: false, workingSets: 3, repRange: { min: 6, max: 8 }, load });
    expect(top(s0)).toBe(100);
    const s = edit(s0, topIndex(s0), { kind: 'rpe', rpe: 7 }, load);
    expect(top(s)).toBe(100);
    for (const b of backoffs(s)) expect(b ?? Infinity).toBeLessThan(100);
  });
});
