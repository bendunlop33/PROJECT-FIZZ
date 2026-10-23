import {
  activePause,
  addDays,
  assembleTodayDraft,
  breakdownUnit,
  builderInfoOf,
  builderSetupOf,
  builderUsable,
  buildTodayStrip,
  checkedOnOf,
  convertValue,
  ruleYieldsToHistory,
  builtInTargetRpe,
  clampMinutes,
  lastSessionE1rm,
  ruleCategory,
  currentDraftVersion,
  defaultTodayControls,
  todayContentHash,
  todayControlsHash,
  todayDraftState,
  deriveId,
  doableHere,
  estimateBuilderMinutes,
  estimateBuilderSeconds,
  formatNumber,
  fromDraftPlan,
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
  storedGroupsOf,
  substituteTargets,
  TODAY_OTHER_SESSIONS,
  TODAY_V2_COPY,
  todayBreakdown,
  fitNoteOf,
  todayMixLine,
  todayPlanDays,
  todayWhy,
  toIso,
  toDraftPlan,
  toMs,
  timeFitChanges,
  timeFitFromStored,
  timeFitToStored,
  todayTimeFit,
  withSlotRevs,
  type AnchorLoad,
  type BuilderContext,
  type BuilderExerciseInfo,
  type BuilderFitStep,
  type BuilderGroupName,
  type BuilderTimeFit,
  type BuilderWorkout,
  type FinishedRef,
  type HistorySession,
  type LegRunNear,
  type SlotLoadInput,
  type StripCell,
  type SubstituteContext,
  type SwapPlan,
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
  type TrainingProfile,
  type UserProfile,
  type WorkoutDraft,
  type WorkoutDraftVersion,
  type ZonedTimestamp,
} from '@fizz/schemas';

import { createBuilderLoadGuard, type MixPick, type NudgeSession, type PreSessionInput } from '@fizz/coach';
import type { BuilderCoachWorld, NudgeResult } from '../coach/builder-coach-service';
import { mixCoachReason, todayCoachWhy } from '../coach/builder-coach-view';
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
  /** No plan in use: the app's Up next (split, rotation, longest gap), as the old Today named it; null: none. */
  upNext: (gymId: string) => Promise<TodayUpNext | null>;
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
  /** (§6.1) The builder coach's pre-session nudge on the card's draft; absent: not in this build's wiring. */
  nudge?: (req: { draftId: string; splitDayId: string | null; input: PreSessionInput; opId: string }) => Promise<NudgeResult>;
  /** (§2.0.2 Mix it up rule 3) The coach's pick from code's shortlist; absent: code's pick only. */
  mixPick?: (req: { fromExerciseId: string; shortlist: readonly string[]; lastDone: (exerciseId: string) => string | null; world: BuilderCoachWorld }) => Promise<MixPick | null>;
  /** Check-in settings' `offerAtOrBelow` (the nudge's low check-in signal); null: never. */
  offerAtOrBelow?: () => number | null;
}

/** What the coach said about Today's card (null fields: nothing yet, or not asked). */
export interface TodayCoachInputs {
  nudge?: NudgeResult | null;
  mixPick?: MixPick | null;
}

/** Per group, how many catalogue exercises join Ben's own in a pool (the rest are reachable in the builder). */
const CATALOGUE_PER_GROUP = 8;
/** Up next's and the pools' history window. */
const WINDOW_DAYS = 42;
const DAY_MS = 86_400_000;
/** A day's sessions that count as "lately" for Mix it up's target. */
const RECENT_ON_DAY = 4;

export type TodaySessionStatus = 'plan' | 'paused' | 'no_plan';

/** The app's Up next with no plan in use: a routine (Start starts it) or the last workout's next session (`nextOf`). */
export interface TodayUpNext {
  title: string;
  routineId: string | null;
  /** The workout a next session repeats; null for a routine. */
  sourceSessionId: string | null;
}

/** An open builder draft for today that Ben changed in the builder (`Chest · edited`), or the coach's offer he applied. */
export interface TodayEditedDraft {
  draftId: string;
  version: number;
  name: string;
  workout: BuilderWorkout;
  /** (Review todaylean S4) Its Time: the length, the length before Time changed it (null: unchanged) and Time's fit. */
  minutes: number;
  timeFrom: number | null;
  fit: BuilderTimeFit | null;
}

/** (D3) A day's latest open builder draft today: the main lift it is for and when it was last written. */
export interface TodayLatestDraft {
  mainLiftExerciseId: string | null;
  atUtc: string;
}

/** Today's draft with the coach's pre-session offer applied (still Today's card): shown while the controls are the ones it was applied over. */
export interface TodayNudgedDraft extends TodayEditedDraft {
  /** `todayControlsHash` of the controls it was applied over. */
  controls: string;
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
  /**
   * (review today-fix-21oct B1) No plan in use: Up next from the Profile split or the routines in rotation (else the
   * longest gap), so Ben's own workouts stay one tap from Today, as on the old Today. Null with a plan, or none.
   */
  upNext: TodayUpNext | null;
  /** The controls each day opens with (today's latest draft's main lift, else its last-used one; the goal's accessories, the plan's length). */
  initial: Readonly<Record<string, TodayControls>>;
  /** (D3) Each day's latest open draft today (by `dayKey`): its main lift and when it was written, so Today follows Your workout's Main lift. */
  latestDraft: Readonly<Record<string, TodayLatestDraft>>;
  goal: 'strength' | 'muscle' | 'both' | null;
  review: TodayReviewStatus;
  coachLabel: string;
  /** Open, edited builder drafts for today, by `dayKey|mainLift`. */
  edited: Readonly<Record<string, TodayEditedDraft>>;
  /** Today's drafts with the coach's offer applied (not edited; integrity B2), by `dayKey|mainLift`. */
  nudged: Readonly<Record<string, TodayNudgedDraft>>;
  /** The long or hard run near today (the clash line). */
  near: LegRunNear | null;
  strip: { workouts: { sessionId: string; localDate: string; title: string }[]; activities: Activity[]; firstUse: boolean };
  /** Done today (a second session can still be picked). */
  doneToday: boolean;
  /** (§6.1) The pre-session nudge's real signals (finished sessions, today's check-in, logged activities). */
  nudgeInput: PreSessionInput;
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
  /** Ben's saved memories (his words; Your data), for the coach's Mix it up pick. */
  memories: readonly string[];
  /** `13 Oct`: when an exercise was last done, else null. */
  lastDoneText: (id: string) => string | null;
}

export interface TodaySelection {
  dayKey: string;
  controls: TodayControls;
}

/**
 * The card's Time row (fit-to-time 22 Oct revision, item 4): `Time · −1 exercise ›  [−] 45 min [+]`. The note after the
 * label (light orange) is the biggest change the fit made; a tap lists everything with `Undo` (back to the plan's length).
 */
export interface TodayTimeView {
  minutes: number;
  /** `−1 exercise`, `−2 sets`, `supersets`, `shorter rests`, `+1 exercise`; null: the plan as it is. */
  note: string | null;
  noteLabel: string | null;
  lines: string[];
  /** `⚠ Over 30 min`: even every cut allowed is over this length. */
  overText: string | null;
  /** The detail's `Undo`: the plan's own length; null when Time is at it. */
  undoMinutes: number | null;
}

export interface TodayCardView {
  dayKey: string;
  /**
   * (D3, Ben 22–23 Oct) Lean card: with a plan in use (or paused), Today shows the session's rows, the Time control with
   * its note, Why?, Start and Edit; main lift, accessories, abs and supersets are in Edit (Your workout), and `↻ Mix it
   * up` is gone (Your workout's Swap). No plan: the controls and Mix it up.
   */
  lean: boolean;
  /** `Chest`, or `Chest · edited`. */
  title: string;
  edited: TodayEditedDraft | null;
  /** The coach's offer Ben applied: the card shows that draft, plain title, one-tap Start (no §2.8 prompt). */
  nudged: TodayNudgedDraft | null;
  /** `5 exercises · ~52 min`. */
  summary: string;
  minutes: number;
  exerciseCount: number;
  /** The Time row; on an edited card with a plan, the draft's own Time (steps go to Your workout's Time on it); null on an edited no-plan card. */
  time: TodayTimeView | null;
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
  /** Code's shortlist and the accessory it swaps (the coach picks from these). */
  mixShortlist: string[];
  mixFromExerciseId: string | null;
  startable: boolean;
  /** For `commit` (the code draft; null when edited). */
  draft: TodayDraft | null;
}

/** (D3 §2.3a) Today's code draft for a key and controls (`draftFor`): what Your workout's options load. */
export interface TodayDraftFor {
  /** Fitted to the controls' Time. */
  workout: BuilderWorkout;
  /** The same before Time's fit. */
  unfitted: BuilderWorkout;
  steps: BuilderFitStep[];
  /** The plan day's own length. */
  planMinutes: number;
  template: { routineId: string | null; version: number | null; mainLiftExerciseId: string | null; label: string };
  /** `Push · Bench press`. */
  name: string;
  key: BuilderDraftKey;
}

export type TodayCommitResult = { ok: true; draftId: string; version: number } | { ok: false; message: string };
export type TodayStartResult = WorkoutStartOutcome | { ok: false; error: { code: 'stale_draft' | 'not_found'; message: string } };

export const TODAY_SESSION_COPY = {
  stale: 'Changed since. Check it and try again.',
  failed: 'Couldn’t save. Try again.',
  empty: 'Add an exercise first.',
} as const;

const titleOf = (name: string | null | undefined): string => (name ?? '').split('·')[0]?.trim() || 'Workout';

/** A template dry run's load for one exercise. `planSetMs`: when its plan's loads were set (plan workouts only). */
interface PlannedAnchor {
  anchor: AnchorLoad;
  unit: 'kg' | 'lb';
  convention: string;
  source: 'coach' | 'plan' | 'rule';
  planSetMs: number | null;
}

/**
 * (Builder-loads review B2) A plan's first-week load gives way to clearly stronger history logged after the plan
 * set it, as in the builder (`builder-env`): Today never starts a plan day lighter than newer sets say.
 */
export function planAnchor(anchor: AnchorLoad | null, planSetMs: number | null, latestUtc: string | null): AnchorLoad | null {
  if (anchor === null || planSetMs === null || latestUtc === null) return anchor;
  return toMs(latestUtc) > planSetMs ? { ...anchor, yieldsToHistory: true } : anchor;
}

/**
 * The built-in rule's first working target as a builder anchor (`ruleAnchorOf` for a swap plan): its load in `unit`,
 * for its rep range (`repsMax`, 21 Oct), at the rule's target RPE. It gives way to clearly stronger recent sets unless
 * it's a miss, a reduction or a pain hold (21 Oct). Null with no load in this convention.
 */
function ruleAnchorFromPlan(sp: SwapPlan, convention: string, unit: 'kg' | 'lb', rpe: number): AnchorLoad | null {
  const first = sp.plan?.find((x) => x.setType !== 'warmup' && x.planned.load !== null);
  if (first?.planned.load == null || first.planned.load.convention !== convention) return null;
  const yields = ruleYieldsToHistory(first.planned.provenance?.rule?.decision);
  const reps = first.planned.reps;
  return { value: convertValue(first.planned.load.value, first.planned.load.unit, unit), reps: reps?.min ?? 8, rpe, ...(reps === null ? {} : { repsMax: Math.max(reps.min, reps.max) }), ...(yields ? { yieldsToHistory: true } : {}) };
}

/** The card's Time row from the fit's note (`fitNoteOf`), the length shown and the plan's own length. */
export function timeView(minutes: number, planMinutes: number, fit: { note: string | null; lines: string[] }, over: boolean): TodayTimeView {
  const plan = clampMinutes(planMinutes);
  return {
    minutes,
    note: fit.note,
    noteLabel: fit.note === null ? null : `Time changes: ${fit.note}`,
    lines: fit.lines,
    overText: over ? `⚠ Over ${TODAY_V2_COPY.minutesValue(minutes)}` : null,
    undoMinutes: minutes === plan ? null : plan,
  };
}

export function createTodaySessionService(deps: TodaySessionDeps) {
  const repos = () => deps.store().repos;

  async function exerciseIndex(): Promise<Map<string, Exercise>> {
    const out = new Map<string, Exercise>();
    for (const e of deps.catalogueExercises()) out.set(e.id, e);
    for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) out.set(e.id, e);
    return out;
  }

  /** Each exercise's load inputs at this gym: the template's dry run first, else the rule on its own history. */
  async function loadInputs(p: UserProfile, ids: readonly string[], exercises: ReadonlyMap<string, Exercise>, sub: SubstituteContext, planned: ReadonlyMap<string, PlannedAnchor>, flags: readonly PainFlag[]) {
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
      const ruleRpe = builtInTargetRpe(ruleCategory(e, refs.equipment?.kind ?? null, refs.convention));
      // The rule runs on every card, plan days too: its reps (Ben's last session of the exercise; 21 Oct) set every slot's reps.
      const shape = { workingSets: 3, templates: [{ setType: 'working' as const, reps: { min: 8, max: 12 }, durationS: null }] };
      const sp = substituteTargets(shape, e, history, sub);
      // A main barbell lift as a secondary lift: its rule read as a compound lift's (`slotLoadOf`).
      const acc = ruleCategory(e, refs.equipment?.kind ?? null, refs.convention) === 'main_barbell' ? substituteTargets(shape, e, history, sub, { accessory: true }) : null;
      // A plan's week-1 load with newer history gives way to the rule (`builderLoad`; reps from history, 21 Oct).
      const planStale = fromPlan?.source === 'plan' && planAnchor(anchorOf(fromPlan), fromPlan.planSetMs, refs.latest?.performedAtUtc ?? null)?.yieldsToHistory === true;
      if (fromPlan === undefined || fromPlan.source === 'rule' || planStale) {
        // The rule's own target RPE, as the builder reads it (`ruleAnchorOf`; review S3).
        ruleTarget = ruleAnchorFromPlan(sp, refs.convention, refs.unit, ruleRpe);
        const dryRun = fromPlan?.source === 'rule' ? anchorOf(fromPlan) : null;
        if (dryRun !== null) ruleTarget = { ...dryRun, rpe: ruleRpe };
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
        planFirstLoad: !heldNoHistory && fromPlan?.source === 'plan' ? planAnchor(anchorOf(fromPlan), fromPlan.planSetMs, refs.latest?.performedAtUtc ?? null) : null,
        ruleTarget: heldNoHistory ? null : ruleTarget,
        e1rm: heldNoHistory ? null : (refs.own?.e1rm ?? null),
        lastE1rm: heldNoHistory ? null : lastSessionE1rm(refs.own),
        e1rmGapDays: refs.own?.gapDays ?? null,
        startLightCeiling: noReferenceCeiling(refs.equipment, refs.patternE1rms),
        painCap: held ? (refs.latest?.top.value ?? null) : null,
        // Which history these loads came from: Start re-derives them once it moved (builder review B4).
        historyVersion: refs.historyVersion,
        ruleReps: sp.ruleReps ?? null,
        ...(acc === null || heldNoHistory ? {} : { secondary: { ruleTarget: ruleAnchorFromPlan(acc, refs.convention, refs.unit, builtInTargetRpe('compound')), ruleReps: acc.ruleReps ?? null } }),
      });
    }
    return out;
  }

  /** The template's dry run (what Start would plan from it here): each exercise's top (else first working) target. */
  async function plannedAnchors(templates: readonly TodayTemplate[], gymId: string | null) {
    const out = new Map<string, PlannedAnchor>();
    if (gymId === null) return out;
    for (const t of templates) {
      if (t.routineId === null) continue;
      const run = await deps.port.plannedDay(t.routineId, gymId).catch(() => null);
      if (run === null) continue;
      const planSetMs = await planVersionMs(t.routineId);
      for (const ex of run.aggregate.exercises) {
        if (out.has(ex.exerciseId)) continue;
        const sets = run.aggregate.sets.filter((s) => s.sessionExerciseId === ex.id && s.setType !== 'warmup' && s.planned.load !== null).sort((a, b) => a.index - b.index);
        const pick = sets.find((s) => s.setType === 'top') ?? sets[0];
        const load = pick?.planned.load;
        if (pick === undefined || load === null || load === undefined) continue;
        const prov = pick.planned.provenance;
        // A plan workout's first loads (`planFirstLoads`: the plan's checked coach loads, scope `build`) are the plan's
        // week-1 loads, as the builder reads them (`builder-env`), so newer history can replace them (review B2).
        const planLoad = planSetMs !== null && prov?.source === 'coach' && prov.coach?.scope === 'build';
        const source = planLoad ? 'plan' : pick.planned.source === 'coach' || prov?.source === 'coach' ? 'coach' : prov?.source === 'plan' ? 'plan' : 'rule';
        const yields = source === 'rule' && ruleYieldsToHistory(pick.planned.provenance?.rule?.decision);
        out.set(ex.exerciseId, { anchor: { value: load.value, reps: pick.planned.reps?.min ?? 8, rpe: pick.planned.rpe ?? 8, ...(yields ? { yieldsToHistory: true } : {}) }, unit: load.unit, convention: load.convention, source, planSetMs });
      }
    }
    return out;
  }

  /** When a plan workout's loads were set (its plan version's `createdAt`, else Apply's time); null for other workouts. */
  async function planVersionMs(routineId: string): Promise<number | null> {
    const routine = await repos().routines.get(routineId).catch(() => null);
    const link = routine?.createdFromPlan;
    if (link === undefined) return null;
    const plan = await repos().planDrafts.get(link.planId).catch(() => null);
    const setAt = plan?.versions.find((v) => v.n === link.versionN)?.createdAt.utc ?? link.atUtc;
    return toMs(setAt);
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
    // The plan in use and its workouts are read as Library › Your plan reads them, and a failed read throws (the screen
    // says Couldn't load): never swallowed into `No plan` (as review planview S5 for Library).
    const plan = await repos().planDrafts.applied(p.id);
    const paused = activePause(plan, nowMs, tz) !== null;
    const live = liveRoutines(await repos().routines.listByOwner(p.id));
    const templates = planRoutines(plan, live);
    const exercises = await exerciseIndex();
    const infoCache = new Map<string, BuilderExerciseInfo | null>();
    const info = (id: string): BuilderExerciseInfo | null => {
      if (!infoCache.has(id)) {
        const e = exercises.get(id);
        infoCache.set(id, e !== undefined && builderUsable(e) ? builderInfoOf(e) : null);
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
      // Ben's rest presets, as the builder's (rests and the ~N min agree with Your workout).
      ...(p.restPresets.length > 0 ? { restPresetsS: p.restPresets.map((r) => r.seconds) } : {}),
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

    // Open builder drafts for today: an edited one shows on the card (`Chest · edited`).
    const edited: Record<string, TodayEditedDraft> = {};
    const nudged: Record<string, TodayNudgedDraft> = {};
    const open = (await repos().workoutDrafts.listByOwner(p.id).catch(() => [] as WorkoutDraft[])).filter((d) => d.status === 'open' && d.builderKey?.localDate === today && toMs(d.expiresAtUtc) > nowMs);
    const dayKeyOfDraft = (k: BuilderDraftKey): string => (k.planId !== null && k.dayIndex !== null ? `plan:${k.planId}:${String(k.dayIndex)}` : `other:${k.splitDayId ?? '-'}`);
    // (D3) The main lift each day's latest draft today is for: Your workout's Main lift (it left Today's card) shows here.
    const latestDraft: Record<string, TodayLatestDraft> = {};
    for (const d of open) {
      const k = d.builderKey;
      if (k === undefined) continue;
      const key = dayKeyOfDraft(k);
      const was = latestDraft[key];
      if (was === undefined || d.updatedAtUtc > was.atUtc) latestDraft[key] = { mainLiftExerciseId: k.mainLiftExerciseId ?? null, atUtc: d.updatedAtUtc };
    }

    // The controls each day opens with: the main lift of today's latest draft for it, else the last used one.
    const initial: Record<string, TodayControls> = {};
    for (const d of days) {
      const nextMain = d.key === nextDay?.key ? (d.templates.find((t) => t.routineId === upNext)?.mainLiftExerciseId ?? null) : null;
      const lastUsed = lastUsedMainLift(d, refs);
      const drafted = latestDraft[d.key]?.mainLiftExerciseId;
      const fromDraft = drafted !== undefined && d.templates.some((t) => t.mainLiftExerciseId === drafted) ? drafted : undefined;
      initial[d.key] = defaultTodayControls(d, { mainLiftExerciseId: fromDraft ?? lastUsed ?? nextMain, goal });
    }
    for (const d of others) initial[d.key] = defaultTodayControls(d, { goal });

    for (const d of open) {
      const own = todayDraftState(d);
      if (own.state === 'today') continue;
      const k = d.builderKey;
      if (k === undefined) continue;
      const dayKey = dayKeyOfDraft(k);
      const st = builderSetupOf(d);
      const tf = st?.timeFit;
      const shown: TodayEditedDraft = {
        draftId: d.id,
        version: d.version,
        name: d.name,
        workout: fromDraftPlan(currentDraftVersion(d).plan, st?.restLevel ?? 'normal'),
        minutes: st?.minutes ?? currentDraftVersion(d).fitMinutes,
        timeFrom: st?.timeFrom ?? tf?.fromMinutes ?? null,
        fit: tf === undefined ? null : timeFitFromStored(tf),
      };
      if (own.state === 'nudge') nudged[`${dayKey}|${k.mainLiftExerciseId ?? '-'}`] = { ...shown, controls: own.controls };
      else edited[`${dayKey}|${k.mainLiftExerciseId ?? '-'}`] = shown;
    }

    // The strip: 3 back, today, 3 ahead.
    const acts = await repos()
      .activities.listBetween(p.id, addDays(today, -3), addDays(today, 4))
      .catch(() => [] as Activity[]);
    const near = legRunNear(await repos().activities.listBetween(p.id, addDays(today, -1), addDays(today, 2)).catch(() => [] as Activity[]), today);
    const stripWorkouts = newest
      .map((a) => ({ sessionId: a.session.id, localDate: localDateOf(toMs(a.session.startedAt.utc), tz), title: titleOf(a.session.routineName) }))
      .filter((w) => w.localDate >= addDays(today, -3) && w.localDate <= today);
    // The nudge's real signals (rule 6): finished sessions in the window, today's check-in, what Ben logged.
    const recentForNudge: NudgeSession[] = newest.slice(0, 10).map((a) => ({
      sessionId: a.session.id,
      localDate: localDateOf(toMs(a.session.startedAt.utc), a.session.startedAt.tz),
      exercises: a.exercises
        .filter((e) => e.removed === undefined)
        .map((e) => ({
          exerciseId: e.exerciseId,
          sets: a.sets
            .filter((x) => x.sessionExerciseId === e.id && x.status === 'completed')
            .map((x) => ({ working: x.setType !== 'warmup', reps: x.actual?.reps ?? null, targetRepsMin: x.planned.reps?.min ?? null, rpe: x.actual?.rpe ?? null, targetRpe: x.planned.rpe ?? null })),
        })),
    }));
    const todayCheckIns = await repos()
      .checkIns.listSince(p.id, toIso(nowMs - DAY_MS))
      .catch(() => []);
    const checkIn = [...todayCheckIns].filter((c) => c.deletedAtUtc === undefined && localDateOf(toMs(c.recordedAt.utc), tz) === today).sort((a, b) => toMs(b.recordedAt.utc) - toMs(a.recordedAt.utc))[0];
    const nudgeActs = await repos()
      .activities.listBetween(p.id, addDays(today, -2), addDays(today, 1))
      .catch(() => [] as Activity[]);
    const nudgeInput: PreSessionInput = {
      today,
      recent: recentForNudge,
      checkIn: checkIn === undefined ? null : { id: checkIn.id, score: checkIn.score, localDate: today },
      offerAtOrBelow: deps.offerAtOrBelow?.() ?? null,
      activities: nudgeActs.map((a) => ({ id: a.id, localDate: a.fields.date, kind: a.fields.kind, effort: a.fields.effort, status: a.fields.status })),
    };
    const memories = (await repos().coach.listMemories(p.id, 'active').catch(() => [])).filter((m) => m.dayNote === undefined).map((m) => m.text).slice(0, 20);
    const coach = await deps.coachStatus().catch((): CoachStatus => 'not_connected');
    const review = reviewOf(coach);
    const equipmentVersion = deriveId(stableStringify(sub.gym.equipment.map((e) => [e.id, e.version])));
    // An applied plan with no live workouts left is no plan in use (Library › Your plan shows none either).
    const status: TodaySessionStatus = plan === null || days.length === 0 ? 'no_plan' : paused ? 'paused' : 'plan';
    // No plan: the old Today's Up next (split, rotation, longest gap) is still one tap away. Only at a saved gym, as
    // the overview it opens starts there; a failed read is no Up next (the rest of Today still loads).
    const fallbackNext = status === 'no_plan' && gymId !== null ? await deps.port.upNext(gymId).catch(() => null) : null;
    return {
      status,
      ownerId: p.id,
      localDate: today,
      tz,
      unit: p.preferredUnit,
      gymId,
      equipmentVersion,
      days,
      others,
      nextKey: nextDay?.key ?? null,
      upNext: fallbackNext,
      initial,
      latestDraft,
      goal,
      review,
      coachLabel: review === 'offline' ? TODAY_V2_COPY.offline : TODAY_V2_COPY.coach,
      edited,
      nudged,
      near,
      strip: { workouts: stripWorkouts, activities: acts, firstUse: newest.length === 0 && refs.length === 0 && acts.length === 0 },
      doneToday: stripWorkouts.some((w) => w.localDate === today),
      nudgeInput,
      internal: {
        memories,
        lastDoneText: (id) => {
          const ms = lastDoneMs.get(id);
          return ms === undefined ? null : localDateText(localDateOf(ms, tz));
        },
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
  function card(data: TodaySessionData, sel: TodaySelection, coach: TodayCoachInputs = {}): TodayCardView | null {
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
    // The coach's offer Ben applied, while the controls are the ones it went over; a control change since is Today's again.
    const nudgedHere = data.nudged[`${day.key}|${t.mainLiftExerciseId ?? '-'}`] ?? null;
    const nudged = nudgedHere !== null && nudgedHere.controls === todayControlsHash(sel.controls) ? nudgedHere : null;
    const clash = (() => {
      if (data.near === null) return null;
      const legs = t.groups[0]?.group === 'Legs' || (t.mainLiftExerciseId !== null && info(t.mainLiftExerciseId)?.group === 'Legs');
      return legs ? `${data.near.why}: legs fit better another day` : null;
    })();
    const held = edited ?? nudged;
    if (held !== null) {
      const minutes = estimateBuilderMinutes(held.workout, ctx);
      const count = held.workout.blocks.reduce((n, b) => n + b.slots.length, 0);
      const unit = breakdownUnit(held.workout, data.unit);
      return {
        dayKey: day.key,
        lean: data.status !== 'no_plan',
        title: edited === null ? day.name : `${day.name} · ${TODAY_V2_COPY.edited}`,
        edited,
        nudged: edited === null ? nudged : null,
        summary: TODAY_V2_COPY.summary(count, minutes),
        minutes,
        exerciseCount: count,
        // The coach's version Ben applied keeps Time (a step is Today's card again). (D3; review todaylean S4) An edited
        // card with a plan keeps Time too: the draft's own (Your workout's Time on it, refitted around Ben's edits, FT5).
        time: edited === null ? timeView(sel.controls.minutes, t.minutes, { note: null, lines: [] }, false) : data.status !== 'no_plan' ? editedTime(data, edited) : null,
        clashLine: clash,
        controls: { mainLifts, accessories: sel.controls.accessories, minutes: sel.controls.minutes, abs: { on: sel.controls.abs ?? t.absPlan, planOn: t.absPlan, differs: false }, supersets: sel.controls.supersets },
        unit,
        rows: todayBreakdown(held.workout, info, worksOf, unit, pained),
        why: whyLines(data, day, t, sel.controls, null, heldIn(held.workout), gap, coachWhyOf(data, coach, null)),
        mix: null,
        mixAvailable: false,
        mixShortlist: [],
        mixFromExerciseId: null,
        startable: count > 0,
        draft: null,
      };
    }
    // (D3, Ben 22–23 Oct) `↻ Mix it up` left the lean card with the other Today-only controls (Your workout's Swap does
    // the same job): with a plan the card never swaps an accessory, whatever an older selection carried.
    const lean = data.status !== 'no_plan';
    const pick = lean ? null : (coach.mixPick ?? null);
    const d = assembleTodayDraft({ day: dayHere, controls: { ...sel.controls, mainLiftExerciseId: t.mainLiftExerciseId, ...(lean ? { mix: 0 } : {}) }, ctx, pool: poolFor(data, t), mix: data.internal.mixFor(day), ...(pick === null ? {} : { mixOrder: pick.order }) });
    if (d === null) return null;
    // The coach's reason only for the swap it picked (shown under the swap and in Why?).
    const mixReason = d.mix !== null && pick !== null && pick.exerciseId === d.mix.toExerciseId ? mixCoachReason(pick) : null;
    const unit = breakdownUnit(d.workout, data.unit);
    const advice = d.advice[0]?.reason ?? null;
    const mainSlot = d.workout.blocks.flatMap((b) => b.slots).find((s) => s.main) ?? null;
    const slotName = (key: string) => nameOf(d.workout.blocks.flatMap((b) => b.slots).find((x) => x.key === key)?.exerciseId ?? '');
    return {
      dayKey: day.key,
      lean,
      title: day.name,
      edited: null,
      nudged: null,
      summary: TODAY_V2_COPY.summary(d.exerciseCount, d.minutes),
      minutes: d.minutes,
      exerciseCount: d.exerciseCount,
      time: timeView(sel.controls.minutes, t.minutes, fitNoteOf(d.fit.steps, nameOf, slotName), d.fit.status === 'over'),
      clashLine: clash ?? advice,
      controls: { mainLifts, accessories: sel.controls.accessories, minutes: sel.controls.minutes, abs: { on: d.absOn, planOn: t.absPlan, differs: d.absOn !== t.absPlan }, supersets: sel.controls.supersets },
      unit,
      rows: todayBreakdown(d.workout, info, worksOf, unit, pained),
      why: whyLines(data, day, t, sel.controls, mainSlot === null ? null : todayBreakdown({ blocks: [{ slots: [mainSlot], auto: false }], restLevel: 'normal' }, info, worksOf, unit)[0]?.top ?? null, heldIn(d.workout), gap, coachWhyOf(data, coach, mixReason)),
      mix: d.mix === null ? null : todayMixLine(d.mix, nameOf, mixReason),
      mixAvailable: !lean && d.mixOptions > 0,
      // No shortlist on the lean card: the coach is never asked for a Mix it up pick there.
      mixShortlist: lean ? [] : d.mixShortlist,
      mixFromExerciseId: lean ? null : d.mixFromExerciseId,
      startable: d.exerciseCount > 0,
      draft: d,
    };
  }

  /**
   * (Review todaylean S4) An edited card's Time: the draft's length, what Time's fit changed against the workout before
   * it (the same note and detail as Your workout's), Undo back to the length before Time changed it, and `⚠ Over` when
   * Ben's own edits take it past Time.
   */
  function editedTime(data: TodaySessionData, e: TodayEditedDraft): TodayTimeView {
    const { nameOf, ctx } = data.internal;
    const changes = e.fit === null ? [] : timeFitChanges(e.fit, e.workout);
    const slotName = (key: string) => nameOf(e.workout.blocks.flatMap((b) => b.slots).find((x) => x.key === key)?.exerciseId ?? '');
    return timeView(e.minutes, e.timeFrom ?? e.minutes, fitNoteOf(changes, nameOf, slotName), estimateBuilderSeconds(e.workout, ctx) > e.minutes * 60 + 29);
  }

  /** The coach's part of Why?: its nudge (`todayCoachWhy`), else the Mix it up reason; no nudge yet: the connection's status. */
  function coachWhyOf(data: TodaySessionData, coach: TodayCoachInputs, mixReason: string | null): { coachReason: string | null; review: TodayReviewStatus } {
    const nudge = coach.nudge === undefined || coach.nudge === null ? null : todayCoachWhy(coach.nudge);
    const review: TodayReviewStatus = nudge === null || nudge.review === 'pending' ? data.review : nudge.review;
    return { coachReason: nudge?.coachReason ?? mixReason, review: mixReason !== null && review === 'not_reviewed' ? 'reviewed' : review };
  }

  function whyLines(data: TodaySessionData, day: TodayDay, t: TodayTemplate, c: TodayControls, mainTarget: string | null, held: readonly string[], gap: string | null, coach: { coachReason: string | null; review: TodayReviewStatus } = { coachReason: null, review: data.review }): string[] {
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
      coachReason: coach.coachReason,
      review: coach.review,
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
    return todayDraftState(d).state === 'edited';
  }

  /** The builder's codec over Today's facts (per-slot state, rests from the rest level, the history each load came from). */
  function codecOf(data: TodaySessionData) {
    return { info: data.internal.info, catalogueIdOf: data.internal.catalogueIdOf, checkedOnOf: data.internal.checkedOn, ...(data.internal.ctx.restPresetsS === undefined ? {} : { restPresetsS: data.internal.ctx.restPresetsS }) };
  }

  function keyOf(data: TodaySessionData, day: TodayDay, t: TodayTemplate): BuilderDraftKey {
    return { planId: day.planId, dayIndex: day.dayIndex, splitDayId: day.splitDayId, mainLiftExerciseId: t.mainLiftExerciseId, localDate: data.localDate };
  }

  function versionOf(data: TodaySessionData, day: TodayDay, d: TodayDraft, controls: TodayControls, plan: DraftPlan, w: { draftId: string; n: number; parentN: number | null; draftVersion: number; at: ZonedTimestamp }): WorkoutDraftVersion {
    const minutes = clampInt(controls.minutes);
    const { draftId, n, parentN, at } = w;
    // The groups Ben chose (before Time's cuts): Your workout's Abs reads them, and a Set up change merges from them.
    const counts = new Map<BuilderGroupName, number>();
    for (const b of d.unfitted.blocks) for (const s of b.slots) {
      const g = data.internal.info(s.exerciseId)?.group;
      if (g !== undefined) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const groups = storedGroupsOf([...counts].map(([group, count]) => ({ group, count })));
    // (Review todaylean B2) Today's Time fit is Time's, never the plan's: its record (the draft before it, what it cut,
    // dropped and paired) and the plan day's own length go with the draft, so Your workout's Time, its note and Undo,
    // a refit after an option change, Start and the Summary all read the cuts as Time's (D1, D9; SP6: the original is
    // the plan day's full workout).
    const planMinutes = clampInt(d.template.minutes);
    // (Review todaylean B3) A card Time filled keeps what the fill added too: the plan day's draft is the base.
    const fit = todayTimeFit(d.unfitted, d.fit.steps, planMinutes, data.internal.ctx, minutes);
    const codec = codecOf(data);
    const setup = {
      dayId: day.splitDayId,
      minutes,
      mainLiftExerciseId: d.template.mainLiftExerciseId,
      // Ben's Supersets choice, not whether the fitted workout happens to have a pair (Your workout's switch and its
      // Time fit read it; review todaylean S6).
      supersets: controls.supersets,
      groups,
      ...(d.template.routineId !== null && d.template.version !== null ? { templateRoutineId: d.template.routineId, templateVersion: d.template.version } : {}),
      variationId: null,
      // The rest level lives only on the stored set-up (builder §4.5); the plan's rests are worked out from it.
      ...(d.workout.restLevel === 'normal' ? {} : { restLevel: d.workout.restLevel }),
      // (D3) Accessories moved into Your workout: it shows and changes the style Today drafted with.
      accessories: controls.accessories,
      ...(minutes !== planMinutes || fit !== null ? { timeFrom: planMinutes } : {}),
      ...(fit === null ? {} : { timeFit: timeFitToStored(fit, codec) }),
      ...(fit?.filledTo === undefined ? {} : { timeFill: fit.filledTo }),
    };
    const bodyParts = [...new Set(groups.flatMap((g) => g.parts))];
    return {
      n,
      parentN,
      status: 'current',
      actionId: todayActionId(draftId, n, w.draftVersion),
      turnId: 'manual',
      request: {
        text: '',
        minutes: setup.minutes,
        focus: 'split_day',
        gymId: data.gymId,
        origin: 'builder',
        day: { name: day.name.slice(0, 30), bodyParts: bodyParts.length > 0 ? bodyParts : ['Chest'] },
        setup,
        // Today owns the draft while its content still matches this (integrity B2).
        today: { by: 'today', controls: todayControlsHash(controls), hash: todayContentHash({ plan, setup, gymId: data.gymId }) },
      },
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
    // The coach's offer Ben applied stands as it is (one-tap Start; integrity B2).
    if (view.nudged !== null) return { ok: true, draftId: view.nudged.draftId, version: view.nudged.version };
    const d = view.draft;
    if (d === null) return { ok: false, message: TODAY_SESSION_COPY.stale };
    if (d.exerciseCount === 0) return { ok: false, message: TODAY_SESSION_COPY.empty };
    // The builder's codec (per-slot state, rests from the rest level, the history each load came from), so the
    // builder reads Today's draft exactly as its own (§4.4).
    const built = toDraftPlan(d.workout, codecOf(data));
    const key = keyOf(data, day, d.template);
    const name = `${day.name} · ${d.template.label}`.slice(0, 120);
    const at = deps.now();
    try {
      const existing = await repos().workoutDrafts.openBuilderDraft(data.ownerId, key);
      if (existing !== null) {
        if (existing.opIds.includes(opId) || isEdited(existing)) return { ok: true, draftId: existing.id, version: existing.version };
        const cur = currentDraftVersion(existing);
        const plan = withSlotRevs(cur.plan, built).plan;
        const n = Math.max(...existing.versions.map((v) => v.n)) + 1;
        const v = versionOf(data, day, d, sel.controls, plan, { draftId: existing.id, n, parentN: cur.n, draftVersion: existing.version + 1, at });
        // The same workout and set-up (Time's length and fit record included): nothing to write.
        if (stableStringify(cur.plan) === stableStringify(plan) && stableStringify(cur.request.setup ?? null) === stableStringify(v.request.setup ?? null)) return { ok: true, draftId: existing.id, version: existing.version };
        const kept = existing.versions.map((x) => (x.n === cur.n ? { ...x, status: 'replaced' as const } : x));
        while (kept.length >= MAX_WORKOUT_DRAFT_VERSIONS) kept.shift();
        const next: WorkoutDraft = { ...existing, name, versions: [...kept, v], currentVersion: n, version: existing.version + 1, updatedAtUtc: at.utc, opIds: [...existing.opIds, opId].slice(-MAX_WORKOUT_DRAFT_OPS) };
        const r = await repos().workoutDrafts.write(data.ownerId, existing.id, (c) => (c.version !== existing.version ? { kind: 'stale', current: c } : c.opIds.includes(opId) ? { kind: 'duplicate', current: c } : { kind: 'write', next, expectedVersion: existing.version }));
        if (r.status === 'written' || r.status === 'replayed') return { ok: true, draftId: r.draft.id, version: r.draft.version };
        return { ok: false, message: TODAY_SESSION_COPY.stale };
      }
      const id = deriveId(`today-draft:${data.ownerId}:${opId}`);
      const plan = withSlotRevs(null, built).plan;
      const draft: WorkoutDraft = {
        id,
        ownerId: data.ownerId,
        status: 'open',
        name,
        currentVersion: 1,
        versions: [versionOf(data, day, d, sel.controls, plan, { draftId: id, n: 1, parentN: null, draftVersion: 1, at })],
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

  /**
   * (D3 §2.3a; review todaylean S2) Today's draft for one of its days (the builder draft's key) and these controls, at
   * their Time: the code draft, never an edited or nudged one, from the same draft and fit code as the card. Your
   * workout's options load it and replay Ben's edits on it. Null: the day or its template is gone, or the main lift
   * asked for isn't one of the day's here.
   */
  async function draftFor(req: { key: BuilderDraftKey; controls: TodayControls }): Promise<TodayDraftFor | null> {
    const data = await load();
    if (data === null) return null;
    const k = req.key;
    const day = dayOf(data, k.planId !== null && k.dayIndex !== null ? `plan:${k.planId}:${String(k.dayIndex)}` : `other:${k.splitDayId ?? '-'}`);
    if (day === null) return null;
    const found = templateHere(data, day, req.controls.mainLiftExerciseId);
    if (found === null || (found.gap === null && found.t.mainLiftExerciseId !== req.controls.mainLiftExerciseId)) return null;
    const { t, gap } = found;
    const d = assembleTodayDraft({ day: gap === null ? day : { ...day, templates: [t] }, controls: { ...req.controls, mainLiftExerciseId: t.mainLiftExerciseId, mix: 0 }, ctx: data.internal.ctx, pool: poolFor(data, t), mix: data.internal.mixFor(day) });
    if (d === null) return null;
    return {
      workout: d.workout,
      unfitted: d.unfitted,
      steps: d.fit.steps,
      planMinutes: clampInt(d.template.minutes),
      template: { routineId: d.template.routineId, version: d.template.version, mainLiftExerciseId: d.template.mainLiftExerciseId, label: d.template.label },
      name: `${day.name} · ${d.template.label}`.slice(0, 120),
      key: { ...keyOf(data, day, d.template), localDate: k.localDate },
    };
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
    // The version Ben saw is pinned inside the write too (integrity S1): a change after this read creates nothing.
    return deps.port.start({ gymId: req.gymId, opId: req.opId, checkIn: req.checkIn, coachDraftOf: req.draftId, builder: { expectedVersion: req.expectedVersion } });
  }

  /**
   * (§2.0.3 step 2, §6.1) The coach's look at the card: the card is committed as today's builder draft (the coach
   * reviews the draft, and Apply changes that one draft), then the pre-session nudge runs on it. Silent unless a
   * clear real signal; its offer is applied only on Ben's tap (`applyNudge`, rule 3). Null: not wired, or the
   * draft couldn't be saved.
   */
  async function review(data: TodaySessionData, sel: TodaySelection, opId: string): Promise<NudgeResult | null> {
    if (deps.nudge === undefined) return null;
    const c = await commit(data, sel, `${opId}:commit`);
    if (!c.ok) return null;
    const day = dayOf(data, sel.dayKey);
    return deps.nudge({ draftId: c.draftId, splitDayId: day?.kind === 'plan' ? day.splitDayId : null, input: data.nudgeInput, opId: `${opId}:${c.draftId}` }).catch(() => null);
  }

  /** `↻ Mix it up` (rule 3): the coach's pick from code's shortlist with its reason; offline or unwired: null (code's pick stands, not reviewed). */
  async function mixPick(data: TodaySessionData, view: Pick<TodayCardView, 'mixShortlist' | 'mixFromExerciseId'>): Promise<MixPick | null> {
    if (deps.mixPick === undefined || view.mixFromExerciseId === null || view.mixShortlist.length === 0) return null;
    const { ctx, here } = data.internal;
    const world: BuilderCoachWorld = {
      snapshot: { draftId: '', draftVersion: 0, dayName: '', minutes: 0, supersets: false, workout: { blocks: [], restLevel: 'normal' }, revs: {} },
      env: { ctx, usable: here, pain: () => null, loads: createBuilderLoadGuard({ ctx, refs: () => null, pain: () => null }), mainGroup: null },
      extras: { usable: [], painFlags: [], dayNotes: [], plan: null, goal: data.goal, history: [], memories: data.internal.memories },
    };
    const pick = await deps.mixPick({ fromExerciseId: view.mixFromExerciseId, shortlist: view.mixShortlist, lastDone: data.internal.lastDoneText, world }).catch(() => null);
    return pick?.by === 'coach' ? pick : null;
  }

  return {
    load,
    card,
    movedLine,
    commit,
    draftFor,
    start,
    review,
    mixPick,
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
