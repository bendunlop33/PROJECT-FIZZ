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

async function openMenu(r: Rendered, name: string, button = `${name} menu`): Promise<string[]> {
  await tap(byLabel(r, button));
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
  it('on the current exercise with nothing logged: Later and Down; Plates for the barbell; Adjust; the former pop-up’s rows; Skip and Remove last; no Cancel', async () => {
    const ben = await benWithHistory(h);
    const sessionId = await workoutOf(ben.s, ben.gymId, ['Bench press', 'Incline dumbbell press', 'Lat pulldown']);
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('Bench press') && t.includes('＋ Set'));
    expectHealthy(r);

    expect(await openMenu(r, 'Bench press')).toEqual(['Move to end', 'Move down', 'Swap exercise', 'Add set', 'History', 'Notes', 'Plates', 'Adjust', 'How to', 'Add warm-up', 'Rest, 3:00', 'Superset with next', 'Why this weight?', 'Skip exercise', 'Remove exercise']);
    // The icon row's own words; no Cancel row (a tap outside closes it).
    expect(r.text()).toContain('|Later|Down|');
    for (const gone of ['Cancel', 'Edit set', 'Target RIR', 'Delete this set', 'Add exercise', 'Not at this gym', 'Unlink', 'Move up', 'Do next', 'Now', 'Up']) expect(r.text()).not.toContain(`|${gone}|`);

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

describe('the name’s pop-up moved into the menu (Ben, 2 Nov: "Yes move to menu")', () => {
  const header = (r: Rendered, name: string): TestInstance | undefined => r.all((x) => x.props.accessibilityRole === 'header' && typeof x.props.accessibilityLabel === 'string' && x.props.accessibilityLabel.includes(`, ${name}, `) && typeof x.props.onAccessibilityAction === 'function')[0];

  it('a tap on the name opens nothing; VoiceOver has exactly the menu’s items on the header', async () => {
    const ben = await benWithHistory(h);
    await workoutOf(ben.s, ben.gymId, ['Bench press', 'Incline dumbbell press', 'Lat pulldown']);
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('Bench press') && t.includes('＋ Set'));
    const head = header(r, 'Bench press');
    expect(head).toBeDefined();
    expect(head?.props.onPress).toBeUndefined();
    expect(typeof head?.props.onLongPress).toBe('function');
    expect(head?.props.accessibilityHint).toBeUndefined();
    const items = await openMenu(r, 'Bench press');
    const a11y = ((head?.props.accessibilityActions ?? []) as { name: string; label: string }[]).filter((x) => !['next', 'previous', 'menu'].includes(x.name)).map((x) => x.label);
    expect(a11y).toEqual(items);
    expect(r.errors).toEqual([]);
    await r.unmount();
  });

  it('each former pop-up action runs from the menu on the stored workout: Superset with next / Unlink, Add warm-up, Rest, Why this weight?, How to, Remove', async () => {
    const ben = await benWithHistory(h);
    const sessionId = await workoutOf(ben.s, ben.gymId, ['Bench press', 'Incline dumbbell press', 'Lat pulldown']);
    const load = async () => (await ben.s.workout.load(sessionId))?.aggregate as SessionAggregate;
    const exOf = async (name: string) => (await load()).exercises.find((e) => e.exerciseName === name && e.removed === undefined);
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('Bench press') && t.includes('＋ Set'));

    // Superset with next: Bench and Incline paired; then the menu offers Unlink instead, and it splits them.
    await openMenu(r, 'Bench press');
    await pick(r, 'Bench press', 'Superset with next');
    await r.waitFor((t) => t.includes('|1a|Bench press|') && t.includes('|1b|Incline dumbbell press|'), 'the superset on the page');
    expect((await exOf('Bench press'))?.supersetGroup).not.toBeNull();
    expect((await exOf('Incline dumbbell press'))?.supersetGroup).toBe((await exOf('Bench press'))?.supersetGroup);
    await r.waitFor(() => menuItems(r, 'Bench press').length === 0, 'the menu gone');
    const items = await openMenu(r, 'Bench press', '1a Bench press menu');
    expect(items).toContain('Unlink');
    // No warm-ups in a superset (the pop-up's rule): Add warm-up isn't offered.
    expect(items).not.toContain('Add warm-up');
    await pick(r, 'Bench press', 'Unlink');
    await r.waitFor((t) => t.includes('Superset removed'), 'the Unlink toast');
    expect((await exOf('Bench press'))?.supersetGroup).toBeNull();

    // Add warm-up: one more warm-up set on Bench, with Undo.
    const warmups = async () => {
      const a = await load();
      const id = a.exercises.find((e) => e.exerciseName === 'Bench press')?.id;
      return a.sets.filter((x) => x.sessionExerciseId === id && x.setType === 'warmup' && x.status !== 'deleted').length;
    };
    const w0 = await warmups();
    await r.waitFor(() => menuItems(r, 'Bench press').length === 0, 'the menu gone');
    await openMenu(r, 'Bench press');
    await pick(r, 'Bench press', 'Add warm-up');
    await r.waitFor((t) => t.includes('Warm-up added') && t.includes('Undo'), 'the warm-up toast with Undo');
    expect(await warmups()).toBe(w0 + 1);

    // Rest: the per-type sheet; + on Working sets adds 15 s to Bench's pending working sets (today only).
    const workingRest = async () => {
      const a = await load();
      const id = a.exercises.find((e) => e.exerciseName === 'Bench press')?.id;
      return a.sets.find((x) => x.sessionExerciseId === id && x.setType === 'working' && x.status === 'pending')?.rest.seconds;
    };
    const rest0 = await workingRest();
    await r.waitFor(() => menuItems(r, 'Bench press').length === 0, 'the menu gone');
    await openMenu(r, 'Bench press');
    await pick(r, 'Bench press', 'Rest, 3:00');
    await r.waitFor((t) => t.includes('|Rest|') && t.includes('|Working sets|') && t.includes('|3:00|'), 'the Rest sheet');
    expect(rest0).toBe(180);
    await tap(byLabel(r, 'More Working sets'));
    await r.waitFor((t) => t.includes('|3:15|'), 'the rest stepped');
    expect(await workingRest()).toBe(195);
    await r.press('Done');

    // Why this weight?: the stored target's reasons (no rule runs), in an alert.
    const { Alert } = await import('react-native');
    const alert = vi.spyOn(Alert, 'alert');
    await r.waitFor(() => menuItems(r, 'Bench press').length === 0, 'the menu gone');
    await openMenu(r, 'Bench press');
    await pick(r, 'Bench press', 'Why this weight?');
    await r.waitFor(() => alert.mock.calls.length > 0, 'the Why alert');
    expect(alert.mock.calls[0]?.[0]).toBe('Why this weight?');
    expect(String(alert.mock.calls[0]?.[1]).length).toBeGreaterThan(0);

    // How to: the exercise's guide.
    await r.waitFor(() => menuItems(r, 'Bench press').length === 0, 'the menu gone');
    await openMenu(r, 'Bench press');
    await pick(r, 'Bench press', 'How to');
    await r.waitFor(() => r.nav.some((c) => c.method === 'navigate' && c.args[0] === 'HowTo'), 'the How to guide');

    // Remove (nothing logged: at once, with Undo).
    await r.waitFor(() => menuItems(r, 'Bench press').length === 0, 'the menu gone');
    await openMenu(r, 'Bench press');
    await pick(r, 'Bench press', 'Remove exercise');
    await r.waitFor((t) => t.includes('Bench press removed') && t.includes('Undo'), 'the Remove toast with Undo');
    expect(await exOf('Bench press')).toBeUndefined();
    await r.press('Undo');
    await r.waitFor((t) => !t.includes('Bench press removed'), 'the Remove toast gone');
    expect(await exOf('Bench press')).toBeDefined();
    expect(r.errors).toEqual([]);
    await r.unmount();
  });
});
