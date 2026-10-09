import type { NavigatorScreenParams } from '@react-navigation/native';

import type { TabParams } from './types';

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

/** Replace the Workout with its Summary (after Finish). */
export function replaceWithSummary(sessionId: string) {
  return { type: 'REPLACE', payload: { name: 'Summary', params: { sessionId } } } as const;
}
