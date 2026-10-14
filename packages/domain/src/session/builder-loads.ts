import type { EquipmentInstance, EquipmentKind, Exercise, Load, LoadConvention, WeightUnit } from '@fizz/schemas';
import { dayMonthText, formatNumber } from '../display';
import { getAchievableLoads, loadDirection, roundToAvailableLoad, type LoadDirection } from '../equipment';
import { isSetCountable } from '../exclusions';
import { comparableSetsOf, type HistorySession } from '../progression';
import { deriveId, stableStringify } from '../stable';
import { toMs } from '../time';
import { convertMass } from '../units';
import { comparableSessions, equipmentHere, type SubstituteContext } from './substitutes';

/**
 * Coach-proposed loads in a built workout (workout-builder.md v2.1 BD6,
 * §8.5). Pure. The coach proposes a working load per exercise with a short
 * basis; code decides:
 *
 * 1. convention and unit against the item this gym maps the exercise to
 *    (kg↔lb converted, anything else rejected);
 * 2. pain (a flag on the movement or session pain): no harder than the most
 *    recent comparable session's working load;
 * 3. plausibility: `referenceE1rm` bands from Ben's own history (app and
 *    FitNotes), a personal ratio or a related lift (`est.`), step bounds for
 *    assisted and added loads, else the first-time ceiling (`est.`);
 * 4. equipment: an achievable load on the item, never past its max; every
 *    clamp, hold or estimate snaps toward easier (`loadDirection`).
 *
 * A rejected or missing load falls back to the built-in rule (`Rule`). The
 * model and the checker read the same `loadReferences`.
 *
 * Every number in `BUILDER_LOAD_BOUNDS` is the designer's proposal (§8.5,
 * §11.3): pending training-researcher evidence and Ben's approval. They live
 * in one place so the approved values replace them in one edit.
 */
export const BUILDER_LOAD_BOUNDS = {
  /** Own history older than this isn't a reference (a personal ratio may be). */
  windowDays: 180,
  /** Sessions read per reference. */
  refSessions: 3,
  /** Working sets of 1–12 reps feed the reference e1RM. */
  maxE1rmReps: 12,
  /** Return-to-load (R1–R2, approved 11 Oct): a gap ≥ 14 days cuts E. */
  gapDays: 14,
  gapCuts: [
    { minDays: 84, cut: 0.4 },
    { minDays: 28, cut: 0.2 },
    { minDays: 14, cut: 0.1 },
  ],
  /** Below `rejectLow × E` is likely a unit or convention slip. */
  rejectLow: 0.5,
  capE: 1.05,
  capLastTop: 1.1,
  /** Above `clampHigh × E` is rejected (catches errors, not ambition). */
  clampHigh: 1.25,
  ratioLow: 0.5,
  relatedLow: 0.3,
  /** First-time ceiling: the easy end of the item's range plus this share toward hard. */
  firstTimeShare: 0.25,
  /** First-time ceiling from own same-pattern references: their lowest E × this. */
  patternShare: 0.5,
  stepsEasier: 2,
  stepsHarder: 1,
  stepsHarderAsked: 2,
  /** Personal ratio: both exercises done within this many days of each other. */
  pairDays: 28,
} as const;

const B = BUILDER_LOAD_BOUNDS;
const DAY_MS = 86_400_000;
const EPS = 1e-6;
/** Conventions with an e1RM reference (§8.5). Assisted and added loads are bounded in steps. */
const E1RM_CONVENTIONS: ReadonlySet<LoadConvention> = new Set(['total', 'per_hand', 'stack']);
/** Items whose FitNotes history can't be tied to a machine: references only as `est.` (§8.5). */
const MACHINE_KINDS: ReadonlySet<EquipmentInstance['kind']> = new Set(['weight_stack', 'plate_loaded_machine']);

// ---------------------------------------------------------------------------
// Reference e1RM (§8.5; separate from Progress's `estimateOneRepMax`)

/** One working set in the item's unit and convention. */
export interface RefSet {
  value: number;
  reps: number;
  rpe: number | null;
}

/**
 * `referenceE1rm(sets)`: the highest RIR-adjusted Epley estimate among
 * working sets of 1–12 reps: `load × (1 + (reps + RIR) / 30)`, RIR = 10 −
 * RPE, or 0 with no RPE logged. No display rounding. Null with no usable set.
 * Not `estimateOneRepMax` (Progress: plain Epley, ≤ 10 reps), which is unchanged.
 */
export function referenceE1rm(sets: readonly RefSet[]): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (!Number.isFinite(s.value) || s.value <= 0 || !Number.isInteger(s.reps) || s.reps < 1 || s.reps > B.maxE1rmReps) continue;
    const rir = s.rpe === null ? 0 : Math.max(0, 10 - s.rpe);
    const e = s.value * (1 + (s.reps + rir) / 30);
    if (best === null || e > best) best = e;
  }
  return best;
}

/** `E`: the heaviest plausible load for `repsMin` reps at `targetRpe` from an e1RM. */
export function expectedLoad(e1rm: number, repsMin: number, targetRpe: number): number {
  return e1rm / (1 + (repsMin + (10 - targetRpe)) / 30);
}

/** R1–R2 (approved 11 Oct): the share `E` is cut by after a gap. */
export function returnCut(gapDays: number): number {
  for (const c of B.gapCuts) if (gapDays >= c.minDays) return c.cut;
  return 0;
}

// ---------------------------------------------------------------------------
// References (`loadReferences`, §8.2)

export interface RefSession {
  sessionId: string;
  performedAtUtc: string;
  tz: string;
  source: 'app' | 'fitnotes';
  /** Working sets in the item's unit and convention. */
  sets: RefSet[];
  /** The hardest working set (heaviest; least assistance), more reps on a tie. */
  top: RefSet;
}

export interface OwnReference {
  /** Newest first, at most 3, within 180 days. */
  sessions: RefSession[];
  /** `referenceE1rm` over those sessions; null for assisted or added loads, or no set of 1–12 reps. */
  e1rm: number | null;
  /** Days since the newest of them. */
  gapDays: number;
  /** Only FitNotes history on a stack or plate-loaded machine (the machine can't be known): `est.`. */
  estOnly: boolean;
}

/** A reference from another exercise (`est.`): Ben's own ratio between two exercises, or the catalogue's related lift. */
export interface DerivedReference {
  kind: 'personal_ratio' | 'related_lift';
  /** The e1RM it implies for this exercise, in its unit. */
  e1rm: number;
  /** `chest press 60×10`: what it was derived from, for the basis. */
  text: string;
  /** Numbers a basis may cite from it. */
  numbers: number[];
  /** Sets a basis may cite as `load×reps` (B1: a cited set must be a real one). */
  sets: RefSet[];
}

/** The item a load was checked on (B7): a later plan on another kind, convention or bar re-checks as `Rule`. */
export interface CheckedOn {
  equipmentId: string;
  kind: EquipmentKind;
  convention: LoadConvention;
  unit: WeightUnit;
  barKg: number | null;
}

export interface LoadReferences {
  exerciseId: string;
  unit: WeightUnit;
  convention: LoadConvention;
  direction: LoadDirection;
  /** The item this gym maps the exercise to; null when it needs none or the gym has none. */
  equipment: EquipmentInstance | null;
  own: OwnReference | null;
  /** The most recent comparable session of any age (the pain hold reads it). */
  latest: RefSession | null;
  /** Every comparable session, any age, newest first (personal ratios read the older ones). */
  all: RefSession[];
  derived: DerivedReference | null;
  /** E1RMs of Ben's other exercises in the same movement pattern and convention, in this unit (first-time ceiling). */
  patternE1rms: number[];
  /** Changes when the comparable history changes (`previewKey`, `checkedHistoryVersion`). */
  historyVersion: string;
}

const harderThan = (a: number, b: number, dir: LoadDirection): boolean => (dir === 'resistance' ? a > b + EPS : a < b - EPS);
const easierOf = (a: number, b: number, dir: LoadDirection): number => (harderThan(a, b, dir) ? b : a);
const round2 = (n: number): number => Math.round(n * 100) / 100;

function topOf(sets: readonly RefSet[], dir: LoadDirection): RefSet | null {
  let top: RefSet | null = null;
  for (const s of sets) if (top === null || harderThan(s.value, top.value, dir) || (Math.abs(s.value - top.value) < EPS && s.reps > top.reps)) top = s;
  return top;
}

/** A history session's working sets in this unit and convention (FitNotes ramps left out, excluded sets left out). */
export function refSessionOf(h: HistorySession, unit: WeightUnit, convention: LoadConvention): RefSession | null {
  const dir = loadDirection(convention);
  const sets: RefSet[] = [];
  for (const s of comparableSetsOf(h)) {
    if (s.setType === 'warmup' || s.load === null || s.reps === null || s.load.convention !== convention || !isSetCountable(s, 'e1rm')) continue;
    const value = s.load.unit === unit ? s.load.value : convertMass({ value: s.load.value, unit: s.load.unit }, unit).value;
    sets.push({ value: round2(value), reps: s.reps, rpe: s.rpe });
  }
  const top = topOf(sets, dir);
  if (top === null) return null;
  return { sessionId: h.sessionId, performedAtUtc: h.performedAtUtc, tz: h.tz ?? 'UTC', source: h.imported ? 'fitnotes' : 'app', sets, top };
}

/** Own reference from sessions newest first (§8.5): the last 3 within the window. */
export function ownReferenceOf(sessions: readonly RefSession[], convention: LoadConvention, nowMs: number, estOnly: boolean): OwnReference | null {
  const inWindow = sessions.filter((s) => nowMs - toMs(s.performedAtUtc) <= B.windowDays * DAY_MS).slice(0, B.refSessions);
  const newest = inWindow[0];
  if (newest === undefined) return null;
  const e1rm = E1RM_CONVENTIONS.has(convention) ? referenceE1rm(inWindow.flatMap((s) => s.sets)) : null;
  return { sessions: inWindow, e1rm, gapDays: Math.max(0, Math.floor((nowMs - toMs(newest.performedAtUtc)) / DAY_MS)), estOnly };
}

export interface LoadReferencesInput {
  exercise: Exercise;
  history: readonly HistorySession[];
  /** Where the slot will be done (the same mapping the plan uses). */
  ctx: Pick<SubstituteContext, 'gym' | 'lastUsedHere' | 'knownEquipment' | 'unit'>;
  nowMs: number;
  derived?: DerivedReference | null;
  patternE1rms?: readonly number[];
}

/**
 * `loadReferences` (§8.2): what the coach is sent and what
 * `checkProposedLoad` checks against, for one exercise at the selected gym.
 * Comparable history is `comparableSessions` (app sessions on the same kind
 * of item; FitNotes sessions match any, B7). On a stack or plate-loaded
 * machine, FitNotes history is a reference only as `est.`.
 */
export function loadReferences(input: LoadReferencesInput): LoadReferences {
  const { exercise } = input;
  const equipment = equipmentHere(exercise, input.ctx).equipment;
  const convention = equipment?.loadConvention ?? exercise.defaultLoadConvention;
  const unit = equipment?.unit ?? input.ctx.unit;
  const direction = loadDirection(convention);
  const comparable = comparableSessions(exercise, input.history, input.ctx);
  const all = comparable.flatMap((c) => {
    const r = refSessionOf(c.session, unit, convention);
    return r === null ? [] : [r];
  });
  const machine = equipment !== null && MACHINE_KINDS.has(equipment.kind);
  const app = all.filter((s) => s.source === 'app');
  const own = machine && app.length > 0 ? ownReferenceOf(app, convention, input.nowMs, false) : machine ? ownReferenceOf(all, convention, input.nowMs, true) : ownReferenceOf(all, convention, input.nowMs, false);
  return {
    exerciseId: exercise.id,
    unit,
    convention,
    direction,
    equipment,
    own,
    latest: all[0] ?? null,
    all,
    derived: own === null ? (input.derived ?? null) : null,
    patternE1rms: [...(input.patternE1rms ?? [])],
    historyVersion: historyVersionOf(all),
  };
}

/** One candidate exercise and its history, for `buildReferences`. */
export interface ExerciseHistory {
  exercise: Exercise;
  history: readonly HistorySession[];
}

/**
 * `loadReferences` for a build (§8.5, §8.2 `personalRatios`): the
 * exercise's own references, plus, from Ben's other exercises in the same
 * movement pattern (`mates`, Your data, derived now and never stored):
 * their e1RMs in the same unit and convention (the first-time ceiling's
 * ×0.5 part), and, when its own history is older than 180 days, a personal
 * ratio (`est.`). Mates in another unit are skipped (no cross-unit ratios).
 */
export function buildReferences(input: { target: ExerciseHistory; mates: readonly ExerciseHistory[]; ctx: LoadReferencesInput['ctx']; nowMs: number; related?: DerivedReference | null }): LoadReferences {
  const base = loadReferences({ exercise: input.target.exercise, history: input.target.history, ctx: input.ctx, nowMs: input.nowMs });
  const mates = input.mates
    .filter((m) => m.exercise.id !== input.target.exercise.id && m.exercise.movementPattern === input.target.exercise.movementPattern)
    .map((m) => ({ m, refs: loadReferences({ exercise: m.exercise, history: m.history, ctx: input.ctx, nowMs: input.nowMs }) }))
    .filter((x) => x.refs.unit === base.unit && x.refs.own !== null && !x.refs.own.estOnly && x.refs.own.e1rm !== null);
  const patternE1rms = mates.filter((x) => x.refs.convention === base.convention).flatMap((x) => (x.refs.own?.e1rm === null || x.refs.own?.e1rm === undefined ? [] : [x.refs.own.e1rm]));
  let derived: DerivedReference | null = null;
  if (base.own === null && E1RM_CONVENTIONS.has(base.convention)) {
    derived = base.all.length > 0 ? personalRatioReference(base.all, mates.map((x) => ({ name: x.m.exercise.name, sessions: x.refs.all })), input.nowMs) : null;
    derived = derived ?? input.related ?? null;
  }
  return { ...base, derived, patternE1rms };
}

/** A stable fingerprint of the comparable history (new or corrected sessions change it). */
export function historyVersionOf(sessions: readonly RefSession[]): string {
  return deriveId(`builder-history:${stableStringify(sessions.map((s) => [s.sessionId, s.performedAtUtc, s.sets.map((x) => [x.value, x.reps, x.rpe])]))}`);
}

/** Where a reference was checked: the item now mapped, for `recheckDraftLoad` (B7). */
export function checkedOnOf(refs: Pick<LoadReferences, 'equipment' | 'convention' | 'unit'>): CheckedOn | null {
  const e = refs.equipment;
  if (e === null) return null;
  const barKg = e.kind === 'barbell' ? round2(convertMass({ value: e.barMass, unit: e.unit }, 'kg').value) : null;
  return { equipmentId: e.id, kind: e.kind, convention: refs.convention, unit: refs.unit, barKg };
}

// ---------------------------------------------------------------------------
// Derived references (`personalRatios`, `relatedLifts`; `est.`)

/** One exercise's history as a personal-ratio candidate sees it (same unit as the target). */
export interface PatternMate {
  name: string;
  /** Its comparable sessions, newest first, in the target's unit and convention. */
  sessions: readonly RefSession[];
}

/**
 * Ben's own ratio between this exercise and one he still does in the same
 * movement pattern and convention (`personalRatios`, §8.2): both done within
 * 28 days of each other (latest pairing); ratio of their session e1RMs.
 * Applied to the pattern-mate's current reference e1RM. Derived from Your
 * data at build time, never stored, never Coaching knowledge. Null when no
 * pairing exists.
 */
export function personalRatioReference(target: readonly RefSession[], mates: readonly PatternMate[], nowMs: number): DerivedReference | null {
  let best: { at: number; ref: DerivedReference } | null = null;
  for (const m of mates) {
    const current = ownReferenceOf(m.sessions, 'total', nowMs, false);
    const mateNow = current === null ? null : referenceE1rm(current.sessions.flatMap((s) => s.sets));
    if (mateNow === null || current === null) continue;
    for (const t of target) {
      const te = referenceE1rm(t.sets);
      if (te === null) continue;
      for (const ms of m.sessions) {
        if (Math.abs(toMs(ms.performedAtUtc) - toMs(t.performedAtUtc)) > B.pairDays * DAY_MS) continue;
        const me = referenceE1rm(ms.sets);
        if (me === null || me <= 0) continue;
        const at = Math.max(toMs(ms.performedAtUtc), toMs(t.performedAtUtc));
        if (best !== null && best.at >= at) continue;
        const top = current.sessions[0]?.top;
        best = {
          at,
          ref: {
            kind: 'personal_ratio',
            e1rm: mateNow * (te / me),
            text: top === undefined ? m.name.toLowerCase() : `${m.name.toLowerCase()} ${formatNumber(top.value)}×${String(top.reps)}`,
            numbers: [...current.sessions.flatMap((s) => s.sets.flatMap((x) => [x.value, x.reps, ...(x.rpe === null ? [] : [x.rpe])])), ...t.sets.flatMap((x) => [x.value, x.reps])],
            sets: [...current.sessions.flatMap((s) => s.sets), ...t.sets],
          },
        };
      }
    }
  }
  return best?.ref ?? null;
}

/** A catalogue related-lift pair (Coaching knowledge, Ben approves; empty until then, §8.8 P5). */
export interface RelatedLift {
  fromName: string;
  /** The related exercise's sessions, newest first, in this unit and convention. */
  sessions: readonly RefSession[];
  ratio: { low: number; high: number };
}

/** `E_rel`'s e1RM: the related lift's reference e1RM × `ratio.low` (§8.5). */
export function relatedLiftReference(r: RelatedLift, nowMs: number): DerivedReference | null {
  const own = ownReferenceOf(r.sessions, 'total', nowMs, false);
  const e = own === null ? null : referenceE1rm(own.sessions.flatMap((s) => s.sets));
  if (e === null || own === null) return null;
  const top = own.sessions[0]?.top;
  return {
    kind: 'related_lift',
    e1rm: e * r.ratio.low,
    text: top === undefined ? r.fromName.toLowerCase() : `${r.fromName.toLowerCase()} ${formatNumber(top.value)}×${String(top.reps)}`,
    numbers: own.sessions.flatMap((s) => s.sets.flatMap((x) => [x.value, x.reps, ...(x.rpe === null ? [] : [x.rpe])])),
    sets: own.sessions.flatMap((s) => s.sets),
  };
}

// ---------------------------------------------------------------------------
// First-time ceiling (B1)

/**
 * `noReferenceCeiling` (§8.5 B1): the easier of (a) the easy end of the
 * item's range plus 25% toward hard and (b) half the lowest `E` among Ben's
 * own references in the same movement pattern and convention, snapped
 * toward easier. Null when the item has no loads.
 */
export function noReferenceCeiling(equipment: EquipmentInstance | null, patternEs: readonly number[] = []): number | null {
  if (equipment === null) return null;
  const a = getAchievableLoads(equipment);
  const lo = a.loads[0];
  const hi = a.loads[a.loads.length - 1];
  if (lo === undefined || hi === undefined) return null;
  const dir = a.direction;
  let c = dir === 'resistance' ? lo + B.firstTimeShare * (hi - lo) : hi - B.firstTimeShare * (hi - lo);
  const pattern = patternEs.filter((e) => Number.isFinite(e) && e > 0);
  if (dir === 'resistance' && pattern.length > 0) c = Math.min(c, Math.min(...pattern) * B.patternShare);
  const snapped = roundToAvailableLoad({ value: Math.max(0, c), unit: equipment.unit, convention: equipment.loadConvention }, equipment, 'easier');
  return snapped.ok ? snapped.load.value : null;
}

// ---------------------------------------------------------------------------
// The check (`checkProposedLoad`, BD6 steps 1–4)

export interface LoadProposalIn {
  value: number;
  unit: WeightUnit;
  convention: LoadConvention;
  basis: string | null;
}

/** The slot the load is for: its rep range and target RPE (BD7). */
export interface LoadSlot {
  repsMin: number;
  repsMax: number;
  targetRpe: number;
}

export interface LoadCheckContext {
  /** A flag covering the movement (`knee flagged 6 Oct`) or session pain (`pain reported today`). */
  pain: { text: string } | null;
  /** Ben asked heavier in his words (BD16): one more step allowed on step bounds. */
  askedHeavier: boolean;
  /** Plan-time re-check (`recheckDraftLoad`): the cap note names the newer session. */
  capReason?: string;
  /** Plan-time re-check with no newer history: only pain and the equipment apply (the stored load already passed). */
  bandsChecked?: boolean;
}

export type LoadSource = 'coach' | 'coach_est' | 'rule' | 'none';

export interface LoadCheck {
  /** In the item's unit and convention, achievable on it; null for `rule` (the caller plans the rule's) and `none`. */
  load: Load | null;
  source: LoadSource;
  held: boolean;
  /** Code's check notes (`capped at 107.5 · more than recent sets support`). */
  notes: string[];
  /**
   * The reason line's load part, always built by code from the real
   * reference sets and the final load (`last 3: 100×7 @8 → 102.5`,
   * `last 100×7 @8 · capped → 107.5`, `est. from incline 30×8 → 27.5 each`).
   * Never the coach's words (review r2 B1r). Null for `rule` and `none`.
   */
  basis: string | null;
  /**
   * The coach's own basis, shown only behind `Why?` as `Coach's note` (data,
   * not fact): set when it passed `checkBasis` and code kept the load as
   * proposed. Null otherwise.
   */
  coachNote: string | null;
  /** A coach basis that failed `checkBasis`, or named a load code changed (`Why?` → `NOT USED`). */
  notUsed: string | null;
}

const KIND_WORD: Readonly<Record<EquipmentInstance['kind'], string>> = {
  barbell: 'these plates',
  dumbbells: 'this rack',
  weight_stack: 'this stack',
  plate_loaded_machine: 'these plates',
  assisted_stack: 'this machine',
  bodyweight_station: 'this station',
};

/** `25 assist`, `+20`, `30 each`, `102.5`: a load in a check note. */
export function noteLoad(value: number, convention: LoadConvention): string {
  const n = formatNumber(value);
  switch (convention) {
    case 'assistance':
      return `${n} assist`;
    case 'added':
      return `+${n}`;
    case 'per_hand':
      return `${n} each`;
    case 'total':
    case 'stack':
    case 'bodyweight':
      return n;
  }
}

const stepWord = (n: number): string => (n === 1 ? 'one step' : n === 2 ? 'two steps' : `${String(n)} steps`);

interface Band {
  /** The easiest accepted load (null: anything easier is accepted). */
  easiest: number | null;
  /** The hardest accepted load. */
  hardest: number;
  /** Harder than this is rejected; null: clamped to `hardest` instead. */
  limit: number | null;
  /** Easier than `easiest` is clamped (step bounds) instead of rejected. */
  clampEasy: boolean;
  est: boolean;
  capNote: (final: number) => string;
  rejectNote: string;
  /** Step bounds: from where. */
  stepFrom?: number;
}

/** Index of the achievable load nearest `v` in difficulty order (easiest first). */
function stepIndex(loads: readonly number[], v: number): number {
  let best = 0;
  let gap = Infinity;
  loads.forEach((l, i) => {
    const d = Math.abs(l - v);
    if (d < gap - EPS) {
      gap = d;
      best = i;
    }
  });
  return best;
}

function bandFor(refs: LoadReferences, slot: LoadSlot, p: LoadProposalIn, ctx: LoadCheckContext, loads: readonly number[]): Band | null {
  const dir = refs.direction;
  const own = refs.own;
  const capReason = ctx.capReason ?? 'more than recent sets support';
  const lastText = (s: RefSession): string => `last ${formatNumber(s.top.value)} × ${String(s.top.reps)}`;
  const reject = `coach load ${formatNumber(p.value)} ${p.unit} too far from ${own?.sessions[0] !== undefined ? lastText(own.sessions[0]) : 'its reference'}`;
  if (own !== null && own.e1rm !== null && E1RM_CONVENTIONS.has(refs.convention)) {
    const E = expectedLoad(own.e1rm, slot.repsMin, slot.targetRpe) * (1 - returnCut(own.gapDays));
    // The repeat floor F (B4): the most recent working load done for ≥ repsMin reps (gap < 14 days, no pain).
    const withReps = own.sessions.find((s) => s.sets.some((x) => x.reps >= slot.repsMin));
    const atReps = withReps === undefined ? null : Math.max(...withReps.sets.filter((x) => x.reps >= slot.repsMin).map((x) => x.value));
    const F = atReps !== null && own.gapDays < B.gapDays && ctx.pain === null ? atReps : null;
    if (own.estOnly) {
      const hardest = Math.max(E, F ?? -Infinity);
      return { easiest: B.rejectLow * E, hardest, limit: Math.max(B.clampHigh * E, hardest), clampEasy: false, est: true, capNote: (v) => `capped at ${formatNumber(v)} · est.`, rejectNote: reject };
    }
    const capBase = Math.min(B.capE * E, atReps === null ? Infinity : B.capLastTop * atReps);
    const cap = Math.max(capBase, F ?? -Infinity);
    return { easiest: B.rejectLow * E, hardest: cap, limit: Math.max(B.clampHigh * E, cap), clampEasy: false, est: false, capNote: (v) => `capped at ${formatNumber(v)} · ${capReason}`, rejectNote: reject };
  }
  if (own !== null && loads.length > 0) {
    // Assisted, added, or no set in 1–12 reps: steps from the most recent working load (B2).
    const L = own.sessions[0]?.top.value;
    if (L !== undefined) {
      const byDifficulty = dir === 'resistance' ? [...loads] : [...loads].reverse();
      const at = stepIndex(byDifficulty, L);
      const up = ctx.askedHeavier ? B.stepsHarderAsked : B.stepsHarder;
      const easiest = byDifficulty[Math.max(0, at - B.stepsEasier)] ?? L;
      const hardest = byDifficulty[Math.min(byDifficulty.length - 1, at + up)] ?? L;
      const lText = refs.convention === 'added' ? `+${formatNumber(L)}` : formatNumber(L);
      return {
        easiest,
        hardest,
        limit: null,
        clampEasy: true,
        est: own.estOnly,
        stepFrom: L,
        // Not `held` (that word is the pain hold's, BD10; review B3).
        capNote: (v) => `${noteLoad(v, refs.convention)} · ${stepWord(Math.abs(stepIndex(byDifficulty, v) - at))} from last ${lText}`,
        rejectNote: reject,
      };
    }
  }
  if (refs.derived !== null && E1RM_CONVENTIONS.has(refs.convention)) {
    const E = expectedLoad(refs.derived.e1rm, slot.repsMin, slot.targetRpe);
    const low = refs.derived.kind === 'personal_ratio' ? B.ratioLow : B.relatedLow;
    return { easiest: low * E, hardest: E, limit: B.clampHigh * E, clampEasy: false, est: true, capNote: (v) => `capped at ${formatNumber(v)} · est. from ${refs.derived?.text ?? 'a related lift'}`, rejectNote: `coach load ${formatNumber(p.value)} ${p.unit} too far from est.` };
  }
  const patternEs = refs.patternE1rms.map((e) => expectedLoad(e, slot.repsMin, slot.targetRpe));
  const C = noReferenceCeiling(refs.equipment, patternEs);
  if (C === null) return null;
  return { easiest: null, hardest: C, limit: null, clampEasy: false, est: true, capNote: (v) => `capped at ${noteLoad(v, refs.convention)} · first time`, rejectNote: reject };
}

/**
 * `checkProposedLoad(p, slot, refs, ctx)` (§8.2, BD6 steps 1–4; §8.5). Pure.
 * `rule`: the caller plans the built-in rule's load (`substituteTargets`).
 * `none`: no load is possible (pain with no history; no reference and no
 * range): the slot shows `—` and `start light`.
 */
export function checkProposedLoad(p: LoadProposalIn | null, slot: LoadSlot, refs: LoadReferences, ctx: LoadCheckContext): LoadCheck {
  const notes: string[] = [];
  const out = (o: Partial<LoadCheck> & Pick<LoadCheck, 'source'>): LoadCheck => ({ load: null, held: false, basis: null, coachNote: null, notUsed: null, ...o, notes: [...notes, ...(o.notes ?? [])] });
  const rule = (note: string): LoadCheck => out({ source: 'rule', notes: [note], notUsed: p?.basis ?? null });
  if (p === null) return rule('no load from coach · rule used');
  if (refs.convention === 'bodyweight' || p.convention !== refs.convention) return rule('wrong load type · rule used');
  if (!Number.isFinite(p.value) || p.value <= 0) return rule('no load from coach · rule used');
  const eq = refs.equipment;
  const loads = eq === null ? [] : getAchievableLoads(eq).loads;
  if (eq === null || loads.length === 0) return rule('nothing to fit it to here · rule used');
  const dir = refs.direction;
  let v = p.value;
  if (p.unit !== refs.unit) {
    v = convertMass({ value: v, unit: p.unit }, refs.unit).value;
    notes.push(`${p.unit} → ${refs.unit} converted`);
  }
  /** The proposal in the item's unit, before any hold, clamp or fit. */
  const asked = v;

  // 2. Pain (BD10): no harder than the most recent comparable session's working load (not the heaviest).
  let held = false;
  if (ctx.pain !== null) {
    const last = refs.latest?.top.value ?? null;
    if (last === null) return out({ source: 'none', held: true, notes: [`held · ${ctx.pain.text}`] });
    v = easierOf(v, last, dir);
    held = true;
    notes.push(`held · ${ctx.pain.text}`);
  }

  // 3. Plausibility (§8.5).
  const band = bandFor(refs, slot, p, ctx, loads);
  if (band === null) return out({ source: 'none', notes: ['no reference · start light'] });
  let clamped = false;
  if (ctx.bandsChecked !== true) {
    if (harderThan(v, band.hardest, dir)) {
      if (band.limit !== null && harderThan(v, band.limit, dir)) return rule(band.rejectNote);
      v = band.hardest;
      clamped = true;
    } else if (band.easiest !== null && harderThan(band.easiest, v, dir)) {
      if (!band.clampEasy) return rule(band.rejectNote);
      v = band.easiest;
      clamped = true;
    }
  }

  // 4. Equipment: achievable, never past the max (rule 4); clamped, held and estimated loads go toward easier.
  const est = band.est;
  // Step-bounded (assisted, added) loads always go toward easier (WB-L11: 32 assist → 35, never 30).
  const towardEasier = clamped || held || est || band.stepFrom !== undefined;
  let r = roundToAvailableLoad({ value: v, unit: refs.unit, convention: refs.convention }, eq, towardEasier ? 'easier' : 'nearest');
  if (r.ok && !towardEasier && ctx.bandsChecked !== true && harderThan(r.load.value, band.hardest, dir)) r = roundToAvailableLoad({ value: v, unit: refs.unit, convention: refs.convention }, eq, 'easier');
  if (!r.ok) return rule('nothing to fit it to here · rule used');
  const final = r.load.value;
  // Below the item's easiest load: kept only if that is still in the band.
  if (r.bounded !== null && harderThan(final, v, dir) && ctx.bandsChecked !== true && harderThan(final, band.hardest, dir)) return rule(band.rejectNote);
  if (r.bounded !== null && harderThan(v, final, dir)) notes.push(`capped at machine ${dir === 'resistance' ? 'max' : 'min'} ${formatNumber(final)} ${refs.unit}`);
  else if (clamped) notes.push(band.capNote(final));
  else if (Math.abs(final - v) > EPS) notes.push(`${formatNumber(v)} → ${formatNumber(final)} (${KIND_WORD[eq.kind]})`);

  const source: LoadSource = est ? 'coach_est' : 'coach';
  // Review r2 B1r: the reason line is always code's, from real reference sets and the final load.
  // The coach's words are only ever a `Coach's note` behind `Why?`, and only when they pass
  // `checkBasis` and code kept the load as proposed (B2: a changed load makes them name another number).
  const capped = clamped || (r.bounded !== null && harderThan(v, final, dir));
  const basis = reasonBasis(refs, { est, held, capped, final, convention: refs.convention });
  const changed = Math.abs(final - asked) > EPS || r.load.unit !== p.unit;
  const ok = !changed && p.basis !== null && checkBasis(p.basis, basisAllowed(refs, slot, [p.value, final]), refs.own?.sessions.length ?? (refs.latest === null ? 0 : 1));
  return out({ load: r.load, source, held, basis, coachNote: ok ? p.basis : null, notUsed: ok ? null : p.basis });
}

/** Longest stored reason basis (the reason line keeps room for `held · est. · ` and a short shape note). */
const FINAL_BASIS_MAX = 48;

/** `100×7 @8`, `+20×6`: one real set as the reason line cites it. */
function setText(s: RefSet, convention: LoadConvention): string {
  return `${convention === 'added' ? '+' : ''}${formatNumber(s.value)}×${String(s.reps)}${s.rpe === null ? '' : ` @${formatNumber(s.rpe)}`}`;
}

/** The set that sets the e1RM bands (highest `referenceE1rm`, newest first on a tie); else the newest top set. */
function drivingSet(sessions: readonly RefSession[], convention: LoadConvention): RefSet | null {
  const newestTop = sessions[0]?.top ?? null;
  if (!E1RM_CONVENTIONS.has(convention)) return newestTop;
  let best: { s: RefSet; e: number } | null = null;
  for (const sess of sessions) {
    for (const x of sess.sets) {
      const e = referenceE1rm([x]);
      if (e !== null && (best === null || e > best.e + EPS)) best = { s: x, e };
    }
  }
  return best?.s ?? newestTop;
}

/**
 * The reference part of the reason line (§7): `last 100×7 @8`, `last 3:
 * 100×7 @8` (the set that sets the bands, of the last 3), `est. · last
 * 30×10 (FitNotes)`, `est. from chest press 60×10`, `est. · first time`.
 * A pain hold cites the most recent comparable session (what the hold reads).
 */
export function referenceText(refs: LoadReferences, opts: { est: boolean; held: boolean }): string {
  if (opts.held && refs.latest !== null) {
    const l = refs.latest;
    return `last ${setText(l.top, refs.convention)}${l.source === 'fitnotes' ? ' (FitNotes)' : ''}`;
  }
  const own = refs.own;
  if (own !== null && own.sessions.length > 0) {
    const multi = own.sessions.length > 1 && E1RM_CONVENTIONS.has(refs.convention);
    const set = multi ? drivingSet(own.sessions, refs.convention) : (own.sessions[0]?.top ?? null);
    const fit = own.sessions.every((x) => x.source === 'fitnotes') ? ' (FitNotes)' : '';
    const t = set === null ? 'last' : `last ${multi ? `${String(own.sessions.length)}: ` : ''}${setText(set, refs.convention)}${fit}`;
    return opts.est || own.estOnly ? `est. · ${t}` : t;
  }
  if (refs.derived !== null) return `est. from ${refs.derived.text}`;
  return 'est. · first time';
}

/**
 * The reason line's load part (review r2 B1r): code's reference text, then
 * `· capped` when code clamped, then `→` the final load, at most 48
 * characters with the final value never cut (N1r: the middle is shortened).
 */
export function reasonBasis(refs: LoadReferences, o: { est: boolean; held: boolean; capped: boolean; final: number; convention: LoadConvention }): string {
  return finalBasis(referenceText(refs, { est: o.est, held: o.held }), o.capped, o.final, o.convention);
}

/** `last 100×7 @8 · capped → 107.5`: a reference text ending with the load the row shows (B2). */
export function finalBasis(code: string, capped: boolean, final: number, convention: LoadConvention): string {
  return fitKeepingTail(`${code}${capped ? ' · capped' : ''} → ${noteLoad(final, convention)}`, FINAL_BASIS_MAX);
}

/**
 * Shortens a reason line to `max` characters without cutting its final
 * `· capped → N` (review r2 N1r): the middle is cut at a word boundary and
 * marked `…`. A line with no arrow is cut at the end.
 */
export function fitKeepingTail(line: string, max: number): string {
  if (line.length <= max) return line;
  let at = line.lastIndexOf(' → ');
  if (at < 0) return `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  if (line.slice(0, at).endsWith(' · capped')) at -= ' · capped'.length;
  const tail = line.slice(at);
  const room = max - tail.length - 1;
  if (room <= 0) return tail.trimStart().slice(0, max);
  const head = line.slice(0, at);
  let cutAt = head.lastIndexOf(' ', room);
  if (cutAt <= 0) cutAt = room;
  return `${head.slice(0, cutAt).replace(/[\s·:,]+$/u, '')}…${tail}`;
}

/**
 * What a coach note may cite (§7 basis rules, review B1, r2 B1r, r3 B1s).
 * `numbers`: bare numbers (references, the slot's reps and RPE, differences,
 * dates); never the proposal's values. `loads`: the numbers that may be
 * written as a load (reference loads, the e1RM, differences), never a rep,
 * RPE or day number; absent → `numbers`. `sets`: the only `load×reps` pairs
 * it may cite, the reference sets themselves. `targets`: the proposal's
 * values, allowed only after an arrow (`→ 102.5`, `→ 102.5×6` with reps in
 * the slot's range). `lastLoads`: the loads of the most recent session
 * (`100 last time`).
 */
export interface BasisAllowed {
  numbers: readonly number[];
  loads?: readonly number[];
  sets: readonly RefSet[];
  targets?: readonly number[];
  reps?: { min: number; max: number };
  lastLoads?: readonly number[];
}

function basisAllowed(refs: LoadReferences, slot: LoadSlot, proposal: readonly number[]): BasisAllowed {
  const numbers: number[] = [slot.repsMin, slot.repsMax, slot.targetRpe];
  const loads: number[] = [];
  const sets: RefSet[] = [];
  const sessions = refs.own?.sessions ?? (refs.latest === null ? [] : [refs.latest]);
  for (const s of sessions) {
    for (const x of s.sets) {
      numbers.push(x.value, x.reps, ...(x.rpe === null ? [] : [x.rpe]));
      loads.push(x.value);
      sets.push(x);
    }
    const day = Number(dayMonthText(s.performedAtUtc, s.tz).split(/\s/)[0]);
    if (Number.isFinite(day)) numbers.push(day);
    for (const v of proposal) {
      const diff = Math.abs(round2(v - s.top.value));
      numbers.push(diff);
      loads.push(diff);
    }
  }
  const e1rm = refs.own?.e1rm ?? null;
  if (e1rm !== null) {
    numbers.push(e1rm);
    loads.push(e1rm);
  }
  if (refs.derived !== null) {
    numbers.push(...refs.derived.numbers, refs.derived.e1rm);
    loads.push(...refs.derived.sets.map((x) => x.value), refs.derived.e1rm);
    sets.push(...refs.derived.sets);
  }
  const last = refs.latest ?? sessions[0] ?? null;
  return { numbers, loads, sets, targets: proposal, reps: { min: slot.repsMin, max: slot.repsMax }, lastLoads: last === null ? [] : last.sets.map((x) => x.value) };
}

/** A number as written matches a value: exactly (±0.05), or the value rounded to a half, a tenth or a whole. */
function citesValue(a: number, n: number): boolean {
  if (Math.abs(a - n) < 0.051) return true;
  return [Math.round(a * 2) / 2, Math.round(a * 10) / 10, Math.round(a)].some((r) => Math.abs(r - n) < 0.001);
}

// The forms a coach note can cite a set in (§7, review r2 B1r). Each is a `load×reps` pair that must be
// a reference set (or, after an arrow, the proposal with reps in the slot's range).
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const LOAD_WORDS = String.raw`(?:\s*(?:kg|lbs?)\b)?(?:\s*(?:each|assist)\b)?`;
const RPE_PART = String.raw`(?:\s*(?:@\s*(?:RPE\s*)?|,?\s+(?:at\s+)?RPE\s*)(\d+(?:[.,]\d+)?))?`;
const ARROW = String.raw`(→|->)?\s*`;
const NO_NUM_BEFORE = String.raw`(?<![\d.,])`;
type PairForm = { re: RegExp; arrow: number; value: number; reps: number; rpe: number };
/** `100×7`, `100 x 7`, `100 kg × 7 @8`, `100*7`, `100/7`, `+20 x 6`, `30 each×8`. */
const PAIR_TIMES: PairForm = { re: new RegExp(String.raw`${ARROW}\+?${NO_NUM_BEFORE}${NUM}${LOAD_WORDS}\s*[×x*/]\s*(\d+)\b(?:\s*reps?\b)?${RPE_PART}`, 'giu'), arrow: 1, value: 2, reps: 3, rpe: 4 };
/** `100 for 7`, `100 kg for 7 reps @8`. */
const PAIR_FOR: PairForm = { re: new RegExp(String.raw`${ARROW}\+?${NO_NUM_BEFORE}${NUM}${LOAD_WORDS}\s+for\s+(\d+)\b(?:\s*reps?\b)?${RPE_PART}`, 'giu'), arrow: 1, value: 2, reps: 3, rpe: 4 };
/** `7 reps at 100`, `8 reps with 102.5 kg @8`. */
const PAIR_REPS_AT: PairForm = { re: new RegExp(String.raw`${ARROW}${NO_NUM_BEFORE}(\d+)\s*reps?\s+(?:at|with|on|of)\s+\+?${NUM}${LOAD_WORDS}${RPE_PART}`, 'giu'), arrow: 1, value: 3, reps: 2, rpe: 4 };

// "Last time" forms (review r3 B1s). They are checked on the whole note, before any pair is stripped, and
// span an arrow and a pair: the load they name must be one of the most recent session's.
const LAST_WORDS = String.raw`(?:last\s+(?:time|session|workout|week|wk)|previous(?:ly)?|each\s+time|every\s+time)`;
const PAIR_TAIL = String.raw`(?:\s*(?:[×x*/]|\s+for\s+)\s*\d+\b(?:\s*reps?\b)?)?${RPE_PART}`;
/** `100 last time`, `→ 102.5×8 last time`, `100 kg for 7 previously`, `102.5×8 each time`. */
const LOAD_LAST_TIME = new RegExp(String.raw`\+?${NO_NUM_BEFORE}${NUM}${LOAD_WORDS}${PAIR_TAIL}\s+${LAST_WORDS}\b`, 'giu');
/** `8 reps at 102.5 last time`. */
const REPS_AT_LAST_TIME = new RegExp(String.raw`${NO_NUM_BEFORE}\d+\s*reps?\s+(?:at|with|on|of)\s+\+?${NUM}${LOAD_WORDS}${RPE_PART}\s+${LAST_WORDS}\b`, 'giu');
/** `last time: 100`, `last session 100 kg`, `last time -> 102.5 for 8`, `last time: 7 reps at 100`. */
const LAST_TIME_LOAD = new RegExp(String.raw`\b(?:last\s+(?:time|session|workout|week|wk)|previous(?:ly)?)\s*:?\s*(?:(?:→|->)\s*)?(?:\d+\s*reps?\s+(?:at|with|on|of)\s+)?\+?${NUM}`, 'giu');
/** Words that say a result already happened; never next to an arrowed target (review r3 B1s). */
const PAST = /\b(?:last\s+(?:time|session|workout|week|wk)|previous(?:ly)?|each\s+time|every\s+time|did|done|was|were|hit|got|managed|lifted|before|ago)\b/iu;
/** `→ 102.5`, `-> +2.5`, `→ 12 each`: a target on its own. */
const ARROW_VALUE = new RegExp(String.raw`(?:→|->)\s*(\+)?${NUM}((?:\s*(?:kg|lbs?)\b)?(?:\s*(?:each|assist)\b)?)`, 'giu');
/** A bare number; group 1 `+`, group 3 a load word after it (`12 each`, `100 kg`). */
const BARE_NUM = /(\+\s*)?(\d+(?:[.,]\d+)?)(\s*(?:kg|lbs?|each|assist)\b)?/giu;

/** Every match of `re` passes `ok` → the text with the matches blanked; any fails → null. */
function stripChecked(text: string, re: RegExp, ok: (m: RegExpMatchArray) => boolean): string | null {
  for (const m of text.matchAll(re)) if (!ok(m)) return null;
  return text.replace(re, ' ');
}

/**
 * Whether a past-time word sits next to an arrowed target (review r3 B1s):
 * after the arrow in the same clause (`→ 102.5×8 each time`), or right
 * before it with no number of its own (`did → 102.5`, `last time -> 102.5`).
 * `100 last time → 102.5` is fine: the clause before names its own load.
 */
function pastNextToArrow(text: string): boolean {
  for (const m of text.matchAll(/→|->/gu)) {
    const at = m.index;
    const after = text.slice(at + m[0].length).split(/[,;·()→]|->/u)[0] ?? '';
    if (PAST.test(after)) return true;
    const before = text.slice(0, at).split(/[,;·()→]|->/u).pop() ?? '';
    if (PAST.test(before) && !/\d/.test(before.replace(/\blast\s+\d+\b/giu, ' '))) return true;
    if (/\blast\s*:?\s*$/iu.test(before)) return true;
  }
  return false;
}

const PRAISE = /\b(?:safe(?:ly)?|guarantee[ds]?|great|awesome|amazing|excellent|perfect|crush(?:ing)?|easy|score[sd]?)\b/i;

/**
 * `checkBasis` (§7): whether the coach's note may be shown behind `Why?`
 * as `Coach's note` (it is never the reason line, review r2 B1r). ≤ 60
 * characters; every `load×reps` pair, in any form (`A×B`, `A x B`, `A*B`,
 * `A/B`, `A for B`, `B reps at A`), is a reference set (its RPE too when
 * cited), or, after an arrow, the proposal with reps in the slot's range; a
 * load said to be `last time` (before or after it, across an arrow or a
 * pair) is one of the most recent session's; no past-time word next to an
 * arrowed target; the proposal's values appear only after an arrow, unless
 * they are a real reference load; a number written as a load (`12 each`,
 * `+2.5`, `100 kg`) is a reference load, the e1RM or a difference, never a
 * rep, RPE or day number; every other number is one it may cite (`last N`
 * with N ≤ the references listed); `1RM` or `max` only with `est.` or `≈`;
 * no praise, scores, "safe" or "guaranteed". Pure.
 */
export function checkBasis(basis: string, allowed: BasisAllowed, refCount: number): boolean {
  let t = basis.trim();
  if (t === '' || t.length > 60) return false;
  if (PRAISE.test(t)) return false;
  if (/\b1\s?rm\b|\bmax\b/i.test(t) && !/est\.|≈|~/i.test(t)) return false;
  const num = (x: string | undefined): number => Number((x ?? '').replace(',', '.'));
  const loads = allowed.loads ?? allowed.numbers;
  const targets = allowed.targets ?? [];
  const isLoad = (n: number): boolean => loads.some((a) => citesValue(a, n));
  const isTarget = (n: number): boolean => targets.some((a) => citesValue(a, n));
  // Review r3 B1s: "last time" claims first, on the whole note, so an arrow or a pair can't hide them.
  const lastLoad = (m: RegExpMatchArray): boolean => (allowed.lastLoads ?? []).some((a) => citesValue(a, num(m[1])));
  for (const re of [LOAD_LAST_TIME, REPS_AT_LAST_TIME]) for (const m of t.matchAll(re)) if (!lastLoad(m)) return false;
  for (const m of t.matchAll(LAST_TIME_LOAD)) {
    // `100 last time → 102.5`: the words claim the load before them (checked above); the arrow starts the target.
    const claimedBefore = /→|->/u.test(m[0]) && /\d/.test((t.slice(0, m.index).split(/[,;·()→]|->/u).pop() ?? '').replace(/\blast\s+\d+\b/giu, ' '));
    if (!claimedBefore && !lastLoad(m)) return false;
  }
  if (pastNextToArrow(t)) return false;
  const realSet = (value: number, reps: number, rpe: number | null): boolean => allowed.sets.some((s) => citesValue(s.value, value) && s.reps === reps && (rpe === null || (s.rpe !== null && Math.abs(s.rpe - rpe) < 0.051)));
  const target = (value: number, reps: number, rpe: number | null): boolean => rpe === null && isTarget(value) && allowed.reps !== undefined && reps >= allowed.reps.min && reps <= allowed.reps.max;
  for (const f of [PAIR_TIMES, PAIR_FOR, PAIR_REPS_AT]) {
    const r = stripChecked(t, f.re, (m) => {
      const value = num(m[f.value]);
      const reps = Number(m[f.reps]);
      const rpe = m[f.rpe] === undefined ? null : num(m[f.rpe]);
      return realSet(value, reps, rpe) || (m[f.arrow] !== undefined && target(value, reps, rpe));
    });
    if (r === null) return false;
    t = r;
  }
  // The words of a checked "last time" claim carry no number of their own now.
  t = t.replace(new RegExp(String.raw`\b${LAST_WORDS}\b`, 'giu'), ' ');
  const arrowed = stripChecked(t, ARROW_VALUE, (m) => {
    const n = num(m[2]);
    const asLoad = m[1] !== undefined || (m[3] ?? '').trim() !== '';
    return isTarget(n) || isLoad(n) || (!asLoad && allowed.numbers.some((a) => citesValue(a, n)));
  });
  if (arrowed === null) return false;
  t = arrowed;
  const lastN = /\blast\s+(\d+)(?![.,]?\d)\b(?!\s*(?:kg|lb|×|x\b|each|assist))/gi;
  for (const m of t.matchAll(lastN)) if (Number(m[1]) > refCount) return false;
  const rest = t.replace(lastN, ' ').replace(/\b1\s?rm\b/gi, ' ').replace(/\bRPE\b/gi, ' ');
  for (const m of rest.matchAll(BARE_NUM)) {
    const n = num(m[2]);
    const asLoad = m[1] !== undefined || m[3] !== undefined;
    // Review r3 B1s: a number written as a load, or equal to the proposal, must be a real load (not a rep, RPE or day).
    if ((asLoad || targets.some((a) => Math.abs(a - n) < 0.051)) ? !isLoad(n) : !allowed.numbers.some((a) => citesValue(a, n))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Slot consistency (BD6 step 5) and the plan-time re-check (B5–B7)

/**
 * `checkSlotLoads` (BD6 step 5): the top set is never easier than the
 * back-offs; if it is, the back-offs drop to the top set's load.
 */
export function checkSlotLoads(top: LoadCheck | null, working: LoadCheck): LoadCheck {
  if (top === null || top.load === null || working.load === null) return working;
  const dir = loadDirection(working.load.convention);
  if (top.load.unit !== working.load.unit || top.load.convention !== working.load.convention) return working;
  if (!harderThan(working.load.value, top.load.value, dir)) return working;
  // B2: the back-offs now carry the top set's load, so they carry its reason line too (the coach's own words go under NOT USED).
  return { ...working, load: { ...top.load }, basis: top.basis, coachNote: null, notUsed: working.coachNote ?? working.notUsed, notes: [...working.notes, 'back-offs ≤ top set'] };
}

/** A coach load as the draft stores it, per set template (§8.2 `DraftPlan` slots). */
export interface StoredLoad {
  load: Load | null;
  source: LoadSource;
  /** Code's reason line at build time (drafts before r3: the coach's text when `basisFromCoach`). */
  basis: string | null;
  /** Drafts before r3 only: `basis` is the coach's text. */
  basisFromCoach: boolean;
  /** The coach's note that passed `checkBasis` (`Why?` → `Coach's note`); absent in drafts before r3. */
  coachNote?: string | null | undefined;
  held: boolean;
  notes: readonly string[];
  notUsed: string | null;
}

/** The coach's note of a stored load, whichever draft version wrote it. */
export function storedCoachNote(stored: Pick<StoredLoad, 'basis' | 'basisFromCoach' | 'coachNote'>): string | null {
  return stored.coachNote ?? (stored.basisFromCoach ? stored.basis : null);
}

/** Newer sessions searched for by history version (more since a build is treated as a changed history). */
const MAX_NEW_SESSIONS = 20;

/**
 * The comparable sessions not seen when the load was checked (review B4).
 * With the stored `checkedHistoryVersion`: `[]` when the history is the
 * same; the newest k sessions when the rest is exactly what was checked
 * (whatever their start times: a workout started before the build and
 * logged after it counts); `null` when older history changed (a correction,
 * an import), so the whole history is checked again. Without a stored
 * version (older drafts): sessions that started after the build.
 */
export function sessionsSinceCheck(all: readonly RefSession[], checkedHistoryVersion: string | null | undefined, builtAtUtc: string): RefSession[] | null {
  if (checkedHistoryVersion === null || checkedHistoryVersion === undefined) {
    const builtMs = toMs(builtAtUtc);
    return all.filter((s) => toMs(s.performedAtUtc) > builtMs);
  }
  if (historyVersionOf(all) === checkedHistoryVersion) return [];
  for (let k = 1; k <= Math.min(all.length, MAX_NEW_SESSIONS); k += 1) if (historyVersionOf(all.slice(k)) === checkedHistoryVersion) return all.slice(0, k);
  return null;
}

/** The bands from one session alone (`recheckDraftLoad`); null when it is outside the window. */
function newestAloneRefs(refsNow: LoadReferences, newest: RefSession, nowMs: number): LoadReferences | null {
  const machine = refsNow.equipment !== null && MACHINE_KINDS.has(refsNow.equipment.kind);
  const own = ownReferenceOf([newest], refsNow.convention, nowMs, machine && newest.source === 'fitnotes');
  return own === null ? null : { ...refsNow, own, derived: null };
}

/** The lighter of two re-checks: a fallback (`rule`, `none`) wins; else the easier load (`loadDirection`); `a` on a tie. */
function lighterCheck(a: LoadCheck, b: LoadCheck | null, dir: LoadDirection): LoadCheck {
  if (b === null || a.load === null) return a;
  if (b.load === null) return b;
  if (a.load.unit !== b.load.unit) return a;
  return harderThan(a.load.value, b.load.value, dir) ? b : a;
}

/**
 * `recheckDraftLoad` (§8.2; B5–B7; review r2 B4r, S1r). Pure, offline. A
 * stored coach load at plan time:
 * - the item now mapped differs in kind, convention or bar from `checkedOn`
 *   → `Rule` (`different equipment here · rule used`); only the unit → converted;
 * - comparable sessions not seen at build time (`sessionsSinceCheck`, by
 *   history version) → bands from **the newest of them alone**; in band
 *   unchanged, above the cap clamped toward easier (`capped at 95 · newer
 *   session 9 Oct`), rejected → `Rule`;
 * - older history changed (an import, a correction) → the full check **and**
 *   the newest session alone, whichever gives the lighter load;
 * - pain since (a flag or session pain) → held as at build time;
 * - always re-fitted to the item (never past its max).
 * The reason line is code's, from the references the result came from. A
 * load that changes moves the stored coach note under `Why?` → `NOT USED`.
 */
export function recheckDraftLoad(
  stored: StoredLoad,
  slot: LoadSlot,
  refsNow: LoadReferences,
  ctx: { pain: { text: string } | null; checkedOn: CheckedOn | null; builtAtUtc: string; nowMs: number; checkedHistoryVersion?: string | null },
): LoadCheck {
  const note = storedCoachNote(stored);
  const lost = note ?? stored.notUsed;
  if (stored.load === null || (stored.source !== 'coach' && stored.source !== 'coach_est')) {
    return { load: null, source: stored.source === 'none' ? 'none' : 'rule', held: stored.held, notes: [...stored.notes], basis: stored.basisFromCoach ? null : stored.basis, coachNote: null, notUsed: lost };
  }
  const now = checkedOnOf(refsNow);
  const was = ctx.checkedOn;
  if (was === null || now === null || was.kind !== now.kind || was.convention !== now.convention || (was.barKg ?? -1) !== (now.barKg ?? -1)) {
    return { load: null, source: 'rule', held: false, notes: ['different equipment here · rule used'], basis: null, coachNote: null, notUsed: lost };
  }
  const since = sessionsSinceCheck(refsNow.all, ctx.checkedHistoryVersion, ctx.builtAtUtc);
  // The coach's words were checked at build time; the re-check judges the load only.
  const p: LoadProposalIn = { value: stored.load.value, unit: stored.load.unit, convention: stored.load.convention, basis: null };
  const run = (refs: LoadReferences, extra: Pick<LoadCheckContext, 'capReason' | 'bandsChecked'>): LoadCheck => checkProposedLoad(p, slot, refs, { pain: ctx.pain, askedHeavier: false, ...extra });
  let r: LoadCheck;
  if (since === null) {
    // S1r: older history changed: the full check, and the newest session alone; the lighter wins.
    const full = run(refsNow, { capReason: 'history changed' });
    const newest = refsNow.all[0];
    const alone = newest === undefined ? null : newestAloneRefs(refsNow, newest, ctx.nowMs);
    r = lighterCheck(full, alone === null ? null : run(alone, { capReason: 'history changed' }), refsNow.direction);
  } else if (since[0] !== undefined) {
    // B4r: the newest unseen session alone, so a newest RPE 10 rep miss isn't diluted by others.
    const newest = since[0];
    const alone = newestAloneRefs(refsNow, newest, ctx.nowMs);
    r = alone === null ? run(refsNow, { bandsChecked: true }) : run(alone, { capReason: `newer session ${dayMonthText(newest.performedAtUtc, newest.tz)}` });
  } else {
    r = run(refsNow, { bandsChecked: true });
  }
  const unitNote = r.notes.filter((n) => n.endsWith('converted'));
  const fresh = r.notes.filter((n) => !n.endsWith('converted'));
  if (r.source === 'rule' || r.source === 'none') return { ...r, basis: null, coachNote: null, notUsed: lost, notes: [...stored.notes, ...fresh] };
  // The stored label stays (an estimate stays `est.` unless a newer session of his own now backs it).
  const source: LoadSource = since !== null && since.length > 0 ? r.source : stored.source;
  const changed = r.load === null || r.load.unit !== stored.load.unit || Math.abs(r.load.value - stored.load.value) > EPS;
  // Same history, same load, same hold: the build's own code line stands (it knows a build-time cap).
  const sameLine = !changed && since !== null && since.length === 0 && !stored.basisFromCoach && stored.basis !== null && r.held === stored.held;
  return { ...r, basis: sameLine ? stored.basis : r.basis, coachNote: changed ? null : note, notUsed: changed ? lost : stored.notUsed, source, held: r.held || stored.held, notes: [...stored.notes, ...unitNote, ...fresh] };
}

/** Whether a load is the harder of two in its direction (for tests and callers). */
export function isHarderLoad(a: number, b: number, convention: LoadConvention): boolean {
  return harderThan(a, b, loadDirection(convention));
}
