import type { TargetEarlierWork, TargetProvenance, WorkoutSet } from '@fizz/schemas';
import { dayMonthText, formatNumber, NBSP } from '../display';

/**
 * SF7(b) (Ben, 15 Nov): the in-session fatigue fact stored with a built-in target (`provenance.earlierWork`), as
 * `Why?` shows it (one line, only when Ben opens `Why?`) and as the coach is told it. Pure reads of the stored note;
 * nothing here runs SF again.
 */

const setsText = (n: number): string => formatNumber(n);

/** `dumbbell shoulder press` from `Dumbbell shoulder press`; `EZ-bar curl` keeps its capitals. */
function lowerFirst(name: string): string {
  return /^[A-Z]{2}/.test(name) ? name : `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

/** `dumbbell shoulder press ×3, dips ×2 +1 more` (at most two named). */
function beforeNames(ew: TargetEarlierWork): string {
  const named = ew.before.slice(0, 2).map((b) => `${b.name === null ? 'earlier work' : lowerFirst(b.name)}${NBSP}×${setsText(b.sets)}`);
  const more = ew.before.length - named.length;
  return `${named.join(', ')}${more > 0 ? ` +${String(more)} more` : ''}`;
}

/** The reference's context: `done first` / `after 1.5 chest sets`. */
function refWords(ew: TargetEarlierWork): string {
  const ref = ew.reference;
  if (ref === null) return '';
  const base = ref.p === 0 ? 'done first' : `after ${setsText(ref.p)}${ew.muscle === null ? '' : ` ${ew.muscle.toLowerCase()}`} ${ref.p === 1 ? 'set' : 'sets'}`;
  return ref.sameMuscleSuperset ? `${base}, superset` : base;
}

/**
 * The `Why?` line (`Earlier today`), or null when SF had nothing to say (nothing before it worked its muscles and the
 * reference was like for like). Examples:
 * - `After dumbbell shoulder press ×3 · compared with 8 Nov (after 1.5 chest sets)`
 * - `After bench press ×3 · no session like it: 1 rep fewer · est.`
 * - `After triceps pushdown ×3 · triceps · compared with 8 Nov (done first)`: P came from one of this exercise's
 *   secondary movers (SF1 amended 21 Nov), so the muscle is named.
 */
export function earlierWorkWhy(ew: TargetEarlierWork | undefined): string | null {
  if (ew === undefined) return null;
  if (ew.p === 0 && ew.basis === 'comparable') return null;
  const mover = ew.muscleRole === 'secondary' && ew.muscle !== null ? ` · ${ew.muscle.toLowerCase()}` : '';
  const head = ew.before.length > 0 ? `After ${beforeNames(ew)}${mover}` : 'Done first';
  const day = ew.reference === null ? null : dayMonthText(ew.reference.performedAt.utc, ew.reference.performedAt.tz);
  const compared = day === null ? '' : `compared with ${day} (${refWords(ew)})`;
  if (ew.basis === 'cushion' && ew.cushion !== undefined) {
    const reps = ew.cushion.reps > 0 ? `${String(ew.cushion.reps)} ${ew.cushion.reps === 1 ? 'rep' : 'reps'} fewer` : 'no load step';
    return `${head} · no session like it: ${reps}${ew.cushion.stepDown ? ' · 1 step lighter' : ''} · est.`;
  }
  if (ew.basis === 'other') return `${head} · no session like it${compared === '' ? '' : ` · ${compared}`}`;
  return compared === '' ? head : `${head} · ${compared}`;
}

/** `shoulders direct; chest, triceps secondary` for one earlier exercise. */
function howWords(b: TargetEarlierWork['before'][number]): string {
  const low = (xs: readonly string[]) => xs.map((m) => m.toLowerCase()).join(', ');
  return [b.direct.length > 0 ? `${low(b.direct)} direct` : null, b.secondary.length > 0 ? `${low(b.secondary)} secondary` : null].filter((x) => x !== null).join('; ');
}

/**
 * The coach's fact for one exercise (SF7b), terse to keep the context small:
 * `before: dumbbell shoulder press 3 (shoulders direct; chest, triceps secondary) · P 1.5 chest · ref 8 Nov P 1.5, like for like · no cushion`.
 * P counts this exercise's primary muscles in full and its secondary ones at ½ (SF1 amended 21 Nov); `(secondary)`
 * marks a P set by a secondary mover.
 */
export function earlierWorkFact(ew: TargetEarlierWork): string {
  const before = ew.before.length === 0 ? 'nothing before it shares its muscles' : `before: ${ew.before.map((b) => `${b.name === null ? 'unnamed' : lowerFirst(b.name)} ${setsText(b.sets)} (${howWords(b)})`).join(', ')}`;
  const p = `P ${setsText(ew.p)}${ew.muscle === null ? '' : ` ${ew.muscle.toLowerCase()}${ew.muscleRole === 'secondary' ? ' (secondary)' : ''}`}`;
  const ref = ew.reference === null ? 'no ref' : `ref ${ew.reference.performedAt.utc.slice(0, 10)} P ${setsText(ew.reference.p)}${ew.reference.sameMuscleSuperset ? ' superset' : ''}, ${ew.basis === 'comparable' ? 'like for like' : 'not like for like'}`;
  const sf3 = ew.basis === 'cushion' && ew.cushion !== undefined ? `cushion applied (no load increase today): ${ew.cushion.reps > 0 ? `−${String(ew.cushion.reps)} rep${ew.cushion.reps === 1 ? '' : 's'}` : 'no load step'}${ew.cushion.stepDown ? ', 1 step lighter' : ''}, est.` : 'no cushion';
  return `${before} · ${p} · ${ref} · ${sf3}${ew.staleLower === true ? ' · stale ref, lower load' : ''}`.replaceAll(NBSP, ' ');
}

/** The SF note of an exercise's next target: its first pending non-warm-up set's, when SF worked it out. */
export function pendingEarlierWork(sets: readonly Pick<WorkoutSet, 'status' | 'setType' | 'planned'>[]): TargetEarlierWork | null {
  const next = sets.find((s) => s.status === 'pending' && s.setType !== 'warmup');
  const p: TargetProvenance | undefined = next?.planned.provenance;
  return p?.source === 'rule' && p.earlierWork !== undefined ? p.earlierWork : null;
}
