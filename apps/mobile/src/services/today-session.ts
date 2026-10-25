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
  pbMainFocus,
  pbWarmupsOf,
  pbBlockOfPlan,
  pbBlockLine,
  ruleCategory,
  currentDraftVersion,
  defaultTodayControls,
  todayContentHash,
  todayControlsHash,
  todayDraftState,
  draftOpenedUnchanged,
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
  todayPlanDays,
  todaySplitDays,
  todaySplitNext,
  splitDayKey,
  splitDaySource,
  splitDaysTrained,
  splitWorkoutOf,
  lastSplitWorkoutGroups,
  todayWhy,
  toIso,
  toDraftPlan,
  toMs,
  timeFitChanges,
  carriedItems,
  carryItemText,
  carryOverOffer,
  fitLostByGroup,
  pendingCarryOvers,
  type CarryDay,
  type CarryItem,
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
  type MainFocus,
  type SlotLoadInput,
  type StripCell,
  type SubstituteContext,
  type SwapPlan,
  type TodayBreakdownRow,
  type TodayControls,
  type TodayDay,
  type TodayDraft,
  type TodayMixFacts,
  type TodayReviewStatus,
  type TodayTemplate,
  coachTargetRows,
  standingCoachTarget,
  type HistoryLike,
  type HistoryWorkout,
} from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import {
  COACH_DRAFT_DAYS,
  MAX_WORKOUT_DRAFT_OPS,
  MAX_WORKOUT_DRAFT_VERSIONS,
  isBrowseOnlyFocus,
  worksLine,
  type Activity,
  type BuilderDraftKey,
  type DraftPlan,
  type EquipmentInstance,
  type Exercise,
  type BuilderCarryOver,
  type Gym,
  type NextSessionTargetRecord,
  type PainFlag,
  type SessionAggregate,
  type SessionCheckIn,
  type TrainingProfile,
  type UserProfile,
  type WorkoutDraft,
  type WorkoutDraftVersion,
  type ZonedTimestamp,
} from '@fizz/schemas';

import type { NudgeSession, PreSessionInput } from '@fizz/coach';
import type { NudgeResult } from '../coach/builder-coach-service';
import { todayCoachWhy } from '../coach/builder-coach-view';
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
  /** Check-in settings' `offerAtOrBelow` (the nudge's low check-in signal); null: never. */
  offerAtOrBelow?: () => number | null;
}

/** What the coach said about Today's card (null: nothing yet, or not asked). */
export interface TodayCoachInputs {
  nudge?: NudgeResult | null;
}

/** Per group, how many catalogue exercises join Ben's own in a pool (the rest are reachable in the builder). */
const CATALOGUE_PER_GROUP = 8;
/** Up next's and the pools' history window. */
const WINDOW_DAYS = 42;

/** (Ben, 23 Oct) Behind Why?: `Carried over: +3 Triceps sets`. */
const TODAY_CARRIED = (x: Pick<CarryItem, 'group' | 'sets'>): string => `Carried over: +${String(x.sets)} ${x.group} ${x.sets === 1 ? 'set' : 'sets'}`;
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
  /**
   * (Ben, 23 Oct, D8) Today's Your workout draft for it, changed there (by Ben, or a coach change he applied in chat
   * that landed): Start starts that one (`· edited`). Absent or null: none.
   */
  edited?: { draftId: string; version: number } | null;
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
  /** (Ben, 23 Oct) Ben's answer to its carry-over offer (`BuilderSetup.carryOver`); null: not answered. */
  carryOver?: BuilderCarryOver | null;
}

/** (Ben, 23 Oct) Today's own open draft for a card (not edited): its answer to the carry-over offer, for that Time. */
export interface TodayCarryAnswer {
  draftId: string;
  version: number;
  minutes: number;
  carryOver: BuilderCarryOver;
}

/**
 * (Ben, 23 Oct; fit-to-time SP3) The carry-over on Today's card: the sets Time cut, by muscle to each one's next plan
 * day (`+3 Triceps sets on your next Shoulders day`), as an offer (`Carry over` / `✕`) or carried (`Undo`). `via`:
 * Today's own card (written with Today's draft, `todaySession.carryOver`) or an edited card's draft (Your workout's
 * `builder.carryOver`). `basis`: the offer as shown (a stale answer is refused, rule 5).
 */
export interface TodayCarryView {
  state: 'offer' | 'carried';
  items: CarryItem[];
  lines: string[];
  basis: string;
  via: { kind: 'today' } | { kind: 'builder'; draftId: string; version: number };
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
  /** The plan's next day, or (no plan) the Profile split's NEXT (null: none, or paused). */
  nextKey: string | null;
  /** (V5) No plan: why the split day is NEXT (`resolver`: the app's Up next named it); null with a plan or no split. */
  splitNextWhy: 'resolver' | 'due' | 'after_last' | null;
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
  /** (Ben, 23 Oct) Today's own drafts with an answer to the carry-over offer, by `dayKey|mainLift`. */
  carryAnswers: Readonly<Record<string, TodayCarryAnswer>>;
  /** The long or hard run near today (the clash line). */
  near: LegRunNear | null;
  strip: { workouts: { sessionId: string; localDate: string; title: string }[]; activities: Activity[]; firstUse: boolean };
  /** Done today (a second session can still be picked). */
  doneToday: boolean;
  /** (§6.1) The pre-session nudge's real signals (finished sessions, today's check-in, logged activities). */
  nudgeInput: PreSessionInput;
  /**
   * (Ben, 23 Oct: plan length = block 1) The applied builder plan's block week for the header: `Week 3 of 6`,
   * `Week 6 of 6 · Deload`, `Block done`. Null: no builder plan in use, or it's paused (the pause wins).
   */
  block: { text: string; accessibilityLabel: string; deload: boolean; done: boolean } | null;
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
  /** (Ben, 23 Oct) Sets carried over to this day (`pendingCarryOvers`); empty: none. */
  carryFor: (day: TodayDay) => CarryItem[];
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

/**
 * Today's card (D3, Ben 22–23 Oct; V5 23 Oct: the no-plan card reads the same): the session's rows, the Time control with
 * its note, Why?, Start and Edit. Main lift, accessories, abs, supersets and `↻ Mix it up` are on Your workout (Edit).
 */
export interface TodayCardView {
  dayKey: string;
  /** `Chest`, or `Chest · edited`. */
  title: string;
  edited: TodayEditedDraft | null;
  /** The coach's offer Ben applied: the card shows that draft, plain title, one-tap Start (no §2.8 prompt). */
  nudged: TodayNudgedDraft | null;
  /** `5 exercises · ~52 min`. */
  summary: string;
  minutes: number;
  exerciseCount: number;
  /** The Time row; on an edited card, the draft's own Time (steps go to Your workout's Time on it). */
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
  startable: boolean;
  /** For `commit` (the code draft; null when edited). */
  draft: TodayDraft | null;
  /** (Ben, 23 Oct) The carry-over of the sets Time cut, behind the Time note; null: none (no cut, not a plan day, under 2 sets). */
  carry: TodayCarryView | null;
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
  /** (Ben, 23 Oct) The carry-over. */
  carried: 'Carried over',
  nothingToCarry: 'Nothing to carry over',
  /** (Training-blocks §3.1) Behind `Why?` in the plan's deload week. */
  deloadWhy: 'Deload week: −10 % load, 1 set fewer',
} as const;

/** An open builder draft as Today's card shows it (changed on Your workout, or the coach's offer Ben applied). */
function editedOf(d: WorkoutDraft): TodayEditedDraft {
  const st = builderSetupOf(d);
  const tf = st?.timeFit;
  return {
    draftId: d.id,
    version: d.version,
    name: d.name,
    workout: fromDraftPlan(currentDraftVersion(d).plan, st?.restLevel ?? 'normal'),
    minutes: st?.minutes ?? currentDraftVersion(d).fitMinutes,
    timeFrom: st?.timeFrom ?? tf?.fromMinutes ?? null,
    fit: tf === undefined ? null : timeFitFromStored(tf),
    carryOver: st?.carryOver ?? null,
  };
}

/** A serial per history entry object: the store hands back the same entries while their workout is unchanged. */
const entrySerials = new WeakMap<HistorySession, number>();
let nextSerial = 0;
function historyKey(history: readonly HistorySession[]): string {
  return history
    .map((h) => {
      let n = entrySerials.get(h);
      if (n === undefined) {
        n = (nextSerial += 1);
        entrySerials.set(h, n);
      }
      return String(n);
    })
    .join(',');
}

/** What the rule reads of the gym and Ben's state, as a key (items and flags by ID and version; the minute). */
function substituteKey(sub: SubstituteContext, nowMs: number): string {
  return deriveId(
    stableStringify({
      ownerId: sub.ownerId,
      unit: sub.unit,
      gym: { id: sub.gym.id, name: sub.gym.name, items: sub.gym.equipment.map((e) => [e.id, e.version]) },
      known: [...sub.knownEquipment.values()].map((e) => [e.id, e.version]),
      pain: sub.painFlags.map((f) => [f.id, f.version]),
      sessionPain: sub.sessionPain,
      at: { tz: sub.at.tz, minute: Math.floor(toMs(sub.at.utc) / 60_000) },
      now: Math.floor(nowMs / 60_000),
    }),
  );
}

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

  /**
   * (Perf, 23 Oct) The rule's reads of each exercise's history (`loadReferences`, `substituteTargets`), kept while
   * nothing they read changed: the same exercise record, the same history entries (a corrected or new workout is a
   * new entry, `historyKey`), the same gym, items, pain flags and minute. A Your workout edit then re-reads Today
   * without re-running the rule over years of history. Pure inputs only, so the result is the same.
   */
  type RuleReads = { refs: ReturnType<typeof loadReferences>; sp: ReturnType<typeof substituteTargets>; acc: ReturnType<typeof substituteTargets> | null };
  let ruleCache = new Map<string, RuleReads>();
  let ruleCacheStore: Store | null = null;
  function ruleReads(key: string, compute: () => RuleReads): RuleReads {
    const store = deps.store();
    if (ruleCacheStore !== store || ruleCache.size > 2000) {
      ruleCache = new Map();
      ruleCacheStore = store;
    }
    let got = ruleCache.get(key);
    if (got === undefined) {
      got = compute();
      ruleCache.set(key, got);
    }
    return got;
  }

  /** Each exercise's load inputs at this gym: the template's dry run first, else the rule on its own history. */
  async function loadInputs(p: UserProfile, ids: readonly string[], exercises: ReadonlyMap<string, Exercise>, sub: SubstituteContext, planned: ReadonlyMap<string, PlannedAnchor>, flags: readonly PainFlag[], mainFocus: MainFocus, deload = false) {
    const out = new Map<string, SlotLoadInput>();
    const nowMs = toMs(deps.now().utc);
    // (Ben, 23 Oct) The coach's next-session rows per workout they were saved on, read once (its set count reaches the card).
    const coachRows = new Map<string, Promise<{ source: HistoryWorkout | null; rows: NextSessionTargetRecord[] }>>();
    const coachRowsOf = (sessionId: string) => {
      let got = coachRows.get(sessionId);
      if (got === undefined) {
        // The workout from the history cache (read-only here), not a fresh copy.
        const source = repos()
          .sessions.getMany([sessionId])
          .then((m) => {
            const a = m.get(sessionId);
            return a === undefined || a instanceof Error ? null : a;
          })
          .catch(() => null);
        got = Promise.all([source, repos().coach.listNextTargets(p.id, sessionId).catch(() => [] as NextSessionTargetRecord[])]).then(([src, rows]) => ({ source: src, rows: coachTargetRows(rows) }));
        coachRows.set(sessionId, got);
      }
      return got;
    };
    // (Perf, 23 Oct) Every exercise's history in one read (each workout decoded once), not one full read per exercise.
    const histories = ids.length > 1 ? await deps.store().listExerciseHistories(p.id, ids).catch(() => null) : null;
    const subKey = substituteKey(sub, nowMs);
    const shape = { workingSets: 3, templates: [{ setType: 'working' as const, reps: { min: 8, max: 12 }, durationS: null }] };
    for (const id of ids) {
      const e = exercises.get(id);
      if (e === undefined) continue;
      const history = histories?.get(id) ?? (await deps.port.historyFor(p.id, id).catch(() => [] as HistorySession[]));
      // The rule's pure reads of his history (the heavy part), worked out once per history, gym and minute.
      const ruleOf = ruleReads(`${id}|${String(e.version)}|${e.updatedAtUtc}|${historyKey(history)}|${subKey}|${sub.lastUsedHere?.(id) ?? '-'}`, () => {
        const r = loadReferences({ exercise: e, history, ctx: sub, nowMs });
        const accessory = ruleCategory(e, r.equipment?.kind ?? null, r.convention) === 'main_barbell' ? substituteTargets(shape, e, history, sub, { accessory: true }) : null;
        return { refs: r, sp: substituteTargets(shape, e, history, sub), acc: accessory };
      });
      const refs = ruleOf.refs;
      const fromPlan = planned.get(id);
      const anchorOf = (a: { anchor: AnchorLoad; unit: 'kg' | 'lb'; convention: string } | undefined): AnchorLoad | null => (a === undefined || a.convention !== refs.convention ? null : { ...a.anchor, value: convertValue(a.anchor.value, a.unit, refs.unit) });
      let ruleTarget: AnchorLoad | null = null;
      const ruleRpe = builtInTargetRpe(ruleCategory(e, refs.equipment?.kind ?? null, refs.convention));
      // The rule runs on every card, plan days too: its reps (Ben's last session of the exercise; 21 Oct) set every slot's reps.
      const sp = ruleOf.sp;
      // A main barbell lift as a secondary lift: its rule read as a compound lift's (`slotLoadOf`).
      const acc = ruleOf.acc;
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
      // (Ben, 23 Oct) The coach's set count for next time, as Start and Your workout read it (`standingCoachTarget`);
      // never on a pain-flagged movement (rule 9).
      const newest = history[0];
      const standing = held || newest === undefined ? null : await coachRowsOf(newest.sessionId).then((c) => (c.source === null ? null : standingCoachTarget(c.rows, c.source, id)));
      const coachSets = standing?.sets ?? null;
      out.set(id, {
        mainFocus,
        unit: refs.unit,
        convention: refs.convention,
        equipment: refs.equipment,
        bodyweightExercise: e.defaultLoadConvention === 'bodyweight',
        gymEquipment: sub.gym.equipment,
        coachTarget: !heldNoHistory && fromPlan?.source === 'coach' ? anchorOf(fromPlan) : null,
        ...(coachSets === null ? {} : { coachSets }),
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
        // (Ben, 23 Oct: plan length = block 1) The plan's deload week: ~10 % lighter, a set fewer (`withDeloadSets`).
        ...(deload ? { deload: true as const } : {}),
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

  /**
   * (Perf, 23 Oct) Today's data, read once per state: Today, its Edit, and Your workout's Today options (`draftFor`,
   * `mainLiftsFor`, `mixFactsFor`, `carryDaysFor`, `carryItemsFor`) used to each re-read and re-plan everything. The
   * same database with no write since (`writeCount`), the same minute, coach status and check-in setting give the
   * same data; anything else reads again. Local only (rule 1).
   */
  let memo: { key: string; store: Store; value: Promise<TodaySessionData | null> } | null = null;
  async function load(): Promise<TodaySessionData | null> {
    const store = deps.store();
    const coach = await deps.coachStatus().catch((): CoachStatus => 'not_connected');
    const key = `${String(store.db.writeCount)}|${String(Math.floor(toMs(deps.now().utc) / 60_000))}|${coach}|${String(deps.offerAtOrBelow?.() ?? null)}`;
    if (memo !== null && memo.store === store && memo.key === key) return memo.value;
    const value = loadFresh();
    memo = { key, store, value };
    // A failed read is never kept.
    value.catch(() => {
      if (memo?.value === value) memo = null;
    });
    return value;
  }

  async function loadFresh(): Promise<TodaySessionData | null> {
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
    // (Ben, 23 Oct: plan length = block 1) The block week, derived from the plan's Apply, pauses and his plan workouts.
    const block = plan === null || paused ? null : pbBlockOfPlan(plan, await repos().sessions.listFinishedRefs(p.id, 400).catch(() => []), nowMs, tz);
    const deload = block?.deload === true;
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
    const planDays = plan === null ? [] : todayPlanDays({ planId: plan.id, templates, split, mainLifts: training?.mainLifts, info, defaultMinutes: training?.sessionMinutes ?? 60 });
    // An applied plan with no live workouts left is no plan in use (Library › Your plan shows none either).
    const status: TodaySessionStatus = plan === null || planDays.length === 0 ? 'no_plan' : paused ? 'paused' : 'plan';

    // History in the window: pools, Mix it up, Why?, the strip.
    const { sessions } = await repos()
      .sessions.listFinishedBetweenReadable(p.id, toIso(nowMs - WINDOW_DAYS * DAY_MS), toIso(nowMs + 1))
      .catch(() => ({ sessions: [] as HistoryWorkout[] }));
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
    const nextPlanDay = upNext === null ? null : (planDays.find((d) => d.templates.some((t) => t.routineId === upNext)) ?? null);

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
      // Prehab and forearm work (cuff, shins, wrist curls) is Swap / Add only: never picked into a day by itself.
      if (i === null || isBrowseOnlyFocus(i.angle) || !here(id) || pained(id)) return;
      const list = byGroup.get(i.group) ?? [];
      if (list.includes(id)) return;
      if (cap && list.length >= CATALOGUE_PER_GROUP + own.filter((o) => info(o)?.group === i.group).length) return;
      list.push(id);
      byGroup.set(i.group, list);
    };
    for (const id of own) add(id, false);
    for (const e of deps.catalogueExercises()) add(e.id, true);
    const groupPool = (g: BuilderGroupName): readonly string[] => byGroup.get(g) ?? [];

    // (V5, §2.0.4 No plan; D7) No plan in use: the day row is Profile › Split, each day drafted like a plan day. NEXT is
    // the app's one Up next resolver when it names a split day (only at a saved gym, as Start plans there), else the
    // split rule (least recently trained, the run rule). A failed read is no Up next (the rest of Today still loads).
    const fallbackNext = status === 'no_plan' && gymId !== null ? await deps.port.upNext(gymId).catch(() => null) : null;
    const profileSplit = status === 'no_plan' ? (training?.split ?? null) : null;
    const exerciseOf = (id: string) => exercises.get(id) ?? null;
    const splitWorkouts = profileSplit === null ? [] : newest.map((a) => splitWorkoutOf(a, exerciseOf, training?.sessionMinutes ?? null));
    const trainedDays = new Map<string, readonly string[]>(profileSplit === null ? [] : splitWorkouts.map((w) => [w.sessionId, splitDaysTrained(profileSplit, w.groups)]));
    const splitDays =
      profileSplit === null
        ? []
        : todaySplitDays({
            split: profileSplit,
            mainLifts: training?.mainLifts,
            exercisesOf: (dayId) => {
              const src = splitDaySource(profileSplit, { id: dayId }, splitWorkouts);
              const a = src === null ? undefined : newest.find((x) => x.session.id === src.sessionId);
              return a === undefined ? [] : [...a.exercises].filter((e) => e.removed === undefined).sort((x, y) => x.order - y.order).map((e) => e.exerciseId);
            },
            pool: groupPool,
            info,
            catalogueKeyOf: (id) => exercises.get(id)?.catalogueKey ?? null,
            defaultMinutes: training?.sessionMinutes ?? 60,
          });
    const near = legRunNear(await repos().activities.listBetween(p.id, addDays(today, -1), addDays(today, 2)).catch(() => [] as Activity[]), today);
    // The resolver's pick by its title, else by the muscles of the workout it plans from (a split day's Up next is
    // planned from his newest workout of that day, which keeps its own name).
    const upNextSource = fallbackNext?.sourceSessionId == null ? null : (splitWorkouts.find((w) => w.sessionId === fallbackNext.sourceSessionId) ?? null);
    const splitNext =
      profileSplit === null || splitDays.length === 0
        ? null
        : todaySplitNext({ split: profileSplit, upNext: fallbackNext === null ? null : { title: fallbackNext.title, groups: upNextSource?.groups ?? null }, workouts: splitWorkouts, near, lastGroups: lastSplitWorkoutGroups(profileSplit, newest, exerciseOf) });
    const days = planDays.length > 0 ? planDays : splitDays;
    const nextDay = nextPlanDay ?? (splitNext === null ? null : (splitDays.find((d) => d.key === splitDayKey(splitNext.dayId)) ?? null));

    // Other sessions: the plan days' main lifts, else the catalogue's standard ones.
    const catalogueByKey = new Map<string, Exercise>();
    for (const e of deps.catalogueExercises()) if (e.catalogueKey) catalogueByKey.set(e.catalogueKey, e);
    const fallbacks = ['barbell-back-squat', 'barbell-bench-press', 'barbell-bent-over-row', 'barbell-overhead-press']
      .map((k) => catalogueByKey.get(k))
      .filter((e): e is Exercise => e !== undefined && here(e.id))
      .map((e) => ({ id: e.id, label: e.name }));
    // A split day of the same ID (`push` on PPL) is that day already: it isn't offered twice.
    const others = TODAY_OTHER_SESSIONS.filter((s) => !splitDays.some((d) => d.splitDayId === s.id)).map((s) => otherSessionDay(s, otherMainOptions(s, planDays, info, fallbacks), info, training?.sessionMinutes ?? 60));

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
    // (D4) Back-offs sit in the band for Ben's goal (as Your workout's); (S7) a builder plan in use: its focus's band.
    const mainFocus = pbMainFocus(plan, goal);
    const warmups = pbWarmupsOf(plan);
    const loads = await loadInputs(p, [...ids].filter((id) => info(id) !== null), exercises, subAll, anchors, flags, mainFocus, deload);
    const fallbackLoad = (id: string): SlotLoadInput => ({ mainFocus, unit: p.preferredUnit, convention: exercises.get(id)?.defaultLoadConvention ?? 'total', equipment: null, coachTarget: null, planFirstLoad: null, ruleTarget: null, e1rm: null, startLightCeiling: null, painCap: null, ...(deload ? { deload: true as const } : {}) });
    const ctx: BuilderContext = {
      info,
      loads: (id) => loads.get(id) ?? fallbackLoad(id),
      newKey: (id) => deriveId(`today-slot:${today}:${id}`),
      // Ben's rest presets, as the builder's (rests and the ~N min agree with Your workout).
      ...(p.restPresets.length > 0 ? { restPresetsS: p.restPresets.map((r) => r.seconds) } : {}),
      // (Ben, 23 Oct) The plan's Warm-ups setting (Full / Short / None), as Your workout and Start plan them.
      ...(warmups === 'full' ? {} : { warmups }),
    };

    // Each day's own sessions (credited by plan day or by its templates), newest first.
    const daySessions = (day: TodayDay): HistoryWorkout[] =>
      newest.filter((a) => {
        // A split day's workouts are the ones that trained it, by the muscles done (as Up next counts them).
        if (day.kind === 'split') return trainedDays.get(a.session.id)?.includes(day.splitDayId) === true;
        const pd = a.session.planDay;
        if (pd !== undefined && day.planId !== null) return pd.planId === day.planId && pd.dayIndex === day.dayIndex;
        return a.session.routineId !== null && day.templates.some((t) => t.routineId === a.session.routineId);
      });
    const exerciseIdsOf = (a: HistoryLike) => new Set(a.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseId));
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
    const allDrafts = await repos().workoutDrafts.listByOwner(p.id).catch(() => [] as WorkoutDraft[]);
    const open = allDrafts.filter((d) => d.status === 'open' && d.builderKey?.localDate === today && toMs(d.expiresAtUtc) > nowMs);
    // (Ben, 23 Oct; fit-to-time SP3) Sets Ben carried over from a workout Time cut: from the drafts that became workouts,
    // each still carrying no more than its fit as it ended took; they land on their day's next card (`pendingCarryOvers`).
    const carrySources = allDrafts.flatMap((d) => {
      if (d.status !== 'started' || d.sessionId === null || d.builderKey?.planId == null) return [];
      const st = builderSetupOf(d);
      const carry = st?.carryOver;
      if (st === null || carry === undefined || carry.choice !== 'carried' || st.timeFit === undefined) return [];
      const fitRec = timeFitFromStored(st.timeFit);
      const now = fromDraftPlan(currentDraftVersion(d).plan, st.restLevel ?? 'normal');
      const items = carriedItems(carry, fitLostByGroup(timeFitChanges(fitRec, now), fitRec.base, info));
      return items.length === 0 ? [] : [{ draft: d, items, atUtc: carry.atUtc }];
    });
    const carrySessions = newest.map((a) => ({ sessionId: a.session.id, startedAtUtc: a.session.startedAt.utc, ...(a.session.planDay === undefined ? {} : { planDay: { planId: a.session.planDay.planId, dayIndex: a.session.planDay.dayIndex } }) }));
    const carryFor = (day: TodayDay): CarryItem[] => (day.kind !== 'plan' || day.planId === null || day.dayIndex === null || carrySources.length === 0 ? [] : pendingCarryOvers({ sources: carrySources, sessions: carrySessions, planId: day.planId, dayIndex: day.dayIndex, nowUtc: now.utc }));
    const dayKeyOfDraft = todayDayKeyOf;
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

    const carryAnswers: Record<string, TodayCarryAnswer> = {};
    for (const d of open) {
      const own = todayDraftState(d);
      // (Ben, 23 Oct) Today's own draft keeps Ben's answer to the card's carry-over offer (it survives a force-close).
      const ownSetup = own.state === 'today' ? builderSetupOf(d) : null;
      if (ownSetup?.carryOver !== undefined && d.builderKey !== undefined) carryAnswers[`${dayKeyOfDraft(d.builderKey)}|${d.builderKey.mainLiftExerciseId ?? '-'}`] = { draftId: d.id, version: d.version, minutes: ownSetup.minutes, carryOver: ownSetup.carryOver };
      // Today's own, or opened on Your workout and left as it was (review batch23 S3): not `· edited`.
      if (own.state === 'today' || draftOpenedUnchanged(d)) continue;
      const k = d.builderKey;
      if (k === undefined) continue;
      const dayKey = dayKeyOfDraft(k);
      const shown = editedOf(d);
      if (own.state === 'nudge') nudged[`${dayKey}|${k.mainLiftExerciseId ?? '-'}`] = { ...shown, controls: own.controls };
      else edited[`${dayKey}|${k.mainLiftExerciseId ?? '-'}`] = shown;
    }

    // The strip: 3 back, today, 3 ahead.
    const acts = await repos()
      .activities.listBetween(p.id, addDays(today, -3), addDays(today, 4))
      .catch(() => [] as Activity[]);
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
    // No plan and no Profile split: the old Today's Up next (rotation, longest gap) is still one tap away.
    // (D8) Today's Your workout draft for Up next, once changed there: Start starts what that page shows.
    const upNextDraft =
      fallbackNext === null
        ? null
        : (open.find((d) => {
            const f = d.builderKey?.from;
            const same = f !== undefined && ((f.kind === 'routine' && f.id === fallbackNext.routineId) || (f.kind === 'session' && f.id === fallbackNext.sourceSessionId));
            return same && isEdited(d);
          }) ?? null);
    // (D8, V5) With the day row from Profile › Split, Up next is the NEXT split day's card: a change landed on the
    // resolver's own Your workout draft for that day (by Ben, or a coach change he applied in chat) shows there
    // (`· edited`), and Start and Edit use it. Only when the resolver named that split day.
    const nextMain = nextDay === null ? undefined : initial[nextDay.key]?.mainLiftExerciseId;
    if (upNextDraft !== null && nextDay?.kind === 'split' && splitNext?.why === 'resolver' && nextMain !== undefined) {
      const at = `${nextDay.key}|${nextMain ?? '-'}`;
      edited[at] ??= editedOf(upNextDraft);
    }
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
      splitNextWhy: splitNext?.why ?? null,
      upNext: fallbackNext === null ? null : { ...fallbackNext, ...(upNextDraft === null ? {} : { edited: { draftId: upNextDraft.id, version: upNextDraft.version } }) },
      initial,
      latestDraft,
      goal,
      review,
      coachLabel: review === 'offline' ? TODAY_V2_COPY.offline : TODAY_V2_COPY.coach,
      edited,
      nudged,
      carryAnswers,
      near,
      strip: { workouts: stripWorkouts, activities: acts, firstUse: newest.length === 0 && refs.length === 0 && acts.length === 0 },
      doneToday: stripWorkouts.some((w) => w.localDate === today),
      nudgeInput,
      block: block === null ? null : pbBlockLine(block),
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
        carryFor,
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
        title: edited === null ? day.name : `${day.name} · ${TODAY_V2_COPY.edited}`,
        edited,
        nudged: edited === null ? nudged : null,
        summary: TODAY_V2_COPY.summary(count, minutes),
        minutes,
        exerciseCount: count,
        // The coach's version Ben applied keeps Time (a step is Today's card again). (D3; review todaylean S4; V5) An
        // edited card keeps Time too: the draft's own (Your workout's Time on it, refitted around Ben's edits, FT5).
        time: edited === null ? timeView(sel.controls.minutes, t.minutes, { note: null, lines: [] }, false) : editedTime(data, edited),
        clashLine: clash,
        controls: { mainLifts, accessories: sel.controls.accessories, minutes: sel.controls.minutes, abs: { on: sel.controls.abs ?? t.absPlan, planOn: t.absPlan, differs: false }, supersets: sel.controls.supersets },
        unit,
        rows: todayBreakdown(held.workout, info, worksOf, unit, pained),
        why: [...whyLines(data, day, t, sel.controls, null, heldIn(held.workout), gap, coachWhyOf(data, coach)), ...deloadWhy(data)],
        startable: count > 0,
        draft: null,
        carry: edited !== null ? editedCarry(data, day, edited) : null,
      };
    }
    // (D3, Ben 22–23 Oct; V5) `↻ Mix it up` left the card with the other Today-only controls (Your workout has it): the
    // card never swaps an accessory, whatever an older selection carried.
    const d = assembleTodayDraft({ day: dayHere, controls: { ...sel.controls, mainLiftExerciseId: t.mainLiftExerciseId, mix: 0 }, ctx, pool: poolFor(data, t), mix: data.internal.mixFor(day), carry: data.internal.carryFor(day) });
    if (d === null) return null;
    const unit = breakdownUnit(d.workout, data.unit);
    const advice = d.advice[0]?.reason ?? null;
    const mainSlot = d.workout.blocks.flatMap((b) => b.slots).find((s) => s.main) ?? null;
    const slotName = (key: string) => nameOf(d.workout.blocks.flatMap((b) => b.slots).find((x) => x.key === key)?.exerciseId ?? '');
    return {
      dayKey: day.key,
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
      // (Ben, 23 Oct) Sets carried over to this day: one line each behind Why?.
      why: [...whyLines(data, day, t, sel.controls, mainSlot === null ? null : todayBreakdown({ blocks: [{ slots: [mainSlot], auto: false }], restLevel: 'normal' }, info, worksOf, unit)[0]?.top ?? null, heldIn(d.workout), gap, coachWhyOf(data, coach)), ...d.carried.map((x) => TODAY_CARRIED(x)), ...deloadWhy(data)],
      startable: d.exerciseCount > 0,
      draft: d,
      carry: todayCarry(data, day, d, sel.controls.minutes),
    };
  }

  /** (Ben, 23 Oct: plan length = block 1; training-blocks §3.1) A deload week's line behind `Why?`. */
  function deloadWhy(data: TodaySessionData): string[] {
    return data.block?.deload === true ? [TODAY_SESSION_COPY.deloadWhy] : [];
  }

  /** (Ben, 23 Oct) The plan's days as the carry-over routes to them (each day's groups over its templates). */
  function carryDaysOf(data: TodaySessionData, planId: string): CarryDay[] {
    return data.days.filter((x) => x.kind === 'plan' && x.planId === planId && x.dayIndex !== null).map((x) => ({ dayIndex: x.dayIndex ?? 0, name: x.name, groups: [...new Set(x.templates.flatMap((t) => t.groups.map((g) => g.group)))] }));
  }

  /**
   * (Ben, 23 Oct; fit-to-time SP3) What Today's card Time cut, as the carry-over offer: the same record Start saves
   * (`todayTimeFit`) and the same offer Your workout makes from it (`carryOverOffer`). Null: nothing to offer.
   */
  function todayCarryOffer(data: TodaySessionData, day: TodayDay, d: TodayDraft, minutes: number): CarryItem[] | null {
    if (day.kind !== 'plan' || day.planId === null || day.dayIndex === null) return null;
    const { ctx, info } = data.internal;
    const fit = todayTimeFit(d.unfitted, d.fit.steps, clampInt(d.template.minutes), ctx, clampInt(minutes));
    if (fit === null || fit.filledTo !== undefined) return null;
    const items = carryOverOffer({ steps: timeFitChanges(fit, d.workout), base: fit.base, info, mainGroup: d.mainGroup, fromDayIndex: day.dayIndex, days: carryDaysOf(data, day.planId) });
    return items.length === 0 ? null : items;
  }

  /** The offer as shown (minutes and items): what Ben's answer is checked against (rule 5). */
  const carryBasis = (minutes: number, items: readonly CarryItem[]): string => deriveId(`today-carry:${stableStringify({ minutes: clampInt(minutes), items })}`);

  /** (Ben, 23 Oct) Today's own card: its offer, or Ben's answer to it while it is for the offer the card shows. */
  function todayCarry(data: TodaySessionData, day: TodayDay, d: TodayDraft, minutes: number): TodayCarryView | null {
    const items = todayCarryOffer(data, day, d, minutes);
    if (items === null) return null;
    const answer = data.carryAnswers[`${day.key}|${d.template.mainLiftExerciseId ?? '-'}`];
    const answered = answer !== undefined && answer.minutes === clampInt(minutes) && stableStringify(answer.carryOver.items) === stableStringify(items) ? answer.carryOver : null;
    if (answered?.choice === 'skipped') return null;
    return { state: answered === null ? 'offer' : 'carried', items, lines: items.map(carryItemText), basis: carryBasis(minutes, items), via: { kind: 'today' } };
  }

  /** (Ben, 23 Oct) An edited card's carry-over: as Your workout shows it on that draft (its fit, Ben's answer). */
  function editedCarry(data: TodaySessionData, day: TodayDay, e: TodayEditedDraft): TodayCarryView | null {
    if (e.fit === null || e.fit.filledTo !== undefined || day.kind !== 'plan' || day.planId === null || day.dayIndex === null) return null;
    const { info } = data.internal;
    const changes = timeFitChanges(e.fit, e.workout);
    const via = { kind: 'builder' as const, draftId: e.draftId, version: e.version };
    const answer = e.carryOver ?? null;
    if (answer?.choice === 'skipped') return null;
    if (answer?.choice === 'carried') {
      const items = carriedItems(answer, fitLostByGroup(changes, e.fit.base, info));
      return items.length === 0 ? null : { state: 'carried', items, lines: items.map(carryItemText), basis: carryBasis(e.minutes, items), via };
    }
    const main = e.workout.blocks.flatMap((b) => b.slots).find((x) => x.main);
    const mainGroup = (main === undefined ? null : info(main.exerciseId)?.group) ?? null;
    const items = carryOverOffer({ steps: changes, base: e.fit.base, info, mainGroup, fromDayIndex: day.dayIndex, days: carryDaysOf(data, day.planId) });
    return items.length === 0 ? null : { state: 'offer', items, lines: items.map(carryItemText), basis: carryBasis(e.minutes, items), via };
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

  /** The coach's part of Why?: its nudge (`todayCoachWhy`); no nudge yet: the connection's status. */
  function coachWhyOf(data: TodaySessionData, coach: TodayCoachInputs): { coachReason: string | null; review: TodayReviewStatus } {
    const nudge = coach.nudge === undefined || coach.nudge === null ? null : todayCoachWhy(coach.nudge);
    const review: TodayReviewStatus = nudge === null || nudge.review === 'pending' ? data.review : nudge.review;
    return { coachReason: nudge?.coachReason ?? null, review };
  }

  function whyLines(data: TodaySessionData, day: TodayDay, t: TodayTemplate, c: TodayControls, mainTarget: string | null, held: readonly string[], gap: string | null, coach: { coachReason: string | null; review: TodayReviewStatus } = { coachReason: null, review: data.review }): string[] {
    const next = data.nextKey === null ? null : (dayOf(data, data.nextKey)?.name ?? null);
    return todayWhy({
      dayName: day.name,
      nextDayName: next,
      other: day.kind === 'other',
      split: day.kind === 'split' ? { due: data.splitNextWhy !== 'after_last' } : null,
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
    // (Review batch23 S3, M2) Opened on Your workout and left as it was isn't an edit.
    return todayDraftState(d).state === 'edited' && !draftOpenedUnchanged(d);
  }

  /** The builder's codec over Today's facts (per-slot state, rests from the rest level, the history each load came from). */
  function codecOf(data: TodaySessionData) {
    return { info: data.internal.info, loads: data.internal.ctx.loads, catalogueIdOf: data.internal.catalogueIdOf, checkedOnOf: data.internal.checkedOn, ...(data.internal.ctx.restPresetsS === undefined ? {} : { restPresetsS: data.internal.ctx.restPresetsS }), ...(data.internal.ctx.warmups === undefined ? {} : { warmups: data.internal.ctx.warmups }) };
  }

  function keyOf(data: TodaySessionData, day: TodayDay, t: TodayTemplate): BuilderDraftKey {
    return { planId: day.planId, dayIndex: day.dayIndex, splitDayId: day.splitDayId, mainLiftExerciseId: t.mainLiftExerciseId, localDate: data.localDate };
  }

  function versionOf(data: TodaySessionData, day: TodayDay, d: TodayDraft, controls: TodayControls, plan: DraftPlan, w: { draftId: string; n: number; parentN: number | null; draftVersion: number; at: ZonedTimestamp; carryOver?: BuilderCarryOver | null }): WorkoutDraftVersion {
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
      // (Ben, 23 Oct) Ben's answer to the card's carry-over offer, for this fit (Your workout and Start read it).
      ...(w.carryOver == null || fit === null ? {} : { carryOver: w.carryOver }),
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
    return commitWith(data, sel, opId, undefined);
  }

  /**
   * `commit`, with Ben's answer to the card's carry-over offer (`answer`: his answer, null: cleared by Undo,
   * undefined: kept as stored while it is for the offer the card shows; a new Time asks again). With an answer, a draft
   * edited since on Your workout is refused (rule 5): the answer is written only on Today's own draft.
   */
  async function commitWith(data: TodaySessionData, sel: TodaySelection, opId: string, answer: BuilderCarryOver | null | undefined): Promise<TodayCommitResult> {
    const view = card(data, sel);
    const day = dayOf(data, sel.dayKey);
    if (view === null || day === null) return { ok: false, message: TODAY_SESSION_COPY.stale };
    if (answer !== undefined && (view.edited !== null || view.nudged !== null)) return { ok: false, message: TODAY_SESSION_COPY.stale };
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
        if (existing.opIds.includes(opId)) return { ok: true, draftId: existing.id, version: existing.version };
        if (isEdited(existing)) return answer === undefined ? { ok: true, draftId: existing.id, version: existing.version } : { ok: false, message: TODAY_SESSION_COPY.stale };
        const cur = currentDraftVersion(existing);
        const plan = withSlotRevs(cur.plan, built).plan;
        const n = Math.max(...existing.versions.map((v) => v.n)) + 1;
        // Ben's answer stays with the draft while it's for the offer this card makes (the same Time, the same sets).
        const offer = todayCarryOffer(data, day, d, sel.controls.minutes);
        const was = builderSetupOf(existing)?.carryOver;
        const keptAnswer = was !== undefined && offer !== null && cur.request.setup?.minutes === clampInt(sel.controls.minutes) && stableStringify(was.items) === stableStringify(offer) ? was : null;
        const v = versionOf(data, day, d, sel.controls, plan, { draftId: existing.id, n, parentN: cur.n, draftVersion: existing.version + 1, at, carryOver: answer === undefined ? keptAnswer : answer });
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
        versions: [versionOf(data, day, d, sel.controls, plan, { draftId: id, n: 1, parentN: null, draftVersion: 1, at, carryOver: answer ?? null })],
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
    const day = dayOf(data, todayDayKeyOf(k));
    if (day === null) return null;
    const found = templateHere(data, day, req.controls.mainLiftExerciseId);
    if (found === null || (found.gap === null && found.t.mainLiftExerciseId !== req.controls.mainLiftExerciseId)) return null;
    const { t, gap } = found;
    const d = assembleTodayDraft({ day: gap === null ? day : { ...day, templates: [t] }, controls: { ...req.controls, mainLiftExerciseId: t.mainLiftExerciseId, mix: 0 }, ctx: data.internal.ctx, pool: poolFor(data, t), mix: data.internal.mixFor(day), carry: data.internal.carryFor(day) });
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

  /**
   * (V5) Your workout's Main lift options for a no-plan Today draft (a Profile split day or an Other session): the day's
   * main lifts this gym can do (the draft's own kept even when it can't). Null: not one of Today's days now.
   */
  async function mainLiftsFor(key: BuilderDraftKey): Promise<{ exerciseId: string; label: string }[] | null> {
    const data = await load();
    if (data === null) return null;
    const day = dayOf(data, todayDayKeyOf(key));
    if (day === null) return null;
    return day.templates.flatMap((t) => (t.mainLiftExerciseId !== null && (data.internal.here(t.mainLiftExerciseId) || t.mainLiftExerciseId === key.mainLiftExerciseId) ? [{ exerciseId: t.mainLiftExerciseId, label: t.label }] : []));
  }

  /**
   * (Ben, 23 Oct; review todaylean SP3) `↻ Mix it up` on Your workout: the Mix it up facts of the day a builder draft is
   * for (its recent sessions, when each exercise was last done, what's here and pain-flagged), the same ones Today's
   * card used before D3. Null: not one of Today's days.
   */
  async function mixFactsFor(key: BuilderDraftKey): Promise<TodayMixFacts | null> {
    const data = await load();
    if (data === null) return null;
    const day = dayOf(data, todayDayKeyOf(key));
    return day === null ? null : data.internal.mixFor(day);
  }

  /**
   * (Ben, 23 Oct; fit-to-time SP3) The plan's days as the carry-over routes to them (each day's groups over its
   * templates), for a builder draft of that plan. Null: not the plan in use.
   */
  async function carryDaysFor(key: BuilderDraftKey): Promise<CarryDay[] | null> {
    const data = await load();
    if (data === null || key.planId === null) return null;
    const days = data.days.filter((d) => d.kind === 'plan' && d.planId === key.planId && d.dayIndex !== null);
    if (days.length === 0) return null;
    return days.map((d) => ({ dayIndex: d.dayIndex ?? 0, name: d.name, groups: [...new Set(d.templates.flatMap((t) => t.groups.map((g) => g.group)))] }));
  }

  /**
   * (Ben, 23 Oct; fit-to-time SP3) Ben's answer to the carry-over offer on Today's own card: `carried` (`Carry over`),
   * `skipped` (`✕`) or `clear` (`Undo`: offered again). Written with Today's draft for the card (one versioned write, op
   * ID; the same op again is a replay), so Start, Edit and a force-close keep it. Refused when the offer is no longer
   * the one Ben saw (`basis`; rule 5), or the card's draft was edited since on Your workout. Never applied by default:
   * nothing lands until this workout is done.
   */
  async function carryOver(data: TodaySessionData, sel: TodaySelection, choice: 'carried' | 'skipped' | 'clear', req: { opId: string; basis: string }): Promise<{ status: 'written' } | { status: 'stale' | 'refused'; message: string }> {
    const view = card(data, sel);
    const c = view?.carry ?? null;
    if (view === null || c === null || c.via.kind !== 'today') return { status: 'refused', message: TODAY_SESSION_COPY.nothingToCarry };
    if (c.basis !== req.basis) return { status: 'stale', message: TODAY_SESSION_COPY.stale };
    if (choice !== 'clear' && c.state !== 'offer') return { status: 'refused', message: TODAY_SESSION_COPY.nothingToCarry };
    const answer: BuilderCarryOver | null = choice === 'clear' ? null : { choice, atUtc: deps.now().utc, items: c.items };
    const r = await commitWith(data, sel, req.opId, answer);
    return r.ok ? { status: 'written' } : { status: 'stale', message: r.message };
  }

  /** (Ben, 23 Oct) The sets carried over to a plan day's next workout (`pendingCarryOvers`); empty: none, or not Today's plan. */
  async function carryItemsFor(req: { planId: string; dayIndex: number }): Promise<CarryItem[]> {
    const data = await load();
    const day = data === null ? null : dayOf(data, `plan:${req.planId}:${String(req.dayIndex)}`);
    return data === null || day === null ? [] : data.internal.carryFor(day);
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
    return deps.nudge({ draftId: c.draftId, splitDayId: day?.kind === 'plan' || day?.kind === 'split' ? day.splitDayId : null, input: data.nudgeInput, opId: `${opId}:${c.draftId}` }).catch(() => null);
  }

  return {
    load,
    card,
    movedLine,
    commit,
    draftFor,
    mixFactsFor,
    carryDaysFor,
    carryItemsFor,
    carryOver,
    start,
    review,
    mainLiftsFor,
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

/** A builder draft key's Today day: `plan:<planId>:<dayIndex>`, else `other:<splitDayId>` (a Profile split day or an Other session). */
export function todayDayKeyOf(k: Pick<BuilderDraftKey, 'planId' | 'dayIndex' | 'splitDayId'>): string {
  return k.planId !== null && k.dayIndex !== null ? `plan:${k.planId}:${String(k.dayIndex)}` : `other:${k.splitDayId ?? '-'}`;
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
