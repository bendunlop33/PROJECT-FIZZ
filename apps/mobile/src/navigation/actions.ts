import type { NavigatorScreenParams } from '@react-navigation/native';

import type { RootStackParams, TabParams } from './types';

/**
 * Root-stack actions that land on a tab (review workout-loop B1).
 *
 * In React Navigation 7, `navigate('Tabs', …)` from a screen above `Tabs`
 * PUSHES a second `Tabs`; it only goes back when `Tabs` is the current route.
 * `POP_TO` pops every screen above the existing `Tabs` (unmounting a finished
 * Summary or a discarded Workout, with their timers) and passes the nested
 * tab and params down. Plain action objects (the `StackActions.popTo` shape),
 * so the router test runs on Linux without React Native.
 */
export interface PopToTabsAction {
  type: 'POP_TO';
  payload: { name: 'Tabs'; params: NavigatorScreenParams<TabParams> };
}

export function popToTabs(params: NavigatorScreenParams<TabParams>): PopToTabsAction {
  return { type: 'POP_TO', payload: { name: 'Tabs', params } };
}

/** Back to Today, optionally with a one-off toast. */
export function popToToday(toast?: string): PopToTabsAction {
  return popToTabs(toast === undefined ? { screen: 'Today' } : { screen: 'Today', params: { toast } });
}

/**
 * After a start from a sheet or a pushed screen (check-in, Repeat): the stack
 * becomes exactly `[Tabs, Workout]`, so minimising lands on Today, never on
 * the screen the workout was started from.
 */
export function openStartedWorkout(params?: RootStackParams['Workout']) {
  return { type: 'RESET', payload: { index: 1, routes: [{ name: 'Tabs' }, { name: 'Workout', ...(params ? { params } : {}) }] } } as const;
}

/**
 * `[Use changes today]` on a gym's detail during a workout there (gym-editor
 * §4.9): to the workout, which opens `Use updated …` for that gym. A plain
 * navigate (bubbles up to the root stack); nothing changes until `Apply`.
 */
export function openWorkoutToCheckGym(gymId: string, nonce: string) {
  return { type: 'NAVIGATE', payload: { name: 'Workout', params: { checkGym: { gymId, nonce } } } } as const;
}

/**
 * The off-profile line on the set card (minimal-copy audit A3): to that gym's
 * detail, stacked on the gym list in Profile. Today's workout checks loads
 * against the gym as it was at start, so an equipment fix only reaches it
 * through Gym detail's `Use changes today` (`openWorkoutToCheckGym`). Leaves
 * the workout minimised over Today.
 */
export function openGymFromWorkout(gymId: string): PopToTabsAction {
  return popToTabs({ screen: 'Profile', params: { screen: 'GymDetail', params: { gymId }, initial: false } });
}

/** Replace the Workout with its Summary (after Finish). The only path that plays the finish moment (premium-feel §6). */
export function replaceWithSummary(sessionId: string) {
  return { type: 'REPLACE', payload: { name: 'Summary', params: { sessionId, justFinished: true } } } as const;
}

/**
 * Back from the correction sheet to the Workout under it (review
 * coach-fallback B1). A plain `navigate('Workout', …)` from `EditSet` PUSHES a
 * second Workout (with its own timers and coach state); `POP_TO` with `merge`
 * pops the sheet and hands the toast or `corrected` key to the existing one.
 */
export function returnToWorkout(params: NonNullable<RootStackParams['Workout']>) {
  return { type: 'POP_TO', payload: { name: 'Workout', params, merge: true } } as const;
}
