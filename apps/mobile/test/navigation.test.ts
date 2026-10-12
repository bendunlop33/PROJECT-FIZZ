import { StackRouter, type StackNavigationState, type ParamListBase } from '@react-navigation/routers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { openGymFromWorkout, openStartedWorkout, openWorkoutToCheckGym, popToTabs, popToToday, replaceWithSummary, returnToWorkout } from '../src/navigation/actions';
import { initialRootState } from '../src/navigation/initial-state';

describe('root stack at launch (review S5)', () => {
  it('opens an unfinished workout over Today, so minimise pops back to Today', () => {
    expect(initialRootState(true, true)).toEqual({ index: 1, routes: [{ name: 'Tabs' }, { name: 'Workout' }] });
    expect(initialRootState(true, false)).toEqual({ index: 0, routes: [{ name: 'Tabs' }] });
    expect(initialRootState(false, true)).toEqual({ index: 0, routes: [{ name: 'Setup' }] });
  });
});

/**
 * The app's real root-stack actions through React Navigation 7's StackRouter
 * (review workout-loop B1): finishing or discarding never leaves a second
 * Tabs, a stale Summary or a discarded Workout mounted underneath.
 */
describe('root stack after Finish, Done and Discard (review B1)', () => {
  const routeNames = ['Tabs', 'Workout', 'CheckIn', 'ExercisePicker', 'EditSet', 'Summary', 'AddGym'];
  const router = StackRouter({});
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  type State = StackNavigationState<ParamListBase>;
  const apply = (state: State, action: Parameters<typeof router.getStateForAction>[1]): State => {
    const next = router.getStateForAction(state, action, options);
    if (next === null || next.stale) throw new Error(`action not handled: ${action.type}`);
    return next as State;
  };
  const names = (s: State) => s.routes.map((r) => r.name);
  const navigate = (name: string, params: object = {}) => ({ type: 'NAVIGATE', payload: { name, params } }) as const;
  const goBack = { type: 'GO_BACK' } as const;
  const start = () => router.getInitialState(options);

  it('a Summary opened from Today is not the finish moment (review B2)', () => {
    const s = apply(start(), navigate('Summary', { sessionId: 'session-1' }));
    expect((s.routes[1]?.params as { justFinished?: boolean } | undefined)?.justFinished).toBeUndefined();
  });

  it('Start → Finish → Done → Start leaves [Tabs] then [Tabs, Workout]', () => {
    let s = apply(start(), navigate('Workout'));
    expect(names(s)).toEqual(['Tabs', 'Workout']);
    s = apply(s, replaceWithSummary('session-1'));
    expect(names(s)).toEqual(['Tabs', 'Summary']);
    // Only Finish's own replace marks the finish moment (premium-feel review B2).
    expect(s.routes[1]?.params).toEqual({ sessionId: 'session-1', justFinished: true });
    s = apply(s, popToToday());
    expect(names(s)).toEqual(['Tabs']);
    expect(s.routes[0]?.params).toEqual({ screen: 'Today' });
    s = apply(s, navigate('Workout'));
    expect(names(s)).toEqual(['Tabs', 'Workout']);
  });

  it('Start → Discard returns to the one Tabs with the toast, unmounting the workout', () => {
    const first = start();
    const tabsKey = first.routes[0]?.key;
    let s = apply(first, navigate('Workout'));
    s = apply(s, popToToday('Workout discarded'));
    expect(names(s)).toEqual(['Tabs']);
    expect(s.routes[0]?.key).toBe(tabsKey);
    expect(s.routes[0]?.params).toEqual({ screen: 'Today', params: { toast: 'Workout discarded' } });
  });

  it('check-in → Start, and check-in → Skip workout', () => {
    let s = apply(start(), navigate('CheckIn', { mode: 'start', gymId: 'g' }));
    s = apply(s, goBack);
    s = apply(s, navigate('Workout'));
    expect(names(s)).toEqual(['Tabs', 'Workout']);
    s = apply(apply(start(), navigate('CheckIn', { mode: 'start', gymId: 'g' })), popToToday('Check-in saved · no workout'));
    expect(names(s)).toEqual(['Tabs']);
  });

  it('Summary → Data & backup goes to the existing Tabs, never a second one', () => {
    let s = apply(start(), navigate('Summary', { sessionId: 'x' }));
    s = apply(s, popToTabs({ screen: 'Profile', params: { screen: 'DataBackup', initial: false } }));
    expect(names(s)).toEqual(['Tabs']);
    // What the old code did: navigate from above Tabs pushes another Tabs.
    expect(names(apply(apply(start(), navigate('Summary', { sessionId: 'x' })), navigate('Tabs', { screen: 'Today' })))).toEqual(['Tabs', 'Summary', 'Tabs']);
  });

  it('[Use changes today] from a gym (under Tabs) opens the minimised workout with its gym card, one Workout only', () => {
    let s = apply(start(), navigate('Workout'));
    s = apply(s, goBack);
    s = apply(s, openWorkoutToCheckGym('gym-1', 'n-1'));
    expect(names(s)).toEqual(['Tabs', 'Workout']);
    expect(s.routes[1]?.params).toEqual({ checkGym: { gymId: 'gym-1', nonce: 'n-1' } });
  });

  it('the off-profile line (audit A3) opens Gym detail over the gym list, where [Use changes today] returns to the workout', () => {
    let s = apply(start(), navigate('Workout'));
    const action = openGymFromWorkout('gym-1');
    // Gym detail (it has `Use changes today`), not the equipment editor, whose saves only reach future workouts.
    expect(action.payload.params).toEqual({ screen: 'Profile', params: { screen: 'GymDetail', params: { gymId: 'gym-1' }, initial: false } });
    s = apply(s, action);
    expect(names(s)).toEqual(['Tabs']);
    expect(s.routes[0]?.params).toEqual(action.payload.params);
    s = apply(s, openWorkoutToCheckGym('gym-1', 'n-2'));
    expect(names(s)).toEqual(['Tabs', 'Workout']);
    expect(s.routes[1]?.params).toEqual({ checkGym: { gymId: 'gym-1', nonce: 'n-2' } });
  });

  it('the workout screen uses that action for the off-profile line, not the equipment editor (review minimal-copy r2 S1)', () => {
    const src = readFileSync(join(import.meta.dirname, '../src/screens/workout/WorkoutScreen.tsx'), 'utf8');
    const fn = src.slice(src.indexOf('function openOffProfileEquipment'), src.indexOf('function painOutcome'));
    expect(fn).toMatch(/openGymFromWorkout\(eq\.gymId\)/);
    expect(fn).not.toMatch(/EquipmentEditor/);
  });
});

describe('correction sheet back to the workout (review coach-fallback B1)', () => {
  const routeNames = ['Tabs', 'Workout', 'EditSet', 'Summary'];
  const router = StackRouter({});
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  type State = StackNavigationState<ParamListBase>;
  const apply = (state: State, action: Parameters<typeof router.getStateForAction>[1]): State => {
    const next = router.getStateForAction(state, action, options);
    if (next === null || next.stale) throw new Error(`action not handled: ${action.type}`);
    return next as State;
  };
  const navigate = (name: string, params: object = {}) => ({ type: 'NAVIGATE', payload: { name, params } }) as const;
  const names = (s: State) => s.routes.map((r) => r.name);
  const openSheet = () => apply(apply(router.getInitialState(options), navigate('Workout', { checkGym: { gymId: 'g', nonce: 'n' } })), navigate('EditSet', { sessionId: 's', setId: 'set-1' }));

  it('[Tabs, Workout, EditSet] becomes [Tabs, Workout] with the corrected key merged, same Workout route', () => {
    const s0 = openSheet();
    const workoutKey = s0.routes[1]?.key;
    const s = apply(s0, returnToWorkout({ corrected: { setId: 'set-1', key: 'op-1' } }));
    expect(names(s)).toEqual(['Tabs', 'Workout']);
    expect(s.index).toBe(1);
    expect(s.routes[1]?.key).toBe(workoutKey);
    expect(s.routes[1]?.params).toEqual({ checkGym: { gymId: 'g', nonce: 'n' }, corrected: { setId: 'set-1', key: 'op-1' } });
  });

  it('repeated corrections never grow the stack; the exclusion toast branch too', () => {
    let s = openSheet();
    s = apply(s, returnToWorkout({ corrected: { setId: 'set-1', key: 'op-1' } }));
    s = apply(s, navigate('EditSet', { sessionId: 's', setId: 'set-2' }));
    const toast = { kind: 'exclusion', key: 'op-2', text: 'Excluded', undo: { sessionId: 's' } } as unknown as NonNullable<Parameters<typeof returnToWorkout>[0]['toast']>;
    s = apply(s, returnToWorkout({ toast, corrected: { setId: 'set-2', key: 'op-2' } }));
    expect(names(s)).toEqual(['Tabs', 'Workout']);
    expect((s.routes[1]?.params as { corrected?: unknown }).corrected).toEqual({ setId: 'set-2', key: 'op-2' });
    // What the old code did: navigate from EditSet pushes a second Workout.
    expect(names(apply(openSheet(), navigate('Workout', { corrected: { setId: 'set-1', key: 'op-1' } })))).toEqual(['Tabs', 'Workout', 'EditSet', 'Workout']);
  });

  it('EditSetScreen returns with that action, never navigate(\'Workout\')', () => {
    const src = readFileSync(join(import.meta.dirname, '../src/screens/workout/EditSetScreen.tsx'), 'utf8');
    expect(src).not.toMatch(/navigate\(\s*'Workout'/);
    expect(src.match(/dispatch\(returnToWorkout\(/g)?.length).toBe(2);
  });
});

describe('starting from a sheet or a pushed screen', () => {
  const router = StackRouter({});
  const routeNames = ['Tabs', 'Workout', 'CheckIn', 'Summary', 'PastWorkouts', 'Repeat'];
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  it('check-in from Repeat → Start leaves exactly [Tabs, Workout]', () => {
    let s = router.getInitialState(options);
    for (const name of ['PastWorkouts', 'Repeat', 'CheckIn']) {
      const next = router.getStateForAction(s, { type: 'NAVIGATE', payload: { name, params: {} } }, options);
      if (!next) throw new Error(name);
      s = next as typeof s;
    }
    const reset = openStartedWorkout({ toast: { kind: 'info', text: 'x' } });
    const after = router.getStateForAction(s, reset as unknown as Parameters<typeof router.getStateForAction>[1], options);
    expect(after?.routes.map((r) => r.name)).toEqual(['Tabs', 'Workout']);
    expect(after?.index).toBe(1);
  });
});
