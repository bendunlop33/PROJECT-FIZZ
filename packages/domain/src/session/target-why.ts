import type {
  EquipmentInstance,
  Load,
  PainFlag,
  PlannedSet,
  SessionAggregate,
  SessionExercise,
  SetExclusion,
  SetSide,
  SetValues,
  TargetBasis,
  TargetProvenance,
  ZonedTimestamp,
} from '@fizz/schemas';
import { dayMonthText, formatDuration, formatNumber, loadText, NBSP, repRangeText } from '../display';
import { comparableSetsOf, matchesEquipment, type HistorySession } from '../progression';
import { isPainCheckDue, PAIN_AREA_WORD } from '../pain-flags';
import { isSetCountable, notUsedLine } from '../exclusions';
import { stepText } from '../target-provenance';
import { toMs } from '../time';
import { lastComparableSession } from './active-view';
import { shownCoachNote } from './builder-loads';
import { equipmentOfRow } from './equipment-snapshot';

/**
 * `explainTarget` (active-workout.md §2.12, §6): the `Why?` panel under a set
 * target. A pure read of the provenance stored when the target was made
 * (AW3), plus the pain flags on the movement and a check of whether the
 * basis sets were edited since. It runs no progression rule and no coach,
 * so it is the same offline as online. Every line is fixed app text filled
 * in by code, except a coach target's reason, shown in quotes as the
 * coach's words; `Last time` and `Before flag` hold actual results.
 */

export type WhyRowKey = 'coach_workout' | 'set_by' | 'last_time' | 'reason' | 'equipment' | 'pain' | 'before_flag' | 'not_used' | 'swapped';

export interface WhyRow {
  key: WhyRowKey;
  /** Null: one full-width line with no label column (`Swapped before start · Bench press`, overview-today-edits.md §5). */
  label: 'Set by' | 'Last time' | 'Reason' | 'Coach’s note' | 'Equipment' | 'Pain' | 'Before flag' | 'Not used' | null;
  lines: string[];
  /** `actual`: logged results, never targets. `warning`: shown with the warning icon. */
  kind: 'app' | 'actual' | 'warning';
  /** `Check due ›` on the `Pain` row when the flag's two-weekly check is due: opens the pain flag sheet. */
  link?: { kind: 'pain_flag'; flagId: string; label: 'Check due ›' };
}

export interface TargetExplanation {
  setId: string;
  setVersion: number;
  /** False for a target made before provenance was stored: `Not recorded`, never a guessed reason. */
  recorded: boolean;
  /** Fixed order; a row appears only when it has something to say. */
  rows: WhyRow[];
  /** `Based on 1 Oct before you edited it on 2 Oct.` when a basis set changed after the target was made. */
  basisEdited: string | null;
}

export interface ExplainTargetInput {
  aggregate: SessionAggregate;
  setId: string;
  nowMs: number;
  /** The basis workout as stored now (edit check, equipment name); null when there is none or it wasn't found. */
  basisNow: SessionAggregate | null;
  /** Gym names by ID (kept for callers; the brief panel no longer names the gym, 18 Oct). */
  gymNames: Readonly<Record<string, string>>;
  /** Ben's pain flags on this exercise, active and cleared. */
  painFlags: readonly PainFlag[];
  /** This exercise's finished history, without this workout (`Last time` when nothing was stored, `Before flag`). */
  history: readonly HistorySession[];
  /**
   * A started workout's set `Why?` (workout-builder §6.3): when the coach built the draft it started
   * from (null: the draft is gone, the workout's start date is used). Absent (the overview's dry run):
   * no `From a coach workout` line.
   */
  coachDraftBuiltAt?: ZonedTimestamp | null;
}

/** `timing.painReferenceWindow`: `Before flag` stays this long after a flag is cleared (active-workout §9). */
export const PAIN_REFERENCE_WINDOW_MS = 8 * 7 * 86_400_000;

interface ShownSet {
  /** The number the card showed (`Set 4`); older stored bases don't have it. */
  number?: number | undefined;
  side: SetSide | null;
  values: Pick<SetValues, 'load' | 'reps' | 'durationS' | 'rpe' | 'rir'>;
  exclusions?: readonly SetExclusion[] | undefined;
}

/** `Last time` and `Before flag` list counted sets only; the ones Ben marked go under `Not used` (§2.13). */
const counted = <T extends ShownSet>(sets: readonly T[]): T[] => sets.filter((s) => isSetCountable(s, 'progression'));

/**
 * One short line (Ben, 18 Oct: "I don't need the reason explanation to be so
 * in depth"): the first sentence of a stored line, without its full stop.
 * Stored text is kept as it was; only the panel shortens it.
 */
export function briefLine(text: string): string {
  const t = text.trim();
  const end = t.search(/[.!?](\s|$)/);
  return (end === -1 ? t : t.slice(0, end)).trim();
}

/** Shown when every set of the workout was left out. */
const ALL_LEFT_OUT = 'All left out';

/**
 * `Not used`: basis sets Ben marked, by the number the card showed them with
 * (`Set 4 on 1 Oct: spotted.`, review N1). A basis stored before numbers
 * were kept falls back to the place among the sets shown.
 */
function notUsedRow(sets: readonly ShownSet[], day: string): WhyRow | null {
  const lines = sets.flatMap((s, i) => (isSetCountable(s, 'progression') ? [] : [notUsedLine(s.number ?? i + 1, day, s.exclusions)]));
  return lines.length === 0 ? null : { key: 'not_used', label: 'Not used', lines: [lines.map(briefLine).join(' · ')], kind: 'actual' };
}

const SIDE_ORDER: Record<SetSide, number> = { both: 0, left: 1, right: 2 };

/** Order done; when any set has a side, grouped by side first (stable). */
function displayOrder(sets: readonly ShownSet[]): readonly ShownSet[] {
  if (!sets.some((s) => s.side === 'left' || s.side === 'right')) return sets;
  return [...sets].sort((a, b) => SIDE_ORDER[a.side ?? 'both'] - SIDE_ORDER[b.side ?? 'both']);
}

/**
 * `100 kg × 8, 8, 8`, `100 kg × 8; 102.5 kg × 6, 5`,
 * `Left 25 kg stack × 10, 9; Right 25 kg stack × 10, 10`. Sets are listed in
 * the order done (sided sets grouped by side first); consecutive sets at the
 * same load share it.
 */
export function basisSetsText(sets: readonly ShownSet[], ex: Pick<SessionExercise, 'loadConvention' | 'measurement'>, eq: EquipmentInstance | null): string {
  const groups: { head: string; amounts: string[] }[] = [];
  for (const s of displayOrder(sets)) {
    const { load, reps, durationS } = s.values;
    const side = s.side === 'left' ? 'Left ' : s.side === 'right' ? 'Right ' : '';
    const convention = load?.convention ?? ex.loadConvention;
    const loadPart = ex.measurement === 'duration' && (load === null || convention === 'bodyweight') ? '' : `${loadText(load, convention, eq)}${NBSP}×${NBSP}`;
    const head = `${side}${loadPart}`;
    const amount = reps !== null ? String(reps) : durationS !== null ? formatDuration(durationS) : '—';
    const last = groups.at(-1);
    if (last?.head === head) last.amounts.push(amount);
    else groups.push({ head, amounts: [amount] });
  }
  return groups.map((g) => `${g.head}${g.amounts.join(', ')}`).join('; ');
}

/** `Push A, 1 Oct` or `your 1 Oct workout`. */
function workoutName(routineName: string | null, utc: string, tz: string): string {
  const day = dayMonthText(utc, tz);
  return routineName !== null && routineName.trim() !== '' ? `${routineName}, ${day}` : `your ${day} workout`;
}

/** `100 kg × 6–8`, `8–10 reps`, `0:45` (the routine's own target). */
function planTargetText(planned: PlannedSet, requested: Load | null, ex: Pick<SessionExercise, 'loadConvention'>, eq: EquipmentInstance | null): string {
  const load = requested ?? planned.load;
  const loadPart = load === null ? null : loadText(load, load.convention, eq);
  const amount = planned.reps !== null ? repRangeText(planned.reps) : planned.durationS !== null ? formatDuration(planned.durationS) : null;
  const effort = planned.rpe !== null ? ` at RPE ${formatNumber(planned.rpe)}` : planned.rir !== null ? ` at RIR ${String(planned.rir)}` : '';
  if (loadPart !== null && amount !== null) return `${loadPart}${NBSP}×${NBSP}${amount}${effort}`;
  if (loadPart !== null) return `${loadPart}${effort}`;
  if (planned.reps !== null) return `${repRangeText(planned.reps)}${NBSP}reps${effort}`;
  if (amount !== null) return `${amount}${effort}`;
  return loadText(null, ex.loadConvention, eq);
}

function setByRow(p: TargetProvenance | undefined): WhyRow {
  if (p === undefined) return { key: 'set_by', label: 'Set by', lines: ['Not recorded'], kind: 'app' };
  const after = p.basis === null ? null : workoutName(p.basis.routineName, p.basis.performedAt.utc, p.basis.performedAt.tz);
  switch (p.source) {
    case 'rule':
      return {
        key: 'set_by',
        label: 'Set by',
        lines: [after === null ? `Rule · ${dayMonthText(p.setAt.utc, p.setAt.tz)}` : `Rule · after ${after}`],
        kind: 'app',
      };
    case 'plan':
      return { key: 'set_by', label: 'Set by', lines: [`Your routine · ${p.routineName ?? 'Routine'}`], kind: 'app' };
    case 'repeat':
      return { key: 'set_by', label: 'Set by', lines: [after === null ? 'Repeat of a past workout' : `Repeat of ${after}`], kind: 'app' };
    case 'coach':
      // Today's change says when; a next-session target says which workout it followed.
      return {
        key: 'set_by',
        label: 'Set by',
        lines: [
          p.coach?.scope === 'build'
            ? `From a coach workout · ${dayMonthText(p.setAt.utc, p.setAt.tz)}${p.estimate === true ? ' · est.' : ''}`
            : p.coach?.scope === 'next_session' && after !== null
              ? `Coach · after ${after}`
              : `Coach · ${dayMonthText(p.setAt.utc, p.setAt.tz)}`,
        ],
        kind: 'app',
      };
  }
}

/** `100 kg × 8, 8, 7 @ 8 · 1 Oct`: one line, the top effort only. */
function lastLine(sets: readonly ShownSet[], text: string, day: string): string {
  if (sets.length === 0) return `${ALL_LEFT_OUT} · ${day}`;
  const top = sets.reduce<number | null>((m, s) => (s.values.rpe === null ? m : m === null ? s.values.rpe : Math.max(m, s.values.rpe)), null);
  return `${text}${top === null ? '' : ` @${NBSP}${formatNumber(top)}`} · ${day}`;
}

function storedLastTime(basis: TargetBasis, ex: SessionExercise, eq: EquipmentInstance | null, basisNow: SessionAggregate | null): WhyRow {
  const basisEq = basis.equipmentId === null ? null : (basisNow?.session.equipmentSnapshot.find((e) => e.id === basis.equipmentId) ?? (eq?.id === basis.equipmentId ? eq : null));
  const sets = counted(basis.sets);
  return { key: 'last_time', label: 'Last time', lines: [lastLine(sets, basisSetsText(sets, ex, basisEq ?? eq), dayMonthText(basis.performedAt.utc, basis.performedAt.tz))], kind: 'actual' };
}

/** A history workout's non-warm-up sets, sides kept, in the shape the rows print. */
function shownSets(h: HistorySession): ShownSet[] {
  return comparableSetsOf(h)
    .filter((x) => x.setType !== 'warmup')
    .map((x) => ({ ...(x.number !== undefined ? { number: x.number } : {}), side: x.side, values: { load: x.load, reps: x.reps, durationS: null, rpe: x.rpe, rir: x.rir }, ...(x.exclusions ? { exclusions: x.exclusions } : {}) }));
}

/** The workout `lastComparableSession` picks (same equipment, unit and convention; FitNotes on any equipment, B7), with its sides. */
export function lastComparableHistory(history: readonly HistorySession[], ex: Pick<SessionExercise, 'equipmentId' | 'unit' | 'loadConvention'>): HistorySession | null {
  const prev = lastComparableSession(history, ex);
  if (prev === null) return null;
  return history.find((h) => h.sessionId === prev.sessionId && matchesEquipment(h, ex.equipmentId)) ?? null;
}

/** `55 kg × 6, 6, 6`: a history workout's non-warm-up sets as actual results (`Before flag`, the pain flag sheet). */
export function historySetsText(h: HistorySession, ex: Pick<SessionExercise, 'loadConvention' | 'measurement'>, eq: EquipmentInstance | null): string {
  const sets = counted(shownSets(h));
  return sets.length === 0 ? ALL_LEFT_OUT : basisSetsText(sets, ex, eq);
}

function historyLastTime(prev: HistorySession | null, ex: SessionExercise, eq: EquipmentInstance | null, tz: string): WhyRow {
  if (prev === null) {
    return { key: 'last_time', label: 'Last time', lines: ['None'], kind: 'app' };
  }
  const sets = counted(shownSets(prev));
  return { key: 'last_time', label: 'Last time', lines: [lastLine(sets, basisSetsText(sets, ex, eq), dayMonthText(prev.performedAtUtc, prev.tz ?? tz))], kind: 'actual' };
}

function reasonRow(p: TargetProvenance | undefined, planned: PlannedSet, ex: SessionExercise, eq: EquipmentInstance | null): WhyRow | null {
  if (p === undefined) return null;
  switch (p.source) {
    case 'rule':
    {
      const line = p.rule ? briefLine(p.rule.summary).replace(/,? because .*$/, '') : '';
      return line !== '' ? { key: 'reason', label: 'Reason', lines: [line], kind: 'app' } : null;
    }
    case 'plan':
      return { key: 'reason', label: 'Reason', lines: [`Plan ${planTargetText(planned, p.requestedLoad, ex, eq)}`], kind: 'app' };
    case 'repeat':
      return { key: 'reason', label: 'Reason', lines: ['Same as last time'], kind: 'app' };
    case 'coach': {
      // The coach's own words, in quotes (never shown as app text); none given, no row.
      // A coach-built load's words are a note (data, not fact; review r2 B1r): code's reason line is under Equipment.
      // Review r4: a build note with any number is never shown (sessions planned before the rule included).
      const build = p.coach?.scope === 'build';
      const reason = build ? shownCoachNote(p.coach?.reason) : (p.coach?.reason ?? null);
      const label = build ? 'Coach’s note' : 'Reason';
      return reason === null || reason.trim() === '' ? null : { key: 'reason', label, lines: [`“${briefLine(reason)}”`], kind: 'app' };
    }
  }
}

function equipmentRow(p: TargetProvenance | undefined): WhyRow | null {
  if (p === undefined) return null;
  // `Capped at 100 kg: the most this bar makes. …` → `Capped at 100 kg`.
  const lines = [...(p.step ? [stepText(p.step)] : []), ...p.guardNotes].map((l) => briefLine(l).replace(/(: |, )the .*$/, '')).filter((l) => l !== '');
  return lines.length === 0 ? null : { key: 'equipment', label: 'Equipment', lines: [lines.join(' · ')], kind: 'app' };
}

/** The flag `Pain` and `Before flag` are about: the oldest active one, else the latest cleared within the reference window. */
function referenceFlag(flags: readonly PainFlag[], nowMs: number): { flag: PainFlag; active: boolean } | null {
  const active = flags.filter((f) => f.status === 'active').sort((a, b) => toMs(a.reportedAt.utc) - toMs(b.reportedAt.utc))[0];
  if (active) return { flag: active, active: true };
  const clearedMs = (f: PainFlag) => (f.clearedAtUtc === null ? -Infinity : toMs(f.clearedAtUtc));
  const cleared = flags
    .filter((f) => f.status === 'cleared' && nowMs - clearedMs(f) <= PAIN_REFERENCE_WINDOW_MS)
    .sort((a, b) => clearedMs(b) - clearedMs(a))[0];
  return cleared ? { flag: cleared, active: false } : null;
}

/**
 * `getPainReference` (active-workout §2.14.3): the last comparable workout
 * before the flag was set, as actual sets. Reference only; it never sets a
 * target. Null when there is none.
 */
export function painReference(history: readonly HistorySession[], flag: Pick<PainFlag, 'reportedAt'>, ex: Pick<SessionExercise, 'equipmentId' | 'unit' | 'loadConvention'>): HistorySession | null {
  const before = toMs(flag.reportedAt.utc);
  return lastComparableHistory(
    history.filter((h) => toMs(h.performedAtUtc) < before),
    ex,
  );
}

function basisEditedNote(basis: TargetBasis, basisNow: SessionAggregate | null): string | null {
  if (basisNow === null) return null;
  let changed = false;
  let lastEdit: string | null = null;
  for (const b of basis.sets) {
    if (b.setId === undefined || b.version === undefined) continue;
    const now = basisNow.sets.find((s) => s.id === b.setId);
    if (now?.status === 'completed' && now.version === b.version) continue;
    changed = true;
    const since = b.version;
    for (const e of basisNow.audit) {
      if (e.setId !== b.setId || e.kind === 'logged' || (e.before?.version ?? 0) < since) continue;
      if (lastEdit === null || toMs(e.atUtc) > toMs(lastEdit)) lastEdit = e.atUtc;
    }
  }
  if (!changed) return null;
  const day = dayMonthText(basis.performedAt.utc, basis.performedAt.tz);
  return lastEdit === null ? `Based on ${day}, since edited` : `Based on ${day}, edited ${dayMonthText(lastEdit, basis.performedAt.tz)}`;
}

/**
 * The `Why?` panel for one set's target, or null when the set isn't found or
 * has no target (an empty set explains its draft with the draft caption
 * instead).
 */
export function explainTarget(input: ExplainTargetInput): TargetExplanation | null {
  const { aggregate: state } = input;
  const set = state.sets.find((s) => s.id === input.setId);
  if (!set || set.status === 'deleted') return null;
  const { planned } = set;
  if (planned.load === null && planned.reps === null && planned.durationS === null) return null;
  const ex = state.exercises.find((e) => e.id === set.sessionExerciseId);
  if (!ex) return null;
  // The version of the item this row uses (a gym switch can append a newer one, GS-S3).
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  const p = planned.provenance;
  const tz = state.session.startedAt.tz;

  const rows: WhyRow[] = [];
  // workout-builder §6.3, WB25: a workout started from a coach draft says so first (review S7).
  if (state.session.coachDraft !== undefined && input.coachDraftBuiltAt !== undefined) {
    const built = input.coachDraftBuiltAt ?? state.session.startedAt;
    rows.push({ key: 'coach_workout', label: null, lines: [`From a coach workout · ${dayMonthText(built.utc, built.tz)}`], kind: 'app' });
  }
  // Swapped on the Workout overview before Start (ADR 0022 §4): said first, then the usual explanation of the substitute's target.
  const swapped = state.session.todayEdits?.swapped.find((x) => x.sessionExerciseId === ex.id);
  if (swapped !== undefined) rows.push({ key: 'swapped', label: null, lines: [`Swapped before start · ${swapped.fromExerciseName}`], kind: 'app' });
  rows.push(setByRow(p));
  const fromHistory = p?.basis ? null : lastComparableHistory(input.history, ex);
  rows.push(p?.basis ? storedLastTime(p.basis, ex, eq, input.basisNow) : historyLastTime(fromHistory, ex, eq, tz));
  const reason = reasonRow(p, planned, ex, eq);
  if (reason) rows.push(reason);
  const equipment = equipmentRow(p);
  if (equipment) rows.push(equipment);

  const flags = input.painFlags.filter((f) => f.exerciseId === ex.exerciseId);
  const ref = referenceFlag(flags, input.nowMs);
  if (ref?.active) {
    const area = ref.flag.area === null ? null : PAIN_AREA_WORD[ref.flag.area];
    const since = dayMonthText(ref.flag.reportedAt.utc, ref.flag.reportedAt.tz);
    // A flag set after the target was made doesn't change it (targets already planned stay as they are).
    const after = p !== undefined && toMs(ref.flag.reportedAt.utc) > toMs(p.setAt.utc);
    const lines = [`Held · since ${since}${area === null ? '' : ` (${area})`}${after ? ' · after target' : ''}`];
    // `Check due ›` opens the pain flag sheet with `Still hurts?` first (§2.14.2).
    const checkDue = isPainCheckDue(ref.flag, input.nowMs, tz);
    rows.push({ key: 'pain', label: 'Pain', lines, kind: 'warning', ...(checkDue ? { link: { kind: 'pain_flag', flagId: ref.flag.id, label: 'Check due ›' } } : {}) });
  }
  if (ref) {
    const before = painReference(input.history, ref.flag, ex);
    if (before) {
      rows.push({ key: 'before_flag', label: 'Before flag', lines: [`${historySetsText(before, ex, eq)} · ${dayMonthText(before.performedAtUtc, before.tz ?? tz)}`], kind: 'actual' });
    }
  }
  // §2.13: the basis sets Ben marked, with his reason. Stored with the target, or read from history when nothing was stored.
  const notUsed = p?.basis
    ? notUsedRow(p.basis.sets, dayMonthText(p.basis.performedAt.utc, p.basis.performedAt.tz))
    : fromHistory
      ? notUsedRow(shownSets(fromHistory), dayMonthText(fromHistory.performedAtUtc, fromHistory.tz ?? tz))
      : null;
  if (notUsed) rows.push(notUsed);

  return {
    setId: set.id,
    setVersion: set.version,
    recorded: p !== undefined,
    rows,
    basisEdited: p?.basis ? basisEditedNote(p.basis, input.basisNow) : null,
  };
}
