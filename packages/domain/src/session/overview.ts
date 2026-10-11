import type {
  EquipmentInstance,
  Exercise,
  Load,
  LoadConvention,
  PainFlag,
  RepRange,
  SessionAggregate,
  SessionExercise,
  SetExclusion,
  SetType,
  WeightUnit,
  WorkoutSet,
  ZonedTimestamp,
} from '@fizz/schemas';
import { clockText } from '../calendar';
import { dayMonthText, formatDuration, formatNumber, NBSP, repRangeText } from '../display';
import { buildPlateSetup, loadDirection } from '../equipment';
import { isSetCountable } from '../exclusions';
import { painFlagCovering, PAIN_AREA_WORD } from '../pain-flags';
import { deriveId, stableStringify } from '../stable';
import { buildStepCard } from '../step-card';
import { toMs } from '../time';
import { convertMass, toScaled } from '../units';
import type { WriteFence } from '../ports';
import type { SetFit } from './create';
import { estimateRemainingDuration } from './duration';
import { muscleWords } from './first-run';

/**
 * The Workout overview (workout-overview.md): the one page before the first
 * set. Pure. Every number on the page comes from here, built from the same
 * dry run Start uses (`planRoutineStart` / `startWorkoutFromSession` with
 * `preview: true`), so what the page shows is what Start creates (OV3). The
 * screen only formats dates and lays it out; it computes no target, marker,
 * grouping or duration (CLAUDE.md conventions).
 *
 * - Change markers (§4): one word per row against the last comparable
 *   session (same equipment kind, bar and load convention; never an imported
 *   workout, ADR 0016), kg/lb normalised.
 * - `previewKey` (§7): a stable hash of every input that can change a
 *   target, so a Start against a page that went out of date creates nothing.
 * - Actual sets (`LAST`, `BEST`) are what Ben did, never an estimate (rule 6);
 *   estimates (`TIME`, `DONE BY`) always carry `≈` in the screen.
 */

/** Set types that count as working sets on this page (everything but warm-ups). */
const isWorking = (t: SetType): boolean => t !== 'warmup';
const live = (s: WorkoutSet): boolean => s.status !== 'deleted';

// ---------------------------------------------------------------------------
// Comparable history

/** What a comparison needs to know about a piece of equipment: its kind, and for a bar, its mass. */
export interface EquipmentKey {
  kind: EquipmentInstance['kind'];
  /** Barbells only: a different bar makes totals incomparable. */
  barMass: { value: number; unit: WeightUnit } | null;
}

export function equipmentKey(eq: EquipmentInstance | null | undefined): EquipmentKey | null {
  if (!eq) return null;
  return { kind: eq.kind, barMass: eq.kind === 'barbell' ? { value: eq.barMass, unit: eq.unit } : null };
}

/** Same kind (and, for barbells, the same bar mass); no equipment matches only no equipment. */
export function sameEquipmentKind(a: EquipmentKey | null, b: EquipmentKey | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.barMass === null || b.barMass === null) return a.barMass === b.barMass;
  return toScaled(convertMass(a.barMass, 'kg').value) === toScaled(convertMass(b.barMass, 'kg').value);
}

export interface PastTarget {
  setType: SetType;
  load: Load | null;
  reps: RepRange | null;
  durationS: number | null;
}

export interface PastActual {
  setType: SetType;
  load: Load | null;
  reps: number | null;
  durationS: number | null;
  exclusions?: readonly SetExclusion[];
}

/** One exercise as it was in one finished workout. */
export interface PastExercise {
  sessionId: string;
  performedAt: ZonedTimestamp;
  imported: boolean;
  equipment: EquipmentKey | null;
  convention: LoadConvention;
  unit: WeightUnit;
  /** Working sets that had a target, in order (deleted rows and other-side companions left out). */
  targets: PastTarget[];
  /** Completed working sets, in order (a left/right pair counts once). */
  actuals: PastActual[];
}

const hasTarget = (s: WorkoutSet): boolean => s.planned.load !== null || s.planned.reps !== null || s.planned.durationS !== null;

/**
 * Every appearance of `exerciseId` in finished workouts, newest first. One
 * entry per workout exercise row, so an exercise done on two machines in one
 * workout gives two entries.
 */
export function pastExercisesOf(sessions: readonly SessionAggregate[], exerciseId: string): PastExercise[] {
  const out: PastExercise[] = [];
  for (const a of sessions) {
    if (a.session.status !== 'finished') continue;
    for (const ex of [...a.exercises].sort((x, y) => y.order - x.order)) {
      if (ex.exerciseId !== exerciseId) continue;
      const own = a.sets.filter((s) => s.sessionExerciseId === ex.id && live(s) && s.pairedWithSetId === null && isWorking(s.setType)).sort((x, y) => x.index - y.index);
      const eq = ex.equipmentId === null ? null : (a.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
      out.push({
        sessionId: a.session.id,
        performedAt: a.session.startedAt,
        imported: a.session.source === 'import',
        equipment: equipmentKey(eq),
        convention: ex.loadConvention,
        unit: ex.unit,
        targets: own.filter(hasTarget).map((s) => ({ setType: s.setType, load: s.planned.load, reps: s.planned.reps, durationS: s.planned.durationS })),
        actuals: own.flatMap((s) =>
          s.status === 'completed' && s.actual !== null
            ? [{ setType: s.setType, load: s.actual.load, reps: s.actual.reps, durationS: s.actual.durationS, ...(s.exclusions && s.exclusions.length > 0 ? { exclusions: s.exclusions } : {}) }]
            : [],
        ),
      });
    }
  }
  return out.sort((x, y) => toMs(y.performedAt.utc) - toMs(x.performedAt.utc));
}

export interface PlannedKey {
  /**
   * Today's equipment. `any`: the routine's equipment isn't at this gym, so
   * there's none to match; last time still counts (the row reads `NO LOAD`).
   */
  equipment: EquipmentKey | null | 'any';
  convention: LoadConvention;
}

/** Comparable (§4, ADR 0016): not imported, same equipment kind and bar, same load convention, and something was planned or done. */
export function isComparable(planned: PlannedKey, past: PastExercise): boolean {
  const kindOk = planned.equipment === 'any' || sameEquipmentKind(planned.equipment, past.equipment);
  return !past.imported && past.convention === planned.convention && kindOk && (past.targets.length > 0 || past.actuals.length > 0);
}

/** The newest comparable appearance, or null. `pasts`: newest first. */
export function lastComparable(planned: PlannedKey, pasts: readonly PastExercise[]): PastExercise | null {
  return pasts.find((p) => isComparable(planned, p)) ?? null;
}

// ---------------------------------------------------------------------------
// Change markers (§4)

/** This preview's first working set and the working set count. */
export interface PlannedFirst {
  load: Load | null;
  reps: RepRange | null;
  durationS: number | null;
  workingSets: number;
  convention: LoadConvention;
}

export type ChangeMarkerKind = 'held' | 'new' | 'no_load' | 'up' | 'down' | 'reps_up' | 'reps_down' | 'sets_up' | 'sets_down' | 'same';

export type ChangeDelta =
  /** `from` is last time's load in today's unit (converted when it was in another unit). */
  | { kind: 'load'; from: Load; to: Load; harder: boolean }
  | { kind: 'reps'; by: number }
  | { kind: 'sets'; by: number };

export interface ChangeMarker {
  kind: ChangeMarkerKind;
  /** The size of the difference against last time (the panel's `CHANGE`), when there is one. Also given for `HELD`. */
  delta: ChangeDelta | null;
  /** When the compared workout was done; null for `NEW`. */
  basis: ZonedTimestamp | null;
}

/** Last time's load to compare with: its first working target's, else its heaviest counted working set (a workout with no targets). */
function referenceLoad(past: PastExercise): Load | null {
  const first = past.targets[0];
  if (first?.load) return first.load;
  const loads = past.actuals.filter((s) => isSetCountable(s, 'comparison')).map((s) => s.load).filter((l): l is Load => l !== null && l.convention !== 'bodyweight');
  const top = loads[0];
  if (top === undefined) return null;
  const harder = loadDirection(top.convention) === 'resistance' ? 1 : -1;
  return loads.reduce((best, l) => (harder * (convertMass(l, 'kg').value - convertMass(best, 'kg').value) > 0 ? l : best), top);
}

/** Loads differ after normalising units. Same unit: exact. Another unit: within 1% counts as the same (a converted load is never exact). */
function compareLoads(planned: Load, ref: Load): number {
  if (planned.unit === ref.unit) return Math.sign(toScaled(planned.value) - toScaled(ref.value));
  const a = convertMass(planned, 'kg').value;
  const b = convertMass(ref, 'kg').value;
  return Math.abs(a - b) <= 0.01 * Math.max(a, b) ? 0 : Math.sign(a - b);
}

/** The comparison alone, before pain, `NEW` and `NO LOAD` (rows 4–7 of §4). */
export function compareWithPast(planned: PlannedFirst, past: PastExercise): { kind: Extract<ChangeMarkerKind, 'up' | 'down' | 'reps_up' | 'reps_down' | 'sets_up' | 'sets_down' | 'same'>; delta: ChangeDelta | null } {
  const ref = referenceLoad(past);
  if (planned.load !== null && planned.load.convention !== 'bodyweight' && ref !== null) {
    const cmp = compareLoads(planned.load, ref);
    if (cmp !== 0) {
      const from = ref.unit === planned.load.unit ? ref : { value: Math.round(convertMass(ref, planned.load.unit).value * 100) / 100, unit: planned.load.unit, convention: ref.convention };
      const harder = loadDirection(planned.convention) === 'resistance' ? cmp > 0 : cmp < 0;
      return { kind: harder ? 'up' : 'down', delta: { kind: 'load', from, to: planned.load, harder } };
    }
  }
  // Reps and sets are compared only with last time's own targets (a workout with none compares load only).
  const first = past.targets[0];
  if (first === undefined) return { kind: 'same', delta: null };
  if (planned.reps !== null && first.reps !== null && planned.reps.min !== first.reps.min) {
    const by = planned.reps.min - first.reps.min;
    return { kind: by > 0 ? 'reps_up' : 'reps_down', delta: { kind: 'reps', by } };
  }
  if (planned.workingSets !== past.targets.length) {
    const by = planned.workingSets - past.targets.length;
    return { kind: by > 0 ? 'sets_up' : 'sets_down', delta: { kind: 'sets', by } };
  }
  return { kind: 'same', delta: null };
}

/**
 * `targetChangeMarker` (§4): the first rule that matches.
 * 1 `HELD` an active pain flag covers the exercise; 2 `NEW` no comparable
 * session; 3 `NO LOAD` the first working set's load was dropped here;
 * 4 `UP`/`DOWN` the working load differs (assisted: less assistance is up;
 * a cap or rounding that lands lower is down); 5 `REPS` the rep target's
 * lower bound differs; 6 `SETS` the working set count differs; 7 `SAME`.
 */
export function targetChangeMarker(planned: PlannedFirst, comparable: PastExercise | null, painFlag: Pick<PainFlag, 'id'> | null, fit: SetFit | null): ChangeMarker {
  const compared = comparable === null ? null : compareWithPast(planned, comparable);
  const basis = comparable?.performedAt ?? null;
  if (painFlag !== null) return { kind: 'held', delta: compared?.delta ?? null, basis };
  if (comparable === null || compared === null) return { kind: 'new', delta: null, basis: null };
  if (fit?.kind === 'dropped') return { kind: 'no_load', delta: null, basis };
  return { kind: compared.kind, delta: compared.delta, basis };
}

export interface MarkerWords {
  /** Shown in tracked caps: `Up`, `Reps`, `No load`. */
  word: string;
  glyph: 'up' | 'down' | 'warning' | null;
  /** `warning`: `status.warning` with its icon (HELD, NO LOAD). Never `status.done`, `status.danger` or the accent. */
  tone: 'warning' | 'secondary';
}

export function markerWords(kind: ChangeMarkerKind): MarkerWords {
  switch (kind) {
    case 'held':
      return { word: 'Held', glyph: 'warning', tone: 'warning' };
    case 'new':
      return { word: 'New', glyph: null, tone: 'secondary' };
    case 'no_load':
      return { word: 'No load', glyph: 'warning', tone: 'warning' };
    case 'up':
      return { word: 'Up', glyph: 'up', tone: 'secondary' };
    case 'down':
      return { word: 'Down', glyph: 'down', tone: 'secondary' };
    case 'reps_up':
      return { word: 'Reps', glyph: 'up', tone: 'secondary' };
    case 'reps_down':
      return { word: 'Reps', glyph: 'down', tone: 'secondary' };
    case 'sets_up':
      return { word: 'Sets', glyph: 'up', tone: 'secondary' };
    case 'sets_down':
      return { word: 'Sets', glyph: 'down', tone: 'secondary' };
    case 'same':
      return { word: 'Same', glyph: null, tone: 'secondary' };
  }
}

const spokenUnit = (u: WeightUnit, n: number): string => (u === 'kg' ? (n === 1 ? 'kilogram' : 'kilograms') : n === 1 ? 'pound' : 'pounds');
const SPOKEN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

function spokenDate(at: ZonedTimestamp): string {
  const [day, month] = dayMonthText(at.utc, at.tz).split(NBSP);
  const idx = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month ?? '');
  return `${day ?? ''} ${SPOKEN_MONTHS[idx] ?? month ?? ''}`.trim();
}

/** The panel's `CHANGE` value: `↑ 2.5 kg · vs 1 Oct`, `↓ 2 kg each · vs 1 Oct`, `↑ 1 rep`, `↓ 1 set`. Null when nothing differs. */
export function changeText(m: ChangeMarker): string | null {
  const d = m.delta;
  if (d === null) return null;
  const vs = m.basis === null ? '' : ` · vs ${dayMonthText(m.basis.utc, m.basis.tz)}`;
  if (d.kind === 'load') {
    const amount = Math.round(Math.abs(d.to.value - d.from.value) * 100) / 100;
    const tail = d.to.convention === 'per_hand' ? `${NBSP}each` : d.to.convention === 'assistance' ? ` ${d.harder ? 'less' : 'more'} assistance` : '';
    return `${d.harder ? '↑' : '↓'} ${formatNumber(amount)}${NBSP}${d.to.unit}${tail}${vs}`;
  }
  const n = Math.abs(d.by);
  const word = d.kind === 'reps' ? (n === 1 ? 'rep' : 'reps') : n === 1 ? 'set' : 'sets';
  return `${d.by > 0 ? '↑' : '↓'} ${String(n)} ${word}${vs}`;
}

/** VoiceOver: `load up 2.5 kilograms from 1 October`, `held, pain flag`, `new`. */
export function markerSpoken(m: ChangeMarker): string {
  switch (m.kind) {
    case 'held':
      return 'held, pain flag';
    case 'new':
      return 'new';
    case 'no_load':
      return 'no load target here';
    case 'same':
      return 'same as last time';
    case 'up':
    case 'down':
    case 'reps_up':
    case 'reps_down':
    case 'sets_up':
    case 'sets_down':
      break;
  }
  const from = m.basis === null ? '' : ` from ${spokenDate(m.basis)}`;
  const d = m.delta;
  if (d?.kind === 'load') {
    const amount = Math.round(Math.abs(d.to.value - d.from.value) * 100) / 100;
    const each = d.to.convention === 'per_hand' ? ' each' : '';
    const assist = d.to.convention === 'assistance' ? (d.harder ? ' less assistance' : ' more assistance') : '';
    return `load ${d.harder ? 'up' : 'down'} ${formatNumber(amount)} ${spokenUnit(d.to.unit, amount)}${each}${assist}${from}`;
  }
  if (d?.kind === 'reps' || d?.kind === 'sets') {
    const n = Math.abs(d.by);
    const what = d.kind === 'reps' ? (n === 1 ? 'rep' : 'reps') : n === 1 ? 'set' : 'sets';
    return `${d.by > 0 ? 'up' : 'down'} ${String(n)} ${what}${from}`;
  }
  return markerWords(m.kind).word.toLowerCase();
}

// ---------------------------------------------------------------------------
// Load cell

export interface LoadCell {
  /** `100`, `32`, `−20`, `+10`, `BW`, `—`. */
  value: string;
  /** `kg`, `kg each`, `lb`; null for `BW` and `—`. */
  unit: string | null;
  /** VoiceOver: `target 100 kilograms`, `20 kilograms of assistance`. */
  spoken: string;
  /** `—`: no load target. */
  none: boolean;
}

/** The TARGET column (§3.7): `100 kg` · `32 kg each` · `25 kg` (stack) · `−20 kg` (assisted) · `BW` / `+10 kg`. */
export function loadCell(load: Load | null, convention: LoadConvention, equipmentKind: EquipmentInstance['kind'] | null, dropped: boolean): LoadCell {
  if (!dropped && (convention === 'bodyweight' || load?.convention === 'bodyweight' || (load === null && convention === 'added' && equipmentKind !== 'plate_loaded_machine'))) {
    return { value: 'BW', unit: null, spoken: 'target bodyweight', none: false };
  }
  if (load === null) return { value: '—', unit: null, spoken: 'no load target', none: true };
  const n = formatNumber(load.value);
  const u = spokenUnit(load.unit, load.value);
  switch (load.convention) {
    case 'total':
    case 'stack':
      return { value: n, unit: load.unit, spoken: `target ${n} ${u}`, none: false };
    case 'per_hand':
      return { value: n, unit: `${load.unit} each`, spoken: `target ${n} ${u} each`, none: false };
    case 'assistance':
      return { value: `−${n}`, unit: load.unit, spoken: `target ${n} ${u} of assistance`, none: false };
    case 'added':
      if (equipmentKind === 'plate_loaded_machine') return { value: n, unit: `${load.unit} plates`, spoken: `target ${n} ${u} of plates`, none: false };
      return load.value === 0 ? { value: 'BW', unit: null, spoken: 'target bodyweight', none: false } : { value: `+${n}`, unit: load.unit, spoken: `target bodyweight plus ${n} ${u}`, none: false };
    case 'bodyweight':
      return { value: 'BW', unit: null, spoken: 'target bodyweight', none: false };
  }
}

// ---------------------------------------------------------------------------
// Rows

/** `3 × 6–8`, `3 × 0:45`, `1 × 3–5 + 2 × 6–8`; `each side` for unilateral exercises. */
export function setsDetail(working: readonly Pick<WorkoutSet, 'planned'>[], unilateral: boolean): string {
  const parts: { text: string; n: number }[] = [];
  for (const s of working) {
    const text = s.planned.reps !== null ? repRangeText(s.planned.reps) : s.planned.durationS !== null ? formatDuration(s.planned.durationS) : '—';
    const last = parts.at(-1);
    if (last?.text === text) last.n += 1;
    else parts.push({ text, n: 1 });
  }
  const body = parts.map((p) => `${String(p.n)}${NBSP}×${NBSP}${p.text}`).join(' + ');
  return unilateral && body !== '' ? `${body} each side` : body;
}

export interface PanelLine {
  key: 'change' | 'last' | 'warmup' | 'plates' | 'best' | 'rounded' | 'gym' | 'flag';
  label: string;
  value: string;
  tone: 'normal' | 'warning';
}

export interface OverviewRow {
  sessionExerciseId: string;
  exerciseId: string;
  /** 1-based position on the page. */
  index: number;
  /** `01`. */
  indexText: string;
  name: string;
  /** `3 × 6–8 · 3 warm-ups`. */
  detail: string;
  /** The warm-up fragment on its own (dropped first at large text sizes). */
  warmups: string | null;
  marker: ChangeMarker & MarkerWords;
  load: LoadCell;
  /** The snap changed the target here (rounded, capped or converted): the info glyph. */
  rounded: boolean;
  panel: PanelLine[];
  /** The active pain flag on the movement (panel `Still hurts?` when `checkDue`). */
  painFlag: { id: string; version: number; checkDue: boolean } | null;
  /** The load target was dropped because this gym lacks the equipment (`Edit gym`). */
  missingEquipment: string | null;
  /** The first pending working set: `Why?` explains it. */
  firstSetId: string | null;
  /** Superset partners' names, for VoiceOver (`Superset with Triceps pushdown`). */
  supersetWith: string[];
  accessibilityLabel: string;
}

export type OverviewGroup = { kind: 'single'; row: OverviewRow } | { kind: 'superset'; rows: OverviewRow[] };

export type OverviewBasis =
  | { kind: 'after'; routineName: string; at: ZonedTimestamp }
  | { kind: 'only' }
  | { kind: 'rotation_start' }
  | { kind: 'last_done'; at: ZonedTimestamp }
  | { kind: 'next_from'; at: ZonedTimestamp }
  | { kind: 'new_routine' };

// ---------------------------------------------------------------------------
// previewKey (§7)

export interface PreviewKeyParts {
  /** What the page previews: Up next (the routine or the last workout's next session) or a routine from the list. */
  target: { kind: 'routine'; routineId: string } | { kind: 'next'; sourceSessionId: string };
  routine: { id: string; version: number } | null;
  /** The gym and its equipment; `typical` when there is no gym yet (Start saves the typical gym). */
  gym: { id: string; equipment: readonly { id: string; version: number }[] } | { typical: true };
  /** The workout the targets come from (its revision changes on a correction). */
  source: { id: string; revision: number } | null;
  painFlags: readonly { id: string; version: number }[];
  /** Stored coach (D21) next-session actions. Empty until coach v1, which must add them to `previewFence` too (ADR 0019). */
  coachActions: readonly { id: string; version: number }[];
  unit: WeightUnit;
  /** An answered check-in today: pain mentioned there holds loads. */
  checkIn: { id: string; version: number } | null;
}

const byId = <T extends { id: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** A stable hash of everything that can change a target. Order of lists doesn't matter. */
export function previewKey(parts: PreviewKeyParts): string {
  const gym = 'typical' in parts.gym ? { typical: true } : { id: parts.gym.id, equipment: byId(parts.gym.equipment).map((e) => [e.id, e.version]) };
  return deriveId(
    stableStringify({
      target: parts.target,
      routine: parts.routine,
      gym,
      source: parts.source,
      painFlags: byId(parts.painFlags).map((f) => [f.id, f.version]),
      coachActions: byId(parts.coachActions).map((a) => [a.id, a.version]),
      unit: parts.unit,
      checkIn: parts.checkIn,
    }),
  );
}

/**
 * The rows a fresh preview was planned from, as a fence the start re-checks
 * inside its write (workout-overview §7, rule 5): a change that lands between
 * the key check and the write creates nothing. `profile`: the owner's row
 * (the unit); null where Start itself may write the profile (no gym yet: it
 * saves the typical gym first, so the gym isn't pinned either).
 */
export function previewFence(parts: PreviewKeyParts, ownerId: string, profile: { id: string; version: number } | null): WriteFence {
  return {
    rows: [
      ...(parts.routine ? [{ table: 'routines' as const, id: parts.routine.id, version: parts.routine.version }] : []),
      ...(parts.source ? [{ table: 'sessions' as const, id: parts.source.id, version: parts.source.revision }] : []),
      ...(parts.checkIn ? [{ table: 'check_ins' as const, id: parts.checkIn.id, version: parts.checkIn.version }] : []),
      ...(profile ? [{ table: 'profiles' as const, id: profile.id, version: profile.version }] : []),
    ],
    sets: [
      ...('typical' in parts.gym ? [] : [{ kind: 'gym_equipment' as const, gymId: parts.gym.id, members: parts.gym.equipment }]),
      { kind: 'active_pain_flags' as const, ownerId, members: parts.painFlags },
    ],
  };
}

// ---------------------------------------------------------------------------
// The view

export interface OverviewInput {
  /** The dry run Start uses (`preview: true`). */
  aggregate: SessionAggregate;
  /** How each set's load was fitted to this gym (`fits` from the dry run). */
  fits: Readonly<Record<string, SetFit>>;
  /** Finished history per exercise ID (`pastExercisesOf`), newest first. */
  pasts: Readonly<Record<string, readonly PastExercise[]>>;
  painFlags: readonly PainFlag[];
  /** Catalogue muscles (Coaching knowledge) per exercise ID. */
  exerciseInfo: Readonly<Record<string, Pick<Exercise, 'primaryMuscles'>>>;
  /** Ben's last finished workouts (pace). */
  recent: readonly SessionAggregate[];
  nowMs: number;
  tz: string;
  title: string;
  basis: OverviewBasis;
  /** Null: no gym yet; the rows are fitted to the typical gym Start will save. */
  gym: { id: string; name: string } | null;
  key: PreviewKeyParts;
}

export interface WorkoutOverview {
  previewKey: string;
  title: string;
  basis: OverviewBasis;
  gym: { id: string; name: string } | null;
  /** `estimateRemainingDuration` over the unstarted plan, rounded (§2.15); null when nothing is planned. */
  estimate: { minutes: number; seconds: number } | null;
  /** Working sets only. */
  workingSets: number;
  /** `Chest`, `Shoulders`, `Triceps`: the first is the main one. */
  muscles: string[];
  exerciseCount: number;
  groups: OverviewGroup[];
  rows: OverviewRow[];
}

function firstBarbell(aggregate: SessionAggregate): SessionExercise | null {
  const ordered = [...aggregate.exercises].sort((a, b) => a.order - b.order);
  return ordered.find((ex) => (ex.equipmentId === null ? null : aggregate.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId))?.kind === 'barbell') ?? null;
}

const loadWord = (l: Load): string => {
  const n = `${formatNumber(l.value)}${NBSP}${l.unit}`;
  switch (l.convention) {
    case 'per_hand':
      return `${n}${NBSP}each`;
    case 'assistance':
      return `−${n}`;
    case 'added':
      return `+${n}`;
    case 'bodyweight':
      return 'BW';
    case 'total':
    case 'stack':
      return n;
  }
};

/** `97.5 kg × 8, 8, 8` (one load) or `100 kg × 5, 90 kg × 8` (loads differ). Actuals only. */
export function lastText(past: PastExercise): string | null {
  const done = past.actuals;
  if (done.length === 0) return null;
  const amount = (s: PastActual) => (s.reps !== null ? String(s.reps) : s.durationS !== null ? formatDuration(s.durationS) : '—');
  const loadOf = (s: PastActual) => (s.load === null ? (past.convention === 'bodyweight' ? 'BW' : null) : loadWord(s.load));
  const loads = new Set(done.map(loadOf));
  const times = `${NBSP}×${NBSP}`;
  if (loads.size === 1) {
    const l = loadOf(done[0] as PastActual);
    const reps = done.map(amount).join(', ');
    return l === null ? reps : `${l}${times}${reps}`;
  }
  return done.map((s) => `${loadOf(s) ?? '—'}${times}${amount(s)}`).join(', ');
}

/** The heaviest counted working set over comparable history (never an estimate). Ties: more reps, then the newest. */
export function bestSet(planned: PlannedKey, pasts: readonly PastExercise[]): { load: Load; reps: number; at: ZonedTimestamp } | null {
  let best: { load: Load; reps: number; at: ZonedTimestamp; kg: number } | null = null;
  // Harder is heavier, except on an assisted machine, where less assistance is harder (N5).
  const sign = loadDirection(planned.convention) === 'assistance' ? -1 : 1;
  for (const p of pasts) {
    if (!isComparable(planned, p)) continue;
    for (const s of p.actuals) {
      if (s.load === null || s.reps === null || s.reps <= 0 || s.load.convention === 'bodyweight' || s.setType === 'drop' || !isSetCountable(s, 'record')) continue;
      const kg = sign * convertMass(s.load, 'kg').value;
      if (best === null || kg > best.kg || (kg === best.kg && s.reps > best.reps)) best = { load: s.load, reps: s.reps, at: p.performedAt, kg };
    }
  }
  return best === null ? null : { load: best.load, reps: best.reps, at: best.at };
}

const EQUIPMENT_NOUN: Record<EquipmentInstance['kind'], string> = {
  barbell: 'Bar',
  dumbbells: 'Rack',
  weight_stack: 'Stack',
  assisted_stack: 'Machine',
  plate_loaded_machine: 'Machine',
  bodyweight_station: 'Station',
};

/** The panel's `ROUNDED` value: `Rack tops out at 30 kg each`, `Stack goes 15 → 17.5 → 20`, `Converted from 225 lb`. */
export function roundedText(fit: Extract<SetFit, { kind: 'rounded' }>, eq: EquipmentInstance | null): string {
  const noun = eq === null ? 'Equipment' : EQUIPMENT_NOUN[eq.kind];
  const assisted = fit.planned.convention === 'assistance';
  if (fit.bounded === 'max') return assisted ? `${noun} gives at most ${loadWord(fit.planned)}` : `${noun} tops out at ${loadWord(fit.planned)}`;
  if (fit.bounded === 'min') return assisted ? `${noun} gives at least ${loadWord(fit.planned)}` : `${noun} starts at ${loadWord(fit.planned)}`;
  if (fit.converted) return `Converted from ${loadWord(fit.requested)}`;
  const card = eq === null ? null : buildStepCard(eq, fit.planned);
  if (card === null) return `Rounded from ${loadWord(fit.requested)}`;
  const n = (l: Load) => formatNumber(l.value);
  const seq = [card.nextDown?.load, fit.planned, card.nextUp?.load].filter((l): l is Load => l !== undefined);
  const ordered = loadDirection(fit.planned.convention) === 'assistance' ? [...seq].reverse() : seq;
  return `${noun} goes ${ordered.map(n).join(' → ')}`;
}

/** `25 · 10 · 5 a side · 20 kg bar`, or null when the plates can't make it (or it isn't a bar). */
export function platesText(load: Load, eq: EquipmentInstance): string | null {
  if (eq.kind !== 'barbell' || eq.plates.length === 0 || load.convention !== 'total') return null;
  const setup = buildPlateSetup(load, eq);
  if (!setup.ok) return null;
  const bar = `${formatNumber(setup.base.value)}${NBSP}${setup.base.unit} bar`;
  const plates = setup.perSide.flatMap((p) => Array.from({ length: p.count }, () => formatNumber(p.mass)));
  return plates.length === 0 ? `Bar only · ${bar}` : `${plates.join(' · ')} a side · ${bar}`;
}

/** `20 × 10 · 60 × 5 · 80 × 3`: the planned warm-ups (load number × reps). */
function warmupText(sets: readonly WorkoutSet[]): string | null {
  const parts = sets.map((s) => {
    const l = s.planned.load === null ? 'BW' : formatNumber(s.planned.load.value);
    const r = s.planned.reps !== null ? repRangeText(s.planned.reps) : s.planned.durationS !== null ? formatDuration(s.planned.durationS) : '—';
    return `${l}${NBSP}×${NBSP}${r}`;
  });
  return parts.length === 0 ? null : parts.join(' · ');
}

function flagText(flag: PainFlag): string {
  const where = flag.area === null ? null : PAIN_AREA_WORD[flag.area];
  const word = where === null ? 'Pain' : `${where.charAt(0).toUpperCase()}${where.slice(1)}`;
  return `${word} · ${dayMonthText(flag.reportedAt.utc, flag.reportedAt.tz)}`;
}

export function buildWorkoutOverview(input: OverviewInput): WorkoutOverview {
  const { aggregate } = input;
  const ordered = [...aggregate.exercises].sort((a, b) => a.order - b.order);
  const sets = aggregate.sets.filter(live);
  const barbellEx = firstBarbell(aggregate);

  const rows: OverviewRow[] = ordered.map((ex, i) => {
    const own = sets.filter((s) => s.sessionExerciseId === ex.id && s.pairedWithSetId === null).sort((a, b) => a.index - b.index);
    const working = own.filter((s) => isWorking(s.setType));
    const warm = own.filter((s) => !isWorking(s.setType));
    const first = working[0] ?? null;
    const eq = ex.equipmentId === null ? null : (aggregate.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
    const planned: PlannedFirst = { load: first?.planned.load ?? null, reps: first?.planned.reps ?? null, durationS: first?.planned.durationS ?? null, workingSets: working.length, convention: ex.loadConvention };
    // Fits for this exercise's working sets; the first working set decides `NO LOAD` and the glyph.
    const fits = working.map((s) => input.fits[s.id]).filter((f): f is SetFit => f !== undefined);
    const firstFit = first === null ? null : (input.fits[first.id] ?? null);
    const dropped = fits.find((f): f is Extract<SetFit, { kind: 'dropped' }> => f.kind === 'dropped') ?? null;
    const notHere = eq === null && dropped?.reason === 'equipment_not_in_gym';
    const key: PlannedKey = { equipment: notHere ? 'any' : equipmentKey(eq), convention: ex.loadConvention };
    const pasts = input.pasts[ex.exerciseId] ?? [];
    const comparable = lastComparable(key, pasts);
    const covering = painFlagCovering([...input.painFlags], ex.exerciseId, input.nowMs, input.tz);
    const rounded = fits.find((f): f is Extract<SetFit, { kind: 'rounded' }> => f.kind === 'rounded') ?? null;
    const marker = targetChangeMarker(planned, comparable, covering?.flag ?? null, firstFit);
    const words = markerWords(marker.kind);
    const load = loadCell(planned.load, ex.loadConvention, eq?.kind ?? null, firstFit?.kind === 'dropped');

    const warmups = warm.length === 0 ? null : `${String(warm.length)} ${warm.length === 1 ? 'warm-up' : 'warm-ups'}`;
    const setsText = setsDetail(working, ex.laterality === 'unilateral');
    const detail = [setsText, warmups].filter((x): x is string => x !== null && x !== '').join(' · ');

    const panel: PanelLine[] = [];
    const change = changeText(marker);
    if (change !== null) panel.push({ key: 'change', label: 'Change', value: change, tone: 'normal' });
    const last = comparable === null ? null : lastText(comparable);
    if (comparable !== null && last !== null) panel.push({ key: 'last', label: 'Last', value: `${last} · ${dayMonthText(comparable.performedAt.utc, comparable.performedAt.tz)}`, tone: 'normal' });
    if (barbellEx?.id === ex.id) {
      const w = warmupText(warm);
      if (w !== null) panel.push({ key: 'warmup', label: 'Warm-up', value: w, tone: 'normal' });
      const plates = planned.load !== null && eq !== null ? platesText(planned.load, eq) : null;
      if (plates !== null) panel.push({ key: 'plates', label: 'Plates', value: plates, tone: 'normal' });
      const best = bestSet(key, pasts);
      if (best !== null) panel.push({ key: 'best', label: 'Best', value: `${loadWord(best.load)}${NBSP}×${NBSP}${String(best.reps)} · ${dayMonthText(best.at.utc, best.at.tz)}`, tone: 'normal' });
    }
    if (rounded !== null && !dropped) panel.push({ key: 'rounded', label: 'Rounded', value: roundedText(rounded, eq), tone: 'normal' });
    const missing = dropped?.reason === 'equipment_not_in_gym' ? dropped.missing : null;
    if (dropped !== null) {
      const what =
        dropped.reason === 'equipment_not_in_gym'
          ? `No ${(missing ?? 'equipment for this').toLowerCase()} here`
          : dropped.reason === 'unit_not_convertible'
            ? `Nothing here takes ${dropped.requested.unit}`
            : dropped.reason === 'lightest_is_harder'
              ? dropped.requested.convention === 'assistance'
                ? `Most assistance here is under ${formatNumber(dropped.requested.value)}${NBSP}${dropped.requested.unit}`
                : `Lightest here is above ${loadWord(dropped.requested)}`
              : dropped.reason === 'no_achievable_loads'
                ? 'No loads set up here'
                : 'Different equipment here';
      panel.push({ key: 'gym', label: 'Gym', value: what, tone: 'warning' });
    }
    if (covering !== null) panel.push({ key: 'flag', label: 'Flag', value: flagText(covering.flag), tone: 'warning' });

    const supersetWith = ex.supersetGroup === null ? [] : ordered.filter((o) => o.id !== ex.id && o.supersetGroup === ex.supersetGroup).map((o) => o.exerciseName);
    const spokenSets = (() => {
      const n = working.length;
      const r = first?.planned.reps;
      const what = r ? (r.min === r.max ? String(r.min) : `${String(r.min)} to ${String(r.max)}`) : first?.planned.durationS !== null && first?.planned.durationS !== undefined ? formatDuration(first.planned.durationS) : null;
      return `${String(n)} ${n === 1 ? 'set' : 'sets'}${what === null ? '' : ` of ${what}`}${ex.laterality === 'unilateral' ? ' each side' : ''}`;
    })();
    const accessibilityLabel = [
      String(i + 1),
      ex.exerciseName,
      supersetWith.length > 0 ? `superset with ${supersetWith.join(' and ')}` : null,
      spokenSets,
      warmups,
      load.spoken,
      rounded !== null && !dropped ? 'rounded to this gym' : null,
      markerSpoken(marker),
    ]
      .filter((x): x is string => x !== null && x !== '')
      .join(', ');

    return {
      sessionExerciseId: ex.id,
      exerciseId: ex.exerciseId,
      index: i + 1,
      indexText: String(i + 1).padStart(2, '0'),
      name: ex.exerciseName,
      detail,
      warmups,
      marker: { ...marker, ...words },
      load,
      rounded: rounded !== null && dropped === null,
      panel,
      painFlag: covering === null ? null : { id: covering.flag.id, version: covering.flag.version, checkDue: covering.checkDue },
      missingEquipment: missing,
      firstSetId: first?.id ?? null,
      supersetWith,
      accessibilityLabel,
    };
  });

  // Consecutive exercises in one superset group form one block (bracket + eyebrow).
  const groups: OverviewGroup[] = [];
  ordered.forEach((ex, i) => {
    const row = rows[i];
    if (row === undefined) return;
    const prev = groups.at(-1);
    const prevEx = ordered[i - 1];
    if (ex.supersetGroup !== null && prev?.kind === 'superset' && prevEx?.supersetGroup === ex.supersetGroup) {
      prev.rows.push(row);
      return;
    }
    const next = ordered[i + 1];
    if (ex.supersetGroup !== null && next?.supersetGroup === ex.supersetGroup) groups.push({ kind: 'superset', rows: [row] });
    else groups.push({ kind: 'single', row });
  });

  const est = estimateRemainingDuration(aggregate, { recent: input.recent });
  const muscles = muscleWords(ordered.map((e) => input.exerciseInfo[e.exerciseId]).filter((x): x is Pick<Exercise, 'primaryMuscles'> => x !== undefined));
  return {
    previewKey: previewKey(input.key),
    title: input.title,
    basis: input.basis,
    gym: input.gym,
    estimate: est.pendingSets === 0 ? null : { minutes: est.minutes, seconds: est.seconds },
    workingSets: sets.filter((s) => s.pairedWithSetId === null && isWorking(s.setType)).length,
    muscles,
    exerciseCount: ordered.length,
    groups,
    rows,
  };
}

const FIVE_MIN_MS = 5 * 60_000;

/** `DONE BY` (§3.4): now + the estimate, rounded to 5 min, as `19:05`. The screen re-asks once a minute (`timing.timeLeftRefresh`). */
export function overviewDoneBy(nowMs: number, estimateSeconds: number, tz: string): { atMs: number; text: string } {
  const atMs = Math.round((nowMs + estimateSeconds * 1000) / FIVE_MIN_MS) * FIVE_MIN_MS;
  return { atMs, text: clockText(atMs, tz) };
}

/** The stat strip as one VoiceOver element (§8): `About 55 minutes, done about 19:05, 15 working sets`. */
export function statStripSpoken(estimateMinutes: number | null, doneByText: string | null, workingSets: number): string {
  const sets = `${String(workingSets)} working ${workingSets === 1 ? 'set' : 'sets'}`;
  if (estimateMinutes === null || doneByText === null) return sets;
  return `About ${String(estimateMinutes)} ${estimateMinutes === 1 ? 'minute' : 'minutes'}, done about ${doneByText}, ${sets}`;
}
