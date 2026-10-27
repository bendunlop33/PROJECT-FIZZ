import type { LoadConvention, SessionAggregate, SessionCommand, SetSide, SetValues, WeightUnit, WorkoutSet, ZonedTimestamp } from '@fizz/schemas';

import { valuesText } from '../display';
import { deriveId, stableStringify } from '../stable';
import { toIso, toMs } from '../time';
import type { CarryOptions } from './carry';
import { equipmentOfRow } from './equipment-snapshot';
import { blockSets } from './gym-switch';
import type { LastComparableLookup } from './last-time';
import { logSetValues, missingLogValue, shownSetValues } from './log-values';
import { setSteps } from './order';
import { latestCommittedSetId } from './reducer';
import { STALE_SESSION_MS } from './recovery';
import { isPastLog } from './time-shift';
import { prefillDraft } from './view';

/**
 * `Log` on the Lock Screen Live Activity (Ben, 27 Oct 2026, like Hevy;
 * lock-screen-and-alerts §2.1, §4.2; reverses P-L4b). Pure.
 *
 * In the Ready state (no rest running, or a rest that has run out) the
 * activity shows `Log 80 kg × 8`: the current set's values exactly as the
 * in-app `Log` would save them (Ben's saved draft, else the target, with the
 * carry), from the same helpers (`log-values.ts`). The button's target string
 * carries the workout, the set, the set's version and those values, so:
 * - what is logged is what was shown, never values worked out later;
 * - the operation ID is fixed per (set, version): a double tap, a retry after
 *   a relaunch, or the event and the queue both delivering it log once (rule 5);
 * - a tap on an older picture of the set (logged or edited in the app, Undo,
 *   a coach change since) is refused (`expectedSetVersion`, and the draft key:
 *   saving a draft doesn't move the set's version), never applied to newer
 *   state (rule 5).
 * It is the same `log_set` command as the in-app button, so the rest for the
 * next set starts (deadline, notification, Live Activity) as it would in the app.
 *
 * No `Log` where the values need Ben's input or can't be known here: timed,
 * distance and cardio sets; a missing value; a warm-up with no saved draft
 * (its load comes from the warm-up planner's catalogue facts); a set whose
 * values would come from history not read yet.
 */

/** First field of every Lock Screen Log target. */
export const LOCK_SCREEN_LOG_PREFIX = 'fizz.log';

/** Every Lock Screen log's operation ID starts with this, so the app can tell them apart (`Set 3 logged from Lock Screen`). */
export const LOCK_SCREEN_LOG_OP_PREFIX = 'lock:log:';

/**
 * A queued Log older than this is dropped. Logs are applied late on purpose
 * (a tap that launched a killed app may only be read at the next open), and
 * the set-version check refuses one the workout has moved past; this only
 * bounds it to a workout still worth resuming (`STALE_SESSION_MS`).
 */
export const LOCK_SCREEN_LOG_MAX_AGE_MS = STALE_SESSION_MS;

/** The `… logged from Lock Screen · Undo` toast is offered for this long after the log. */
export const LOCK_SCREEN_LOG_NOTICE_MS = 15 * 60_000;

/** What `Log` on the Lock Screen saves, and its button text. */
export interface LockScreenLog {
  sessionId: string;
  setId: string;
  /** The set's version the values were drawn for. */
  setVersion: number;
  /** The set's saved draft and side when drawn (`lockScreenDraftKey`): a draft saved since makes the tap stale. */
  draftKey: string;
  values: SetValues;
  /** `log_set.side` to send (a unilateral set whose side may change); null = none. */
  side: SetSide | null;
  /** `Log 80 kg × 8` (as the in-app button). */
  label: string;
  /** VoiceOver: `Log 80 kilograms, 8 reps`. */
  a11y: string;
}

/** A Log tap read back from its target. */
export interface LockScreenLogTap {
  sessionId: string;
  setId: string;
  setVersion: number;
  draftKey: string;
  values: SetValues;
  side: SetSide | null;
}

const CONVENTIONS: readonly LoadConvention[] = ['total', 'per_hand', 'stack', 'added', 'assistance', 'bodyweight'];
const UNITS: readonly WeightUnit[] = ['kg', 'lb'];
const SIDES: readonly SetSide[] = ['both', 'left', 'right'];

function words(label: string): string {
  return label
    .replaceAll(' ', ' ')
    .replace(/\s*×\s*(\d+)/g, ', $1 reps')
    .replace(/\bkg\b/g, 'kilograms')
    .replace(/\blb\b/g, 'pounds');
}

/**
 * The Lock Screen `Log` for `setId` (the set the Ready state shows), or null
 * when that set can't be logged from the Lock Screen. `opts`: the same carry
 * and history lookup the Live Activity's text uses.
 */
export function lockScreenLogOf(state: SessionAggregate, setId: string | null, opts: CarryOptions & { lastComparable?: LastComparableLookup } = {}): LockScreenLog | null {
  if (setId === null || state.session.status !== 'active' || state.session.pause !== null || isPastLog(state.session)) return null;
  const set = state.sets.find((s) => s.id === setId);
  if (set?.status !== 'pending') return null;
  const ex = state.exercises.find((e) => e.id === set.sessionExerciseId);
  // Timed, distance and cardio sets need Ben's input (a time, a distance): open the app.
  if (ex?.measurement !== 'reps') return null;
  // A warm-up's load without a saved draft comes from the warm-up planner (catalogue facts not here).
  if (set.setType === 'warmup' && set.draft === null) return null;
  const wi = state.workInterval;
  if (wi !== null && wi.setId === set.id && (wi.status === 'running' || wi.status === 'paused')) return null;
  const history = opts.lastComparable?.(ex.id);
  // Values that could come from last time wait until it is read (the text is redrawn when it arrives).
  const p = set.planned;
  if (history === undefined && set.draft === null && (p.reps === null || (p.load === null && ex.loadConvention !== 'bodyweight'))) return null;
  const pre = prefillDraft(state, set.id, history ?? [], { painFlagged: opts.painFlagged, warmup: opts.warmup });
  const values = shownSetValues(ex, pre.values, set.setType === 'warmup' ? null : set.draft);
  if (missingLogValue(values, ex) !== null) return null;
  const logValues = logSetValues(ex, values);
  // Only load, reps and effort travel in the target.
  if (logValues.load === null || logValues.reps === null || logValues.durationS !== null || (logValues.distanceM !== undefined && logValues.distanceM !== null)) return null;
  const unilateral = ex.laterality === 'unilateral';
  const fixedSide = set.pairedWithSetId !== null && (set.side === 'left' || set.side === 'right') ? set.side : null;
  const chosenSide: SetSide | null = unilateral ? (fixedSide ?? set.side ?? 'both') : null;
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  const label = `Log ${valuesText(logValues, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq, side: chosenSide })}`;
  return {
    sessionId: state.session.id,
    setId: set.id,
    setVersion: set.version,
    draftKey: lockScreenDraftKey(set),
    values: logValues,
    side: unilateral && fixedSide === null ? (chosenSide ?? 'both') : null,
    label,
    a11y: words(label),
  };
}

/**
 * A short fingerprint of the set's saved draft and side. Saving a draft (or
 * the side) doesn't change the set's version, so this is how a Log drawn
 * before Ben edited the set in the app is told apart. 8 base-36 characters.
 */
export function lockScreenDraftKey(set: Pick<WorkoutSet, 'draft' | 'side'>): string {
  const text = stableStringify([set.draft ?? null, set.side ?? null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

const num = (n: number | null): string => (n === null ? '-' : String(n));

/** `fizz.log|<session>|<set>|<version>|<draftKey>|<load>|<unit>|<convention>|<reps>|<side>|<rpe>|<rir>` ('-' = none). */
export function lockScreenLogTarget(log: Pick<LockScreenLog, 'sessionId' | 'setId' | 'setVersion' | 'draftKey' | 'values' | 'side'>): string {
  const l = log.values.load;
  return [
    LOCK_SCREEN_LOG_PREFIX,
    log.sessionId,
    log.setId,
    String(log.setVersion),
    log.draftKey,
    l === null ? '-' : String(l.value),
    l === null ? '-' : l.unit,
    l === null ? '-' : l.convention,
    num(log.values.reps),
    log.side ?? '-',
    num(log.values.rpe),
    num(log.values.rir),
  ].join('|');
}

const DECIMAL = /^\d{1,4}(\.\d{1,3})?$/;
const INT = /^\d{1,4}$/;

function parseNum(s: string, re: RegExp): number | null | undefined {
  if (s === '-') return null;
  return re.test(s) ? Number(s) : undefined;
}

/** A button target back into a Log tap; null for anything else (a rest button, another widget, a malformed string). */
export function parseLockScreenLog(target: unknown): LockScreenLogTap | null {
  if (typeof target !== 'string' || target.length > 400) return null;
  const parts = target.split('|');
  if (parts.length !== 12) return null;
  const [prefix, sessionId, setId, version, draftKey, loadValue, unit, convention, reps, side, rpe, rir] = parts as [string, string, string, string, string, string, string, string, string, string, string, string];
  if (prefix !== LOCK_SCREEN_LOG_PREFIX || sessionId === '' || setId === '') return null;
  if (!/^[1-9]\d{0,8}$/.test(version) || !/^[0-9a-z]{7,8}$/.test(draftKey)) return null;
  let load: SetValues['load'] = null;
  if (loadValue !== '-' || unit !== '-' || convention !== '-') {
    const v = parseNum(loadValue, DECIMAL);
    if (v === undefined || v === null || !(UNITS as readonly string[]).includes(unit) || !(CONVENTIONS as readonly string[]).includes(convention)) return null;
    load = { value: v, unit: unit as WeightUnit, convention: convention as LoadConvention };
  }
  const r = parseNum(reps, INT);
  const e = parseNum(rpe, DECIMAL);
  const i = parseNum(rir, INT);
  if (r === undefined || e === undefined || i === undefined) return null;
  if (side !== '-' && !(SIDES as readonly string[]).includes(side)) return null;
  return {
    sessionId,
    setId,
    setVersion: Number(version),
    draftKey,
    values: { load, reps: r, durationS: null, rpe: e, rir: i },
    side: side === '-' ? null : (side as SetSide),
  };
}

/** Deterministic per (set, version): the same Log delivered twice is one write. */
export function lockScreenLogOpId(tap: Pick<LockScreenLogTap, 'setId' | 'setVersion'>): string {
  return `${LOCK_SCREEN_LOG_OP_PREFIX}${tap.setId}:${String(tap.setVersion)}`;
}

export type LockScreenLogIgnored = 'too_old' | 'no_workout' | 'other_workout' | 'paused' | 'already_logged' | 'stale' | 'not_loggable';

export type LockScreenLogDecision = { kind: 'dispatch'; command: Extract<SessionCommand, { type: 'log_set' }> } | { kind: 'ignore'; reason: LockScreenLogIgnored };

/**
 * What a Log tap does to the workout in progress, read at `at`. Applied only
 * to the set it was drawn for, still pending at the same version; anything
 * else is ignored (and the activity redrawn from the truth). The reducer
 * checks the version again (`expectedSetVersion`), so a change between this
 * read and the write is refused there too.
 *
 * The set is logged at the moment of the tap (`tappedAtMs`, kept within the
 * workout's last activity and now), so a tap read late (the app was killed)
 * records the true time and its rest runs from then, as if logged in the app.
 */
export function lockScreenLogCommand(state: SessionAggregate | null, tap: LockScreenLogTap, at: ZonedTimestamp, tappedAtMs: number): LockScreenLogDecision {
  const nowMs = toMs(at.utc);
  if (nowMs - tappedAtMs > LOCK_SCREEN_LOG_MAX_AGE_MS) return { kind: 'ignore', reason: 'too_old' };
  if (state === null || state.session.status !== 'active') return { kind: 'ignore', reason: 'no_workout' };
  if (state.session.id !== tap.sessionId) return { kind: 'ignore', reason: 'other_workout' };
  if (state.session.pause !== null) return { kind: 'ignore', reason: 'paused' };
  const set = state.sets.find((s) => s.id === tap.setId);
  if (set === undefined) return { kind: 'ignore', reason: 'stale' };
  if (set.status === 'completed') return { kind: 'ignore', reason: 'already_logged' };
  if (set.status !== 'pending' || set.version !== tap.setVersion || lockScreenDraftKey(set) !== tap.draftKey) return { kind: 'ignore', reason: 'stale' };
  const ex = state.exercises.find((e) => e.id === set.sessionExerciseId);
  if (ex?.measurement !== 'reps' || isPastLog(state.session)) return { kind: 'ignore', reason: 'not_loggable' };
  const floor = Math.max(toMs(state.session.lastActivityAtUtc), toMs(state.session.startedAt.utc));
  const atMs = Math.min(nowMs, Math.max(floor, tappedAtMs));
  const opId = lockScreenLogOpId(tap);
  return {
    kind: 'dispatch',
    command: {
      type: 'log_set',
      at: { utc: toIso(atMs), tz: at.tz },
      opId,
      setId: set.id,
      values: tap.values,
      ...(tap.side === null ? {} : { side: tap.side }),
      restTimerId: deriveId(`lock-log-rest:${opId}`),
      expectedSetVersion: tap.setVersion,
    },
  };
}

/** `Set 3 logged from Lock Screen · Undo` on the next open (Ben, 27 Oct). */
export interface LockScreenLoggedNotice {
  /** The log's operation ID: show the toast once per log. */
  opId: string;
  setId: string;
  /** `Set 3` / `Warm-up`. */
  stepName: string;
  /** `Set 3 logged from Lock Screen`. */
  text: string;
  /** The same Undo the in-app toast sends (`undo:<set>:<undoCount>`), versioned at send time. */
  undoOpId: string;
}

/**
 * The toast for a set logged from the Lock Screen: the workout's most recent
 * commit, logged by a Lock Screen tap, within `LOCK_SCREEN_LOG_NOTICE_MS`.
 * Null otherwise (a newer set logged since, so Undo would be refused; an
 * in-app log; a finished workout).
 */
export function lockScreenLoggedNotice(state: SessionAggregate | null, nowMs: number): LockScreenLoggedNotice | null {
  if (state === null || state.session.status !== 'active') return null;
  const setId = latestCommittedSetId(state);
  const set = setId === null ? undefined : state.sets.find((s) => s.id === setId);
  const opId = set?.completedByOpId;
  if (set === undefined || typeof opId !== 'string' || !opId.startsWith(LOCK_SCREEN_LOG_OP_PREFIX) || set.completedAt === null) return null;
  if (nowMs - toMs(set.completedAt.utc) > LOCK_SCREEN_LOG_NOTICE_MS) return null;
  const stepName = setSteps(blockSets(state, set.sessionExerciseId)).get(set.id)?.name ?? 'Set';
  return { opId, setId: set.id, stepName, text: `${stepName} logged from Lock Screen`, undoOpId: `undo:${set.id}:${String(set.undoCount)}` };
}
