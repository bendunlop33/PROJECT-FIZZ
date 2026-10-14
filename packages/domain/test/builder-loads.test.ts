import { describe, expect, it } from 'vitest';

import type { EquipmentInstance, Exercise, Load } from '@fizz/schemas';

import {
  BUILDER_LOAD_BOUNDS,
  buildReferences,
  checkBasis,
  checkedOnOf,
  checkProposedLoad,
  checkSlotLoads,
  estimateOneRepMax,
  expectedLoad,
  getAchievableLoads,
  loadReferences,
  noReferenceCeiling,
  personalRatioReference,
  recheckDraftLoad,
  referenceE1rm,
  refSessionOf,
  relatedLiftReference,
  returnCut,
  type HistorySession,
  type LoadCheckContext,
  type LoadProposalIn,
  type LoadReferences,
  type LoadSlot,
  type SubstituteContext,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, id, kg, plateMachine, stack, T0_MS, TZ } from './fixtures';

/**
 * Coach-proposed loads (workout-builder.md v2.1 BD6, §8.5): WB-L1 – WB-L13
 * and WB26 on the spec's fixture (§9). Covers kg/lb, per-hand dumbbells,
 * stacks with a max, an assisted machine (direction: more assistance is
 * easier), added load on a dip belt, imported FitNotes history, pain and
 * session pain holds, and the plan-time re-check.
 */

const steps = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};
const plain = (s: string): string => s.replaceAll(' ', ' ');

const MAIN = id(2);
const bar = barbell({ id: id(700), gymId: MAIN, plates: [{ mass: 25, count: 4 }, { mass: 20, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }, { mass: 1.25, count: 2 }] });
const rack = dumbbells({ id: id(701), gymId: MAIN, loads: steps(2.5, 30, 2.5) });
const cable = stack({ id: id(702), gymId: MAIN, name: 'Cable station', stackLoads: steps(2.5, 100, 2.5) });
const assist = assisted({ id: id(703), gymId: MAIN, assistanceLoads: steps(5, 70, 5) });
const belt = plateMachine({ id: id(704), gymId: MAIN, name: 'Dip belt', loadingSides: 1, plates: [{ mass: 20, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }, { mass: 1.25, count: 2 }] });
const hotelRack = dumbbells({ id: id(710), gymId: id(3), loads: steps(2.5, 20, 2.5) });
const KNOWN = new Map<string, EquipmentInstance>([bar, rack, cable, assist, belt, hotelRack].map((e) => [e.id, e]));

const BENCH = exercise(210, 'Bench press', { movementPattern: 'horizontal_push', mechanic: 'compound' });
const INCLINE = exercise(211, 'Incline DB press', { movementPattern: 'horizontal_push', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const FLY = exercise(212, 'Cable fly', { movementPattern: 'horizontal_push', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const PUSHDOWN = exercise(214, 'Triceps pushdown', { movementPattern: 'elbow_extension', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const OHP = exercise(215, 'Overhead press', { movementPattern: 'vertical_push' });
const PULLUP = exercise(218, 'Assisted pull-up', { movementPattern: 'vertical_pull', compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });
const WEIGHTED = exercise(219, 'Weighted pull-up', { movementPattern: 'vertical_pull', compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added' });

const day = (n: number): number => n * 86_400;

function session(n: number, daysAgo: number, equipment: EquipmentInstance | null, sets: { load: Load; reps: number; rpe?: number }[], imported = false): HistorySession {
  return {
    sessionId: id(n),
    performedAtUtc: at(-day(daysAgo)).utc,
    equipmentId: imported ? null : (equipment?.id ?? null),
    gymId: imported ? null : MAIN,
    imported,
    sets: sets.map((s) => ({ setType: 'working' as const, side: null, load: s.load, reps: s.reps, rpe: s.rpe ?? null, rir: null })),
    tz: TZ,
  };
}

const gymWith = (...equipment: EquipmentInstance[]) => ({ id: MAIN, name: 'Main gym', equipment });
const ctxAt = (...equipment: EquipmentInstance[]): Pick<SubstituteContext, 'gym' | 'lastUsedHere' | 'knownEquipment' | 'unit'> => ({ gym: gymWith(...equipment), knownEquipment: KNOWN, unit: 'kg' });
const NOW = T0_MS;

function refs(ex: Exercise, history: HistorySession[], equipment: EquipmentInstance[], extra: Partial<Parameters<typeof loadReferences>[0]> = {}): LoadReferences {
  return loadReferences({ exercise: ex, history, ctx: ctxAt(...equipment), nowMs: NOW, ...extra });
}

const P = (value: number, convention: Load['convention'], basis: string | null = null, unit: 'kg' | 'lb' = 'kg'): LoadProposalIn => ({ value, unit, convention, basis });
const slot = (repsMin: number, repsMax: number, targetRpe: number): LoadSlot => ({ repsMin, repsMax, targetRpe });
const NO_PAIN: LoadCheckContext = { pain: null, askedHeavier: false };

// The spec's fixture (§9).
const BENCH_HISTORY = [
  session(900, 2, bar, [{ load: kg(100), reps: 7, rpe: 8 }, { load: kg(100), reps: 7, rpe: 8 }, { load: kg(100), reps: 7, rpe: 8 }]),
  session(901, 6, bar, [{ load: kg(97.5), reps: 8, rpe: 8 }, { load: kg(97.5), reps: 7, rpe: 8.5 }]),
  session(902, 10, bar, [{ load: kg(97.5), reps: 7, rpe: 8 }]),
];
const benchRefs = (): LoadReferences => refs(BENCH, BENCH_HISTORY, [bar]);
const BENCH_SLOT = slot(6, 8, 8);

describe('referenceE1rm and E (§8.5): separate from Progress’s estimateOneRepMax', () => {
  it('RIR-adjusted Epley over 1–12 reps, RIR 0 with no RPE, no display rounding', () => {
    expect(referenceE1rm([{ value: 100, reps: 7, rpe: 8 }])).toBeCloseTo(130, 6);
    expect(referenceE1rm([{ value: 25, reps: 12, rpe: 9 }])).toBeCloseTo(35.8333, 3);
    expect(referenceE1rm([{ value: 30, reps: 8, rpe: null }])).toBeCloseTo(38, 6);
    expect(referenceE1rm([{ value: 30, reps: 13, rpe: null }])).toBeNull();
    expect(expectedLoad(130, 6, 8)).toBeCloseTo(102.63, 2);
    // Progress is unchanged: plain Epley caps at 10 reps, so 25 × 12 has no e1RM there (WB-L3).
    expect(estimateOneRepMax({ value: 25, unit: 'kg', convention: 'stack' }, 12, 'weight_stack').eligible).toBe(false);
  });

  it('a gap of 14+ days cuts E by the approved return-to-load steps (R1–R2)', () => {
    expect(returnCut(13)).toBe(0);
    expect(returnCut(14)).toBe(0.1);
    expect(returnCut(28)).toBe(0.2);
    expect(returnCut(84)).toBe(0.4);
  });

  it('loadReferences lists the last 3 comparable sessions with their source and a history version', () => {
    const r = benchRefs();
    expect(r.own?.sessions.map((s) => s.top.value)).toEqual([100, 97.5, 97.5]);
    expect(r.own?.e1rm).toBeCloseTo(130, 6);
    expect(r.own?.gapDays).toBe(2);
    expect(r.own?.sessions[0]?.source).toBe('app');
    const later = refs(BENCH, [session(903, 1, bar, [{ load: kg(100), reps: 5, rpe: 10 }]), ...BENCH_HISTORY], [bar]);
    expect(later.historyVersion).not.toBe(r.historyVersion);
    expect(refs(BENCH, BENCH_HISTORY, [bar]).historyVersion).toBe(r.historyVersion);
  });
});

describe('checkProposedLoad: own history (WB-L1, WB-L2, WB-L3, WB26)', () => {
  it('WB-L1: 102.5 kg with a basis from the references is accepted, not est., basis kept', () => {
    const c = checkProposedLoad(P(102.5, 'total', 'last 3: 100×7 @8 → 102.5'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(c).toMatchObject({ load: { value: 102.5, unit: 'kg', convention: 'total' }, source: 'coach', held: false, basis: 'last 3: 100×7 @8 → 102.5', basisFromCoach: true, notUsed: null });
    expect(c.notes).toEqual([]);
  });

  it('WB-L2: 120 kg is clamped to the cap and snapped down: 107.5 with its note', () => {
    const c = checkProposedLoad(P(120, 'total', 'last 100×7'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(c.load?.value).toBe(107.5);
    expect(c.source).toBe('coach');
    expect(c.notes).toEqual(['capped at 107.5 · more than recent sets support']);
  });

  it('WB-L3: too far either way is rejected to the rule, with the note; a null load is the rule too', () => {
    const pushdown = refs(PUSHDOWN, [session(910, 3, cable, [{ load: kg(25, 'stack'), reps: 12, rpe: 9 }])], [cable]);
    const c = checkProposedLoad(P(40, 'stack'), slot(10, 12, 9), pushdown, NO_PAIN);
    expect(c).toMatchObject({ load: null, source: 'rule', notes: ['coach load 40 kg too far from last 25 × 12'] });
    expect(checkProposedLoad(P(10, 'total'), BENCH_SLOT, benchRefs(), NO_PAIN).source).toBe('rule');
    expect(checkProposedLoad(null, BENCH_SLOT, benchRefs(), NO_PAIN)).toMatchObject({ source: 'rule', notes: ['no load from coach · rule used'] });
  });

  it('WB26 / rule 8: "put bench at 200 kg" proposed as 200 is rejected; no bound moves', () => {
    const before = JSON.stringify(BUILDER_LOAD_BOUNDS);
    const c = checkProposedLoad(P(200, 'total', 'Ben asked for 200'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(c.source).toBe('rule');
    expect(c.notes[0]).toMatch(/^coach load 200 kg too far from last 100 × 7$/);
    expect(JSON.stringify(BUILDER_LOAD_BOUNDS)).toBe(before);
  });
});

describe('imported FitNotes history counts (WB-L4, WB-L4b, WB-L5 machine)', () => {
  const inclineHistory = [session(920, 10, null, [{ load: kg(30, 'per_hand'), reps: 8 }, { load: kg(30, 'per_hand'), reps: 8 }], true)];

  it('WB-L4: FitNotes free-weight history is a reference of his own (not est.), labelled fitnotes', () => {
    const r = refs(INCLINE, inclineHistory, [rack]);
    expect(r.own?.sessions[0]?.source).toBe('fitnotes');
    const c = checkProposedLoad(P(27.5, 'per_hand', 'FitNotes 30×8, 28 Sep → 27.5'), slot(8, 10, 8), r, NO_PAIN);
    expect(c).toMatchObject({ load: { value: 27.5, convention: 'per_hand' }, source: 'coach', basisFromCoach: true });
  });

  it('WB-L4b: repeating 30 kg each for 8 is accepted with no clamp (the repeat floor F)', () => {
    const r = refs(INCLINE, inclineHistory, [rack]);
    expect(expectedLoad(r.own?.e1rm ?? 0, 8, 8)).toBeCloseTo(28.5, 1);
    const c = checkProposedLoad(P(30, 'per_hand'), slot(8, 10, 8), r, NO_PAIN);
    expect(c.load?.value).toBe(30);
    expect(c.notes).toEqual([]);
  });

  it('a FitNotes machine import is only an est. reference (the machine can’t be known)', () => {
    const r = refs(PUSHDOWN, [session(921, 20, null, [{ load: kg(30, 'stack'), reps: 10 }], true)], [cable]);
    expect(r.own?.estOnly).toBe(true);
    expect(checkProposedLoad(P(30, 'stack'), slot(10, 12, 9), r, NO_PAIN).source).toBe('coach_est');
  });
});

describe('estimates are labelled and bounded (WB-L5, WB-L5b, WB-L5c)', () => {
  it('WB-L5: cable fly with no reference at 13 kg → 12.5 est., `13 → 12.5 (this stack)`', () => {
    const c = checkProposedLoad(P(13, 'stack'), slot(12, 15, 9), refs(FLY, [], [cable]), NO_PAIN);
    expect(c).toMatchObject({ load: { value: 12.5 }, source: 'coach_est', notes: ['13 → 12.5 (this stack)'], basis: 'est. · first time' });
  });

  it('WB-L5: pec deck from the related chest press (0.6–0.7): 40 → 32.5 est.', () => {
    const pecDeck = stack({ id: id(705), gymId: MAIN, name: 'Pec deck', stackLoads: steps(2.5, 100, 2.5) });
    const chestPress = [refSessionOf(session(930, 4, pecDeck, [{ load: kg(60, 'stack'), reps: 10 }]), 'kg', 'stack')].flatMap((s) => (s === null ? [] : [s]));
    const derived = relatedLiftReference({ fromName: 'Chest press', sessions: chestPress, ratio: { low: 0.6, high: 0.7 } }, NOW);
    expect(derived?.e1rm).toBeCloseTo(48, 6);
    const r = refs(FLY, [], [pecDeck], { derived });
    const c = checkProposedLoad(P(40, 'stack'), slot(12, 15, 9), r, NO_PAIN);
    expect(c.load?.value).toBe(32.5);
    expect(c.source).toBe('coach_est');
    expect(c.basis).toBe('est. from chest press 60×10');
  });

  it('WB-L5b: the first-time ceiling: cable fly at 100 → 25 est.; the assisted machine’s is 55 assist', () => {
    expect(noReferenceCeiling(cable)).toBe(25);
    expect(noReferenceCeiling(assist)).toBe(55);
    const c = checkProposedLoad(P(100, 'stack'), slot(12, 15, 9), refs(FLY, [], [cable]), NO_PAIN);
    expect(c).toMatchObject({ load: { value: 25 }, source: 'coach_est', notes: ['capped at 25 · first time'] });
    // Own same-pattern references lower it further (half their E).
    expect(noReferenceCeiling(cable, [30])).toBe(15);
    const first = checkProposedLoad(P(40, 'assistance'), slot(6, 8, 8), refs(PULLUP, [], [assist]), NO_PAIN);
    expect(first).toMatchObject({ load: { value: 55, convention: 'assistance' }, source: 'coach_est', notes: ['capped at 55 assist · first time'] });
  });

  it('WB-L5c: a personal ratio bounds a lift whose own history is too old, as est.', () => {
    const oldBench = [session(940, 220, bar, [{ load: kg(100), reps: 8, rpe: 8 }])];
    const old = oldBench.flatMap((h) => refSessionOf(h, 'kg', 'total') ?? []);
    const dbThen = refSessionOf(session(941, 210, rack, [{ load: kg(30, 'per_hand'), reps: 8, rpe: 8 }]), 'kg', 'per_hand');
    const dbNow = refSessionOf(session(942, 5, rack, [{ load: kg(32.5, 'per_hand'), reps: 8, rpe: 8 }]), 'kg', 'per_hand');
    const derived = personalRatioReference(old, [{ name: 'DB bench press', sessions: [dbNow, dbThen].flatMap((s) => (s === null ? [] : [s])) }], NOW);
    expect(derived?.kind).toBe('personal_ratio');
    const r = refs(BENCH, oldBench, [bar], { derived });
    expect(r.own).toBeNull();
    const ePr = expectedLoad(derived?.e1rm ?? 0, 6, 8);
    const c = checkProposedLoad(P(150, 'total'), BENCH_SLOT, r, NO_PAIN);
    expect(c.source).toBe('rule');
    const ok = checkProposedLoad(P(Math.floor(ePr), 'total'), BENCH_SLOT, r, NO_PAIN);
    expect(ok.source).toBe('coach_est');
    expect(ok.load?.value ?? 999).toBeLessThanOrEqual(ePr);
  });
});

describe('achievable and bounded (WB-L6, WB-L6b); conventions and units (WB-L8)', () => {
  it('WB-L6: a 110 kg proposal on a 100 kg stack becomes 100 with `capped at machine max 100 kg`', () => {
    const r = refs(PUSHDOWN, [session(950, 3, cable, [{ load: kg(95, 'stack'), reps: 8, rpe: 8 }])], [cable]);
    const c = checkProposedLoad(P(110, 'stack'), slot(6, 8, 8), r, NO_PAIN);
    expect(c.load?.value).toBe(100);
    expect(c.notes).toEqual(['capped at machine max 100 kg']);
  });

  it('WB-L6: every accepted load is in the item’s achievable list; at Hotel gym incline DB is ≤ 20 each', () => {
    const hotel = loadReferences({ exercise: INCLINE, history: [session(920, 10, null, [{ load: kg(30, 'per_hand'), reps: 8 }], true)], ctx: { gym: { id: id(3), name: 'Hotel', equipment: [hotelRack] }, knownEquipment: KNOWN, unit: 'kg' }, nowMs: NOW });
    const c = checkProposedLoad(P(30, 'per_hand'), slot(8, 10, 8), hotel, NO_PAIN);
    expect(c.load?.value).toBe(20);
    for (const [v, conv, r, s] of [
      [102.5, 'total', benchRefs(), BENCH_SLOT],
      [13, 'stack', refs(FLY, [], [cable]), slot(12, 15, 9)],
      [32, 'assistance', refs(PULLUP, [session(960, 4, assist, [{ load: kg(30, 'assistance'), reps: 8, rpe: 8 }])], [assist]), slot(8, 10, 8)],
    ] as const) {
      const out = checkProposedLoad(P(v, conv), s, r, NO_PAIN);
      const eq = r.equipment;
      expect(eq).not.toBeNull();
      if (eq !== null && out.load !== null) expect(getAchievableLoads(eq).loads).toContain(out.load.value);
    }
  });

  it('WB-L6b: a slot checked on a barbell re-checks as Rule where the exercise maps to dumbbells', () => {
    const stored = { load: kg(60), source: 'coach' as const, basis: 'last 60×8', basisFromCoach: true, held: false, notes: [], notUsed: null };
    const onDumbbells = loadReferences({ exercise: exercise(216, 'Press', { compatibleEquipment: ['barbell', 'dumbbells'] }), history: [], ctx: { gym: { id: id(3), name: 'Hotel', equipment: [hotelRack] }, knownEquipment: KNOWN, unit: 'kg' }, nowMs: NOW });
    const r = recheckDraftLoad(stored, BENCH_SLOT, onDumbbells, { pain: null, checkedOn: checkedOnOf(benchRefs()), builtAtUtc: at(-60).utc, nowMs: NOW });
    expect(r).toMatchObject({ load: null, source: 'rule', notes: ['different equipment here · rule used'] });
  });

  it('WB-L8: a `total` proposal for a dumbbell exercise is the rule; 225 lb on a kg bar is converted, then fitted', () => {
    const inc = refs(INCLINE, [session(920, 10, null, [{ load: kg(30, 'per_hand'), reps: 8 }], true)], [rack]);
    expect(checkProposedLoad(P(60, 'total'), slot(8, 10, 8), inc, NO_PAIN)).toMatchObject({ source: 'rule', notes: ['wrong load type · rule used'] });
    const c = checkProposedLoad(P(225, 'total', null, 'lb'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(c.load).toEqual({ value: 102.5, unit: 'kg', convention: 'total' });
    expect(c.notes[0]).toBe('lb → kg converted');
  });
});

describe('pain holds (WB-L7, WB-L7b)', () => {
  it('WB-L7: held at no harder than the most recent comparable load, not an older heavier FitNotes one', () => {
    const r = refs(OHP, [session(970, 3, bar, [{ load: kg(50), reps: 8, rpe: 8 }]), session(971, 40, null, [{ load: kg(60), reps: 6 }], true)], [bar]);
    const c = checkProposedLoad(P(57.5, 'total'), slot(6, 8, 8), r, { pain: { text: 'shoulder flagged 6 Oct' }, askedHeavier: false });
    expect(c).toMatchObject({ load: { value: 50 }, held: true });
    expect(c.notes).toContain('held · shoulder flagged 6 Oct');
    // No own history: no load at all.
    expect(checkProposedLoad(P(40, 'total'), slot(6, 8, 8), refs(OHP, [], [bar]), { pain: { text: 'shoulder flagged 6 Oct' }, askedHeavier: false })).toMatchObject({ load: null, source: 'none', held: true });
  });

  it('WB-L7b: session pain holds bench 102.5 at 100 with `held · pain reported today`', () => {
    const c = checkProposedLoad(P(102.5, 'total', 'last 100×7'), BENCH_SLOT, benchRefs(), { pain: { text: 'pain reported today' }, askedHeavier: false });
    expect(c).toMatchObject({ load: { value: 100 }, held: true, notes: ['held · pain reported today'] });
  });
});

describe('assisted and added loads in steps, toward easier (WB-L11)', () => {
  const pullups = refs(PULLUP, [session(980, 4, assist, [{ load: kg(30, 'assistance'), reps: 8, rpe: 8 }])], [assist]);
  const weighted = refs(WEIGHTED, [session(981, 4, belt, [{ load: kg(20, 'added'), reps: 6, rpe: 8 }])], [belt]);

  it('5 kg assistance (last 30) → 25, one step; 32 → 35 (toward easier), never 30', () => {
    expect(checkProposedLoad(P(5, 'assistance'), slot(8, 10, 8), pullups, NO_PAIN)).toMatchObject({ load: { value: 25, convention: 'assistance' }, notes: ['held at 25 assist · one step from last 30'] });
    expect(checkProposedLoad(P(32, 'assistance'), slot(8, 10, 8), pullups, NO_PAIN).load?.value).toBe(35);
    expect(checkProposedLoad(P(60, 'assistance'), slot(8, 10, 8), pullups, NO_PAIN)).toMatchObject({ load: { value: 40 }, notes: ['held at 40 assist · two steps from last 30'] });
  });

  it('+35 kg (last +20) → +21.25; "heavier" in Ben’s words allows +22.5', () => {
    expect(checkProposedLoad(P(35, 'added'), slot(5, 6, 8), weighted, NO_PAIN)).toMatchObject({ load: { value: 21.25, convention: 'added' }, notes: ['held at +21.25 · one step from last +20'] });
    expect(checkProposedLoad(P(35, 'added'), slot(5, 6, 8), weighted, { pain: null, askedHeavier: true }).load?.value).toBe(22.5);
  });
});

describe('newer history re-check and slot consistency (WB-L12, WB-L13)', () => {
  it('WB-L12: a newer 100 × 5 @ 10 caps a stored 102.5 at 95 with the newer session named', () => {
    const r1 = benchRefs();
    const stored = { load: kg(102.5), source: 'coach' as const, basis: 'last 3: 100×7 @8 → 102.5', basisFromCoach: true, held: false, notes: [], notUsed: null };
    const builtAt = at(-day(1) - 3600).utc;
    const newer = refs(BENCH, [session(990, 1, bar, [{ load: kg(100), reps: 5, rpe: 10 }]), ...BENCH_HISTORY], [bar]);
    const r = recheckDraftLoad(stored, BENCH_SLOT, newer, { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: builtAt, nowMs: NOW });
    expect(r.load?.value).toBe(95);
    expect(plain(r.notes.join(' | '))).toMatch(/^capped at 95 · newer session \d+ Oct$/);
    expect(newer.historyVersion).not.toBe(r1.historyVersion);
    // No newer session: the stored load stands, unchanged and offline.
    const same = recheckDraftLoad(stored, BENCH_SLOT, r1, { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: at(0).utc, nowMs: NOW });
    expect(same).toMatchObject({ load: { value: 102.5 }, source: 'coach', notes: [] });
    // A flag set after the build caps it the same way (BD10).
    const held = recheckDraftLoad(stored, BENCH_SLOT, r1, { pain: { text: 'shoulder flagged 9 Oct' }, checkedOn: checkedOnOf(r1), builtAtUtc: at(0).utc, nowMs: NOW });
    expect(held).toMatchObject({ load: { value: 100 }, held: true });
  });

  it('WB-L13: back-offs harder than a clamped top set drop to the top set’s load', () => {
    const top = checkProposedLoad(P(100, 'total'), slot(3, 5, 8.5), benchRefs(), NO_PAIN);
    const back = checkProposedLoad(P(102.5, 'total'), BENCH_SLOT, benchRefs(), NO_PAIN);
    const out = checkSlotLoads(top, back);
    expect(out.load?.value).toBe(100);
    expect(out.notes).toContain('back-offs ≤ top set');
    // Assisted: more assistance is easier, so a back-off with less assistance than the top set drops to it.
    const a = checkSlotLoads({ ...back, load: kg(30, 'assistance') }, { ...back, load: kg(25, 'assistance'), notes: [] });
    expect(a.load?.value).toBe(30);
  });
});

describe('checkBasis (WB-L9): only numbers it may cite', () => {
  const allowed = [100, 7, 8, 102.5, 2.5, 6, 130];
  it('accepts reference numbers in any of the normal forms, and the proposal’s own value', () => {
    expect(checkBasis('last 3: 100×7 @8 → 102.5', allowed, 3)).toBe(true);
    expect(checkBasis('last 100 kg × 7 @ RPE 8', allowed, 3)).toBe(true);
    expect(checkBasis('100kg x7, +2.5', allowed, 3)).toBe(true);
    expect(checkBasis('est. 1RM ≈130', allowed, 3)).toBe(true);
  });
  it('rejects invented sets, `last N` beyond the references, an unmarked 1RM, praise and long text', () => {
    expect(checkBasis('110×5 last week', allowed, 3)).toBe(false);
    expect(checkBasis('last 5: 100×7', allowed, 3)).toBe(false);
    expect(checkBasis('1RM 130', allowed, 3)).toBe(false);
    expect(checkBasis('safe jump from 100×7', allowed, 3)).toBe(false);
    expect(checkBasis('x'.repeat(61), allowed, 3)).toBe(false);
  });
  it('a failing basis is replaced by code’s and kept under NOT USED', () => {
    const c = checkProposedLoad(P(102.5, 'total', 'you hit 110×5 last week'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(c).toMatchObject({ basis: 'last 100×7 @8', basisFromCoach: false, notUsed: 'you hit 110×5 last week' });
  });
});

describe('buildReferences: Ben’s own same-pattern lifts (WB-L5c, B1)', () => {
  const DB_PRESS = exercise(221, 'DB bench press', { movementPattern: 'horizontal_push', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
  const ctx = ctxAt(bar, rack, cable);

  it('an exercise with only old history gets a personal ratio (est.) from a pattern-mate done within 28 days of it', () => {
    const oldBench = [session(940, 220, bar, [{ load: kg(100), reps: 8, rpe: 8 }])];
    const db = [session(941, 210, rack, [{ load: kg(30, 'per_hand'), reps: 8, rpe: 8 }]), session(942, 5, rack, [{ load: kg(32.5, 'per_hand'), reps: 8, rpe: 8 }])];
    const r = buildReferences({ target: { exercise: BENCH, history: oldBench }, mates: [{ exercise: DB_PRESS, history: db }], ctx, nowMs: NOW });
    expect(r.own).toBeNull();
    expect(r.derived).toMatchObject({ kind: 'personal_ratio', text: 'db bench press 32.5×8' });
    // 100 kg bench ≈ 3.33 × the 30 kg DB press then; now 32.5 → about 108.3 e1RM-equivalent × (1 + 10/30).
    expect(r.derived?.e1rm).toBeCloseTo((100 / 30) * 32.5 * (1 + 10 / 30), 6);
    expect(checkProposedLoad(P(150, 'total'), BENCH_SLOT, r, NO_PAIN).source).toBe('rule');
  });

  it('a first-time exercise’s ceiling also uses half the E of his same-pattern, same-convention lifts', () => {
    const pushdowns = [session(950, 3, cable, [{ load: kg(25, 'stack'), reps: 12, rpe: 9 }])];
    const PRESSDOWN = exercise(222, 'Rope pressdown', { movementPattern: 'elbow_extension', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
    const r = buildReferences({ target: { exercise: PRESSDOWN, history: [] }, mates: [{ exercise: PUSHDOWN, history: pushdowns }], ctx, nowMs: NOW });
    expect(r.patternE1rms).toHaveLength(1);
    const c = checkProposedLoad(P(30, 'stack'), slot(10, 12, 9), r, NO_PAIN);
    // Half of E (≈ 26.2) is ≈ 13.1 → 12.5 on this stack, below the range ceiling of 25.
    expect(c).toMatchObject({ load: { value: 12.5 }, source: 'coach_est', notes: ['capped at 12.5 · first time'] });
  });
});
