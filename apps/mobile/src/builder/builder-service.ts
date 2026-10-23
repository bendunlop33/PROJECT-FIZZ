import {
  adviseBuilder,
  alignToDraft,
  applyBuilderEdit,
  applyVariation,
  builderLoad,
  slotLoadOf,
  slotRepsWhy,
  infoOrDefault,
  isTimedSlot,
  reloadSlotLoads,
  slotAtNewGym,
  fitPlannedSlotHere,
  PLANNED_HELD_LINE,
  buildFromSetup,
  builderChangeLine,
  builderChanges,
  builderDraftEdit,
  builderDraftUndo,
  builderSetupOf,
  CUSTOM_DAY_ID,
  TODAY_OTHER_SESSIONS,
  todayContentHash,
  todayDraftState,
  currentDraftVersion,
  defaultRestS,
  deriveId,
  draftAsRoutine,
  estimateBuilderMinutes,
  fromDraftPlan,
  groupsOfParts,
  groupsToAdd,
  localDateOf,
  mergeSetupChange,
  mixForDay,
  newBuilderDraft,
  partsLabel,
  planDayKeyOf,
  planRoutines,
  PRESET_SPLITS,
  recommendForSetup,
  restRoleOf,
  roundRestOf,
  ruleSetupOf,
  slotsOf,
  stableStringify,
  storedGroupsOf,
  suggestVariationLabel,
  toDraftPlan,
  toMs,
  variationExtrasOf,
  withSlotRevs,
  workingCount,
  workoutFromTemplate,
  specsFromSession,
  specsFromWorkout,
  isDeleted,
  checkedOnOf,
  draftSavedRoutineId,
  plannedAsDraftPlan,
  fitWorkoutToTime,
  refitWorkoutToTime,
  withOriginalRows,
  timeFitChanges,
  unfitWorkout,
  defaultMain,
  mainFlags,
  type BuilderFitStep,
  type BuilderTimeFit,
  type BuilderAdvice,
  type BuilderEditBasis,
  type BuilderEditOp,
  type BuilderEditRefusal,
  type BuilderWorkout,
  type BuilderSlot,
  type DraftLifeChange,
  type RestKind,
  type GroupCount,
  type SkippedOp,
  type StartAlongside,
  type TemplateSlotSpec,
  defaultBuilderMainLift,
  templateLabel,
  type AccessoryStyle,
} from '@fizz/domain';
import { builderFocusSections, BUILDER_GROUPS, BUILD_LIMITS, PLAN_DAY_LIMITS, type PlanChangeUndo, type BuildDay, type BuildFocus, type BuilderDraftFrom, type BuilderDraftKey, type DraftPlan, type BuilderGroup, type BuilderSetup, type EquipmentInstance, type Gym, type SessionAggregate, type PlanDayVariation, type PlanDraft, type Routine, type RoutineExercise, type SessionCheckIn, type SessionPlanDay, type SplitBodyPart, type TrainingProfile, type UserProfile, type WorkoutDraft, type ZonedTimestamp } from '@fizz/schemas';
import type { Store } from '@fizz/persistence';

import type { WorkoutStartOutcome, WorkoutStartRequest } from '../services/workout-services';
import type { BuilderEnv, BuilderEnvPort } from './builder-env';
import { createBuilderLoadGuard, type ReviewPlanDay, type SetupCoachContext, type SetupField, type SetupState } from '@fizz/coach';
import type { BuilderCoachWorld } from '../coach/builder-coach-service';
import type { BuilderReviewInputs } from '../coach/builder-review-provider';
import { dayNotesFor } from '../coach/builder-coach-view';
import { formatShortDate } from '../format/dates';

/**
 * The workout builder's draft service (workout-builder-v3 §2.1–§2.8, §4.4,
 * §4.6). Screens call this; every rule is a pure `@fizz/domain` function.
 *
 * - One open builder draft per (plan, day index, split day, main lift,
 *   local date), resumed on reopen (`createBuilderDraft` decides it in one
 *   transaction).
 * - Every write carries an op ID (a retry writes nothing more) and a basis:
 *   the draft version, or only the slots it touches with their revisions
 *   (rule 5). Manual edits bump the version in place; a rebuild is a new
 *   version.
 * - Undo's before-state is stored on the draft, so it survives a force-close.
 * - Start goes through the workout services' Start (`coachDraftOf`): the
 *   draft's loads stand as built, the session records its plan day, and
 *   `Update … in your plan` / `Save as new variation` land in the session's
 *   own transaction.
 */

export interface BuilderServiceDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  env: BuilderEnvPort;
  training: () => Promise<TrainingProfile | null>;
  currentGym: () => Promise<Gym | null>;
  start: (req: WorkoutStartRequest) => Promise<WorkoutStartOutcome>;
  /** (Coach review's Plan section) The plan's next routine at this gym, Up next's own resolver; absent: not known. */
  upNextRoutineId?: (gymId: string) => Promise<string | null>;
  /** (22 Oct) Up next with no plan (a routine, or the last workout's next session), for `openTarget({ kind: 'next' })`. */
  upNext?: (gymId: string | null) => Promise<{ routineId: string | null; sourceSessionId: string | null } | null>;
  /** (22 Oct) A past workout's name as Today and the history show it (`Push`), for `Do again`. Null: not known. */
  sessionTitle?: (sessionId: string) => Promise<string | null>;
  /** (22 Oct) No gym yet at Start: the typical gym is saved first, as Today's Start does (audit B4). Null: couldn't. */
  ensureGym?: () => Promise<string | null>;
  /**
   * (Review B1, retire-workout-overview) The Workout overview's own planner, dry run, for a library workout or a past
   * workout at this gym (null: the typical gym's items): its set types, reps, Fixed loads, its own rule's next targets
   * and preferred items, fitted to the gym (rule 4). Null: gone or nothing to plan. Absent: the builder's §3.1 rules.
   */
  planned?: (target: { kind: 'routine'; routineId: string } | { kind: 'session'; sourceSessionId: string }, gymId: string | null) => Promise<SessionAggregate | null>;
}

/**
 * (22 Oct, Ben: the Workout overview is retired) What Your workout opens on besides Set up: Up next, a workout
 * (plan day or library), a past workout to do again, or a coach chat draft.
 */
export type BuilderOpenTarget = { kind: 'next' } | { kind: 'routine'; routineId: string } | { kind: 'session'; sourceSessionId: string } | { kind: 'coach_draft'; draftId: string };

/** A day on Set up's Day sheet (§2.2). */
export interface BuilderDayOption {
  id: string;
  name: string;
  parts: SplitBodyPart[];
  /** `Chest, triceps`. */
  label: string;
}

/** Set up as the page holds it. `groups` in display order; the main lift counts as one of its group's. */
export interface SetupInput {
  dayId: string;
  dayName: string;
  /** The day's parts (Custom: the parts of the groups chosen). */
  dayParts: SplitBodyPart[];
  minutes: number;
  mainLiftExerciseId: string | null;
  supersets: boolean;
  groups: GroupCount[];
  variationId: string | null;
  groupsEdited: boolean;
  /** (D3) Today's Accessories style, for a workout Today drafted (absent on Set up's own). */
  accessories?: AccessoryStyle;
}

/**
 * (D3, Ben 22–23 Oct) Today's options on Your workout opened from Today: the controls that left Today's card. Main
 * lift: the plan day's templates this gym can do (shown with more than one); accessories: Today's style (null for an
 * older draft); abs and supersets as the workout has them.
 */
export interface TodayOptions {
  mainLifts: { exerciseId: string; label: string; selected: boolean }[];
  accessories: AccessoryStyle | null;
  abs: boolean;
  supersets: boolean;
}

export type TodayOptionChange = { kind: 'main_lift'; exerciseId: string } | { kind: 'accessories'; style: AccessoryStyle } | { kind: 'abs'; on: boolean } | { kind: 'supersets'; on: boolean };

export interface SetupFacts {
  days: { split: BuilderDayOption[]; ppl: BuilderDayOption[] };
  /** The day's main lifts; the first is `From Profile` when there is one. */
  mainLifts: { id: string; name: string; fromProfile: boolean }[];
  /** `Standard` + these (shown only when there are any). `version`: for Rename / Delete. */
  variations: { id: string; label: string; version: number }[];
  recommended: { count: number; groups: GroupCount[] };
  total: number;
  /** The plan-day template this set-up opens (no rebuild), if any. */
  template: { routineId: string; version: number } | null;
  /** The groups of the template (and variation) this set-up opens: Set up's rows while Ben hasn't edited them (§2.2 `template loaded`; review B2). Null: no template. */
  loaded: GroupCount[] | null;
  addable: BuilderGroup[];
  /** Custom with no groups: Next is disabled with `Add a muscle group`. */
  canBuild: boolean;
}

/** One exercise's display facts (names and `works` lines come from the catalogue or Ben's own rows). */
export interface ExerciseFacts {
  name: string;
  works: string | null;
  group: BuilderGroup | null;
  compound: boolean;
  mayHurt: boolean;
  /** This gym doesn't have what it needs, and nothing here could replace it (`Not at this gym`, §2.3). */
  notHere: boolean;
  /** (22 Oct) Ben has logged it: the pop-up's `History` link shows (as on the overview's rows). */
  hasHistory: boolean;
}

/** Everything Your workout and the pop-ups show for one draft. */
export interface BuilderSnapshot {
  draftId: string;
  version: number;
  setup: SetupInput;
  workout: BuilderWorkout;
  /** `about N min` (§3.6). */
  minutes: number;
  /** Even at the minimum the estimate is over the length (`⚠ Over 20 min`). */
  over: boolean;
  name: string;
  planDay: { planId: string; dayIndex: number; splitDayId: string; templateRoutineId: string | null; templateVersion: number | null; label: string } | null;
  variationLabel: string | null;
  undo: { opId: string } | null;
  facts: Record<string, ExerciseFacts>;
  unit: UserProfile['preferredUnit'];
  /** Variation extras that couldn't be applied (`Not applied: … · Add anyway`). */
  skipped: SkippedOp[];
  /** Slot revisions, for an edit's basis. */
  revs: Record<string, number>;
  /**
   * The plan day (template or open variation) changed elsewhere since this
   * draft opened it (§2.3): `silent` when Ben hasn't edited the draft (it
   * reloads without a word), else the line `Chest · bench changed · Reload`.
   */
  planDayChanged: { text: string; silent: boolean } | null;
  /** Ben's current gym isn't the draft's (and he didn't undo a move to it): Your workout moves it there (`Gym changed · Undo`, §2.3). */
  gymChanged: boolean;
  /** Each slot's rest per kind now (Ben's own, else the default), and `round` for a superset (§3.2). */
  rests: Record<string, Partial<Record<RestKind | 'round', number>>>;
  /** The item each slot's loads are worked out on (the keyboard's kg steps, §2.7). */
  items: Record<string, string | null>;
  startable: boolean;
  /** The gym the draft's loads were worked out at (null: none yet). */
  gymId: string | null;
  /** (22 Oct) The library workout, past workout or chat draft this was opened on; null: Set up, Today or a plan day. */
  from: BuilderDraftFrom | null;
  /** (22 Oct, §7) `⋯ Save to Workouts`: not a plan day and not already a saved workout. */
  canSave: boolean;
  /** (Review B1) Names of the exercises of that workout Your workout can't hold (one it can't find, past its limits): `N left out`. */
  leftOut: string[];
  /**
   * (22 Oct) Your workout's Time with a live fit: what it changed against the workout before the first Time change
   * (Ben's later edits counted) and the length the detail's `Undo` goes back to. Null: no fit (the original stands).
   */
  time: { fromMinutes: number; changes: BuilderFitStep[] } | null;
}

export type BuilderWriteResult =
  | { status: 'written'; snapshot: BuilderSnapshot; toast: BuilderToast | null }
  | { status: 'replayed'; snapshot: BuilderSnapshot; toast: BuilderToast | null }
  | { status: 'stale' | 'closed'; snapshot: BuilderSnapshot | null; message: string }
  | { status: 'refused'; reason: BuilderEditRefusal | 'nothing_to_undo' | 'changed_since'; message: string; snapshot: BuilderSnapshot | null };

/** A toast after a write: text, and whether `Undo` goes with it. `why`: the advice's one-line reason. */
export interface BuilderToast {
  text: string;
  undoOpId: string | null;
  why: string | null;
}

export type StartChoice = { kind: 'today' } | { kind: 'update' } | { kind: 'variation'; label: string };

/** The `Use these changes for` sheet (§2.8); null = start without asking. */
export interface StartPrompt {
  lines: string[];
  /** `Update Chest · bench in your plan` (variation open: `Update Chest · bench · arms superset`); null = hidden (plan paused or ended, no template). */
  updateLabel: string | null;
  /** At 5 variations: disabled with `Limit reached`. */
  variationLimitReached: boolean;
  /** The variation name field's prefill (`arms superset`). */
  suggestedLabel: string;
  canSaveVariation: boolean;
}

/**
 * A plan change made at Start, for Summary's `Chest · bench updated · Undo`
 * (versioned inverse write, §4.6). Stored with the session in the Start's
 * own write (`SessionPlanDay.planChange`), so it survives a force-close
 * (review S9); `planChangeOf(sessionId)` reads it back.
 */
export type { PlanChangeUndo };

export type BuilderStartResult =
  | { ok: true; sessionId: string; duplicate: boolean; planChange: PlanChangeUndo | null }
  | { ok: false; reason: 'stale' | 'plan_changed' | 'variation_limit' | 'variation_label' | 'empty' | 'gone' | 'failed'; message: string }
  /** Another workout is in progress: nothing was created; the page goes to Today, where it resumes. */
  | { ok: false; reason: 'active'; message: string; sessionId: string };

/** Every builder group, in the builder's order (the coach's usable list and Set up context). */
const BUILDER_GROUP_ORDER: readonly BuilderGroup[] = BUILDER_GROUPS;

/** The gym a draft's current version was worked out at. */
function v0GymOf(d: WorkoutDraft): string | null {
  return currentDraftVersion(d).request.gymId;
}

/** Summary's Undo of a Start's plan change: one op ID per session, so a retry (or a relaunch) undoes once. */
export function planChangeUndoOpId(sessionId: string): string {
  return deriveId(`plan-change-undo:${sessionId}`);
}

/** (D3) The toast after one of Today's options on Your workout (with Undo): `Supersets off`, `Abs on`, `Accessories varied`. */
export function todayOptionText(c: TodayOptionChange): string {
  switch (c.kind) {
    case 'supersets':
      return `Supersets ${c.on ? 'on' : 'off'}`;
    case 'abs':
      return `Abs ${c.on ? 'on' : 'off'}`;
    case 'accessories':
      return `Accessories ${c.style}`;
    case 'main_lift':
      return BUILDER_COPY.rebuilt;
  }
}

/** Summary's line for a Start's plan change (§2.8): `Chest · bench updated`; a new variation `… saved`. */
export function planChangeText(u: PlanChangeUndo): string {
  return u.kind === 'variation_new' ? BUILDER_COPY.saved(u.label) : BUILDER_COPY.updated(u.label);
}

export const BUILDER_COPY = {
  // The page already shows the draft as stored: nothing to tap (N2).
  outOfDate: 'Out of date',
  cantUndo: 'Can’t undo',
  closed: 'This workout was started or closed.',
  notFound: 'That workout wasn’t found.',
  /** (Review B1) Every exercise of that workout is one Your workout can't hold (none it can find, or past its limits). */
  cantOpen: 'Can’t open this workout here yet.',
  leftOut: (n: number) => `${String(n)} left out`,
  noGym: 'Couldn’t set up a gym. Try again.',
  planChanged: 'Your plan changed. Today only?',
  limitReached: 'Limit reached',
  labelTaken: 'Name already used',
  empty: 'Add an exercise first',
  changedSince: 'Changed since · can’t undo',
  failed: 'Couldn’t save. Try again.',
  notAVariation: 'Can’t save these changes as a variation',
  rebuilt: 'Rebuilt',
  reloaded: 'Reloaded',
  gymChanged: 'Gym changed',
  reload: 'Reload',
  swapped: 'Swapped',
  setDeleted: 'Set deleted',
  keepOneSet: 'Keep at least one set',
  deleted: (name: string) => `Deleted ${name}`,
  roundedTo: (value: number, unit: string) => `Rounded to ${String(value)} ${unit}`,
  updated: (label: string) => `${label} updated`,
  saved: (label: string) => `${label} saved`,
} as const;

const REFUSAL_TEXT: Partial<Record<BuilderEditRefusal, string>> = {
  keep_one_set: BUILDER_COPY.keepOneSet,
  max_exercises: 'At most 10 exercises',
  max_sets: 'At most 10 sets',
  max_warmups: 'At most 4 warm-ups',
  max_drops: 'At most 3 drop sets',
  already_in_workout: 'Already in this workout',
  cannot_superset: 'Can’t superset',
  lightest_is_harder: 'Lighter than this gym can load',
  not_loadable: 'Not at this gym',
  timed_set: 'Timed sets stay as saved',
  reps_out_of_range: 'Reps 1–100',
  rpe_out_of_range: 'RPE 1–10',
};

/** The short toast for advice after Ben's own change (§2.3); `why` is the full reason. */
export function adviceToast(a: BuilderAdvice): { text: string; why: string } {
  switch (a.kind) {
    case 'shared_muscle':
      return { text: `Not recommended: both work your ${a.muscle}`, why: a.reason };
    case 'heavy_pair':
      return { text: 'Not recommended: two heavy lifts', why: a.reason };
    case 'abs_heavy':
      return { text: 'Not recommended: abs with a heavy lift', why: a.reason };
    case 'isolation_first':
      return { text: `Not recommended: tires your ${a.muscle} first`, why: a.reason };
  }
}

const FOCUS_OF: Readonly<Record<string, BuildFocus>> = { push: 'push', pull: 'pull', legs: 'legs', chest: 'chest', shoulders: 'shoulders', back: 'back' };

/** `Last time + 2.5` (§2.4): today's working load against last time's top set. */
export function ruleLine(last: { value: number } | null, today: number | null): string {
  if (last === null || today === null) return 'Last time';
  const d = Math.round((today - last.value) * 100) / 100;
  return d === 0 ? 'Last time' : d > 0 ? `Last time + ${String(d)}` : `Last time − ${String(-d)}`;
}

/** The worked-out working load before this gym's item rounded it differs from the row's (`Rounded down: …`). */
function builderWorkingRounded(load: Parameters<typeof builderLoad>[0], slot: BuilderWorkout['blocks'][number]['slots'][number], shown: number): boolean {
  const r = builderLoad(load, { reps: slot.repRange.min, rpe: 8 });
  return r.working !== null && r.unit === slot.unit && r.working - shown > 1e-6;
}

const capitalise = (s: string) => (s.length === 0 ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`);

export function createBuilderService(deps: BuilderServiceDeps) {
  const repos = () => deps.store().repos;

  async function owner(): Promise<UserProfile> {
    const p = await deps.profile();
    if (p === null) throw new Error('Owner profile not found');
    return p;
  }

  const localToday = () => {
    const at = deps.now();
    return localDateOf(toMs(at.utc), at.tz);
  };

  // -------------------------------------------------------------------------
  // Days, plan links, variations

  async function dayOptions(): Promise<SetupFacts['days']> {
    const t = await deps.training().catch(() => null);
    const opt = (d: { id: string; name: string; bodyParts: readonly SplitBodyPart[] }): BuilderDayOption => ({ id: d.id, name: d.name, parts: [...d.bodyParts], label: partsLabel(d.bodyParts) });
    const split = (t?.split?.days ?? []).map(opt);
    const ppl = PRESET_SPLITS.ppl.filter((d) => !split.some((s) => s.id === d.id)).map(opt);
    return { split, ppl };
  }

  async function profileMainLift(dayId: string): Promise<string | null> {
    const t = await deps.training().catch(() => null);
    return t?.mainLifts?.[dayId] ?? t?.split?.days.find((d) => d.id === dayId)?.mainLiftExerciseId ?? null;
  }

  /**
   * A day's main lift for Set up: the training profile's (Ben's choice or plan), else the lead group's default
   * main compound at this gym (`defaultBuilderMainLift`; Back → Barbell row), never none silently. Null only when
   * the lead group has no compound here.
   */
  function defaultMainOf(groups: readonly BuilderGroup[], env: BuilderEnv): string | null {
    return defaultBuilderMainLift({ groups, pool: env.pool, info: env.info, catalogueKeyOf: (id) => env.exercise(id)?.catalogueKey ?? null });
  }

  /**
   * The main lift Set up opens a split day with, one rule for Set up's row, its list and the coach's
   * `fill_setup` (review builder-order S2): the profile's; else none when a plan template with no main
   * lift exists for the day (that template opens); else the day's default main compound here.
   */
  async function setupMainFor(ownerId: string, dayId: string, groups: readonly BuilderGroup[], env: () => Promise<BuilderEnv>): Promise<string | null> {
    const profileMain = await profileMainLift(dayId);
    if (profileMain !== null) return profileMain;
    if ((await templateFor(ownerId, dayId, null)) !== null) return null;
    return defaultMainOf(groups, await env());
  }

  /** The applied plan in use (null: none); `paused` while a pause is running. */
  async function planInUse(ownerId: string): Promise<{ plan: PlanDraft; paused: boolean } | null> {
    const plan = await repos().planDrafts.applied(ownerId).catch(() => null);
    if (plan === null) return null;
    const last = plan.pauses?.[plan.pauses.length - 1];
    return { plan, paused: last !== undefined && last.endedAtUtc === null };
  }

  /** The plan's template for (split day, main lift), with its plan day key. */
  async function templateFor(ownerId: string, dayId: string, main: string | null): Promise<{ routine: Routine; planId: string; dayIndex: number } | null> {
    const inUse = await planInUse(ownerId);
    if (inUse === null) return null;
    const t = await deps.training().catch(() => null);
    const live = await repos().routines.listByOwner(ownerId).catch(() => [] as Routine[]);
    for (const r of planRoutines(inUse.plan, live)) {
      const key = planDayKeyOf(r, t?.split ?? null, t?.mainLifts);
      if (key !== null && key.splitDayId === dayId && (key.mainLiftExerciseId ?? null) === main) return { routine: r, planId: key.planId, dayIndex: key.dayIndex };
    }
    return null;
  }

  /**
   * The plan day a set-up is (review B1): the exact template's, else the plan's day with this split
   * day (a main lift with no template yet still counts as that plan day, §4.2). Null: not a plan day.
   */
  async function planDayFor(ownerId: string, dayId: string, main: string | null): Promise<{ planId: string; dayIndex: number; routine: Routine | null } | null> {
    if (dayId === CUSTOM_DAY_ID) return null;
    const exact = await templateFor(ownerId, dayId, main);
    if (exact !== null) return { planId: exact.planId, dayIndex: exact.dayIndex, routine: exact.routine };
    const inUse = await planInUse(ownerId);
    if (inUse === null) return null;
    const t = await deps.training().catch(() => null);
    const live = await repos().routines.listByOwner(ownerId).catch(() => [] as Routine[]);
    for (const r of planRoutines(inUse.plan, live)) {
      const key = planDayKeyOf(r, t?.split ?? null, t?.mainLifts);
      if (key !== null && key.splitDayId === dayId) return { planId: key.planId, dayIndex: key.dayIndex, routine: null };
    }
    return null;
  }

  async function variationsFor(ownerId: string, dayId: string, main: string | null): Promise<PlanDayVariation[]> {
    if (dayId === CUSTOM_DAY_ID) return [];
    return repos().planDayVariations.listFor(ownerId, dayId, main).catch(() => [] as PlanDayVariation[]);
  }

  // -------------------------------------------------------------------------
  // Environment and builds

  const exerciseIdsOf = (w: BuilderWorkout | null) => (w === null ? [] : slotsOf(w.blocks).map((s) => s.exerciseId));

  async function envFor(p: UserProfile, req: { gymId?: string | null | undefined; exerciseIds?: readonly string[]; groups?: readonly BuilderGroup[]; template?: Routine | null; keySeed: string }): Promise<BuilderEnv> {
    const gymId = req.gymId === undefined ? ((await deps.currentGym().catch(() => null))?.id ?? null) : req.gymId;
    let n = 0;
    return deps.env({
      profile: p,
      gymId,
      exerciseIds: req.exerciseIds ?? [],
      groups: req.groups ?? [],
      template: req.template ?? null,
      newKey: () => deriveId(`builder-slot:${req.keySeed}:${String((n += 1))}`),
    });
  }

  const specsOf = (r: Routine): TemplateSlotSpec[] =>
    [...r.exercises]
      .sort((a, b) => a.order - b.order)
      .map((e) => ({ exerciseId: e.exerciseId, main: e.main === true || r.planDay?.mainLiftExerciseId === e.exerciseId, workingSets: Math.max(1, e.setTemplates.filter((t) => t.setType !== 'warmup').length), group: e.supersetGroup ?? null }));

  /** A template (and variation) as the builder opens it: no rebuild (§2.3 `From template`). */
  function openTemplate(r: Routine, variation: PlanDayVariation | null, env: BuilderEnv): { workout: BuilderWorkout; skipped: SkippedOp[] } {
    const base = workoutFromTemplate(specsOf(r), env.ctx);
    if (variation === null) return { workout: base, skipped: [] };
    const v = applyVariation(base, variation.extras, env.ctx);
    return { workout: v.workout, skipped: v.skipped };
  }

  function recommendation(s: SetupInput, env: BuilderEnv): { count: number; groups: GroupCount[] } {
    const mix = s.dayId === CUSTOM_DAY_ID ? mixForDay(CUSTOM_DAY_ID, s.groups.flatMap((g) => groupPartsOf(g.group))) : mixForDay(s.dayId, s.dayParts);
    if (mix.length === 0) return { count: 0, groups: [] };
    return recommendForSetup(mix, { minutes: s.minutes, mainLiftExerciseId: s.mainLiftExerciseId, supersets: s.supersets }, env.pool, env.ctx);
  }

  /** A workout's groups as Set up rows (1–4 each, in order of first appearance). */
  function groupsOfWorkout(w: BuilderWorkout, env: BuilderEnv): GroupCount[] {
    const counts = new Map<BuilderGroup, number>();
    for (const sl of slotsOf(w.blocks)) {
      const g = env.info(sl.exerciseId)?.group;
      if (g !== undefined) counts.set(g, Math.min(SETUP_LIMITS.maxCount, (counts.get(g) ?? 0) + 1));
    }
    return [...counts].map(([group, count]) => ({ group, count }));
  }

  function groupPartsOf(g: BuilderGroup): SplitBodyPart[] {
    return storedGroupsOf([{ group: g, count: 1 }])[0]?.parts ?? [];
  }

  // -------------------------------------------------------------------------
  // Stored set-up ↔ page

  function storedSetup(s: SetupInput, extra: { templateRoutineId?: string; templateVersion?: number; restLevel?: BuilderSetup['restLevel']; variationVersion?: number }): BuilderSetup {
    return {
      dayId: s.dayId,
      minutes: Math.max(BUILD_LIMITS.minMinutes, Math.min(BUILD_LIMITS.maxMinutes, Math.round(s.minutes))),
      mainLiftExerciseId: s.mainLiftExerciseId,
      supersets: s.supersets,
      groups: storedGroupsOf(s.groups),
      variationId: s.variationId,
      ...(extra.templateRoutineId === undefined ? {} : { templateRoutineId: extra.templateRoutineId }),
      ...(extra.templateVersion === undefined ? {} : { templateVersion: extra.templateVersion }),
      ...(extra.variationVersion === undefined || s.variationId === null ? {} : { variationVersion: extra.variationVersion }),
      ...(extra.restLevel === undefined || extra.restLevel === 'normal' ? {} : { restLevel: extra.restLevel }),
      ...(s.groupsEdited ? { groupsEdited: true as const } : {}),
      ...(s.accessories === undefined ? {} : { accessories: s.accessories }),
    };
  }

  function pageSetup(d: WorkoutDraft): SetupInput {
    const v = currentDraftVersion(d);
    const s = v.request.setup;
    if (s === undefined) throw new Error('Not a builder draft');
    const rs = ruleSetupOf(s);
    return {
      dayId: s.dayId,
      dayName: v.request.day?.name ?? capitalise(s.dayId),
      dayParts: v.request.day?.bodyParts ?? [],
      minutes: s.minutes,
      mainLiftExerciseId: s.mainLiftExerciseId,
      supersets: s.supersets,
      groups: [...rs.groups],
      variationId: s.variationId ?? null,
      groupsEdited: s.groupsEdited === true,
      ...(s.accessories === undefined ? {} : { accessories: s.accessories }),
    };
  }

  function nameOf(s: SetupInput, env: BuilderEnv, variationLabel: string | null): string {
    const main = s.mainLiftExerciseId === null ? null : env.nameOf(s.mainLiftExerciseId);
    return [s.dayName, main, variationLabel].filter((x): x is string => x !== null && x.length > 0).join(' · ').slice(0, 120);
  }

  /** `Chest · bench` (§1.3 name format): the main lift in lower case. */
  function planLabel(s: SetupInput, env: BuilderEnv, variationLabel: string | null): string {
    const main = s.mainLiftExerciseId === null ? null : env.nameOf(s.mainLiftExerciseId).toLowerCase();
    return [s.dayName, main, variationLabel].filter((x): x is string => x !== null && x.length > 0).join(' · ');
  }

  const dayField = (s: SetupInput): { day?: BuildDay } => {
    const day = buildDayOf(s);
    return day === undefined ? {} : { day };
  };
  const focusOf = (dayId: string): BuildFocus => FOCUS_OF[dayId] ?? 'split_day';
  const buildDayOf = (s: SetupInput): BuildDay | undefined => {
    const parts = s.dayParts.length > 0 ? s.dayParts : s.groups.flatMap((g) => groupPartsOf(g.group));
    return parts.length === 0 ? undefined : { name: s.dayName.slice(0, 30), bodyParts: [...new Set(parts)] };
  };

  function restsOf(w: BuilderWorkout, env: BuilderEnv): BuilderSnapshot['rests'] {
    const out: BuilderSnapshot['rests'] = {};
    const presets = env.ctx.restPresetsS;
    for (const b of w.blocks) {
      for (const s of b.slots) {
        const role = restRoleOf(s, env.info);
        const kinds: RestKind[] = ['warmup', 'top', 'backoff', 'working', 'drop', 'before_drop'];
        const r: Partial<Record<RestKind | 'round', number>> = Object.fromEntries(kinds.map((k) => [k, s.restS?.[k] ?? defaultRestS(k, role, w.restLevel, presets)]));
        if (b.slots.length > 1) r.round = roundRestOf(b, w.restLevel, presets);
        out[s.key] = r;
      }
    }
    return out;
  }

  /** The current version of what a draft was opened on (review B2): the library workout's, the past workout's, the open chat draft's. Null: gone or closed. */
  async function sourceVersionOf(from: BuilderDraftFrom): Promise<number | null> {
    switch (from.kind) {
      case 'routine': {
        const r = await repos().routines.get(from.id).catch(() => null);
        return r === null || isDeleted(r) ? null : r.version;
      }
      case 'session':
        return (await repos().sessions.get(from.id).catch(() => null))?.session.version ?? null;
      case 'coach_draft': {
        const c = await repos().workoutDrafts.get(from.id).catch(() => null);
        return c === null || c.status !== 'open' ? null : c.currentVersion;
      }
    }
  }

  /** Whether a chat draft's current version is already a live saved workout (review S1). */
  async function chatSavedRoutine(chatId: string): Promise<boolean> {
    const c = await repos().workoutDrafts.get(chatId).catch(() => null);
    if (c === null || c.routineId === null) return false;
    const r = await repos().routines.get(c.routineId).catch(() => null);
    return draftSavedRoutineId(c, r !== null && !isDeleted(r) ? r : null) !== null;
  }

  /**
   * What a draft opened on a library workout, a past workout or a chat draft is made of (review B1, B2): a library
   * or past workout as the Workout overview planned it at this gym (`planned`, loads fitted to the gym's items,
   * rule 4), with what Your workout can't hold left out and named; a chat draft's checked plan as it stands. With
   * the version it was made from, so a later change reloads it and a stale chat start is refused (rule 5).
   */
  async function sourcePlanOf(p: UserProfile, from: BuilderDraftFrom, gymId: string | null | undefined, keySeed: string): Promise<{ plan: DraftPlan; gymId: string | null; sourceVersion: number | null; leftOut: string[]; main: string | null; name: string; slotSeed?: string } | { closed: string }> {
    switch (from.kind) {
      case 'routine':
      case 'session': {
        const r = from.kind === 'routine' ? await repos().routines.get(from.id).catch(() => null) : null;
        const a = from.kind === 'session' ? await repos().sessions.get(from.id).catch(() => null) : null;
        if (from.kind === 'routine' && (r === null || r.ownerId !== p.id || isDeleted(r))) return { closed: BUILDER_COPY.notFound };
        if (from.kind === 'session' && (a === null || a.session.ownerId !== p.id)) return { closed: BUILDER_COPY.notFound };
        const name = r !== null ? r.name : ((deps.sessionTitle === undefined || a === null ? null : await deps.sessionTitle(a.session.id).catch(() => null)) ?? a?.session.routineName ?? 'Workout');
        const sourceVersion = r !== null ? r.version : (a?.session.version ?? null);
        const ids = r !== null ? r.exercises.map((e) => e.exerciseId) : (a?.exercises.map((e) => e.exerciseId) ?? []);
        const env = await envFor(p, { ...(gymId === undefined ? {} : { gymId }), exerciseIds: ids, keySeed });
        // The main lift (never cut for time): a library workout's `Main`, else the WL9 rule as the library reads it
        // (compounds in places 1–2, else the first). A past workout has no stored `Main`: the rule at read over what
        // opens (fit-to-time §4.2; 22 Oct review B3). Compound as `saveFrom` reads it: the exercise's mechanic.
        const isCompound = (id: string) => env.exercise(id)?.mechanic === 'compound';
        const flags = r === null ? [] : mainFlags(r.exercises, isCompound);
        let main = r?.exercises.find((_, i) => flags[i] === true)?.exerciseId ?? null;
        if (deps.planned === undefined) {
          const specs = r !== null ? specsFromWorkout(r.exercises) : a === null ? [] : specsFromSession(a);
          return { plan: toDraftPlan(workoutFromTemplate(specs, env.ctx), env.codec), gymId: env.gymId, sourceVersion, leftOut: [], main, name, slotSeed: keySeed };
        }
        const planned = await deps.planned(r !== null ? { kind: 'routine', routineId: r.id } : { kind: 'session', sourceSessionId: from.id }, env.gymId).catch(() => null);
        if (planned === null) return { closed: BUILDER_COPY.notFound };
        const items = env.gymId === null ? [] : await repos().equipment.listByGym(env.gymId).catch(() => [] as EquipmentInstance[]);
        const out = plannedAsDraftPlan({
          exercises: planned.exercises,
          sets: planned.sets,
          mainExerciseId: main,
          // (22 Oct) Cardio, timed sets and a second copy open as saved; only an exercise it can't find is left out.
          holds: (id) => env.exercise(id) !== null,
          slotKey: (n) => deriveId(`builder-slot:${keySeed}:${String(n)}`),
          catalogueIdOf: (id) => env.codec.catalogueIdOf(id),
          checkedOnOf: (equipmentId, unit, convention) => checkedOnOf({ equipment: items.find((x) => x.id === equipmentId) ?? null, unit, convention }),
        });
        if (out.plan.slots.length === 0) return { closed: out.leftOut.length > 0 ? BUILDER_COPY.cantOpen : BUILDER_COPY.notFound };
        let slots = out.plan.slots;
        if (r === null) {
          const lead = defaultMain(slots, isCompound).indexOf(true);
          slots = slots.map((x, i) => ({ ...x, main: i === lead }));
          main = slots[lead]?.exerciseId ?? null;
        }
        // Rule 4: an exercise the planner put on no item is fitted to the builder's item here (never past its max).
        const fitted: DraftPlan = { slots: slots.map((x) => fitPlannedSlotHere(x, slotLoadOf(env.ctx.loads(x.exerciseId), x.main), env.codec.checkedOnOf(x.exerciseId))) };
        return { plan: fitted, gymId: env.gymId, sourceVersion, leftOut: out.leftOut.slice(0, BUILD_LIMITS.maxExercises * 3), main, name, slotSeed: keySeed };
      }
      case 'coach_draft': {
        const d = await repos().workoutDrafts.get(from.id).catch(() => null);
        if (d === null || d.ownerId !== p.id) return { closed: BUILDER_COPY.notFound };
        if (d.status !== 'open' || toMs(d.expiresAtUtc) <= toMs(deps.now().utc)) return { closed: BUILDER_COPY.closed };
        // The coach's checked plan as it stands (its loads and their reasons), not rebuilt; at the gym it was checked at.
        const v = currentDraftVersion(d);
        return { plan: v.plan, gymId: v.request.gymId, sourceVersion: d.currentVersion, leftOut: [], main: v.plan.slots.find((x) => x.main)?.exerciseId ?? null, name: d.name };
      }
    }
  }

  async function snapshotOf(p: UserProfile, d: WorkoutDraft, env: BuilderEnv, skipped: SkippedOp[] = []): Promise<BuilderSnapshot> {
    const v = currentDraftVersion(d);
    const stored = builderSetupOf(d);
    const setup = pageSetup(d);
    const workout = fromDraftPlan(v.plan, stored?.restLevel ?? 'normal');
    const minutes = estimateBuilderMinutes(workout, env.ctx);
    const variation = setup.variationId === null ? null : ((await variationsFor(p.id, setup.dayId, setup.mainLiftExerciseId)).find((x) => x.id === setup.variationId) ?? null);
    const facts: Record<string, ExerciseFacts> = {};
    for (const s of slotsOf(workout.blocks)) facts[s.exerciseId] = { name: env.nameOf(s.exerciseId), works: env.worksOf(s.exerciseId), group: env.info(s.exerciseId)?.group ?? null, compound: env.info(s.exerciseId)?.role === 'compound', mayHurt: env.painFlagged(s.exerciseId), notHere: env.gymId !== null && !env.doable(s.exerciseId), hasHistory: env.hasHistory(s.exerciseId) };
    const key = d.builderKey;
    const planDay =
      key !== undefined && key.planId !== null && key.dayIndex !== null && key.splitDayId !== null
        ? { planId: key.planId, dayIndex: key.dayIndex, splitDayId: key.splitDayId, templateRoutineId: stored?.templateRoutineId ?? null, templateVersion: stored?.templateVersion ?? null, label: planLabel(setup, env, variation?.label ?? null) }
        : null;
    let planDayChanged: BuilderSnapshot['planDayChanged'] = null;
    let notApplied = skipped;
    if (stored?.templateRoutineId !== undefined && stored.templateVersion !== undefined && d.status === 'open') {
      const t = await repos().routines.get(stored.templateRoutineId).catch(() => null);
      // A variation's extras whose anchor left the template (§4.3): still missing from this workout, they stay listed (`Not applied … · Add anyway`).
      if (t !== null && variation !== null) {
        const have = new Set(slotsOf(workout.blocks).map((x) => x.exerciseId));
        notApplied = applyVariation(workoutFromTemplate(specsOf(t), env.ctx), variation.extras, env.ctx).skipped.filter((x) => x.reason === 'anchor_missing' && missingOf(x, have).length > 0);
      }
      const moved = (t !== null && t.version !== stored.templateVersion) || (variation !== null && stored.variationVersion !== undefined && variation.version !== stored.variationVersion);
      if (moved) planDayChanged = { text: `${planLabel(setup, env, variation?.label ?? null)} changed`, silent: d.version === 1 && d.versions.length === 1 };
    }
    // (Review B2) What it was opened on moved since (the library workout was edited, the coach revised the chat draft).
    if (planDayChanged === null && key?.from !== undefined && stored?.sourceVersion !== undefined && d.status === 'open') {
      const now = await sourceVersionOf(key.from);
      if (now !== null && now !== stored.sourceVersion) planDayChanged = { text: `${d.name} changed`, silent: d.version === 1 && d.versions.length === 1 };
    }
    const leftOut: string[] = [];
    for (const id of stored?.leftOut ?? []) leftOut.push((await repos().exercises.get(id).catch(() => null))?.name ?? env.nameOf(id));
    // Review S1: opened on a chat draft whose current version is already a saved workout: not saved twice.
    const chatSaved = key?.from?.kind === 'coach_draft' ? await chatSavedRoutine(key.from.id) : false;
    // Names for the `Not applied` lines' exercises too.
    for (const x of notApplied) for (const id of x.op.kind === 'add_slot' ? [x.op.slot.exerciseId] : x.op.kind === 'pair' ? [x.op.a, x.op.b] : [x.op.exerciseId]) facts[id] ??= { name: env.nameOf(id), works: env.worksOf(id), group: env.info(id)?.group ?? null, compound: env.info(id)?.role === 'compound', mayHurt: env.painFlagged(id), notHere: false, hasHistory: env.hasHistory(id) };
    const here = d.status === 'open' ? await deps.currentGym().catch(() => null) : null;
    const gymChanged = here !== null && here.id !== v.request.gymId && here.id !== stored?.gymKept;
    // (22 Oct) Your workout's Time: what a live fit changed, with names for what it left out.
    const fit = timeFitOf(stored);
    const time = fit === null ? null : { fromMinutes: fit.fromMinutes, changes: timeFitChanges(fit, workout) };
    for (const st of time?.changes ?? []) if (st.kind === 'drop') facts[st.exerciseId] ??= { name: env.nameOf(st.exerciseId), works: env.worksOf(st.exerciseId), group: env.info(st.exerciseId)?.group ?? null, compound: env.info(st.exerciseId)?.role === 'compound', mayHurt: env.painFlagged(st.exerciseId), notHere: false, hasHistory: env.hasHistory(st.exerciseId) };
    return {
      draftId: d.id,
      version: d.version,
      setup,
      workout,
      minutes,
      planDayChanged,
      gymChanged,
      over: minutes > setup.minutes,
      name: d.name,
      planDay,
      variationLabel: variation?.label ?? null,
      undo: d.undo === null || d.undo === undefined || d.undo.atVersion !== d.version ? null : { opId: d.undo.opId },
      facts,
      unit: p.preferredUnit,
      skipped: notApplied,
      revs: Object.fromEntries(v.plan.slots.map((s) => [s.slotKey, s.rev ?? 1])),
      rests: restsOf(workout, env),
      items: Object.fromEntries(v.plan.slots.map((s) => [s.slotKey, s.checkedOn?.equipmentId ?? null])),
      startable: d.status === 'open' && v.plan.slots.length > 0,
      gymId: v.request.gymId,
      from: key?.from ?? null,
      canSave: planDay === null && stored?.templateRoutineId === undefined && key?.from?.kind !== 'routine' && !chatSaved,
      leftOut,
      time,
    };
  }

  /** Build Your workout for a set-up: the template (and variation) when one is loaded and the groups weren't edited, else from the set-up. */
  async function buildFor(p: UserProfile, s: SetupInput, keySeed: string, gymId?: string | null) {
    const plan = s.dayId === CUSTOM_DAY_ID ? null : await templateFor(p.id, s.dayId, s.mainLiftExerciseId);
    const variation = s.variationId === null ? null : ((await variationsFor(p.id, s.dayId, s.mainLiftExerciseId)).find((v) => v.id === s.variationId) ?? null);
    const groups = s.groups.map((g) => g.group);
    const templateIds = plan === null ? [] : plan.routine.exercises.map((e) => e.exerciseId);
    const variationIds = (variation?.extras ?? []).flatMap((o) => (o.kind === 'add_slot' ? [o.slot.exerciseId] : []));
    const env = await envFor(p, { gymId: gymId ?? undefined, exerciseIds: [...templateIds, ...variationIds, ...(s.mainLiftExerciseId === null ? [] : [s.mainLiftExerciseId])], groups, template: plan?.routine ?? null, keySeed });
    let workout: BuilderWorkout;
    let skipped: SkippedOp[] = [];
    if (plan !== null && (!s.groupsEdited || variation !== null)) {
      const opened = openTemplate(plan.routine, variation, env);
      workout = opened.workout;
      skipped = opened.skipped;
    } else {
      workout = buildFromSetup(ruleSetupOf(storedSetup(s, {})), env.pool, env.ctx).workout;
    }
    return { env, workout, skipped, plan, variation };
  }

  /** The template and variation versions a build opened (Start checks them, rule 5; review S2). */
  const openedVersions = (built: { plan: { routine: Routine } | null; variation: PlanDayVariation | null }) => ({
    ...(built.plan === null ? {} : { templateRoutineId: built.plan.routine.id, templateVersion: built.plan.routine.version }),
    ...(built.variation === null ? {} : { variationVersion: built.variation.version }),
  });

  /**
   * The variation the current workout would be saved as: its extras, and
   * whether opening them gives this workout back. Order alone, a template
   * pair Ben split and a deleted main lift have no op (§4.3), so a
   * variation would drop them: it isn't offered (review S3).
   */
  function variationOf(template: Routine, current: BuilderWorkout, env: BuilderEnv): { extras: PlanDayVariation['extras'] } | null {
    const base = openTemplate(template, null, env).workout;
    const x = variationExtrasOf(base, current);
    if (!x.ok) return null;
    const reopened = alignToDraft(applyVariation(base, x.extras, env.ctx).workout, current);
    return builderChanges(reopened, current).length === 0 ? { extras: x.extras } : null;
  }

  function draftKey(s: SetupInput, plan: { planId: string; dayIndex: number } | null): BuilderDraftKey {
    return {
      planId: plan?.planId ?? null,
      dayIndex: plan?.dayIndex ?? null,
      splitDayId: s.dayId === CUSTOM_DAY_ID ? null : s.dayId,
      mainLiftExerciseId: s.mainLiftExerciseId,
      localDate: localToday(),
    };
  }

  /** What `Add anyway` adds for a skipped variation op: its exercises not in the workout. */
  function missingOf(x: SkippedOp, have: ReadonlySet<string>): string[] {
    const ids = x.op.kind === 'add_slot' ? [x.op.slot.exerciseId] : x.op.kind === 'pair' ? [x.op.a, x.op.b] : [];
    return ids.filter((id) => !have.has(id));
  }

  /** Two set-ups that store the same (Next with nothing changed). */
  const sameSetup = (a: SetupInput, b: SetupInput) => stableStringify(storedSetup(a, {})) === stableStringify(storedSetup(b, {}));

  const contextHash = (setup: BuilderSetup, gymId: string | null, equipmentVersion: string) => deriveId(`builder-context:${stableStringify({ setup, gymId, equipmentVersion })}`);

  /**
   * The plan write a §2.8 choice makes (`Update … in your plan`, `Save as new variation`), worked out against the
   * draft as stored: the template or variation's next version, its versioned inverse (`planChange`), and the plan
   * day it leaves the draft on. Start writes it with the session (§4.6); `Update plan day` in Coach review on its own.
   */
  async function planWriteFor(p: UserProfile, d: WorkoutDraft, choice: Exclude<StartChoice, { kind: 'today' }>, opId: string, at: ZonedTimestamp): Promise<{ ok: true; alongside: StartAlongside; planChange: PlanChangeUndo; templateVersion: number | null; variationId: string | null; variationVersion?: number } | { ok: false; reason: 'plan_changed' | 'variation_label' | 'failed'; message: string }> {
    const v = currentDraftVersion(d);
    const stored = builderSetupOf(d);
    const setup = pageSetup(d);
    const key = d.builderKey;
    const template = stored?.templateRoutineId === undefined ? null : await repos().routines.get(stored.templateRoutineId).catch(() => null);
    // The template Ben's edits were made on must be the one stored now (rule 5; review S2).
    if (template === null || stored?.templateVersion === undefined || template.version !== stored.templateVersion) return { ok: false, reason: 'plan_changed', message: BUILDER_COPY.planChanged };
    // (22 Oct) Time is today's only: the plan gets Ben's changes, never what a Time fit cut.
    const current = untimed(stored, fromDraftPlan(v.plan, stored.restLevel ?? 'normal'));
    const env = await envFor(p, { exerciseIds: [...template.exercises.map((e) => e.exerciseId), ...exerciseIdsOf(current)], keySeed: 'start' });
    const plan = stored.timeFit === undefined ? v.plan : toDraftPlan(current, env.codec);
    const variations = await variationsFor(p.id, setup.dayId, setup.mainLiftExerciseId);
    const open = setup.variationId === null ? null : (variations.find((x) => x.id === setup.variationId) ?? null);
    const t = await deps.training().catch(() => null);
    const label = planLabel(setup, env, null);
    if (choice.kind === 'update' && open === null) {
      const exercises = templateExercisesOf(template, d, opId, at.utc, plan);
      // An older plan workout gains its `planDay` key on this write (§4.2: derived on read, written only by a change);
      // the plan day's length becomes the set-up's (review S8), never Time's (today's only; 22 Oct review B1).
      const minutes = setupMinutesOf(stored);
      const planDayField = template.planDay !== undefined ? { ...template.planDay, minutes } : key?.planId != null && key.dayIndex !== null && key.splitDayId !== null ? { planId: key.planId, dayIndex: key.dayIndex, splitDayId: key.splitDayId, mainLiftExerciseId: key.mainLiftExerciseId, minutes } : undefined;
      const next: Routine = { ...template, exercises, version: template.version + 1, updatedAtUtc: at.utc, lastOpId: opId, source: 'ben', ...(planDayField === undefined ? {} : { planDay: planDayField }) };
      const alongside: StartAlongside = { opId, template: { next, expectedVersion: stored.templateVersion, split: t?.split ?? null, mainLifts: t?.mainLifts } };
      const planChange: PlanChangeUndo = { kind: 'template', routineId: template.id, version: next.version, restore: template.exercises, label };
      return { ok: true, alongside, planChange, templateVersion: next.version, variationId: setup.variationId };
    } else {
      const extras = variationOf(template, current, env);
      if (extras === null) return { ok: false, reason: 'failed', message: BUILDER_COPY.notAVariation };
      if (choice.kind === 'update' && open !== null) {
        // At the version Ben opened (rule 5; review S2): a variation changed elsewhere since is refused.
        const opened = stored.variationVersion ?? open.version;
        if (open.version !== opened) return { ok: false, reason: 'plan_changed', message: BUILDER_COPY.planChanged };
        const next: PlanDayVariation = { ...open, extras: extras.extras, version: open.version + 1, updatedAtUtc: at.utc, basedOn: { routineId: template.id, version: stored.templateVersion }, opIds: [...open.opIds, opId].slice(-PLAN_DAY_LIMITS.maxOpIds) };
        const alongside: StartAlongside = { opId, variation: { next, expectedVersion: opened } };
        const planChange: PlanChangeUndo = { kind: 'variation_update', id: open.id, version: next.version, restore: open.extras, label: planLabel(setup, env, open.label) };
        return { ok: true, alongside, planChange, templateVersion: stored.templateVersion, variationId: open.id, variationVersion: next.version };
      } else if (choice.kind === 'variation') {
        if (setup.dayId === CUSTOM_DAY_ID) return { ok: false, reason: 'failed', message: BUILDER_COPY.failed };
        const id = deriveId(`builder-variation:${opId}`);
        const labelText = choice.label.trim().slice(0, PLAN_DAY_LIMITS.labelMax);
        if (labelText.length === 0) return { ok: false, reason: 'variation_label', message: 'Give it a name' };
        const next: PlanDayVariation = { id, ownerId: p.id, version: 1, createdAtUtc: at.utc, updatedAtUtc: at.utc, splitDayId: setup.dayId, mainLiftExerciseId: setup.mainLiftExerciseId, label: labelText, extras: extras.extras, basedOn: { routineId: template.id, version: stored.templateVersion }, deletedAtUtc: null, opIds: [opId] };
        const alongside: StartAlongside = { opId, variation: { next, expectedVersion: null } };
        const planChange: PlanChangeUndo = { kind: 'variation_new', id, version: 1, label: planLabel(setup, env, labelText) };
        return { ok: true, alongside, planChange, templateVersion: stored.templateVersion, variationId: id, variationVersion: 1 };
      }
    }
    return { ok: false, reason: 'failed', message: BUILDER_COPY.failed };
  }

  // -------------------------------------------------------------------------
  // Writes

  async function writeDraft(p: UserProfile, draftId: string, compute: (current: WorkoutDraft) => Promise<{ change: DraftLifeChange; env: BuilderEnv; toast: BuilderToast | null; skipped?: SkippedOp[] } | { refused: BuilderEditRefusal | 'nothing_to_undo' | 'changed_since'; env: BuilderEnv | null }>): Promise<BuilderWriteResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const read = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (read === null || read.ownerId !== p.id || read.builderKey === undefined) return { status: 'closed', snapshot: null, message: BUILDER_COPY.closed };
      const r = await compute(read);
      if ('refused' in r) {
        const message = r.refused === 'changed_since' ? BUILDER_COPY.changedSince : r.refused === 'nothing_to_undo' ? BUILDER_COPY.cantUndo : (REFUSAL_TEXT[r.refused] ?? 'Can’t do that');
        return { status: 'refused', reason: r.refused, message, snapshot: r.env === null ? null : await snapshotOf(p, read, r.env) };
      }
      // The change was worked out from `read`: written only if the stored draft is still that one.
      const w = await repos()
        .workoutDrafts.write(p.id, draftId, (current) => (current.version !== read.version && r.change.kind === 'write' ? { kind: 'stale', current } : r.change))
        .catch(() => null);
      // A write that threw (another open draft took the key in a race): nothing was written.
      if (w === null) return { status: 'refused', reason: 'no_such_exercise', message: BUILDER_COPY.failed, snapshot: await snapshotOf(p, read, r.env) };
      switch (w.status) {
        case 'written':
          return { status: 'written', snapshot: await snapshotOf(p, w.draft, r.env, r.skipped), toast: r.toast };
        case 'replayed':
          return { status: 'replayed', snapshot: await snapshotOf(p, w.draft, r.env), toast: null };
        case 'closed':
          return { status: 'closed', snapshot: await snapshotOf(p, w.draft, r.env), message: BUILDER_COPY.closed };
        case 'stale':
          // Moved under us: decide again against the newer draft (the basis says whether it still applies).
          if (r.change.kind === 'stale') return { status: 'stale', snapshot: await snapshotOf(p, w.draft, r.env), message: BUILDER_COPY.outOfDate };
          continue;
        case 'missing':
          return { status: 'closed', snapshot: null, message: BUILDER_COPY.closed };
        case 'invalid':
          return { status: 'refused', reason: 'no_such_exercise', message: BUILDER_COPY.failed, snapshot: null };
      }
    }
    const last = await repos().workoutDrafts.get(draftId).catch(() => null);
    return { status: 'stale', snapshot: last === null ? null : await snapshotOf(p, last, await envFor(p, { exerciseIds: [], keySeed: 'read' })), message: BUILDER_COPY.outOfDate };
  }

  function toastFor(op: BuilderEditOp, before: BuilderWorkout, advice: BuilderAdvice | null, env: BuilderEnv, opId: string): BuilderToast | null {
    if (advice !== null) {
      const a = adviceToast(advice);
      return { text: a.text, undoOpId: opId, why: a.why };
    }
    switch (op.kind) {
      case 'delete_exercise': {
        const s = slotsOf(before.blocks).find((x) => x.key === op.slotKey);
        return { text: BUILDER_COPY.deleted(s === undefined ? 'exercise' : env.nameOf(s.exerciseId)), undoOpId: opId, why: null };
      }
      case 'swap':
        return { text: BUILDER_COPY.swapped, undoOpId: opId, why: null };
      case 'delete_set':
        return { text: BUILDER_COPY.setDeleted, undoOpId: opId, why: null };
      case 'add_exercise':
      case 'move':
      case 'superset_next':
      case 'unlink':
      case 'set_type':
      case 'edit_row':
      case 'add_warmup':
      case 'add_set':
      case 'add_drop':
      case 'rest':
      case 'drop':
        return null;
    }
  }

  /**
   * Today's open builder draft for a workout that isn't a plan day or Set up (`builderKey.from`): created from what
   * it was opened on (`sourcePlanOf`), or the open one for the same target and date, resumed with every edit kept.
   * Resumed after what it was opened on moved (the library workout edited, the chat draft revised; review B2): with
   * no edits it is reloaded silently; with edits the page shows `… changed · Reload` (Reload has Undo). A custom day
   * named after the workout.
   */
  async function openFrom(p: UserProfile, from: BuilderDraftFrom, opId: string): Promise<BuilderWriteResult> {
    const key: BuilderDraftKey = { planId: null, dayIndex: null, splitDayId: null, mainLiftExerciseId: null, localDate: localToday(), from };
    const open = await repos().workoutDrafts.openBuilderDraft(p.id, key).catch(() => null);
    if (open !== null) {
      const snap = await service.read(open.id);
      if (snap?.planDayChanged?.silent === true) {
        const r = await service.reloadPlanDay(open.id, { opId: deriveId(`builder-source-reload:${opId}`), expectedVersion: snap.version, silent: true });
        if (r.snapshot !== null) return { status: 'replayed', snapshot: r.snapshot, toast: null };
      }
      if (snap !== null) return { status: 'replayed', snapshot: snap, toast: null };
    }
    const at = deps.now();
    const id = deriveId(`builder-draft:${opId}`);
    const src = await sourcePlanOf(p, from, undefined, `${id}:${opId}`);
    if ('closed' in src) return { status: 'closed', snapshot: null, message: src.closed };
    const env = await envFor(p, { gymId: src.gymId, exerciseIds: src.plan.slots.map((x) => x.exerciseId), keySeed: `${id}:${opId}` });
    const plan = withSlotRevs(null, src.plan).plan;
    const workout = fromDraftPlan(plan);
    if (slotsOf(workout.blocks).length === 0) return { status: 'closed', snapshot: null, message: BUILDER_COPY.notFound };
    const t = await deps.training().catch(() => null);
    const groups = groupsOfWorkout(workout, env);
    const minutes = Math.max(BUILD_LIMITS.minMinutes, Math.min(BUILD_LIMITS.maxMinutes, Math.ceil(estimateBuilderMinutes(workout, env.ctx)) || (t?.sessionMinutes ?? 60)));
    const main = src.main !== null && slotsOf(workout.blocks).some((x) => x.exerciseId === src.main) ? src.main : null;
    const s: SetupInput = { dayId: CUSTOM_DAY_ID, dayName: src.name.slice(0, 30), dayParts: [], minutes, mainLiftExerciseId: main, supersets: workout.blocks.some((b) => b.slots.length > 1), groups, variationId: null, groupsEdited: true };
    const stored = withSource(storedSetup(s, {}), src);
    const draft = newBuilderDraft({
      id,
      ownerId: p.id,
      opId,
      actionId: deriveId(`builder-action:${opId}`),
      name: src.name.slice(0, 120),
      key,
      setup: stored,
      plan,
      focus: 'split_day',
      ...dayField(s),
      gymId: env.gymId,
      equipmentVersion: env.equipmentVersion,
      contextHash: contextHash(stored, env.gymId, env.equipmentVersion),
      at,
    });
    const r = await repos().workoutDrafts.createBuilderDraft(p.id, draft);
    switch (r.status) {
      case 'written':
        return { status: 'written', snapshot: await snapshotOf(p, r.draft, env), toast: null };
      case 'replayed':
      case 'exists':
        return { status: 'replayed', snapshot: await snapshotOf(p, r.draft, env), toast: null };
      case 'invalid':
        return { status: 'refused', reason: 'no_such_exercise', message: BUILDER_COPY.failed, snapshot: null };
    }
  }

  /** (22 Oct) The live Time fit a stored set-up holds, as the builder's workout; null: none. */
  const timeFitOf = (stored: BuilderSetup | null | undefined): BuilderTimeFit | null => {
    const t = stored?.timeFit;
    return t === undefined ? null : { base: fromDraftPlan(t.base, t.baseRestLevel ?? 'normal'), fromMinutes: t.fromMinutes, dropped: t.dropped, ...(t.cut === undefined ? {} : { cut: t.cut }), ...(t.paired === undefined ? {} : { paired: t.paired }) };
  };

  /** (22 Oct) The workout with what a live Time fit cut put back (Start prompt and plan writes never see the fit). */
  const untimed = (stored: BuilderSetup | null | undefined, w: BuilderWorkout): BuilderWorkout => {
    const t = timeFitOf(stored);
    return t === null ? w : unfitWorkout(t, w);
  };

  /**
   * (22 Oct, review R1) The two copies a change under Time works on: `original`, the whole workout (what the length
   * before the first Time change brings back), and `work`, the same with each exercise Ben edited after a fit as he
   * has it (the sets the fit took from it held). Time fits `work`; with no fit both are the workout as it stands.
   */
  const untimedParts = (stored: BuilderSetup | null | undefined, w: BuilderWorkout): { original: BuilderWorkout; work: BuilderWorkout } => {
    const t = timeFitOf(stored);
    return t === null ? { original: w, work: w } : { original: unfitWorkout(t, w), work: unfitWorkout(t, w, { hold: true }) };
  };

  /**
   * (22 Oct) A set-up whose workout is being rebuilt (Reload, the coach's version): no live Time fit; when one was
   * live, back to its length and rest level before the first Time change (the rebuilt workout isn't fitted).
   */
  const withoutTimeFit = (stored: BuilderSetup): BuilderSetup => {
    const out: BuilderSetup = { ...stored };
    const t = stored.timeFit;
    const from = stored.timeFrom ?? t?.fromMinutes;
    delete out.timeFit;
    delete out.timeFrom;
    if (from !== undefined) out.minutes = from;
    if (t === undefined) return out;
    delete out.restLevel;
    return { ...out, ...(t.baseRestLevel === undefined || t.baseRestLevel === 'normal' ? {} : { restLevel: t.baseRestLevel }) };
  };

  /** (22 Oct, review B1) The set-up's own length: before the first Time change (Time is today's only). */
  const setupMinutesOf = (stored: BuilderSetup): number => stored.timeFrom ?? stored.timeFit?.fromMinutes ?? stored.minutes;

  /** The fit's "other group" for "the other group's isolations": the main lift's group, else the set-up's first. */
  const mainGroupOf = (workout: BuilderWorkout, stored: BuilderSetup, env: BuilderEnv) => {
    const main = slotsOf(workout.blocks).find((x) => x.main);
    return (main === undefined ? undefined : env.info(main.exerciseId)?.group) ?? ruleSetupOf(stored).groups[0]?.group ?? null;
  };

  /**
   * (22 Oct) A set-up's Time fields after a Time fit (`fitWorkoutToTime`): Time's length, the fit's rest level, the
   * live fit (its original, cuts and drops) and the set-up's length before Time (`timeFrom`, dropped once Time is
   * back at it with nothing cut).
   */
  const withTimeFields = (setup: BuilderSetup, from: number, r: { workout: BuilderWorkout; fit: BuilderTimeFit | null; minutes: number }, env: BuilderEnv): BuilderSetup => {
    const out: BuilderSetup = { ...setup, minutes: r.minutes, timeFrom: from };
    delete out.timeFit;
    delete out.restLevel;
    if (r.workout.restLevel !== 'normal') out.restLevel = r.workout.restLevel;
    if (r.fit !== null) out.timeFit = { base: toDraftPlan(r.fit.base, env.codec), ...(r.fit.base.restLevel === 'normal' ? {} : { baseRestLevel: r.fit.base.restLevel }), fromMinutes: r.fit.fromMinutes, dropped: [...r.fit.dropped], ...(r.fit.cut === undefined || Object.keys(r.fit.cut).length === 0 ? {} : { cut: { ...r.fit.cut } }), ...(r.fit.paired === undefined || r.fit.paired.length === 0 ? {} : { paired: r.fit.paired.map((p) => [...p]) }) };
    if (r.fit === null && r.minutes === from) delete out.timeFrom;
    return out;
  };

  /**
   * (22 Oct, review B2, R1 and Gym changed) Time again on a changed workout: `parts` are the two copies
   * (`untimedParts`) with the change made to both (Set up merged in, the new gym's loads); with Time in use, `work` is
   * fitted to Time's length from the set-up's, so the note, its Undo and more time keep working and an exercise Ben
   * edited after a fit keeps his sets (what the fit took from it stays held). Time not in use: the original as it is.
   */
  const retimed = (setup: BuilderSetup, parts: { original: BuilderWorkout; work: BuilderWorkout }, env: BuilderEnv): { workout: BuilderWorkout; setup: BuilderSetup } => {
    const { original, work } = parts;
    const out: BuilderSetup = { ...setup };
    const from = setup.timeFrom ?? setup.timeFit?.fromMinutes;
    delete out.timeFit;
    delete out.restLevel;
    if (original.restLevel !== 'normal') out.restLevel = original.restLevel;
    if (from === undefined) return { workout: original, setup: out };
    const r = refitWorkoutToTime({ original, work, fromMinutes: from, to: setup.minutes, ctx: env.ctx, mainGroup: mainGroupOf(original, setup, env), supersets: setup.supersets });
    return { workout: r.workout, setup: withTimeFields(out, from, r, env) };
  };

  /** A stored set-up with the version, the left-out exercises and the slot-key seed of what it was opened on. */
  const withSource = (stored: BuilderSetup, src: { sourceVersion: number | null; leftOut: string[]; slotSeed?: string }): BuilderSetup => {
    const out: BuilderSetup = { ...stored };
    delete out.sourceVersion;
    delete out.leftOut;
    delete out.slotSeed;
    return { ...out, ...(src.sourceVersion === null ? {} : { sourceVersion: src.sourceVersion }), ...(src.leftOut.length === 0 ? {} : { leftOut: src.leftOut }), ...(src.slotSeed === undefined || src.slotSeed.length > 300 ? {} : { slotSeed: src.slotSeed }) };
  };

  const service = {
    copy: BUILDER_COPY,

    /** Set up's starting rows for a day (§2.1 `Build your own`, Day = the card's day). */
    async initialSetup(req: { dayId?: string } = {}): Promise<SetupInput> {
      const p = await owner();
      const days = await dayOptions();
      const all = [...days.split, ...days.ppl];
      // No day asked: the split's first. A day the builder doesn't list (Today's Other sessions, a day gone
      // from the split) is a custom day with that session's name and groups, never another day (wiring B1).
      const day = req.dayId === undefined ? (days.split[0] ?? days.ppl[0]) : all.find((d) => d.id === req.dayId);
      const t = await deps.training().catch(() => null);
      const minutes = t?.sessionMinutes ?? 60;
      if (day === undefined) {
        const other = req.dayId === undefined ? undefined : TODAY_OTHER_SESSIONS.find((o) => o.id === req.dayId);
        if (other === undefined) return { dayId: CUSTOM_DAY_ID, dayName: 'Custom', dayParts: [], minutes, mainLiftExerciseId: null, supersets: true, groups: [], variationId: null, groupsEdited: req.dayId !== undefined };
        const otherGroups = other.groups.map((g) => g.group);
        const otherMain = defaultMainOf(otherGroups, await envFor(p, { groups: otherGroups, keySeed: 'setup' }));
        return { dayId: CUSTOM_DAY_ID, dayName: other.name, dayParts: [], minutes, mainLiftExerciseId: otherMain, supersets: true, groups: other.groups.map((g) => ({ ...g })), variationId: null, groupsEdited: true };
      }
      const groups = groupsOfParts(day.parts);
      const main = await setupMainFor(p.id, day.id, groups, () => envFor(p, { groups, keySeed: 'setup' }));
      const s: SetupInput = { dayId: day.id, dayName: day.name, dayParts: day.parts, minutes, mainLiftExerciseId: main, supersets: true, groups: [], variationId: null, groupsEdited: false };
      const env = await envFor(p, { groups, exerciseIds: main === null ? [] : [main], keySeed: 'setup' });
      return { ...s, groups: recommendation(s, env).groups };
    },

    /** What Set up shows for these rows (§2.2): options, recommendation, the template it opens. */
    async setupFacts(s: SetupInput): Promise<SetupFacts> {
      const p = await owner();
      const days = await dayOptions();
      const groups = s.dayId === CUSTOM_DAY_ID ? s.groups.map((g) => g.group) : groupsOfParts(s.dayParts);
      const profileMain = s.dayId === CUSTOM_DAY_ID ? null : await profileMainLift(s.dayId);
      const env = await envFor(p, { groups, exerciseIds: [s.mainLiftExerciseId, profileMain].filter((x): x is string => x !== null), keySeed: 'setup' });
      const compounds = env.compoundsOf(groups.filter((g) => g !== 'Abs'));
      // The lift Set up opens the day with leads the list (none for a plan template with no main lift).
      const lead = s.dayId === CUSTOM_DAY_ID ? defaultMainOf(groups, env) : await setupMainFor(p.id, s.dayId, groups, () => Promise.resolve(env));
      const mainLifts = [...(lead === null ? [] : [{ id: lead, name: env.nameOf(lead), fromProfile: profileMain !== null }]), ...compounds.filter((id) => id !== lead).map((id) => ({ id, name: env.nameOf(id), fromProfile: false }))];
      const variations = (await variationsFor(p.id, s.dayId, s.mainLiftExerciseId)).map((v) => ({ id: v.id, label: v.label, version: v.version }));
      const t = s.dayId === CUSTOM_DAY_ID ? null : await templateFor(p.id, s.dayId, s.mainLiftExerciseId);
      let loaded: GroupCount[] | null = null;
      if (t !== null) {
        const variation = s.variationId === null ? null : ((await variationsFor(p.id, s.dayId, s.mainLiftExerciseId)).find((x) => x.id === s.variationId) ?? null);
        const ids = [...t.routine.exercises.map((e) => e.exerciseId), ...(variation?.extras ?? []).flatMap((o) => (o.kind === 'add_slot' ? [o.slot.exerciseId] : []))];
        const tenv = await envFor(p, { exerciseIds: ids, keySeed: 'loaded' });
        loaded = groupsOfWorkout(openTemplate(t.routine, variation, tenv).workout, tenv);
      }
      return {
        days,
        mainLifts,
        variations,
        recommended: recommendation(s, env),
        total: s.groups.reduce((m, g) => m + g.count, 0),
        template: t === null ? null : { routineId: t.routine.id, version: t.routine.version },
        loaded,
        addable: groupsToAdd(s.groups.map((g) => g.group)),
        canBuild: s.groups.length > 0 || t !== null,
      };
    },

    /**
     * `Next: exercises` (§2.2): the open draft for this day, main lift and
     * date (resumed, with Set up's change merged in), or a new one.
     */
    async create(s: SetupInput, opId: string): Promise<BuilderWriteResult> {
      const p = await owner();
      const at = deps.now();
      const id = deriveId(`builder-draft:${opId}`);
      const built = await buildFor(p, s, `${id}:${opId}`);
      const stored = storedSetup(s, openedVersions(built));
      const draftPlan = withSlotRevs(null, toDraftPlan(built.workout, built.env.codec)).plan;
      const draft = newBuilderDraft({
        id,
        ownerId: p.id,
        opId,
        actionId: deriveId(`builder-action:${opId}`),
        name: nameOf(s, built.env, built.variation?.label ?? null),
        key: draftKey(s, await planDayFor(p.id, s.dayId, s.mainLiftExerciseId)),
        setup: stored,
        plan: draftPlan,
        focus: focusOf(s.dayId),
        ...dayField(s),
        gymId: built.env.gymId,
        equipmentVersion: built.env.equipmentVersion,
        contextHash: contextHash(stored, built.env.gymId, built.env.equipmentVersion),
        at,
      });
      const r = await repos().workoutDrafts.createBuilderDraft(p.id, draft);
      switch (r.status) {
        case 'written':
          return { status: 'written', snapshot: await snapshotOf(p, r.draft, built.env, built.skipped), toast: null };
        case 'replayed':
          return { status: 'replayed', snapshot: await snapshotOf(p, r.draft, built.env, built.skipped), toast: null };
        case 'exists': {
          // Reopen (§2.1): the same unstarted workout, with Set up's change merged in.
          const prev = pageSetup(r.draft);
          if (sameSetup(prev, s)) return { status: 'replayed', snapshot: await snapshotOf(p, r.draft, built.env), toast: null };
          return service.changeSetup(r.draft.id, s, { opId, expectedVersion: r.draft.version });
        }
        case 'invalid':
          return { status: 'refused', reason: 'no_such_exercise', message: BUILDER_COPY.failed, snapshot: null };
      }
    },

    /** Today's `Edit` (§2.1): a plan-day template (and variation) on Your workout, no rebuild. */
    async openTemplate(req: { routineId: string; variationId?: string | null; minutes?: number; supersets?: boolean }, opId: string): Promise<BuilderWriteResult> {
      const p = await owner();
      const r = await repos().routines.get(req.routineId).catch(() => null);
      const t = await deps.training().catch(() => null);
      const key = r === null ? null : planDayKeyOf(r, t?.split ?? null, t?.mainLifts);
      if (r === null || key === null) return { status: 'closed', snapshot: null, message: BUILDER_COPY.closed };
      const day = [...(await dayOptions()).split, ...(await dayOptions()).ppl].find((d) => d.id === key.splitDayId);
      const s: SetupInput = {
        dayId: key.splitDayId,
        dayName: day?.name ?? capitalise(key.splitDayId),
        dayParts: day?.parts ?? [],
        minutes: req.minutes ?? r.planDay?.minutes ?? t?.sessionMinutes ?? 60,
        mainLiftExerciseId: key.mainLiftExerciseId ?? null,
        supersets: req.supersets ?? r.exercises.some((e) => e.supersetGroup !== null),
        groups: [],
        variationId: req.variationId ?? null,
        groupsEdited: false,
      };
      const variation = s.variationId === null ? null : ((await variationsFor(p.id, s.dayId, s.mainLiftExerciseId)).find((x) => x.id === s.variationId) ?? null);
      const ids = [...r.exercises.map((e) => e.exerciseId), ...(variation?.extras ?? []).flatMap((o) => (o.kind === 'add_slot' ? [o.slot.exerciseId] : []))];
      const env = await envFor(p, { exerciseIds: ids, keySeed: 'groups' });
      return service.create({ ...s, groups: groupsOfWorkout(openTemplate(r, variation, env).workout, env) }, opId);
    },

    /**
     * (22 Oct, Ben: the Workout overview is retired) Your workout opened on a target the overview took: a plan-day
     * template (as Today's `Edit`), a library workout, a past workout to do again, a coach chat draft, or Up next.
     * Each is today's open builder draft for that target (created, or resumed with every edit kept), so Start
     * starts exactly what the page shows. Idempotent on `opId`. `closed`: the target is gone or has nothing to do.
     */
    async openTarget(target: BuilderOpenTarget, opId: string): Promise<BuilderWriteResult> {
      const p = await owner();
      switch (target.kind) {
        case 'next': {
          const gym = await deps.currentGym().catch(() => null);
          const up = deps.upNext === undefined ? null : await deps.upNext(gym?.id ?? null).catch(() => null);
          if (up?.routineId != null) return service.openTarget({ kind: 'routine', routineId: up.routineId }, opId);
          if (up?.sourceSessionId != null) return service.openTarget({ kind: 'session', sourceSessionId: up.sourceSessionId }, opId);
          return { status: 'closed', snapshot: null, message: BUILDER_COPY.notFound };
        }
        case 'routine': {
          const r = await repos().routines.get(target.routineId).catch(() => null);
          if (r === null || r.ownerId !== p.id || isDeleted(r)) return { status: 'closed', snapshot: null, message: BUILDER_COPY.notFound };
          const t = await deps.training().catch(() => null);
          // A plan day of the plan in use opens as Today's `Edit` does (its template, its plan-day key, the Start prompt).
          // One from a plan no longer in use is a library workout like any other (review: low).
          const pk = planDayKeyOf(r, t?.split ?? null, t?.mainLifts);
          if (pk !== null && (await planInUse(p.id))?.plan.id === pk.planId) return service.openTemplate({ routineId: r.id }, opId);
          return openFrom(p, { kind: 'routine', id: r.id }, opId);
        }
        case 'session': {
          const a = await repos().sessions.get(target.sourceSessionId).catch(() => null);
          if (a === null || a.session.ownerId !== p.id) return { status: 'closed', snapshot: null, message: BUILDER_COPY.notFound };
          return openFrom(p, { kind: 'session', id: a.session.id }, opId);
        }
        case 'coach_draft': {
          const d = await repos().workoutDrafts.get(target.draftId).catch(() => null);
          if (d === null || d.ownerId !== p.id) return { status: 'closed', snapshot: null, message: BUILDER_COPY.notFound };
          // Already one of the builder's own (Today's card, Set up): that draft.
          if (d.builderKey !== undefined) {
            const snap = await service.read(d.id);
            return snap === null ? { status: 'closed', snapshot: null, message: BUILDER_COPY.closed } : { status: 'replayed', snapshot: snap, toast: null };
          }
          if (d.status !== 'open' || toMs(d.expiresAtUtc) <= toMs(deps.now().utc)) return { status: 'closed', snapshot: null, message: BUILDER_COPY.closed };
          return openFrom(p, { kind: 'coach_draft', id: d.id }, opId);
        }
      }
    },

    /** Your workout for a draft (reopen after leaving or a force-close: every edit kept). */
    async read(draftId: string): Promise<BuilderSnapshot | null> {
      const p = await owner();
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id || d.builderKey === undefined) return null;
      const env = await envFor(p, { gymId: currentDraftVersion(d).request.gymId, exerciseIds: exerciseIdsOf(fromDraftPlan(currentDraftVersion(d).plan)), keySeed: `${d.id}:read` });
      return snapshotOf(p, d, env);
    },

    /**
     * `Gym changed` (§2.3): the draft moves to Ben's current gym. Each
     * exercise this gym can't do is swapped for its group's best one here
     * (none: it stays, `Not at this gym`); every calculated load is worked
     * out again and rounded down here; a typed kg stays if that weight
     * exists here. One toast `Gym changed · Undo` puts the gym and the
     * workout back, and the draft then stays at its own gym.
     */
    async changeGym(draftId: string, w: { opId: string; expectedVersion: number }): Promise<BuilderWriteResult> {
      const p = await owner();
      const gym = await deps.currentGym().catch(() => null);
      return writeDraft(p, draftId, async (current) => {
        const v = currentDraftVersion(current);
        const stored = builderSetupOf(current) ?? storedSetup(pageSetup(current), {});
        // (22 Oct review) A live Time fit is undone first: the whole original moves to the new gym (what the fit cut
        // included), then it's fitted to Time again there, so the note, its Undo and more time keep working. The move
        // is made to both copies (review R1): an exercise Ben edited after a fit keeps his sets; the fit's stay held.
        const parts = untimedParts(stored, fromDraftPlan(v.plan, stored.restLevel ?? 'normal'));
        const missing = await envFor(p, { gymId: gym?.id ?? null, exerciseIds: exerciseIdsOf(parts.original), keySeed: `${current.id}:${w.opId}:gym` });
        const lacking = slotsOf(parts.original.blocks).filter((s) => !missing.doable(s.exerciseId));
        const groups = [...new Set(lacking.flatMap((s) => (missing.info(s.exerciseId)?.group === undefined ? [] : [missing.info(s.exerciseId)?.group as BuilderGroup])))];
        const env = await envFor(p, { gymId: gym?.id ?? null, exerciseIds: exerciseIdsOf(parts.original), groups, keySeed: `${current.id}:${w.opId}` });
        if (current.opIds.includes(w.opId)) return { change: { kind: 'duplicate', current }, env, toast: null };
        if (gym === null || gym.id === v.request.gymId) return { refused: 'changed_since', env };
        /**
         * Each exercise this gym can't do, swapped for its group's best one here. (Review R2) The gym's swap, not Ben's
         * edit: the slot keeps its own `touched` (an exercise he edited stays his), so Time can still shorten or leave
         * out what it swapped in.
         */
        const swapIn = (start: BuilderWorkout): { workout: BuilderWorkout; swapped: Set<string> } => {
          let workout = start;
          const swapped = new Set<string>();
          for (const s of lacking) {
            const g = env.info(s.exerciseId)?.group;
            const inWorkout = new Set(slotsOf(workout.blocks).map((x) => x.exerciseId));
            const to = g === undefined ? undefined : env.pool(g).find((id) => !inWorkout.has(id) && env.doable(id));
            if (to === undefined) continue;
            const r = applyBuilderEdit(workout, { kind: 'swap', slotKey: s.key, exerciseId: to }, env.ctx);
            if (!r.ok) continue;
            const asItWas = (x: BuilderSlot): BuilderSlot => {
              if (x.key !== s.key || s.touched === true) return x;
              const out: BuilderSlot = { ...x };
              delete out.touched;
              return out;
            };
            workout = { ...r.workout, blocks: r.workout.blocks.map((b) => ({ ...b, slots: b.slots.map(asItWas) })) };
            swapped.add(s.key);
          }
          return { workout, swapped };
        };
        // (R2) Opened on a library or past workout: its own planner at the new gym (Fixed loads, its rule's targets), Ben's edits kept.
        const from = current.builderKey?.from;
        // Planned with the seed the draft's slots were made with (22 Oct review): each slot meets its own planned slot by key.
        const seed = stored.slotSeed;
        const src = from === undefined || from.kind === 'coach_draft' ? null : await sourcePlanOf(p, from, gym.id, seed ?? `${current.id}:${w.opId}:gym-source`);
        const srcPlan = src === null || 'closed' in src ? null : src.plan;
        // An exercise listed twice: by slot key when the seed is known (a reordered or deleted copy keeps its own sets);
        // an older draft without it matches each copy by its place (`id#0`, `id#1`).
        const copyKeys = (slots: readonly { key: string; exerciseId: string }[]): string[] => {
          const seen = new Map<string, number>();
          return slots.map((x) => {
            if (seed !== undefined) return `${x.exerciseId}@${x.key}`;
            const n = seen.get(x.exerciseId) ?? 0;
            seen.set(x.exerciseId, n + 1);
            return `${x.exerciseId}#${String(n)}`;
          });
        };
        const plannedList = srcPlan === null ? [] : slotsOf(fromDraftPlan(srcPlan).blocks);
        const plannedKeys = copyKeys(plannedList);
        const plannedSlots = new Map(plannedList.map((x, i) => [plannedKeys[i] ?? '', x] as const));
        const plannedItem = new Map(plannedList.map((x, i) => [plannedKeys[i] ?? '', srcPlan?.slots.find((y) => y.slotKey === x.key)?.checkedOn ?? null] as const));
        const fromPlanned = new Map<string, string>();
        /** One copy at the new gym: swapped where this gym lacks an exercise, every other load worked out again here. */
        const move = (start: BuilderWorkout): BuilderWorkout => {
          const { workout, swapped } = swapIn(start);
          const currentKeys = new Map(slotsOf(workout.blocks).map((x, i, all) => [x.key, copyKeys(all)[i] ?? ''] as const));
          const regym = (s: BuilderSlot): BuilderSlot => {
            if (swapped.has(s.key)) return s;
            const base = reloadSlotLoads(s, infoOrDefault(env.info, s.exerciseId), slotLoadOf(env.ctx.loads(s.exerciseId), s.main));
            const copy = currentKeys.get(s.key) ?? '';
            const planned = plannedSlots.get(copy);
            if (planned === undefined) return base;
            // (S3) One item per slot: the planner's loads mix with the builder's only when both fitted to the same item.
            const sameItem = (plannedItem.get(copy)?.equipmentId ?? null) === (env.codec.checkedOnOf(s.exerciseId)?.equipmentId ?? null);
            const r = slotAtNewGym(s, planned, base, sameItem);
            if (r.fromPlanned) fromPlanned.set(s.key, copy);
            return r.slot;
          };
          return { ...workout, blocks: workout.blocks.map((b) => ({ ...b, slots: b.slots.map(regym) })) };
        };
        const moved = parts.work === parts.original ? { original: move(parts.original), work: null } : { original: move(parts.original), work: move(parts.work) };
        const kept: BuilderSetup = { ...stored };
        delete kept.gymKept;
        // (22 Oct review) Time again at the new gym (the original there is what more time brings back). Undo puts the
        // gym, the workout and the fit as they were back.
        const timed = retimed(kept, { original: moved.original, work: moved.work ?? moved.original }, env);
        const encoded = toDraftPlan(timed.workout, env.codec);
        const withItems: DraftPlan = { slots: encoded.slots.map((x) => (fromPlanned.has(x.slotKey) ? { ...x, checkedOn: plannedItem.get(fromPlanned.get(x.slotKey) ?? '') ?? null } : x)) };
        const plan = withSlotRevs(v.plan, withItems).plan;
        const setup = timed.setup;
        const change = builderDraftEdit(current, { opId: w.opId, at: deps.now(), basis: { version: w.expectedVersion }, plan, setup, gymId: gym.id, undoSetup: { ...stored, gymKept: gym.id }, undoable: true });
        return { change, env, toast: { text: BUILDER_COPY.gymChanged, undoOpId: w.opId, why: null } };
      });
    },

    /**
     * (22 Oct, Ben: "add option to reduce time") Your workout's Time: the same built-in fit as Today's Time control
     * (`fitWorkoutToTime` over `fitToMinutes`; no coach call, works offline), on today's draft only, never the saved
     * workout or the plan. Shorter: rests first, then accessory sets, then whole exercises, never the main lift, no
     * supersets made. Longer brings back what it cut, up to the workout as it was before the first change, never
     * more. One versioned write under `opId` (rule 5), undoable like any edit; the detail's `Undo` is
     * `setTime(fromMinutes)`, which puts the original back with Ben's later edits kept.
     */
    async setTime(draftId: string, minutes: number, w: { opId: string; expectedVersion: number }): Promise<BuilderWriteResult> {
      const p = await owner();
      return writeDraft(p, draftId, async (current) => {
        const v = currentDraftVersion(current);
        const stored = builderSetupOf(current) ?? storedSetup(pageSetup(current), {});
        const workout = fromDraftPlan(v.plan, stored.restLevel ?? 'normal');
        const fit = timeFitOf(stored);
        const env = await envFor(p, { gymId: v.request.gymId, exerciseIds: [...exerciseIdsOf(workout), ...exerciseIdsOf(fit?.base ?? null)], keySeed: `${current.id}:${w.opId}` });
        if (current.opIds.includes(w.opId)) return { change: { kind: 'duplicate', current }, env, toast: null };
        // Every step fits from the set-up's length before the first Time change (review B1: it's what the plan keeps).
        const from = setupMinutesOf(stored);
        const r = fitWorkoutToTime({ current: workout, fit, minutes: from, to: minutes, ctx: env.ctx, mainGroup: mainGroupOf(workout, stored, env), supersets: stored.supersets });
        const plan = withSlotRevs(v.plan, toDraftPlan(r.workout, env.codec)).plan;
        const setup = withTimeFields(stored, from, r, env);
        // The same length and workout again (a repeated tap at a limit): nothing to write.
        if (stableStringify(setup) === stableStringify(stored) && stableStringify(plan) === stableStringify(v.plan)) return { change: { kind: 'duplicate', current }, env, toast: null };
        const change = builderDraftEdit(current, { opId: w.opId, at: deps.now(), basis: { version: w.expectedVersion }, plan, setup, undoable: true });
        return { change, env, toast: null };
      });
    },

    /** Open builder drafts from earlier days (`Edits from Mon 19 Oct · Use`); they expire after 14 days. */
    async earlierEdits(): Promise<{ draftId: string; localDate: string; name: string }[]> {
      const p = await owner();
      await repos().workoutDrafts.expire(p.id, deps.now().utc).catch(() => []);
      const rows = await repos().workoutDrafts.earlierOpenBuilderDrafts(p.id, localToday()).catch(() => [] as WorkoutDraft[]);
      return rows.flatMap((d) => (d.builderKey === undefined ? [] : [{ draftId: d.id, localDate: d.builderKey.localDate, name: d.name }]));
    },

    /** One of Ben's edits (§2.3–§2.5). `basis`: the draft version, or just the slots it touches. */
    async edit(draftId: string, op: BuilderEditOp, w: { opId: string; basis: BuilderEditBasis }): Promise<BuilderWriteResult> {
      const p = await owner();
      return writeDraft(p, draftId, async (current) => {
        const v = currentDraftVersion(current);
        const stored = builderSetupOf(current);
        const before = fromDraftPlan(v.plan, stored?.restLevel ?? 'normal');
        const extra = op.kind === 'swap' || op.kind === 'add_exercise' ? [op.exerciseId] : [];
        const env = await envFor(p, { gymId: v.request.gymId, exerciseIds: [...exerciseIdsOf(before), ...extra], keySeed: `${current.id}:${w.opId}` });
        if (current.opIds.includes(w.opId)) return { change: { kind: 'duplicate', current }, env, toast: null };
        const r = applyBuilderEdit(before, op, env.ctx);
        if (!r.ok) return { refused: r.reason, env };
        const plan = withSlotRevs(v.plan, toDraftPlan(r.workout, env.codec)).plan;
        const change = builderDraftEdit(current, { opId: w.opId, at: deps.now(), basis: w.basis, plan, setup: stored ?? storedSetup(pageSetup(current), {}), undoable: true });
        // A typed kg this gym can't make exactly: the cell shows the new value, the toast says so, `Why?` names the item (rule 4; review S6).
        const item = op.kind === 'edit_row' ? env.itemNameOf(before.blocks.flatMap((b) => b.slots).find((x) => x.key === op.slotKey)?.exerciseId ?? '') : null;
        const rounded = r.rounded?.rounded === true ? { text: BUILDER_COPY.roundedTo(r.rounded.value, r.rounded.unit), undoOpId: null, why: item === null ? null : `Rounded down: ${item}` } : null;
        return { change, env, toast: rounded ?? toastFor(op, before, r.advice, env, w.opId) };
      });
    },

    /**
     * Back to Set up and changing it (§2.3, Ben "agreed"): Length, Supersets
     * and group counts merge into the edited workout; a new Day, Main lift or
     * Variation builds a new workout (`Rebuilt · Undo` restores both pages).
     */
    async changeSetup(draftId: string, next: SetupInput, w: { opId: string; expectedVersion: number }): Promise<BuilderWriteResult> {
      const p = await owner();
      const read = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (read !== null && read.ownerId === p.id && read.builderKey !== undefined && read.status === 'open' && !read.opIds.includes(w.opId) && read.version === w.expectedVersion) {
        const prev = pageSetup(read);
        // `Next` with nothing changed writes nothing (review B2).
        if (sameSetup(prev, next)) return { status: 'replayed', snapshot: await snapshotOf(p, read, await envFor(p, { gymId: currentDraftVersion(read).request.gymId, exerciseIds: exerciseIdsOf(fromDraftPlan(currentDraftVersion(read).plan)), keySeed: `${read.id}:read` })), toast: null };
        // A new Day or Main lift whose (plan day, date) already has an open draft: that one is resumed with
        // this set-up merged in, as `Next` from a fresh Set up does (one open draft per key, §4.4; review B1).
        if (prev.dayId !== next.dayId || prev.mainLiftExerciseId !== next.mainLiftExerciseId) {
          const key = { ...draftKey(next, await planDayFor(p.id, next.dayId, next.mainLiftExerciseId)), localDate: read.builderKey.localDate };
          const other = await repos().workoutDrafts.openBuilderDraft(p.id, key).catch(() => null);
          if (other !== null && other.id !== read.id) return service.changeSetup(other.id, next, { opId: w.opId, expectedVersion: other.version });
        }
      }
      return writeDraft(p, draftId, async (current) => {
        const v = currentDraftVersion(current);
        const stored = builderSetupOf(current);
        const prev = pageSetup(current);
        // (22 Oct review B2) Time in use: Set up's Length showed Time's. Left as it was, the change merges into the
        // original (the fit undone, its rests back) at the set-up's own length, then Time fits it again; a new Length
        // is Ben's set-up length and ends Time. Never a fit's rest level without its record.
        // (Review R1) Merged into Ben's version (`work`: an exercise he edited after a fit keeps his sets, the fit's
        // stay held) and the whole original alike; a new Length merges into the whole original (Time ends).
        const timeFrom = stored === null ? undefined : (stored.timeFrom ?? stored.timeFit?.fromMinutes);
        const lengthKept = timeFrom !== undefined && next.minutes === prev.minutes;
        const parts = untimedParts(stored, fromDraftPlan(v.plan, stored?.restLevel ?? 'normal'));
        const workout = lengthKept ? parts.work : parts.original;
        const nextStored = storedSetup(lengthKept ? { ...next, minutes: timeFrom } : next, { ...(stored?.templateRoutineId === undefined ? {} : { templateRoutineId: stored.templateRoutineId }), ...(stored?.templateVersion === undefined ? {} : { templateVersion: stored.templateVersion }), ...(stored?.variationVersion === undefined ? {} : { variationVersion: stored.variationVersion }) });
        const env = await envFor(p, { gymId: v.request.gymId, exerciseIds: exerciseIdsOf(workout), groups: next.groups.map((g) => g.group), keySeed: `${current.id}:${w.opId}` });
        if (current.opIds.includes(w.opId)) return { change: { kind: 'duplicate', current }, env, toast: null };
        const m = mergeSetupChange(ruleSetupOf(storedSetup(timeFrom === undefined ? prev : { ...prev, minutes: timeFrom }, {})), ruleSetupOf(nextStored), workout, env.pool, env.ctx);
        const basis = { version: w.expectedVersion };
        if (m.kind === 'rebuild') {
          // A new workout. With Length left as Time's (review N10): built at the set-up's own length (it still stands
          // for the plan), then Time fits it again, so its note, Undo and more time work as on any fit.
          const built = await buildFor(p, lengthKept ? { ...next, minutes: timeFrom } : next, `${current.id}:${w.opId}`, v.request.gymId);
          const asBuilt = { ...storedSetup(next, openedVersions(built)), ...(lengthKept && timeFrom !== next.minutes ? { timeFrom } : {}) };
          const fitted = lengthKept ? retimed(asBuilt, { original: built.workout, work: built.workout }, built.env) : { workout: built.workout, setup: asBuilt };
          const setup = fitted.setup;
          const plan = withSlotRevs(v.plan, toDraftPlan(fitted.workout, built.env.codec)).plan;
          const day = buildDayOf(next);
          const change = builderDraftEdit(current, {
            opId: w.opId,
            at: deps.now(),
            basis,
            plan,
            setup,
            name: nameOf(next, built.env, built.variation?.label ?? null),
            // The key follows the new Day / Main lift (review B1); the draft keeps its local date.
            rebuild: { actionId: deriveId(`builder-action:${w.opId}`), focus: focusOf(next.dayId), ...(day === undefined ? {} : { day }), gymId: built.env.gymId, equipmentVersion: built.env.equipmentVersion, contextHash: contextHash(setup, built.env.gymId, built.env.equipmentVersion), key: { ...draftKey(next, await planDayFor(p.id, next.dayId, next.mainLiftExerciseId)), localDate: current.builderKey?.localDate ?? localToday() } },
            undoable: true,
          });
          return { change, env: built.env, toast: { text: BUILDER_COPY.rebuilt, undoOpId: w.opId, why: null }, skipped: built.skipped };
        }
        const after = m.kind === 'merged' ? m.workout : workout;
        // Length left as Time's: back to Time's length, fitted again from the merged original.
        // The slots keep their keys in a merge, so Gym changed still meets each one's planned slot (`slotSeed`).
        const merged: BuilderSetup = { ...nextStored, ...(stored?.slotSeed === undefined ? {} : { slotSeed: stored.slotSeed }) };
        const original = lengthKept ? withOriginalRows(parts.original, after) : after;
        const timed = retimed(lengthKept ? { ...merged, minutes: next.minutes, timeFrom } : merged, { original, work: after }, env);
        const plan = withSlotRevs(v.plan, toDraftPlan(timed.workout, env.codec)).plan;
        const change = builderDraftEdit(current, { opId: w.opId, at: deps.now(), basis, plan, setup: timed.setup, undoable: true });
        return { change, env, toast: null };
      });
    },

    /**
     * (D3, Ben 22–23 Oct) Today's options on Your workout opened from Today: Main lift (the plan day's templates this
     * gym can do), Accessories (Today's style), Abs and Supersets as the workout has them. Null: not an open builder
     * draft. Read only; `setTodayOption` changes them.
     */
    async todayOptions(draftId: string): Promise<TodayOptions | null> {
      const p = await owner();
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      const stored = d === null ? null : builderSetupOf(d);
      if (d === null || d.ownerId !== p.id || d.status !== 'open' || d.builderKey === undefined || stored === null) return null;
      const v = currentDraftVersion(d);
      const key = d.builderKey;
      const workout = fromDraftPlan(v.plan, stored.restLevel ?? 'normal');
      // The plan day's templates, one per main lift (Today's old Main lift chips).
      const templates: { exerciseId: string; routine: Routine }[] = [];
      const inUse = key.planId === null || key.dayIndex === null ? null : await planInUse(p.id);
      if (inUse !== null && inUse.plan.id === key.planId) {
        const t = await deps.training().catch(() => null);
        const live = await repos().routines.listByOwner(p.id).catch(() => [] as Routine[]);
        for (const r of planRoutines(inUse.plan, live)) {
          const k = planDayKeyOf(r, t?.split ?? null, t?.mainLifts);
          const id = k?.mainLiftExerciseId ?? null;
          if (k === null || k.planId !== key.planId || k.dayIndex !== key.dayIndex || id === null || templates.some((x) => x.exerciseId === id)) continue;
          templates.push({ exerciseId: id, routine: r });
        }
      }
      const env = await envFor(p, { gymId: v.request.gymId, exerciseIds: [...exerciseIdsOf(workout), ...templates.map((x) => x.exerciseId)], keySeed: `${d.id}:today-options` });
      const current = stored.mainLiftExerciseId ?? key.mainLiftExerciseId ?? null;
      const mainLifts = templates.filter((x) => x.exerciseId === current || env.doable(x.exerciseId)).map((x) => ({ exerciseId: x.exerciseId, label: templateLabel(x.routine, env.nameOf(x.exerciseId)), selected: x.exerciseId === current }));
      return {
        mainLifts,
        accessories: stored.accessories ?? null,
        abs: slotsOf(workout.blocks).some((x) => env.info(x.exerciseId)?.group === 'Abs'),
        supersets: stored.supersets,
      };
    },

    /**
     * (D3) One of Today's options changed on Your workout: Set up's own change on this draft (`changeSetup`), so Ben's
     * edits are kept and Time fits again. Supersets re-pairs only the builder's pairs; Abs adds or removes only the ab
     * exercises; Accessories sets the main group's accessories to the style; a new Main lift opens that template
     * (`Rebuilt · Undo`, the draft for that lift when there is one). One versioned write under `opId` with Undo.
     */
    async setTodayOption(draftId: string, change: TodayOptionChange, w: { opId: string; expectedVersion: number }): Promise<BuilderWriteResult> {
      const p = await owner();
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id || d.builderKey === undefined || builderSetupOf(d) === null) return { status: 'closed', snapshot: null, message: BUILDER_COPY.failed };
      const s = pageSetup(d);
      const withoutAbs = s.groups.filter((g) => g.group !== 'Abs');
      const next: SetupInput =
        change.kind === 'supersets'
          ? { ...s, supersets: change.on }
          : change.kind === 'accessories'
            ? { ...s, accessories: change.style }
            : change.kind === 'abs'
              ? { ...s, groups: change.on ? [...withoutAbs, { group: 'Abs', count: 1 }] : withoutAbs }
              : { ...s, mainLiftExerciseId: change.exerciseId, variationId: null };
      const r = await service.changeSetup(draftId, next, w);
      if (r.status !== 'written' || r.toast !== null) return r;
      return { ...r, toast: { text: todayOptionText(change), undoOpId: w.opId, why: null } };
    },

    /**
     * `Reload` (§2.3 `Plan day updated elsewhere while open`): the current
     * template (and variation) opened again, as a new version, so `Undo`
     * puts Ben's edits back. `silent`: no toast (no edits to lose).
     */
    async reloadPlanDay(draftId: string, w: { opId: string; expectedVersion: number; silent?: boolean }): Promise<BuilderWriteResult> {
      const p = await owner();
      return writeDraft(p, draftId, async (current) => {
        const v = currentDraftVersion(current);
        const from = current.builderKey?.from;
        if (from !== undefined) {
          // (Review B2) Opened on a library workout, a past one or a chat draft: what it is now, at the draft's gym (a chat draft's own).
          const src = await sourcePlanOf(p, from, from.kind === 'coach_draft' ? undefined : v.request.gymId, `${current.id}:${w.opId}`);
          const ids = 'closed' in src ? exerciseIdsOf(fromDraftPlan(v.plan)) : src.plan.slots.map((x) => x.exerciseId);
          const env = await envFor(p, { gymId: 'closed' in src ? v.request.gymId : src.gymId, exerciseIds: ids, keySeed: `${current.id}:${w.opId}` });
          if (current.opIds.includes(w.opId)) return { change: { kind: 'duplicate', current }, env, toast: null };
          if ('closed' in src || src.plan.slots.length === 0) return { refused: 'changed_since', env };
          const prev = withoutTimeFit(builderSetupOf(current) ?? storedSetup(pageSetup(current), {}));
          const workout = fromDraftPlan(src.plan);
          const setup = withSource({ ...prev, groups: storedGroupsOf(groupsOfWorkout(workout, env)), mainLiftExerciseId: src.main !== null && slotsOf(workout.blocks).some((x) => x.exerciseId === src.main) ? src.main : null }, src);
          const plan = withSlotRevs(v.plan, src.plan).plan;
          const change = builderDraftEdit(current, {
            opId: w.opId,
            at: deps.now(),
            basis: { version: w.expectedVersion },
            plan,
            setup,
            name: src.name.slice(0, 120),
            rebuild: { actionId: deriveId(`builder-action:${w.opId}`), focus: 'split_day', ...(v.request.day === undefined ? {} : { day: v.request.day }), gymId: env.gymId, equipmentVersion: env.equipmentVersion, contextHash: contextHash(setup, env.gymId, env.equipmentVersion) },
            undoable: w.silent !== true,
          });
          return { change, env, toast: w.silent === true ? null : { text: BUILDER_COPY.reloaded, undoOpId: w.opId, why: null } };
        }
        // (22 Oct) A live Time fit doesn't carry over to the reloaded day: its length and rests before the first change.
        const before = builderSetupOf(current);
        const back = before === null ? null : withoutTimeFit(before);
        const setup = { ...pageSetup(current), ...(back === null ? {} : { minutes: back.minutes }) };
        const built = await buildFor(p, { ...setup, groupsEdited: false }, `${current.id}:${w.opId}`, v.request.gymId);
        if (current.opIds.includes(w.opId)) return { change: { kind: 'duplicate', current }, env: built.env, toast: null };
        if (built.plan === null) return { refused: 'changed_since', env: built.env };
        const stored = storedSetup({ ...setup, groups: groupsOfWorkout(built.workout, built.env), groupsEdited: false }, { ...openedVersions(built), ...(back?.restLevel === undefined ? {} : { restLevel: back.restLevel }) });
        const plan = withSlotRevs(v.plan, toDraftPlan(built.workout, built.env.codec)).plan;
        const day = buildDayOf(setup);
        const change = builderDraftEdit(current, {
          opId: w.opId,
          at: deps.now(),
          basis: { version: w.expectedVersion },
          plan,
          setup: stored,
          name: nameOf(setup, built.env, built.variation?.label ?? null),
          rebuild: { actionId: deriveId(`builder-action:${w.opId}`), focus: focusOf(setup.dayId), ...(day === undefined ? {} : { day }), gymId: built.env.gymId, equipmentVersion: built.env.equipmentVersion, contextHash: contextHash(stored, built.env.gymId, built.env.equipmentVersion) },
          undoable: w.silent !== true,
        });
        return { change, env: built.env, toast: w.silent === true ? null : { text: BUILDER_COPY.reloaded, undoOpId: w.opId, why: null }, skipped: built.skipped };
      });
    },

    /** `Undo` on the last toast; refused if anything changed since (`Changed since · can't undo`). */
    async undo(draftId: string, undoOpId: string, opId: string): Promise<BuilderWriteResult> {
      const p = await owner();
      return writeDraft(p, draftId, async (current) => {
        const v = currentDraftVersion(current);
        const snap = current.undo?.snapshot ?? null;
        const restoredPlan = snap?.plan ?? v.plan;
        const env = await envFor(p, { gymId: v.request.gymId, exerciseIds: [...exerciseIdsOf(fromDraftPlan(v.plan)), ...exerciseIdsOf(fromDraftPlan(restoredPlan))], keySeed: `${current.id}:${opId}` });
        let name: string | undefined;
        if (snap?.setup != null) {
          const back = snap.currentVersion === current.currentVersion ? null : current.versions.find((x) => x.n === snap.currentVersion);
          if (back != null) name = nameOf({ ...pageSetup({ ...current, currentVersion: back.n, versions: current.versions.map((x) => (x.n === back.n ? { ...x, status: 'current' as const } : { ...x, status: 'replaced' as const })) }) }, env, null);
        }
        const r = builderDraftUndo(current, { opId, undoOpId, at: deps.now(), ...(name === undefined ? {} : { name }) });
        if (r.kind === 'refused') return { refused: r.reason === 'nothing' ? 'nothing_to_undo' : 'changed_since', env };
        return { change: r, env, toast: null };
      });
    },

    /** Swap / Add (§2.5): this gym's exercises of a group by focus, minus what's in the workout; pain-flagged ones marked. */
    async exerciseChoices(draftId: string, req: { slotKey: string | null; group?: BuilderGroup }): Promise<{ group: BuilderGroup; groups: BuilderGroup[]; sections: { focus: string; items: { exerciseId: string; name: string; works: string | null; mayHurt: boolean; painLine: string | null }[] }[] } | null> {
      const snap = await service.read(draftId);
      if (snap === null) return null;
      const p = await owner();
      const slot = req.slotKey === null ? null : (slotsOf(snap.workout.blocks).find((s) => s.key === req.slotKey) ?? null);
      const firstGroup = snap.setup.groups[0]?.group ?? 'Chest';
      const group: BuilderGroup = req.group ?? (slot === null ? firstGroup : (snap.facts[slot.exerciseId]?.group ?? firstGroup));
      const env = await envFor(p, { groups: [group], keySeed: 'choices' });
      const inWorkout = new Set(slotsOf(snap.workout.blocks).map((s) => s.exerciseId));
      const ids = env.candidates(group).filter((id) => !inWorkout.has(id));
      const sections = builderFocusSections(
        ids.flatMap((id) => {
          const e = env.exercise(id);
          return e === null ? [] : [e];
        }),
        (e) => e,
        group,
      ).map((sec) => ({ focus: sec.focus, items: sec.items.map((e) => ({ exerciseId: e.id, name: e.name, works: env.worksOf(e.id), mayHurt: env.painFlagged(e.id), painLine: env.painLine(e.id) })) }));
      return { group, groups: ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps', 'Abs'], sections };
    },

    /** `Why this weight?` (§2.4): where the load came from, numbers from code only. */
    async whyWeight(draftId: string, slotKey: string): Promise<string[]> {
      const snap = await service.read(draftId);
      const slot = snap === null ? null : slotsOf(snap.workout.blocks).find((s) => s.key === slotKey);
      if (snap === null || slot === undefined || slot === null) return [];
      const p = await owner();
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      const env = await envFor(p, { gymId: d === null ? undefined : currentDraftVersion(d).request.gymId, exerciseIds: [slot.exerciseId], keySeed: 'why' });
      const u = slot.unit;
      const lines: string[] = [];
      const work = slot.rows.find((r) => r.type !== 'warmup');
      // (R3) Opened on a library or past workout: its planner's reasons (own rule, held, capped or rounded here).
      const planned = slot.why ?? [];
      if (planned.length > 0) lines.push(...planned.filter((l) => !(l === PLANNED_HELD_LINE && env.painFlagged(slot.exerciseId))));
      else switch (slot.source) {
        case 'coach_target':
          lines.push('Coach target');
          break;
        case 'plan':
          lines.push('Plan, week 1');
          break;
        case 'saved':
          lines.push('Saved workout');
          break;
        case 'rule':
          lines.push(ruleLine(env.lastTopOf(slot.exerciseId), work?.load ?? null));
          break;
        case 'calc':
          if (slot.anchorE1rm !== null && work !== undefined) lines.push(`Est. max ${String(Math.round(slot.anchorE1rm))} ${u} (estimate) · ${String(work.reps)} reps @ RPE ${String(work.rpe ?? 8)}`);
          break;
        case 'none':
          // A timed or cardio set with no load (22 Oct): its time is what it was opened on, not a light start.
          if (isTimedSlot(slot)) lines.push(snap.from?.kind === 'coach_draft' ? 'Coach target' : 'Saved workout');
          else lines.push(slot.startLight === null ? 'Start light' : `Start light · up to ${String(slot.startLight)} ${u}`);
          break;
      }
      // Reps from history (21 Oct): what he did last time, so the reps never contradict it silently.
      const reps = slotRepsWhy(slot.main, slotLoadOf(env.ctx.loads(slot.exerciseId), slot.main).ruleReps);
      if (reps !== null) lines.push(reps);
      if (slot.rows.some((r) => r.typed === true)) lines.push('Typed by you');
      // The gym's item moved a load: a typed kg (`roundedFrom`), or the worked-out load rounded down (rule 4; review S6).
      const item = env.itemNameOf(slot.exerciseId);
      const typedRounded = slot.rows.some((r) => r.typed === true && r.roundedFrom !== undefined);
      const calcRounded = work !== undefined && work.typed !== true && work.load !== null && slot.source !== 'none' && !env.painFlagged(slot.exerciseId) && builderWorkingRounded(slotLoadOf(env.ctx.loads(slot.exerciseId), slot.main), slot, work.load);
      if (item !== null && (typedRounded || (calcRounded && planned.length === 0))) lines.push(`Rounded down: ${item}`);
      if (env.painFlagged(slot.exerciseId)) lines.push('May hurt · held at last time');
      return lines;
    },

    /** The Start prompt (§2.8): null when the workout matches its plan day (load-only edits don't count, Q11) or isn't a plan day. */
    async startPrompt(draftId: string): Promise<StartPrompt | null> {
      const p = await owner();
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id) return null;
      // Only the coach's pre-session offer changed Today's card: a today-only change, never offered for the plan (integrity B2).
      if (todayDraftState(d).state === 'nudge') return null;
      const stored = builderSetupOf(d);
      if (stored?.templateRoutineId === undefined) return null;
      const template = await repos().routines.get(stored.templateRoutineId).catch(() => null);
      if (template === null) return null;
      // (22 Oct) A Time fit is today's only: it never makes Start ask to change the plan.
      const current = untimed(stored, fromDraftPlan(currentDraftVersion(d).plan, stored.restLevel ?? 'normal'));
      const setup = pageSetup(d);
      const variations = await variationsFor(p.id, setup.dayId, setup.mainLiftExerciseId);
      const variation = setup.variationId === null ? null : (variations.find((v) => v.id === setup.variationId) ?? null);
      const env = await envFor(p, { exerciseIds: [...template.exercises.map((e) => e.exerciseId), ...exerciseIdsOf(current)], keySeed: 'prompt' });
      const base = alignToDraft(openTemplate(template, variation, env).workout, current);
      const changes = builderChanges(base, current);
      if (changes.length === 0) return null;
      const inUse = await planInUse(p.id);
      const planOk = inUse !== null && !inUse.paused && planRoutines(inUse.plan, [template]).length > 0;
      const label = planLabel(setup, env, variation?.label ?? null);
      const asVariation = variationOf(template, current, env) !== null;
      return {
        lines: changes.map((c) => builderChangeLine(c, env.nameOf)),
        // Updating an open variation needs a change a variation can hold (S3).
        updateLabel: planOk && (variation === null || asVariation) ? `Update ${label}${variation === null ? ' in your plan' : ''}` : null,
        variationLimitReached: variations.length >= PLAN_DAY_LIMITS.maxVariations,
        suggestedLabel: suggestVariationLabel(changes, env.info),
        canSaveVariation: asVariation && setup.dayId !== CUSTOM_DAY_ID,
      };
    },

    /**
     * `Start` (§2.8, §4.6): Today only, Update the plan day (or the open
     * variation), or Save as new variation; the plan write and the session
     * are one transaction under `opId`. A retry returns the same session.
     */
    async start(draftId: string, req: { choice: StartChoice; opId: string; expectedVersion: number; gymId?: string; checkIn?: SessionCheckIn | null }): Promise<BuilderStartResult> {
      const p = await owner();
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id) return { ok: false, reason: 'gone', message: BUILDER_COPY.closed };
      const v = currentDraftVersion(d);
      if (v.plan.slots.length === 0) return { ok: false, reason: 'empty', message: BUILDER_COPY.empty };
      const stored = builderSetupOf(d);
      const setup = pageSetup(d);
      let gymId = req.gymId ?? v.request.gymId ?? (await deps.currentGym().catch(() => null))?.id ?? null;
      // No gym yet (first run): the typical gym is saved first, as Today's Start does; Start's re-check fits the loads to it (rule 4).
      if (gymId === null) {
        const already = await repos().sessions.findByStartOperation(p.id, req.opId).catch(() => null);
        if (already !== null) return { ok: true, sessionId: already.session.id, duplicate: true, planChange: null };
        gymId = deps.ensureGym === undefined ? null : await deps.ensureGym().catch(() => null);
        if (gymId === null) return { ok: false, reason: 'failed', message: BUILDER_COPY.noGym };
      }
      const at = deps.now();
      let alongside: StartAlongside | undefined;
      let planChange: PlanChangeUndo | null = null;
      let templateVersion = stored?.templateVersion ?? null;
      let variationId = setup.variationId;
      const template = stored?.templateRoutineId === undefined ? null : await repos().routines.get(stored.templateRoutineId).catch(() => null);
      if (req.choice.kind !== 'today') {
        const w = await planWriteFor(p, d, req.choice, req.opId, at);
        if (!w.ok) return w;
        alongside = w.alongside;
        planChange = w.planChange;
        templateVersion = w.templateVersion;
        variationId = w.variationId;
      }
      // The plan day is the one the current set-up names (Day, Main lift), never a stale key (review B1).
      const day = await planDayFor(p.id, setup.dayId, setup.mainLiftExerciseId);
      const sameTemplate = template !== null && day?.routine != null && day.routine.id === template.id && templateVersion !== null;
      const planDay: SessionPlanDay | undefined =
        day === null
          ? undefined
          : { planId: day.planId, dayIndex: day.dayIndex, splitDayId: setup.dayId, mainLiftExerciseId: setup.mainLiftExerciseId, templateRoutineId: sameTemplate ? template.id : null, templateVersion: sameTemplate ? templateVersion : null, variationId, ...(planChange === null ? {} : { planChange }) };
      const r = await deps.start({ gymId, opId: req.opId, checkIn: req.checkIn ?? null, coachDraftOf: d.id, builder: { expectedVersion: req.expectedVersion, ...(planDay === undefined ? {} : { planDay }), ...(alongside === undefined ? {} : { alongside }) } });
      if (r.ok) return { ok: true, sessionId: r.aggregate.session.id, duplicate: r.duplicate, planChange: r.duplicate ? null : planChange };
      const e = r.error;
      if (e.code === 'stale_preview' && e.alongside !== undefined) {
        switch (e.alongside) {
          case 'template_changed':
          case 'variation_changed':
            return { ok: false, reason: 'plan_changed', message: BUILDER_COPY.planChanged };
          case 'variation_limit':
            return { ok: false, reason: 'variation_limit', message: BUILDER_COPY.limitReached };
          case 'variation_label':
            return { ok: false, reason: 'variation_label', message: BUILDER_COPY.labelTaken };
        }
      }
      if (e.code === 'stale_preview') return { ok: false, reason: 'stale', message: BUILDER_COPY.outOfDate };
      if (e.code === 'not_found') return { ok: false, reason: 'gone', message: BUILDER_COPY.closed };
      if (e.code === 'session_already_active') return { ok: false, reason: 'active', message: e.message, sessionId: e.sessionId };
      return { ok: false, reason: 'failed', message: 'message' in e && typeof e.message === 'string' ? e.message : BUILDER_COPY.failed };
    },

    /**
     * Coach review's `Update plan day` (§2.9): the same choice as §2.8 (`Update … in your plan` / `Save as new
     * variation`), before Start, so its Undo is a toast (`Chest · bench updated · Undo`, `undoPlanChange`). The plan
     * write is versioned (rule 5) and idempotent on `opId`; the draft then records the template or variation it now
     * matches, so Start doesn't ask again. Two writes, plan first: a force-close between them leaves the draft on the
     * older version, and a later `Update` is refused as `Your plan changed` (never applied to newer state).
     */
    async updatePlanDay(draftId: string, req: { choice: Exclude<StartChoice, { kind: 'today' }>; opId: string; expectedVersion: number }): Promise<{ ok: true; planChange: PlanChangeUndo | null } | { ok: false; reason: 'stale' | 'plan_changed' | 'variation_limit' | 'variation_label' | 'gone' | 'failed'; message: string }> {
      const p = await owner();
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id || d.status !== 'open' || d.builderKey === undefined) return { ok: false, reason: 'gone', message: BUILDER_COPY.closed };
      if (d.opIds.includes(req.opId)) return { ok: true, planChange: null };
      if (d.version !== req.expectedVersion) return { ok: false, reason: 'stale', message: BUILDER_COPY.outOfDate };
      const at = deps.now();
      const w = await planWriteFor(p, d, req.choice, req.opId, at);
      if (!w.ok) return w;
      const a = w.alongside;
      if (a.template !== undefined) {
        const saved = await repos()
          .routines.saveTemplate(a.template.next, a.template.expectedVersion, { split: a.template.split, mainLifts: a.template.mainLifts })
          .catch(() => null);
        if (saved === null || !saved.ok) return { ok: false, reason: 'plan_changed', message: BUILDER_COPY.planChanged };
      } else if (a.variation !== undefined) {
        const saved = await repos()
          .planDayVariations.saveVariation(p.id, a.variation.next, a.variation.expectedVersion, req.opId)
          .catch(() => null);
        if (saved === null || saved.status === 'invalid') return { ok: false, reason: 'failed', message: BUILDER_COPY.failed };
        if (saved.status === 'limit') return { ok: false, reason: 'variation_limit', message: BUILDER_COPY.limitReached };
        if (saved.status === 'duplicate_label') return { ok: false, reason: 'variation_label', message: BUILDER_COPY.labelTaken };
        if (saved.status === 'stale') return { ok: false, reason: 'plan_changed', message: BUILDER_COPY.planChanged };
      }
      const stored = builderSetupOf(d);
      if (stored !== null) {
        const rest: BuilderSetup = { ...stored };
        delete rest.variationVersion;
        const setup: BuilderSetup = { ...rest, ...(w.templateVersion === null ? {} : { templateVersion: w.templateVersion }), variationId: w.variationId, ...(w.variationId !== null && w.variationVersion !== undefined ? { variationVersion: w.variationVersion } : {}) };
        const change = builderDraftEdit(d, { opId: req.opId, at, basis: { version: d.version }, plan: currentDraftVersion(d).plan, setup, undoable: false });
        await repos()
          .workoutDrafts.write(p.id, d.id, (current) => (current.version !== d.version && change.kind === 'write' ? { kind: 'stale', current } : change))
          .catch(() => null);
      }
      return { ok: true, planChange: w.planChange };
    },

    // -----------------------------------------------------------------------
    // The builder coach's ports (§5): what it reads and the writes it asks for

    /**
     * The open draft as the coach sees and checks it (`BuilderCoachSource.world`): the workout, slot revisions,
     * the rules' context at the draft's gym, what this gym can do, pain (rule 9), the load guard over Ben's
     * own load references, and the extras (Your data, labelled). Null when the draft is gone or started.
     */
    async coachWorld(draftId: string): Promise<BuilderCoachWorld | null> {
      const p = await owner();
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id || d.status !== 'open' || d.builderKey === undefined) return null;
      const v = currentDraftVersion(d);
      const stored = builderSetupOf(d);
      const setup = pageSetup(d);
      const workout = fromDraftPlan(v.plan, stored?.restLevel ?? 'normal');
      const inWorkout = new Set(exerciseIdsOf(workout));
      const groups = [...new Set<BuilderGroup>([...setup.groups.map((g) => g.group), 'Biceps', 'Triceps'])];
      const env = await envFor(p, { gymId: v.request.gymId, exerciseIds: [...inWorkout], groups, keySeed: `${d.id}:coach:${String(d.version)}` });
      const main = slotsOf(workout.blocks).find((x) => x.main) ?? null;
      const mainGroup: BuilderGroup | null = (main === null ? undefined : env.info(main.exerciseId)?.group) ?? setup.groups[0]?.group ?? null;
      const fresh = (g: BuilderGroup) => env.pool(g).filter((id) => !inWorkout.has(id));
      const training = await deps.training().catch(() => null);
      const memories = await repos().coach.listMemories(p.id, 'active').catch(() => []);
      const name = env.nameOf;
      const usable = [...new Set([...groups, ...BUILDER_GROUP_ORDER])].flatMap((g) => env.pool(g).slice(0, 8).map((id) => ({ exerciseId: id, name: name(id), group: g }))).slice(0, 40);
      return {
        snapshot: { draftId: d.id, draftVersion: d.version, dayName: setup.dayName, minutes: setup.minutes, supersets: setup.supersets, workout, revs: Object.fromEntries(v.plan.slots.map((x) => [x.slotKey, x.rev ?? 1])) },
        env: {
          ctx: env.ctx,
          usable: (id) => env.info(id) !== null && env.doable(id),
          pain: env.painText,
          loads: createBuilderLoadGuard({ ctx: env.ctx, refs: env.refsOf, pain: env.painText }),
          mainGroup,
          addCandidates: { arm: [...fresh('Biceps'), ...fresh('Triceps')].slice(0, 6), mainGroup: mainGroup === null ? [] : fresh(mainGroup).slice(0, 6) },
        },
        extras: {
          usable,
          painFlags: [...inWorkout].flatMap((id) => {
            const t = env.painText(id);
            return t === null ? [] : [{ exercise: name(id), text: t }];
          }),
          dayNotes: setup.dayId === CUSTOM_DAY_ID ? [] : dayNotesFor(memories, setup.dayId, setup.mainLiftExerciseId, localToday()).map((n) => n.text),
          plan: d.builderKey.planId === null || d.builderKey.dayIndex === null ? null : `${setup.dayName}: plan day ${String(d.builderKey.dayIndex + 1)}`,
          goal: training?.goal ?? null,
          history: [...inWorkout].flatMap((id) => {
            const last = env.lastTopOf(id);
            const unit = slotsOf(workout.blocks).find((x) => x.exerciseId === id)?.unit ?? p.preferredUnit;
            return last === null ? [] : [`${name(id)}: last top set ${String(last.value)} ${unit} × ${String(last.reps)}`];
          }),
          memories: memories.filter((m) => m.dayNote === undefined).map((m) => m.text).slice(0, 20),
        },
      };
    },

    /** What Coach review needs from the open draft (`BuilderReviewSource.inputs`): its day, groups, plan day and where notes go. */
    async reviewInputs(draftId: string): Promise<BuilderReviewInputs | null> {
      const p = await owner();
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id || d.builderKey === undefined) return null;
      const stored = builderSetupOf(d);
      const setup = pageSetup(d);
      const base = { dayName: setup.dayName, groups: setup.groups.map((g) => g.group), splitDayId: setup.dayId === CUSTOM_DAY_ID ? null : setup.dayId, mainLiftExerciseId: setup.mainLiftExerciseId };
      const template = stored?.templateRoutineId === undefined ? null : await repos().routines.get(stored.templateRoutineId).catch(() => null);
      const inUse = await planInUse(p.id);
      const key = d.builderKey;
      if (template === null || inUse === null || key.planId === null || key.dayIndex === null) return { ...base, plan: null };
      const t = await deps.training().catch(() => null);
      const live = await repos().routines.listByOwner(p.id).catch(() => [] as Routine[]);
      const days = new Map<number, string>();
      for (const r of planRoutines(inUse.plan, live)) {
        const k = planDayKeyOf(r, t?.split ?? null, t?.mainLifts);
        if (k !== null && !days.has(k.dayIndex)) days.set(k.dayIndex, t?.split?.days.find((x) => x.id === k.splitDayId)?.name ?? capitalise(k.splitDayId));
      }
      const gymId = v0GymOf(d);
      const nextId = inUse.paused || deps.upNextRoutineId === undefined || gymId === null ? null : await deps.upNextRoutineId(gymId).catch(() => null);
      const nextRoutine = nextId === null ? null : (live.find((r) => r.id === nextId) ?? null);
      const nextKey = nextRoutine === null ? null : planDayKeyOf(nextRoutine, t?.split ?? null, t?.mainLifts);
      // No known next day: the plan line can't be checked, so it isn't claimed (rule 6).
      if (nextKey === null) return { ...base, plan: null };
      const since = inUse.plan.applied === null ? '' : formatShortDate(toMs(inUse.plan.applied.atUtc), inUse.plan.tz);
      const plan: ReviewPlanDay = {
        planName: inUse.plan.name,
        since,
        dayName: setup.dayName,
        nextDayName: days.get(nextKey.dayIndex) ?? capitalise(nextKey.splitDayId),
        nextDayNumber: nextKey.dayIndex + 1,
        dayCount: Math.max(days.size, nextKey.dayIndex + 1),
        minutes: template.planDay?.minutes ?? t?.sessionMinutes ?? 60,
        mainLiftExerciseId: key.mainLiftExerciseId,
        exercises: specsOf(template).map((x) => ({ exerciseId: x.exerciseId, workingSets: x.workingSets })),
      };
      return { ...base, plan };
    },

    /** Set up's coach context (`BuilderCoachSource.setup`): the days with their main lifts, the rows, and code's recommendation. */
    async coachSetupContext(s: SetupInput): Promise<{ ctx: SetupCoachContext; days: BuilderDayOption[] }> {
      const p = await owner();
      const all = await dayOptions();
      const days = [...all.split, ...all.ppl];
      const env = await envFor(p, { groups: [...BUILDER_GROUP_ORDER], keySeed: 'coach-setup' });
      const out: SetupCoachContext['days'][number][] = [];
      for (const d of days) {
        // The day's main lift first (the coach's `fill_setup` default on a day change): the profile's, else the default main compound.
        const dayGroups = groupsOfParts(d.parts);
        const opens = await setupMainFor(p.id, d.id, dayGroups, () => Promise.resolve(env));
        const lead = opens ?? defaultMainOf(dayGroups, env);
        const ids = [...(lead === null ? [] : [lead]), ...env.compoundsOf(dayGroups.filter((g) => g !== 'Abs')).filter((id) => id !== lead).slice(0, 6)];
        out.push({ id: d.id, name: d.name, mainLifts: ids.map((id) => ({ exerciseId: id, catalogueId: env.exercise(id)?.catalogueKey ?? null, name: env.nameOf(id) })), defaultMainLiftExerciseId: opens });
      }
      const ctx: SetupCoachContext = {
        days: out,
        current: { dayId: s.dayId, minutes: s.minutes, mainLiftExerciseId: s.mainLiftExerciseId, supersets: s.supersets, groups: s.groups.map((g) => ({ ...g })) },
        recommend: (st) => {
          const day = days.find((x) => x.id === st.dayId);
          return recommendation({ ...s, dayId: st.dayId, dayName: day?.name ?? s.dayName, dayParts: day?.parts ?? s.dayParts, minutes: st.minutes, mainLiftExerciseId: st.mainLiftExerciseId, supersets: st.supersets, groups: [], groupsEdited: false }, env).groups;
        },
      };
      return { ctx, days };
    },

    /** A checked coach fill (`fill_setup`) as Set up's rows: the day's name and parts, its variation kept only for the same day and main lift. */
    setupFromFill(next: SetupState, changedFields: readonly SetupField[], base: SetupInput, days: readonly BuilderDayOption[]): SetupInput {
      const day = days.find((d) => d.id === next.dayId);
      const same = next.dayId === base.dayId && next.mainLiftExerciseId === base.mainLiftExerciseId;
      return {
        dayId: next.dayId,
        dayName: day?.name ?? base.dayName,
        dayParts: day?.parts ?? base.dayParts,
        minutes: next.minutes,
        mainLiftExerciseId: next.mainLiftExerciseId,
        supersets: next.supersets,
        groups: next.groups.map((g) => ({ ...g })),
        variationId: same ? base.variationId : null,
        groupsEdited: base.groupsEdited || changedFields.includes('groups'),
      };
    },

    /**
     * An applied coach proposal (`BuilderCoachWriter.applyWorkout`, rule 3: Ben's tap): a new draft version
     * (§4.4) that keeps `origin: 'builder'`, written through the builder's codec with each slot's history
     * version, `rev` bumped on every slot it changed (rule 5), and its Undo snapshot under `opId`. Refused
     * (`stale`) once the draft moved past `expectedVersion`; a retry with the same op ID writes once.
     */
    async applyCoachWorkout(req: { draftId: string; expectedVersion: number; workout: BuilderWorkout; minutes: number; opId: string; nudge?: boolean }): Promise<{ ok: true } | { ok: false; reason: 'stale' | 'failed' }> {
      const p = await owner();
      const d = await repos().workoutDrafts.get(req.draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id || d.builderKey === undefined) return { ok: false, reason: 'stale' };
      if (d.opIds.includes(req.opId)) return { ok: true };
      if (d.status !== 'open' || d.version !== req.expectedVersion) return { ok: false, reason: 'stale' };
      const v = currentDraftVersion(d);
      const stored = builderSetupOf(d) ?? storedSetup(pageSetup(d), {});
      const env = await envFor(p, { gymId: v.request.gymId, exerciseIds: exerciseIdsOf(req.workout), keySeed: `${d.id}:${req.opId}` });
      const setup: BuilderSetup = { ...stored, minutes: Math.max(BUILD_LIMITS.minMinutes, Math.min(BUILD_LIMITS.maxMinutes, Math.round(req.minutes))) };
      // (22 Oct) The coach's version is the workout now: a live Time fit's original no longer matches it. Rests the fit
      // shortened stay shortened, so they keep their note and Undo (review): a rests-only fit over the coach's version.
      delete setup.timeFit;
      const fitWas = timeFitOf(stored);
      if (fitWas !== null && (stored.restLevel ?? 'normal') !== fitWas.base.restLevel) {
        setup.timeFit = { base: toDraftPlan(req.workout, env.codec), ...(fitWas.base.restLevel === 'normal' ? {} : { baseRestLevel: fitWas.base.restLevel }), fromMinutes: fitWas.fromMinutes, dropped: [] };
      }
      const plan = withSlotRevs(v.plan, toDraftPlan(req.workout, env.codec)).plan;
      // The pre-session offer over Today's own content stays Today's card (integrity B2); over Ben's edit it's an edit.
      const own = req.nudge === true ? todayDraftState(d) : { state: 'edited' as const };
      const today = own.state === 'edited' ? undefined : { by: 'nudge' as const, controls: own.controls, hash: todayContentHash({ plan, setup, gymId: v.request.gymId }) };
      const change = builderDraftEdit(d, {
        opId: req.opId,
        at: deps.now(),
        basis: { version: req.expectedVersion },
        plan,
        setup,
        undoable: true,
        rebuild: { actionId: deriveId(`builder-coach-action:${req.opId}`), focus: v.request.focus, ...(v.request.day === undefined ? {} : { day: v.request.day }), gymId: v.request.gymId, equipmentVersion: env.equipmentVersion, contextHash: contextHash(setup, v.request.gymId, env.equipmentVersion), ...(today === undefined ? {} : { today }) },
      });
      const w = await repos()
        .workoutDrafts.write(p.id, d.id, (current) => (current.version !== d.version && change.kind === 'write' ? { kind: 'stale', current } : change))
        .catch(() => null);
      if (w === null) return { ok: false, reason: 'failed' };
      if (w.status === 'written' || w.status === 'replayed') return { ok: true };
      return { ok: false, reason: w.status === 'invalid' ? 'failed' : 'stale' };
    },

    /** Whether a write under this op ID is already on one of Ben's builder drafts (`BuilderCoachWriter.applied`). */
    async coachApplied(opId: string): Promise<boolean> {
      const p = await owner();
      const drafts = await repos().workoutDrafts.listByOwner(p.id).catch(() => [] as WorkoutDraft[]);
      return drafts.some((d) => d.builderKey !== undefined && d.opIds.includes(opId));
    },

    /** Summary's `… updated · Undo` (§2.8): the versioned inverse write; refused if it changed again since. */
    async undoPlanChange(u: PlanChangeUndo, opId: string): Promise<{ ok: true } | { ok: false; message: string }> {
      const p = await owner();
      const at = deps.now();
      if (u.kind === 'template') {
        const r = await repos().routines.get(u.routineId).catch(() => null);
        // A retry of this very Undo is done, whatever the version (rule 5; review S1).
        if (r !== null && r.lastOpId === opId) return { ok: true };
        if (r === null || r.version !== u.version) return { ok: false, message: BUILDER_COPY.changedSince };
        const t = await deps.training().catch(() => null);
        const saved = await repos().routines.saveTemplate({ ...r, exercises: u.restore, version: r.version + 1, updatedAtUtc: at.utc, lastOpId: opId }, r.version, { split: t?.split ?? null, mainLifts: t?.mainLifts });
        return saved.ok ? { ok: true } : { ok: false, message: BUILDER_COPY.changedSince };
      }
      const v = (await repos().planDayVariations.listByOwner(p.id).catch(() => [] as PlanDayVariation[])).find((x) => x.id === u.id);
      if (v === undefined) return { ok: false, message: BUILDER_COPY.changedSince };
      if (v.opIds.includes(opId)) return { ok: true };
      if (v.version !== u.version) return { ok: false, message: BUILDER_COPY.changedSince };
      const next: PlanDayVariation = u.kind === 'variation_new' ? { ...v, deletedAtUtc: at.utc, version: v.version + 1, updatedAtUtc: at.utc, opIds: [...v.opIds, opId].slice(-PLAN_DAY_LIMITS.maxOpIds) } : { ...v, extras: u.restore, version: v.version + 1, updatedAtUtc: at.utc, opIds: [...v.opIds, opId].slice(-PLAN_DAY_LIMITS.maxOpIds) };
      const w = await repos().planDayVariations.saveVariation(p.id, next, v.version, opId);
      return w.status === 'written' || w.status === 'replayed' ? { ok: true } : { ok: false, message: BUILDER_COPY.changedSince };
    },

    /**
     * Set up's Variation sheet `⋯` (§2.2, Q3): `Rename` and `Delete`
     * (`Deleted arms superset · Undo`), each a versioned write under its op
     * ID (rule 5). Your data (rule 10).
     */
    async renameVariation(id: string, label: string, w: { opId: string; expectedVersion: number }): Promise<{ ok: true } | { ok: false; message: string }> {
      const p = await owner();
      const v = (await repos().planDayVariations.listByOwner(p.id).catch(() => [] as PlanDayVariation[])).find((x) => x.id === id);
      const text = label.trim().slice(0, PLAN_DAY_LIMITS.labelMax);
      if (v === undefined || v.deletedAtUtc !== null) return { ok: false, message: BUILDER_COPY.changedSince };
      if (v.opIds.includes(w.opId)) return { ok: true };
      if (text.length === 0) return { ok: false, message: 'Give it a name' };
      const at = deps.now().utc;
      const r = await repos().planDayVariations.saveVariation(p.id, { ...v, label: text, version: v.version + 1, updatedAtUtc: at, opIds: [...v.opIds, w.opId].slice(-PLAN_DAY_LIMITS.maxOpIds) }, w.expectedVersion, w.opId);
      if (r.status === 'written' || r.status === 'replayed') return { ok: true };
      return { ok: false, message: r.status === 'duplicate_label' ? BUILDER_COPY.labelTaken : BUILDER_COPY.outOfDate };
    },

    /** `Delete` (a tombstone, so Undo puts the same variation back); `undo` is the version Undo restores from. */
    async deleteVariation(id: string, w: { opId: string; expectedVersion: number }): Promise<{ ok: true; undo: { id: string; version: number; label: string } } | { ok: false; message: string }> {
      const p = await owner();
      const v = (await repos().planDayVariations.listByOwner(p.id).catch(() => [] as PlanDayVariation[])).find((x) => x.id === id);
      if (v === undefined) return { ok: false, message: BUILDER_COPY.changedSince };
      if (v.opIds.includes(w.opId)) return { ok: true, undo: { id, version: v.version, label: v.label } };
      const at = deps.now().utc;
      const r = await repos().planDayVariations.saveVariation(p.id, { ...v, deletedAtUtc: at, version: v.version + 1, updatedAtUtc: at, opIds: [...v.opIds, w.opId].slice(-PLAN_DAY_LIMITS.maxOpIds) }, w.expectedVersion, w.opId);
      if (r.status === 'written' || r.status === 'replayed') return { ok: true, undo: { id, version: r.variation.version, label: v.label } };
      return { ok: false, message: BUILDER_COPY.outOfDate };
    },

    /** `Undo` after Delete: refused if the variation changed since, or the key is at its limit again. */
    async undoDeleteVariation(u: { id: string; version: number }, opId: string): Promise<{ ok: true } | { ok: false; message: string }> {
      const p = await owner();
      const v = (await repos().planDayVariations.listByOwner(p.id).catch(() => [] as PlanDayVariation[])).find((x) => x.id === u.id);
      if (v === undefined) return { ok: false, message: BUILDER_COPY.changedSince };
      if (v.opIds.includes(opId)) return { ok: true };
      if (v.version !== u.version || v.deletedAtUtc === null) return { ok: false, message: BUILDER_COPY.changedSince };
      const at = deps.now().utc;
      const r = await repos().planDayVariations.saveVariation(p.id, { ...v, deletedAtUtc: null, version: v.version + 1, updatedAtUtc: at, opIds: [...v.opIds, opId].slice(-PLAN_DAY_LIMITS.maxOpIds) }, v.version, opId);
      if (r.status === 'written' || r.status === 'replayed') return { ok: true };
      return { ok: false, message: r.status === 'limit' ? BUILDER_COPY.limitReached : r.status === 'duplicate_label' ? BUILDER_COPY.labelTaken : BUILDER_COPY.changedSince };
    },

    /** Summary's `… updated · Undo` after a relaunch: the plan change stored with the session (review S9). */
    async planChangeOf(sessionId: string): Promise<PlanChangeUndo | null> {
      const p = await owner();
      const a = await repos().sessions.get(sessionId).catch(() => null);
      if (a === null || a.session.ownerId !== p.id) return null;
      const u = a.session.planDay?.planChange ?? null;
      if (u === null) return null;
      // Already undone from this Summary (its Undo writes under `planChangeUndoOpId`): no second Undo line.
      const undoOp = planChangeUndoOpId(sessionId);
      if (u.kind === 'template') {
        const r = await repos().routines.get(u.routineId).catch(() => null);
        return r !== null && r.lastOpId === undoOp ? null : u;
      }
      const v = (await repos().planDayVariations.listByOwner(p.id).catch(() => [] as PlanDayVariation[])).find((x) => x.id === u.id);
      return v !== undefined && v.opIds.includes(undoOp) ? null : u;
    },

    /** Advice now on the draft (for a coach proposal's `⚠` line; the coach stream reads it). */
    async adviceFor(draftId: string): Promise<BuilderAdvice[]> {
      const snap = await service.read(draftId);
      if (snap === null) return [];
      const p = await owner();
      const env = await envFor(p, { exerciseIds: exerciseIdsOf(snap.workout), keySeed: 'advice' });
      return adviseBuilder(snap.workout.blocks, env.info);
    },
  };

  /** The template's exercises after `Update … in your plan`: the draft's structure, loads left to the rules each week (Q6: typed kg stays today only). */
  function templateExercisesOf(template: Routine, d: WorkoutDraft, opId: string, atUtc: string, plan: DraftPlan): RoutineExercise[] {
    const v = { ...currentDraftVersion(d), plan };
    const asRoutine = draftAsRoutine(d, v);
    const old = new Map(template.exercises.map((e) => [e.exerciseId, e]));
    const slots = new Map(v.plan.slots.map((s) => [s.slotKey, s]));
    return asRoutine.exercises.map((e, i): RoutineExercise => {
      const was = old.get(e.exerciseId);
      // Ben's own rests per set type go with the structure (review S8); the rest keep the template's.
      const own = slots.get(e.id)?.builder?.restS ?? {};
      const restBySetType: RoutineExercise['restBySetType'] = { ...(was?.restBySetType ?? {}) };
      for (const t of ['warmup', 'top', 'backoff', 'working', 'drop'] as const) {
        const sec = own[t];
        if (sec !== undefined) restBySetType[t] = { seconds: sec };
      }
      const setTemplates = e.setTemplates.map((t, k) => ({ ...t, id: deriveId(`builder-template-set:${template.id}:${opId}:${String(i)}:${String(k)}`), targetLoad: null }));
      const sameShape = was !== undefined && was.setTemplates.length === setTemplates.length && was.setTemplates.every((t, k) => t.setType === setTemplates[k]?.setType);
      return {
        ...e,
        id: was?.id ?? deriveId(`builder-template-ex:${template.id}:${opId}:${String(i)}`),
        order: i,
        equipmentId: was?.equipmentId ?? null,
        restBySetType,
        transitionRestS: was?.transitionRestS ?? null,
        progressionRuleId: was?.progressionRuleId ?? null,
        structureChangedAtUtc: sameShape && was.order === i ? (was.structureChangedAtUtc ?? atUtc) : atUtc,
      };
    });
  }

  return service;
}

export type BuilderService = ReturnType<typeof createBuilderService>;

/** A count stays 1–4 per group; the workout at most 10 exercises (§2.2, §4.7). */
export const SETUP_LIMITS = { minCount: 1, maxCount: 4, minMinutes: BUILD_LIMITS.minMinutes, maxMinutes: BUILD_LIMITS.maxMinutes } as const;

/** Working sets in a slot (for `+N W` and set counts). */
export { workingCount };
