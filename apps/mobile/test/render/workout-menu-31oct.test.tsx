import { act } from 'react';
import { ActionSheetIOS } from 'react-native';
import type { TestInstance } from 'test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionRounds } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { WorkoutScreen } from '../../src/screens/workout/WorkoutScreen';
import type { AppServices } from '../../src/services/app-services';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen, type Rendered } from './render-screen';
import { benWithHistory, harness } from './seed';

/**
 * (Ben, 31 Oct: "Do you think we need all this when in workout mode?") The round page's `⋯`, rendered on a real
 * workout (real SQLite): Swap, Do next, Move to end, Add set, History, Plates (barbell only, never dumbbells or a
 * stack), Notes, Skip; Adjust on the current exercise. A pick runs through the screen to the stored order.
 */

type Sheet = { options: string[]; pick: (i: number) => void };

let h: Harness;
let sheets: Sheet[];
beforeEach(() => {
  h = harness();
  sheets = [];
  vi.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((o, cb) => {
    sheets.push({ options: o.options, pick: (i) => { cb(i); } });
  });
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

/** An overview row's `⋯` (its VoiceOver `menu` action, as the ⋯ button): the menu opens once the sheet has gone. */
async function overviewMenu(r: Rendered, name: string): Promise<Sheet> {
  await tap(byLabel(r, 'Workout overview'));
  const row = r.all((x) => typeof x.props.onAccessibilityAction === 'function' && typeof x.props.accessibilityLabel === 'string' && x.props.accessibilityLabel.includes(`, ${name}, `))[0];
  if (row === undefined) throw new Error(`no overview row for ${name}`);
  const before = sheets.length;
  await act(async () => {
    (row.props.onAccessibilityAction as (e: unknown) => void)({ nativeEvent: { actionName: 'menu' } });
    await Promise.resolve();
  });
  await r.waitFor(() => sheets.length > before, `${name} menu`);
  const sheet = sheets.at(-1);
  if (sheet === undefined) throw new Error('no sheet');
  return sheet;
}

describe('the round page’s ⋯ (Ben, 31 Oct)', () => {
  it('trimmed, in order; Plates for the barbell only; Do next / Move to end only where they move something', async () => {
    const ben = await benWithHistory(h);
    const sessionId = await workoutOf(ben.s, ben.gymId, ['Bench press', 'Incline dumbbell press', 'Lat pulldown']);
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('Bench press') && t.includes('＋ Set'));
    expectHealthy(r);

    // The current exercise (a barbell): no Do next / Move to end; Plates; Adjust last before Skip.
    await tap(byLabel(r, 'Bench press menu'));
    const bench = sheets.at(-1);
    expect(bench?.options).toEqual(['Swap exercise', 'Add set', 'History', 'Plates', 'Notes', 'Adjust', 'Skip exercise', 'Cancel']);

    // The next one (per-hand dumbbells): no Plates, no Do next (it is next), Move to end.
    const incline = await overviewMenu(r, 'Incline dumbbell press');
    expect(incline.options).toEqual(['Swap exercise', 'Move to end', 'Add set', 'History', 'Notes', 'Skip exercise', 'Cancel']);

    // The last one (a stack): Do next, no Move to end, no Plates. Picking Do next reorders the stored workout.
    const lat = await overviewMenu(r, 'Lat pulldown');
    expect(lat.options).toEqual(['Swap exercise', 'Do next', 'Add set', 'History', 'Notes', 'Skip exercise', 'Cancel']);
    for (const gone of ['Edit set', 'Target RIR', 'Delete this set', 'Add exercise', 'Not at this gym', 'Remove exercise']) expect([...bench?.options ?? [], ...incline.options, ...lat.options]).not.toContain(gone);
    await act(async () => {
      lat.pick(lat.options.indexOf('Do next'));
      await Promise.resolve();
    });
    const order = async () => sessionRounds((await ben.s.workout.load(sessionId))?.aggregate as SessionAggregate).map((x) => x.members[0]?.exerciseName);
    await r.waitFor(() => r.text().includes('Lat pulldown next'), 'the Do next toast');
    expect(await order()).toEqual(['Bench press', 'Lat pulldown', 'Incline dumbbell press']);
    // The toast's Undo puts it back.
    await r.press('Undo');
    await r.waitFor(() => !r.text().includes('Lat pulldown next'), 'the toast gone');
    expect(await order()).toEqual(['Bench press', 'Incline dumbbell press', 'Lat pulldown']);
    expect(r.errors).toEqual([]);
    await r.unmount();
  });

  it('Not at this gym is a row in the Swap sheet: it tells the gym, with Undo, and the sheet stays open', async () => {
    const ben = await benWithHistory(h);
    await workoutOf(ben.s, ben.gymId, ['Bench press', 'Lat pulldown']);
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('Bench press') && t.includes('＋ Set'));
    await tap(byLabel(r, 'Bench press menu'));
    const bench = sheets.at(-1);
    if (bench === undefined) throw new Error('no menu');
    await act(async () => {
      bench.pick(bench.options.indexOf('Swap exercise'));
      await Promise.resolve();
    });
    await r.waitFor((t) => t.includes('Swap Bench press') && t.includes('Not at this gym'), 'the Swap sheet with Not at this gym');
    await r.press('Not at this gym');
    await r.waitFor((t) => t.includes('Undo') && !t.includes('|Not at this gym|'), 'the gym told, with Undo');
    expect(r.text()).toContain('Swap Bench press');
    expect(r.errors).toEqual([]);
    await r.unmount();
  });
});
