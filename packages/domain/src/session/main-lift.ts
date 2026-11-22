import type { Routine, RoutineExercise, SessionAggregate, WorkoutSession } from '@fizz/schemas';

/**
 * (Ben, 1 Nov: "You should be able to change it whenever.") `Make main lift`: one main lift per day. The exercise Ben
 * picks becomes the day's main lift; the one before becomes a normal compound and keeps its sets; nothing else
 * changes (every set keeps its planned values, a done set is never touched: rule 2). The same rule for a plan day's
 * template (Every week), today's Your workout draft and the live workout. Pure.
 */

/**
 * The day's name with its main lift's: `Push B · bench press` → `Push B · incline barbell press` (as `withMainLift`
 * names a template, lower case after the day). A name with no `·` part (a saved workout's own name) stays.
 */
export function mainLiftDayName(name: string, liftName: string): string {
  const parts = name.split('·').map((x) => x.trim());
  const day = parts[0] ?? '';
  return parts.length > 1 && day !== '' ? `${day} · ${liftName.toLowerCase()}`.slice(0, 120) : name;
}

/**
 * `withOneMainLift`: the list with `id`'s entry as its only main lift (`main: true`) and every other entry not
 * (`main: false`, so the editor's default rule never makes a second one). Sets, order, supersets and everything else
 * as they were. Null: no such entry. `same`: it already was the only main lift.
 */
export function withOneMainLift<T extends { id: string; main?: boolean | undefined }>(list: readonly T[], id: string): T[] | null | 'same' {
  if (!list.some((e) => e.id === id)) return null;
  if (list.every((e) => (e.id === id ? e.main === true : e.main === false))) return 'same';
  return list.map((e) => ({ ...e, main: e.id === id }));
}

/**
 * `templateWithMainLift` (Every week): the plan day's template with the entry `rowId` as its main lift
 * (`withOneMainLift`), the template's key (`planDay.mainLiftExerciseId`) and name (`Push B · <lift>`) following, so
 * Today's `Main lift` row, the next workout's top set and back-offs, its rest and block progress all read the new one.
 * A saved workout (no plan day) keeps its own name. Null: no such entry, or nothing would change.
 */
export function templateWithMainLift(r: Pick<Routine, 'exercises' | 'name' | 'planDay'>, m: { rowId: string; liftName: string }): { exercises: RoutineExercise[]; name: string; planDay: Routine['planDay'] } | null {
  const row = r.exercises.find((e) => e.id === m.rowId);
  const list = withOneMainLift(r.exercises, m.rowId);
  if (row === undefined || list === null) return null;
  const keyed = r.planDay === undefined || r.planDay.mainLiftExerciseId === row.exerciseId;
  if (list === 'same' && keyed) return null;
  const exercises = list === 'same' ? [...r.exercises] : list;
  const planDay = r.planDay === undefined ? undefined : { ...r.planDay, mainLiftExerciseId: row.exerciseId };
  const name = r.planDay === undefined ? r.name : mainLiftDayName(r.name, m.liftName);
  return { exercises, name, planDay };
}

/**
 * Another live template of the same plan day already has that main lift (Today's `Main lift` chips pick it): the
 * template's key can't take it (one live template per plan day and main lift). Pure.
 */
export function mainLiftTemplateClash(r: Pick<Routine, 'id' | 'planDay'>, others: readonly Pick<Routine, 'id' | 'planDay' | 'deletedAtUtc'>[], exerciseId: string): boolean {
  const k = r.planDay;
  if (k === undefined) return false;
  return others.some((x) => x.id !== r.id && (x.deletedAtUtc ?? null) === null && x.planDay !== undefined && x.planDay.planId === k.planId && x.planDay.dayIndex === k.dayIndex && x.planDay.mainLiftExerciseId === exerciseId);
}

/**
 * Today's main lift of a live workout: Ben's own pick (`planDay.mainLiftChange`) first; else null (the workout's own
 * rules: the draft's main slots, the plan day's main lift).
 */
export function pickedMainLift(s: Pick<WorkoutSession, 'planDay'>): string | null {
  const p = s.planDay;
  return p?.mainLiftChange === undefined ? null : (p.mainLiftExerciseId ?? null);
}

/** What the live workout's `Make main lift` acts on. */
export interface MainLiftOffer {
  /** Today's main lift now (exercise ID), or null. */
  current: string | null;
  /** Whether the row can be made the main lift: a plan workout, a live strength row that isn't the main lift. */
  can: boolean;
}

/**
 * Whether `Make main lift` shows for a row of the live workout: only on a workout started as a plan day (Every week
 * has a template to go to), on a live row measured in reps that isn't today's main lift already and has a set left.
 * `compound`: the row's exercise is a compound (an isolation is never made the main lift, as Summary's SP7 row).
 */
export function mainLiftOffer(a: Pick<SessionAggregate, 'session' | 'exercises' | 'sets'>, sessionExerciseId: string, mains: ReadonlySet<string>, compound: boolean): MainLiftOffer {
  const current = [...mains][0] ?? null;
  const row = a.exercises.find((e) => e.id === sessionExerciseId);
  const can =
    a.session.status === 'active' &&
    a.session.planDay !== undefined &&
    row !== undefined &&
    row.removed === undefined &&
    row.measurement === 'reps' &&
    compound &&
    !mains.has(row.exerciseId) &&
    a.sets.some((s) => s.sessionExerciseId === row.id && s.status === 'pending');
  return { current, can };
}

export const MAIN_LIFT_COPY = {
  make: 'Make main lift',
  everyWeek: 'Every week?',
  made: (lift: string) => `${lift} · main lift`,
  madeEveryWeek: (lift: string) => `${lift} · main lift every week`,
  undo: 'Undo',
  clash: 'This day already has a workout for that lift.',
  notInPlan: 'Not in this plan day.',
  changed: 'Changed since. Try again.',
} as const;

/**
 * (Ben, 1 Nov) A plan day's template saved from the editor after `Make main lift`: when its key's main lift is no
 * longer `Main` and exactly one entry is, the key and name follow that one (as `templateWithMainLift`). Otherwise (no
 * plan day, the key's lift still main, no single main) the routine as it is.
 */
export function followMainLift<R extends Pick<Routine, 'exercises' | 'name' | 'planDay'>>(r: R, liftName: (exerciseId: string) => string): R {
  const k = r.planDay;
  if (k === undefined) return r;
  const mains = r.exercises.filter((e) => e.main === true);
  const only = mains.length === 1 ? mains[0] : undefined;
  if (only === undefined || only.exerciseId === k.mainLiftExerciseId) return r;
  if (r.exercises.some((e) => e.exerciseId === k.mainLiftExerciseId && e.main !== false)) return r;
  return { ...r, name: mainLiftDayName(r.name, liftName(only.exerciseId)), planDay: { ...k, mainLiftExerciseId: only.exerciseId } };
}
