import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import { MAX_GYM_CHANGES, SessionAggregateSchema } from '@fizz/schemas';
import {
  buildActiveSetView,
  buildWorkoutSummary,
  currentGymEquipment,
  doneExerciseNames,
  editFitsCurrentEquipment,
  partRootOf,
  gymRouteIds,
  isProposalStale,
  latestUndoableGymChange,
  nextTargetBlocks,
  nextTargetsForBlock,
  planFingerprint,
  reduceSession,
  startWorkout,
  startWorkoutFromSession,
  toHistorySessions,
  type GymSwitchProposal,
} from '../src/index';
import { at, dumbbells, id, idGen, kg, lb, profile, stack, routine, routineExercise, template, values } from './fixtures';
import {
  BENCH,
  CABLE_ROW,
  EXERCISES,
  exerciseSets,
  GYM_NAMES,
  HOME,
  HOME_EQ,
  HOTEL,
  HOTEL_EQ,
  hotelRack,
  INCLINE,
  LATERAL,
  MAIN,
  MAIN_EQ,
  mainBar,
  mainRack,
  propose,
  pushA,
  rowOf,
  switchCmd,
} from './gym-fixture';
import { apply, expectError, expectOk, HANG, logCmd, setsFor, startFixture } from './session-fixture';

const plain = (s: string) => s.replaceAll(' ', ' ');

/** Push A at Main Gym with bench sets 1–2 logged (gym-switch §7). */
function benchTwoDone(): SessionAggregate {
  let s = pushA();
  const bench = exerciseSets(s, BENCH);
  s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(100), 8), 60));
  s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(100), 7), 300));
  return s;
}

const hotel = { id: HOTEL, equipment: HOTEL_EQ };
const main = { id: MAIN, equipment: MAIN_EQ };

/** Switch while the rest after bench set 2 (300 s + 90 s) is still running. */
function switched(s: SessionAggregate, p: GymSwitchProposal, seconds = 320, opId?: string) {
  return expectOk(reduceSession(s, switchCmd(p, seconds, opId)));
}

describe('Hotel switch (gym-switch check 1, brief §10)', () => {
  const before = benchTwoDone();
  const p = propose(before, hotel);

  it('the card: logged sets first, one line per changed exercise, unchanged collapsed', () => {
    expect(p).toMatchObject({ kind: 'change_gym', author: 'checks', scope: 'this_session', fromGymId: MAIN, toGymId: HOTEL });
    expect(p.card).toMatchObject({ title: 'Switch to Hotel · Lisbon', action: 'Switch', author: 'Checks', scope: 'Today only', changesTargets: true, summary: null });
    expect(p.card.notChanged).toEqual(['2 logged sets stay as they are.']);
    expect(p.card.lines.map((l) => [l.exerciseName, l.setsLabel, plain(l.target), l.after, l.notes.map((n) => `${n.tone}:${n.text}`)])).toEqual([
      ['Bench press', 'sets 3–4', 'Target 100 kg × 6–8', '→ 6–8 reps, no load target', ['warning:No Olympic bar here. Enter your own load, or skip it after switching.']],
      ['Incline DB press', 'sets 1–3', 'Target 32.5 → 20 kg each × 8–10', null, ['info:Capped: the most here is 20 kg each.']],
      ['Cable row', 'sets 1–3', 'Target 50 kg stack × 12', '→ 12 reps, no load target', ['warning:No Cable station here. Enter your own load, or skip it after switching.']],
    ]);
    expect(p.card.unchanged).toBe('No change: Lateral raise.');
    expect(p.card.lines[1]?.accessibilityLabel).toContain('Incline DB press, sets 1 to 3.');
  });

  it('nothing changes until Switch (the proposal is pure)', () => {
    expect(planFingerprint(before)).toBe(p.expected.fingerprint);
    expect(before.session.gymId).toBe(MAIN);
  });

  it('after Switch: done sets untouched, pending sets fitted to Hotel only (rule 2, rule 4)', () => {
    const r = switched(before, p);
    const after = r.state;
    expect(after.session.gymId).toBe(HOTEL);
    // Completed sets: same values, row and equipment.
    const doneBefore = before.sets.filter((s) => s.status === 'completed');
    for (const d of doneBefore) expect(after.sets.find((s) => s.id === d.id)).toEqual(d);
    const benchMain = rowOf(after, BENCH, 0);
    expect(benchMain).toMatchObject({ equipmentId: mainBar.id });
    // Bench sets 3–4 moved to a continuation row with no equipment and no load target.
    const benchCont = rowOf(after, BENCH, 1);
    expect(benchCont).toMatchObject({ continuesFromId: benchMain?.id, equipmentId: null });
    const pendingBench = exerciseSets(after, BENCH).filter((s) => s.status === 'pending');
    expect(pendingBench.map((s) => [s.sessionExerciseId, s.planned.load, s.planned.reps])).toEqual([
      [benchCont?.id, null, { min: 6, max: 8 }],
      [benchCont?.id, null, { min: 6, max: 8 }],
    ]);
    expect(pendingBench[0]?.planned.snap).toMatchObject({ intended: kg(100), outcome: 'dropped', reason: 'not_here', by: 'gym_switch', intendedOn: { equipmentId: mainBar.id, gymId: MAIN, name: 'Olympic bar' } });
    // Exercises with no done sets are updated in place.
    expect(rowOf(after, INCLINE, 0)).toMatchObject({ equipmentId: hotelRack.id, unit: 'kg', loadConvention: 'per_hand' });
    expect(exerciseSets(after, INCLINE).map((s) => s.planned.load)).toEqual([kg(20, 'per_hand'), kg(20, 'per_hand'), kg(20, 'per_hand')]);
    expect(exerciseSets(after, CABLE_ROW).every((s) => s.planned.load === null && s.planned.reps?.min === 12)).toBe(true);
    // No pending target exceeds 20 kg each, none uses a barbell or cable.
    const hotelIds = new Set(HOTEL_EQ.map((e) => e.id));
    for (const s of after.sets.filter((x) => x.status === 'pending')) {
      const row = after.exercises.find((e) => e.id === s.sessionExerciseId);
      expect(row?.equipmentId === null || hotelIds.has(row?.equipmentId ?? '')).toBe(true);
      if (s.planned.load) expect(s.planned.load.value).toBeLessThanOrEqual(20);
    }
    // Snapshot is append-only: Main's items are all still there, Hotel's added.
    expect(after.session.equipmentSnapshot.slice(0, MAIN_EQ.length)).toEqual(before.session.equipmentSnapshot);
    expect(after.session.equipmentSnapshot.slice(MAIN_EQ.length)).toEqual(HOTEL_EQ);
    // Rest, active set and pause untouched; one versioned change recorded.
    expect(after.restTimer).toEqual(before.restTimer);
    expect(after.session.activeSetId).toBe(before.session.activeSetId);
    expect(after.session.version).toBe(before.session.version + 1);
    expect(after.session.gymChanges).toHaveLength(1);
    expect(r.events).toEqual([expect.objectContaining({ type: 'GymChanged', fromGymId: MAIN, toGymId: HOTEL, undo: false })]);
    expect(SessionAggregateSchema.safeParse(after).success).toBe(true);
  });

  it('the set card: numbering runs across parts, a divider and done-set gym, a capped SnapNote', () => {
    const after = switched(before, p).state;
    const view = buildActiveSetView({ aggregate: after, nowMs: Date.parse(at(410).utc), gymName: 'Hotel · Lisbon', gymNames: GYM_NAMES, previous: {}, painFlagged: new Set(), edits: null });
    const focus = view.focus;
    expect(focus?.exerciseName).toBe('Bench press');
    expect(focus?.headerLine).toBe('Set 3 of 4');
    expect(plain(focus?.target ?? '')).toBe('Target 6–8 reps');
    expect(focus?.snapNote).toEqual({ tone: 'warning', text: 'No Olympic bar at Hotel · Lisbon. Plan was 100 kg.' });
    expect(focus?.rows.map((r) => [r.number, r.status, r.gymCaption, r.partStart])).toEqual([
      [1, 'done', 'Main Gym', null],
      [2, 'done', 'Main Gym', null],
      [3, 'active', null, 'At Hotel · Lisbon'],
      [4, 'pending', null, null],
    ]);
    // One exercise entry per block, holding the part with pending sets.
    expect(view.exercises.map((e) => [e.name, e.pendingSets, e.doneSets])).toEqual([
      ['Bench press', 2, 2],
      ['Incline DB press', 3, 0],
      ['Cable row', 3, 0],
      ['Lateral raise', 3, 0],
    ]);
  });
});

describe('Undo and switch back (gym-switch checks 6, 10)', () => {
  const before = benchTwoDone();
  const p = propose(before, hotel);

  it('Undo within the toast restores gym, rows, targets and drafts exactly', () => {
    const withDraft = apply(before, { type: 'save_draft', at: at(390), setId: exerciseSets(before, INCLINE)[0]?.id ?? '', values: values(kg(30, 'per_hand'), 9) });
    const sw = switched(withDraft, propose(withDraft, hotel)).state;
    const change = latestUndoableGymChange(sw);
    expect(change?.kind).toBe('change');
    const undone = expectOk(reduceSession(sw, { type: 'undo_change_gym', at: at(405), opId: 'undo-1', actionId: change?.actionId ?? '', expectedFingerprint: change?.afterFingerprint ?? '' }));
    const u = undone.state;
    expect(u.session.gymId).toBe(MAIN);
    // Rows: the originals exactly, plus the (now empty) continuation row kept at the end.
    expect(u.exercises.slice(0, withDraft.exercises.length)).toEqual(withDraft.exercises);
    expect(u.exercises.slice(withDraft.exercises.length).every((e) => e.continuesFromId !== undefined && !u.sets.some((s) => s.sessionExerciseId === e.id))).toBe(true);
    // Every set exactly as before apart from its version.
    for (const s of withDraft.sets) expect({ ...u.sets.find((x) => x.id === s.id), version: 0 }).toEqual({ ...s, version: 0 });
    expect(u.session.gymChanges?.map((c) => c.kind)).toEqual(['change', 'undo']);
    expect(undone.events).toEqual([expect.objectContaining({ type: 'GymChanged', toGymId: MAIN, undo: true })]);
    // The empty continuation part is never shown.
    const view = buildActiveSetView({ aggregate: u, nowMs: Date.parse(at(410).utc), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null });
    expect(view.exercises.map((e) => e.name)).toEqual(['Bench press', 'Incline DB press', 'Cable row', 'Lateral raise']);
    expect(view.focus?.rows.map((r) => r.partStart)).toEqual([null, null, null, null]);
  });

  it('after a set is logged at Hotel, Undo is refused (nothing reverts silently)', () => {
    let sw = switched(before, p).state;
    const change = latestUndoableGymChange(sw);
    sw = apply(sw, logCmd(sw.session.activeSetId ?? '', values(kg(60), 8), 500));
    expectError(reduceSession(sw, { type: 'undo_change_gym', at: at(510), opId: 'undo-2', actionId: change?.actionId ?? '', expectedFingerprint: change?.afterFingerprint ?? '' }), 'stale_version');
  });

  it('switching back restores the planned loads (`Back to the planned load.`), and a pain flag holds them', () => {
    const atHotel = switched(before, p).state;
    const back = propose(atHotel, main);
    expect(back.card.title).toBe('Switch back to Main Gym');
    const incline = back.card.lines.find((l) => l.exerciseName === 'Incline DB press');
    expect(plain(incline?.target ?? '')).toBe('Target 20 → 32.5 kg each × 8–10');
    expect(incline?.notes.map((n) => n.text)).toEqual(['Back to the planned load.']);
    const atMain = switched(atHotel, back, 600).state;
    expect(exerciseSets(atMain, INCLINE).map((s) => s.planned.load)).toEqual([kg(32.5, 'per_hand'), kg(32.5, 'per_hand'), kg(32.5, 'per_hand')]);
    expect(rowOf(atMain, INCLINE)?.equipmentId).toBe(mainRack.id);
    // Bench sets 3–4 rejoin the Main row and get their 100 kg back.
    const bench = exerciseSets(atMain, BENCH).filter((s) => s.status !== 'deleted');
    expect(bench.filter((s) => s.status === 'pending').map((s) => [s.sessionExerciseId, s.planned.load])).toEqual([
      [rowOf(atMain, BENCH)?.id, kg(100)],
      [rowOf(atMain, BENCH)?.id, kg(100)],
    ]);
    // With a pain flag on Incline in between, the switch back leaves 20 kg each.
    const held = propose(atHotel, main, { painFlagged: new Set([INCLINE]) });
    const heldState = switched(atHotel, held, 600).state;
    expect(exerciseSets(heldState, INCLINE).map((s) => s.planned.load?.value)).toEqual([20, 20, 20]);
    expect(held.card.lines.find((l) => l.exerciseName === 'Incline DB press')).toBeUndefined();
  });
});

describe('Out of date, idempotency and exclusions (checks 8, 11, 12)', () => {
  const before = benchTwoDone();
  const p = propose(before, hotel);

  it('logging, correcting, adding or skipping makes the card stale; changing the active set or a draft does not', () => {
    const active = before.session.activeSetId ?? '';
    const logged = apply(before, logCmd(active, values(kg(100), 6), 350));
    expect(isProposalStale(p, logged)).toBe(true);
    expectError(reduceSession(logged, switchCmd(p, 360)), 'stale_version');
    const corrected = apply(before, { type: 'correct_set', at: at(350), opId: 'c1', setId: exerciseSets(before, BENCH)[0]?.id ?? '', expectedSetVersion: 2, patch: { reps: 9 } });
    expect(isProposalStale(p, corrected)).toBe(true);
    const added = apply(before, { type: 'add_set', at: at(350), opId: 'a1', sessionExerciseId: rowOf(before, LATERAL)?.id ?? '', newSetId: id(99_001), setType: null });
    expect(isProposalStale(p, added)).toBe(true);
    const skipped = apply(before, { type: 'skip_exercise', at: at(350), opId: 's1', sessionExerciseId: rowOf(before, LATERAL)?.id ?? '' });
    expect(isProposalStale(p, skipped)).toBe(true);
    const moved = apply(before, { type: 'set_active_set', at: at(350), opId: 'm1', setId: exerciseSets(before, LATERAL)[0]?.id ?? '', expectedVersion: before.session.version });
    expect(isProposalStale(p, moved)).toBe(false);
    const drafted = apply(before, { type: 'save_draft', at: at(350), setId: active, values: values(kg(102.5), 8) });
    expect(isProposalStale(p, drafted)).toBe(false);
  });

  it('a double tap, or Try again with the same opId, makes exactly one change', () => {
    const first = switched(before, p, 320, 'tap-1');
    const again = expectOk(reduceSession(first.state, switchCmd(p, 321, 'tap-1')));
    expect(again.duplicate).toBe(true);
    expect(again.superseded).toBe(false);
    expect(again.state).toBe(first.state);
    expect(first.state.session.gymChanges).toHaveLength(1);
    // A regenerated action or continuation ID on retry is still the same intent.
    const regenerated = { ...switchCmd(p, 322, 'tap-1'), actionId: id(98_000), slots: p.slots.map((x, i) => ({ ...x, continuationId: id(98_100 + i) })) };
    expect(expectOk(reduceSession(first.state, regenerated)).duplicate).toBe(true);
  });

  it('the card can’t apply an unachievable load, an incomplete plan or another gym’s item', () => {
    const tampered = { ...switchCmd(p, 400, 'bad-1'), slots: p.slots.map((x) => (x.equipmentId === hotelRack.id ? { ...x, sets: x.sets.map((y) => ({ ...y, load: kg(32.5, 'per_hand') })) } : x)) };
    expectError(reduceSession(before, tampered), 'invalid_values');
    const partial = { ...switchCmd(p, 400, 'bad-2'), slots: p.slots.slice(1) };
    expectError(reduceSession(before, partial), 'invalid_values');
    const foreign = { ...switchCmd(p, 400, 'bad-3'), snapshot: [{ ...hotelRack, gymId: MAIN }] };
    expectError(reduceSession(before, foreign), 'invalid_values');
  });

  it('a half-logged unilateral pair’s other side and a running timed set are left alone, and named', () => {
    // Make Lateral raise unilateral and log its first set as Left only.
    let s = before;
    s = { ...s, exercises: s.exercises.map((e) => (e.exerciseId === LATERAL ? { ...e, laterality: 'unilateral' as const } : e)), sets: s.sets.map((x) => (exerciseSets(s, LATERAL).some((l) => l.id === x.id) ? { ...x, side: 'both' as const } : x)) };
    const first = exerciseSets(s, LATERAL)[0]?.id ?? '';
    s = apply(s, logCmd(first, values(kg(10, 'per_hand'), 12), 350, 'left-1', 'left'));
    const partner = s.sets.find((x) => x.pairedWithSetId === first);
    const prop = propose(s, hotel);
    expect(prop.card.notChanged).toContain('Right side of Lateral raise set 1 stays on Main Gym’s equipment, to match its left side.');
    const after = switched(s, prop, 360).state;
    expect(after.sets.find((x) => x.id === partner?.id)).toEqual(partner);
    expect(after.exercises.find((e) => e.id === partner?.sessionExerciseId)?.equipmentId).toBe(mainRack.id);
  });

  it('a running timed set stays as it is, and the card says so', () => {
    let s = startFixture().state;
    const hang = setsFor(s, HANG)[0]?.id ?? '';
    s = apply(s, { type: 'start_work_interval', at: at(30), opId: 'hang-go', setId: hang, durationS: 45 });
    const prop = propose(s, hotel);
    expect(prop.card.notChanged).toContain('Dead hang set 1 is running. It stays as it is.');
    expect(prop.slots.some((x) => x.sets.some((y) => y.setId === hang))).toBe(false);
    const after = switched(s, prop, 40).state;
    expect(after.sets.find((x) => x.id === hang)).toEqual(s.sets.find((x) => x.id === hang));
    expect(after.workInterval).toEqual(s.workInterval);
  });

  it('a switch later undone reads as superseded when its tap is retried', () => {
    const first = switched(before, p, 320, 'tap-2').state;
    const change = latestUndoableGymChange(first);
    const undone = apply(first, { type: 'undo_change_gym', at: at(325), opId: 'undo-x', actionId: change?.actionId ?? '', expectedFingerprint: change?.afterFingerprint ?? '' });
    const retry = expectOk(reduceSession(undone, switchCmd(p, 330, 'tap-2')));
    expect(retry).toMatchObject({ duplicate: true, superseded: true });
    // Undo can't be applied twice.
    expectError(reduceSession(undone, { type: 'undo_change_gym', at: at(331), opId: 'undo-y', actionId: change?.actionId ?? '', expectedFingerprint: change?.afterFingerprint ?? '' }), 'stale_version');
  });

  it('drafts: one Hotel can make is kept; one it can’t is replaced, and the card says so (GS12)', () => {
    const inclineFirst = exerciseSets(before, INCLINE)[0]?.id ?? '';
    let s = apply(before, { type: 'set_active_set', at: at(340), opId: 'act', setId: inclineFirst, expectedVersion: before.session.version });
    s = apply(s, { type: 'save_draft', at: at(341), setId: inclineFirst, values: values(kg(17.5, 'per_hand'), 9) });
    const benchThird = exerciseSets(s, BENCH)[2]?.id ?? '';
    s = apply(s, { type: 'save_draft', at: at(342), setId: benchThird, values: values(kg(102.5), 8) });
    const prop = propose(s, hotel);
    expect(prop.draftsToReplace).toEqual([benchThird]);
    const after = switched(s, prop, 360).state;
    expect(after.sets.find((x) => x.id === inclineFirst)?.draft?.load).toEqual(kg(17.5, 'per_hand'));
    expect(after.sets.find((x) => x.id === benchThird)?.draft).toBeNull();
    expect(after.session.gymChanges?.[0]?.draftsReplaced).toEqual([benchThird]);
    // When the active set's draft is the one replaced, the card names it.
    const onBench = apply(s, { type: 'set_active_set', at: at(343), opId: 'act2', setId: benchThird, expectedVersion: s.session.version });
    expect(propose(onBench, hotel).card.notChanged).toContain('Your edit on set 3 (102.5 kg) can’t be set up here. Set 3 will use the new target.');
  });
});

describe('Current gym only after a switch (checks 15, 16)', () => {
  const after = switched(benchTwoDone(), propose(benchTwoDone(), hotel)).state;

  it('Add exercise can’t use Main Gym’s items any more', () => {
    const cmd = { type: 'add_exercise' as const, at: at(500), opId: 'ax', newSessionExerciseId: id(97_001), newSetId: id(97_002), exercise: { exerciseId: id(806), name: 'Curl', measurement: 'reps' as const, laterality: 'bilateral' as const, defaultLoadConvention: 'per_hand' as const, compatibleEquipment: ['dumbbells' as const] }, equipmentId: mainRack.id, unit: 'kg' as const, rest: { seconds: 60, source: 'global_default' as const, sourceLabel: 'Default' } };
    expectError(reduceSession(after, cmd), 'equipment_not_found');
    expectOk(reduceSession(after, { ...cmd, equipmentId: hotelRack.id }));
  });

  it('Add set on an exercise done only on Main’s bar needs a continuation at Hotel', () => {
    const mainBench = rowOf(after, BENCH, 0);
    expectError(reduceSession(after, { type: 'add_set', at: at(500), opId: 'as1', sessionExerciseId: mainBench?.id ?? '', newSetId: id(97_010), setType: null }), 'equipment_not_found');
    const r = expectOk(
      reduceSession(after, {
        type: 'add_set',
        at: at(500),
        opId: 'as2',
        sessionExerciseId: mainBench?.id ?? '',
        newSetId: id(97_011),
        setType: null,
        continuation: { id: id(97_012), equipmentId: null, unit: 'kg', loadConvention: 'total', planned: { load: null, reps: { min: 6, max: 8 }, durationS: null, rpe: null, rir: null } },
      }),
    );
    expect(r.state.exercises.find((e) => e.id === id(97_012))).toMatchObject({ continuesFromId: mainBench?.id, equipmentId: null });
    // An unachievable continuation target is refused.
    expectError(
      reduceSession(after, { type: 'add_set', at: at(500), opId: 'as3', sessionExerciseId: rowOf(after, BENCH, 0)?.id ?? '', newSetId: id(97_013), setType: null, continuation: { id: id(97_014), equipmentId: hotelRack.id, unit: 'kg', loadConvention: 'per_hand', planned: { load: kg(22.5, 'per_hand'), reps: null, durationS: null, rpe: null, rir: null } } }),
      'invalid_values',
    );
  });

  it('correcting a Main Gym set uses Main’s bar and adds no off_profile_load', () => {
    const done = exerciseSets(after, BENCH)[0];
    const r = expectOk(reduceSession(after, { type: 'correct_set', at: at(520), opId: 'cx', setId: done?.id ?? '', expectedSetVersion: done?.version ?? 0, patch: { load: kg(102.5) } }));
    expect(r.state.sets.find((s) => s.id === done?.id)?.flags).toEqual([]);
  });
});

describe('Same gym, updated equipment (`[Use changes today]`, review SP1, check 7)', () => {
  it('a rack wrongly saved at max 30 caps 32.5; after fixing it, Apply restores 32.5 and steppers pass 30', () => {
    const wrong = { ...mainRack, maxLoad: 30 };
    let s = pushA({ at: [mainBar, wrong] });
    expect(exerciseSets(s, INCLINE)[0]?.planned).toMatchObject({ load: kg(30, 'per_hand'), snap: { outcome: 'capped', intended: kg(32.5, 'per_hand') } });
    // Log Incline set 1 at 30 first, so the row keeps a done set on the old version.
    s = apply(s, { type: 'set_active_set', at: at(10), opId: 'go', setId: exerciseSets(s, INCLINE)[0]?.id ?? '', expectedVersion: s.session.version });
    s = apply(s, logCmd(exerciseSets(s, INCLINE)[0]?.id ?? '', values(kg(30, 'per_hand'), 9), 60));
    const fixed = { ...wrong, maxLoad: 50, version: 2 };
    delete (fixed as { maxLoad?: number }).maxLoad;
    const prop = propose(s, { id: MAIN, equipment: [mainBar, fixed] });
    expect(prop.card).toMatchObject({ title: 'Use updated Main Gym', action: 'Apply' });
    expect(prop.card.lines.map((l) => [l.exerciseName, l.setsLabel, plain(l.target), l.notes.map((n) => n.text)])).toEqual([['Incline DB press', 'sets 2–3', 'Target 30 → 32.5 kg each × 8–10', ['Back to the planned load.']]]);
    const after = switched(s, prop, 200).state;
    const parts = after.exercises.filter((e) => e.exerciseId === INCLINE).sort((a, b) => a.order - b.order);
    // The done set keeps the old version of the rack; the rest continue on the new one.
    expect(parts.map((e) => [e.equipmentId, e.equipmentVersion ?? 'latest'])).toEqual([
      [mainRack.id, 1],
      [mainRack.id, 'latest'],
    ]);
    expect(after.sets.find((x) => x.id === exerciseSets(s, INCLINE)[0]?.id)?.flags).toEqual([]);
    expect(exerciseSets(after, INCLINE).filter((x) => x.status === 'pending').map((x) => x.planned.load)).toEqual([kg(32.5, 'per_hand'), kg(32.5, 'per_hand')]);
    const view = buildActiveSetView({ aggregate: apply(after, { type: 'set_active_set', at: at(210), opId: 'go2', setId: exerciseSets(after, INCLINE)[1]?.id ?? '', expectedVersion: after.session.version }), nowMs: Date.parse(at(220).utc), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null });
    expect(view.focus?.loadField?.up).toMatchObject({ enabled: true, value: 35 });
  });
});

describe('Nothing changes / nothing left (§2.3)', () => {
  it('Home has everything: a one-line card, and voice may confirm it (GS9)', () => {
    let s = pushA({ at: [...MAIN_EQ] });
    // Drop the barbell and cable work so only dumbbells remain pending.
    for (const ex of [BENCH, CABLE_ROW]) s = apply(s, { type: 'skip_exercise', at: at(30), opId: `skip-${ex}`, sessionExerciseId: rowOf(s, ex)?.id ?? '' });
    const p = propose(s, { id: HOME, equipment: HOME_EQ });
    expect(p.card.changesTargets).toBe(false);
    expect(p.card.summary).toBe('Home has everything for your 6 remaining sets. Targets stay as they are.');
    expect(p.card.lines).toEqual([]);
  });

  it('with every set done the card says anything added uses the new gym', () => {
    let s = pushA();
    for (const ex of [BENCH, INCLINE, CABLE_ROW, LATERAL]) s = apply(s, { type: 'skip_exercise', at: at(30), opId: `skip-${ex}`, sessionExerciseId: rowOf(s, ex)?.id ?? '' });
    expect(propose(s, hotel).card.summary).toBe('No sets left to update. Anything you add uses Hotel · Lisbon’s equipment.');
  });

  it('a gym with no equipment set up leads with a warning', () => {
    expect(propose(benchTwoDone(), { id: HOTEL, equipment: [] }).card.lead?.text).toBe('Hotel · Lisbon has no equipment set up yet, so remaining load targets are removed.');
  });

  it('many changes: three lines on the card and `Review all N changes ›` (§2.4)', () => {
    const extra = [id(810), id(811), id(812), id(813), id(814)];
    const exercises = new Map(EXERCISES);
    const bench = EXERCISES.get(BENCH);
    if (!bench) throw new Error('fixture');
    extra.forEach((x, i) => exercises.set(x, { ...bench, id: x, name: `Barbell lift ${String(i + 1)}` }));
    const r = routine(extra.map((x, i) => routineExercise(950 + i, { exerciseId: x, equipmentId: mainBar.id, order: i, setTemplates: [template(9500 + i, { targetLoad: kg(60) })] })));
    const s = startWorkout({ opId: 'many', owner: profile(), gymId: MAIN, routine: r, exercises, gymEquipment: MAIN_EQ, at: at(0), newId: idGen(71_000) }).aggregate;
    const p = propose(s, hotel, { exercises });
    expect(p.card.lines).toHaveLength(5);
    expect(p.card.visibleLines).toBe(3);
    expect(p.card.reviewLabel).toBe('Review all 5 changes ›');
  });
});

describe('One code path: Repeat and the switch fit alike (check 3), routine Start (check 5)', () => {
  it('for the same intended loads and gym, Repeat and the switch give the same loads, outcomes and note kinds', () => {
    // Finish Push A at Main with everything done as planned.
    let s = pushA();
    for (const set of [...s.sets]) {
      const cur = s.sets.find((x) => x.id === set.id);
      if (cur?.status !== 'pending') continue;
      s = apply(s, { type: 'set_active_set', at: at(10), opId: `a-${set.id}`, setId: set.id, expectedVersion: s.session.version });
      s = apply(s, logCmd(set.id, values(cur.planned.load, cur.planned.reps?.max ?? 8), 20));
    }
    s = apply(s, { type: 'finish', at: at(4000), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    const repeat = startWorkoutFromSession({ opId: 'rep', owner: profile(), gymId: HOTEL, gymName: 'Hotel · Lisbon', source: s, exercises: EXERCISES, gymEquipment: HOTEL_EQ, at: at(90_000), newId: idGen(70_000) });
    const live = propose(pushA(), hotel);
    const shape = (slots: typeof repeat.snap.slots) => slots.map((x) => [x.exerciseName, x.mapping, x.equipment?.id ?? null, x.sets.map((y) => [y.load, y.outcome, y.reason ?? null]), x.notes.map((n) => (n.kind === 'dropped' ? `dropped:${n.reason}` : n.kind))]);
    expect(shape(repeat.snap.slots)).toEqual(shape(live.snap.slots));
    // Only the wording differs: "last time" versus the card's "here".
    expect(repeat.notes.map((n) => n.text)).toEqual([
      'No load target · no olympic bar here · last time 100 kg × 8',
      'Max here 20 kg each · last time 32.5 kg each',
      'No load target · no cable station here · last time 50 kg stack × 12',
    ]);
    // Repeat B1 (competitor test 2g): no load, reps kept, no equipment, all pending; never "kept as done".
    const bench = repeat.aggregate.sets.filter((x) => x.sessionExerciseId === repeat.aggregate.exercises[0]?.id);
    expect(bench.every((x) => x.planned.load === null && x.planned.reps?.min === 8 && x.status === 'pending')).toBe(true);
    expect(repeat.aggregate.exercises[0]?.equipmentId).toBeNull();
    expect(repeat.notes.some((n) => /kept as (done|planned)/i.test(n.text))).toBe(false);
  });

  it('a routine pinned to Main’s bar started at a dumbbell-only gym has no bench load target; Main’s dumbbells map to Hotel’s and cap', () => {
    const s = pushA({ at: HOTEL_EQ });
    expect(exerciseSets(s, BENCH).every((x) => x.planned.load === null && x.planned.snap?.reason === 'not_here')).toBe(true);
    expect(rowOf(s, INCLINE)?.equipmentId).toBe(hotelRack.id);
    expect(exerciseSets(s, INCLINE).map((x) => x.planned.load)).toEqual([kg(20, 'per_hand'), kg(20, 'per_hand'), kg(20, 'per_hand')]);
  });
});

describe('Summary and history after a switch (check 24)', () => {
  function finishedAcrossGyms(mainReps = 9, lastReps = 11): SessionAggregate {
    let s = benchTwoDone();
    const incline1 = exerciseSets(s, INCLINE)[0]?.id ?? '';
    s = apply(s, { type: 'set_active_set', at: at(305), opId: 'go-incline', setId: incline1, expectedVersion: s.session.version });
    s = apply(s, logCmd(incline1, values(kg(32.5, 'per_hand'), mainReps), 310));
    s = switched(s, propose(s, hotel), 320).state;
    const next = exerciseSets(s, INCLINE).filter((x) => x.status === 'pending');
    s = apply(s, logCmd(next[0]?.id ?? '', values(kg(20, 'per_hand'), 12), 500));
    s = apply(s, logCmd(next[1]?.id ?? '', values(kg(20, 'per_hand'), lastReps), 700));
    return apply(s, { type: 'finish', at: at(900), opId: 'fin-x', expectedVersion: s.session.version, endedAt: null });
  }

  it('the title names each gym in order, and an exercise done at both is one row with each part’s gym', () => {
    const done = finishedAcrossGyms();
    const sum = buildWorkoutSummary({ aggregate: done, nowMs: Date.parse(at(1000).utc), gymName: 'Hotel · Lisbon', gymNames: GYM_NAMES, history: {}, rules: {}, painFlags: [], checkIn: null, coach: 'not_connected' });
    expect(sum.gymName).toBe('Main Gym → Hotel · Lisbon');
    const incline = sum.exercises.find((e) => e.name === 'Incline DB press');
    expect(plain(incline?.results ?? '')).toBe('32.5×9 (Main Gym) · 20×12 · 20×11 (Hotel · Lisbon)');
    expect(sum.exercises.filter((e) => e.name === 'Incline DB press')).toHaveLength(1);
  });

  it('a kg→lb switch labels each part with its own unit, never the first part’s (review B2)', () => {
    const US = id(5);
    const usRack = dumbbells({ id: id(730), gymId: US, name: 'US dumbbells', unit: 'lb', loads: [10, 20, 30, 40, 50, 60, 70, 80] });
    let s = benchTwoDone();
    const incline1 = exerciseSets(s, INCLINE)[0]?.id ?? '';
    s = apply(s, { type: 'set_active_set', at: at(305), opId: 'go-incline', setId: incline1, expectedVersion: s.session.version });
    s = apply(s, logCmd(incline1, values(kg(32.5, 'per_hand'), 9), 310));
    s = switched(s, propose(s, { id: US, equipment: [usRack] }), 320).state;
    const next = exerciseSets(s, INCLINE).filter((x) => x.status === 'pending');
    expect(rowOf(s, INCLINE, 1)).toMatchObject({ equipmentId: usRack.id, unit: 'lb' });
    s = apply(s, logCmd(next[0]?.id ?? '', values(lb(70, 'per_hand'), 10), 500));
    s = apply(s, { type: 'finish', at: at(900), opId: 'fin-us', expectedVersion: s.session.version, endedAt: null });
    const sum = buildWorkoutSummary({ aggregate: s, nowMs: Date.parse(at(1000).utc), gymName: 'US Hotel', gymNames: { ...GYM_NAMES, [US]: 'US Hotel' }, history: {}, rules: {}, painFlags: [], checkIn: null, coach: 'not_connected' });
    const incline = sum.exercises.find((e) => e.name === 'Incline DB press');
    expect(incline?.setsText).toBe('2 sets');
    expect(plain(incline?.results ?? '')).toBe('32.5×9 kg each (Main Gym) · 70×10 lb each (US Hotel)');
    // Same unit across parts: today's text, one shared note.
    const kgOnly = buildWorkoutSummary({ aggregate: finishedAcrossGyms(), nowMs: Date.parse(at(1000).utc), gymName: 'Hotel · Lisbon', gymNames: GYM_NAMES, history: {}, rules: {}, painFlags: [], checkIn: null, coach: 'not_connected' });
    expect(kgOnly.exercises.find((e) => e.name === 'Incline DB press')?.setsText).toBe('3 sets (kg each)');
  });

  it('history keeps each part with its own equipment and gym, so comparisons never pair the two gyms', () => {
    const done = finishedAcrossGyms();
    const h = toHistorySessions(done, INCLINE);
    expect(h.map((x) => [x.equipmentId, x.gymId, x.sets.map((y) => y.load?.value)])).toEqual([
      [mainRack.id, MAIN, [32.5]],
      [hotelRack.id, HOTEL, [20, 20]],
    ]);
  });

  it('Repeat of a switched workout copies the split exercise once, its sets in order (review B1)', () => {
    const done = finishedAcrossGyms();
    const r = startWorkoutFromSession({ opId: 'rep-b1', owner: profile(), gymId: MAIN, gymName: 'Main Gym', source: done, exercises: EXERCISES, gymEquipment: MAIN_EQ, at: at(90_000), newId: idGen(80_000) });
    const rows = r.aggregate.exercises.filter((e) => e.exerciseId === INCLINE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.equipmentId).toBe(mainRack.id);
    const sets = r.aggregate.sets.filter((x) => x.sessionExerciseId === rows[0]?.id).sort((a, b) => a.index - b.index);
    expect(sets.map((x) => [x.planned.load?.value, x.planned.reps?.min])).toEqual([
      [32.5, 9],
      [20, 12],
      [20, 11],
    ]);
    expect(doneExerciseNames(done)).toEqual(['Bench press', 'Incline DB press']);
  });

  it('next-session targets read a split exercise as one block: the latest part with equipment, the block’s set count (review r2 B1)', () => {
    const done = finishedAcrossGyms();
    const blocks = nextTargetBlocks(done);
    const incline = blocks.filter((b) => b.root.exerciseId === INCLINE);
    expect(incline).toHaveLength(1);
    expect(incline[0]).toMatchObject({ root: { id: rowOf(done, INCLINE, 0)?.id }, decider: { id: rowOf(done, INCLINE, 1)?.id }, workingSets: 3, prescribedSets: 3, split: true });
    expect(incline[0]?.equipment?.id).toBe(hotelRack.id);
    // Bench: 2 done at Main, its moved sets never done: Main decides, not split.
    const bench = blocks.find((b) => b.root.exerciseId === BENCH);
    expect(bench).toMatchObject({ decider: { id: rowOf(done, BENCH, 0)?.id }, workingSets: 2, split: false });
    expect(bench?.equipment?.id).toBe(mainBar.id);
  });

  it('the Summary’s Next time shows one row for a split exercise, from the Hotel part, saying so (review r2 B1)', () => {
    // The reviewer's case: Main 32.5×12, Hotel 20×12, 20×12. Per row this gave two rows (35 kg and 20 kg × 13).
    const done = finishedAcrossGyms(12, 12);
    const sum = buildWorkoutSummary({ aggregate: done, nowMs: Date.parse(at(1000).utc), gymName: 'Hotel · Lisbon', gymNames: GYM_NAMES, history: { [INCLINE]: toHistorySessions(done, INCLINE) }, rules: {}, painFlags: [], checkIn: null, coach: 'not_connected' });
    const rows = sum.nextTime?.rows.filter((r) => r.exerciseId === INCLINE) ?? [];
    expect(rows.map((r) => [r.exerciseName, plain(r.target), r.decision])).toEqual([['Incline DB press', 'Target 20 kg each × 13', 'increase_reps']]);
    expect(rows[0]?.facts[0]).toBe('Done at more than one gym: target from your Hotel · Lisbon sets, for all 3 sets.');
    // The Main part of the same workout isn't "an earlier session left out", and 3 of 3 sets were done.
    expect(rows[0]?.facts.some((f) => /left out|Only \d+ of/.test(f))).toBe(false);
  });

  it('a split block holds the deciding part to the sets left after the other parts, and targets the block’s set count (review r2 B1)', () => {
    const done = finishedAcrossGyms(12, 12);
    const block = nextTargetBlocks(done).find((b) => b.root.exerciseId === INCLINE);
    if (!block) throw new Error('no block');
    const req = { ownerId: 'o', sessionId: done.session.id, exercise: null, rule: null, history: toHistorySessions(done, INCLINE), painFlags: [], sessionPain: { active: false, reportedAtUtc: null } };
    const start = nextTargetsForBlock(block, { ...req, count: 'done' }, 'Hotel · Lisbon').result;
    expect(start.sets.map((x) => [x.setType, x.load?.value, x.reps])).toEqual(Array.from({ length: 3 }, () => ['working', 20, { min: 13, max: 13 }]));
    // One Hotel set short (12, 11): held, still 3 sets; no "only 2 of 3".
    const short = finishedAcrossGyms(12, 11);
    const b2 = nextTargetBlocks(short).find((b) => b.root.exerciseId === INCLINE);
    if (!b2) throw new Error('no block');
    const held = nextTargetsForBlock(b2, { ...req, sessionId: short.session.id, history: toHistorySessions(short, INCLINE), count: 'done' }, null).result;
    expect(held.decision).toBe('hold');
    expect(held.sets).toHaveLength(3);
    expect(held.explanation.facts[0]).toBe('Done at more than one gym: target from the last gym\'s sets, for all 3 sets.');
    // Not split: exactly the row's own rule call.
    const bench = nextTargetBlocks(done).find((b) => b.root.exerciseId === BENCH);
    expect(bench?.split).toBe(false);
  });

  it('Start next session of a switched workout applies the targets once per exercise (review B1)', () => {
    const done = finishedAcrossGyms();
    const t = { setType: 'working' as const, planned: { load: kg(35, 'per_hand'), reps: { min: 8, max: 10 }, durationS: null, rpe: null, rir: null } };
    const r = startWorkoutFromSession({ opId: 'next-b1', owner: profile(), gymId: MAIN, gymName: 'Main Gym', source: done, exercises: EXERCISES, gymEquipment: MAIN_EQ, at: at(90_000), newId: idGen(81_000), targets: new Map([[INCLINE, [t, t, t]]]) });
    const rows = r.aggregate.exercises.filter((e) => e.exerciseId === INCLINE);
    expect(rows).toHaveLength(1);
    const sets = r.aggregate.sets.filter((x) => x.sessionExerciseId === rows[0]?.id);
    expect(sets.map((x) => [x.planned.load?.value, x.planned.source])).toEqual([
      [35, 'built_in_rule'],
      [35, 'built_in_rule'],
      [35, 'built_in_rule'],
    ]);
  });

  it('an undone switch doesn’t appear in the route', () => {
    const s = benchTwoDone();
    const sw = switched(s, propose(s, hotel)).state;
    const c = latestUndoableGymChange(sw);
    const u = apply(sw, { type: 'undo_change_gym', at: at(330), opId: 'u', actionId: c?.actionId ?? '', expectedFingerprint: c?.afterFingerprint ?? '' });
    expect(gymRouteIds(u.session)).toEqual([MAIN]);
    expect(gymRouteIds(sw.session)).toEqual([MAIN, HOTEL]);
  });
});

describe('Rule 4 in the reducer itself, and unsaved edits (review M1, M3)', () => {
  it('rejects a load target on an exercise that had equipment and has none at the new gym', () => {
    const s = benchTwoDone();
    const cmd = switchCmd(propose(s, hotel), 320, 'forged');
    const benchRow = rowOf(s, BENCH, 0)?.id;
    const forged = {
      ...cmd,
      slots: cmd.slots.map((slot) => (slot.sessionExerciseId === benchRow ? { ...slot, equipmentId: null, sets: slot.sets.map((x) => ({ ...x, load: kg(100) })) } : slot)),
    };
    expectError(reduceSession(s, forged), 'invalid_values');
    // The real command (no load there) is accepted.
    expect(reduceSession(s, cmd).ok).toBe(true);
  });

  it('an edit the new gym can’t make no longer fits; one it can still fits', () => {
    const s = benchTwoDone();
    const after = switched(s, propose(s, hotel)).state;
    const incline = exerciseSets(after, INCLINE)[0]?.id ?? '';
    const bench = exerciseSets(after, BENCH).find((x) => x.status === 'pending')?.id ?? '';
    const v = (load: ReturnType<typeof kg> | null) => ({ load, reps: 8, durationS: null, rpe: null, rir: null });
    expect(editFitsCurrentEquipment(after, incline, v(kg(32.5, 'per_hand')))).toBe(false);
    expect(editFitsCurrentEquipment(after, incline, v(kg(17.5, 'per_hand')))).toBe(true);
    expect(editFitsCurrentEquipment(after, incline, v(lb(40, 'per_hand')))).toBe(false);
    // Bench lost its bar: no load can be checked, reps alone are fine.
    expect(editFitsCurrentEquipment(after, bench, v(kg(100)))).toBe(false);
    expect(editFitsCurrentEquipment(after, bench, v(null))).toBe(true);
  });
});

describe('Main → Hotel → Home → Main (review: double switch)', () => {
  it('continuation chains stay one block per exercise, the route names each gym, and the Summary lists each exercise once', () => {
    let s = benchTwoDone();
    s = switched(s, propose(s, hotel), 320, 'sw-1').state;
    const inc = () => exerciseSets(s, INCLINE).filter((x) => x.status === 'pending');
    s = apply(s, { type: 'set_active_set', at: at(330), opId: 'act-1', setId: inc()[0]?.id ?? '', expectedVersion: s.session.version });
    s = apply(s, logCmd(inc()[0]?.id ?? '', values(kg(20, 'per_hand'), 12), 400));
    s = switched(s, propose(s, { id: HOME, equipment: HOME_EQ }), 450, 'sw-2').state;
    s = apply(s, logCmd(inc()[0]?.id ?? '', values(kg(30, 'per_hand'), 9), 600));
    s = switched(s, propose(s, main), 650, 'sw-3').state;
    s = apply(s, logCmd(inc()[0]?.id ?? '', values(kg(32.5, 'per_hand'), 8), 800));
    expect(gymRouteIds(s.session)).toEqual([MAIN, HOTEL, HOME, MAIN]);
    const rows = s.exercises.filter((e) => e.exerciseId === INCLINE);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const roots = new Set(rows.map((r) => partRootOf(s.exercises, r.id)));
    expect(roots.size).toBe(1);
    const done = apply(s, { type: 'finish', at: at(900), opId: 'fin-3', expectedVersion: s.session.version, endedAt: null });
    expect(doneExerciseNames(done)).toEqual(['Bench press', 'Incline DB press']);
    const sum = buildWorkoutSummary({ aggregate: done, nowMs: Date.parse(at(1000).utc), gymName: 'Main Gym', gymNames: GYM_NAMES, history: {}, rules: {}, painFlags: [], checkIn: null, coach: 'not_connected' });
    expect(sum.exercises.filter((e) => e.name === 'Incline DB press')).toHaveLength(1);
    expect(plain(sum.exercises.find((e) => e.name === 'Incline DB press')?.results ?? '')).toBe('20×12 (Hotel · Lisbon) · 30×9 (Home) · 32.5×8 (Main Gym)');
    const rep = startWorkoutFromSession({ opId: 'rep-3', owner: profile(), gymId: MAIN, gymName: 'Main Gym', source: done, exercises: EXERCISES, gymEquipment: MAIN_EQ, at: at(90_000), newId: idGen(82_000) });
    expect(rep.aggregate.exercises.filter((e) => e.exerciseId === INCLINE)).toHaveLength(1);
  });
});

describe('The current gym’s list after visits and the change cap (review N3, N5)', () => {
  it('an item removed from a gym between two visits isn’t offered on the second', () => {
    const hotelCable = stack({ id: id(711), gymId: HOTEL, name: 'Hotel cable', stackLoads: [5, 10, 15, 20] });
    let s = benchTwoDone();
    s = switched(s, propose(s, { id: HOTEL, equipment: [hotelRack, hotelCable] }), 320, 'v1').state;
    expect(currentGymEquipment(s.session).map((e) => e.id)).toEqual([hotelRack.id, hotelCable.id]);
    s = switched(s, propose(s, main), 400, 'v2').state;
    expect(currentGymEquipment(s.session).map((e) => e.id)).toEqual(MAIN_EQ.map((e) => e.id));
    s = switched(s, propose(s, hotel), 500, 'v3').state;
    expect(currentGymEquipment(s.session).map((e) => e.id)).toEqual([hotelRack.id]);
    // Undo the last switch: back at Main with Main’s list.
    const c = latestUndoableGymChange(s);
    s = apply(s, { type: 'undo_change_gym', at: at(510), opId: 'u3', actionId: c?.actionId ?? '', expectedFingerprint: c?.afterFingerprint ?? '' });
    expect(currentGymEquipment(s.session).map((e) => e.id)).toEqual(MAIN_EQ.map((e) => e.id));
  });

  it('a switch past the record cap is refused with a reason, so the workout can still be saved', () => {
    const s = benchTwoDone();
    const one = switched(s, propose(s, hotel)).state.session.gymChanges?.[0];
    if (!one) throw new Error('no change');
    const full: SessionAggregate = { ...s, session: { ...s.session, gymChanges: Array.from({ length: MAX_GYM_CHANGES - 1 }, (_, i) => ({ ...one, actionId: `a${String(i)}`, kind: 'undo' as const, fromGymId: MAIN, toGymId: MAIN, undoOf: 'x' })) } };
    const r = reduceSession(full, switchCmd(propose(full, hotel), 320, 'cap'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/too many times/);
  });
});
