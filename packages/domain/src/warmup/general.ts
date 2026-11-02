import {
  builderGroupOfMuscleGroup,
  GENERAL_WARMUP_LIMITS,
  muscleGroupOf,
  type BuilderGroup,
  type Exercise,
  type GeneralWarmupDays,
  type GeneralWarmupRule,
  type SessionAggregate,
  type SessionExercise,
  type UserProfile,
  type WorkoutSet,
} from '@fizz/schemas';
import { resolveRestPreset } from '../rest';
import { buildExecutionOrder } from '../session/order';

/**
 * (Ben, 2 Nov: "bike for 8 minutes first on leg days, rowing for 4 minutes first on other days") General (cardio)
 * warm-ups: a standing preference on the training profile (`warmups.general`), not part of any plan, so it survives
 * plan edits, a re-applied plan and a new plan. Pure.
 *
 * - **Leg day** (`workoutDayType`): each strength exercise counts its working sets for its lead group (the first primary
 *   muscle with a builder group, as the builder and the muscle count credit it). Lower body = the builder's `Legs`
 *   (quads, hamstrings, glutes, calves); upper body = Chest, Back, Shoulders, Arms; Core and anything without a group
 *   count for neither. More lower-body sets than upper-body: a leg day; fewer: another day. A tie (an even full-body or
 *   upper/lower day) goes by the first strength exercise: a lower-body first lift makes it a leg day. A workout with
 *   only core work is another day; one with no strength work at all (empty, cardio only) gets no general warm-up.
 * - **Rule** (`generalWarmupRuleFor`): the day's own rule (`legs` / `other`), else the `all` rule, else none.
 * - **Start** (`generalWarmupForSession`, `withGeneralWarmup`): every workout started (plan day, saved workout, coach
 *   built, repeat) gets the rule's exercise first, as one normal timed cardio set of its minutes, unless the workout
 *   already starts with cardio or already has that exercise (a repeat of a workout that had it, a plan day that starts
 *   with the bike). Ben logs it with the cardio timer, and can skip or remove it like any exercise.
 * - It never counts toward muscle sets, PBs or volume: cardio has no builder group, no record and no load.
 * - Time: it counts in every estimate (`generalWarmupSecondsFor` in the builder's estimate), so a time fit makes room
 *   for it by trimming other work. Because Ben set it, it is never cut for time (WU11's first cut stays for the code's
 *   own optional WU12 suggestion) and it sits outside D17's 10-minute allowance for warm-up sets (warm-up.md, WU12
 *   amendment, 2 Nov: Ben to confirm).
 */

export type WorkoutDayType = 'legs' | 'other';

/** One exercise as the leg-day rule reads it: its lead builder group (null: none, cardio) and its working sets. */
export interface DayTypeItem {
  group: BuilderGroup | null;
  sets: number;
}

const UPPER: ReadonlySet<BuilderGroup> = new Set(['Chest', 'Back', 'Shoulders', 'Arms']);

/** The lead builder group of an exercise: the first primary muscle with a builder group; null for none. */
export function leadBuilderGroup(e: Pick<Exercise, 'primaryMuscles' | 'measurement'>): BuilderGroup | null {
  if (e.measurement === 'cardio') return null;
  for (const m of e.primaryMuscles) {
    const g = muscleGroupOf(m);
    const b = g === null ? null : builderGroupOfMuscleGroup(g);
    if (b !== null) return b;
  }
  return null;
}

/** Leg day or not (see the module note); null when there is no strength work at all. */
export function workoutDayType(items: readonly DayTypeItem[]): WorkoutDayType | null {
  let lower = 0;
  let upper = 0;
  let core = 0;
  let first: BuilderGroup | null = null;
  for (const it of items) {
    if (it.group === null || it.sets <= 0) continue;
    if (it.group === 'Legs') lower += it.sets;
    else if (UPPER.has(it.group)) upper += it.sets;
    else core += it.sets;
    if (first === null && it.group !== 'Core') first = it.group;
  }
  if (lower === 0 && upper === 0) return core > 0 ? 'other' : null;
  if (lower !== upper) return lower > upper ? 'legs' : 'other';
  return first === 'Legs' ? 'legs' : 'other';
}

/** The rule for a day: its own (`legs` / `other`), else `all`, else null. */
export function generalWarmupRuleFor(rules: readonly GeneralWarmupRule[] | undefined, day: WorkoutDayType | null): GeneralWarmupRule | null {
  if (day === null || rules === undefined) return null;
  return rules.find((r) => r.days === day) ?? rules.find((r) => r.days === 'all') ?? null;
}

const live = (e: SessionExercise): boolean => e.removed === undefined;

/** A session's day type from its exercises (in order) and their planned working sets. */
export function sessionDayType(a: Pick<SessionAggregate, 'exercises' | 'sets'>, exerciseOf: (exerciseId: string) => Pick<Exercise, 'primaryMuscles' | 'measurement'> | null): WorkoutDayType | null {
  const rows = [...a.exercises].filter(live).sort((x, y) => x.order - y.order);
  return workoutDayType(
    rows.map((ex) => {
      const facts = exerciseOf(ex.exerciseId);
      const sets = a.sets.filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted' && s.setType !== 'warmup').length;
      return { group: facts === null || ex.measurement === 'cardio' ? null : leadBuilderGroup(facts), sets };
    }),
  );
}

/**
 * The rule a just-planned workout gets, or null: none set for its day; no strength work; it already starts with cardio
 * (a coach-added bike first, a plan day that starts on the rower, a repeat of a workout that had its warm-up); or the
 * rule's exercise is already in it.
 */
export function generalWarmupForSession(a: Pick<SessionAggregate, 'exercises' | 'sets'>, rules: readonly GeneralWarmupRule[] | undefined, exerciseOf: (exerciseId: string) => Pick<Exercise, 'primaryMuscles' | 'measurement'> | null): GeneralWarmupRule | null {
  if (rules === undefined || rules.length === 0) return null;
  const rows = [...a.exercises].filter(live).sort((x, y) => x.order - y.order);
  const head = rows[0];
  if (head === undefined || head.measurement === 'cardio') return null;
  const rule = generalWarmupRuleFor(rules, sessionDayType(a, exerciseOf));
  if (rule === null || rows.some((r) => r.exerciseId === rule.exerciseId)) return null;
  return rule;
}

export interface GeneralWarmupInsert {
  rule: GeneralWarmupRule;
  /** The rule's exercise (a cardio exercise). Anything else is refused: the workout is returned as it was. */
  exercise: Exercise;
  owner: Pick<UserProfile, 'defaultRest' | 'preferredUnit'>;
  newId: () => string;
}

/**
 * The workout with the general warm-up first: one pending cardio set of the rule's minutes, no load, no reps, the
 * exercise's own rest after it. Only for a workout just planned (no set done): one that has started is returned as it
 * was (rule 2), as is a rule whose exercise isn't cardio.
 */
export function withGeneralWarmup(a: SessionAggregate, input: GeneralWarmupInsert): SessionAggregate {
  const { exercise, rule } = input;
  if (exercise.measurement !== 'cardio' || exercise.id !== rule.exerciseId) return a;
  if (a.sets.some((s) => s.status !== 'pending' && s.status !== 'deleted')) return a;
  const minutes = Math.min(GENERAL_WARMUP_LIMITS.maxMinutes, Math.max(GENERAL_WARMUP_LIMITS.minMinutes, Math.round(rule.minutes)));
  const sessionId = a.session.id;
  const row: SessionExercise = {
    id: input.newId(),
    sessionId,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    measurement: exercise.measurement,
    laterality: exercise.laterality,
    equipmentId: null,
    loadConvention: exercise.defaultLoadConvention,
    unit: input.owner.preferredUnit,
    order: 0,
    supersetGroup: null,
    transitionRestS: null,
    progressionRuleId: null,
  };
  const set: WorkoutSet = {
    id: input.newId(),
    sessionId,
    sessionExerciseId: row.id,
    index: 0,
    setType: 'working',
    status: 'pending',
    side: null,
    pairedWithSetId: null,
    planned: { load: null, reps: null, durationS: minutes * 60, rpe: null, rir: null },
    rest: resolveRestPreset({ setType: 'working', exerciseName: exercise.name, setOverrideS: null, routineSetTypePreset: null, exerciseDefaultS: exercise.defaultRestS ?? null, globalDefault: input.owner.defaultRest }),
    actual: null,
    draft: null,
    completedAt: null,
    completedByOpId: null,
    undoCount: 0,
    flags: [],
    edited: false,
    version: 1,
  };
  const exercises = [row, ...a.exercises.map((e) => ({ ...e, order: e.order + 1 }))];
  const sets = [set, ...a.sets];
  const order = buildExecutionOrder(exercises.filter(live), sets.filter((s) => s.status !== 'deleted'));
  return { ...a, exercises, sets, session: { ...a.session, activeSetId: order[0] ?? a.session.activeSetId } };
}

const DAY_WORDS: Readonly<Record<GeneralWarmupDays, string>> = { legs: 'Leg days', other: 'Other days', all: 'Every day' };

/** `Leg days`, `Other days`, `Every day`. */
export function generalWarmupDaysText(days: GeneralWarmupDays): string {
  return DAY_WORDS[days];
}

/** Profile › Training's line: `Leg days · Bike 8 min · Other days · Rower 4 min`; `Off` with none. */
export function generalWarmupLine(rules: readonly GeneralWarmupRule[] | undefined, nameOf: (exerciseId: string) => string): string {
  if (rules === undefined || rules.length === 0) return 'Off';
  const order: GeneralWarmupDays[] = ['all', 'legs', 'other'];
  return [...rules]
    .sort((a, b) => order.indexOf(a.days) - order.indexOf(b.days))
    .map((r) => (rules.length === 1 && r.days === 'all' ? `${nameOf(r.exerciseId)} ${String(r.minutes)} min` : `${DAY_WORDS[r.days]} · ${nameOf(r.exerciseId)} ${String(r.minutes)} min`))
    .join(' · ');
}

/** One rule as a change line: `Leg days: Bike 8 min first`; `Other days: no cardio first`. */
export function generalWarmupChangeLine(days: GeneralWarmupDays, rule: Pick<GeneralWarmupRule, 'exerciseId' | 'minutes'> | null, nameOf: (exerciseId: string) => string): string {
  return rule === null ? `${DAY_WORDS[days]}: no cardio first` : `${DAY_WORDS[days]}: ${nameOf(rule.exerciseId)} ${String(rule.minutes)} min first`;
}

/**
 * The rules after a change naming some kinds of day (the coach's `general`, Profile's rows): a named day's rule is
 * replaced (minutes 0 or no exercise: removed); days not named keep theirs, except that a new `all` rule replaces the
 * `legs` and `other` rules not named with it ("row 5 minutes first every day"). Sorted all, legs, other. Pure.
 */
export function mergeGeneralWarmups(before: readonly GeneralWarmupRule[] | undefined, entries: readonly { days: GeneralWarmupDays; exerciseId: string | null; minutes: number }[]): GeneralWarmupRule[] {
  const named = new Set(entries.map((e) => e.days));
  const allSet = entries.some((e) => e.days === 'all' && e.exerciseId !== null && e.minutes > 0);
  const kept = (before ?? []).filter((r) => !named.has(r.days) && !(allSet && r.days !== 'all'));
  const added = entries.flatMap((e): GeneralWarmupRule[] => {
    if (e.exerciseId === null || e.minutes <= 0) return [];
    const minutes = Math.min(GENERAL_WARMUP_LIMITS.maxMinutes, Math.max(GENERAL_WARMUP_LIMITS.minMinutes, Math.round(e.minutes)));
    return [{ days: e.days, exerciseId: e.exerciseId, minutes }];
  });
  const byDays = new Map<GeneralWarmupDays, GeneralWarmupRule>();
  for (const r of [...kept, ...added]) byDays.set(r.days, r);
  const order: GeneralWarmupDays[] = ['all', 'legs', 'other'];
  return order.flatMap((d) => {
    const r = byDays.get(d);
    return r === undefined ? [] : [r];
  });
}

/** Words Ben uses for a cardio machine → its catalogue key; longer phrases first ("air bike" before "bike"). */
const CARDIO_ALIASES: readonly (readonly [RegExp, string])[] = [
  [/\b(?:air|assault|fan)[ -]?bike\b/, 'air-bike'],
  [/\bski[ -]?erg\b|\bski\b/, 'ski-erg'],
  [/\b(?:cross[ -]?trainer|elliptical)\b/, 'cross-trainer'],
  [/\bstair|stepper\b/, 'stair-climber'],
  [/\bincline walk|\bwalk(?:ing)?\b/, 'incline-walk'],
  [/\btreadmill|\brun(?:ning)?\b|\bjog(?:ging)?\b/, 'treadmill-run'],
  [/\brow(?:er|ing)?\b|\berg\b/, 'rowing-erg'],
  [/\bbike\b|\bbik(?:e|ing)\b|\bcycl(?:e|ing)\b|\bspin(?:ning)?\b/, 'exercise-bike'],
];

/**
 * (Ben, 2 Nov) The cardio exercise Ben's word names ("bike", "rowing", "Rowing machine", `rowing-erg`, an ID), among
 * `exercises` (his and the catalogue's; cardio only, not archived): an exact ID, catalogue key or name first, then the
 * usual machine for the word (bike → Exercise bike, air bike → Air bike, rowing → Rowing machine), then a name
 * containing his word.
 * Null: none. Pure.
 */
export function cardioExerciseFor<E extends Pick<Exercise, 'id' | 'name' | 'measurement' | 'catalogueKey' | 'archivedAtUtc'>>(word: string, exercises: readonly E[]): E | null {
  const pool = exercises.filter((e) => e.measurement === 'cardio' && e.archivedAtUtc === undefined);
  const w = word.trim().toLowerCase();
  if (w === '') return null;
  const exact = pool.find((e) => e.id === word.trim() || e.catalogueKey === w || e.name.toLowerCase() === w);
  if (exact !== undefined) return exact;
  for (const [re, key] of CARDIO_ALIASES) {
    if (!re.test(w)) continue;
    const hit = pool.find((e) => e.catalogueKey === key);
    if (hit !== undefined) return hit;
  }
  return pool.find((e) => e.name.toLowerCase().includes(w)) ?? null;
}

/** (Ben, 2 Nov) WU12's 3–5 minutes: a new rule's minutes when Ben picks a machine first. */
export const GENERAL_WARMUP_DEFAULT_MINUTES = 5;

/**
 * (Ben, 2 Nov) Profile › Cardio first's `Same every day`: on, one `all` rule (the leg-day one, else the other-day one);
 * off, that rule for leg days and for other days. Rules already that way are returned as they are. Pure.
 */
export function generalWarmupsEveryDay(rules: readonly GeneralWarmupRule[] | undefined, on: boolean): GeneralWarmupRule[] {
  const list = [...(rules ?? [])];
  if (on) {
    const pick = list.find((r) => r.days === 'all') ?? list.find((r) => r.days === 'legs') ?? list.find((r) => r.days === 'other');
    return pick === undefined ? [] : [{ ...pick, days: 'all' }];
  }
  const all = list.find((r) => r.days === 'all');
  if (all === undefined) return list;
  return mergeGeneralWarmups(list.filter((r) => r.days !== 'all'), [
    ...(list.some((r) => r.days === 'legs') ? [] : [{ days: 'legs' as const, exerciseId: all.exerciseId, minutes: all.minutes }]),
    ...(list.some((r) => r.days === 'other') ? [] : [{ days: 'other' as const, exerciseId: all.exerciseId, minutes: all.minutes }]),
  ]);
}
