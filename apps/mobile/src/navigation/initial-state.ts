import type { RootStackParams } from './types';

export interface RootInitialState {
  index: number;
  routes: { name: keyof RootStackParams }[];
}

/**
 * The root stack at launch (review S5). A cold start into an unfinished
 * workout (flow P6) opens `Workout` **over** `Tabs`, so minimising pops back
 * to Today instead of pushing Today on top of the workout. Pure, so it is
 * tested on Linux.
 */
export function initialRootState(setupDone: boolean, openWorkout: boolean): RootInitialState {
  if (!setupDone) return { index: 0, routes: [{ name: 'Setup' }] };
  if (openWorkout) return { index: 1, routes: [{ name: 'Tabs' }, { name: 'Workout' }] };
  return { index: 0, routes: [{ name: 'Tabs' }] };
}
