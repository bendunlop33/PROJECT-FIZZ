import type { WarmupLookup } from '@fizz/domain';

/**
 * (Ben, 1 Nov: "I can't log warm up sets in lock screen") The warm-up planner's lookup for the workout in progress
 * (catalogue facts, main lifts, his warm-up settings), as last read with the workout (`workout.load`). The Lock Screen
 * activity is built from the workout state alone, outside the screen; it reads this so a warm-up with no load of its
 * own shows and logs exactly the planner's step the workout shows (`Log warm-up 40 kg × 8`). Unknown until the
 * workout is first read: then only warm-ups with a load of their own get `Log`.
 */
let current: { sessionId: string; lookup: WarmupLookup } | undefined;

export function setActiveWarmupLookup(sessionId: string, lookup: WarmupLookup | undefined): void {
  current = lookup === undefined ? undefined : { sessionId, lookup };
}

/** The lookup for `sessionId`, or undefined (another workout, or not read yet). */
export function activeWarmupLookup(sessionId: string): WarmupLookup | undefined {
  return current?.sessionId === sessionId ? current.lookup : undefined;
}
