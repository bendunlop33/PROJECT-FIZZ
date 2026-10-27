import type { SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';
import { clockText } from '../calendar';
import { formatDuration, NBSP } from '../display';
import { toMs } from '../time';
import { equipmentOfRow } from './equipment-snapshot';
import { blockSets, partRootOf } from './gym-switch';
import { shownTargetShortIn, type CarryOptions } from './carry';
import { STALE_SESSION_MS } from './recovery';
import { getSessionPhase } from './view';
import { isPastLog } from './time-shift';
import { lastTimeOfSet, type LastComparableLookup } from './last-time';

/**
 * What the Lock Screen Live Activity shows for the workout in progress
 * (lock-screen-and-alerts.md §2.1, §5; rest-state.md §4.7). Pure: built from
 * committed values only, so the text is true without the app running. The
 * countdown is a pair of instants the system renders itself; nothing here
 * ticks. One activity per workout: Ready, Resting, Working or Paused.
 */

export type LockScreenState = 'ready' | 'resting' | 'working' | 'paused';

export interface LockScreenContent {
  sessionId: string;
  state: LockScreenState;
  /** `Rest` · `Ready · Push A` · `Work · Plank` · `Paused · Push A`. */
  title: string;
  /** `Until 18:42 · Bench press · Set 3 of 4 next`; '' when none. */
  line1: string;
  /** `Target 100 kg × 6–8` (Ben's own draft: `Your edit 105 kg × 6–8`); '' when none. */
  line2: string;
  /** (Ben, 26 Oct) The next set last time: `Last 100 kg × 7`; '' when there's no like-for-like set (or history isn't read yet). */
  line3: string;
  /**
   * The running rest the Lock Screen's −15 s / +15 s / Skip act on (Ben, 26 Oct),
   * with the timer version the buttons were drawn for, so a tap on an older
   * picture is refused (rule 5); null when no rest is running.
   */
  rest: { timerId: string; timerVersion: number } | null;
  /** The system-rendered countdown (epoch ms); null when nothing counts. */
  countdown: { startMs: number; endMs: number } | null;
  /** Static short text for the compact Dynamic Island when nothing counts: `Set 3`, `1:10`; '' when none. */
  side: string;
  /** VoiceOver: units in full and the word "target" (§5). */
  a11y: string;
  /** After this the system may de-emphasise it (the countdown's end); null = never. */
  staleAtMs: number | null;
  /**
   * (Ben, 27 Oct) While resting: the Ready content for the moment the rest
   * runs out, written now. The widget shows it once the activity goes stale
   * (`staleAtMs` = the rest's end), so the Lock Screen turns to the next set
   * with GymSmarter suspended (no push, ADR 0004). It is exactly what the
   * app itself writes at that moment, so the app's own update changes
   * nothing visible. Null in every other state, or when nothing would show.
   */
  afterRest: LockScreenAfterRest | null;
}

/** The text of the Ready state shown after a rest (`LockScreenContent.afterRest`). */
export type LockScreenAfterRest = Pick<LockScreenContent, 'title' | 'line1' | 'line2' | 'line3' | 'side' | 'a11y'>;

const TITLE_FALLBACK = 'Workout';

/** Options: the carry's pain flags, and the last comparable sets per exercise row for `Last …` (Ben, 26 Oct). */
export type LockScreenOptions = CarryOptions & { lastComparable?: LastComparableLookup };


interface NextSet {
  set: WorkoutSet;
  ex: SessionExercise;
  number: number;
  of: number;
  target: string | null;
}

function nextSetOf(state: SessionAggregate, setId: string | null, carry: CarryOptions): NextSet | null {
  if (setId === null) return null;
  const set = state.sets.find((s) => s.id === setId);
  const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !ex) return null;
  // The whole block (every gym part), so numbering matches the in-app header (review ben-bugs N4).
  const own = blockSets(state, ex.id);
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  // Ben's own draft values over the target, as the table shows them (B2, 21 Oct): `Your edit 105 kg × 6–8`.
  // A load carried from his last logged set reads the same (21 Oct).
  const target = shownTargetShortIn(state, set, ex, { convention: ex.loadConvention, equipment: eq }, carry);
  const perSide = target !== null && ex.laterality === 'unilateral' && set.planned.reps !== null ? `${NBSP}per side` : '';
  return { set, ex, number: own.indexOf(set) + 1, of: own.length, target: target === null ? null : `${target}${perSide}` };
}

/** `100 kg × 6–8` read aloud: `100 kilograms, 6 to 8 reps`. */
function valueWords(text: string): string {
  return text
    .replaceAll(NBSP, ' ')
    .replace(/\s*×\s*(\d+)(?:–(\d+))?/g, (_m, a: string, b: string | undefined) => (b === undefined ? `, ${a} reps` : `, ${a} to ${b} reps`))
    .replace(/(\d+)–(\d+)/g, '$1 to $2')
    .replace(/\bkg\b/g, 'kilograms')
    .replace(/\blb\b/g, 'pounds');
}

/** `Target 100 kg × 6–8` read aloud: `target 100 kilograms, 6 to 8 reps` (`Your edit …`: `your edit …`). */
export function lockScreenTargetWords(target: string): string {
  const plain = target.replaceAll(NBSP, ' ');
  const [word, rest] = plain.startsWith('Coach target ')
    ? ['coach target', plain.slice('Coach target '.length)]
    : plain.startsWith('Your edit ')
      ? ['your edit', plain.slice('Your edit '.length)]
      : ['target', plain.replace(/^Target /, '')];
  return `${word} ${valueWords(rest)}`;
}

/** `Last 100 kg × 7` read aloud: ` Last time 100 kilograms, 7 reps.`; '' for none. */
function lastWords(line3: string): string {
  return line3 === '' ? '' : ` Last time ${valueWords(line3.replace(/^Last /, ''))}.`;
}

/** `Last 100 kg × 7` for the next set; '' when none. */
function lastLine(state: SessionAggregate, setId: string | null, opts: LockScreenOptions): string {
  if (setId === null || opts.lastComparable === undefined) return '';
  const set = state.sets.find((s) => s.id === setId);
  if (!set) return '';
  const last = lastTimeOfSet(state, setId, opts.lastComparable(set.sessionExerciseId));
  return last === null ? '' : `Last ${last.text}`;
}

/**
 * The Ready text at the rest's end, as `buildLockScreenContent` will give it
 * then (the same committed state, read at `endMs`); null when nothing would
 * be Ready (a stale or finished workout).
 */
function afterRestOf(state: SessionAggregate, endMs: number, tz: string, carry: LockScreenOptions): LockScreenAfterRest | null {
  const c = buildLockScreenContent(state, endMs, tz, carry);
  if (c?.state !== 'ready') return null;
  return { title: c.title, line1: c.line1, line2: c.line2, line3: c.line3, side: c.side, a11y: c.a11y };
}

/**
 * The content for `state` at `nowMs`, with clock times in `tz`; null when no
 * activity should show (no workout, finished or discarded, a past log, or stale: ≥ 6 h
 * since the last activity, flow §4.2). `carry.painFlagged`: movements with
 * an active pain flag, so a heavier load never carries onto the next set.
 */
export function buildLockScreenContent(state: SessionAggregate | null, nowMs: number, tz: string, carry: LockScreenOptions = {}): LockScreenContent | null {
  if (state === null || state.session.status !== 'active') return null;
  // (Ben, 25 Oct) A past log runs no clock: no Live Activity.
  if (isPastLog(state.session)) return null;
  if (nowMs - toMs(state.session.lastActivityAtUtc) >= STALE_SESSION_MS) return null;
  const name = state.session.routineName ?? TITLE_FALLBACK;
  const base = { sessionId: state.session.id, line3: '', rest: null, afterRest: null };
  const phase = getSessionPhase(state, nowMs);

  switch (phase.kind) {
    case 'resting': {
      const t = state.restTimer;
      const endMs = t ? toMs(t.deadlineUtc) : nowMs + phase.remainingMs;
      const startMs = t ? Math.min(toMs(t.startedAtUtc), endMs) : nowMs;
      const until = `Until ${clockText(endMs, tz)}`;
      const next = nextSetOf(state, phase.nextSetId, carry);
      const doneEx = t ? state.sets.find((s) => s.id === t.setId)?.sessionExerciseId : undefined;
      let line1 = until;
      let nextWords = '';
      if (next !== null) {
        // Another part of the same exercise (after a gym switch) is still the same exercise.
        const sameExercise = doneEx !== undefined && partRootOf(state.exercises, doneEx) === partRootOf(state.exercises, next.ex.id);
        line1 = sameExercise ? `${until} · ${next.ex.exerciseName} · Set ${String(next.number)} of ${String(next.of)} next` : `${until} · Next: ${next.ex.exerciseName}`;
        nextWords = sameExercise ? ` Next: ${next.ex.exerciseName}, set ${String(next.number)} of ${String(next.of)}` : ` Next: ${next.ex.exerciseName}`;
      }
      const target = next?.target ?? '';
      const line3 = lastLine(state, phase.nextSetId, carry);
      return {
        ...base,
        state: 'resting',
        title: 'Rest',
        line1,
        line2: target,
        line3,
        countdown: { startMs, endMs },
        // Only a running rest has buttons (a paused one is the Paused state).
        rest: t?.status === 'running' ? { timerId: t.id, timerVersion: t.version } : null,
        side: '',
        a11y: `Rest, until ${clockText(endMs, tz)}.${nextWords}${target === '' ? '' : `, ${lockScreenTargetWords(target)}`}${nextWords === '' && target === '' ? '' : '.'}${lastWords(line3)}`,
        staleAtMs: endMs,
        afterRest: afterRestOf(state, endMs, tz, carry),
      };
    }
    case 'working': {
      const wi = state.workInterval;
      const endMs = wi ? toMs(wi.deadlineUtc) : nowMs + phase.remainingMs;
      const startMs = wi ? Math.min(toMs(wi.startedAtUtc), endMs) : nowMs;
      const set = state.sets.find((s) => s.id === phase.setId);
      const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
      const exName = ex?.exerciseName ?? name;
      if (ex?.measurement === 'cardio' && wi) {
        // Cardio (19 Oct) counts up with no end: the start time, no countdown, never stale.
        const from = clockText(startMs, tz);
        return { ...base, state: 'working', title: exName, line1: `Since ${from}`, line2: 'Open GymSmarter to log it', countdown: null, side: '', a11y: `${exName}, since ${from}.`, staleAtMs: null };
      }
      const target = wi ? formatDuration(wi.durationS) : '';
      return {
        ...base,
        state: 'working',
        title: `Work · ${exName}`,
        line1: target === '' ? `Until ${clockText(endMs, tz)}` : `Until ${clockText(endMs, tz)} · Target ${target}`,
        line2: 'Open GymSmarter to log it',
        countdown: { startMs, endMs },
        side: '',
        a11y: `Work, ${exName}, until ${clockText(endMs, tz)}.${target === '' ? '' : ` Target ${target}.`}`,
        staleAtMs: endMs,
      };
    }
    case 'paused': {
      const left = phase.timerRemainingMs ?? phase.workRemainingMs;
      const leftText = left === null ? null : formatDuration(Math.ceil(left / 1000));
      const next = nextSetOf(state, state.session.activeSetId, carry);
      const line1 =
        leftText !== null ? `${phase.timerRemainingMs !== null ? 'Rest' : 'Work'} ${leftText} left when you resume` : next !== null ? `Ready for set ${String(next.number)}` : '';
      return {
        ...base,
        state: 'paused',
        title: `Paused · ${name}`,
        line1,
        line2: '',
        countdown: null,
        side: leftText ?? '',
        a11y: `Workout paused.${line1 === '' ? '' : ` ${line1}.`}`,
        staleAtMs: null,
      };
    }
    case 'ready':
    case 'empty':
    case 'all_done':
    case 'finished': {
      const next = phase.kind === 'ready' ? nextSetOf(state, phase.setId, carry) : null;
      const line1 = next === null ? (phase.kind === 'all_done' ? 'All sets done' : '') : `${next.ex.exerciseName} · Set ${String(next.number)} of ${String(next.of)}`;
      const target = next?.target ?? '';
      const line3 = phase.kind === 'ready' ? lastLine(state, phase.setId, carry) : '';
      return {
        ...base,
        state: 'ready',
        title: `Ready · ${name}`,
        line1,
        line2: target,
        line3,
        countdown: null,
        side: next === null ? '' : `Set ${String(next.number)}`,
        a11y: `Ready, ${name}.${line1 === '' ? '' : ` ${line1}.`}${target === '' ? '' : ` ${lockScreenTargetWords(target)[0]?.toUpperCase() ?? ''}${lockScreenTargetWords(target).slice(1)}.`}${lastWords(line3)}`,
        staleAtMs: null,
      };
    }
  }
}
