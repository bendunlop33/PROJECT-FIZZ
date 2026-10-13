import type { EquipmentInstance, Load, SessionAggregate, SessionExercise } from '@fizz/schemas';
import { formatNumber, NBSP } from './display';
import { isSetCountable } from './exclusions';
import { buildPlateSetup, roundToAvailableLoad } from './equipment';
import { matchesEquipment, type HistorySession } from './progression';
import { toMs } from './time';
import { toScaled } from './units';

/**
 * Small, honest extras (critic-pass-1 #4, #10): the plate breakdown under a
 * barbell load, a built-in warm-up ramp suggestion, and one like-for-like
 * highlight on the Summary. All deterministic; nothing is invented.
 */

/**
 * `20 bar + 25 + 10 + 2.5 / side` for a barbell, `20 + 10 / side` for a
 * two-sided plate-loaded machine. Null when the load isn't plate-loaded or
 * can't be made from this inventory (the off-profile warning covers that).
 */
export function plateBreakdownLine(load: Load | null, eq: EquipmentInstance | null): string | null {
  if (load === null || eq === null || (eq.kind !== 'barbell' && eq.kind !== 'plate_loaded_machine')) return null;
  if (load.unit !== eq.unit || load.convention !== eq.loadConvention) return null;
  const r = buildPlateSetup({ value: load.value, unit: load.unit }, eq);
  if (!r.ok) return null;
  const plates = r.perSide.flatMap((p) => Array.from({ length: p.count }, () => formatNumber(p.mass)));
  const side = r.sides === 2 ? `${NBSP}/${NBSP}side` : `${NBSP}on the horn`;
  if (eq.kind === 'barbell') {
    const bar = `${formatNumber(eq.barMass)} bar`;
    return plates.length === 0 ? `Just the bar (${formatNumber(eq.barMass)}${NBSP}${eq.unit})` : `${bar} + ${plates.join(' + ')}${side}`;
  }
  return plates.length === 0 ? 'No plates' : `${plates.join(' + ')}${side}`;
}

export interface WarmUpStep {
  load: number;
  reps: number;
}

/** Built-in ramp: the bar for 10, then about 40 %, 60 % and 80 % of the working load. Not a prescription. */
const RAMP: readonly { pct: number; reps: number }[] = [
  { pct: 0.4, reps: 5 },
  { pct: 0.6, reps: 3 },
  { pct: 0.8, reps: 2 },
];

/**
 * Warm-up ramp for a barbell working load: every step rounded down to a load
 * this bar can make, strictly lighter than the working load, no repeats.
 * Empty when the working load is the bar or close to it.
 */
export function warmUpRamp(workingLoad: Load | null, eq: EquipmentInstance | null): WarmUpStep[] {
  if (workingLoad === null || eq?.kind !== 'barbell' || workingLoad.unit !== eq.unit || workingLoad.convention !== 'total') return [];
  const work = toScaled(workingLoad.value);
  const bar = toScaled(eq.barMass);
  if (work <= bar) return [];
  const steps: WarmUpStep[] = [{ load: eq.barMass, reps: 10 }];
  for (const r of RAMP) {
    const rounded = roundToAvailableLoad({ value: workingLoad.value * r.pct, unit: eq.unit, convention: 'total' }, eq, 'down');
    if (!rounded.ok) continue;
    const v = toScaled(rounded.load.value);
    const last = toScaled(steps[steps.length - 1]?.load ?? 0);
    if (v > last && v < work) steps.push({ load: rounded.load.value, reps: r.reps });
  }
  return steps;
}

/** `Warm-up suggestion: bar × 10 · 40 × 5 · 60 × 3 · 80 × 2 (kg)` */
export function warmUpText(steps: readonly WarmUpStep[], eq: EquipmentInstance): string | null {
  if (steps.length < 2 || eq.kind !== 'barbell') return null;
  const parts = steps.map((s, i) => `${i === 0 ? 'bar' : formatNumber(s.load)}${NBSP}×${NBSP}${String(s.reps)}`);
  return `${parts.join(' · ')} (${eq.unit})`;
}

/**
 * Should the warm-up suggestion show on this set? Only on the first working
 * set of the session's first barbell exercise, before anything of it is
 * logged, and only when the plan has no warm-up sets of its own.
 */
export function showsWarmUp(state: SessionAggregate, setId: string): boolean {
  const set = state.sets.find((s) => s.id === setId);
  if (!set || set.status !== 'pending' || set.setType === 'warmup') return false;
  const barbellExercises = [...state.exercises]
    .sort((a, b) => a.order - b.order)
    .filter((e) => e.equipmentId !== null && state.session.equipmentSnapshot.some((q) => q.id === e.equipmentId && q.kind === 'barbell'));
  const first = barbellExercises[0];
  if (!first || first.id !== set.sessionExerciseId) return false;
  const own = state.sets.filter((s) => s.sessionExerciseId === first.id && s.status !== 'deleted');
  if (own.some((s) => s.setType === 'warmup' || s.status === 'completed')) return false;
  const firstWork = [...own].sort((a, b) => a.index - b.index).find((s) => s.setType !== 'warmup');
  return firstWork?.id === setId;
}

/**
 * One honest Summary highlight (workout-summary region 4, critic #10):
 * like-for-like only (same equipment, unit and convention, working sets),
 * against at least one earlier comparable workout. In order: heaviest set
 * ever on this equipment; most reps at a load done before; most volume.
 * Null when nothing qualifies; nothing is invented or estimated.
 */
export function summaryHighlight(state: SessionAggregate, history: Readonly<Record<string, readonly HistorySession[]>>): string | null {
  const exercises = [...state.exercises].sort((a, b) => a.order - b.order);
  const startedMs = toMs(state.session.startedAt.utc);
  const candidates: { rank: number; text: string }[] = [];
  for (const ex of exercises) {
    if (ex.loadConvention === 'bodyweight' || ex.loadConvention === 'assistance' || ex.measurement !== 'reps') continue;
    const today = state.sets
      // A record: sets Ben left out (§2.13) never count, today or before.
      .filter((s) => s.sessionExerciseId === ex.id && s.status === 'completed' && s.setType !== 'warmup' && isSetCountable(s, 'record') && s.actual?.load && s.actual.reps !== null)
      .map((s) => ({ load: s.actual?.load?.value ?? 0, reps: s.actual?.reps ?? 0, unit: s.actual?.load?.unit, convention: s.actual?.load?.convention }))
      .filter((s) => s.unit === ex.unit && s.convention === ex.loadConvention);
    if (today.length === 0) continue;
    const before = (history[ex.exerciseId] ?? [])
      // B7: FitNotes history (no equipment recorded) counts too, so a claim must beat it as well.
      .filter((h) => h.sessionId !== state.session.id && matchesEquipment(h, ex.equipmentId) && toMs(h.performedAtUtc) < startedMs)
      .map((h) => h.sets.filter((s) => s.setType !== 'warmup' && isSetCountable(s, 'record') && s.load !== null && s.reps !== null && s.load.unit === ex.unit && s.load.convention === ex.loadConvention))
      .filter((sets) => sets.length > 0);
    if (before.length === 0) continue;
    const prevSets = before.flat();
    const where = whereText(ex, state);
    const u = `${NBSP}${ex.unit}${ex.loadConvention === 'per_hand' ? ' each' : ex.loadConvention === 'stack' ? ' stack' : ex.loadConvention === 'added' ? ' plates' : ''}`;
    const top = today.reduce((b, s) => (s.load > b.load || (s.load === b.load && s.reps > b.reps) ? s : b));
    const prevMax = Math.max(...prevSets.map((s) => s.load?.value ?? 0));
    if (toScaled(top.load) > toScaled(prevMax)) {
      candidates.push({ rank: 0, text: `Heaviest ${ex.exerciseName} set${where}: ${formatNumber(top.load)}${u} × ${String(top.reps)}` });
      continue;
    }
    const repsAt = (load: number) => Math.max(0, ...prevSets.filter((s) => toScaled(s.load?.value ?? -1) === toScaled(load)).map((s) => s.reps ?? 0));
    const moreReps = today.filter((s) => prevSets.some((p) => toScaled(p.load?.value ?? -1) === toScaled(s.load)) && s.reps > repsAt(s.load)).sort((a, b) => b.load - a.load)[0];
    if (moreReps) {
      candidates.push({ rank: 1, text: `Most reps at ${formatNumber(moreReps.load)}${u} on ${ex.exerciseName}${where}: ${String(moreReps.reps)}` });
      continue;
    }
    const volume = today.reduce((n, s) => n + s.load * s.reps, 0);
    const prevVolume = Math.max(...before.map((sets) => sets.reduce((n, s) => n + (s.load?.value ?? 0) * (s.reps ?? 0), 0)));
    if (volume > prevVolume && ex.laterality === 'bilateral') {
      candidates.push({ rank: 2, text: `Most ${ex.exerciseName} volume${where}: ${formatNumber(Math.round(volume))}${u} (working sets)` });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  return candidates[0]?.text ?? null;
}

function whereText(ex: SessionExercise, state: SessionAggregate): string {
  const eq = ex.equipmentId === null ? null : state.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId);
  return eq ? ` on ${eq.name}` : '';
}
