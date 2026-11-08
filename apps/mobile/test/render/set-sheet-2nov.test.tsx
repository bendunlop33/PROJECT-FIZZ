import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { ActionSheetIOS } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionAggregate } from '@fizz/schemas';

import { EditSetScreen } from '../../src/screens/workout/EditSetScreen';
import { WorkoutScreen } from '../../src/screens/workout/WorkoutScreen';
import type { AppServices } from '../../src/services/app-services';
import { dontCountMenu, setSheetKind, setSheetMenuLabel, setSheetSections, setSheetTitle } from '../../src/workout/set-edit';
import { dropPlannedWarmups, logWorkout, type Harness } from '../harness';
import { expectHealthy, renderScreen, type Rendered } from './render-screen';
import { benWithHistory, harness } from './seed';

/**
 * The set sheet (Ben, 2 Nov: "Maybe we only need set type, rest and notes?"), rendered on real workouts (real
 * SQLite, offline). Live: a set not done yet shows Set type, Rest after and Note; a done one Set type and Note. Load,
 * reps, Range, Target, Target RIR, RIR, + Weight, Don't count, Saved as, Insert set after and Delete set are gone
 * (the table edits values inline; the hold menu has RIR, Target RIR, + Weight and Delete). Saves stay versioned with
 * Undo; a done set's change is an explicit `correct_set` (rule 2). A workout that isn't live keeps the full sheet.
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.cleanup();
});

/** A live workout with Bench press: its first set logged, the rest planned. */
async function liveBench(s: AppServices, gymId: string): Promise<{ sessionId: string; done: string; pending: string }> {
  const started = await s.workout.start({ gymId, opId: h.ids(), checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
  if (!pick) throw new Error('no Bench press');
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
  if (!added.ok) throw new Error(added.error.message);
  const ex = added.aggregate.exercises.at(-1);
  if (!ex) throw new Error('no exercise');
  // (8 Nov) An added exercise now plans its own warm-ups; these tests are about working sets.
  const noWarm = await dropPlannedWarmups(h, s, sessionId, ex.id);
  let own = noWarm.sets.filter((x) => x.sessionExerciseId === ex.id && x.status !== 'deleted').sort((a, b) => a.index - b.index);
  if (own.length < 2) {
    const r = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: h.ids(), sessionExerciseId: ex.id, newSetId: h.ids(), setType: null });
    if (!r.ok) throw new Error(r.error.message);
    own = r.aggregate.sets.filter((x) => x.sessionExerciseId === ex.id && x.status !== 'deleted').sort((a, b) => a.index - b.index);
  }
  const [first, second] = own;
  if (!first || !second) throw new Error('no sets');
  h.clockMs += 60_000;
  const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: h.ids(), setId: first.id, values: { load: { value: 80, unit: ex.unit, convention: ex.loadConvention }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
  if (!logged.ok) throw new Error(logged.error.message);
  return { sessionId, done: first.id, pending: second.id };
}

const aggregateOf = async (s: AppServices, sessionId: string) => (await s.workout.load(sessionId))?.aggregate as SessionAggregate;

/** What the live sheets never show (Ben, 2 Nov). */
const LIVE_GONE = ['LOAD', 'Load', 'Reps', 'Range', 'Target RIR', 'Reps in reserve', '+ Weight', 'Leave out of records and progress', 'Spotted', 'Form broke', 'Saved as', 'Insert set after', 'Delete set', 'Do next', 'Done at'];

function expectNone(r: Rendered, words: string[]) {
  const text = `|${r.text()}|`;
  for (const w of words) expect(text, w).not.toContain(`|${w}|`);
  expect(r.text()).not.toMatch(/Target \d/);
  expect(r.text()).not.toMatch(/^Edit /);
}

const lastDispatch = (r: Rendered) => r.nav.filter((c) => c.method === 'dispatch').at(-1)?.args[0] as { payload?: { params?: { toast?: { text?: string } } } } | undefined;

describe('the set sheet’s contents (pure)', () => {
  it('live: planned is Set type, Rest after, Note; logged is Set type, Note; past keeps the full sheet', () => {
    expect([...setSheetSections('planned')]).toEqual(['set_type', 'rest', 'note']);
    expect([...setSheetSections('logged')]).toEqual(['set_type', 'note']);
    expect([...setSheetSections('past')]).toEqual(['done_at', 'values', 'add_weight', 'rir', 'target_rir', 'set_type', 'exclusions', 'note', 'saved_as', 'delete']);
    expect(setSheetKind('active', 'pending')).toBe('planned');
    expect(setSheetKind('active', 'completed')).toBe('logged');
    expect(setSheetKind('completed', 'completed')).toBe('past');
    expect(setSheetKind('completed', 'pending')).toBe('past');
    expect(setSheetTitle('planned', 'Set 2', 'Back squat')).toBe('Set 2 · Back squat');
    expect(setSheetTitle('logged', 'Warm-up', 'Back squat')).toBe('Warm-up · Back squat');
    expect(setSheetTitle('past', 'Set 2', 'Back squat')).toBe('Edit set 2 · Back squat');
    expect(setSheetMenuLabel(false)).toBe('Type, rest, note');
    expect(setSheetMenuLabel(true)).toBe('Type, note');
  });
});

describe('live: a set not done yet', () => {
  it('shows Set type, Rest after and Note only; Save is one versioned edit with Undo', async () => {
    const ben = await benWithHistory(h);
    const { sessionId, pending } = await liveBench(ben.s, ben.gymId);
    const r = await renderScreen(h, ben.launched, EditSetScreen, { name: 'EditSet', params: { sessionId, setId: pending } }, (t) => t.includes('Rest after'));
    expectHealthy(r);
    expect(r.text()).toContain('Set 2 · Bench press');
    for (const w of ['Set type', 'Rest after', 'Note', 'Save changes', 'Working', 'Back-off']) expect(r.text()).toContain(w);
    expectNone(r, LIVE_GONE);

    const before = (await aggregateOf(ben.s, sessionId)).sets.find((x) => x.id === pending);
    if (!before) throw new Error('no set');
    await r.press('Back-off');
    await r.press('+15 s');
    await r.press('Save changes');
    const after = (await aggregateOf(ben.s, sessionId)).sets.find((x) => x.id === pending);
    expect(after?.setType).toBe('backoff');
    expect(after?.rest.seconds).toBe(before.rest.seconds + 15);
    // Its target is untouched: the sheet has no values.
    expect(after?.planned.load).toEqual(before.planned.load);
    expect(after?.planned.reps).toEqual(before.planned.reps);
    expect(after?.version).toBe(before.version + 1);
    expect(lastDispatch(r)?.payload?.params?.toast?.text).toBe('Set 2 updated');
    expect(r.errors).toEqual([]);
    await r.unmount();
  });
});

describe('live: a done set', () => {
  it('shows Set type and Note only; a type change is an explicit correction with Undo, the logged values kept', async () => {
    const ben = await benWithHistory(h);
    const { sessionId, done } = await liveBench(ben.s, ben.gymId);
    const r = await renderScreen(h, ben.launched, EditSetScreen, { name: 'EditSet', params: { sessionId, setId: done } }, (t) => t.includes('Set type'));
    expectHealthy(r);
    expect(r.text()).toContain('Set 1 · Bench press');
    for (const w of ['Set type', 'Note', 'Save changes']) expect(r.text()).toContain(w);
    expectNone(r, [...LIVE_GONE, 'Rest after']);

    const before = (await aggregateOf(ben.s, sessionId)).sets.find((x) => x.id === done);
    await r.press('Back-off');
    await r.press('Save changes');
    const after = (await aggregateOf(ben.s, sessionId)).sets.find((x) => x.id === done);
    expect(after?.setType).toBe('backoff');
    expect(after?.actual).toEqual(before?.actual);
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    expect(lastDispatch(r)?.payload?.params?.toast?.text).toBe('Set 1 updated');
    await r.unmount();
  });
});

describe('a workout that isn’t live keeps the full sheet', () => {
  it('values, RIR, Don’t count, Saved as and Delete set, as before', async () => {
    const ben = await benWithHistory(h);
    const sessionId = await logWorkout(h, ben.s, ben.gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8, rpe: 8 }] }]);
    const a = await aggregateOf(ben.s, sessionId);
    expect(a.session.status).not.toBe('active');
    const setId = a.sets.find((x) => x.status === 'completed')?.id ?? '';
    const r = await renderScreen(h, ben.launched, EditSetScreen, { name: 'EditSet', params: { sessionId, setId } }, (t) => t.includes('Saved as'));
    expectHealthy(r);
    expect(r.text()).toContain('Edit set 1 · Bench press');
    for (const w of ['Done at', 'Reps', 'Reps in reserve', 'Set type', 'Leave out of records and progress', 'Spotted', 'Note', 'Saved as: ', 'Delete set']) expect(r.text()).toContain(w);
    expect(r.text()).not.toContain('Rest after');
    expect(r.text()).not.toContain('Insert set after');
    await r.unmount();
  });
});

describe('delete stays reachable in a live workout', () => {
  it('a set row’s Delete (the swipe’s VoiceOver mirror) deletes it with Undo; the hold menu keeps Delete set', async () => {
    const ben = await benWithHistory(h);
    const { sessionId, pending } = await liveBench(ben.s, ben.gymId);
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('Bench press') && t.includes('＋ Set'));
    const rows = r.all((x) => Array.isArray(x.props.accessibilityActions) && (x.props.accessibilityActions as { name: string; label?: string }[]).some((a) => a.name === 'delete') && typeof x.props.onAccessibilityAction === 'function');
    expect(rows.length).toBeGreaterThan(0);
    // Every row's actions name the slim sheet, never `Edit set`.
    for (const row of rows) {
      const labels = (row.props.accessibilityActions as { label?: string }[]).map((a) => a.label);
      expect(labels).not.toContain('Edit set');
    }
    const row = rows.find((x) => String(x.props.accessibilityLabel).includes('Set 2'));
    if (row === undefined) throw new Error(`no Set 2 row: ${rows.map((x) => String(x.props.accessibilityLabel)).join(' / ')}`);
    await act(async () => {
      (row.props.onAccessibilityAction as (e: unknown) => void)({ nativeEvent: { actionName: 'delete' } });
      await Promise.resolve();
    });
    await r.waitFor((t) => t.includes('Set 2 deleted') && t.includes('Undo'), 'the delete toast with Undo');
    expect((await aggregateOf(ben.s, sessionId)).sets.find((x) => x.id === pending)?.status).toBe('deleted');
    await r.unmount();
    // The hold menu (any set, the current one too) ends in Delete set (`delete_set`, with Undo).
    const edits = readFileSync(join(import.meta.dirname, '../../src/screens/workout/WorkoutEdits.tsx'), 'utf8');
    const menu = edits.slice(edits.indexOf('function setMenu('), edits.indexOf('// ---- The round menu'));
    expect(menu).toContain("{ name: 'delete_set', label: POPUP_COPY.deleteSet }");
  });
});

describe('Don’t count on a done set, live (Ben, 2 Nov)', () => {
  it('the picker: the four reasons in order, the set ones ticked; a pick toggles one', () => {
    const m = dontCountMenu(['pain']);
    expect(m.options).toEqual(['Spotted', 'Pain ✓', 'Form broke', 'Other equipment', 'Cancel']);
    expect(m.cancelButtonIndex).toBe(4);
    expect(m.next(0)).toEqual(['spotted', 'pain']);
    expect(m.next(1)).toEqual([]);
    expect(m.next(4)).toBeNull();
    expect(dontCountMenu(undefined).options[0]).toBe('Spotted');
  });

  it('a done row’s VoiceOver Don’t count saves the exclusion as one versioned correction with Undo; rows have no separate Change type', async () => {
    const ben = await benWithHistory(h);
    const { sessionId, done } = await liveBench(ben.s, ben.gymId);
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('Bench press') && t.includes('＋ Set'));
    const rows = r.all((x) => Array.isArray(x.props.accessibilityActions) && (x.props.accessibilityActions as { name: string }[]).some((a) => a.name === 'edit') && typeof x.props.onAccessibilityAction === 'function');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect((row.props.accessibilityActions as { name: string }[]).map((a) => a.name)).not.toContain('type');
    const doneRow = rows.find((x) => (x.props.accessibilityActions as { name: string }[]).some((a) => a.name === 'dont_count'));
    if (doneRow === undefined) throw new Error('no done row with Don’t count');
    // Only the done set offers it.
    expect(rows.filter((x) => (x.props.accessibilityActions as { name: string }[]).some((a) => a.name === 'dont_count'))).toHaveLength(1);

    const before = (await aggregateOf(ben.s, sessionId)).sets.find((x) => x.id === done);
    let shown: string[] = [];
    vi.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((o: { options: string[] }, cb: (i: number) => void) => {
      shown = o.options;
      cb(o.options.indexOf('Spotted'));
    });
    await act(async () => {
      (doneRow.props.onAccessibilityAction as (e: unknown) => void)({ nativeEvent: { actionName: 'dont_count' } });
      await Promise.resolve();
    });
    expect(shown).toEqual(['Spotted', 'Pain', 'Form broke', 'Other equipment', 'Cancel']);
    await r.waitFor((t) => t.includes('not counted for records') && t.includes('Undo'), 'the exclusion toast with Undo');
    const after = (await aggregateOf(ben.s, sessionId)).sets.find((x) => x.id === done);
    expect(after?.exclusions).toEqual(['spotted']);
    expect(after?.actual).toEqual(before?.actual);
    expect(after?.version).toBe((before?.version ?? 0) + 1);

    await r.press('Undo');
    for (let i = 0; i < 50 && ((await aggregateOf(ben.s, sessionId)).sets.find((x) => x.id === done)?.exclusions ?? []).length > 0; i += 1) {
      await act(async () => {
        await new Promise((res) => setTimeout(res, 10));
      });
    }
    expect((await aggregateOf(ben.s, sessionId)).sets.find((x) => x.id === done)?.exclusions ?? []).toEqual([]);
    expect(r.errors).toEqual([]);
    await r.unmount();

    // The hold menu: Don't count for done sets; no separate Change type beside the set sheet's item.
    const screen = readFileSync(join(import.meta.dirname, '../../src/screens/workout/WorkoutScreen.tsx'), 'utf8');
    expect(screen).toContain('...targetRirItem(setId), ...dontCountItem(setId), { label: setSheetMenuLabel(');
    const edits = readFileSync(join(import.meta.dirname, '../../src/screens/workout/WorkoutEdits.tsx'), 'utf8');
    const menu = edits.slice(edits.indexOf('function setMenu('), edits.indexOf('// ---- The round menu'));
    expect(menu).not.toContain('POPUP_COPY.changeType');
  });
});
