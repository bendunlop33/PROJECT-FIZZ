import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gymSwitchRefusal, isProposalStale, NBSP, repeatPreviewLines } from '@fizz/domain';

import { afterSwitchRefused, cardIsStale, logBlockedBySwitch, reviewOpenAfterCheckAgain, logGuardAfterSwitch, onGymChosen, reviewSheetView, sheetClosesOn, switchCardView, switchedToast, undoneToast, type OpenSwitchCard } from '../src/workout/gym-switch-card';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Mid-workout gym switch through the app's services on real SQLite files
 * (gym-switch.md §7): propose, Switch, force-close, Undo, refused Undo,
 * Add set and the picker at the new gym. Everything is local.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

async function setUp() {
  const { services: s } = await h.launch();
  const mainId = await setUpGym(h, s);
  const hotelId = h.ids();
  expect(await s.setup.saveGym({ gymId: hotelId, name: 'Hotel · Lisbon', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).toEqual({ ok: true });
  // History, so today's exercises get targets from the built-in rule.
  await logWorkout(h, s, mainId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }] },
    { exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 8 }] },
  ]);
  h.clockMs += 2 * 86_400_000;
  const started = await s.workout.start({ gymId: mainId, opId: 'today', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  for (const name of ['Bench press', 'Dumbbell bench press']) {
    const pick = (await s.workout.pickerExercises(sessionId, name)).find((p) => p.exercise.name === name);
    if (!pick) throw new Error(name);
    const r = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  }
  // Log bench set 1 at Main Gym.
  const data = await s.workout.load(sessionId);
  if (!data) throw new Error('no workout');
  const v = s.workout.view(data, h.clockMs, null);
  if (!v.focus) throw new Error('no focus');
  h.clockMs += 60_000;
  const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v.focus.opId, setId: v.focus.setId, values: v.focus.logValues, restTimerId: h.ids() });
  if (!logged.ok) throw new Error(logged.error.message);
  return { s, mainId, hotelId, sessionId };
}

describe('gym switch through the services', () => {
  it('3 steps: list gyms, propose (nothing changes), Switch; done sets untouched; the result survives a force-close', async () => {
    const { s, mainId, hotelId, sessionId } = await setUp();
    expect((await s.gymSwitch.gyms(sessionId)).map((g) => [g.name, g.current])).toEqual([
      ['Main Gym', true],
      ['Hotel · Lisbon', false],
    ]);
    const before = await s.workout.load(sessionId);
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p || !before) throw new Error('no proposal');
    expect(p.card.title).toBe('Switch to Hotel · Lisbon');
    expect(p.card.notChanged).toEqual([]);
    expect(p.card.lines.map((l) => [l.exerciseName, l.after === null ? 'kept' : 'dropped'])).toEqual([
      ['Bench press', 'dropped'],
      ['Dumbbell bench press', 'kept'],
    ]);
    expect(p.card.lines[1]?.notes.map((n) => n.text)).toEqual(['Max here 25 kg each']);
    // Proposing changed nothing.
    expect(await s.workout.load(sessionId)).toEqual(before);

    const applied = await s.gymSwitch.apply(p, 'switch-1');
    if (!applied.ok) throw new Error(applied.error.message);
    const again = await s.gymSwitch.apply(p, 'switch-1');
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(applied.aggregate.session.gymId).toBe(hotelId);
    const done = before.aggregate.sets.filter((x) => x.status === 'completed');
    for (const d of done) expect(applied.aggregate.sets.find((x) => x.id === d.id)).toEqual(d);

    // Force-close and relaunch: the switch is all there, and the notes read the same.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const data = await s2.workout.load(sessionId);
    if (!data) throw new Error('no workout');
    expect(data.aggregate.session.gymId).toBe(hotelId);
    expect(data.gymName).toBe('Hotel · Lisbon');
    const v = s2.workout.view(data, h.clockMs, null);
    expect(v.focus?.exerciseName).toBe('Bench press');
    expect(v.focus?.snapNote?.text).toBe('No load target · no barbell and plates here · plan 100 kg');
    expect(v.focus?.rows.map((r) => [r.status, r.gymCaption, r.partStart])).toEqual([
      ['done', 'Main Gym', null],
      ['active', null, 'At Hotel · Lisbon'],
    ]);
    expect(v.primary.label).toBe('Enter load');
    // The picker and Add exercise offer only Hotel's items now.
    const picks = await s2.workout.pickerExercises(sessionId, 'Lat pulldown');
    expect(picks.find((x) => x.exercise.name === 'Lat pulldown')?.equipment).toEqual([]);
    const dbPicks = await s2.workout.pickerExercises(sessionId, 'Dumbbell curl');
    expect(dbPicks[0]?.equipment.map((e) => e.name)).toEqual((await s2.yourData.equipment(hotelId)).filter((e) => e.kind === 'dumbbells').map((e) => e.name));
    expect(mainId).not.toBe(hotelId);
  });

  it('Undo restores Main Gym exactly; after a set is logged at Hotel it is refused and a Switch back card is offered', async () => {
    const { s, mainId, hotelId, sessionId } = await setUp();
    const before = await s.workout.load(sessionId);
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p || !before) throw new Error('no proposal');
    await s.gymSwitch.apply(p, 'switch-a');
    const undone = await s.gymSwitch.undo(sessionId, 'undo-a');
    if (!undone.ok) throw new Error(undone.message);
    expect(undone.gymName).toBe('Main Gym');
    const after = undone.outcome.aggregate;
    expect(after.session.gymId).toBe(mainId);
    for (const x of before.aggregate.sets) expect({ ...after.sets.find((y) => y.id === x.id), version: 0 }).toEqual({ ...x, version: 0 });

    // Switch again, log a set at Hotel, then Undo: refused, never a silent revert.
    const p2 = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p2) throw new Error('no proposal');
    const applied = await s.gymSwitch.apply(p2, 'switch-b');
    if (!applied.ok) throw new Error(applied.error.message);
    const data = await s.workout.load(sessionId);
    if (!data) throw new Error('no workout');
    const v = s.workout.view(data, h.clockMs, null);
    h.clockMs += 60_000;
    await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v.focus?.opId ?? '', setId: v.focus?.setId ?? '', values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    expect(isProposalStale(p2, (await s.workout.load(sessionId))?.aggregate ?? data.aggregate)).toBe(true);
    const refused = await s.gymSwitch.undo(sessionId, 'undo-b');
    expect(refused).toMatchObject({ ok: false, message: 'Can’t undo: your workout changed since the switch.' });
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.back?.card.title).toBe('Switch back to Main Gym');
    expect(refused.back?.card.lines.find((l) => l.exerciseName === 'Dumbbell bench press')?.notes.map((n) => n.text)).toEqual(['Back to plan']);
    expect((await s.workout.load(sessionId))?.aggregate.session.gymId).toBe(hotelId);
  });

  it('a switched workout reads Main Gym → Hotel · Lisbon in its Summary and Past workouts (check 24)', async () => {
    const { s, hotelId, sessionId } = await setUp();
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p) throw new Error('no proposal');
    const applied = await s.gymSwitch.apply(p, 'switch-route');
    if (!applied.ok) throw new Error(applied.error.message);
    h.clockMs += 60_000;
    const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'fin-route', expectedVersion: applied.aggregate.session.version, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    expect((await s.workout.summary(sessionId))?.gymName).toBe('Main Gym → Hotel · Lisbon');
    const row = (await s.repeat.candidates()).rows.find((r) => r.sessionId === sessionId);
    expect(row?.gymName).toBe('Main Gym → Hotel · Lisbon');
  });

  it('Add set on bench (all done at Main) goes on Hotel’s equipment with no barbell target', async () => {
    const { s, hotelId, sessionId } = await setUp();
    const data = await s.workout.load(sessionId);
    const bench = data?.aggregate.exercises.find((e) => e.exerciseName === 'Bench press');
    if (!data || !bench) throw new Error('no bench');
    // Skip the remaining bench set, so all of bench is at Main, then switch.
    await s.workout.dispatch(sessionId, { type: 'skip_exercise', at: h.now(), opId: 'skip-bench', sessionExerciseId: bench.id });
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p) throw new Error('no proposal');
    await s.gymSwitch.apply(p, 'switch-c');
    const r = await s.workout.addSet({ sessionId, sessionExerciseId: bench.id, opId: 'add-1', newSetId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
    const cont = r.aggregate.exercises.find((e) => e.continuesFromId === bench.id);
    expect(cont).toMatchObject({ equipmentId: null });
    const added = r.aggregate.sets.find((x) => x.sessionExerciseId === cont?.id);
    expect(added?.planned.load).toBeNull();
    expect(added?.planned.snap).toMatchObject({ outcome: 'dropped', reason: 'not_here' });
  });

  it('Repeat preview at another gym re-checks every row without starting anything (GS10)', async () => {
    const { services: s } = await h.launch();
    const mainId = await setUpGym(h, s);
    const hotelId = h.ids();
    await s.setup.saveGym({ gymId: hotelId, name: 'Hotel · Lisbon', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') });
    const past = await logWorkout(h, s, mainId, [{ exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 8 }] }]);
    const atMain = await s.repeat.preview(past, mainId);
    const atHotel = await s.repeat.preview(past, hotelId);
    expect(atMain?.notes).toEqual([]);
    expect(atHotel?.notes.map((n) => plain(n.text))).toEqual(['Max here 25 kg each · last time 32.5 kg each']);
    expect(await s.sessions.active()).toBeNull();
  });

  it('Start at the gym chosen on the chip gives what its preview showed (check 23); a missing bar is a warning with no load target (check 4)', async () => {
    const { services: s } = await h.launch();
    const mainId = await setUpGym(h, s);
    const hotelId = h.ids();
    await s.setup.saveGym({ gymId: hotelId, name: 'Hotel · Lisbon', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') });
    const past = await logWorkout(h, s, mainId, [
      { exercise: 'Bench press', sets: [{ load: 100, reps: 5 }] },
      { exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 8 }] },
    ]);
    const atHotel = await s.repeat.preview(past, hotelId);
    if (!atHotel) throw new Error('no preview');
    const bar = atHotel.notes.find((n) => n.exerciseName === 'Bench press');
    expect(bar?.tone).toBe('warning');
    expect(plain(bar?.text)).toMatch(/^No load target · no .+ here · last time 100 kg × 5$/);
    expect(atHotel.notes.find((n) => n.exerciseName === 'Dumbbell bench press')?.tone).toBe('info');
    h.clockMs += 86_400_000;
    const started = await s.workout.start({ gymId: hotelId, opId: 'repeat-at-hotel', checkIn: { kind: 'skipped', atUtc: h.now().utc }, repeatOf: past });
    if (!started.ok) throw new Error(started.error.message);
    expect(started.aggregate.session.gymId).toBe(hotelId);
    expect(repeatPreviewLines(started.aggregate)).toEqual(atHotel.exercises);
    const bench = started.aggregate.exercises.find((e) => e.exerciseName === 'Bench press');
    const benchSets = started.aggregate.sets.filter((x) => x.sessionExerciseId === bench?.id);
    expect(benchSets.map((x) => [x.status, x.planned.load, x.planned.reps])).toEqual([['pending', null, { min: 5, max: 5 }]]);
    expect(bench?.equipmentId).toBeNull();
  });
});

describe('next session after a split exercise (review r2 B1)', () => {
  it('1 set at Main, 2 at Hotel: Today’s card and Start next session build 3 sets, and the Summary has one Next time row', async () => {
    const { services: s } = await h.launch();
    const mainId = await setUpGym(h, s);
    const hotelId = h.ids();
    expect(await s.setup.saveGym({ gymId: hotelId, name: 'Hotel · Lisbon', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).toEqual({ ok: true });
    const started = await s.workout.start({ gymId: mainId, opId: 'split-start', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const pick = (await s.workout.pickerExercises(sessionId, 'Dumbbell bench press')).find((x) => x.exercise.name === 'Dumbbell bench press');
    if (!pick) throw new Error('no exercise');
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
    const row = added.aggregate.exercises.at(-1);
    if (!row) throw new Error('no row');
    let own = added.aggregate.sets.filter((x) => x.sessionExerciseId === row.id);
    for (let i = own.length; i < 3; i += 1) {
      const r = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: h.ids(), sessionExerciseId: row.id, newSetId: h.ids(), setType: null });
      if (!r.ok) throw new Error(r.error.message);
      own = r.aggregate.sets.filter((x) => x.sessionExerciseId === row.id);
    }
    for (const extra of own.slice(3)) await s.workout.dispatch(sessionId, { type: 'delete_set', at: h.now(), opId: h.ids(), setId: extra.id, expectedSetVersion: extra.version });
    const log = async (setId: string, load: number, reps: number) => {
      h.clockMs += 60_000;
      const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${setId}`, setId, values: { load: { value: load, unit: 'kg', convention: 'per_hand' }, reps, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
      return r.aggregate;
    };
    const first = [...own].sort((a, b) => a.index - b.index)[0];
    await log(first?.id ?? '', 32.5, 9);
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p) throw new Error('no proposal');
    const applied = await s.gymSwitch.apply(p, 'split-switch');
    if (!applied.ok) throw new Error(applied.error.message);
    const cont = applied.aggregate.exercises.find((e) => e.continuesFromId === row.id);
    const moved = applied.aggregate.sets.filter((x) => x.sessionExerciseId === cont?.id && x.status === 'pending').sort((a, b) => a.index - b.index);
    expect(moved).toHaveLength(2);
    await log(moved[0]?.id ?? '', 20, 12);
    const last = await log(moved[1]?.id ?? '', 20, 11);
    h.clockMs += 60_000;
    const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'split-fin', expectedVersion: last.session.version, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);

    const sum = await s.workout.summary(sessionId);
    const rows = sum?.nextTime?.rows.filter((r) => r.exerciseName === 'Dumbbell bench press') ?? [];
    // One row, from the Hotel part (the latest with equipment; spec §6.5), saying so. Its
    // other part isn't called "an earlier session left out", and 3 of 3 sets were done.
    expect(rows.map((r) => [r.kind, plain(r.target), r.decision])).toEqual([['change', 'Target 22.5 kg each × 6–10', 'increase_load']]);
    expect(rows[0]?.facts[0]).toBe('Done at more than one gym: target from your Hotel · Lisbon sets, for all 3 sets.');
    expect(rows[0]?.facts.some((f) => /left out|Only \d+ of/.test(f))).toBe(false);

    h.clockMs += 2 * 86_400_000;
    const preview = await s.next.preview(mainId);
    expect(preview?.exercises.map((e) => e.exerciseName)).toEqual(['Dumbbell bench press']);
    expect(plain(preview?.exercises[0]?.line)).toBe('3 sets · 22.5 kg each × 6–10 · 22.5 kg each × 6–10 · 22.5 kg each × 6–10');
    const next = await s.workout.start({ gymId: mainId, opId: 'split-next', checkIn: null, nextOf: sessionId });
    if (!next.ok) throw new Error(next.error.message);
    const exRows = next.aggregate.exercises.filter((e) => e.exerciseName === 'Dumbbell bench press');
    expect(exRows).toHaveLength(1);
    const sets = next.aggregate.sets.filter((x) => x.sessionExerciseId === exRows[0]?.id);
    expect(sets).toHaveLength(3);
    expect(sets.every((x) => x.planned.source === 'built_in_rule')).toBe(true);
    expect(sets.map((x) => [x.planned.load?.value, x.planned.reps])).toEqual(Array.from({ length: 3 }, () => [22.5, { min: 6, max: 10 }]));
    expect(repeatPreviewLines(next.aggregate).map((l) => l.line)).toEqual(preview?.exercises.map((e) => e.line));
  });
});

describe('the switch card on screen (gym-switch §2.2–§3.3)', () => {
  it('Ready: Checks · Today only, Not now and Switch; Applying disables both; a write error offers Try again with the same opId', async () => {
    const { s, hotelId, sessionId } = await setUp();
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    const data = await s.workout.load(sessionId);
    if (!p || !data) throw new Error('no proposal');
    const card: OpenSwitchCard = { proposal: p, opId: 'op-1', status: 'ready' };
    const v = switchCardView(card, data.aggregate);
    expect(v.title).toBe('Switch to Hotel · Lisbon');
    expect(v.tags).toEqual(['Checks', 'Today only']);
    expect(v.notChanged).toEqual([]);
    expect(v.buttons.map((b) => b.label)).toEqual(['Not now', 'Switch']);
    expect(v.status).toBeNull();
    const applying = switchCardView({ ...card, status: 'applying' }, data.aggregate);
    expect(applying.buttons).toEqual([
      { id: 'not_now', label: 'Not now', disabled: true },
      { id: 'switch', label: 'Switching…', disabled: true },
    ]);
    const failed = switchCardView({ ...card, status: 'error' }, data.aggregate);
    expect(failed.status).toEqual({ tone: 'warning', text: 'Couldn’t switch gym.' });
    expect(failed.buttons.at(-1)).toEqual({ id: 'try_again', label: 'Try again' });
  });

  it('a refusal other than a write error or Out of date closes the card and says why; the cap is refused before a card (review r2 M1)', async () => {
    const { s, mainId, hotelId, sessionId } = await setUp();
    // 24 switch + Undo pairs: 48 records. One more switch makes 49, and its way back can't fit with an Undo.
    for (let i = 0; i < 24; i += 1) {
      const p = await s.gymSwitch.propose(sessionId, hotelId);
      if (!p) throw new Error('no proposal');
      const a = await s.gymSwitch.apply(p, `cap-${String(i)}`);
      if (!a.ok) throw new Error(a.error.message);
      const u = await s.gymSwitch.undo(sessionId, `cap-u-${String(i)}`);
      if (!u.ok) throw new Error(u.message);
    }
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p) throw new Error('no proposal');
    const a = await s.gymSwitch.apply(p, 'cap-last');
    if (!a.ok) throw new Error(a.error.message);
    const back = await s.gymSwitch.propose(sessionId, mainId);
    if (!back) throw new Error('no proposal');
    const card: OpenSwitchCard = { proposal: back, opId: 'cap-back', status: 'applying' };
    const r = await s.gymSwitch.apply(back, card.opId);
    if (r.ok) throw new Error('expected a refusal');
    expect(r.error.code).toBe('invalid_values');
    expect(afterSwitchRefused(card, r.error)).toEqual({ card: null, toast: 'Couldn’t switch gym. This workout has changed gym too many times. Finish it and start a new one at this gym.' });
    // The screen checks this before building a card, so Ben never sees a Switch that can't work.
    expect(gymSwitchRefusal((await s.workout.load(sessionId))?.aggregate.session ?? a.aggregate.session)).toBe('This workout has changed gym too many times. Finish it and start a new one at this gym.');
    // A write error keeps the card for Try again; Out of date keeps it for the reload to show.
    expect(afterSwitchRefused(card, { code: 'write_failed', message: 'disk' })).toEqual({ card: { ...card, status: 'error' }, toast: null });
    expect(afterSwitchRefused(card, { code: 'stale_version', message: 'x' })).toEqual({ card: { ...card, status: 'ready' }, toast: null });
  });

  it('Out of date after a set is logged: Switch hidden, Dismiss and Check again; tapping another set or editing a draft does not', async () => {
    const { s, hotelId, sessionId } = await setUp();
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    const data = await s.workout.load(sessionId);
    if (!p || !data) throw new Error('no proposal');
    const card: OpenSwitchCard = { proposal: p, opId: 'op-2', status: 'ready' };
    // Choosing another pending set isn't a change to what the card changes (GS7).
    const other = data.aggregate.sets.find((x) => x.status === 'pending' && x.id !== data.aggregate.session.activeSetId);
    if (!other) throw new Error('no other set');
    const moved = await s.workout.dispatch(sessionId, { type: 'set_active_set', at: h.now(), opId: 'active-1', setId: other.id, expectedVersion: data.aggregate.session.version });
    if (!moved.ok) throw new Error(moved.error.message);
    expect(cardIsStale(card, moved.aggregate)).toBe(false);
    const fresh = await s.workout.load(sessionId);
    if (!fresh) throw new Error('no workout');
    const v = s.workout.view(fresh, h.clockMs, null);
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v.focus?.opId ?? '', setId: v.focus?.setId ?? '', values: v.focus?.logValues ?? { load: null, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const stale = switchCardView(card, logged.aggregate);
    expect(stale.status?.text).toBe('Out of date');
    expect(stale.buttons.map((b) => b.id)).toEqual(['dismiss', 'check_again']);
    expect(stale.tags).toBeNull();
    expect(stale.muted).toBe(true);
    // The reducer refuses it too, by tap or voice (rule 5).
    const refused = await s.gymSwitch.apply(p, 'op-2');
    expect(refused.ok).toBe(false);
  });

  it('toasts, gym choice and the Log guard', async () => {
    const { s, mainId, hotelId, sessionId } = await setUp();
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p) throw new Error('no proposal');
    expect(switchedToast(p)).toBe('Switched to Hotel · Lisbon. Remaining sets updated for today.');
    const same = await s.gymSwitch.propose(sessionId, mainId);
    if (!same) throw new Error('no proposal');
    expect(same.card.title).toBe('Use updated Main Gym');
    expect(switchedToast(same)).toBe('Using updated Main Gym. No targets changed.');
    expect(undoneToast('Main Gym')).toBe('Back at Main Gym. Remaining sets restored.');
    expect(onGymChosen(mainId, mainId)).toBe('dismiss');
    expect(onGymChosen(mainId, hotelId)).toBe('propose');
    expect(logGuardAfterSwitch('Log 100 kg × 8', 'Log 100 kg × 8')).toBe(false);
    expect(logGuardAfterSwitch('Log 100 kg × 8', 'Enter load')).toBe(true);
  });

  it('5 or more change lines: 3 on the card and Review all N changes; Switch only on the review sheet', async () => {
    const { s, hotelId, sessionId } = await setUp();
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    const data = await s.workout.load(sessionId);
    if (!p || !data) throw new Error('no proposal');
    const many = { ...p, card: { ...p.card, lines: [...p.card.lines, ...p.card.lines, ...p.card.lines], visibleLines: 3, reviewLabel: 'Review all 6 changes ›' } };
    const card: OpenSwitchCard = { proposal: many, opId: 'op-3', status: 'ready' };
    const v = switchCardView(card, data.aggregate);
    expect(v.lines).toHaveLength(3);
    expect(v.buttons.map((b) => b.id)).toEqual(['not_now', 'review']);
    const sheet = reviewSheetView(card, data.aggregate);
    expect(sheet.lines).toHaveLength(6);
    expect(sheet.primary).toEqual({ id: 'switch', label: 'Switch', disabled: false });
    expect(sheet.secondary).toEqual({ id: 'not_now', label: 'Not now', disabled: false });
    expect(sheet.status).toBeNull();
    // Applying: both disabled; Log is blocked until the reloaded workout shows (review M2).
    expect(reviewSheetView({ ...card, status: 'applying' }, data.aggregate).primary).toEqual({ id: 'switch', label: 'Switching…', disabled: true });
    expect(logBlockedBySwitch({ ...card, status: 'applying' })).toBe(true);
    expect(logBlockedBySwitch(card)).toBe(false);
    expect(logBlockedBySwitch(null)).toBe(false);
  });

  it('the review sheet shows a write error with Try again, and Out of date with Check again instead of Switch (review B3)', async () => {
    const { s, hotelId, sessionId } = await setUp();
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    const data = await s.workout.load(sessionId);
    if (!p || !data) throw new Error('no proposal');
    const many = { ...p, card: { ...p.card, lines: [...p.card.lines, ...p.card.lines, ...p.card.lines], visibleLines: 3, reviewLabel: 'Review all 6 changes ›' } };
    const card: OpenSwitchCard = { proposal: many, opId: 'op-4', status: 'ready' };
    const failed = reviewSheetView({ ...card, status: 'error' }, data.aggregate);
    expect(failed.status).toEqual({ tone: 'warning', text: 'Couldn’t switch gym.' });
    expect(failed.primary).toEqual({ id: 'try_again', label: 'Try again' });
    // A set logged while the sheet is open makes it Out of date: no Switch on the sheet.
    const v = s.workout.view(data, h.clockMs, null);
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v.focus?.opId ?? '', setId: v.focus?.setId ?? '', values: v.focus?.logValues ?? { load: null, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const stale = reviewSheetView(card, logged.aggregate);
    expect(stale.status?.text).toBe('Out of date');
    expect(stale.primary).toEqual({ id: 'check_again', label: 'Check again' });
    expect(stale.secondary).toEqual({ id: 'dismiss', label: 'Dismiss' });
    expect(stale.tags).toBeNull();
    expect(stale.muted).toBe(true);
    expect([stale.primary.id, stale.secondary.id]).not.toContain('switch');
    // Dismiss and Not now close the sheet; Switch and Try again close it on success.
    expect(sheetClosesOn('dismiss')).toBe(true);
    expect(sheetClosesOn('not_now')).toBe(true);
    // Check again keeps it open over a re-checked card that still needs it (review r2 N3).
    expect(sheetClosesOn('check_again')).toBe(false);
    expect(reviewOpenAfterCheckAgain(true, card.proposal)).toBe(true);
    expect(reviewOpenAfterCheckAgain(true, { ...card.proposal, card: { ...card.proposal.card, reviewLabel: null } })).toBe(false);
    expect(reviewOpenAfterCheckAgain(false, card.proposal)).toBe(false);
    expect(reviewOpenAfterCheckAgain(true, null)).toBe(false);
    expect(sheetClosesOn('switch')).toBe(false);
    expect(sheetClosesOn('try_again')).toBe(false);
  });
});
