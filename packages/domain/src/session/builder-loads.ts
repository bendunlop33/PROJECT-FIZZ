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
  /** The coach's basis when it passed `checkBasis`, else code's. Null for `rule`. */
  basis: string | null;
  basisFromCoach: boolean;
  /** A coach basis that failed `checkBasis` (`Why?` → `NOT USED`). */
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
        capNote: (v) => `held at ${noteLoad(v, refs.convention)} · ${stepWord(Math.abs(stepIndex(byDifficulty, v) - at))} from last ${lText}`,
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
  const out = (o: Partial<LoadCheck> & Pick<LoadCheck, 'source'>): LoadCheck => ({ load: null, held: false, basis: null, basisFromCoach: false, notUsed: null, ...o, notes: [...notes, ...(o.notes ?? [])] });
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
  const allowed = basisNumbers(refs, slot, [p.value, v, final]);
  const ok = p.basis !== null && checkBasis(p.basis, allowed, refs.own?.sessions.length ?? (refs.latest === null ? 0 : 1));
  const basis = ok ? (p.basis as string) : codeBasis(refs, est);
  return out({ load: r.load, source, held, basis, basisFromCoach: ok, notUsed: ok ? null : p.basis });
}

/** Code's own basis when the coach's isn't usable (§7): `last 100 × 7 @8`, `est. from chest press 60×10`, `est. · first time`. */
export function codeBasis(refs: LoadReferences, est: boolean): string {
  const s = refs.own?.sessions[0] ?? null;
  if (s !== null) {
    const t = `last ${formatNumber(s.top.value)}×${String(s.top.reps)}${s.top.rpe === null ? '' : ` @${formatNumber(s.top.rpe)}`}${s.source === 'fitnotes' ? ' (FitNotes)' : ''}`;
    return est ? `est. · ${t}` : t;
  }
  if (refs.derived !== null) return `est. from ${refs.derived.text}`;
  return 'est. · first time';
}

/** Numbers a basis may cite (§7 basis rules): references, the proposal's values, the slot's reps and RPE, and their differences. */
function basisNumbers(refs: LoadReferences, slot: LoadSlot, proposal: readonly number[]): number[] {
  const out: number[] = [slot.repsMin, slot.repsMax, slot.targetRpe, ...proposal];
  const sessions = refs.own?.sessions ?? (refs.latest === null ? [] : [refs.latest]);
  for (const s of sessions) {
    for (const x of s.sets) out.push(x.value, x.reps, ...(x.rpe === null ? [] : [x.rpe]));
    const day = Number(dayMonthText(s.performedAtUtc, s.tz).split(/\s/)[0]);
    if (Number.isFinite(day)) out.push(day);
    for (const v of proposal) out.push(Math.abs(round2(v - s.top.value)));
  }
  const e1rm = refs.own?.e1rm ?? null;
  if (e1rm !== null) out.push(e1rm);
  if (refs.derived !== null) out.push(...refs.derived.numbers, refs.derived.e1rm);
  return out;
}

const PRAISE = /\b(?:safe(?:ly)?|guarantee[ds]?|great|awesome|amazing|excellent|perfect|crush(?:ing)?|easy|score[sd]?)\b/i;

/**
 * `checkBasis` (§7): ≤ 60 characters; every number in it is one it may cite
 * (`allowed`; `last N` with N ≤ the references listed); `1RM` or `max`
 * only with `est.` or `≈`; no praise, scores, "safe" or "guaranteed".
 * Forms are normalised first: `100×7`, `100 x 7`, `100 kg × 7`, `100kg x7`,
 * `@8`, `@ RPE 8`. Pure.
 */
export function checkBasis(basis: string, allowed: readonly number[], refCount: number): boolean {
  const t = basis.trim();
  if (t === '' || t.length > 60) return false;
  if (PRAISE.test(t)) return false;
  if (/\b1\s?rm\b|\bmax\b/i.test(t) && !/est\.|≈|~/i.test(t)) return false;
  const lastN = /\blast\s+(\d+)\b(?!\s*(?:kg|lb|×|x\b))/gi;
  for (const m of t.matchAll(lastN)) if (Number(m[1]) > refCount) return false;
  const rest = t.replace(lastN, ' ').replace(/\b1\s?rm\b/gi, ' ').replace(/\bRPE\b/gi, ' ');
  for (const m of rest.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = Number(m[0].replace(',', '.'));
    if (!allowed.some((a) => Math.abs(a - n) < 0.051 || Math.abs(Math.round(a * 2) / 2 - n) < 0.051 || Math.abs(Math.round(a) - n) < 0.51)) return false;
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
  return { ...working, load: { ...top.load }, notes: [...working.notes, 'back-offs ≤ top set'] };
}

/** A coach load as the draft stores it, per set template (§8.2 `DraftPlan` slots). */
export interface StoredLoad {
  load: Load | null;
  source: LoadSource;
  basis: string | null;
  basisFromCoach: boolean;
  held: boolean;
  notes: readonly string[];
  notUsed: string | null;
}

/**
 * `recheckDraftLoad` (§8.2; B5–B7). Pure, offline. A stored coach load at
 * plan time:
 * - the item now mapped differs in kind, convention or bar from `checkedOn`
 *   → `Rule` (`different equipment here · rule used`); only the unit → converted;
 * - a comparable session newer than the draft → bands from that session
 *   alone; in band unchanged, above the cap clamped toward easier
 *   (`capped at 95 · newer session 9 Oct`), rejected → `Rule`;
 * - pain since (a flag or session pain) → held as at build time;
 * - always re-fitted to the item (never past its max).
 */
export function recheckDraftLoad(
  stored: StoredLoad,
  slot: LoadSlot,
  refsNow: LoadReferences,
  ctx: { pain: { text: string } | null; checkedOn: CheckedOn | null; builtAtUtc: string; nowMs: number },
): LoadCheck {
  const keep = { basis: stored.basis, basisFromCoach: stored.basisFromCoach, notUsed: stored.notUsed };
  if (stored.load === null || (stored.source !== 'coach' && stored.source !== 'coach_est')) return { load: null, source: stored.source === 'none' ? 'none' : 'rule', held: stored.held, notes: [...stored.notes], ...keep };
  const now = checkedOnOf(refsNow);
  const was = ctx.checkedOn;
  if (was === null || now === null || was.kind !== now.kind || was.convention !== now.convention || (was.barKg ?? -1) !== (now.barKg ?? -1)) {
    return { load: null, source: 'rule', held: false, notes: ['different equipment here · rule used'], ...keep };
  }
  const builtMs = toMs(ctx.builtAtUtc);
  const newer = refsNow.latest !== null && toMs(refsNow.latest.performedAtUtc) > builtMs ? refsNow.latest : null;
  const p: LoadProposalIn = { value: stored.load.value, unit: stored.load.unit, convention: stored.load.convention, basis: stored.basis };
  let refs: LoadReferences = refsNow;
  let capReason: string | undefined;
  if (newer !== null) {
    // B5: the bands from the newest session alone.
    const machine = refsNow.equipment !== null && MACHINE_KINDS.has(refsNow.equipment.kind);
    const own = ownReferenceOf([newer], refsNow.convention, ctx.nowMs, machine && newer.source === 'fitnotes');
    refs = { ...refsNow, own, derived: null };
    capReason = `newer session ${dayMonthText(newer.performedAtUtc, newer.tz)}`;
  }
  const r = checkProposedLoad(p, slot, refs, { pain: ctx.pain, askedHeavier: false, ...(capReason === undefined ? { bandsChecked: true } : { capReason }) });
  const unitNote = r.notes.filter((n) => n.endsWith('converted'));
  const fresh = r.notes.filter((n) => !n.endsWith('converted'));
  if (r.source === 'rule' || r.source === 'none') return { ...r, ...keep, notes: [...stored.notes, ...fresh] };
  // The stored label stays (an estimate stays `est.` unless a newer session of his own now backs it).
  const source: LoadSource = newer !== null ? r.source : stored.source;
  return { ...r, ...keep, source, held: r.held || stored.held, notes: [...stored.notes, ...unitNote, ...fresh] };
}

/** Whether a load is the harder of two in its direction (for tests and callers). */
export function isHarderLoad(a: number, b: number, convention: LoadConvention): boolean {
  return harderThan(a, b, loadDirection(convention));
}
