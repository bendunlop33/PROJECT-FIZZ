import {
  adviseBuilder,
  alignToDraft,
  applyBuilderEdit,
  applyVariation,
  buildFromSetup,
  builderChangeLine,
  builderChanges,
  builderDraftEdit,
  builderDraftUndo,
  builderSetupOf,
  CUSTOM_DAY_ID,
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
  type BuilderAdvice,
  type BuilderEditBasis,
  type BuilderEditOp,
  type BuilderEditRefusal,
  type BuilderWorkout,
  type DraftLifeChange,
  type RestKind,
  type GroupCount,
  type SkippedOp,
  type StartAlongside,
  type TemplateSlotSpec,
} from '@fizz/domain';
import { builderFocusSections, BUILD_LIMITS, PLAN_DAY_LIMITS, type BuildDay, type BuildFocus, type BuilderDraftKey, type BuilderGroup, type BuilderSetup, type Gym, type PlanDayVariation, type PlanDraft, type Routine, type RoutineExercise, type SessionCheckIn, type SessionPlanDay, type SplitBodyPart, type TrainingProfile, type UserProfile, type WorkoutDraft, type ZonedTimestamp } from '@fizz/schemas';
import type { Store } from '@fizz/persistence';

import type { WorkoutStartOutcome, WorkoutStartRequest } from '../services/workout-services';
import type { BuilderEnv, BuilderEnvPort } from './builder-env';

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
}

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
}

export interface SetupFacts {
  days: { split: BuilderDayOption[]; ppl: BuilderDayOption[] };
  /** The day's main lifts; the first is `From Profile` when there is one. */
  mainLifts: { id: string; name: string; fromProfile: boolean }[];
  /** `Standard` + these (shown only when there are any). */
  variations: { id: string; label: string }[];
  recommended: { count: number; groups: GroupCount[] };
  total: number;
  /** The plan-day template this set-up opens (no rebuild), if any. */
  template: { routineId: string; version: number } | null;
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
  /** Each slot's rest per kind now (Ben's own, else the default), and `round` for a superset (§3.2). */
  rests: Record<string, Partial<Record<RestKind | 'round', number>>>;
  /** The item each slot's loads are worked out on (the keyboard's kg steps, §2.7). */
  items: Record<string, string | null>;
  startable: boolean;
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

/** A plan change made at Start, for Summary's `Chest · bench updated · Undo` (versioned inverse write, §4.6). */
export type PlanChangeUndo =
  | { kind: 'template'; routineId: string; version: number; restore: RoutineExercise[]; label: string }
  | { kind: 'variation_new'; id: string; version: number; label: string }
  | { kind: 'variation_update'; id: string; version: number; restore: PlanDayVariation['extras']; label: string };

export type BuilderStartResult =
  | { ok: true; sessionId: string; duplicate: boolean; planChange: PlanChangeUndo | null }
  | { ok: false; reason: 'stale' | 'plan_changed' | 'variation_limit' | 'variation_label' | 'empty' | 'gone' | 'failed'; message: string };

export const BUILDER_COPY = {
  outOfDate: 'Out of date. Reload.',
  closed: 'This workout was started or closed.',
  planChanged: 'Your plan changed. Today only?',
  limitReached: 'Limit reached',
  labelTaken: 'Name already used',
  empty: 'Add an exercise first',
  changedSince: 'Changed since · can’t undo',
  failed: 'Couldn’t save. Try again.',
  rebuilt: 'Rebuilt',
  swapped: 'Swapped',
  setDeleted: 'Set deleted',
  keepOneSet: 'Keep at least one set',
  deleted: (name: string) => `Deleted ${name}`,
  updated: (label: string) => `${label} updated`,
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

  function groupPartsOf(g: BuilderGroup): SplitBodyPart[] {
    return storedGroupsOf([{ group: g, count: 1 }])[0]?.parts ?? [];
  }

  // -------------------------------------------------------------------------
  // Stored set-up ↔ page

  function storedSetup(s: SetupInput, extra: { templateRoutineId?: string; templateVersion?: number; restLevel?: BuilderSetup['restLevel'] }): BuilderSetup {
    return {
      dayId: s.dayId,
      minutes: Math.max(BUILD_LIMITS.minMinutes, Math.min(BUILD_LIMITS.maxMinutes, Math.round(s.minutes))),
      mainLiftExerciseId: s.mainLiftExerciseId,
      supersets: s.supersets,
      groups: storedGroupsOf(s.groups),
      variationId: s.variationId,
      ...(extra.templateRoutineId === undefined ? {} : { templateRoutineId: extra.templateRoutineId }),
      ...(extra.templateVersion === undefined ? {} : { templateVersion: extra.templateVersion }),
      ...(extra.restLevel === undefined || extra.restLevel === 'normal' ? {} : { restLevel: extra.restLevel }),
      ...(s.groupsEdited ? { groupsEdited: true as const } : {}),
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

  async function snapshotOf(p: UserProfile, d: WorkoutDraft, env: BuilderEnv, skipped: SkippedOp[] = []): Promise<BuilderSnapshot> {
    const v = currentDraftVersion(d);
    const stored = builderSetupOf(d);
    const setup = pageSetup(d);
    const workout = fromDraftPlan(v.plan, stored?.restLevel ?? 'normal');
    const minutes = estimateBuilderMinutes(workout, env.ctx);
    const variation = setup.variationId === null ? null : ((await variationsFor(p.id, setup.dayId, setup.mainLiftExerciseId)).find((x) => x.id === setup.variationId) ?? null);
    const facts: Record<string, ExerciseFacts> = {};
    for (const s of slotsOf(workout.blocks)) facts[s.exerciseId] = { name: env.nameOf(s.exerciseId), works: env.worksOf(s.exerciseId), group: env.info(s.exerciseId)?.group ?? null, compound: env.info(s.exerciseId)?.role === 'compound', mayHurt: env.painFlagged(s.exerciseId) };
    const key = d.builderKey;
    const planDay =
      key !== undefined && key.planId !== null && key.dayIndex !== null && key.splitDayId !== null
        ? { planId: key.planId, dayIndex: key.dayIndex, splitDayId: key.splitDayId, templateRoutineId: stored?.templateRoutineId ?? null, templateVersion: stored?.templateVersion ?? null, label: planLabel(setup, env, variation?.label ?? null) }
        : null;
    return {
      draftId: d.id,
      version: d.version,
      setup,
      workout,
      minutes,
      over: minutes > setup.minutes,
      name: d.name,
      planDay,
      variationLabel: variation?.label ?? null,
      undo: d.undo === null || d.undo === undefined || d.undo.atVersion !== d.version ? null : { opId: d.undo.opId },
      facts,
      unit: p.preferredUnit,
      skipped,
      revs: Object.fromEntries(v.plan.slots.map((s) => [s.slotKey, s.rev ?? 1])),
      rests: restsOf(workout, env),
      items: Object.fromEntries(v.plan.slots.map((s) => [s.slotKey, s.checkedOn?.equipmentId ?? null])),
      startable: d.status === 'open' && v.plan.slots.length > 0,
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

  function draftKey(s: SetupInput, plan: { planId: string; dayIndex: number } | null): BuilderDraftKey {
    return {
      planId: plan?.planId ?? null,
      dayIndex: plan?.dayIndex ?? null,
      splitDayId: s.dayId === CUSTOM_DAY_ID ? null : s.dayId,
      mainLiftExerciseId: s.mainLiftExerciseId,
      localDate: localToday(),
    };
  }

  const contextHash = (setup: BuilderSetup, gymId: string | null, equipmentVersion: string) => deriveId(`builder-context:${stableStringify({ setup, gymId, equipmentVersion })}`);

  // -------------------------------------------------------------------------
  // Writes

  async function writeDraft(p: UserProfile, draftId: string, compute: (current: WorkoutDraft) => Promise<{ change: DraftLifeChange; env: BuilderEnv; toast: BuilderToast | null; skipped?: SkippedOp[] } | { refused: BuilderEditRefusal | 'nothing_to_undo' | 'changed_since'; env: BuilderEnv | null }>): Promise<BuilderWriteResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const read = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (read === null || read.ownerId !== p.id || read.builderKey === undefined) return { status: 'closed', snapshot: null, message: BUILDER_COPY.closed };
      const r = await compute(read);
      if ('refused' in r) {
        const message = r.refused === 'changed_since' ? BUILDER_COPY.changedSince : r.refused === 'nothing_to_undo' ? BUILDER_COPY.changedSince : (REFUSAL_TEXT[r.refused] ?? 'Can’t do that');
        return { status: 'refused', reason: r.refused, message, snapshot: r.env === null ? null : await snapshotOf(p, read, r.env) };
      }
      // The change was worked out from `read`: written only if the stored draft is still that one.
      const w = await repos().workoutDrafts.write(p.id, draftId, (current) => (current.version !== read.version && r.change.kind === 'write' ? { kind: 'stale', current } : r.change));
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
        return null;
    }
  }

  const service = {
    copy: BUILDER_COPY,

    /** Set up's starting rows for a day (§2.1 `Build your own`, Day = the card's day). */
    async initialSetup(req: { dayId?: string } = {}): Promise<SetupInput> {
      const p = await owner();
      const days = await dayOptions();
      const all = [...days.split, ...days.ppl];
      const day = all.find((d) => d.id === req.dayId) ?? days.split[0] ?? days.ppl[0];
      const t = await deps.training().catch(() => null);
      const minutes = t?.sessionMinutes ?? 60;
      if (day === undefined) return { dayId: CUSTOM_DAY_ID, dayName: 'Custom', dayParts: [], minutes, mainLiftExerciseId: null, supersets: true, groups: [], variationId: null, groupsEdited: false };
      const main = await profileMainLift(day.id);
      const s: SetupInput = { dayId: day.id, dayName: day.name, dayParts: day.parts, minutes, mainLiftExerciseId: main, supersets: true, groups: [], variationId: null, groupsEdited: false };
      const env = await envFor(p, { groups: groupsOfParts(day.parts), exerciseIds: main === null ? [] : [main], keySeed: 'setup' });
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
      const mainLifts = [...(profileMain === null ? [] : [{ id: profileMain, name: env.nameOf(profileMain), fromProfile: true }]), ...compounds.filter((id) => id !== profileMain).map((id) => ({ id, name: env.nameOf(id), fromProfile: false }))];
      const variations = (await variationsFor(p.id, s.dayId, s.mainLiftExerciseId)).map((v) => ({ id: v.id, label: v.label }));
      const t = s.dayId === CUSTOM_DAY_ID ? null : await templateFor(p.id, s.dayId, s.mainLiftExerciseId);
      return {
        days,
        mainLifts,
        variations,
        recommended: recommendation(s, env),
        total: s.groups.reduce((m, g) => m + g.count, 0),
        template: t === null ? null : { routineId: t.routine.id, version: t.routine.version },
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
      const plan = built.plan;
      const stored = storedSetup(s, plan === null ? {} : { templateRoutineId: plan.routine.id, templateVersion: plan.routine.version });
      const draftPlan = withSlotRevs(null, toDraftPlan(built.workout, built.env.codec)).plan;
      const draft = newBuilderDraft({
        id,
        ownerId: p.id,
        opId,
        actionId: deriveId(`builder-action:${opId}`),
        name: nameOf(s, built.env, built.variation?.label ?? null),
        key: draftKey(s, plan),
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
          if (stableStringify(storedSetup(prev, {})) === stableStringify(storedSetup(s, {}))) return { status: 'replayed', snapshot: await snapshotOf(p, r.draft, built.env), toast: null };
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
      const env = await envFor(p, { exerciseIds: r.exercises.map((e) => e.exerciseId), keySeed: 'groups' });
      const counts = new Map<BuilderGroup, number>();
      for (const e of r.exercises) {
        const g = env.info(e.exerciseId)?.group;
        if (g !== undefined) counts.set(g, Math.min(4, (counts.get(g) ?? 0) + 1));
      }
      return service.create({ ...s, groups: [...counts].map(([group, count]) => ({ group, count })) }, opId);
    },

    /** Your workout for a draft (reopen after leaving or a force-close: every edit kept). */
    async read(draftId: string): Promise<BuilderSnapshot | null> {
      const p = await owner();
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id || d.builderKey === undefined) return null;
      const env = await envFor(p, { exerciseIds: exerciseIdsOf(fromDraftPlan(currentDraftVersion(d).plan)), keySeed: `${d.id}:read` });
      return snapshotOf(p, d, env);
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
        return { change, env, toast: toastFor(op, before, r.advice, env, w.opId) };
      });
    },

    /**
     * Back to Set up and changing it (§2.3, Ben "agreed"): Length, Supersets
     * and group counts merge into the edited workout; a new Day, Main lift or
     * Variation builds a new workout (`Rebuilt · Undo` restores both pages).
     */
    async changeSetup(draftId: string, next: SetupInput, w: { opId: string; expectedVersion: number }): Promise<BuilderWriteResult> {
      const p = await owner();
      return writeDraft(p, draftId, async (current) => {
        const v = currentDraftVersion(current);
        const stored = builderSetupOf(current);
        const prev = pageSetup(current);
        const workout = fromDraftPlan(v.plan, stored?.restLevel ?? 'normal');
        const nextStored = storedSetup(next, { ...(stored?.templateRoutineId === undefined ? {} : { templateRoutineId: stored.templateRoutineId }), ...(stored?.templateVersion === undefined ? {} : { templateVersion: stored.templateVersion }), ...(stored?.restLevel === undefined ? {} : { restLevel: stored.restLevel }) });
        const env = await envFor(p, { gymId: v.request.gymId, exerciseIds: exerciseIdsOf(workout), groups: next.groups.map((g) => g.group), keySeed: `${current.id}:${w.opId}` });
        if (current.opIds.includes(w.opId)) return { change: { kind: 'duplicate', current }, env, toast: null };
        const m = mergeSetupChange(ruleSetupOf(storedSetup(prev, {})), ruleSetupOf(storedSetup(next, {})), workout, env.pool, env.ctx);
        const basis = { version: w.expectedVersion };
        if (m.kind === 'rebuild') {
          const built = await buildFor(p, next, `${current.id}:${w.opId}`, v.request.gymId);
          const setup = storedSetup(next, built.plan === null ? {} : { templateRoutineId: built.plan.routine.id, templateVersion: built.plan.routine.version });
          const plan = withSlotRevs(v.plan, toDraftPlan(built.workout, built.env.codec)).plan;
          const day = buildDayOf(next);
          const change = builderDraftEdit(current, {
            opId: w.opId,
            at: deps.now(),
            basis,
            plan,
            setup,
            name: nameOf(next, built.env, built.variation?.label ?? null),
            rebuild: { actionId: deriveId(`builder-action:${w.opId}`), focus: focusOf(next.dayId), ...(day === undefined ? {} : { day }), gymId: built.env.gymId, equipmentVersion: built.env.equipmentVersion, contextHash: contextHash(setup, built.env.gymId, built.env.equipmentVersion) },
            undoable: true,
          });
          return { change, env: built.env, toast: { text: BUILDER_COPY.rebuilt, undoOpId: w.opId, why: null }, skipped: built.skipped };
        }
        const after = m.kind === 'merged' ? m.workout : workout;
        const restLevel = after.restLevel;
        const plan = withSlotRevs(v.plan, toDraftPlan(after, env.codec)).plan;
        const change = builderDraftEdit(current, { opId: w.opId, at: deps.now(), basis, plan, setup: { ...nextStored, ...(restLevel === 'normal' ? {} : { restLevel }) }, undoable: true });
        return { change, env, toast: null };
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
    async exerciseChoices(draftId: string, req: { slotKey: string | null; group?: BuilderGroup }): Promise<{ group: BuilderGroup; groups: BuilderGroup[]; sections: { focus: string; items: { exerciseId: string; name: string; works: string | null; mayHurt: boolean }[] }[] } | null> {
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
      ).map((sec) => ({ focus: sec.focus, items: sec.items.map((e) => ({ exerciseId: e.id, name: e.name, works: env.worksOf(e.id), mayHurt: env.painFlagged(e.id) })) }));
      return { group, groups: ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps', 'Abs'], sections };
    },

    /** `Why this weight?` (§2.4): where the load came from, numbers from code only. */
    async whyWeight(draftId: string, slotKey: string): Promise<string[]> {
      const snap = await service.read(draftId);
      const slot = snap === null ? null : slotsOf(snap.workout.blocks).find((s) => s.key === slotKey);
      if (snap === null || slot === undefined || slot === null) return [];
      const p = await owner();
      const env = await envFor(p, { exerciseIds: [slot.exerciseId], keySeed: 'why' });
      const u = slot.unit;
      const lines: string[] = [];
      const work = slot.rows.find((r) => r.type !== 'warmup');
      switch (slot.source) {
        case 'coach_target':
          lines.push('Coach target');
          break;
        case 'plan':
          lines.push('Plan, week 1');
          break;
        case 'rule':
          lines.push(ruleLine(env.lastTopOf(slot.exerciseId), work?.load ?? null));
          break;
        case 'calc':
          if (slot.anchorE1rm !== null && work !== undefined) lines.push(`Est. max ${String(Math.round(slot.anchorE1rm))} ${u} (estimate) · ${String(work.reps)} reps @ RPE ${String(work.rpe ?? 8)}`);
          break;
        case 'none':
          lines.push(slot.startLight === null ? 'Start light' : `Start light · up to ${String(slot.startLight)} ${u}`);
          break;
      }
      if (slot.rows.some((r) => r.typed === true)) lines.push('Typed by you');
      if (env.painFlagged(slot.exerciseId)) lines.push('May hurt · held at last time');
      return lines;
    },

    /** The Start prompt (§2.8): null when the workout matches its plan day (load-only edits don't count, Q11) or isn't a plan day. */
    async startPrompt(draftId: string): Promise<StartPrompt | null> {
      const p = await owner();
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id) return null;
      const stored = builderSetupOf(d);
      if (stored?.templateRoutineId === undefined) return null;
      const template = await repos().routines.get(stored.templateRoutineId).catch(() => null);
      if (template === null) return null;
      const current = fromDraftPlan(currentDraftVersion(d).plan, stored.restLevel ?? 'normal');
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
      return {
        lines: changes.map((c) => builderChangeLine(c, env.nameOf)),
        updateLabel: planOk ? `Update ${label}${variation === null ? ' in your plan' : ''}` : null,
        variationLimitReached: variations.length >= PLAN_DAY_LIMITS.maxVariations,
        suggestedLabel: suggestVariationLabel(changes, env.info),
        canSaveVariation: variationExtrasOf(openTemplate(template, null, env).workout, current).ok,
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
      const key = d.builderKey;
      const gymId = req.gymId ?? v.request.gymId ?? (await deps.currentGym().catch(() => null))?.id ?? null;
      if (gymId === null) return { ok: false, reason: 'failed', message: 'Add a gym first' };
      const at = deps.now();
      let alongside: StartAlongside | undefined;
      let planChange: PlanChangeUndo | null = null;
      let templateVersion = stored?.templateVersion ?? null;
      let variationId = setup.variationId;
      const template = stored?.templateRoutineId === undefined ? null : await repos().routines.get(stored.templateRoutineId).catch(() => null);
      if (req.choice.kind !== 'today') {
        if (template === null || stored?.templateVersion === undefined) return { ok: false, reason: 'plan_changed', message: BUILDER_COPY.planChanged };
        const current = fromDraftPlan(v.plan, stored.restLevel ?? 'normal');
        const env = await envFor(p, { exerciseIds: [...template.exercises.map((e) => e.exerciseId), ...exerciseIdsOf(current)], keySeed: 'start' });
        const variations = await variationsFor(p.id, setup.dayId, setup.mainLiftExerciseId);
        const open = setup.variationId === null ? null : (variations.find((x) => x.id === setup.variationId) ?? null);
        const t = await deps.training().catch(() => null);
        const label = planLabel(setup, env, null);
        if (req.choice.kind === 'update' && open === null) {
          const exercises = templateExercisesOf(template, d, req.opId, at.utc);
          // An older plan workout gains its `planDay` key on this write (§4.2: derived on read, written only by a change).
          const planDayField = template.planDay ?? (key?.planId != null && key.dayIndex !== null && key.splitDayId !== null ? { planId: key.planId, dayIndex: key.dayIndex, splitDayId: key.splitDayId, mainLiftExerciseId: key.mainLiftExerciseId, minutes: setup.minutes } : undefined);
          const next: Routine = { ...template, exercises, version: template.version + 1, updatedAtUtc: at.utc, lastOpId: req.opId, source: 'ben', ...(planDayField === undefined ? {} : { planDay: planDayField }) };
          alongside = { opId: req.opId, template: { next, expectedVersion: stored.templateVersion, split: t?.split ?? null, mainLifts: t?.mainLifts } };
          planChange = { kind: 'template', routineId: template.id, version: next.version, restore: template.exercises, label };
          templateVersion = next.version;
        } else {
          const extras = variationExtrasOf(openTemplate(template, null, env).workout, current);
          if (!extras.ok) return { ok: false, reason: 'failed', message: 'Too many changes for a variation' };
          if (req.choice.kind === 'update' && open !== null) {
            const next: PlanDayVariation = { ...open, extras: extras.extras, version: open.version + 1, updatedAtUtc: at.utc, basedOn: { routineId: template.id, version: template.version }, opIds: [...open.opIds, req.opId].slice(-PLAN_DAY_LIMITS.maxOpIds) };
            alongside = { opId: req.opId, variation: { next, expectedVersion: open.version } };
            planChange = { kind: 'variation_update', id: open.id, version: next.version, restore: open.extras, label: planLabel(setup, env, open.label) };
          } else if (req.choice.kind === 'variation') {
            if (setup.dayId === CUSTOM_DAY_ID) return { ok: false, reason: 'failed', message: BUILDER_COPY.failed };
            const id = deriveId(`builder-variation:${req.opId}`);
            const labelText = req.choice.label.trim().slice(0, PLAN_DAY_LIMITS.labelMax);
            if (labelText.length === 0) return { ok: false, reason: 'variation_label', message: 'Give it a name' };
            const next: PlanDayVariation = { id, ownerId: p.id, version: 1, createdAtUtc: at.utc, updatedAtUtc: at.utc, splitDayId: setup.dayId, mainLiftExerciseId: setup.mainLiftExerciseId, label: labelText, extras: extras.extras, basedOn: { routineId: template.id, version: template.version }, deletedAtUtc: null, opIds: [req.opId] };
            alongside = { opId: req.opId, variation: { next, expectedVersion: null } };
            planChange = { kind: 'variation_new', id, version: 1, label: planLabel(setup, env, labelText) };
            variationId = id;
          }
        }
      }
      const planDay: SessionPlanDay | undefined =
        key?.planId != null && key.dayIndex !== null && key.splitDayId !== null
          ? { planId: key.planId, dayIndex: key.dayIndex, splitDayId: key.splitDayId, mainLiftExerciseId: key.mainLiftExerciseId, templateRoutineId: template === null || templateVersion === null ? null : template.id, templateVersion: template === null ? null : templateVersion, variationId }
          : undefined;
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
      return { ok: false, reason: 'failed', message: 'message' in e && typeof e.message === 'string' ? e.message : BUILDER_COPY.failed };
    },

    /** Summary's `… updated · Undo` (§2.8): the versioned inverse write; refused if it changed again since. */
    async undoPlanChange(u: PlanChangeUndo, opId: string): Promise<{ ok: true } | { ok: false; message: string }> {
      const p = await owner();
      const at = deps.now();
      if (u.kind === 'template') {
        const r = await repos().routines.get(u.routineId).catch(() => null);
        if (r === null || r.version !== u.version) return { ok: false, message: BUILDER_COPY.changedSince };
        if (r.lastOpId === opId) return { ok: true };
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
  function templateExercisesOf(template: Routine, d: WorkoutDraft, opId: string, atUtc: string): RoutineExercise[] {
    const asRoutine = draftAsRoutine(d, currentDraftVersion(d));
    const old = new Map(template.exercises.map((e) => [e.exerciseId, e]));
    return asRoutine.exercises.map((e, i): RoutineExercise => {
      const was = old.get(e.exerciseId);
      const setTemplates = e.setTemplates.map((t, k) => ({ ...t, id: deriveId(`builder-template-set:${template.id}:${opId}:${String(i)}:${String(k)}`), targetLoad: null }));
      const sameShape = was !== undefined && was.setTemplates.length === setTemplates.length && was.setTemplates.every((t, k) => t.setType === setTemplates[k]?.setType);
      return {
        ...e,
        id: was?.id ?? deriveId(`builder-template-ex:${template.id}:${opId}:${String(i)}`),
        order: i,
        equipmentId: was?.equipmentId ?? null,
        restBySetType: was?.restBySetType ?? {},
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
