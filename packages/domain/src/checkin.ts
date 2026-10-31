import type {
  CheckIn,
  CheckInHistoryEntry,
  CheckInOutcome,
  CheckInReason,
  CheckInSchedule,
  CheckInScore,
  CheckInSettings,
  PainArea,
  PainFlag,
  SessionAggregate,
  SessionCheckIn,
  Weekday,
  ZonedTimestamp,
} from '@fizz/schemas';
import { CHECK_IN_NOTE_MAX } from '@fizz/schemas';
import type { PainStatus } from './progression';
import { weekdayShort } from './morning-reminder';
import { toMs } from './time';

/**
 * Pre-workout check-in rules (check-in.md). Pure and deterministic. The
 * check-in is what Ben said: nothing here turns it into a score, and the
 * built-in progression rules never read it (check 19).
 */

/**
 * check-in.md §2.8 defaults (open-decisions "Defaults", approved bulk defaults). (Ben, 23 Oct) The
 * schedule's default is `when_i_choose`: Start never asks; the check-in is one quiet tap away in the
 * workout until the first working set is logged.
 */
export const DEFAULT_CHECK_IN_SETTINGS: CheckInSettings = {
  enabled: true,
  schedule: { kind: 'when_i_choose' },
  askReasonsAtOrBelow: 3,
  offerAtOrBelow: 2,
  offerOnTiredOrPoorSleep: true,
};

/** Monday first, as the settings' day chips. */
export const CHECK_IN_WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * (Ben, 26 Oct) The settings Start uses: Ben's saved schedule (Profile › Training › Check-in) on the defaults.
 * The thresholds have no screen yet and stay at `DEFAULT_CHECK_IN_SETTINGS`.
 */
export function checkInSettingsFor(profile: { checkInSchedule?: CheckInSchedule | undefined } | null): CheckInSettings {
  const schedule = profile?.checkInSchedule;
  return schedule === undefined ? DEFAULT_CHECK_IN_SETTINGS : { ...DEFAULT_CHECK_IN_SETTINGS, schedule };
}

/**
 * (Ben, 26 Oct) An Empty workout never asks on Start, whatever the schedule: there is nothing planned for the
 * answer to change. A check-in he already gave still links (reuse), and the workout's own `How are you
 * feeling?` is still offered until the first working set (recorded as `when_i_choose`).
 */
export function emptyWorkoutGate(gate: CheckInGate): CheckInGate {
  return gate.kind === 'ask' ? { kind: 'skip', reason: 'when_i_choose' } : gate;
}

/** Profile › Training › Check-in (Ben, 26 Oct): the words, values only. */
export const CHECK_IN_SETTINGS_COPY = {
  title: 'Check-in',
  whenChoose: 'Only when I choose',
  every: 'Every workout',
  days: 'On these days',
} as const;

/** The Profile row's value: `Only when I choose`, `Every workout`, `Mon, Wed, Fri`. */
export function checkInScheduleLine(schedule: CheckInSchedule): string {
  if (schedule.kind === 'when_i_choose') return CHECK_IN_SETTINGS_COPY.whenChoose;
  if (schedule.kind === 'every_workout') return CHECK_IN_SETTINGS_COPY.every;
  return CHECK_IN_WEEKDAYS.filter((d) => schedule.weekdays.includes(d))
    .map(weekdayShort)
    .join(', ');
}

/** `On these days`: picking it starts from the days chosen before, else today's weekday (never an empty list). */
export function checkInDaysPick(current: CheckInSchedule, today: Weekday, lastDays: readonly Weekday[] | null): CheckInSchedule {
  if (current.kind === 'days') return current;
  return { kind: 'days', weekdays: lastDays !== null && lastDays.length > 0 ? CHECK_IN_WEEKDAYS.filter((d) => lastDays.includes(d)) : [today] };
}

/** A day chip toggles that day; the last day can't be turned off (null: nothing to write). */
export function checkInDayToggle(current: CheckInSchedule, day: Weekday): CheckInSchedule | null {
  if (current.kind !== 'days') return { kind: 'days', weekdays: [day] };
  const on = current.weekdays.includes(day);
  const next = CHECK_IN_WEEKDAYS.filter((d) => (d === day ? !on : current.weekdays.includes(d)));
  return next.length === 0 ? null : { kind: 'days', weekdays: next };
}

/** `timing.checkInReuse`: an unlinked check-in is reused by the next Start within this window. */
export const CHECK_IN_REUSE_MS = 2 * 60 * 60 * 1000;

export const CHECK_IN_REASONS: readonly CheckInReason[] = ['tired', 'poor_sleep', 'sore_training', 'stressed', 'ill', 'pain', 'other'];

/** Chip labels (check-in.md §5.1). */
export const CHECK_IN_REASON_LABEL: Record<CheckInReason, string> = {
  tired: 'Tired',
  poor_sleep: 'Poor sleep',
  sore_training: 'Sore (from training)',
  stressed: 'Stressed',
  ill: 'Feeling ill',
  pain: 'Pain',
  other: 'Other',
};

export const PAIN_AREAS: readonly PainArea[] = ['shoulder', 'elbow', 'wrist', 'neck', 'back', 'hip', 'knee', 'ankle', 'other'];
export const PAIN_AREA_LABEL: Record<PainArea, string> = {
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist: 'Wrist',
  neck: 'Neck',
  back: 'Back',
  hip: 'Hip',
  knee: 'Knee',
  ankle: 'Ankle',
  other: 'Other',
};

export type CheckInGate =
  | { kind: 'ask' }
  | { kind: 'reuse'; checkInId: string }
  | { kind: 'skip'; reason: 'off' | 'not_a_check_in_day' | 'when_i_choose' | 'already_decided' | 'set_logged' };

/** A recent check-in as the gate sees it. */
export interface RecentCheckIn {
  id: string;
  recordedAtUtc: string;
  outcome: CheckInOutcome;
  deleted: boolean;
  /** A workout already links to it. */
  linked: boolean;
}

export interface CheckInGateInput {
  settings: CheckInSettings;
  nowMs: number;
  /** Local weekday now (in the phone's zone). */
  weekday: Weekday;
  entry: 'start' | 'resume' | 'auto_open';
  /** Resume / auto-open only: the unfinished session. */
  session?: { checkIn: SessionCheckIn | null; anySetEverCommitted: boolean } | null;
  recent: readonly RecentCheckIn[];
}

/**
 * One gate for every way of starting (check-in.md §2.1, `shouldAskCheckIn`).
 * Never asks once a set has been committed in the session (never mid-workout),
 * and never twice for the same start.
 */
export function shouldAskCheckIn(input: CheckInGateInput): CheckInGate {
  if (input.entry !== 'start') {
    const s = input.session;
    if (!s) return { kind: 'skip', reason: 'already_decided' };
    if (s.anySetEverCommitted) return { kind: 'skip', reason: 'set_logged' };
    if (s.checkIn?.kind !== 'pending') return { kind: 'skip', reason: 'already_decided' };
  }
  const { settings } = input;
  if (!settings.enabled) return { kind: 'skip', reason: 'off' };
  if (input.entry === 'start') {
    const reusable = reusableCheckIn(input.recent, input.nowMs);
    if (reusable) return { kind: 'reuse', checkInId: reusable.id };
  }
  // (Ben, 23 Oct) Only when Ben chooses: never asked on Start or Resume. A check-in he already gave (reuse) still links.
  if (settings.schedule.kind === 'when_i_choose') return { kind: 'skip', reason: 'when_i_choose' };
  if (settings.schedule.kind === 'days' && !settings.schedule.weekdays.includes(input.weekday)) {
    return { kind: 'skip', reason: 'not_a_check_in_day' };
  }
  return { kind: 'ask' };
}

/** How a Start records the gate's `skip`: the reasons Start itself decided (nothing about Ben's state is invented). */
export function sessionCheckInForSkip(reason: Extract<CheckInGate, { kind: 'skip' }>['reason']): SessionCheckIn | null {
  return reason === 'off' || reason === 'not_a_check_in_day' || reason === 'when_i_choose' ? { kind: 'not_asked', reason } : null;
}

/** The newest unlinked, undeleted, not-acted-on check-in from the last 2 h, if any (Today's region 4 line). */
export function reusableCheckIn<T extends RecentCheckIn>(recent: readonly T[], nowMs: number): T | null {
  const candidates = recent.filter((c) => {
    const age = nowMs - toMs(c.recordedAtUtc);
    return !c.deleted && !c.linked && c.outcome === 'not_started' && age >= 0 && age < CHECK_IN_REUSE_MS;
  });
  candidates.sort((a, b) => toMs(b.recordedAtUtc) - toMs(a.recordedAtUtc));
  return candidates[0] ?? null;
}

/** Step 2 (`What's up?`) opens at or below the setting (default 3). */
export function asksReasons(score: CheckInScore, settings: CheckInSettings): boolean {
  return settings.askReasonsAtOrBelow !== null && score <= settings.askReasonsAtOrBelow;
}

/** True when any set was ever committed in the session, even if later undone or deleted (check 4). */
export function anySetEverCommitted(aggregate: SessionAggregate): boolean {
  return aggregate.audit.some((e) => e.kind === 'logged');
}

/**
 * (Ben, 23 Oct) True once a working set (not a warm-up) was ever committed in the session, even if
 * later undone or deleted. A set no longer in the workout counts as a working set (the safe side).
 * Until then the check-in is still on offer in the workout.
 */
export function anyWorkingSetEverLogged(aggregate: Pick<SessionAggregate, 'audit' | 'sets'>): boolean {
  const type = new Map(aggregate.sets.map((s) => [s.id, s.setType]));
  return aggregate.audit.some((e) => e.kind === 'logged' && type.get(e.setId) !== 'warmup');
}

/**
 * (Ben, 23 Oct) The quiet `How are you feeling?` in the workout: offered while check-ins are on, the
 * workout has no check-in answered or skipped, and no working set has been logged. Then it goes
 * (a check-in already given stays editable on the Summary).
 */
export function offersCheckInInWorkout(input: { settings: CheckInSettings; session: Pick<SessionAggregate, 'audit' | 'sets'> & { session: { status: SessionAggregate['session']['status']; checkIn: SessionCheckIn | null } } }): boolean {
  if (!input.settings.enabled) return false;
  const { session } = input;
  if (session.session.status !== 'active') return false;
  const ci = session.session.checkIn;
  if (ci?.kind === 'answered' || ci?.kind === 'skipped') return false;
  return !anyWorkingSetEverLogged(session);
}

export function scoreText(score: number): string {
  return `${score} of 5`;
}

/** Reasons as Ben picked them, in chip order (`Tired · Poor sleep`). */
export function reasonsText(reasons: readonly CheckInReason[], separator = ' · '): string {
  return CHECK_IN_REASONS.filter((r) => reasons.includes(r))
    .map((r) => CHECK_IN_REASON_LABEL[r])
    .join(separator);
}

/** The offer's fact line, built from the check-in only (`You said 2 of 5 · Tired, Poor sleep`). */
export function checkInFact(checkIn: Pick<CheckIn, 'score' | 'reasons'>): string {
  const reasons = reasonsText(checkIn.reasons, ', ');
  return `You said ${scoreText(checkIn.score)}${reasons === '' ? '' : ` · ${reasons}`}`;
}

/** Pain picked but no movement flagged (CI8): the summary asks Ben to choose movements. */
export function painMentionedNotFlagged(checkIn: Pick<CheckIn, 'reasons' | 'painFlagIds'>): boolean {
  return checkIn.reasons.includes('pain') && checkIn.painFlagIds.length === 0;
}

export type CoachReachability = 'not_connected' | 'offline' | 'available';

/**
 * The lighter-session offer after a low check-in. `coach`: the coach can
 * answer, and `Adjust` asks it. `rule` (Ben, 23 Oct): it can't (not connected
 * or offline), so the built-in lighter session is offered instead, with
 * Apply / Skip and Undo; offline is no longer a dead `Coach offline` line.
 */
export type CheckInOffer = { kind: 'offer'; by: 'coach' | 'rule'; triggerId: string; fact: string } | null;

/**
 * `evaluateCheckInOffer` (check-in.md §4.4, revised 23 Oct). Never calls a
 * model. Only before the first working set is logged and while a working
 * set is still pending.
 */
export function evaluateCheckInOffer(input: {
  checkIn: Pick<CheckIn, 'id' | 'score' | 'reasons'>;
  settings: CheckInSettings;
  coach: CoachReachability;
  /** A working set (not a warm-up) was ever logged in this workout. */
  anyWorkingSetLogged: boolean;
  hasPendingWorkingSet: boolean;
}): CheckInOffer {
  const { checkIn, settings } = input;
  if (!checkInAsksForLighter(checkIn, settings) || input.anyWorkingSetLogged || !input.hasPendingWorkingSet) return null;
  return { kind: 'offer', by: input.coach === 'available' ? 'coach' : 'rule', triggerId: `check_in_low:${checkIn.id}`, fact: checkInFact(checkIn) };
}

/** A score at or below the offer setting, or `Tired` / `Poor sleep` when that setting is on. */
export function checkInAsksForLighter(checkIn: Pick<CheckIn, 'score' | 'reasons'>, settings: CheckInSettings): boolean {
  const lowScore = settings.offerAtOrBelow !== null && checkIn.score <= settings.offerAtOrBelow;
  const tired = settings.offerOnTiredOrPoorSleep && (checkIn.reasons.includes('tired') || checkIn.reasons.includes('poor_sleep'));
  return lowScore || tired;
}

export function normaliseNote(note: string | null | undefined): string | undefined {
  if (note === null || note === undefined) return undefined;
  const t = note.trim();
  return t === '' ? undefined : t.slice(0, CHECK_IN_NOTE_MAX);
}

export interface NewCheckInInput {
  id: string;
  ownerId: string;
  opId: string;
  score: CheckInScore;
  reasons?: readonly CheckInReason[];
  note?: string | null;
  at: ZonedTimestamp;
  localDate: string;
}

/** `recordCheckIn`: written at the first score tap (CI4). */
export function newCheckIn(input: NewCheckInInput): CheckIn {
  const note = normaliseNote(input.note);
  return {
    id: input.id,
    ownerId: input.ownerId,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    score: input.score,
    reasons: CHECK_IN_REASONS.filter((r) => input.reasons?.includes(r) ?? false),
    ...(note === undefined ? {} : { note }),
    scale: { version: 1, low: 'rough', high: 'great' },
    recordedAt: input.at,
    localDate: input.localDate,
    input: { kind: 'tap' },
    outcome: 'not_started',
    painFlagIds: [],
    createdByOpId: input.opId,
    appliedOps: [],
    history: [],
  };
}

export interface CheckInPatch {
  score?: CheckInScore;
  reasons?: readonly CheckInReason[];
  /** null clears the note. */
  note?: string | null;
  painFlagIds?: readonly string[];
  outcome?: CheckInOutcome;
}

export type CheckInPatchResult = { kind: 'duplicate' } | { kind: 'unchanged' } | { kind: 'updated'; checkIn: CheckIn };

const MAX_APPLIED_OPS = 50;

/**
 * `updateCheckIn` / `setCheckInOutcome`: versioned and audited (CI13). A
 * retried opId is a duplicate. The version check is the caller's (it compares
 * the stored version with the one Ben saw). Changing a check-in never changes
 * sets, adjustments, pain flags or next-time targets.
 */
export function applyCheckInPatch(current: CheckIn, patch: CheckInPatch, opId: string, at: ZonedTimestamp): CheckInPatchResult {
  if (current.createdByOpId === opId || current.appliedOps.includes(opId)) return { kind: 'duplicate' };
  const history: CheckInHistoryEntry[] = [];
  const next: CheckIn = { ...current };
  if (patch.score !== undefined && patch.score !== current.score) {
    history.push({ atUtc: at.utc, opId, field: 'score', from: current.score, to: patch.score });
    next.score = patch.score;
  }
  if (patch.reasons !== undefined) {
    const reasons = CHECK_IN_REASONS.filter((r) => patch.reasons?.includes(r) ?? false);
    if (reasons.join() !== current.reasons.join()) {
      history.push({ atUtc: at.utc, opId, field: 'reasons', from: [...current.reasons], to: [...reasons] });
      next.reasons = reasons;
    }
  }
  if (patch.note !== undefined) {
    const note = normaliseNote(patch.note);
    if (note !== current.note) {
      history.push({ atUtc: at.utc, opId, field: 'note', from: current.note ?? null, to: note ?? null });
      if (note === undefined) delete next.note;
      else next.note = note;
    }
  }
  if (patch.painFlagIds !== undefined) {
    const ids = [...new Set([...current.painFlagIds, ...patch.painFlagIds])];
    if (ids.length !== current.painFlagIds.length) {
      history.push({ atUtc: at.utc, opId, field: 'painFlagIds', from: [...current.painFlagIds], to: ids });
      next.painFlagIds = ids;
    }
  }
  if (patch.outcome !== undefined && patch.outcome !== current.outcome) {
    history.push({ atUtc: at.utc, opId, field: 'outcome', from: current.outcome, to: patch.outcome });
    next.outcome = patch.outcome;
  }
  if (history.length === 0) return { kind: 'unchanged' };
  return {
    kind: 'updated',
    checkIn: {
      ...next,
      version: current.version + 1,
      updatedAtUtc: at.utc,
      appliedOps: [...current.appliedOps, opId].slice(-MAX_APPLIED_OPS),
      history: [...current.history, ...history].slice(-200),
    },
  };
}

// ---------------------------------------------------------------------------
// Pain flags (rule 9)

export interface NewPainFlagInput {
  id: string;
  ownerId: string;
  opId: string;
  exerciseId: string;
  exerciseName: string;
  area: PainArea | null;
  source: PainFlag['source'];
  checkInId: string | null;
  at: ZonedTimestamp;
}

export function newPainFlag(input: NewPainFlagInput): PainFlag {
  return {
    id: input.id,
    ownerId: input.ownerId,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseName,
    area: input.area,
    source: input.source,
    checkInId: input.checkInId,
    reportedAt: input.at,
    status: 'active',
    clearedAtUtc: null,
    createdByOpId: input.opId,
  };
}

/** Only Ben clears a flag (CM4); never cleared automatically. */
export function clearPainFlag(flag: PainFlag, at: ZonedTimestamp): PainFlag {
  if (flag.status !== 'active') return flag;
  return { ...flag, status: 'cleared', clearedAtUtc: at.utc, updatedAtUtc: at.utc, version: flag.version + 1 };
}

/**
 * Undo of a flag Ben just set (the `Pain noted` toast, the exclusion toast
 * after ticking `Pain`; review B2): a retraction, not a clear. The flag
 * reads as if it never existed: no 8-week `Before flag` reference, no
 * cleared-flag history, no return-to-load guard. Only an active flag can be
 * retracted; the result is a new version, kept for the audit.
 */
export function retractPainFlag(flag: PainFlag, at: ZonedTimestamp, opId: string): PainFlag {
  if (flag.status !== 'active') return flag;
  return { ...flag, status: 'retracted', clearedAtUtc: null, retracted: { atUtc: at.utc, opId }, updatedAtUtc: at.utc, version: flag.version + 1 };
}

/**
 * Undo of `clearPainFlag` (the Summary's `Pain flag cleared` toast, review
 * S4): the flag is active again, as a new version, never an edit in place.
 * A retracted flag stays retracted.
 */
export function restorePainFlag(flag: PainFlag, at: ZonedTimestamp): PainFlag {
  if (flag.status !== 'cleared') return flag;
  return { ...flag, status: 'active', clearedAtUtc: null, updatedAtUtc: at.utc, version: flag.version + 1 };
}

/** `PainStatus` for `calculateNextTargets`: active if any flag on this exercise is active. */
export function painStatusFor(flags: readonly PainFlag[], exerciseId: string): PainStatus {
  const active = flags
    .filter((f) => f.exerciseId === exerciseId && f.status === 'active')
    .sort((a, b) => toMs(a.reportedAt.utc) - toMs(b.reportedAt.utc));
  const first = active[0];
  return first ? { active: true, reportedAtUtc: first.reportedAt.utc } : { active: false, reportedAtUtc: null };
}
