import type { NavigatorScreenParams } from '@react-navigation/native';

import type { EditorFrom, LibrarySegment, LibraryToastParam, RootStackParams, TabParams } from './types';

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
 * The editor's `Save` (routines.md §A3): back to the list or the overview it
 * was opened from, handing over the toast (`Saved Push A` [Undo]). The
 * overview keeps its target (params merge).
 */
export function popToFromEditor(from: EditorFrom, toast: LibraryToastParam) {
  if (from === 'Library') return openLibrary('workouts', toast);
  // Exercise detail sits right under the editor: back to it (its toast is handed off in memory, `library-toast.ts`).
  // The Save sheet's `Edit ›`: back to the screen under the sheet, which takes the result (`save-edit-handoff.ts`).
  if (from === 'ExerciseInfo' || from === 'SaveSheet') return { type: 'GO_BACK' } as const;
  return { type: 'POP_TO', payload: { name: from, params: { toast }, merge: true } } as const;
}

/**
 * The Library tab on a segment (exercise-library EL10): from anywhere above
 * Tabs (the overview's picker `Edit workouts`, the editor's Save), popping
 * back to the one Tabs. `toast`: the editor's `Saved Push A` [Undo].
 */
export function openLibrary(segment: LibrarySegment, toast?: LibraryToastParam): PopToTabsAction {
  return popToTabs({ screen: 'Library', params: { screen: 'LibraryHome', params: { segment, ...(toast ? { toast } : {}) } } });
}

/**
 * The editor's `Cancel` (or `Discard`): back where it came from. A fresh copy
 * from `Duplicate` hands back its `Saved Push A copy` [Undo] toast, so the
 * copy can still be undone (review S1); otherwise a plain back.
 */
export function backFromEditor(from: EditorFrom, copyToast: LibraryToastParam | undefined) {
  return copyToast === undefined ? ({ type: 'GO_BACK' } as const) : popToFromEditor(from, copyToast);
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
