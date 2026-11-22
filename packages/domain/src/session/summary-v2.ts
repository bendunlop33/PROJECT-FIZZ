import type { HistorySession } from '../progression';
import type { Load, LoadConvention, SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';

import { localDateOf } from '../calendar';
import { formatNumber, NBSP } from '../display';
import { loadDirection } from '../equipment';
import { isSetCountable } from '../exclusions';
import { healthSourceText } from '../health';
import { isPlatesAddedKind } from '../plates-added';
import { weekdayDayMonth } from '../progress/text';
import { toMs } from '../time';
import { convertMass } from '../units';
import { lastComparableSession } from './active-view';
import { equipmentOfRow } from './equipment-snapshot';
import type { SessionRecordItem } from './records';

/**
 * (Ben, 22 Nov; docs/design/prototypes/summary-v2-22nov.html, `Proposed`) The Summary v2's pieces, pure: the plan line,
 * the three numbers (minutes, working sets, volume with its change), the Health line, Highlights, Vs last time. Values
 * only (minimal copy); nothing here decides a target. Next time's fold and per-row Undo are `next-time-view` (mobile).
 */

// ---------------------------------------------------------------------------
// Plan line

/** The block as of the workout's end (`pbBlockOfPlan` at that time) and the plan's days a week. */
export interface SummaryPlanInput {
  week: number;
  of: number;
  done: boolean;
  leadIn: boolean;
  /** Plan days done in that week, this workout included. */
  daysDone: number;
  /** Days a week in the plan. */
  days: number;
}

/** `Week 4 of 6 · 4 of 5 days done`, `Lead-in · 1 of 4 days done`; null: no plan, or the block was done. */
export function summaryPlanLine(p: SummaryPlanInput | null): string | null {
  if (p === null || p.done || p.days <= 0 || p.of <= 0) return null;
  const head = p.leadIn ? 'Lead-in' : `Week ${String(p.week)} of ${String(p.of)}`;
  return `${head} · ${String(p.daysDone)} of ${String(Math.max(p.days, p.daysDone))} days done`;
}

// ---------------------------------------------------------------------------
// Volume and the three numbers

export interface WorkoutVolume {
  /** Load × reps of the loaded working sets, in kg (lb converted). */
  kg: number;
  /** The working sets that counted (a load and reps). 0: no loaded sets, volume isn't shown. */
  loadedSets: number;
  /** Reps of every completed working set (any load). */
  reps: number;
}

/** A set's load in volume (kg), or null when it has none to count: bodyweight, BW + added, assisted. */
function volumeLoadKg(load: Load | null, ex: Pick<SessionExercise, 'laterality'>, plates: boolean): number | null {
  if (load === null || !(load.value > 0)) return null;
  const kg = convertMass(load, 'kg').value;
  switch (load.convention) {
    case 'total':
    case 'stack':
      return kg;
    case 'per_hand':
      // Two dumbbells on a two-handed exercise; one at a time (unilateral) counts each side's set on its own.
      return ex.laterality === 'bilateral' ? kg * 2 : kg;
    case 'added':
      // Plates on a plate-loaded machine are the load; BW + added has a bodyweight part we don't know (rule 6).
      return plates ? kg : null;
    case 'assistance':
    case 'bodyweight':
      return null;
  }
}

/**
 * The workout's volume (Ben, 22 Nov): completed working sets measured in reps with a real load. Warm-ups, cardio and
 * timed sets, bodyweight, BW + added and assisted sets are left out (rule 6). A flagged set still counts (AW8).
 */
export function workoutVolume(a: Pick<SessionAggregate, 'sets' | 'exercises' | 'session'>): WorkoutVolume {
  let kg = 0;
  let loadedSets = 0;
  let reps = 0;
  for (const s of a.sets) {
    if (s.status !== 'completed' || s.actual === null || s.setType === 'warmup') continue;
    const ex = a.exercises.find((e) => e.id === s.sessionExerciseId);
    if (ex === undefined || ex.measurement !== 'reps') continue;
    const r = s.actual.reps ?? 0;
    if (!(r > 0)) continue;
    reps += r;
    const eq = equipmentOfRow(a.session.equipmentSnapshot, ex);
    const load = volumeLoadKg(s.actual.load, ex, isPlatesAddedKind(eq?.kind));
    if (load === null) continue;
    kg += load * r;
    loadedSets += 1;
  }
  return { kg, loadedSets, reps };
}

/** `6.4 t` from 1000 kg, else `850 kg`. */
export function volumeText(kg: number): string {
  return kg >= 1000 ? `${formatNumber(Math.round(kg / 100) / 10)}${NBSP}t` : `${String(Math.round(kg))}${NBSP}kg`;
}

export interface SummaryStatChange {
  /** `↑ 6%`, `↓ 4%`, `=`. */
  text: string;
  spoken: string;
  dir: 'up' | 'down' | 'same';
}

export interface SummaryStat {
  key: 'minutes' | 'sets' | 'volume' | 'reps';
  /** `52`, `20`, `6.4 t`. */
  value: string;
  /** `min`, `sets`, `volume`, `reps`. */
  label: string;
  change: SummaryStatChange | null;
  spoken: string;
}

/** `↑ 6%` from two volumes; null when there is nothing to compare with. */
export function volumeChange(today: number, before: number | null): SummaryStatChange | null {
  if (before === null || !(before > 0) || !(today > 0)) return null;
  const pct = Math.round(((today - before) / before) * 100);
  if (pct === 0) return { text: '=', spoken: 'same as last time', dir: 'same' };
  const n = String(Math.abs(pct));
  return pct > 0 ? { text: `↑ ${n}%`, spoken: `up ${n} percent`, dir: 'up' } : { text: `↓ ${n}%`, spoken: `down ${n} percent`, dir: 'down' };
}

/**
 * The three numbers: minutes (none for a date-only workout), working sets, and volume with its change against the
 * comparable workout's (`previousVolumeKg`; null: none, so no arrow). No loaded sets: total reps instead (no change);
 * no reps either: two numbers.
 */
export function summaryStats(input: { activeMs: number | null; workingSets: number; volume: WorkoutVolume; previousVolumeKg: number | null }): SummaryStat[] {
  const out: SummaryStat[] = [];
  if (input.activeMs !== null) {
    const m = String(Math.max(0, Math.round(input.activeMs / 60_000)));
    out.push({ key: 'minutes', value: m, label: 'min', change: null, spoken: `${m} minutes` });
  }
  const n = String(input.workingSets);
  out.push({ key: 'sets', value: n, label: 'sets', change: null, spoken: `${n} ${input.workingSets === 1 ? 'set' : 'sets'}` });
  const v = input.volume;
  if (v.loadedSets > 0) {
    const value = volumeText(v.kg);
    const change = volumeChange(v.kg, input.previousVolumeKg);
    const said = value.replace(`${NBSP}t`, ' tonnes').replace(`${NBSP}kg`, ' kilograms');
    out.push({ key: 'volume', value, label: 'volume', change, spoken: `volume ${said}${change === null ? '' : `, ${change.spoken}`}` });
  } else if (v.reps > 0) {
    const r = String(v.reps);
    out.push({ key: 'reps', value: r, label: 'reps', change: null, spoken: `${r} reps` });
  }
  return out;
}

/**
 * The workout whose volume today's is compared with: the newest finished one before it of the same plan day (plan and
 * day), else the same saved workout. Null: none, so the volume has no arrow.
 */
export function comparableWorkoutRef<R extends { sessionId: string; routineId: string | null; startedAtUtc: string; planDay?: { planId: string; dayIndex: number } | undefined }>(
  refs: readonly R[],
  today: { sessionId: string; routineId: string | null; startedAtUtc: string; planDay?: { planId: string; dayIndex: number } | null | undefined },
): R | null {
  const before = refs.filter((r) => r.sessionId !== today.sessionId && toMs(r.startedAtUtc) < toMs(today.startedAtUtc)).sort((a, b) => toMs(b.startedAtUtc) - toMs(a.startedAtUtc));
  const day = today.planDay ?? null;
  if (day !== null) {
    const same = before.find((r) => r.planDay !== undefined && r.planDay.planId === day.planId && r.planDay.dayIndex === day.dayIndex);
    if (same !== undefined) return same;
  }
  if (today.routineId !== null) return before.find((r) => r.routineId === today.routineId) ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Health line

/** `Garmin · avg 128 bpm · 410 kcal`: only values the Health workout has (rule 6); null with none. */
export function summaryHealthLine(p: { sourceName: string; avgHeartRate: number | null; activeKcal?: number | null | undefined }, showHeartRate: boolean): { text: string; spoken: string } | null {
  const hr = showHeartRate && p.avgHeartRate !== null ? Math.round(p.avgHeartRate) : null;
  const kcal = p.activeKcal === undefined || p.activeKcal === null ? null : Math.round(p.activeKcal);
  if (hr === null && kcal === null) return null;
  const source = healthSourceText(p.sourceName);
  const parts = [hr === null ? null : `avg ${String(hr)} bpm`, kcal === null ? null : `${String(kcal)} kcal`].filter((x): x is string => x !== null);
  const said = [hr === null ? null : `average heart rate ${String(hr)}`, kcal === null ? null : `${String(kcal)} active calories`].filter((x): x is string => x !== null);
  return { text: [source, ...parts].join(' · '), spoken: `${source}, ${said.join(', ')}, from Apple Health` };
}

// ---------------------------------------------------------------------------
// One set, as the Summary says it

/** `97.5 kg × 8`, `10 kg ea × 13`, `20 kg assist × 8`, `BW +10 kg × 8`, `BW × 8`; the unit always named. */
export function summarySetText(load: Load | null, reps: number, plates = false): string {
  const x = `${NBSP}×${NBSP}${String(reps)}`;
  if (load === null || load.convention === 'bodyweight') return `BW${x}`;
  const n = formatNumber(load.value);
  switch (load.convention) {
    case 'per_hand':
      return `${n}${NBSP}${load.unit}${NBSP}ea${x}`;
    case 'assistance':
      return `${n}${NBSP}${load.unit}${NBSP}assist${x}`;
    case 'added':
      return plates ? `${n}${NBSP}${load.unit}${x}` : `BW${NBSP}+${n}${NBSP}${load.unit}${x}`;
    case 'total':
    case 'stack':
      return `${n}${NBSP}${load.unit}${x}`;
  }
}

// ---------------------------------------------------------------------------
// Highlights

export type SummaryHighlightKind = 'best' | 'heaviest' | 'most_reps' | 'cut_short' | 'skipped';

export interface SummaryHighlight {
  key: string;
  kind: SummaryHighlightKind;
  /** Green ring (a best) or amber dashed (cut short, skipped). */
  ring: 'best' | 'short';
  name: string;
  /** `Best for 8 reps`, `Heaviest yet`, `Most reps yet`, `Cut short`, `Skipped`. */
  meta: string;
  /** `97.5 kg × 8`, `1 of 3 sets`. */
  value: string;
  spoken: string;
}

export interface SummaryHighlightsInput {
  /** The workout's exercises in order (the order highlights read in). */
  order: readonly { exerciseId: string; sessionExerciseId: string }[];
  /** The tracked lifts' new bests (`sessionNewBests`, Progress's definition). */
  bests: readonly { exerciseId: string; name?: string | undefined; set?: string | undefined; reps?: number | undefined }[];
  /** Heaviest-set records (`sessionRecordItems`); an exercise with a best above isn't listed twice. */
  records: readonly SessionRecordItem[];
  /** Plan vs done (null: nothing planned). */
  plan: readonly { sessionExerciseId: string; exerciseId: string; name: string; plannedSets: number; doneSets: number }[] | null;
}

/** How many highlights show before `+N more`. */
export const SUMMARY_HIGHLIGHTS_SHOWN = 3;

/**
 * Highlights (Ben, 22 Nov): new bests first (green ring, `Best for 8 reps`; else `Heaviest yet` / `Most reps yet`), one
 * per exercise, then anything cut short (amber dashed ring, `Cut short · 1 of 3 sets`; none done: `Skipped`). Each group
 * in the workout's order. `shown` is the first 3; `more` the rest (`+N more`).
 */
export function summaryHighlights(input: SummaryHighlightsInput): { shown: SummaryHighlight[]; more: SummaryHighlight[] } {
  const rank = new Map(input.order.map((e, i) => [e.exerciseId, i] as const));
  const byOrder = <T extends { exerciseId: string }>(xs: readonly T[]) => [...xs].sort((a, b) => (rank.get(a.exerciseId) ?? 999) - (rank.get(b.exerciseId) ?? 999));
  const bests: SummaryHighlight[] = [];
  const seen = new Set<string>();
  for (const b of byOrder(input.bests)) {
    if (seen.has(b.exerciseId) || b.name === undefined || b.set === undefined) continue;
    seen.add(b.exerciseId);
    const meta = b.reps === undefined ? 'New best' : `Best for ${String(b.reps)} ${b.reps === 1 ? 'rep' : 'reps'}`;
    bests.push({ key: `best:${b.exerciseId}`, kind: 'best', ring: 'best', name: b.name, meta, value: b.set, spoken: `${b.name}, ${meta}, ${b.set.replaceAll(NBSP, ' ')}` });
  }
  for (const r of byOrder(input.records)) {
    if (seen.has(r.exerciseId)) continue;
    seen.add(r.exerciseId);
    const kind = r.kind === 'heaviest' ? 'heaviest' : 'most_reps';
    const meta = kind === 'heaviest' ? 'Heaviest yet' : 'Most reps yet';
    const value = summarySetText(r.load, r.reps, r.plates);
    bests.push({ key: `rec:${r.exerciseId}`, kind, ring: 'best', name: r.name, meta, value, spoken: `${r.name}, ${meta}, ${value.replaceAll(NBSP, ' ')}` });
  }
  const order = new Map(input.order.map((e, i) => [e.sessionExerciseId, i] as const));
  const short = [...(input.plan ?? [])]
    .filter((p) => p.plannedSets > 0 && p.doneSets < p.plannedSets)
    .sort((a, b) => (order.get(a.sessionExerciseId) ?? 999) - (order.get(b.sessionExerciseId) ?? 999))
    .map((p): SummaryHighlight => {
      const kind = p.doneSets === 0 ? 'skipped' : 'cut_short';
      const meta = kind === 'skipped' ? 'Skipped' : 'Cut short';
      const value = `${String(p.doneSets)} of ${String(p.plannedSets)} sets`;
      return { key: `short:${p.sessionExerciseId}`, kind, ring: 'short', name: p.name, meta, value, spoken: `${p.name}, ${meta}, ${value}` };
    });
  const all = [...bests, ...short];
  return { shown: all.slice(0, SUMMARY_HIGHLIGHTS_SHOWN), more: all.slice(SUMMARY_HIGHLIGHTS_SHOWN) };
}

// ---------------------------------------------------------------------------
// Vs last time

export type VsLastTone = 'better' | 'less' | 'mixed' | 'same';

export interface VsLastRow {
  key: string;
  exerciseId: string;
  sessionExerciseId: string;
  name: string;
  /** `Last: 95 kg × 10 · Mon 9 Nov`. */
  last: string;
  /** Today's best working set: `97.5 kg × 8`. */
  today: string;
  /** `↑ 2.5 kg · 2 fewer reps`, `↑ 1 rep`, `=`, `↓ 1 rep`. */
  change: string;
  tone: VsLastTone;
  spoken: string;
}

/** How many `Vs last time` rows show before `+N more`. */
export const SUMMARY_VS_LAST_SHOWN = 4;

type TopSet = { load: Load | null; reps: number };

const isBw = (l: Load | null) => l === null || l.convention === 'bodyweight';

/** The best set: the heaviest (least assisted), then most reps. */
function bestOf(sets: readonly TopSet[], direction: 'resistance' | 'assistance'): TopSet | null {
  let best: TopSet | null = null;
  for (const s of sets) {
    if (best === null) {
      best = s;
      continue;
    }
    const a = isBw(s.load) ? 0 : (s.load?.value ?? 0);
    const b = isBw(best.load) ? 0 : (best.load?.value ?? 0);
    const harder = direction === 'resistance' ? a > b : a < b;
    if (harder || (a === b && s.reps > best.reps)) best = s;
  }
  return best;
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * The plain change from last time's best set to today's (Ben, 22 Nov): load first (`↑ 2.5 kg`; assisted: the
 * assistance's own direction, `↓ 5 kg assist`), then reps (`2 fewer reps`); reps alone `↑ 1 rep`; nothing `=`. The tone:
 * `better` for the same load with more reps, or more load (less assistance) with the same or more reps; `less` for the
 * reverse; `mixed` otherwise (no single verdict, no e1RM). Null: the two can't be compared (another unit or convention).
 */
export function vsLastChange(last: TopSet, today: TopSet, convention: LoadConvention): { text: string; spoken: string; tone: VsLastTone } | null {
  const lb = isBw(last.load) ? null : last.load;
  const tb = isBw(today.load) ? null : today.load;
  if ((lb === null) !== (tb === null) && !(convention === 'added' && (lb === null || tb === null))) return null;
  if (lb !== null && tb !== null && (lb.unit !== tb.unit || lb.convention !== tb.convention)) return null;
  const unit = tb?.unit ?? lb?.unit ?? 'kg';
  const dLoad = Math.round(((tb?.value ?? 0) - (lb?.value ?? 0)) * 1000) / 1000;
  const dReps = today.reps - last.reps;
  const assisted = (tb ?? lb)?.convention === 'assistance';
  const harder = dLoad === 0 ? 0 : (assisted ? dLoad < 0 : dLoad > 0) ? 1 : -1;
  const word = unit === 'kg' ? 'kilograms' : 'pounds';
  const loadPart = dLoad === 0 ? null : { text: `${dLoad > 0 ? '↑' : '↓'} ${formatNumber(Math.abs(dLoad))}${NBSP}${unit}${assisted ? `${NBSP}assist` : ''}`, spoken: `${dLoad > 0 ? 'up' : 'down'} ${formatNumber(Math.abs(dLoad))} ${word}${assisted ? ' of assistance' : ''}` };
  const r = Math.abs(dReps);
  let text: string;
  let spoken: string;
  if (loadPart === null && dReps === 0) {
    text = '=';
    spoken = 'same as last time';
  } else if (loadPart === null) {
    text = `${dReps > 0 ? '↑' : '↓'} ${plural(r, 'rep', 'reps')}`;
    spoken = `${plural(r, 'rep', 'reps')} ${dReps > 0 ? 'more' : 'fewer'}`;
  } else if (dReps === 0) {
    text = loadPart.text;
    spoken = loadPart.spoken;
  } else {
    const reps = `${String(r)} ${dReps > 0 ? 'more' : 'fewer'} ${r === 1 ? 'rep' : 'reps'}`;
    text = `${loadPart.text} · ${reps}`;
    spoken = `${loadPart.spoken}, ${reps}`;
  }
  const R = Math.sign(dReps);
  const tone: VsLastTone = harder === 0 && R === 0 ? 'same' : (harder === 0 && R > 0) || (harder > 0 && R >= 0) ? 'better' : (harder === 0 && R < 0) || (harder < 0 && R <= 0) ? 'less' : 'mixed';
  return { text, spoken, tone };
}

/**
 * `Vs last time` (Ben, 22 Nov): for each exercise done today (in order, measured in reps), its best working set
 * against the best working set the last time he did it like for like (`lastComparableSession`: same equipment,
 * unit and convention). Only sets that count (§2.13) on both sides. An exercise with nothing earlier, or no set to
 * compare, has no row. Last time's date in the workout's own zone (`Mon 9 Nov`).
 */
export function vsLastTime(input: { aggregate: SessionAggregate; history: Readonly<Record<string, readonly HistorySession[]>> }): VsLastRow[] {
  const state = input.aggregate;
  if (state.session.source === 'import') return [];
  const startMs = toMs(state.session.startedAt.utc);
  const tz = state.session.startedAt.tz;
  const seen = new Set<string>();
  const out: VsLastRow[] = [];
  for (const ex of [...state.exercises].sort((a, b) => a.order - b.order)) {
    if (seen.has(ex.exerciseId) || ex.measurement !== 'reps') continue;
    const sets = state.sets.filter((x: WorkoutSet) => x.sessionExerciseId === ex.id && x.status === 'completed' && x.actual !== null && x.setType !== 'warmup' && isSetCountable(x, 'comparison'));
    const todaySets = sets.flatMap((x): TopSet[] => (x.actual !== null && (x.actual.reps ?? 0) > 0 ? [{ load: x.actual.load, reps: x.actual.reps ?? 0 }] : []));
    const direction = loadDirection(ex.loadConvention);
    const today = bestOf(todaySets, direction);
    if (today === null) continue;
    const others = (input.history[ex.exerciseId] ?? []).filter((h) => h.sessionId !== state.session.id && toMs(h.performedAtUtc) < startMs && h.copy !== true);
    const prev = lastComparableSession(others, ex);
    if (prev === null) continue;
    const lastSets = prev.sets.filter((c) => isSetCountable(c, 'comparison')).flatMap((c): TopSet[] => ((c.values.reps ?? 0) > 0 ? [{ load: c.values.load, reps: c.values.reps ?? 0 }] : []));
    const last = bestOf(lastSets, direction);
    if (last === null) continue;
    const change = vsLastChange(last, today, ex.loadConvention);
    if (change === null) continue;
    seen.add(ex.exerciseId);
    const plates = isPlatesAddedKind(equipmentOfRow(state.session.equipmentSnapshot, ex)?.kind);
    const day = weekdayDayMonth(localDateOf(toMs(prev.performedAtUtc), tz));
    const lastText = summarySetText(last.load, last.reps, plates);
    const todayText = summarySetText(today.load, today.reps, plates);
    const plain = (s: string) => s.replaceAll(NBSP, ' ');
    out.push({
      key: ex.id,
      exerciseId: ex.exerciseId,
      sessionExerciseId: ex.id,
      name: ex.exerciseName,
      last: `Last: ${lastText} · ${day}`,
      today: todayText,
      change: change.text,
      tone: change.tone,
      spoken: `${ex.exerciseName}, today ${plain(todayText)}, last ${plain(lastText)} on ${day}, ${change.spoken}`,
    });
  }
  return out;
}
