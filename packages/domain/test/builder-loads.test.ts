import { describe, expect, it } from 'vitest';

import type { EquipmentInstance, Exercise, Load } from '@fizz/schemas';

import {
  BUILDER_LOAD_BOUNDS,
  buildReferences,
  checkBasis,
  checkCoachWords,
  checkedOnOf,
  coachSentences,
  checkProposedLoad,
  checkSlotLoads,
  estimateOneRepMax,
  fitKeepingTail,
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
  sessionsSinceCheck,
  type HistorySession,
  type LoadCheckContext,
  type LoadProposalIn,
  type LoadReferences,
  type LoadSlot,
  storedCoachNote,
  type SubstituteContext,
  wordsOnlyMessage,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, id, kg, lb, plateMachine, stack, T0_MS, TZ } from './fixtures';

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
  it('WB-L1: 102.5 kg with a basis from the references is accepted, not est.; code’s line, the coach’s note kept for Why?', () => {
    const c = checkProposedLoad(P(102.5, 'total', 'main lift, strength focus'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(c).toMatchObject({ load: { value: 102.5, unit: 'kg', convention: 'total' }, source: 'coach', held: false, basis: 'last 3: 100×7 @8 → 102.5', coachNote: 'main lift, strength focus', notUsed: null });
    expect(c.notes).toEqual([]);
    // Review r4: a basis with numbers (even real ones) is NOT USED; the load is unaffected.
    expect(checkProposedLoad(P(102.5, 'total', 'last 3: 100×7 @8 → 102.5'), BENCH_SLOT, benchRefs(), NO_PAIN)).toMatchObject({ load: { value: 102.5 }, source: 'coach', basis: 'last 3: 100×7 @8 → 102.5', coachNote: null, notUsed: 'last 3: 100×7 @8 → 102.5' });
  });

  it('WB-L2: 128 kg is clamped to the cap (20% above last 100 × 7, Ben 19 Oct) and snapped down: 120 with its note', () => {
    const c = checkProposedLoad(P(128, 'total', 'last 100×7'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(c.load?.value).toBe(120);
    expect(c.source).toBe('coach');
    expect(c.notes).toEqual(['capped at 120 · more than recent sets support']);
  });

  it('WB-L3: too far either way is rejected to the rule, with the note; a null load is the rule too', () => {
    const pushdown = refs(PUSHDOWN, [session(910, 3, cable, [{ load: kg(25, 'stack'), reps: 12, rpe: 9 }])], [cable]);
    const c = checkProposedLoad(P(40, 'stack'), slot(10, 12, 9), pushdown, NO_PAIN);
    expect(c).toMatchObject({ load: null, source: 'rule', notes: ['coach load 40 kg too far from last 25 × 12'] });
    expect(checkProposedLoad(P(10, 'total'), BENCH_SLOT, benchRefs(), NO_PAIN).source).toBe('rule');
    expect(checkProposedLoad(null, BENCH_SLOT, benchRefs(), NO_PAIN)).toMatchObject({ source: 'rule', notes: ['no load from coach · rule used'] });
  });

  it('Ben 19 Oct: +15% is accepted and +25% capped (the coach ceilings are 20% above E and 20% above the last load for these reps; the error catcher stays above them)', () => {
    expect(BUILDER_LOAD_BOUNDS.capE).toBe(1.2);
    expect(BUILDER_LOAD_BOUNDS.capLastTop).toBe(1.2);
    expect(BUILDER_LOAD_BOUNDS.clampHigh).toBeGreaterThan(BUILDER_LOAD_BOUNDS.capE);
    // A clear signal: 3 × 10 at RPE 6 on a 6–8 slot (reps well over the range, low effort).
    const easy = refs(BENCH, [session(930, 3, bar, [{ load: kg(100), reps: 10, rpe: 6 }, { load: kg(100), reps: 10, rpe: 6 }, { load: kg(100), reps: 10, rpe: 6 }])], [bar]);
    // +15%: within both ceilings, accepted as the coach's. Code doesn't check the signal; the
    // instructions (LOAD_CHOICE_LINE) ask the coach for one and for the reason in the basis.
    expect(checkProposedLoad(P(115, 'total', 'reps well over range, easy'), BENCH_SLOT, easy, NO_PAIN)).toMatchObject({ load: { value: 115 }, source: 'coach', notes: [] });
    // +25%: past 20% above the last 100 × 10, clamped to 120.
    expect(checkProposedLoad(P(125, 'total', 'reps well over range, easy'), BENCH_SLOT, easy, NO_PAIN)).toMatchObject({ load: { value: 120 }, source: 'coach', notes: ['capped at 120 · more than recent sets support'] });
    // Far past E (> 1.3 × E): refused, the rule is used.
    expect(checkProposedLoad(P(155, 'total'), BENCH_SLOT, easy, NO_PAIN)).toMatchObject({ load: null, source: 'rule' });
    // +25% from the spec fixture (last 100 × 7 @8): clamped to the cap too.
    expect(checkProposedLoad(P(125, 'total'), BENCH_SLOT, benchRefs(), NO_PAIN).load?.value).toBe(120);
    // Pain still holds a 15% jump at the last working load.
    expect(checkProposedLoad(P(115, 'total'), BENCH_SLOT, easy, { pain: { text: 'pain reported today' }, askedHeavier: false })).toMatchObject({ load: { value: 100 }, held: true });
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
    expect(c).toMatchObject({ load: { value: 27.5, convention: 'per_hand' }, source: 'coach', basis: 'last 30×8 → 27.5 each', coachNote: null, notUsed: 'FitNotes 30×8, 28 Sep → 27.5' });
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
    expect(c).toMatchObject({ load: { value: 12.5 }, source: 'coach_est', notes: ['13 → 12.5 (this stack)'], basis: 'est. · first time → 12.5' });
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
    expect(c.basis).toBe('est. from chest press 60×10 · capped → 32.5');
  });

  it('WB-L5b: the first-time ceiling: cable fly at 100 → 25 est.; the assisted machine’s is 55 assist', () => {
    expect(noReferenceCeiling(cable)).toBe(25);
    expect(noReferenceCeiling(assist)).toBe(55);
    const c = checkProposedLoad(P(100, 'stack'), slot(12, 15, 9), refs(FLY, [], [cable]), NO_PAIN);
    expect(c).toMatchObject({ load: { value: 25 }, source: 'coach_est', notes: ['capped at 25 · first time'] });
    // Own same-pattern references lower it further (half their E).
    expect(noReferenceCeiling(cable, [30])).toBe(15);
    const first = checkProposedLoad(P(40, 'assistance'), slot(6, 8, 8), refs(PULLUP, [], [assist]), NO_PAIN);
    expect(first).toMatchObject({ load: { value: 55, convention: 'assistance' }, source: 'coach_est', notes: ['capped at 55 kg assist · first time'] });
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
    const stored = { load: kg(60), source: 'coach' as const, basis: 'last 60×8 → 60', basisFromCoach: false, coachNote: 'last 60×8', held: false, notes: [], notUsed: null };
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
    expect(checkProposedLoad(P(5, 'assistance'), slot(8, 10, 8), pullups, NO_PAIN)).toMatchObject({ load: { value: 25, convention: 'assistance' }, notes: ['25 kg assist · one step from last 30'] });
    expect(checkProposedLoad(P(32, 'assistance'), slot(8, 10, 8), pullups, NO_PAIN).load?.value).toBe(35);
    expect(checkProposedLoad(P(60, 'assistance'), slot(8, 10, 8), pullups, NO_PAIN)).toMatchObject({ load: { value: 40 }, notes: ['40 kg assist · two steps from last 30'] });
  });

  it('+35 kg (last +20) → +21.25; "heavier" in Ben’s words allows +22.5', () => {
    expect(checkProposedLoad(P(35, 'added'), slot(5, 6, 8), weighted, NO_PAIN)).toMatchObject({ load: { value: 21.25, convention: 'added' }, notes: ['+21.25 · one step from last +20'] });
    expect(checkProposedLoad(P(35, 'added'), slot(5, 6, 8), weighted, { pain: null, askedHeavier: true }).load?.value).toBe(22.5);
  });
});

describe('newer history re-check and slot consistency (WB-L12, WB-L13)', () => {
  it('WB-L12: a newer 100 × 5 @ 10 caps a stored 115 at 110 (20% above what it supports) with the newer session named', () => {
    const r1 = benchRefs();
    const stored = { load: kg(115), source: 'coach' as const, basis: 'last 3: 100×7 @8 → 115', basisFromCoach: false, coachNote: 'last 3: 100×7 @8 → 115', held: false, notes: [], notUsed: null };
    const builtAt = at(-day(1) - 3600).utc;
    const newer = refs(BENCH, [session(990, 1, bar, [{ load: kg(100), reps: 5, rpe: 10 }]), ...BENCH_HISTORY], [bar]);
    const r = recheckDraftLoad(stored, BENCH_SLOT, newer, { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: builtAt, nowMs: NOW });
    expect(r.load?.value).toBe(110);
    expect(plain(r.notes.join(' | '))).toMatch(/^capped at 110 · newer session \d+ Oct$/);
    expect(newer.historyVersion).not.toBe(r1.historyVersion);
    // Within the 20% ceilings (Ben 19 Oct), a stored 102.5 stands after the miss: the ceiling catches big jumps, not small ones.
    const small = { ...stored, load: kg(102.5), basis: 'last 3: 100×7 @8 → 102.5', coachNote: 'last 3: 100×7 @8 → 102.5' };
    expect(recheckDraftLoad(small, BENCH_SLOT, newer, { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: builtAt, nowMs: NOW }).load?.value).toBe(102.5);
    // No newer session: the stored load stands, unchanged and offline.
    const same = recheckDraftLoad(stored, BENCH_SLOT, r1, { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: at(0).utc, nowMs: NOW });
    expect(same).toMatchObject({ load: { value: 115 }, source: 'coach', notes: [] });
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
    // B2: the dropped back-offs carry the top set's basis, never one naming 102.5.
    expect(out.basis).toBe(top.basis);
    // Assisted: more assistance is easier, so a back-off with less assistance than the top set drops to it.
    const a = checkSlotLoads({ ...back, load: kg(30, 'assistance') }, { ...back, load: kg(25, 'assistance'), notes: [] });
    expect(a.load?.value).toBe(30);
  });
});

describe('checkBasis (WB-L9; review r4 PM decision): words only, every number is code’s', () => {
  it('a qualitative note passes', () => {
    for (const words of ['main lift, strength focus', 'repeat while form settles', 'est. from your chest press', 'kept light for the shoulder', 'same weight, more reps']) expect({ words, ok: checkBasis(words) }).toEqual({ words, ok: true });
  });
  it('any digit, number word, max or record claim, praise or long text fails', () => {
    for (const words of [
      'last 3: 100×7 @8 → 102.5',
      'est. 1RM ≈130',
      '→ 102.5',
      '+2.5',
      'last 100 kg × 7 @ RPE 8',
      'week 2 of the block',
      'eight reps at the same weight',
      'a hundred and two point five',
      'two steps lighter',
      'half your usual',
      'repeat twice',
      'close to your max',
      'new PR territory',
      'personal best pace',
      'safe jump',
      'great progress',
      '٣ sets',
      '½ step up',
      'x'.repeat(61),
      '',
      '   ',
    ]) expect({ words, ok: checkBasis(words) }).toEqual({ words, ok: false });
  });
  it('a failing basis is not a Coach’s note: kept under NOT USED; the line is code’s either way', () => {
    const c = checkProposedLoad(P(102.5, 'total', 'you hit 110×5 last week'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(c).toMatchObject({ basis: 'last 3: 100×7 @8 → 102.5', coachNote: null, notUsed: 'you hit 110×5 last week' });
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

describe('review builder-v2 B1–B4', () => {
  it('B1: a basis citing the proposal as a set (110×6, 104×8) is not used; the proposal is allowed on its own or after an arrow', () => {
    const invented = checkProposedLoad(P(110, 'total', 'last 110×6 @8'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(invented).toMatchObject({ coachNote: null, notUsed: 'last 110×6 @8' });
    expect(invented.basis).not.toContain('110×6');
    const again = checkProposedLoad(P(104, 'total', 'last 104×8 @7'), slot(6, 8, 7), benchRefs(), NO_PAIN);
    expect(again.coachNote).toBeNull();
    expect(again.basis).not.toContain('104×8');
    // Review r4: any note with a number is NOT USED, real sets included.
    for (const words of ['last 100×7 @6 → 102.5', 'last 100×7 @8 → 102.5×6', 'last 100×7 @8 → 102.5×12']) expect(checkProposedLoad(P(102.5, 'total', words), BENCH_SLOT, benchRefs(), NO_PAIN)).toMatchObject({ coachNote: null, notUsed: words });
  });

  it('B2: when code changes the load, the basis ends with the final value (clamp, hold, snap); the coach’s goes under NOT USED', () => {
    const clamped = checkProposedLoad(P(128, 'total', 'last 3: 100×7 @8 → 128'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(clamped).toMatchObject({ load: { value: 120 }, basis: 'last 3: 100×7 @8 · capped → 120', coachNote: null, notUsed: 'last 3: 100×7 @8 → 128' });
    const held = checkProposedLoad(P(102.5, 'total', 'last 3: 100×7 @8 → 102.5'), BENCH_SLOT, benchRefs(), { pain: { text: 'pain reported today' }, askedHeavier: false });
    expect(held).toMatchObject({ load: { value: 100 }, held: true, basis: 'last 100×7 @8 → 100', coachNote: null });
    const snapped = checkProposedLoad(P(101, 'total', 'last 3: 100×7 @8 → 101'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(snapped.load?.value).not.toBe(101);
    expect(snapped.basis?.endsWith(`→ ${String(snapped.load?.value)}`)).toBe(true);
    expect(snapped.coachNote).toBeNull();
    // Converted from lb: the coach's number is in another unit, so code's basis names the kg target.
    const lb = checkProposedLoad(P(225, 'total', 'last 100×7 → 225', 'lb'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(lb.basis).toBe('last 3: 100×7 @8 → 102.5');
    // Unchanged: the coach's words (no numbers) are kept, but only as its note.
    expect(checkProposedLoad(P(102.5, 'total', 'main lift, strength focus'), BENCH_SLOT, benchRefs(), NO_PAIN).coachNote).toBe('main lift, strength focus');
    // A changed load drops even a qualitative note (it was written for another number).
    expect(checkProposedLoad(P(128, 'total', 'main lift, strength focus'), BENCH_SLOT, benchRefs(), NO_PAIN)).toMatchObject({ coachNote: null, notUsed: 'main lift, strength focus' });
  });

  it('B2 at plan time: a re-check that changes the stored load moves the coach’s note under NOT USED (r3 and older drafts)', () => {
    const r1 = benchRefs();
    const stored = { load: kg(102.5), source: 'coach' as const, basis: 'last 3: 100×7 @8 → 102.5', basisFromCoach: false, coachNote: 'last 3: 100×7 @8 → 102.5', held: false, notes: [], notUsed: null };
    const held = recheckDraftLoad(stored, BENCH_SLOT, r1, { pain: { text: 'pain reported today' }, checkedOn: checkedOnOf(r1), builtAtUtc: at(0).utc, nowMs: NOW, checkedHistoryVersion: r1.historyVersion });
    expect(held).toMatchObject({ load: { value: 100 }, held: true, basis: 'last 100×7 @8 → 100', coachNote: null, notUsed: 'last 3: 100×7 @8 → 102.5' });
    // A draft written before r3 (the coach's text in `basis`): the line is code's at plan time; its text (with
    // numbers) is never shown (r4 B2t), only kept under NOT USED.
    const legacy = { load: kg(102.5), source: 'coach' as const, basis: '8 reps at 102.5 last time', basisFromCoach: true, held: false, notes: [], notUsed: null };
    const kept = recheckDraftLoad(legacy, BENCH_SLOT, r1, { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: at(0).utc, nowMs: NOW, checkedHistoryVersion: r1.historyVersion });
    expect(kept).toMatchObject({ load: { value: 102.5 }, basis: 'last 3: 100×7 @8 → 102.5', coachNote: null, notUsed: '8 reps at 102.5 last time' });
  });

  it('B3: a step bound on assisted or added loads is not a pain hold (no `held` note or flag)', () => {
    const pullups = refs(PULLUP, [session(980, 4, assist, [{ load: kg(30, 'assistance'), reps: 8, rpe: 8 }])], [assist]);
    const c = checkProposedLoad(P(5, 'assistance'), slot(8, 10, 8), pullups, NO_PAIN);
    expect(c.held).toBe(false);
    expect(c.notes.some((n) => n.startsWith('held'))).toBe(false);
    expect(c.basis).toBe('last 30×8 @8 · capped → 25 kg assist');
  });

  it('B4: a session started before the build but not seen by it counts as newer (checkedHistoryVersion)', () => {
    const r1 = benchRefs();
    // 115: within 20% of last 100 × 7 (Ben 19 Oct), more than 20% above what a newer 100 × 5 @10 supports.
    const stored = { load: kg(115), source: 'coach' as const, basis: 'last 3: 100×7 @8 → 115', basisFromCoach: false, coachNote: 'main lift, strength focus', held: false, notes: [], notUsed: null };
    // The workout started 1 h ago; the draft was built 30 min ago, before 100×5 @10 was logged in it.
    const during = session(991, 0, bar, [{ load: kg(100), reps: 5, rpe: 10 }]);
    const started = { ...during, performedAtUtc: at(-3600).utc };
    const now = refs(BENCH, [started, ...BENCH_HISTORY], [bar]);
    const r = recheckDraftLoad(stored, BENCH_SLOT, now, { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: at(-1800).utc, nowMs: NOW, checkedHistoryVersion: r1.historyVersion });
    expect(r.load?.value).toBe(110);
    expect(plain(r.notes.join(' | '))).toMatch(/^capped at 110 · newer session \d+ Oct$/);
    expect(r.basis).toBe('last 100×5 @10 · capped → 110');
    expect(r.coachNote).toBeNull();
    // The same history as at build time: unchanged, the coach's note kept.
    const same = recheckDraftLoad(stored, BENCH_SLOT, r1, { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: at(-1800).utc, nowMs: NOW, checkedHistoryVersion: r1.historyVersion });
    expect(same).toMatchObject({ load: { value: 115 }, notes: [], basis: 'last 3: 100×7 @8 → 115', coachNote: 'main lift, strength focus' });
  });

  it('B4: a correction to older history re-checks against the whole history; sessionsSinceCheck finds only the unseen ones', () => {
    const r1 = benchRefs();
    const extra = refSessionOf(session(992, 0, bar, [{ load: kg(100), reps: 5, rpe: 10 }]), 'kg', 'total');
    const all = [extra, ...r1.all].flatMap((x) => (x === null ? [] : [x]));
    expect(sessionsSinceCheck(all, r1.historyVersion, at(0).utc)?.map((s) => s.sessionId)).toEqual([id(992)]);
    expect(sessionsSinceCheck(r1.all, r1.historyVersion, at(0).utc)).toEqual([]);
    const corrected = refs(BENCH, [BENCH_HISTORY[0] as HistorySession, { ...(BENCH_HISTORY[1] as HistorySession), sets: [{ setType: 'working', side: null, load: kg(80), reps: 8, rpe: 8, rir: null }] }, BENCH_HISTORY[2] as HistorySession], [bar]);
    expect(sessionsSinceCheck(corrected.all, r1.historyVersion, at(0).utc)).toBeNull();
    // Older drafts with no stored version: by start time, as before.
    expect(sessionsSinceCheck(all, null, at(-60).utc)?.map((s) => s.sessionId)).toEqual([id(992)]);
  });
});

describe('review builder-v2 r2: code’s reason line, coach notes, newest-alone re-check (B1r, B4r, S1r, N1r)', () => {
  const CODE_LINE = 'last 3: 100×7 @8 → 102.5';
  const NOTE = 'main lift, strength focus';

  it('B1r: invented history in any wording is never a Coach’s note, and the line is always code’s', () => {
    // Bench, last 100×7 @8; the coach proposes 102.5 (in band, unchanged). Ben never lifted 102.5.
    for (const words of [
      '8 reps at 102.5 last time',
      'last: 102.5/8 @8',
      'last 2: 102.5, 102.5',
      'last 102.5 for 8',
      'last: 102.5 for 8',
      'last 102.5 @8',
      '102.5 last time',
      '102.5 x 8',
      '102.5kg×8',
      '102.5 * 8',
      '102.5/8',
      '8 reps with 102.5 kg',
      '102.5 for 8 reps @8',
      'last time: 102.5',
      '97.5 last time',
      'did 102.5 for 8 → 102.5',
    ]) {
      const c = checkProposedLoad(P(102.5, 'total', words), BENCH_SLOT, benchRefs(), NO_PAIN);
      expect({ words, note: c.coachNote, notUsed: c.notUsed, basis: c.basis, load: c.load?.value }).toEqual({ words, note: null, notUsed: words, basis: CODE_LINE, load: 102.5 });
    }
  });

  it('B1s (r3): "last time" spans an arrow or a pair; past-time words next to an arrowed target fail', () => {
    for (const words of [
      '→ 102.5×8 last time',
      'last time -> 102.5 for 8',
      'last session → 102.5 for 8',
      'last 3 → 102.5×8 each time',
      'last time → 102.5',
      'did → 102.5',
      'last → 102.5×8',
      '→ 7 reps at 102.5 last time',
      '100×7 → 102.5×8 previously',
    ]) {
      const c = checkProposedLoad(P(102.5, 'total', words), BENCH_SLOT, benchRefs(), NO_PAIN);
      expect({ words, note: c.coachNote, notUsed: c.notUsed, basis: c.basis, load: c.load?.value }).toEqual({ words, note: null, notUsed: words, basis: CODE_LINE, load: 102.5 });
    }
    // Review r4: real ones are NOT USED too (every number Ben sees is code's).
    for (const words of ['100 last time → 102.5', 'last time: 100×7 → 102.5', 'last time 100 → 102.5 for 8', '100×7 each time → 102.5', 'last 3 → 102.5×8']) {
      expect({ words, note: checkProposedLoad(P(102.5, 'total', words), BENCH_SLOT, benchRefs(), NO_PAIN).coachNote }).toEqual({ words, note: null });
    }
  });

  it('B1s (r3): a number written as a load, or equal to the proposal, must be a real load, not a rep, RPE or day', () => {
    // Lateral raise on a 1 kg-step rack: last 11 each ×15 @8, slot 12–15 @8, proposal 12 each (12 is the slot's repsMin).
    const LATERAL = exercise(223, 'Lateral raise', { movementPattern: 'shoulder_abduction', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const kgRack = dumbbells({ id: id(711), gymId: MAIN, loads: steps(1, 20, 1) });
    const r = refs(LATERAL, [session(960, 3, kgRack, [{ load: kg(11, 'per_hand'), reps: 15, rpe: 8 }])], [kgRack]);
    const lat = slot(12, 15, 8);
    expect(checkProposedLoad(P(12, 'per_hand', 'one more rep each set'), lat, r, NO_PAIN)).toMatchObject({ load: { value: 12 }, coachNote: null });
    expect(checkProposedLoad(P(12, 'per_hand', 'small step up'), lat, r, NO_PAIN)).toMatchObject({ load: { value: 12 }, coachNote: 'small step up' });
    for (const words of ['11 each ×15 @8 → 12 each', 'did 12 each', 'previous: 12 each', 'was 12 each, keep', '12 each', 'last 11×15 @8, 12 before', 'last 11×15 → 15 each']) {
      const c = checkProposedLoad(P(12, 'per_hand', words), lat, r, NO_PAIN);
      expect({ words, note: c.coachNote, notUsed: c.notUsed, load: c.load?.value }).toEqual({ words, note: null, notUsed: words, load: 12 });
    }
  });

  it('B1r (r4): real sets in any wording are NOT USED too; the line is code’s', () => {
    for (const words of ['last 3: 100×7 @8 → 102.5', '100 for 7 @8 → 102.5', '7 reps at 100 → 102.5', '100 last time → 102.5', 'last 100/7 → +2.5', 'last 100×7 @8 → 102.5 for 7', 'last time: 100×7 → 102.5', '97.5 for 8 @8, 100×7 @8 → 102.5']) {
      const c = checkProposedLoad(P(102.5, 'total', words), BENCH_SLOT, benchRefs(), NO_PAIN);
      expect({ words, note: c.coachNote, notUsed: c.notUsed, basis: c.basis }).toEqual({ words, note: null, notUsed: words, basis: CODE_LINE });
    }
  });

  it('B1r: est., first time, held, capped and per-hand lines are code’s, ending with the final load', () => {
    expect(checkProposedLoad(P(13, 'stack', 'est. 13 for 12–15 @9'), slot(12, 15, 9), refs(FLY, [], [cable]), NO_PAIN)).toMatchObject({ basis: 'est. · first time → 12.5', coachNote: null });
    const incline = refs(INCLINE, [session(920, 10, null, [{ load: kg(30, 'per_hand'), reps: 8 }], true)], [rack]);
    expect(checkProposedLoad(P(30, 'per_hand', 'FitNotes 30×8 → repeat'), slot(8, 10, 8), incline, NO_PAIN)).toMatchObject({ basis: 'last 30×8 → 30 each', coachNote: null, notUsed: 'FitNotes 30×8 → repeat' });
    expect(checkProposedLoad(P(30, 'per_hand', 'repeat the imported weight'), slot(8, 10, 8), incline, NO_PAIN)).toMatchObject({ basis: 'last 30×8 → 30 each', coachNote: 'repeat the imported weight' });
    expect(checkProposedLoad(P(128, 'total', null), BENCH_SLOT, benchRefs(), NO_PAIN).basis).toBe('last 3: 100×7 @8 · capped → 120');
    expect(checkProposedLoad(P(102.5, 'total', null), BENCH_SLOT, benchRefs(), { pain: { text: 'pain reported today' }, askedHeavier: false }).basis).toBe('last 100×7 @8 → 100');
  });

  it('B4r: two unseen sessions, the newest a rep miss (102.5×8 @7, then 100×5 @10) → 110, judged on the newest alone', () => {
    const r1 = benchRefs();
    const stored = { load: kg(115), source: 'coach' as const, basis: CODE_LINE, basisFromCoach: false, coachNote: NOTE, held: false, notes: [], notUsed: null };
    const easy = session(993, 1, bar, [{ load: kg(102.5), reps: 8, rpe: 7 }]);
    const miss = { ...session(994, 0, bar, [{ load: kg(100), reps: 5, rpe: 10 }]), performedAtUtc: at(-600).utc };
    const now = refs(BENCH, [miss, easy, ...BENCH_HISTORY], [bar]);
    expect(sessionsSinceCheck(now.all, r1.historyVersion, at(-day(2)).utc)?.map((s) => s.sessionId)).toEqual([id(994), id(993)]);
    const ctx = { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: at(-day(2)).utc, nowMs: NOW, checkedHistoryVersion: r1.historyVersion };
    const r = recheckDraftLoad(stored, BENCH_SLOT, now, ctx);
    expect(r.load?.value).toBe(110);
    expect(plain(r.notes.join(' | '))).toMatch(/^capped at 110 · newer session \d+ Oct$/);
    expect(r).toMatchObject({ basis: 'last 100×5 @10 · capped → 110', coachNote: null, notUsed: NOTE });
    // The newest an easy set: the stored load stands.
    const fine = refs(BENCH, [easy, ...BENCH_HISTORY], [bar]);
    expect(recheckDraftLoad(stored, BENCH_SLOT, fine, ctx)).toMatchObject({ load: { value: 115 }, notes: [], coachNote: NOTE });
  });

  it('S1r: older history changed and a rep miss logged since → the lighter of the full check and the newest alone', () => {
    const r1 = benchRefs();
    const stored = { load: kg(115), source: 'coach' as const, basis: CODE_LINE, basisFromCoach: false, coachNote: NOTE, held: false, notes: [], notUsed: null };
    const corrected = { ...(BENCH_HISTORY[1] as HistorySession), sets: [{ setType: 'working' as const, side: null, load: kg(80), reps: 8, rpe: 8, rir: null }] };
    const miss = session(995, 0, bar, [{ load: kg(100), reps: 5, rpe: 10 }]);
    const now = refs(BENCH, [miss, BENCH_HISTORY[0] as HistorySession, corrected, BENCH_HISTORY[2] as HistorySession], [bar]);
    const ctx = { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: at(-day(1)).utc, nowMs: NOW, checkedHistoryVersion: r1.historyVersion };
    expect(sessionsSinceCheck(now.all, r1.historyVersion, ctx.builtAtUtc)).toBeNull();
    // The full check alone still supports 115 (last 3 bands); the newest alone does not.
    expect(checkProposedLoad(P(115, 'total'), BENCH_SLOT, now, NO_PAIN).load?.value).toBe(115);
    const r = recheckDraftLoad(stored, BENCH_SLOT, now, ctx);
    expect(r.load?.value).toBe(110);
    expect(r.notes).toEqual(['capped at 110 · history changed']);
    expect(r.basis).toBe('last 100×5 @10 · capped → 110');
    // A correction alone, the newest session fine: both checks keep 115.
    const onlyCorrected = refs(BENCH, [BENCH_HISTORY[0] as HistorySession, corrected, BENCH_HISTORY[2] as HistorySession], [bar]);
    expect(recheckDraftLoad(stored, BENCH_SLOT, onlyCorrected, ctx)).toMatchObject({ load: { value: 115 }, notes: [], coachNote: NOTE });
  });

  it('N1r: a long line is shortened in the middle; the final `→ N` (and `· capped`) is never cut', () => {
    expect(fitKeepingTail('est. from a very long related exercise name 60×10 · capped → 32.5', 40)).toBe('est. from a very long… · capped → 32.5');
    const long = fitKeepingTail(`last 3: ${'x'.repeat(80)} → 27.5 each`, 48);
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith('→ 27.5 each')).toBe(true);
    expect(fitKeepingTail('last 100×7 @8 → 102.5', 64)).toBe('last 100×7 @8 → 102.5');
    const derived = { kind: 'related_lift' as const, e1rm: 48, text: 'seated chest press machine (plate-loaded, wide) 60×10', numbers: [60, 10], sets: [{ value: 60, reps: 10, rpe: null }] };
    const c = checkProposedLoad(P(40, 'stack'), slot(12, 15, 9), refs(FLY, [], [cable], { derived }), NO_PAIN);
    expect(c.basis?.length ?? 99).toBeLessThanOrEqual(48);
    expect(c.basis?.endsWith(`· capped → ${String(c.load?.value)}`)).toBe(true);
  });
});

describe('review builder-v2 r4: every number about a load is code’s (B1t, B2t, S1t; r3 S2s, S3s, S4s)', () => {
  const CODE_LINE = 'last 3: 100×7 @8 → 102.5';
  const dropped = (words: string, c: { coachNote: string | null; notUsed: string | null }) => ({ words, note: c.coachNote, notUsed: c.notUsed });

  it('B1t: every r4 probe wording on bench (punctuation, dates, again/repeat, e1RM and differences) is NOT USED', () => {
    for (const words of [
      // 1. A past-time word split off from the arrowed target by punctuation.
      '→ 102.5×8 (last time)',
      '→ 102.5×8, last time',
      '→ 102.5×8 · last time',
      '→ 102.5×8; last session',
      'last time (8 Oct) → 102.5×8',
      'last time, → 102.5×8',
      'last time; → 102.5×8',
      // 2. A date or day next to the arrowed target.
      '→ 102.5×8 on 8 Oct',
      '→ 102.5×8 on 6 Oct',
      'hit 8 Oct → 102.5×8',
      'did 6 Oct → 102.5×8',
      'same as 8 Oct → 102.5×8',
      '8 Oct → 102.5×8',
      'Tue → 102.5×8',
      'Mon: → 102.5×8',
      'yesterday → 102.5×8',
      '→ 102.5×8 (Tue)',
      '→ 102.5×8 like Tue',
      '→ 102.5×8 as on Tue',
      '→ 102.5×8 again',
      'repeat → 102.5×8',
      '→ 102.5 as last',
      '→ 102.5 (same as last)',
      'logged → 102.5×8',
      'completed → 102.5×8',
      '→ 102.5×8 (logged)',
      '→ 102.5×8 ✓',
      'prev: → 102.5×8',
      // 3. The estimated 1RM and differences as loads.
      'hit 130',
      'did 130 kg',
      'lifted 130',
      'best 130 kg',
      'top 130',
      'last: 130',
      'did 5 kg',
      'last 2.5 kg',
      // Written out, still numbers.
      'eight reps at one hundred and two',
    ]) {
      const c = checkProposedLoad(P(102.5, 'total', words), BENCH_SLOT, benchRefs(), NO_PAIN);
      expect(dropped(words, c)).toEqual({ words, note: null, notUsed: words });
      expect(c.basis).toBe(CODE_LINE);
      expect(c.load?.value).toBe(102.5);
    }
  });

  it('B1t: lateral raise (1 kg rack, last 11 / 9 each, proposal 12): differences written as dumbbells are NOT USED', () => {
    const LATERAL = exercise(223, 'Lateral raise', { movementPattern: 'shoulder_abduction', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const kgRack = dumbbells({ id: id(711), gymId: MAIN, loads: steps(1, 20, 1) });
    const r = refs(LATERAL, [session(961, 3, kgRack, [{ load: kg(11, 'per_hand'), reps: 15, rpe: 8 }]), session(962, 7, kgRack, [{ load: kg(9, 'per_hand'), reps: 15, rpe: 8 }])], [kgRack]);
    for (const words of ['did 3 each', 'was 3 each', 'hit 1 each']) {
      const c = checkProposedLoad(P(12, 'per_hand', words), slot(12, 15, 8), r, NO_PAIN);
      expect(dropped(words, c)).toEqual({ words, note: null, notUsed: words });
    }
  });

  it('B1t: in the Why sheet and on the set card a dropped note never shows, a qualitative one is quoted', () => {
    expect(storedCoachNote({ basis: 'x', basisFromCoach: false, coachNote: 'main lift, strength focus' })).toBe('main lift, strength focus');
    expect(storedCoachNote({ basis: 'x', basisFromCoach: false, coachNote: 'hit 130' })).toBeNull();
  });

  it('B2t: a legacy coach note goes through the same rule at plan time (dropped to NOT USED, never shown)', () => {
    const r1 = benchRefs();
    const ctx = { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: at(0).utc, nowMs: NOW, checkedHistoryVersion: r1.historyVersion };
    const legacy = { load: kg(102.5), source: 'coach' as const, basis: '→ 102.5×8 (last time)', basisFromCoach: true, held: false, notes: [], notUsed: null };
    expect(storedCoachNote(legacy)).toBeNull();
    expect(recheckDraftLoad(legacy, BENCH_SLOT, r1, ctx)).toMatchObject({ load: { value: 102.5 }, basis: CODE_LINE, coachNote: null, notUsed: '→ 102.5×8 (last time)' });
    // A stored r3/r4 note with numbers (it passed the older gate) is dropped the same way.
    const r3 = { load: kg(102.5), source: 'coach' as const, basis: CODE_LINE, basisFromCoach: false, coachNote: 'last 3: 100×7 @8 → 102.5', held: false, notes: [], notUsed: null };
    expect(recheckDraftLoad(r3, BENCH_SLOT, r1, ctx)).toMatchObject({ coachNote: null, notUsed: 'last 3: 100×7 @8 → 102.5' });
    // A legacy note in words only is still shown.
    const words = { ...legacy, basis: 'main lift, strength focus' };
    expect(recheckDraftLoad(words, BENCH_SLOT, r1, ctx)).toMatchObject({ coachNote: 'main lift, strength focus', notUsed: null });
    // The load path is untouched: a changed load drops it too.
    expect(recheckDraftLoad(legacy, BENCH_SLOT, r1, { ...ctx, pain: { text: 'pain reported today' } })).toMatchObject({ load: { value: 100 }, coachNote: null, notUsed: '→ 102.5×8 (last time)' });
  });

  it('S1t: a stored coach load that falls back to an estimate (all history deleted) keeps the est. label', () => {
    const r1 = benchRefs();
    const stored = { load: kg(102.5), source: 'coach' as const, basis: CODE_LINE, basisFromCoach: false, coachNote: null, held: false, notes: [], notUsed: null };
    const empty = refs(BENCH, [], [bar]);
    const r = recheckDraftLoad(stored, BENCH_SLOT, empty, { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: at(0).utc, nowMs: NOW, checkedHistoryVersion: r1.historyVersion });
    expect(r.load?.value).toBeLessThan(102.5);
    expect(r.source).toBe('coach_est');
    expect(r.basis?.startsWith('est. · first time')).toBe(true);
    // A stored estimate isn't promoted with no new session of his own.
    const est = { ...stored, source: 'coach_est' as const };
    expect(recheckDraftLoad(est, BENCH_SLOT, r1, { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: at(0).utc, nowMs: NOW, checkedHistoryVersion: r1.historyVersion }).source).toBe('coach_est');
  });

  it('S2s: under a pain hold an easier assisted load stays easier, labelled held, never capped', () => {
    const pullups = refs(PULLUP, [session(982, 4, assist, [{ load: kg(20, 'assistance'), reps: 8, rpe: 8 }])], [assist]);
    const shoulder = { pain: { text: 'shoulder flagged 6 Oct' }, askedHeavier: false };
    const c = checkProposedLoad(P(40, 'assistance'), slot(8, 10, 8), pullups, shoulder);
    expect(c).toMatchObject({ load: { value: 40, convention: 'assistance' }, held: true, basis: 'last 20×8 @8 → 40 kg assist', notes: ['held · shoulder flagged 6 Oct'] });
    expect(c.basis).not.toContain('capped');
    // A harder proposal under the hold is held at the last load.
    expect(checkProposedLoad(P(5, 'assistance'), slot(8, 10, 8), pullups, shoulder)).toMatchObject({ load: { value: 20 }, held: true });
    // Without pain the easy-side step bound still applies, but raising it isn't called `capped`.
    const raised = checkProposedLoad(P(40, 'assistance'), slot(8, 10, 8), pullups, NO_PAIN);
    expect(raised).toMatchObject({ load: { value: 30 }, held: false, basis: 'last 20×8 @8 → 30 kg assist', notes: ['30 kg assist · two steps from last 20'] });
    // Under a hold, a very light barbell load isn't rejected as a slip either (any easier load is fine).
    expect(checkProposedLoad(P(40, 'total'), BENCH_SLOT, benchRefs(), { pain: { text: 'pain reported today' }, askedHeavier: false })).toMatchObject({ load: { value: 40 }, source: 'coach', held: true });
  });

  it('S3s: a light high-rep newest session (60×15 @7) doesn’t re-band bench; a newer miss still caps it', () => {
    const r1 = benchRefs();
    const stored = { load: kg(115), source: 'coach' as const, basis: CODE_LINE, basisFromCoach: false, coachNote: null, held: false, notes: [], notUsed: null };
    const ctx = { pain: null, checkedOn: checkedOnOf(r1), builtAtUtc: at(-day(2)).utc, nowMs: NOW, checkedHistoryVersion: r1.historyVersion };
    const light = { ...session(996, 0, bar, [{ load: kg(60), reps: 15, rpe: 7 }, { load: kg(60), reps: 15, rpe: 7 }]), performedAtUtc: at(-600).utc };
    const afterLight = recheckDraftLoad(stored, BENCH_SLOT, refs(BENCH, [light, ...BENCH_HISTORY], [bar]), ctx);
    expect(afterLight).toMatchObject({ load: { value: 115 }, source: 'coach' });
    // A fresh build sees the same: the light day's raw load doesn't cap a 6–8 target.
    expect(checkProposedLoad(P(115, 'total'), BENCH_SLOT, refs(BENCH, [light, ...BENCH_HISTORY], [bar]), NO_PAIN).load?.value).toBe(115);
    // An RPE 10 miss before the light day: the unseen sessions together still cap it (110), never the light day's raw load.
    const miss = session(997, 1, bar, [{ load: kg(100), reps: 5, rpe: 10 }]);
    const r = recheckDraftLoad(stored, BENCH_SLOT, refs(BENCH, [light, miss, ...BENCH_HISTORY], [bar]), ctx);
    expect(r.load?.value).toBe(110);
    // Never raised: a stored assisted load easier than two steps from a newer session stays where it was.
    const pr1 = refs(PULLUP, [session(983, 6, assist, [{ load: kg(40, 'assistance'), reps: 8, rpe: 8 }])], [assist]);
    const storedA = { load: kg(40, 'assistance'), source: 'coach' as const, basis: 'last 40×8 @8 → 40 assist', basisFromCoach: false, coachNote: null, held: false, notes: [], notUsed: null };
    const strong = refs(PULLUP, [session(984, 0, assist, [{ load: kg(20, 'assistance'), reps: 8, rpe: 8 }]), session(983, 6, assist, [{ load: kg(40, 'assistance'), reps: 8, rpe: 8 }])], [assist]);
    const a = recheckDraftLoad(storedA, slot(8, 10, 8), strong, { pain: null, checkedOn: checkedOnOf(pr1), builtAtUtc: at(-day(3)).utc, nowMs: NOW, checkedHistoryVersion: pr1.historyVersion });
    expect(a.load?.value).toBe(40);
  });

  it('S4s: a lb set is cited in lb (225 lb×8), never as converted kg decimals; and a kg set at a lb gym in kg', () => {
    const fit = [session(998, 3, null, [{ load: lb(225), reps: 8, rpe: 8 }], true)];
    const r = refs(BENCH, fit, [bar]);
    const c = checkProposedLoad(P(102.5, 'total'), BENCH_SLOT, r, NO_PAIN);
    expect(c.basis).toBe('last 225 lb×8 @8 → 102.5 kg');
    expect(c.basis).not.toMatch(/102\.06/);
    const lbBar = barbell({ id: id(720), gymId: MAIN, unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 25, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }] });
    const atLb = loadReferences({ exercise: BENCH, history: [session(999, 3, null, [{ load: kg(100), reps: 7, rpe: 8 }], true)], ctx: { gym: gymWith(lbBar), knownEquipment: new Map([[lbBar.id, lbBar]]), unit: 'lb' }, nowMs: NOW });
    const l = checkProposedLoad(P(225, 'total', null, 'lb'), BENCH_SLOT, atLb, NO_PAIN);
    expect(l.basis).toMatch(/^last 100 kg×7 @8 → \d+(\.\d+)? lb$/);
    expect(l.basis).not.toMatch(/220\.46/);
    // Same-unit sets read as before.
    expect(checkProposedLoad(P(102.5, 'total'), BENCH_SLOT, benchRefs(), NO_PAIN).basis).toBe(CODE_LINE);
  });
});

describe('review builder-v2 r5: the draft message is words only (B1u); notes keep their units (S2u)', () => {
  const R5_PROBES = [
    'You did 105×8 on Tuesday, so bench leads.',
    'Bench leads; last week you hit 110 for 6.',
    'Bench 102.5 since you hit 102.5 for 8 on Tuesday. Then incline.',
    'Your est. max is 140, so bench at 110.',
  ];

  it('B1u: sentences split without breaking decimals or `est.`', () => {
    expect(coachSentences('Bench 102.5 since you hit 102.5 for 8 on Tuesday. Then incline.')).toEqual(['Bench 102.5 since you hit 102.5 for 8 on Tuesday.', 'Then incline.']);
    expect(coachSentences('Your est. max is 140, so bench at 110.')).toEqual(['Your est. max is 140, so bench at 110.']);
    expect(coachSentences('Est. Bench leads, e.g. strength first! Then rows? Yes')).toEqual(['Est. Bench leads, e.g. strength first!', 'Then rows?', 'Yes']);
    expect(coachSentences('  ')).toEqual([]);
  });

  it('B1u: checkCoachWords is checkBasis without the length limit', () => {
    const long = 'Main lift first while you are fresh, then the accessories for chest and back in pairs to save time.';
    expect(long.length).toBeGreaterThan(60);
    expect(checkCoachWords(long)).toBe(true);
    expect(checkBasis(long)).toBe(false);
    for (const bad of ['hit ten last week', 'new record pace', 'great work', 'top set ２', '']) expect(checkCoachWords(bad)).toBe(false);
  });

  it('B1u: the r5 probes show no number; a decimal sentence is dropped whole, never garbled', () => {
    expect(wordsOnlyMessage(R5_PROBES[0])).toBeNull();
    expect(wordsOnlyMessage(R5_PROBES[1])).toBeNull();
    expect(wordsOnlyMessage(R5_PROBES[2])).toBe('Then incline.');
    expect(wordsOnlyMessage(R5_PROBES[3])).toBeNull();
    for (const m of R5_PROBES) expect(wordsOnlyMessage(m) ?? '').not.toMatch(/\p{N}/u);
    expect(wordsOnlyMessage('Bench first while you are fresh. Rows balance the pressing.')).toBe('Bench first while you are fresh. Rows balance the pressing.');
    expect(wordsOnlyMessage('Bench first. Rows after.', (x) => !x.startsWith('Rows'))).toBe('Bench first.');
    expect(wordsOnlyMessage(null)).toBeNull();
  });

  it('S2u: a lb proposal on a kg bar is cited as proposed (226 lb → 102.5 kg), never a converted decimal', () => {
    const c = checkProposedLoad(P(226, 'total', null, 'lb'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(c.notes[0]).toBe('lb → kg converted');
    expect(c.notes).toContain('226 lb → 102.5 kg (these plates)');
    expect(c.notes.join(' ')).not.toMatch(/\d+\.\d{3}/);
  });

  it('S2u: a kg assisted machine with a FitNotes lb set names units on every load, with no `FitNotes` tag (18 Oct)', () => {
    const r = refs(PULLUP, [session(1201, 3, null, [{ load: lb(66, 'assistance'), reps: 8, rpe: 8 }], true)], [assist]);
    const c = checkProposedLoad(P(5, 'assistance'), slot(8, 10, 8), r, NO_PAIN);
    expect(c.load).toMatchObject({ unit: 'kg', convention: 'assistance' });
    const v = String(c.load?.value);
    expect(c.notes).toContain(`${v} kg assist · one step from last 66 lb`);
    expect(c.basis).not.toContain('FitNotes');
    expect(c.basis).toMatch(new RegExp(`→ ${v} kg assist$`));
    expect((c.basis ?? '').length).toBeLessThanOrEqual(48);
    // No cited number is separated from its unit.
    for (const line of [c.basis ?? '', ...c.notes]) expect(line).not.toMatch(/\b\d+(?:\.\d+)? assist\b/);
  });

  it('S2u: fitKeepingTail keeps `(FitNotes)` and never leaves a number without its unit', () => {
    expect(fitKeepingTail('last 66 lb×8 @8 (FitNotes) · capped → 25 kg assist', 48)).toBe('last 66 lb×8… (FitNotes) · capped → 25 kg assist');
    const cut = fitKeepingTail('est. · last 3: 66 lb×8 @8 (FitNotes) · capped → 25 kg assist', 48);
    expect(cut.endsWith('(FitNotes) · capped → 25 kg assist')).toBe(true);
    expect(cut).not.toMatch(/\d…/);
    expect(cut.length).toBeLessThanOrEqual(48);
  });
});

describe('ADR 0038 (Ben, 28 Oct): a weight Ben names is kept as typed in a build', () => {
  it('his 140 kg bench is used exactly (no 20% ceiling, no rejection); the coach’s own 140 is still capped or refused', () => {
    const mine = checkProposedLoad(P(140, 'total'), BENCH_SLOT, benchRefs(), { ...NO_PAIN, asTyped: true });
    expect(mine).toMatchObject({ load: { value: 140, unit: 'kg', convention: 'total' }, source: 'coach', held: false, notes: [] });
    const coach = checkProposedLoad(P(140, 'total'), BENCH_SLOT, benchRefs(), NO_PAIN);
    expect(coach.load?.value ?? 0).toBeLessThan(140);
  });

  it('not rounded to the rack; only a machine’s max moves it; pain still holds it (rule 9)', () => {
    expect(checkProposedLoad(P(101, 'total'), BENCH_SLOT, benchRefs(), { ...NO_PAIN, asTyped: true }).load).toEqual({ value: 101, unit: 'kg', convention: 'total' });
    const fly = checkProposedLoad(P(140, 'stack'), slot(10, 12, 8), refs(FLY, [], [cable]), { ...NO_PAIN, asTyped: true });
    expect(fly).toMatchObject({ load: { value: 100, convention: 'stack' }, notes: ['capped at machine max 100 kg'] });
    const held = checkProposedLoad(P(140, 'total'), BENCH_SLOT, benchRefs(), { pain: { text: 'shoulder flagged 6 Oct' }, askedHeavier: false, asTyped: true });
    expect(held.held).toBe(true);
    expect(held.load?.value ?? 0).toBeLessThanOrEqual(100);
  });

  it('an assisted machine: his assistance is kept as typed inside the range', () => {
    expect(checkProposedLoad(P(23, 'assistance'), slot(6, 8, 8), refs(PULLUP, [], [assist]), { ...NO_PAIN, asTyped: true }).load).toEqual({ value: 23, unit: 'kg', convention: 'assistance' });
  });

  it('kg/lb: a weight in lb on a kg bar is converted exactly, not rounded', () => {
    expect(checkProposedLoad(P(225, 'total', null, 'lb'), BENCH_SLOT, benchRefs(), { ...NO_PAIN, asTyped: true }).load).toEqual({ value: 102.06, unit: 'kg', convention: 'total' });
  });
});
