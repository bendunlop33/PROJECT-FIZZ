import { describe, expect, it } from 'vitest';

import type { EquipmentInstance, PainFlag, SetType } from '@fizz/schemas';

import {
  builderLoad,
  HISTORY_WINS_SHARE,
  lastSessionE1rm,
  loadReferences,
  nextTargetsFor,
  ruleAnchorOf,
  ruleYieldsToHistory,
  setRowsFor,
  substituteTargets,
  type AnchorLoad,
  type HistorySession,
  type SetRowsInput,
  type SlotLoadInput,
} from '../src/index';
import { at, barbell, exercise, id, kg, OWNER, T0_MS, TZ } from './fixtures';

/**
 * Ben's report, Build B (21 Oct): a new Back day with barbell row got
 * targets far too light, though his last rows were 80 kg × 12 @ 6 (Fri) and
 * 90 kg × 12 (Sat). "It knew my history but wasn't using it." The builder's
 * load path (`loadReferences` → `nextTargetsFor` → `ruleAnchorOf` →
 * `setRowsFor`) is run here as `builder-env` runs it.
 */

const MAIN = id(2);
const PLATES = [
  { mass: 25, count: 4 },
  { mass: 20, count: 2 },
  { mass: 10, count: 2 },
  { mass: 5, count: 2 },
  { mass: 2.5, count: 2 },
  { mass: 1.25, count: 2 },
];
const bar = barbell({ id: id(7800), gymId: MAIN, plates: PLATES, maxLoad: 180 });
/** Another 20 kg bar (another gym, or quick setup re-run): same kind and bar mass. */
const otherBar = barbell({ id: id(7801), gymId: id(3), plates: PLATES, maxLoad: 180 });
/** A 15 kg bar: totals aren't comparable. */
const lightBar = barbell({ id: id(7802), gymId: id(3), barMass: 15, plates: PLATES, maxLoad: 180 });
const KNOWN = new Map<string, EquipmentInstance>([bar, otherBar, lightBar].map((e) => [e.id, e]));

const ROW = exercise(310, 'Barbell row', { movementPattern: 'horizontal_pull', mechanic: 'compound', family: 'row' });

const DAY = 86_400_000;
const NOW = T0_MS;

interface S {
  type: SetType;
  load: number;
  reps: number;
  rpe?: number;
}

function session(n: number, daysAgo: number, eq: EquipmentInstance | null, sets: S[], imported = false): HistorySession {
  return {
    sessionId: id(n),
    performedAtUtc: new Date(NOW - daysAgo * DAY).toISOString(),
    equipmentId: imported ? null : (eq?.id ?? null),
    gymId: imported ? null : (eq?.gymId ?? null),
    imported,
    sets: sets.map((s) => ({ setType: s.type, side: null, load: kg(s.load), reps: s.reps, rpe: s.rpe ?? null, rir: null })),
    tz: TZ,
  };
}

const w = (load: number, reps: number, rpe?: number): S => ({ type: 'working', load, reps, ...(rpe === undefined ? {} : { rpe }) });
const top = (load: number, reps: number, rpe?: number): S => ({ type: 'top', load, reps, ...(rpe === undefined ? {} : { rpe }) });
const back = (load: number, reps: number, rpe?: number): S => ({ type: 'backoff', load, reps, ...(rpe === undefined ? {} : { rpe }) });
const warm = (load: number, reps: number): S => ({ type: 'warmup', load, reps });

/** Older FitNotes rows: 3 × 60 × 10, five weeks back. */
const OLD_FITNOTES = session(900, 35, null, [w(60, 10), w(60, 10), w(60, 10)], true);
/** Fri and Sat in the builder's own format (top set + back-offs), warm-ups logged. */
const FRI_BUILDER = session(901, 4, bar, [warm(20, 10), warm(50, 5), top(80, 12, 6), back(70, 12), back(70, 12)]);
const SAT_BUILDER = session(902, 3, bar, [warm(20, 10), warm(60, 5), top(90, 12), back(80, 12), back(80, 12)]);

const ctxAt = (gymEq: EquipmentInstance[]) => ({ gym: { id: MAIN, name: 'Main gym', equipment: gymEq }, knownEquipment: KNOWN, unit: 'kg' as const });

/** What `builder-env` hands `setRowsFor` for one exercise (history, the rule, pain). */
function slotLoads(history: HistorySession[], opts: { painFlags?: PainFlag[]; gymEq?: EquipmentInstance[]; plan?: AnchorLoad | null } = {}): { load: SlotLoadInput; rule: ReturnType<typeof nextTargetsFor>['result'] } {
  const refs = loadReferences({ exercise: ROW, history, ctx: ctxAt(opts.gymEq ?? [bar]), nowMs: NOW });
  const { result, rule } = nextTargetsFor({
    ownerId: OWNER,
    exerciseId: ROW.id,
    exerciseName: ROW.name,
    measurement: 'reps',
    unit: refs.unit,
    convention: refs.convention,
    equipment: refs.equipment,
    exercise: ROW,
    rule: null,
    workingSets: 3,
    history,
    painFlags: opts.painFlags ?? [],
    sessionPain: { active: false, reportedAtUtc: null },
    comparableEquipmentIds: new Set(refs.comparableEquipmentIds ?? []),
  });
  const flagged = (opts.painFlags ?? []).length > 0;
  return {
    rule: result,
    load: {
      unit: refs.unit,
      convention: refs.convention,
      equipment: refs.equipment,
      coachTarget: null,
      planFirstLoad: opts.plan ?? null,
      ruleTarget: ruleAnchorOf(result, rule, refs.convention),
      e1rm: refs.own?.e1rm ?? null,
      lastE1rm: lastSessionE1rm(refs.own),
      e1rmGapDays: refs.own?.gapDays ?? null,
      startLightCeiling: null,
      painCap: flagged ? (refs.latest?.top.value ?? null) : null,
    },
  };
}

const mainRow = (load: SlotLoadInput): SetRowsInput => ({ main: true, role: 'compound', barbell: true, workingSets: 4, repRange: { min: 6, max: 8 }, load });
const rowsOf = (load: SlotLoadInput) => setRowsFor(mainRow(load));
const topOf = (r: ReturnType<typeof rowsOf>) => r.rows.find((x) => x.type === 'top');
const backoffsOf = (r: ReturnType<typeof rowsOf>) => r.rows.filter((x) => x.type === 'backoff');
const warmupsOf = (r: ReturnType<typeof rowsOf>) => r.rows.filter((x) => x.type === 'warmup');

describe("Ben's rows (Build B, 21 Oct): a new workout's loads come from his recent sets", () => {
  it('builder-format Fri/Sat + older FitNotes 3 × 60 × 10: the rule plans from Sat’s top set (90), not 60', () => {
    const { rule } = slotLoads([OLD_FITNOTES, FRI_BUILDER, SAT_BUILDER]);
    const load = rule.sets[0]?.load?.value ?? 0;
    expect(load).toBeGreaterThanOrEqual(90);
    expect(rule.basedOnSessionIds[0]).toBe(SAT_BUILDER.sessionId);
  });

  it('the built workout: top ≈ 97.5 × 6 and back-offs ≈ 92.5 × 8 from e1RM 126, labelled an estimate; warm-ups ramp below the top set', () => {
    const r = rowsOf(slotLoads([OLD_FITNOTES, FRI_BUILDER, SAT_BUILDER]).load);
    expect(r.source).toBe('calc');
    expect(r.estimate).toBe(true);
    expect(r.anchorE1rm).toBeCloseTo(126, 6);
    expect(topOf(r)?.load).toBe(97.5);
    for (const b of backoffsOf(r)) expect(b.load).toBe(92.5);
    const t = topOf(r)?.load ?? 0;
    const ws = warmupsOf(r);
    expect(ws.length).toBeGreaterThan(0);
    for (const x of ws) expect(x.load ?? 0).toBeLessThan(t);
  });

  it('plain working sets (3 × 90 × 12, then 3 × 80 × 12 @ 6): top 97.5, back-offs 92.5 or more', () => {
    const sat = session(911, 3, bar, [w(90, 12), w(90, 12), w(90, 12)]);
    const fri = session(910, 4, bar, [w(80, 12, 6), w(80, 12, 6), w(80, 12, 6)]);
    const r = rowsOf(slotLoads([fri, sat]).load);
    expect(topOf(r)?.load).toBe(97.5);
    for (const b of backoffsOf(r)) expect(b.load ?? 0).toBeGreaterThanOrEqual(92.5);
  });

  it('only 2 sets of 90 × 12 (the rule holds at 90): still from history, never 90 × 6 / 77.5 × 8', () => {
    const sat = session(921, 2, bar, [w(90, 12), w(90, 12)]);
    const r = rowsOf(slotLoads([sat]).load);
    expect(topOf(r)?.load).toBe(97.5);
    for (const b of backoffsOf(r)) expect(b.load ?? 0).toBeGreaterThanOrEqual(92.5);
  });

  it('never below the last top set for the same or fewer reps (90 × 12 → 6–8 reps: ≥ 90)', () => {
    const r = rowsOf(slotLoads([OLD_FITNOTES, FRI_BUILDER, SAT_BUILDER]).load);
    for (const x of r.rows.filter((y) => y.type !== 'warmup')) expect(x.load ?? 0).toBeGreaterThanOrEqual(90);
  });

  it('Fri/Sat logged on another 20 kg bar still drive the rule (same kind and bar mass)', () => {
    const sat = session(931, 3, otherBar, [top(90, 12), back(80, 12), back(80, 12)]);
    const old = session(930, 30, bar, [w(60, 10), w(60, 10), w(60, 10)]);
    const { rule, load } = slotLoads([old, sat]);
    expect(rule.sets[0]?.load?.value ?? 0).toBeGreaterThanOrEqual(90);
    expect(topOf(rowsOf(load))?.load ?? 0).toBeGreaterThanOrEqual(90);
  });

  it('a 15 kg bar’s totals are not compared (the rule stays on this bar’s history)', () => {
    const sat = session(941, 3, lightBar, [top(90, 12), back(80, 12), back(80, 12)]);
    const old = session(940, 30, bar, [w(60, 10), w(60, 10), w(60, 10)]);
    const { rule } = slotLoads([old, sat]);
    expect(rule.sets[0]?.load?.value).toBeLessThan(90);
  });

  it('the equipment max still bounds the history estimate (rule 4)', () => {
    const capped = barbell({ id: id(7800), gymId: MAIN, plates: PLATES, maxLoad: 95 });
    const sat = session(951, 3, capped, [w(90, 12), w(90, 12), w(90, 12)]);
    const r = rowsOf({ ...slotLoads([sat], { gymEq: [capped] }).load });
    for (const x of r.rows) expect(x.load ?? 0).toBeLessThanOrEqual(95);
  });

  it('a pain flag still caps every working set at the last top set (rule 9) and the rule is not overridden', () => {
    const flag: PainFlag = {
      id: id(960),
      ownerId: OWNER,
      version: 1,
      createdAtUtc: at(-86_400).utc,
      updatedAtUtc: at(-86_400).utc,
      exerciseId: ROW.id,
      exerciseName: ROW.name,
      area: 'back',
      source: 'workout',
      checkInId: null,
      reportedAt: at(-86_400),
      status: 'active',
      clearedAtUtc: null,
      createdByOpId: 'flag-row',
    };
    const { load, rule } = slotLoads([OLD_FITNOTES, FRI_BUILDER, SAT_BUILDER], { painFlags: [flag] });
    expect(rule.decision).toBe('halted_pain');
    expect(load.ruleTarget?.yieldsToHistory).toBeUndefined();
    const r = rowsOf(load);
    for (const x of r.rows.filter((y) => y.type !== 'warmup')) expect(x.load ?? 0).toBeLessThanOrEqual(90);
  });

  it('a gap of 14+ days cuts the history estimate before it can override (R1–R2)', () => {
    const sat = session(971, 20, bar, [w(90, 12), w(90, 12)]);
    const r = rowsOf(slotLoads([sat]).load);
    // 126 cut 10% = 113.4: the rule's hold at 90 (90 × 3 @ 8.5 ≈ 103.5) is within 0.9 of it, so it stands; no raise to 97.5.
    expect(r.source).toBe('rule');
    expect(topOf(r)?.load).toBe(90);
    // Review N1/B1: back-offs from 90 × 6 @ 8 (e1RM 114), not the rule's 3-rep floor (77.5); ≥ the gap-cut est. (85).
    for (const b of backoffsOf(r)) expect(b.load).toBe(85);
  });
});

describe('review B1: back-offs derive from the reps the rule load is used at, never its 3-rep floor', () => {
  it('C. 3 × 100 × 6 @ 8: top 102.5 × 6, back-offs 95 × 8 (not 87.5)', () => {
    const s1 = session(1001, 3, bar, [w(100, 6, 8), w(100, 6, 8), w(100, 6, 8)]);
    const r = rowsOf(slotLoads([s1]).load);
    expect(r.source).toBe('rule');
    expect(topOf(r)?.load).toBe(102.5);
    for (const b of backoffsOf(r)) expect(b.load).toBe(95);
  });

  it('F. the builder’s own format, top 100 × 6 @ 8 + 3 × 95 × 8 @ 8: back-offs stay at 95 (what he did), top 102.5', () => {
    const s1 = session(1002, 3, bar, [top(100, 6, 8), back(95, 8, 8), back(95, 8, 8), back(95, 8, 8)]);
    const r = rowsOf(slotLoads([s1]).load);
    expect(topOf(r)?.load).toBe(102.5);
    for (const b of backoffsOf(r)) expect(b.load ?? 0).toBeGreaterThanOrEqual(95);
  });

  it('D. 3 × 100 × 5 @ 8 (hold): top 100, back-offs 95 (≥ the est. from history, 92.5)', () => {
    const s1 = session(1003, 3, bar, [w(100, 5, 8), w(100, 5, 8), w(100, 5, 8)]);
    const r = rowsOf(slotLoads([s1]).load);
    expect(topOf(r)?.load).toBe(100);
    for (const b of backoffsOf(r)) expect(b.load).toBe(95);
  });

  it('H. top 90 × 12 + 80 × 12 back-offs, 20 days ago: top 92.5, back-offs 87.5 (≥ the gap-cut est., 85)', () => {
    const s1 = session(1004, 20, bar, [top(90, 12), back(80, 12), back(80, 12)]);
    const r = rowsOf(slotLoads([s1]).load);
    expect(topOf(r)?.load).toBe(92.5);
    for (const b of backoffsOf(r)) expect(b.load).toBe(87.5);
  });

  it('no back-off is ever heavier than the top set, even when the last session’s est. is far above the rule load', () => {
    // A rule load that stands (≥ 0.9 of the est.) but sits low within it: the est. lifts the back-offs only up to the cap.
    // Top set used at 3 reps @ 8 (e1RM 116.7); the last session's est. (127) is capped where 4 reps @ 8 is the top load (120).
    const r = builderLoad({ unit: 'kg', convention: 'total', equipment: bar, coachTarget: null, planFirstLoad: null, ruleTarget: { value: 100, reps: 3, rpe: 8.5, yieldsToHistory: true }, e1rm: 127, lastE1rm: 127, startLightCeiling: null, painCap: null }, { reps: 3, rpe: 8 });
    expect(r.source).toBe('rule');
    expect(r.working).toBe(100);
    expect(r.anchorE1rm).toBeCloseTo(100 * (1 + 6 / 30), 6);
    const rows = rowsOf({ unit: 'kg', convention: 'total', equipment: bar, coachTarget: null, planFirstLoad: null, ruleTarget: { value: 100, reps: 3, rpe: 8.5, yieldsToHistory: true }, e1rm: 127, lastE1rm: 127, startLightCeiling: null, painCap: null });
    for (const b of backoffsOf(rows)) expect(b.load ?? 0).toBeLessThanOrEqual(topOf(rows)?.load ?? 0);
  });

  it('a rule reduction does not borrow the higher est. for its back-offs (it never yields)', () => {
    const r = builderLoad({ unit: 'kg', convention: 'total', equipment: bar, coachTarget: null, planFirstLoad: null, ruleTarget: { value: 90, reps: 3, rpe: 8.5 }, e1rm: 126, lastE1rm: 126, startLightCeiling: null, painCap: null }, { reps: 6, rpe: 8 });
    expect(r.anchorE1rm).toBeCloseTo(90 * (1 + 8 / 30), 6);
  });
});

describe('review S1: a stale anchor gives way to the last session, not the best of the last 3', () => {
  it('E. 3 × 100 × 8, then two sessions of 3 × 70 × 10 (his own drop, no pain flag): no jump back to 100', () => {
    const old = session(1011, 10, bar, [w(100, 8), w(100, 8), w(100, 8)]);
    const d1 = session(1012, 5, bar, [w(70, 10), w(70, 10), w(70, 10)]);
    const d2 = session(1013, 2, bar, [w(70, 10), w(70, 10), w(70, 10)]);
    const r = rowsOf(slotLoads([old, d1, d2]).load);
    expect(topOf(r)?.load ?? 0).toBeLessThanOrEqual(75);
    for (const b of backoffsOf(r)) expect(b.load ?? 0).toBeLessThanOrEqual(72.5);
  });

  it('lastSessionE1rm reads only the newest session', () => {
    const refs = loadReferences({ exercise: ROW, history: [session(1021, 10, bar, [w(100, 8)]), session(1022, 2, bar, [w(70, 10)])], ctx: ctxAt([bar]), nowMs: NOW });
    expect(lastSessionE1rm(refs.own)).toBeCloseTo(70 * (1 + 10 / 30), 6);
    expect(refs.own?.e1rm).toBeCloseTo(100 * (1 + 8 / 30), 6);
  });
});

describe('review S4: a builder-format session plans plain working sets from its back-offs too', () => {
  it('top 90 × 12 + 80 × 12 back-offs → the rule plans 92.5 then 82.5 × 2 (not 3 × 92.5)', () => {
    const { rule } = slotLoads([SAT_BUILDER]);
    expect(rule.sets.map((x) => x.load?.value)).toEqual([92.5, 82.5, 82.5]);
  });

  it('a hold keeps the back-off load; plain working-set history is unchanged (all sets one load)', () => {
    const held = session(1031, 3, bar, [top(100, 5, 8), back(90, 8, 8), back(90, 8, 8)]);
    expect(slotLoads([held]).rule.sets.map((x) => x.load?.value)).toEqual([100, 90, 90]);
    const plain = session(1032, 3, bar, [w(100, 6, 8), w(100, 6, 8), w(100, 6, 8)]);
    expect(slotLoads([plain]).rule.sets.map((x) => x.load?.value)).toEqual([102.5, 102.5, 102.5]);
  });
});

describe('review S2: Today and swaps (substituteTargets) read other bars of the same mass', () => {
  it('two misses in a row, one on each 20 kg bar, read as a repeated trend there as in the builder', () => {
    const s1 = session(1040, 6, bar, [w(100, 2), w(100, 2), w(100, 2)]);
    const s2 = session(1041, 3, otherBar, [w(100, 2), w(100, 2), w(100, 2)]);
    const sp = substituteTargets(
      { workingSets: 3, templates: [{ setType: 'working', reps: { min: 8, max: 12 }, durationS: null }] },
      ROW,
      [s1, s2],
      { ...ctxAt([bar]), ownerId: OWNER, lastUsedHere: () => null, painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: at(0) },
    );
    const first = sp.plan?.find((x) => x.setType !== 'warmup' && x.planned.load !== null);
    expect(first?.planned.provenance?.rule?.decision).toBe(slotLoads([s1, s2]).rule.decision);
    expect(first?.planned.load?.value).toBe(slotLoads([s1, s2]).rule.sets[0]?.load?.value);
  });
});

describe('the rule reads builder-format sessions (top + back-offs)', () => {
  it('a missed top set holds at the top load (judged at the top set, not the back-offs)', () => {
    const sat = session(981, 3, bar, [top(100, 2), back(85, 8), back(85, 8)]);
    const { rule } = slotLoads([OLD_FITNOTES, sat]);
    expect(rule.decision).toBe('hold_after_miss');
    expect(rule.sets[0]?.load?.value).toBe(100);
  });

  it('a session with working sets is read as before (top/back-off sets alongside are not counted)', () => {
    const sat = session(982, 3, bar, [w(70, 6), w(70, 6), w(70, 6), top(90, 3)]);
    const { rule } = slotLoads([sat]);
    expect(rule.sets[0]?.load?.value).toBe(72.5);
  });

  it('FitNotes history is unchanged (always working sets)', () => {
    const { rule } = slotLoads([OLD_FITNOTES]);
    expect(rule.sets[0]?.load?.value).toBe(62.5);
  });
});

describe('builderLoad: history wins over a clearly lower anchor (HISTORY_WINS_SHARE)', () => {
  const base: SlotLoadInput = { unit: 'kg', convention: 'total', equipment: bar, coachTarget: null, planFirstLoad: null, ruleTarget: null, e1rm: 126, startLightCeiling: null, painCap: null };

  it('only an anchor marked yieldsToHistory gives way; review B3 still holds for the rest', () => {
    const ruleAnchor: AnchorLoad = { value: 60, reps: 6, rpe: 8.5 };
    expect(builderLoad({ ...base, ruleTarget: ruleAnchor }, { reps: 6, rpe: 8 })).toMatchObject({ source: 'rule', working: 60 });
    expect(builderLoad({ ...base, ruleTarget: { ...ruleAnchor, yieldsToHistory: true } }, { reps: 6, rpe: 8 })).toMatchObject({ source: 'calc', estimate: true });
  });

  it('an anchor within the share of the history estimate stands', () => {
    // 102.5 × 3 @ 8.5 ≈ 117.9 ≥ 0.9 × 125
    const r = builderLoad({ ...base, e1rm: 125, ruleTarget: { value: 102.5, reps: 3, rpe: 8.5, yieldsToHistory: true } }, { reps: 6, rpe: 8 });
    expect(r.source).toBe('rule');
    expect(r.working).toBe(102.5);
    expect(HISTORY_WINS_SHARE).toBe(0.9);
  });

  it('a plan load older than the history gives way the same way; the coach target never does', () => {
    expect(builderLoad({ ...base, planFirstLoad: { value: 60, reps: 8, rpe: 8, yieldsToHistory: true } }, { reps: 6, rpe: 8 }).source).toBe('calc');
    expect(builderLoad({ ...base, planFirstLoad: { value: 60, reps: 8, rpe: 8 } }, { reps: 6, rpe: 8 }).source).toBe('plan');
    expect(builderLoad({ ...base, coachTarget: { value: 60, reps: 8, rpe: 8 } }, { reps: 6, rpe: 8 }).source).toBe('coach_target');
  });

  it('lb history converts with the frame (kg bar, lb e1RM is converted first)', () => {
    const r = builderLoad({ ...base, unit: 'lb', e1rm: 277.8, ruleTarget: { value: 132, reps: 3, rpe: 8.5, yieldsToHistory: true } }, { reps: 6, rpe: 8 });
    expect(r.unit).toBe('kg');
    expect(r.source).toBe('calc');
    expect(r.working ?? 0).toBeGreaterThan(95);
  });

  it('a miss, a reduction or a pain hold never yields; progress and holds do', () => {
    for (const d of ['hold_after_miss', 'reduce_load', 'halted_pain', 'insufficient_data'] as const) expect(ruleYieldsToHistory(d)).toBe(false);
    for (const d of ['increase_load', 'increase_reps', 'hold', 'ceiling_reached'] as const) expect(ruleYieldsToHistory(d)).toBe(true);
    expect(ruleYieldsToHistory(undefined)).toBe(false);
  });
});

