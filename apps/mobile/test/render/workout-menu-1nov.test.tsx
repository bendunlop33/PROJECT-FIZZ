import { act } from 'react';
import type { TestInstance } from 'test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentRoundIndex, sessionRounds } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { WorkoutScreen } from '../../src/screens/workout/WorkoutScreen';
import type { AppServices } from '../../src/services/app-services';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen, type Rendered } from './render-screen';
import { benWithHistory, harness } from './seed';

/**
 * The round page's exercise menu, rendered on a real workout (real SQLite). (Ben, 31 Oct: "do we need all this when
 * in workout mode?"; 1 Nov: "Why can't I move this up or down or to the start?"; approved A + C.) A context menu next
 * to the exercise: Undo…, Later / Now / Up / Down (only those that move it, the current exercise included while
 * nothing on it is logged), Swap, Add set, History, Notes, Plates (barbell only), Adjust (current only), Skip; no
 * Cancel. The Workout list's rows swipe: left Later · Swap · Skip, right Add set (here through their VoiceOver
 * actions, the swipe's mirror). Each pick runs through the screen to the stored workout, with Undo.
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.cleanup();
});

async function workoutOf(s: AppServices, gymId: string, exercises: string[]): Promise<string> {
  const started = await s.workout.start({ gymId, opId: h.ids(), checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  for (const name of exercises) {
    const pick = (await s.workout.pickerExercises(sessionId, name)).find((p) => p.exercise.name === name);
    if (!pick) throw new Error(`no ${name}`);
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
  }
  return sessionId;
}

const byLabel = (r: Rendered, label: string): TestInstance => {
  const n = r.all((x) => x.props.accessibilityLabel === label && typeof x.props.onPress === 'function')[0];
  if (n === undefined) throw new Error(`nothing labelled ${label}`);
  return n;
};

async function tap(n: TestInstance): Promise<void> {
  await act(async () => {
    await (n.props.onPress as (e: unknown) => unknown)({ nativeEvent: {} });
  });
}

const menuOf = (r: Rendered, name: string): TestInstance | undefined => r.all((x) => x.props.accessibilityLabel === `${name} options`)[0];

/** The open menu's items, in order, by their VoiceOver names (an icon button reads `Move to end` for `Later`). */
function menuItems(r: Rendered, name: string): string[] {
  return (menuOf(r, name)?.queryAll((x) => x.type === 'Pressable' && typeof x.props.onPress === 'function') ?? []).map((x) => String(x.props.accessibilityLabel));
}

async function openMenu(r: Rendered, name: string): Promise<string[]> {
  await tap(byLabel(r, `${name} menu`));
  await r.waitFor(() => menuItems(r, name).length > 0, `${name}'s menu`);
  return menuItems(r, name);
}

async function pick(r: Rendered, name: string, item: string): Promise<void> {
  const row = menuOf(r, name)?.queryAll((x) => x.type === 'Pressable' && x.props.accessibilityLabel === item)[0];
  if (row === undefined) throw new Error(`no ${item} in ${name}'s menu`);
  await tap(row);
}

const overviewRow = (r: Rendered, name: string): TestInstance | undefined =>
  r.all((x) => typeof x.props.onAccessibilityAction === 'function' && typeof x.props.accessibilityLabel === 'string' && x.props.accessibilityLabel.includes(`, ${name}, `))[0];

/** A row of the Workout list: its VoiceOver action (the swipe's and the `⋯`'s mirror). */
async function overviewAction(r: Rendered, name: string, action: string): Promise<void> {
  if (overviewRow(r, name) === undefined) await tap(byLabel(r, 'Workout overview'));
  await r.waitFor(() => overviewRow(r, name) !== undefined, 'the Workout list');
  const row = overviewRow(r, name);
  await act(async () => {
    (row?.props.onAccessibilityAction as (e: unknown) => void)({ nativeEvent: { actionName: action } });
    await Promise.resolve();
  });
}

const rowActions = (r: Rendered, name: string): string[] => ((overviewRow(r, name)?.props.accessibilityActions ?? []) as { name: string }[]).map((a) => a.name);

describe('the round page’s exercise menu (Ben, 1 Nov, A)', () => {
  it('on the current exercise with nothing logged: Later and Down; Plates for the barbell; Adjust; Skip last; no Cancel', async () => {
    const ben = await benWithHistory(h);
    const sessionId = await workoutOf(ben.s, ben.gymId, ['Bench press', 'Incline dumbbell press', 'Lat pulldown']);
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('Bench press') && t.includes('＋ Set'));
    expectHealthy(r);

    expect(await openMenu(r, 'Bench press')).toEqual(['Move to end', 'Move down', 'Swap exercise', 'Add set', 'History', 'Notes', 'Plates', 'Adjust', 'Skip exercise']);
    // The icon row's own words; no Cancel row (a tap outside closes it).
    expect(r.text()).toContain('|Later|Down|');
    for (const gone of ['Cancel', 'Edit set', 'Target RIR', 'Delete this set', 'Add exercise', 'Not at this gym', 'Remove exercise', 'Do next', 'Now', 'Up']) expect(r.text()).not.toContain(`|${gone}|`);

    // Later on the current exercise: it goes last, the next one becomes current, no set changes; Undo hands back.
    const load = async () => (await ben.s.workout.load(sessionId))?.aggregate as SessionAggregate;
    const before = await load();
    await pick(r, 'Bench press', 'Move to end');
    await r.waitFor((t) => t.includes('Bench press moved to end'), 'the Later toast');
    const moved = await load();
    expect(sessionRounds(moved).map((x) => x.members[0]?.exerciseName)).toEqual(['Incline dumbbell press', 'Lat pulldown', 'Bench press']);
    expect(currentRoundIndex(moved)).toBe(0);
    expect(moved.sets).toEqual(before.sets);
    await r.press('Undo');
    await r.waitFor((t) => !t.includes('Bench press moved to end'), 'the toast gone');
    const back = await load();
    expect(sessionRounds(back).map((x) => x.members[0]?.exerciseName)).toEqual(['Bench press', 'Incline dumbbell press', 'Lat pulldown']);
    expect(back.session.activeSetId).toBe(before.session.activeSetId);
    expect(r.errors).toEqual([]);
    await r.unmount();
  });

  it('a tap outside dismisses it; Swap opens the Swap sheet with Not at this gym', async () => {
    const ben = await benWithHistory(h);
    await workoutOf(ben.s, ben.gymId, ['Bench press', 'Lat pulldown']);
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('Bench press') && t.includes('＋ Set'));
    await openMenu(r, 'Bench press');
    await tap(byLabel(r, 'Close menu'));
    await r.waitFor(() => menuItems(r, 'Bench press').length === 0, 'the menu gone');
    await openMenu(r, 'Bench press');
    await pick(r, 'Bench press', 'Swap exercise');
    await r.waitFor((t) => t.includes('Swap Bench press') && t.includes('Not at this gym'), 'the Swap sheet with Not at this gym');
    await r.press('Not at this gym');
    await r.waitFor((t) => t.includes('Undo') && !t.includes('|Not at this gym|'), 'the gym told, with Undo');
    expect(r.text()).toContain('Swap Bench press');
    expect(r.errors).toEqual([]);
    await r.unmount();
  });
});

describe('swipes in the Workout list (Ben, 1 Nov, C)', () => {
  it('Later, Skip and Add set on the stored workout, each with Undo; a done exercise only adds a set', async () => {
    const ben = await benWithHistory(h);
    const sessionId = await workoutOf(ben.s, ben.gymId, ['Bench press', 'Incline dumbbell press', 'Lat pulldown']);
    const load = async () => (await ben.s.workout.load(sessionId))?.aggregate as SessionAggregate;
    const order = async () => sessionRounds(await load()).map((x) => x.members[0]?.exerciseName);
    const pendingOf = async (name: string) => {
      const a = await load();
      const id = a.exercises.find((e) => e.exerciseName === name)?.id;
      return a.sets.filter((x) => x.status === 'pending' && x.sessionExerciseId === id).length;
    };
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('Bench press') && t.includes('＋ Set'));

    await overviewAction(r, 'Incline dumbbell press', 'move_to_end');
    await r.waitFor((t) => t.includes('Incline dumbbell press moved to end'), 'the Later toast');
    expect(await order()).toEqual(['Bench press', 'Lat pulldown', 'Incline dumbbell press']);
    await r.press('Undo');
    await r.waitFor((t) => !t.includes('Incline dumbbell press moved to end'), 'the Later toast gone');
    expect(await order()).toEqual(['Bench press', 'Incline dumbbell press', 'Lat pulldown']);

    const lat = await pendingOf('Lat pulldown');
    await overviewAction(r, 'Lat pulldown', 'skip_exercise');
    await r.waitFor((t) => t.includes('Lat pulldown skipped'), 'the Skip toast');
    expect(await pendingOf('Lat pulldown')).toBe(0);
    await r.press('Undo');
    await r.waitFor((t) => !t.includes('Lat pulldown skipped'), 'the Skip toast gone');
    expect(await pendingOf('Lat pulldown')).toBe(lat);

    await overviewAction(r, 'Lat pulldown', 'add_set');
    await r.waitFor((t) => /added\|Undo/.test(t), 'the Add set toast with Undo');
    expect(await pendingOf('Lat pulldown')).toBe(lat + 1);
    await r.press('Undo');
    await r.waitFor((t) => !/added\|Undo/.test(t), 'the Add set toast gone');
    expect(await pendingOf('Lat pulldown')).toBe(lat);

    // Done (its sets skipped): only Add set swipes.
    await overviewAction(r, 'Lat pulldown', 'skip_exercise');
    await r.waitFor((t) => t.includes('Lat pulldown skipped'), 'the Skip toast again');
    await r.waitFor(() => !rowActions(r, 'Lat pulldown').includes('skip_exercise'), 'the done row’s swipes');
    expect(rowActions(r, 'Lat pulldown')).toContain('add_set');
    for (const gone of ['swap', 'move_to_end']) expect(rowActions(r, 'Lat pulldown')).not.toContain(gone);
    expect(r.errors).toEqual([]);
    await r.unmount();
  });
});
