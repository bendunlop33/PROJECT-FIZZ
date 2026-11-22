import { mixItUpOfflinePick } from '@fizz/domain';
import type { MixPickArgs } from '@fizz/schemas';
import type { NumberFacts } from '../numbers';
import { checkCoachText } from './checked-text';

/**
 * `↻ Mix it up` (workout-builder-v3 §2.0.2; Ben agreed 20 Oct). Code picks
 * which accessory and the shortlist (`mixItUpTarget`, `mixItUpShortlist`);
 * with AI the coach picks ONE from the shortlist with a one-line reason;
 * offline, code picks the least recently done, labelled not reviewed.
 * Pure. Today only; `Another (1/3)` cycles the order below.
 */

export type MixPick =
  /** The coach's pick, from the shortlist; `reason` after the number check (null when it failed). */
  | { by: 'coach'; exerciseId: string; reason: string | null; order: string[] }
  /** Code's pick (no coach, or the coach named something off the list): not reviewed. */
  | { by: 'code'; exerciseId: string; reason: null; order: string[]; why: 'offline' | 'not_connected' | 'off_list' | 'failed' };

/** The shortlist with the pick first, the rest in code's order (least recently done first). */
export function mixOrder(shortlist: readonly string[], pick: string): string[] {
  return [pick, ...shortlist.filter((x) => x !== pick)];
}

/** Code's pick, labelled with why the coach didn't pick. Null with an empty shortlist. */
export function codeMixPick(shortlist: readonly string[], why: 'offline' | 'not_connected' | 'off_list' | 'failed'): MixPick | null {
  const id = mixItUpOfflinePick(shortlist);
  return id === null ? null : { by: 'code', exerciseId: id, reason: null, order: mixOrder(shortlist, id), why };
}

/** `checkMixPick`: the coach's pick if it is on the shortlist; else code's (never an exercise code didn't list). */
export function checkMixPick(args: MixPickArgs, shortlist: readonly string[], facts: NumberFacts): MixPick | null {
  if (!shortlist.includes(args.exerciseId)) return codeMixPick(shortlist, 'off_list');
  const reason = checkCoachText(args.reason, facts);
  return { by: 'coach', exerciseId: args.exerciseId, reason: reason.hidden.length > 0 ? null : reason.shown, order: mixOrder(shortlist, args.exerciseId) };
}

/** `Another (1/3)`: the next one in the order, wrapping round. */
export function nextMix(order: readonly string[], current: string): { exerciseId: string; index: number; of: number } | null {
  if (order.length === 0) return null;
  const at = order.indexOf(current);
  const i = at < 0 ? 0 : (at + 1) % order.length;
  const id = order[i];
  return id === undefined ? null : { exerciseId: id, index: i + 1, of: order.length };
}
