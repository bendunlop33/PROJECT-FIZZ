import type { SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';
import { clockText } from '../calendar';
import { formatDuration, NBSP, targetShort } from '../display';
import { toMs } from '../time';
import { equipmentOfRow } from './equipment-snapshot';
import { blockSets, partRootOf } from './gym-switch';
import { STALE_SESSION_MS } from './recovery';
import { getSessionPhase } from './view';

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
  /** `Target 100 kg × 6–8`; '' when none. */
  line2: string;
  /** The system-rendered countdown (epoch ms); null when nothing counts. */
  countdown: { startMs: number; endMs: number } | null;
  /** Static short text for the compact Dynamic Island when nothing counts: `Set 3`, `1:10`; '' when none. */
  side: string;
  /** VoiceOver: units in full and the word "target" (§5). */
  a11y: string;
  /** After this the system may de-emphasise it (the countdown's end); null = never. */
  staleAtMs: number | null;
}

const TITLE_FALLBACK = 'Workout';


interface NextSet {
  set: WorkoutSet;
  ex: SessionExercise;
  number: number;
  of: number;
  target: string | null;
}

function nextSetOf(state: SessionAggregate, setId: string | null): NextSet | null {
  if (setId === null) return null;
  const set = state.sets.find((s) => s.id === setId);
  const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !ex) return null;
  // The whole block (every gym part), so numbering matches the in-app header (review ben-bugs N4).
  const own = blockSets(state, ex.id);
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  const target = targetShort(set.planned, { convention: ex.loadConvention, equipment: eq });
  const perSide = target !== null && ex.laterality === 'unilateral' && set.planned.reps !== null ? `${NBSP}per side` : '';
  return { set, ex, number: own.indexOf(set) + 1, of: own.length, target: target === null ? null : `${target}${perSide}` };
}

/** `Target 100 kg × 6–8` read aloud: `target 100 kilograms, 6 to 8 reps`. */
export function lockScreenTargetWords(target: string): string {
  const plain = target.replaceAll(NBSP, ' ');
  const [word, rest] = plain.startsWith('Coach target ') ? ['coach target', plain.slice('Coach target '.length)] : ['target', plain.replace(/^Target /, '')];
  const spoken = rest
    .replace(/\s*×\s*(\d+)(?:–(\d+))?/g, (_m, a: string, b: string | undefined) => (b === undefined ? `, ${a} reps` : `, ${a} to ${b} reps`))
    .replace(/(\d+)–(\d+)/g, '$1 to $2')
    .replace(/\bkg\b/g, 'kilograms')
    .replace(/\blb\b/g, 'pounds');
  return `${word} ${spoken}`;
}

/**
 * The content for `state` at `nowMs`, with clock times in `tz`; null when no
 * activity should show (no workout, finished or discarded, or stale: ≥ 6 h
 * since the last activity, flow §4.2).
 */
export function buildLockScreenContent(state: SessionAggregate | null, nowMs: number, tz: string): LockScreenContent | null {
  if (state === null || state.session.status !== 'active') return null;
  if (nowMs - toMs(state.session.lastActivityAtUtc) >= STALE_SESSION_MS) return null;
  const name = state.session.routineName ?? TITLE_FALLBACK;
  const base = { sessionId: state.session.id };
  const phase = getSessionPhase(state, nowMs);

  switch (phase.kind) {
    case 'resting': {
      const t = state.restTimer;
      const endMs = t ? toMs(t.deadlineUtc) : nowMs + phase.remainingMs;
      const startMs = t ? Math.min(toMs(t.startedAtUtc), endMs) : nowMs;
      const until = `Until ${clockText(endMs, tz)}`;
      const next = nextSetOf(state, phase.nextSetId);
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
      return {
        ...base,
        state: 'resting',
        title: 'Rest',
        line1,
        line2: target,
        countdown: { startMs, endMs },
        side: '',
        a11y: `Rest, until ${clockText(endMs, tz)}.${nextWords}${target === '' ? '' : `, ${lockScreenTargetWords(target)}`}${nextWords === '' && target === '' ? '' : '.'}`,
        staleAtMs: endMs,
      };
    }
    case 'working': {
      const wi = state.workInterval;
      const endMs = wi ? toMs(wi.deadlineUtc) : nowMs + phase.remainingMs;
      const startMs = wi ? Math.min(toMs(wi.startedAtUtc), endMs) : nowMs;
      const set = state.sets.find((s) => s.id === phase.setId);
      const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
      const exName = ex?.exerciseName ?? name;
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
      const next = nextSetOf(state, state.session.activeSetId);
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
      const next = phase.kind === 'ready' ? nextSetOf(state, phase.setId) : null;
      const line1 = next === null ? (phase.kind === 'all_done' ? 'All sets done' : '') : `${next.ex.exerciseName} · Set ${String(next.number)} of ${String(next.of)}`;
      const target = next?.target ?? '';
      return {
        ...base,
        state: 'ready',
        title: `Ready · ${name}`,
        line1,
        line2: target,
        countdown: null,
        side: next === null ? '' : `Set ${String(next.number)}`,
        a11y: `Ready, ${name}.${line1 === '' ? '' : ` ${line1}.`}${target === '' ? '' : ` ${lockScreenTargetWords(target)[0]?.toUpperCase() ?? ''}${lockScreenTargetWords(target).slice(1)}.`}`,
        staleAtMs: null,
      };
    }
  }
}
