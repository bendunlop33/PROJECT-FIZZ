import type { RoutineExercise, SetTemplate } from '@fizz/schemas';

import { FIT_RULES, FIT_SET_VALUE, clampMinutes, type BuilderFitStep } from '../builder/fit';
import { restTableOf, type RestDefaults } from '../builder/rest';

/**
 * (Ben, 26 Oct; app review finding 6) The one editor's `Time` control: a saved workout or plan day has no length of
 * its own, so `Time ±` fits the template's sets and rests to the next 5-minute step, the way Your workout's fit does
 * (`fitToMinutes`), as edits on the page that Ben then saves (or Cancels). Nothing is written here.
 *
 * Shorter, only as far as needed:
 *   (a) shorter rests on the accessories' working sets (`restTableOf('shorter')` from Ben's Rest times; standard: compound 1:30, isolation 1:15;
 *       a rest already shorter stays);
 *   (b) the least training lost: one working set off an accessory (never below 2), or an accessory at 2 sets left
 *       out, each time the cut that loses least value per second saved (`FIT_SET_VALUE`: compound 3, abs 2.5,
 *       isolation 2); ties go to the later exercise. The main lifts are never cut; one exercise always stays.
 * Longer: +1 working set on the accessories (max 4), most valuable first, while it still fits.
 * The estimate is the editor's own (`estimateS`, the same one its `about N min` shows), so the number Ben sees is the
 * number the fit aimed at. Still over at the least: `over`.
 */

export interface TemplateFitInput {
  exercises: readonly RoutineExercise[];
  /** The length asked for (clamped 15–180). */
  minutes: number;
  /** Each exercise's `Main` (`mainFlags`): never cut, rests never shortened. */
  main: readonly boolean[];
  isCompound: (exerciseId: string) => boolean;
  isCore: (exerciseId: string) => boolean;
  /** The rest a working set gets when nothing on the exercise says otherwise (the editor's global default). */
  defaultRestS: number;
  /** (Ben, 28 Oct) Ben's default rests (Profile › Rest times): the shorter level scales from them. Absent: standard. */
  restDefaultsS?: RestDefaults;
  /** The template's estimated length, in seconds. */
  estimateS: (exercises: readonly RoutineExercise[]) => number;
  newId: () => string;
}

export type TemplateFitStatus = 'fits' | 'fitted' | 'over';

export interface TemplateFitResult {
  exercises: RoutineExercise[];
  /** In Your workout's words (`fitNoteOf`): `rest`, `sets`, `drop`; `slotKey` is the routine exercise's ID. */
  steps: BuilderFitStep[];
  status: TemplateFitStatus;
  seconds: number;
}

const workingOf = (e: RoutineExercise): SetTemplate[] => e.setTemplates.filter((t) => t.setType === 'working');

function setValue(input: TemplateFitInput, exerciseId: string): number {
  if (input.isCore(exerciseId)) return FIT_SET_VALUE.abs;
  return input.isCompound(exerciseId) ? FIT_SET_VALUE.compound : FIT_SET_VALUE.isolation;
}

/** The working sets without the last one. */
function withoutLastWorking(e: RoutineExercise): RoutineExercise {
  const at = e.setTemplates.map((t) => t.setType).lastIndexOf('working');
  return at < 0 ? e : { ...e, setTemplates: e.setTemplates.filter((_, i) => i !== at) };
}

/** One more working set, a copy of the last (its reps, effort, rest, load). */
function withOneMoreWorking(e: RoutineExercise, newId: () => string): RoutineExercise {
  const at = e.setTemplates.map((t) => t.setType).lastIndexOf('working');
  const last = e.setTemplates[at];
  if (last === undefined) return e;
  const sets = [...e.setTemplates];
  sets.splice(at + 1, 0, { ...last, id: newId() });
  return { ...e, setTemplates: sets };
}

/** Shorter rests on an accessory's working sets; null when nothing on it is longer than the shorter level. */
function withShorterRests(e: RoutineExercise, compound: boolean, defaultRestS: number, defaults?: RestDefaults): RoutineExercise | null {
  const shorter = restTableOf('shorter', defaults);
  const to = compound ? shorter.workingCompound : shorter.workingIsolation;
  const preset = e.restBySetType.working?.seconds ?? defaultRestS;
  const overLong = e.setTemplates.some((t) => t.setType === 'working' && t.restOverrideS !== null && t.restOverrideS > to);
  if (preset <= to && !overLong) return null;
  return {
    ...e,
    restBySetType: preset > to ? { ...e.restBySetType, working: { seconds: to } } : e.restBySetType,
    setTemplates: e.setTemplates.map((t) => (t.setType === 'working' && t.restOverrideS !== null && t.restOverrideS > to ? { ...t, restOverrideS: to } : t)),
  };
}

/** The list without one exercise; a superset it leaves with one member is that one alone. */
function withoutExercise(list: readonly RoutineExercise[], at: number): RoutineExercise[] {
  const gone = list[at];
  const rest = list.filter((_, j) => j !== at);
  const label = gone?.supersetGroup ?? null;
  if (label === null || rest.filter((e) => e.supersetGroup === label).length !== 1) return rest;
  return rest.map((e) => (e.supersetGroup === label ? { ...e, supersetGroup: null } : e));
}

export function fitTemplateToMinutes(input: TemplateFitInput): TemplateFitResult {
  const limitS = clampMinutes(input.minutes) * 60 + 29;
  let list = input.exercises.map((e) => ({ ...e }));
  // Main flags travel with the exercise, not its index (an exercise left out shifts the rest).
  const mainIds = new Set(input.exercises.filter((_, i) => input.main[i] === true).map((e) => e.id));
  const isMain = (e: RoutineExercise) => mainIds.has(e.id);
  const est = (l: readonly RoutineExercise[]) => input.estimateS(l);
  let secs = est(list);
  const steps: BuilderFitStep[] = [];
  const counts = new Map(input.exercises.map((e) => [e.id, workingOf(e).length]));
  const result = (status: TemplateFitStatus): TemplateFitResult => {
    // One `sets` line per exercise, from what it had to what it has (Your workout's wording).
    const setSteps: BuilderFitStep[] = [];
    for (const e of list) {
      const from = counts.get(e.id) ?? 0;
      const to = workingOf(e).length;
      if (from !== to) setSteps.push({ kind: 'sets', slotKey: e.id, exerciseId: e.exerciseId, from, to });
    }
    return { exercises: list, steps: [...steps, ...setSteps], status, seconds: secs };
  };

  if (secs <= limitS) {
    // Longer: one more working set on the most valuable accessory that still fits, again and again (max 4).
    let grew = false;
    for (;;) {
      const options = list
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => !isMain(e) && workingOf(e).length > 0 && workingOf(e).length < FIT_RULES.maxAccessorySets)
        .sort((a, b) => setValue(input, b.e.exerciseId) - setValue(input, a.e.exerciseId) || workingOf(a.e).length - workingOf(b.e).length || a.i - b.i);
      let added = false;
      for (const { e, i } of options) {
        const next = list.map((x, j) => (j === i ? withOneMoreWorking(e, input.newId) : x));
        const s = est(next);
        if (s <= limitS) {
          list = next;
          secs = s;
          added = true;
          grew = true;
          break;
        }
      }
      if (!added) break;
    }
    return result(grew ? 'fitted' : 'fits');
  }

  // (a) Shorter rests on the accessories.
  const rested = list.map((e) => (isMain(e) ? e : (withShorterRests(e, input.isCompound(e.exerciseId), input.defaultRestS, input.restDefaultsS) ?? e)));
  if (rested.some((e, i) => e !== list[i])) {
    steps.push({ kind: 'rest', from: 'normal', to: 'shorter' });
    list = rested;
    secs = est(list);
    if (secs <= limitS) return result('fitted');
  }

  // (b) The least training lost, one cut at a time: a cut that fits now, the one losing least; else the cut losing
  // least per second saved, and again. So it cuts only as far as needed.
  for (;;) {
    let best: { next: RoutineExercise[]; secs: number; cost: number; drop: RoutineExercise | null } | null = null;
    let finish: { next: RoutineExercise[]; secs: number; lost: number; drop: RoutineExercise | null } | null = null;
    for (const [i, e] of list.entries()) {
      if (isMain(e)) continue;
      const n = workingOf(e).length;
      if (n === 0) continue;
      const value = setValue(input, e.exerciseId);
      const dropping = n <= FIT_RULES.minAccessorySets;
      if (dropping && list.length <= 1) continue;
      const next = dropping ? withoutExercise(list, i) : list.map((x, j) => (j === i ? withoutLastWorking(x) : x));
      const s = est(next);
      const saved = secs - s;
      if (saved <= 0) continue;
      const lost = dropping ? value * n : value;
      const cost = lost / saved;
      // Ties: the later exercise (`<=` as the loop goes forward).
      if (s <= limitS && (finish === null || lost <= finish.lost)) finish = { next, secs: s, lost, drop: dropping ? e : null };
      if (best === null || cost <= best.cost) best = { next, secs: s, cost, drop: dropping ? e : null };
    }
    if (finish !== null) best = { ...finish, cost: 0 };
    if (best === null) return result('over');
    if (best.drop !== null) {
      steps.push({ kind: 'drop', slotKey: best.drop.id, exerciseId: best.drop.exerciseId });
      counts.delete(best.drop.id);
    }
    list = best.next;
    secs = best.secs;
    if (secs <= limitS) return result('fitted');
  }
}
