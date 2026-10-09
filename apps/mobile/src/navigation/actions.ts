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

/** Replace the Workout with its Summary (after Finish). */
export function replaceWithSummary(sessionId: string) {
  return { type: 'REPLACE', payload: { name: 'Summary', params: { sessionId } } } as const;
}
