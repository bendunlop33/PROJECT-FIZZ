import type { NavigatorScreenParams } from '@react-navigation/native';

import type { EditorFrom, LibrarySegment, LibraryToastParam, PlanAppliedToastParam, RootStackParams, TabParams } from './types';

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

/**
 * Between the builder's two pages (workout-builder-v3 §2.2–§2.3; review
 * b3-builder B7). `POP_TO` goes back to that page if it is under this one,
 * else this page becomes it: the builder is always one page on the stack,
 * so `Close` (a plain back) leaves it, and no older Set up is left under a
 * later Your workout to send an old version.
 */
export function builderPage<N extends 'BuilderSetup' | 'BuilderWorkout'>(name: N, params: NonNullable<RootStackParams[N]>) {
  return { type: 'POP_TO', payload: { name, params } } as const;
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
 * The editor's `Save` (routines.md §A3): back to the list it was opened
 * from, handing over the toast (`Saved Push A` [Undo]).
 */
export function popToFromEditor(from: EditorFrom, toast: LibraryToastParam) {
  if (from === 'Library') return openLibrary('workouts', toast);
  // Exercise detail sits right under the editor: back to it (its toast is handed off in memory, `library-toast.ts`).
  // The Save sheet's `Edit ›`: back to the screen under the sheet, which takes the result (`save-edit-handoff.ts`).
  return { type: 'GO_BACK' } as const;
}

/**
 * The Library tab on a segment (exercise-library EL10): from anywhere above
 * Tabs (the overview's picker `Edit workouts`, the editor's Save), popping
 * back to the one Tabs. `toast`: the editor's `Saved Push A` [Undo].
 */
export function openLibrary(segment: LibrarySegment, toast?: LibraryToastParam): PopToTabsAction {
  // `pop` (review planview S1): a plan day or exercise detail open in the Library stack is popped, never left on top of a second LibraryHome.
  return popToTabs({ screen: 'Library', params: { screen: 'LibraryHome', params: { segment, ...(toast ? { toast } : {}) }, pop: true } });
}

/**
 * Library › Plan (Ben, 22 Oct; review gaps V1): Today's `Day 2 of 4 ›` and no-plan `Set up a plan ›`, Profile's
 * `Set by your plan`. Scrolled to the top, where Your plan (or `Set up a plan`) is. `nonce`: once per tap.
 * `pop` (review planview S1): a plan day left open in the Library stack is popped back to LibraryHome (React Navigation 7's
 * nested navigate otherwise pushes a second one on top of it).
 */
export function openYourPlan(nonce: string): PopToTabsAction {
  return popToTabs({ screen: 'Library', params: { screen: 'LibraryHome', params: { segment: 'plan', plan: nonce }, pop: true } });
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

/**
 * (Plan builder, 23 Oct) The plan builder: Today's `Set up a plan ›` and Library › Plan's `Set up a plan` (the single
 * hook). A plain navigate (bubbles to the root stack, where `PlanSetup` lives).
 */
export function openPlanSetup() {
  return { type: 'NAVIGATE', payload: { name: 'PlanSetup' } } as const;
}

/** (Ben, 23 Oct: plan length = block 1) `Start next block ›`: the plan builder with the finished block's answers. */
export function openNextBlock(fromPlanId: string) {
  return { type: 'NAVIGATE', payload: { name: 'PlanSetup', params: { fromPlanId } } } as const;
}

/** `Apply plan`: to Today with the plan, showing `Plan applied · Undo` (plan-builder §3). */
export function todayAfterPlanApplied(planApplied: PlanAppliedToastParam): PopToTabsAction {
  return popToTabs({ screen: 'Today', params: { planApplied } });
}
