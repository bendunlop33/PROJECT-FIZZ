import type {
  CheckIn,
  CheckInHistoryEntry,
  CheckInOutcome,
  CheckInReason,
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
import { toMs } from './time';

/**
 * Pre-workout check-in rules (check-in.md). Pure and deterministic. The
 * check-in is what Ben said: nothing here turns it into a score, and the
 * built-in progression rules never read it (check 19).
 */

/** check-in.md §2.8 defaults (open-decisions "Defaults", approved bulk defaults). */
export const DEFAULT_CHECK_IN_SETTINGS: CheckInSettings = {
  enabled: true,
  schedule: { kind: 'every_workout' },
  askReasonsAtOrBelow: 3,
  offerAtOrBelow: 2,
  offerOnTiredOrPoorSleep: true,
};

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
  | { kind: 'skip'; reason: 'off' | 'not_a_check_in_day' | 'already_decided' | 'set_logged' };

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
  if (settings.schedule.kind === 'days' && !settings.schedule.weekdays.includes(input.weekday)) {
    return { kind: 'skip', reason: 'not_a_check_in_day' };
  }
  return { kind: 'ask' };
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

export type CheckInOffer =
  | { kind: 'offer'; triggerId: string; fact: string }
  /** A route exists but can't answer (CI7). */
  | { kind: 'offline_line'; text: string }
  | null;

/**
 * `evaluateCheckInOffer` (check-in.md §4.4). Coach not connected → nothing
 * (CI7: a permanent "not connected" line would nag). Never calls a model.
 */
export function evaluateCheckInOffer(input: {
  checkIn: Pick<CheckIn, 'id' | 'score' | 'reasons'>;
  settings: CheckInSettings;
  coach: CoachReachability;
  anySetLogged: boolean;
  hasPendingWorkingSet: boolean;
}): CheckInOffer {
  const { checkIn, settings } = input;
  const lowScore = settings.offerAtOrBelow !== null && checkIn.score <= settings.offerAtOrBelow;
  const tired = settings.offerOnTiredOrPoorSleep && (checkIn.reasons.includes('tired') || checkIn.reasons.includes('poor_sleep'));
  if (!(lowScore || tired) || input.anySetLogged || !input.hasPendingWorkingSet) return null;
  switch (input.coach) {
    case 'not_connected':
      return null;
    case 'offline':
      return { kind: 'offline_line', text: 'Check-in saved. Coach offline, so today’s plan is unchanged.' };
    case 'available':
      return { kind: 'offer', triggerId: `check_in_low:${checkIn.id}`, fact: checkInFact(checkIn) };
  }
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
  if (flag.status === 'cleared') return flag;
  return { ...flag, status: 'cleared', clearedAtUtc: at.utc, updatedAtUtc: at.utc, version: flag.version + 1 };
}

/** `PainStatus` for `calculateNextTargets`: active if any flag on this exercise is active. */
export function painStatusFor(flags: readonly PainFlag[], exerciseId: string): PainStatus {
  const active = flags
    .filter((f) => f.exerciseId === exerciseId && f.status === 'active')
    .sort((a, b) => toMs(a.reportedAt.utc) - toMs(b.reportedAt.utc));
  const first = active[0];
  return first ? { active: true, reportedAtUtc: first.reportedAt.utc } : { active: false, reportedAtUtc: null };
}
