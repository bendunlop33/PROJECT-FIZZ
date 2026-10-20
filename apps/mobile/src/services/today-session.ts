import {
  activePause,
  addDays,
  assembleTodayDraft,
  breakdownUnit,
  builderInfoOfExercise,
  builderUsable,
  builderWorkoutToDraftPlan,
  buildTodayStrip,
  checkedOnOf,
  convertValue,
  currentDraftVersion,
  defaultTodayControls,
  deriveId,
  doableHere,
  draftPlanAsBuilderWorkout,
  estimateBuilderMinutes,
  formatNumber,
  isInHistory,
  lastUsedMainLift,
  legRunNear,
  liveRoutines,
  loadReferences,
  localDateOf,
  localDateText,
  noReferenceCeiling,
  otherMainOptions,
  otherSessionDay,
  painFlagCovering,
  planRoutines,
  splitInUse,
  stableStringify,
  substituteTargets,
  TODAY_OTHER_SESSIONS,
  TODAY_V2_COPY,
  todayBreakdown,
  todayFitLine,
  todayMixLine,
  todayPlanDays,
  todayWhy,
  toIso,
  toMs,
  type AnchorLoad,
  type BuilderContext,
  type BuilderExerciseInfo,
  type BuilderGroupName,
  type BuilderWorkout,
  type FinishedRef,
  type HistorySession,
  type LegRunNear,
  type SlotLoadInput,
  type StripCell,
  type SubstituteContext,
  type TodayBreakdownRow,
  type TodayControls,
  type TodayDay,
  type TodayDraft,
  type TodayMixFacts,
  type TodayMixLine,
  type TodayReviewStatus,
  type TodayTemplate,
} from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import {
  BUILDER_GROUP_PARTS,
  COACH_DRAFT_DAYS,
  MAX_WORKOUT_DRAFT_OPS,
  MAX_WORKOUT_DRAFT_VERSIONS,
  worksLine,
  type Activity,
  type BuilderDraftKey,
  type DraftPlan,
  type EquipmentInstance,
  type Exercise,
  type Gym,
  type PainFlag,
  type SessionAggregate,
  type SessionCheckIn,
  type SplitBodyPart,
  type TrainingProfile,
  type UserProfile,
  type WorkoutDraft,
  type WorkoutDraftVersion,
  type ZonedTimestamp,
} from '@fizz/schemas';

import type { CoachStatus } from '../coach/coach-service';
import type { WorkoutStartOutcome, WorkoutStartRequest } from './workout-services';

/**
 * `todaySession` (workout-builder-v3 §2.0 Today (v2), with Ben's 20 Oct
 * additions): today's session card, drafted from the plan by the Wave 1
 * builder rules, never by the screen (CLAUDE.md: UI never computes
 * progression).
 *
 * - `load()` reads everything once per data change (local only, never an AI
 *   call): the applied plan's days and their main-lift templates, Up next
 *   (with the run rule and a pin), the last-used template per day (Q2),
 *   Ben's history (pools, Mix it up facts, Why?), activities (strip, clash),
 *   open builder drafts for today (`edited`) and each exercise's load inputs
 *   at the selected gym: the template's dry run (coach next-session targets,
 *   the plan's first loads, the built-in rule) else the rule on its own
 *   history, est. max from his own sets (an estimate), the first-time
 *   ceiling, the pain hold. Rounding down to the gym is the builder's (rule 4).
 * - `card(data, selection)` is pure and fast: the five controls → the draft,
 *   fit line, clash line, breakdown, Why?, Mix it up.
 * - `commit()` writes the card's workout as today's open builder draft (one
 *   per plan day, main lift and date, §4.4), idempotent on its op ID; an
 *   edited draft (Ben changed it in the builder) is never overwritten.
 * - `start()` starts that draft (one tap): its own loads, its plan-day
 *   provenance (§4.2: Up next credits what Ben does), version-checked.
 * Nothing is written by picking a day, chip or control (§2.0.8 check 8).
 */

export interface TodaySessionPort {
  historyFor: (ownerId: string, exerciseId: string) => Promise<HistorySession[]>;
  substituteCtx: (p: UserProfile, gymId: string, gymEquipment: readonly EquipmentInstance[] | undefined, exerciseIds: Iterable<string>) => Promise<SubstituteContext>;
  upNextRoutineId: (gymId: string, gymEquipment?: readonly EquipmentInstance[]) => Promise<string | null>;
  plannedDay: (routineId: string, gymId: string) => Promise<{ aggregate: SessionAggregate } | null>;
  nextAfter: (gymId: string, routineId: string) => Promise<string | null>;
  start: (req: WorkoutStartRequest) => Promise<WorkoutStartOutcome>;
}

export interface TodaySessionDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  newId: () => string;
  catalogueExercises: () => readonly Exercise[];
  currentGym: () => Promise<Gym | null>;
  /** The typical gym's items, while no gym is saved (loads planned on them, as the coach's builds are). */
  typicalEquipment: () => Promise<readonly EquipmentInstance[] | null>;
  coachStatus: () => Promise<CoachStatus>;
  port: TodaySessionPort;
}

/** Per group, how many catalogue exercises join Ben's own in a pool (the rest are reachable in the builder). */
const CATALOGUE_PER_GROUP = 8;
/** Up next's and the pools' history window. */
const WINDOW_DAYS = 42;
const DAY_MS = 86_400_000;
/** A day's sessions that count as "lately" for Mix it up's target. */
const RECENT_ON_DAY = 4;

export type TodaySessionStatus = 'plan' | 'paused' | 'no_plan';

/** An open builder draft for today that Ben changed in the builder (`Chest · edited`). */
export interface TodayEditedDraft {
  draftId: string;
  version: number;
  name: string;
  workout: BuilderWorkout;
}

export interface TodaySessionData {
  status: TodaySessionStatus;
  ownerId: string;
  localDate: string;
  tz: string;
  unit: 'kg' | 'lb';
  gymId: string | null;
  equipmentVersion: string;
  days: TodayDay[];
  others: TodayDay[];
  /** The plan's next day (null: no plan, or paused). */
  nextKey: string | null;
  /** The controls each day opens with (its last-used main lift, the goal's accessories, the plan's length). */
  initial: Readonly<Record<string, TodayControls>>;
  goal: 'strength' | 'muscle' | 'both' | null;
  review: TodayReviewStatus;
  coachLabel: string;
  /** Open, edited builder drafts for today, by `dayKey|mainLift`. */
  edited: Readonly<Record<string, TodayEditedDraft>>;
  /** The long or hard run near today (the clash line). */
  near: LegRunNear | null;
  strip: { workouts: { sessionId: string; localDate: string; title: string }[]; activities: Activity[]; firstUse: boolean };
  /** Done today (a second session can still be picked). */
  doneToday: boolean;
  /** Compute context (pure functions over what `load` read). */
  internal: TodayInternal;
}

interface TodayInternal {
  ctx: BuilderContext;
  info: (id: string) => BuilderExerciseInfo | null;
  nameOf: (id: string) => string;
  worksOf: (id: string) => string | null;
  /** Per group, Ben's own (most done first) then the catalogue, here and not pain-flagged. */
  groupPool: (g: BuilderGroupName) => readonly string[];
  mixFor: (day: TodayDay) => TodayMixFacts;
  lastOf: (day: TodayDay, mainLiftExerciseId: string | null) => { dateText: string; lift: string; value: string; reps: number; rpe: number | null } | null;
  liftTargetOf: (exerciseId: string | null) => string | null;
  catalogueIdOf: (id: string) => string;
  checkedOn: (id: string) => ReturnType<typeof checkedOnOf>;
  /** This gym can do it (§3.7). */
  here: (id: string) => boolean;
  /** An active pain flag covers it (rule 9). */
  pained: (id: string) => boolean;
}

export interface TodaySelection {
  dayKey: string;
  controls: TodayControls;
}

export interface TodayCardView {
  dayKey: string;
  /** `Chest`, or `Chest · edited`. */
  title: string;
  edited: TodayEditedDraft | null;
  /** `5 exercises · ~52 min`. */
  summary: string;
  minutes: number;
  exerciseCount: number;
  fitLine: string | null;
  over: boolean;
  clashLine: string | null;
  controls: {
    mainLifts: { exerciseId: string | null; label: string; selected: boolean }[];
    accessories: 'focused' | 'varied';
    minutes: number;
    abs: { on: boolean; planOn: boolean; differs: boolean };
    supersets: boolean;
  };
  unit: 'kg' | 'lb';
  rows: TodayBreakdownRow[];
  why: string[];
  mix: TodayMixLine | null;
  /** `↻ Mix it up` is offered (there's a fresh option). */
  mixAvailable: boolean;
  startable: boolean;
  /** For `commit` (the code draft; null when edited). */
  draft: TodayDraft | null;
}

export type TodayCommitResult = { ok: true; draftId: string; version: number } | { ok: false; message: string };
export type TodayStartResult = WorkoutStartOutcome | { ok: false; error: { code: 'stale_draft' | 'not_found'; message: string } };

export const TODAY_SESSION_COPY = {
  stale: 'Changed since. Check it and try again.',
  failed: 'Couldn’t save. Try again.',
  empty: 'Add an exercise first.',
} as const;

const titleOf = (name: string | null | undefined): string => (name ?? '').split('·')[0]?.trim() || 'Workout';

export function createTodaySessionService(deps: TodaySessionDeps) {
  const repos = () => deps.store().repos;

  async function exerciseIndex(): Promise<Map<string, Exercise>> {
    const out = new Map<string, Exercise>();
    for (const e of deps.catalogueExercises()) out.set(e.id, e);
    for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) out.set(e.id, e);
    return out;
  }

  /** Each exercise's load inputs at this gym: the template's dry run first, else the rule on its own history. */
  async function loadInputs(p: UserProfile, ids: readonly string[], exercises: ReadonlyMap<string, Exercise>, sub: SubstituteContext, planned: ReadonlyMap<string, { anchor: AnchorLoad; unit: 'kg' | 'lb'; convention: string; source: 'coach' | 'plan' | 'rule' }>, flags: readonly PainFlag[]) {
    const out = new Map<string, SlotLoadInput>();
    const nowMs = toMs(deps.now().utc);
    for (const id of ids) {
      const e = exercises.get(id);
      if (e === undefined) continue;
      const history = await deps.port.historyFor(p.id, id).catch(() => [] as HistorySession[]);
      const refs = loadReferences({ exercise: e, history, ctx: sub, nowMs });
      const fromPlan = planned.get(id);
      const anchorOf = (a: { anchor: AnchorLoad; unit: 'kg' | 'lb'; convention: string } | undefined): AnchorLoad | null => (a === undefined || a.convention !== refs.convention ? null : { ...a.anchor, value: convertValue(a.anchor.value, a.unit, refs.unit) });
      let ruleTarget: AnchorLoad | null = null;
      if (fromPlan === undefined || fromPlan.source === 'rule') {
        const sp = substituteTargets({ workingSets: 3, templates: [{ setType: 'working', reps: { min: 8, max: 12 }, durationS: null }] }, e, history, sub);
        const first = sp.plan?.find((x) => x.setType !== 'warmup' && x.planned.load !== null);
        if (first?.planned.load != null && first.planned.load.convention === refs.convention) ruleTarget = { value: convertValue(first.planned.load.value, first.planned.load.unit, refs.unit), reps: first.planned.reps?.min ?? 8, rpe: first.planned.rpe ?? 8 };
        if (fromPlan !== undefined) ruleTarget = anchorOf(fromPlan) ?? ruleTarget;
      }
      const flag = painFlagCovering(flags, id, nowMs, deps.now().tz);
      // Rule 9: a pain-flagged movement is held at its last working load, never progressed; with no history of its
      // own there's nothing to hold to, so no target at all (`—`, Start light), never the plan's or an estimate.
      const held = flag !== null;
      const heldNoHistory = held && refs.latest === null;
      out.set(id, {
        unit: refs.unit,
        convention: refs.convention,
        equipment: refs.equipment,
        bodyweightExercise: e.defaultLoadConvention === 'bodyweight',
        gymEquipment: sub.gym.equipment,
        coachTarget: !heldNoHistory && fromPlan?.source === 'coach' ? anchorOf(fromPlan) : null,
        planFirstLoad: !heldNoHistory && fromPlan?.source === 'plan' ? anchorOf(fromPlan) : null,
        ruleTarget: heldNoHistory ? null : ruleTarget,
        e1rm: heldNoHistory ? null : (refs.own?.e1rm ?? null),
        startLightCeiling: noReferenceCeiling(refs.equipment, refs.patternE1rms),
        painCap: held ? (refs.latest?.top.value ?? null) : null,
      });
    }
    return out;
  }

  /** The template's dry run (what Start would plan from it here): each exercise's top (else first working) target. */
  async function plannedAnchors(templates: readonly TodayTemplate[], gymId: string | null) {
    const out = new Map<string, { anchor: AnchorLoad; unit: 'kg' | 'lb'; convention: string; source: 'coach' | 'plan' | 'rule' }>();
    if (gymId === null) return out;
    for (const t of templates) {
      if (t.routineId === null) continue;
      const run = await deps.port.plannedDay(t.routineId, gymId).catch(() => null);
      if (run === null) continue;
      for (const ex of run.aggregate.exercises) {
        if (out.has(ex.exerciseId)) continue;
        const sets = run.aggregate.sets.filter((s) => s.sessionExerciseId === ex.id && s.setType !== 'warmup' && s.planned.load !== null).sort((a, b) => a.index - b.index);
        const pick = sets.find((s) => s.setType === 'top') ?? sets[0];
        const load = pick?.planned.load;
        if (pick === undefined || load === null || load === undefined) continue;
        const source = pick.planned.source === 'coach' || pick.planned.provenance?.source === 'coach' ? 'coach' : pick.planned.provenance?.source === 'plan' ? 'plan' : 'rule';
        out.set(ex.exerciseId, { anchor: { value: load.value, reps: pick.planned.reps?.min ?? 8, rpe: pick.planned.rpe ?? 8 }, unit: load.unit, convention: load.convention, source });
      }
    }
    return out;
  }

  function reviewOf(status: CoachStatus): TodayReviewStatus {
    if (status === 'ok') return 'not_reviewed';
    if (status === 'offline') return 'offline';
    return 'not_connected';
  }

  async function load(): Promise<TodaySessionData | null> {
    const p = await deps.profile();
    if (p === null) return null;
    const now = deps.now();
    const nowMs = toMs(now.utc);
    const tz = p.timezone;
    const today = localDateOf(nowMs, tz);
    const gym = await deps.currentGym().catch(() => null);
    const gymId = gym?.id ?? null;
    const planGymId = gymId ?? 'typical-gym-preview';
    const typical = gymId === null ? ((await deps.typicalEquipment().catch(() => null)) ?? []) : undefined;
    const training: TrainingProfile | null = await repos().trainingProfiles.get(p.id).catch(() => null);
    const goal = training?.goal ?? null;
    const plan = await repos().planDrafts.applied(p.id).catch(() => null);
    const paused = activePause(plan, nowMs, tz) !== null;
    const live = liveRoutines(await repos().routines.listByOwner(p.id).catch(() => []));
    const templates = planRoutines(plan, live);
    const exercises = await exerciseIndex();
    const infoCache = new Map<string, BuilderExerciseInfo | null>();
    const info = (id: string): BuilderExerciseInfo | null => {
      if (!infoCache.has(id)) {
        const e = exercises.get(id);
        infoCache.set(id, e !== undefined && builderUsable(e) ? builderInfoOfExercise(e) : null);
      }
      return infoCache.get(id) ?? null;
    };
    const split = training?.split ?? (plan !== null ? splitInUse(training) : null);
    const days = plan === null ? [] : todayPlanDays({ planId: plan.id, templates, split, mainLifts: training?.mainLifts, info, defaultMinutes: training?.sessionMinutes ?? 60 });

    // History in the window: pools, Mix it up, Why?, the strip.
    const { sessions } = await repos()
      .sessions.listFinishedBetweenReadable(p.id, toIso(nowMs - WINDOW_DAYS * DAY_MS), toIso(nowMs + 1))
      .catch(() => ({ sessions: [] as SessionAggregate[] }));
    const newest = [...sessions].filter((s) => isInHistory(s.session)).sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc));
    const doneCount = new Map<string, number>();
    const lastDoneMs = new Map<string, number>();
    for (const a of newest) {
      const done = new Set(a.sets.filter((s) => s.status === 'completed' && s.setType !== 'warmup').map((s) => a.exercises.find((e) => e.id === s.sessionExerciseId)?.exerciseId).filter((x): x is string => x !== undefined));
      for (const id of done) {
        doneCount.set(id, (doneCount.get(id) ?? 0) + 1);
        if (!lastDoneMs.has(id)) lastDoneMs.set(id, toMs(a.session.startedAt.utc));
      }
    }
    const refs: FinishedRef[] = await repos()
      .sessions.listFinishedRefs(p.id, 60)
      .catch(() => [] as FinishedRef[]);

    // Up next: the app's one resolver (adaptive plan day, the run rule, a pin).
    const upNext = plan !== null && !paused ? await deps.port.upNextRoutineId(planGymId, typical).catch(() => null) : null;
    const nextDay = upNext === null ? null : (days.find((d) => d.templates.some((t) => t.routineId === upNext)) ?? null);

    // The gym, pain and the pools.
    const flags = await repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]);
    const sub = await deps.port.substituteCtx(p, planGymId, typical, []);
    const here = (id: string) => {
      const e = exercises.get(id);
      return e !== undefined && doableHere(e, sub.gym);
    };
    const pained = (id: string) => painFlagCovering(flags, id, nowMs, tz) !== null;
    const own = [...doneCount.entries()].sort((a, b) => b[1] - a[1] || (lastDoneMs.get(b[0]) ?? 0) - (lastDoneMs.get(a[0]) ?? 0)).map(([id]) => id);
    const byGroup = new Map<BuilderGroupName, string[]>();
    const add = (id: string, cap: boolean) => {
      const i = info(id);
      if (i === null || !here(id) || pained(id)) return;
      const list = byGroup.get(i.group) ?? [];
      if (list.includes(id)) return;
      if (cap && list.length >= CATALOGUE_PER_GROUP + own.filter((o) => info(o)?.group === i.group).length) return;
      list.push(id);
      byGroup.set(i.group, list);
    };
    for (const id of own) add(id, false);
    for (const e of deps.catalogueExercises()) add(e.id, true);
    const groupPool = (g: BuilderGroupName): readonly string[] => byGroup.get(g) ?? [];

    // Other sessions: the plan days' main lifts, else the catalogue's standard ones.
    const catalogueByKey = new Map<string, Exercise>();
    for (const e of deps.catalogueExercises()) if (e.catalogueKey) catalogueByKey.set(e.catalogueKey, e);
    const fallbacks = ['barbell-back-squat', 'barbell-bench-press', 'barbell-bent-over-row', 'barbell-overhead-press']
      .map((k) => catalogueByKey.get(k))
      .filter((e): e is Exercise => e !== undefined && here(e.id))
      .map((e) => ({ id: e.id, label: e.name }));
    const others = TODAY_OTHER_SESSIONS.map((s) => otherSessionDay(s, otherMainOptions(s, days, info, fallbacks), info, training?.sessionMinutes ?? 60));

    // Load inputs for every exercise a card can use.
    const allTemplates = [...days, ...others].flatMap((d) => d.templates);
    const ids = new Set<string>();
    for (const t of allTemplates) {
      if (t.mainLiftExerciseId !== null) ids.add(t.mainLiftExerciseId);
      for (const id of t.exerciseIds) ids.add(id);
    }
    for (const list of byGroup.values()) for (const id of list) ids.add(id);
    const anchors = await plannedAnchors(
      days.flatMap((d) => d.templates),
      gymId,
    );
    const subAll = await deps.port.substituteCtx(p, planGymId, typical, ids);
    const loads = await loadInputs(p, [...ids].filter((id) => info(id) !== null), exercises, subAll, anchors, flags);
    const fallbackLoad = (id: string): SlotLoadInput => ({ unit: p.preferredUnit, convention: exercises.get(id)?.defaultLoadConvention ?? 'total', equipment: null, coachTarget: null, planFirstLoad: null, ruleTarget: null, e1rm: null, startLightCeiling: null, painCap: null });
    const ctx: BuilderContext = {
      info,
      loads: (id) => loads.get(id) ?? fallbackLoad(id),
      newKey: (id) => deriveId(`today-slot:${today}:${id}`),
    };

    // Each day's own sessions (credited by plan day or by its templates), newest first.
    const daySessions = (day: TodayDay): SessionAggregate[] =>
      newest.filter((a) => {
        const pd = a.session.planDay;
        if (pd !== undefined && day.planId !== null) return pd.planId === day.planId && pd.dayIndex === day.dayIndex;
        return a.session.routineId !== null && day.templates.some((t) => t.routineId === a.session.routineId);
      });
    const exerciseIdsOf = (a: SessionAggregate) => new Set(a.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseId));
    const mixFor = (day: TodayDay): TodayMixFacts => {
      const mine = daySessions(day);
      const recentCountOnDay = new Map<string, number>();
      for (const a of mine.slice(0, RECENT_ON_DAY)) for (const id of exerciseIdsOf(a)) recentCountOnDay.set(id, (recentCountOnDay.get(id) ?? 0) + 1);
      const lastTwoOnDay = new Set(mine.slice(0, 2).flatMap((a) => [...exerciseIdsOf(a)]));
      return { candidates: (g) => groupPool(g), recentCountOnDay, lastTwoOnDay, lastDoneMs, availableHere: here, painFlagged: pained };
    };
    const lastOf = (day: TodayDay, main: string | null) => {
      if (main === null) return null;
      for (const a of daySessions(day)) {
        const row = a.exercises.find((e) => e.exerciseId === main && e.removed === undefined);
        if (row === undefined) continue;
        const sets = a.sets.filter((s) => s.sessionExerciseId === row.id && s.status === 'completed' && s.setType !== 'warmup' && s.actual?.load != null && s.actual.reps != null);
        const top = [...sets].sort((x, y) => (y.actual?.load?.value ?? 0) - (x.actual?.load?.value ?? 0) || (y.actual?.reps ?? 0) - (x.actual?.reps ?? 0))[0];
        if (top?.actual?.load == null || top.actual.reps == null) continue;
        const name = info(main)?.name ?? 'Main lift';
        return { dateText: localDateText(localDateOf(toMs(a.session.startedAt.utc), a.session.startedAt.tz)), lift: name.toLowerCase(), value: `${formatNumber(top.actual.load.value)}${top.actual.load.unit === p.preferredUnit ? '' : ` ${top.actual.load.unit}`}`, reps: top.actual.reps, rpe: top.actual.rpe ?? null };
      }
      return null;
    };
    const liftTargetOf = (id: string | null) => {
      if (id === null || training?.liftTargetsOn !== true) return null;
      const t = training.liftTargets?.find((x) => x.exerciseId === id);
      return t === undefined ? null : `${(info(id)?.name ?? t.exerciseName).toLowerCase()} target ${formatNumber(t.load.value)} ${t.load.unit}`;
    };
    const worksOf = (id: string) => {
      const e = exercises.get(id);
      return e === undefined ? null : worksLine(e);
    };

    // The controls each day opens with.
    const initial: Record<string, TodayControls> = {};
    for (const d of days) {
      const nextMain = d.key === nextDay?.key ? (d.templates.find((t) => t.routineId === upNext)?.mainLiftExerciseId ?? null) : null;
      const lastUsed = lastUsedMainLift(d, refs);
      initial[d.key] = defaultTodayControls(d, { mainLiftExerciseId: lastUsed ?? nextMain, goal });
    }
    for (const d of others) initial[d.key] = defaultTodayControls(d, { goal });

    // Open builder drafts for today: an edited one shows on the card (`Chest · edited`).
    const edited: Record<string, TodayEditedDraft> = {};
    const open = (await repos().workoutDrafts.listByOwner(p.id).catch(() => [] as WorkoutDraft[])).filter((d) => d.status === 'open' && d.builderKey?.localDate === today && toMs(d.expiresAtUtc) > nowMs);
    for (const d of open) {
      if (!isEdited(d)) continue;
      const k = d.builderKey;
      if (k === undefined) continue;
      const dayKey = k.planId !== null && k.dayIndex !== null ? `plan:${k.planId}:${String(k.dayIndex)}` : `other:${k.splitDayId ?? '-'}`;
      edited[`${dayKey}|${k.mainLiftExerciseId ?? '-'}`] = { draftId: d.id, version: d.version, name: d.name, workout: draftPlanAsBuilderWorkout(currentDraftVersion(d).plan) };
    }

    // The strip: 3 back, today, 3 ahead.
    const acts = await repos()
      .activities.listBetween(p.id, addDays(today, -3), addDays(today, 4))
      .catch(() => [] as Activity[]);
    const near = legRunNear(await repos().activities.listBetween(p.id, addDays(today, -1), addDays(today, 2)).catch(() => [] as Activity[]), today);
    const stripWorkouts = newest
      .map((a) => ({ sessionId: a.session.id, localDate: localDateOf(toMs(a.session.startedAt.utc), tz), title: titleOf(a.session.routineName) }))
      .filter((w) => w.localDate >= addDays(today, -3) && w.localDate <= today);
    const coach = await deps.coachStatus().catch((): CoachStatus => 'not_connected');
    const review = reviewOf(coach);
    const equipmentVersion = deriveId(stableStringify(sub.gym.equipment.map((e) => [e.id, e.version])));
    return {
      status: plan === null ? 'no_plan' : paused ? 'paused' : 'plan',
      ownerId: p.id,
      localDate: today,
      tz,
      unit: p.preferredUnit,
      gymId,
      equipmentVersion,
      days,
      others,
      nextKey: nextDay?.key ?? null,
      initial,
      goal,
      review,
      coachLabel: review === 'offline' ? TODAY_V2_COPY.offline : TODAY_V2_COPY.coach,
      edited,
      near,
      strip: { workouts: stripWorkouts, activities: acts, firstUse: newest.length === 0 && refs.length === 0 && acts.length === 0 },
      doneToday: stripWorkouts.some((w) => w.localDate === today),
      internal: {
        ctx,
        info,
        nameOf: (id) => info(id)?.name ?? exercises.get(id)?.name ?? 'Exercise',
        worksOf,
        groupPool,
        mixFor,
        lastOf,
        liftTargetOf,
        catalogueIdOf: (id) => exercises.get(id)?.catalogueKey ?? id,
        here,
        pained,
        checkedOn: (id) => {
          const l = loads.get(id);
          return l === undefined ? null : checkedOnOf({ equipment: l.equipment, convention: l.convention, unit: l.unit });
        },
      },
    };
  }

  function dayOf(data: TodaySessionData, key: string): TodayDay | null {
    return data.days.find((d) => d.key === key) ?? data.others.find((d) => d.key === key) ?? null;
  }

  /**
   * The pool a day's card builds from: its template's exercises first, then Ben's own and the catalogue's. Only what
   * this gym can do and nothing pain-flagged (§3.7, rule 9): a template exercise that fails either falls through to
   * the next candidate of its group.
   */
  function poolFor(data: TodaySessionData, t: TodayTemplate) {
    const { info, groupPool, here, pained } = data.internal;
    return (g: BuilderGroupName) => [...new Set([...t.exerciseIds.filter((id) => info(id)?.group === g && here(id) && !pained(id)), ...groupPool(g)])];
  }

  /**
   * The template a card uses for the chosen main lift, and the chips: only main lifts this gym can do (a template with
   * none counts). The chosen one when doable, else the first doable one. When none is, the day's template without its
   * main lift (the group's best doable exercise leads instead) and `gap` names the lift (§3.7, rule 4).
   */
  function templateHere(data: TodaySessionData, day: TodayDay, mainLiftExerciseId: string | null): { t: TodayTemplate; chips: TodayTemplate[]; gap: string | null } | null {
    const { here } = data.internal;
    const chips = day.templates.filter((x) => x.mainLiftExerciseId === null || here(x.mainLiftExerciseId));
    const picked = chips.find((x) => x.mainLiftExerciseId === mainLiftExerciseId) ?? chips[0];
    if (picked !== undefined) return { t: picked, chips, gap: null };
    const first = day.templates.find((x) => x.mainLiftExerciseId === mainLiftExerciseId) ?? day.templates[0];
    if (first === undefined) return null;
    return { t: { ...first, mainLiftExerciseId: null }, chips: [], gap: first.mainLiftExerciseId === null ? null : data.internal.nameOf(first.mainLiftExerciseId) };
  }

  /** `card`: the session card for a day and its controls. Pure over `data`. */
  function card(data: TodaySessionData, sel: TodaySelection): TodayCardView | null {
    const day = dayOf(data, sel.dayKey);
    if (day === null) return null;
    const { ctx, info, nameOf, worksOf, pained } = data.internal;
    const found = templateHere(data, day, sel.controls.mainLiftExerciseId);
    if (found === null) return null;
    const { t, chips, gap } = found;
    const mainLifts = chips.map((x) => ({ exerciseId: x.mainLiftExerciseId, label: x.label, selected: x === t }));
    // The day as this gym can build it (a main lift it can't do is left out, `gap`).
    const dayHere: TodayDay = gap === null ? day : { ...day, templates: [t] };
    // A pain-flagged movement still on the card (only a main lift can be): held and named in Why? (rule 9).
    const heldIn = (w: BuilderWorkout): string[] => [...new Set(w.blocks.flatMap((b) => b.slots).filter((x) => pained(x.exerciseId)).map((x) => nameOf(x.exerciseId)))];
    const edited = data.edited[`${day.key}|${t.mainLiftExerciseId ?? '-'}`] ?? null;
    const clash = (() => {
      if (data.near === null) return null;
      const legs = t.groups[0]?.group === 'Legs' || (t.mainLiftExerciseId !== null && info(t.mainLiftExerciseId)?.group === 'Legs');
      return legs ? `${data.near.why}: legs fit better another day` : null;
    })();
    if (edited !== null) {
      const minutes = estimateBuilderMinutes(edited.workout, ctx);
      const count = edited.workout.blocks.reduce((n, b) => n + b.slots.length, 0);
      const unit = breakdownUnit(edited.workout, data.unit);
      return {
        dayKey: day.key,
        title: `${day.name} · ${TODAY_V2_COPY.edited}`,
        edited,
        summary: TODAY_V2_COPY.summary(count, minutes),
        minutes,
        exerciseCount: count,
        fitLine: null,
        over: false,
        clashLine: clash,
        controls: { mainLifts, accessories: sel.controls.accessories, minutes: sel.controls.minutes, abs: { on: sel.controls.abs ?? t.absPlan, planOn: t.absPlan, differs: false }, supersets: sel.controls.supersets },
        unit,
        rows: todayBreakdown(edited.workout, info, worksOf, unit, pained),
        why: whyLines(data, day, t, sel.controls, null, heldIn(edited.workout), gap),
        mix: null,
        mixAvailable: false,
        startable: count > 0,
        draft: null,
      };
    }
    const d = assembleTodayDraft({ day: dayHere, controls: { ...sel.controls, mainLiftExerciseId: t.mainLiftExerciseId }, ctx, pool: poolFor(data, t), mix: data.internal.mixFor(day) });
    if (d === null) return null;
    const unit = breakdownUnit(d.workout, data.unit);
    const advice = d.advice[0]?.reason ?? null;
    const mainSlot = d.workout.blocks.flatMap((b) => b.slots).find((s) => s.main) ?? null;
    return {
      dayKey: day.key,
      title: day.name,
      edited: null,
      summary: TODAY_V2_COPY.summary(d.exerciseCount, d.minutes),
      minutes: d.minutes,
      exerciseCount: d.exerciseCount,
      fitLine: todayFitLine(d.fit, sel.controls.minutes, t.minutes, nameOf),
      over: d.fit.status === 'over',
      clashLine: clash ?? advice,
      controls: { mainLifts, accessories: sel.controls.accessories, minutes: sel.controls.minutes, abs: { on: d.absOn, planOn: t.absPlan, differs: d.absOn !== t.absPlan }, supersets: sel.controls.supersets },
      unit,
      rows: todayBreakdown(d.workout, info, worksOf, unit, pained),
      why: whyLines(data, day, t, sel.controls, mainSlot === null ? null : todayBreakdown({ blocks: [{ slots: [mainSlot], auto: false }], restLevel: 'normal' }, info, worksOf, unit)[0]?.top ?? null, heldIn(d.workout), gap),
      mix: d.mix === null ? null : todayMixLine(d.mix, nameOf),
      mixAvailable: d.mixOptions > 0,
      startable: d.exerciseCount > 0,
      draft: d,
    };
  }

  function whyLines(data: TodaySessionData, day: TodayDay, t: TodayTemplate, c: TodayControls, mainTarget: string | null, held: readonly string[], gap: string | null): string[] {
    const next = data.nextKey === null ? null : (dayOf(data, data.nextKey)?.name ?? null);
    return todayWhy({
      dayName: day.name,
      nextDayName: next,
      other: day.kind === 'other',
      last: data.internal.lastOf(day, t.mainLiftExerciseId),
      mainTarget: mainTarget === null || mainTarget === '—' ? null : mainTarget,
      goal: data.goal,
      liftTarget: data.internal.liftTargetOf(t.mainLiftExerciseId),
      accessories: c.accessories,
      minutes: c.minutes,
      coachReason: null,
      review: data.review,
      held,
      missingHere: gap,
    });
  }

  /**
   * `Chest moves to next session` (§2.0.4 Other day picked): what Up next would name after the picked plan day is done
   * today (a prediction; nothing is written until Start). Null for the next day itself, an Other session, or unknown.
   */
  async function movedLine(data: TodaySessionData, sel: TodaySelection): Promise<string | null> {
    if (data.nextKey === null || sel.dayKey === data.nextKey || data.gymId === null) return null;
    const day = dayOf(data, sel.dayKey);
    const next = dayOf(data, data.nextKey);
    if (day === null || next === null || day.kind !== 'plan') return null;
    const t = day.templates.find((x) => x.mainLiftExerciseId === sel.controls.mainLiftExerciseId) ?? day.templates[0];
    if (t?.routineId == null) return null;
    const after = await deps.port.nextAfter(data.gymId, t.routineId).catch(() => null);
    if (after === null) return null;
    const afterDay = data.days.find((d) => d.templates.some((x) => x.routineId === after));
    if (afterDay === undefined) return null;
    return afterDay.key === next.key ? TODAY_V2_COPY.moves(next.name, 'next session') : `${next.name} moves after ${afterDay.name}`;
  }

  /**
   * Today wrote the current version and nothing has written the draft since (else Ben edited it in the builder).
   * Ownership is by version, never by timestamps (review B1): Today's action ID names the draft version it wrote,
   * so any later write (an in-place edit, a new version, an Undo, a restore) bumps `version` and no longer matches.
   */
  function isEdited(d: WorkoutDraft): boolean {
    const v = d.versions.find((x) => x.n === d.currentVersion);
    if (v === undefined) return true;
    return v.actionId !== todayActionId(d.id, v.n, d.version);
  }

  function keyOf(data: TodaySessionData, day: TodayDay, t: TodayTemplate): BuilderDraftKey {
    return { planId: day.planId, dayIndex: day.dayIndex, splitDayId: day.splitDayId, mainLiftExerciseId: t.mainLiftExerciseId, localDate: data.localDate };
  }

  function versionOf(data: TodaySessionData, day: TodayDay, d: TodayDraft, minutes: number, plan: DraftPlan, w: { draftId: string; n: number; parentN: number | null; draftVersion: number; at: ZonedTimestamp }): WorkoutDraftVersion {
    const { draftId, n, parentN, at } = w;
    const counts = new Map<BuilderGroupName, number>();
    for (const b of d.workout.blocks) for (const s of b.slots) {
      const g = data.internal.info(s.exerciseId)?.group;
      if (g !== undefined) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const groups = [...counts].map(([g, count]) => ({ parts: [...BUILDER_GROUP_PARTS[g]] as SplitBodyPart[], count: Math.max(1, Math.min(4, count)) }));
    const setup = {
      dayId: day.splitDayId,
      minutes: clampInt(minutes),
      mainLiftExerciseId: d.template.mainLiftExerciseId,
      supersets: d.workout.blocks.some((b) => b.slots.length > 1),
      groups,
      ...(d.template.routineId !== null && d.template.version !== null ? { templateRoutineId: d.template.routineId, templateVersion: d.template.version } : {}),
      variationId: null,
    };
    const bodyParts = [...new Set(groups.flatMap((g) => g.parts))];
    return {
      n,
      parentN,
      status: 'current',
      actionId: todayActionId(draftId, n, w.draftVersion),
      turnId: 'manual',
      request: { text: '', minutes: setup.minutes, focus: 'split_day', gymId: data.gymId, origin: 'builder', day: { name: day.name.slice(0, 30), bodyParts: bodyParts.length > 0 ? bodyParts : ['Chest'] }, setup },
      rawArgs: '',
      plan,
      fitMinutes: setup.minutes,
      checks: [],
      rationale: null,
      contextHash: deriveId(stableStringify({ setup, gymId: data.gymId, equipmentVersion: data.equipmentVersion })),
      equipmentVersion: data.equipmentVersion,
      createdAt: at,
    };
  }

  /**
   * `commit`: the card's workout as today's open builder draft for its key (created, or a new version of the one
   * Today wrote), so Start and Edit use the same draft (§2.0.2). An edited draft is returned as it is. Idempotent
   * on `opId`.
   */
  async function commit(data: TodaySessionData, sel: TodaySelection, opId: string): Promise<TodayCommitResult> {
    const view = card(data, sel);
    const day = dayOf(data, sel.dayKey);
    if (view === null || day === null) return { ok: false, message: TODAY_SESSION_COPY.stale };
    if (view.edited !== null) return { ok: true, draftId: view.edited.draftId, version: view.edited.version };
    const d = view.draft;
    if (d === null) return { ok: false, message: TODAY_SESSION_COPY.stale };
    if (d.exerciseCount === 0) return { ok: false, message: TODAY_SESSION_COPY.empty };
    const plan = builderWorkoutToDraftPlan({ workout: d.workout, info: data.internal.info, catalogueIdOf: data.internal.catalogueIdOf, checkedOnOf: data.internal.checkedOn });
    const key = keyOf(data, day, d.template);
    const name = `${day.name} · ${d.template.label}`.slice(0, 120);
    const at = deps.now();
    try {
      const existing = await repos().workoutDrafts.openBuilderDraft(data.ownerId, key);
      if (existing !== null) {
        if (existing.opIds.includes(opId) || isEdited(existing)) return { ok: true, draftId: existing.id, version: existing.version };
        const cur = currentDraftVersion(existing);
        if (stableStringify(cur.plan) === stableStringify(plan)) return { ok: true, draftId: existing.id, version: existing.version };
        const n = Math.max(...existing.versions.map((v) => v.n)) + 1;
        const v = versionOf(data, day, d, sel.controls.minutes, plan, { draftId: existing.id, n, parentN: cur.n, draftVersion: existing.version + 1, at });
        const kept = existing.versions.map((x) => (x.n === cur.n ? { ...x, status: 'replaced' as const } : x));
        while (kept.length >= MAX_WORKOUT_DRAFT_VERSIONS) kept.shift();
        const next: WorkoutDraft = { ...existing, name, versions: [...kept, v], currentVersion: n, version: existing.version + 1, updatedAtUtc: at.utc, opIds: [...existing.opIds, opId].slice(-MAX_WORKOUT_DRAFT_OPS) };
        const r = await repos().workoutDrafts.write(data.ownerId, existing.id, (c) => (c.version !== existing.version ? { kind: 'stale', current: c } : c.opIds.includes(opId) ? { kind: 'duplicate', current: c } : { kind: 'write', next, expectedVersion: existing.version }));
        if (r.status === 'written' || r.status === 'replayed') return { ok: true, draftId: r.draft.id, version: r.draft.version };
        return { ok: false, message: TODAY_SESSION_COPY.stale };
      }
      const id = deriveId(`today-draft:${data.ownerId}:${opId}`);
      const draft: WorkoutDraft = {
        id,
        ownerId: data.ownerId,
        status: 'open',
        name,
        currentVersion: 1,
        versions: [versionOf(data, day, d, sel.controls.minutes, plan, { draftId: id, n: 1, parentN: null, draftVersion: 1, at })],
        sessionId: null,
        startedAtUtc: null,
        routineId: null,
        discardedAtUtc: null,
        opIds: [opId],
        createdAt: at,
        tz: data.tz,
        expiresAtUtc: toIso(toMs(at.utc) + COACH_DRAFT_DAYS * DAY_MS),
        version: 1,
        updatedAtUtc: at.utc,
        builderKey: key,
      };
      const r = await repos().workoutDrafts.createBuilderDraft(data.ownerId, draft);
      if (r.status === 'invalid') return { ok: false, message: TODAY_SESSION_COPY.failed };
      // `exists`: another open draft holds the key (written since this read): use it as it is.
      return { ok: true, draftId: r.draft.id, version: r.draft.version };
    } catch {
      return { ok: false, message: TODAY_SESSION_COPY.failed };
    }
  }

  /** `start`: the draft as committed (version-checked, rule 5), through the one Start path. */
  async function start(req: { draftId: string; expectedVersion: number; gymId: string; opId: string; checkIn: SessionCheckIn | null }): Promise<TodayStartResult> {
    const p = await deps.profile();
    if (p === null) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
    const already = await repos().sessions.findByStartOperation(p.id, req.opId).catch(() => null);
    if (already === null) {
      const d = await repos().workoutDrafts.get(req.draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id) return { ok: false, error: { code: 'not_found', message: 'That workout wasn’t found.' } };
      if (d.status === 'open' && d.version !== req.expectedVersion) return { ok: false, error: { code: 'stale_draft', message: TODAY_SESSION_COPY.stale } };
    }
    return deps.port.start({ gymId: req.gymId, opId: req.opId, checkIn: req.checkIn, coachDraftOf: req.draftId });
  }

  return {
    load,
    card,
    movedLine,
    commit,
    start,
    /** The 7-day strip for the card's day (`chosen`). */
    strip(data: TodaySessionData, chosen: string | null): StripCell[] {
      return buildTodayStrip({
        today: data.localDate,
        workouts: data.strip.workouts,
        activities: data.strip.activities.map((a) => ({ activityId: a.id, localDate: a.fields.date, kind: a.fields.kind, status: a.fields.status, distanceM: a.fields.distanceM, durationS: a.fields.durationS, effort: a.fields.effort })),
        chosen,
        todayOnly: data.strip.firstUse,
      });
    },
  };
}

const clampInt = (m: number): number => Math.max(15, Math.min(180, Math.round(m)));

/**
 * The action ID of a version Today wrote, derived from the draft, the version number and the draft `version` the
 * write produced: Today can tell its own versions from the builder's edits without comparing clocks (review B1).
 */
export function todayActionId(draftId: string, n: number, draftVersion: number): string {
  return deriveId(`today-session:${draftId}:${String(n)}:${String(draftVersion)}`);
}

export type TodaySessionService = ReturnType<typeof createTodaySessionService>;
