import type { PlanBuilderAnswers } from '@fizz/schemas';
import { kitAbove, kitBelow, kitDown, pbBackOff, pbLowerBackOff, pbMainLine, type PlanKit } from './loads';
import type { PbExercise } from './engine';
import { PB_EFFORT, PB_FOCUS_GAIN } from './tables';

/**
 * Weekly progression across the plan (§2 "Weekly progression and the week strip"; the prototype's `atWeek`). Pure.
 * These are planned targets: in the app each week follows what Ben actually lifted (history-target rules).
 *
 * - Barbell (and stack) main lifts rise at the effort's weekly rate × the focus's multiplier, snapped down to an
 *   achievable load; dumbbell main lifts add reps first (6 → 7 → 8), then the next dumbbell. Never past the item's
 *   max (rule 4): at the max the load holds.
 * - Accessories: double progression (a rep a week to the top of the range, then one achievable step and back to the
 *   bottom).
 * - Deload weeks (Standard: the last week of 4+; Push: every 4th; Maintain: none) take ~10 % off and one set fewer
 *   per exercise, never below 2 (main lifts keep the top set, one back-off fewer; training-blocks §2.3 Q3, Ben 21 Oct,
 *   which supersedes the prototype's "about a third of the sets"); back-offs come down by the same −10 % (D4, SS4,
 *   HT8). Maintain holds weights. The Today drafter's deload (`deloadSetCount`) uses the same set count.
 */

/** (Ben, 21 Oct, Q3) A deload week's working sets: one fewer, never below 2 (or below what there was). */
export function deloadSetCount(sets: number): number {
  return Math.max(Math.min(2, sets), sets - 1);
}

export function pbIsDeload(a: Pick<PlanBuilderAnswers, 'effort' | 'weeks'>, w: number): boolean {
  if (a.effort === 'standard') return a.weeks >= 4 && w === a.weeks;
  if (a.effort === 'push') return w % 4 === 0;
  return false;
}

export function pbDeloadWeeks(a: Pick<PlanBuilderAnswers, 'effort' | 'weeks'>): number[] {
  return Array.from({ length: a.weeks }, (_, i) => i + 1).filter((w) => pbIsDeload(a, w));
}

/** Progression weeks before week `w` (deloads don't count). */
export function pbProgWeeks(a: Pick<PlanBuilderAnswers, 'effort' | 'weeks'>, w: number): number {
  let k = 0;
  for (let i = 1; i < w; i += 1) if (!pbIsDeload(a, i)) k += 1;
  return k;
}

export interface PbWeekTarget {
  week: number;
  deload: boolean;
  sets: number;
  reps: number;
  /** Working load (main: the top set); null: bodyweight or none. */
  load: number | null;
  /** Main lifts: back-offs. */
  backs: number;
  back: number | null;
  backReps: number;
  /** `1 × 6 + 2 × 8 · 102.5 / 95`, or `3 × 10`. */
  line: string;
}

/** One exercise's planned target in week `w` (1-based). `kit`: its item here, null for bodyweight. */
export function pbAtWeek(a: Pick<PlanBuilderAnswers, 'effort' | 'weeks' | 'focus'>, e: PbExercise, kit: PlanKit | null, w: number): PbWeekTarget {
  const k = a.effort === 'maintain' ? 0 : pbProgWeeks(a, w);
  const dl = pbIsDeload(a, w);
  const load0 = e.load.kind === 'kg' ? e.load.value : null;
  if (e.role === 'main' && (e.bodyweightMain || e.main === null)) {
    const reps = e.reps + Math.min(k, 4);
    const sets = dl ? deloadSetCount(e.sets) : e.sets;
    return { week: w, deload: dl, sets, reps, load: load0, backs: 0, back: null, backReps: reps, line: `${String(sets)} × ${String(reps)}` };
  }
  if (e.role === 'main' && e.main !== null) {
    const m = e.main;
    const perHand = kit?.convention === 'per_hand';
    if (m.top === null || kit === null) {
      const backs = dl ? Math.max(Math.min(1, m.backs), m.backs - 1) : m.backs;
      return { week: w, deload: dl, sets: backs + 1, reps: m.reps, load: null, backs, back: null, backReps: 8, line: pbMainLine(null, null, m.reps, backs, 8, perHand) };
    }
    let top = m.top;
    let reps = m.reps;
    if (perHand) {
      // Reps first, 6 → 7 → 8, then the next dumbbell; at the rack's heaviest the reps hold at +2.
      let steps = Math.floor(k / 3);
      let done = 0;
      while (steps > 0) {
        const up = kitAbove(kit, top);
        if (up === null) break;
        top = up;
        steps -= 1;
        done += 1;
      }
      reps = m.reps + Math.min(2, k - 3 * done);
    } else {
      const rate = PB_EFFORT[a.effort].pct * PB_FOCUS_GAIN[a.focus];
      top = Math.max(m.top, kitDown(kit, m.top * (1 + rate * k)) ?? m.top);
    }
    const bo = pbBackOff(kit, top, reps, 8, a.focus);
    let back = bo.back;
    const backReps = bo.reps;
    if (dl) {
      const lowered = kitDown(kit, top * 0.9) ?? kitBelow(kit, top) ?? top;
      back = pbLowerBackOff(kit, back, 0.9, lowered);
      top = lowered;
    }
    const backs = dl ? Math.max(Math.min(1, m.backs), m.backs - 1) : m.backs;
    return { week: w, deload: dl, sets: backs + 1, reps, load: top, backs, back, backReps, line: pbMainLine(top, back, reps, backs, backReps, perHand) };
  }
  // Accessories: double progression.
  const lo = e.reps <= 12 ? 8 : 12;
  const hi = e.reps <= 12 ? 12 : 15;
  let reps = Math.max(lo, Math.min(hi, e.reps));
  let kg = load0;
  const harder = (x: number): number | null => (kit === null ? null : kit.convention === 'assistance' ? kitBelow(kit, x) : kitAbove(kit, x));
  for (let i = 0; i < k; i += 1) {
    if (reps < hi || kg === null) reps = Math.min(hi, reps + 1);
    else {
      const up = harder(kg);
      if (up === null) reps = hi;
      else {
        kg = up;
        reps = lo;
      }
    }
  }
  if (dl && kg !== null && kit !== null && kit.convention !== 'assistance') kg = kitDown(kit, kg * 0.9) ?? kg;
  const sets = dl ? deloadSetCount(e.sets) : e.sets;
  return { week: w, deload: dl, sets, reps, load: kg, backs: 0, back: null, backReps: reps, line: `${String(sets)} × ${String(reps)}` };
}
