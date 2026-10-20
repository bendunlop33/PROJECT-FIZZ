import { describe, expect, it } from 'vitest';
import { DraftSetTemplateSchema, SessionAggregateSchema, TodayEditSchema, type PlannedSet, type SessionAggregate, type WorkInterval } from '@fizz/schemas';
import {
  buildActiveSetView,
  buildAddExerciseCommand,
  buildExerciseTabView,
  buildWorkoutTableView,
  calculateNextTargets,
  builtInDefaultRule,
  asCardioInterval,
  CARDIO_TIMER_CAP_S,
  cardioHasValue,
  cardioRepeatTargets,
  cardioTemplatesWithTargets,
  parseCardioTime,
  planRoutineStart,
  resumeCardioInterval,
  shapeAddPlan,
  shapeTemplates,
  type HistorySession,
  cardioDistanceText,
  cardioElapsedMs,
  cardioValuesText,
  catalogueExerciseId,
  collectExerciseSeries,
  defaultSlotShape,
  EQUIPMENT_FILTERS,
  equipmentFiltersOf,
  metricsFor,
  needsNoEquipment,
  paceSeconds,
  paceText,
  paceUnitFor,
  pickerSections,
  reduceSession,
  rowValueCell,
  seriesKind,
  startWorkoutFromSession,
  targetShort,
  targetText,
  toProgressSession,
  valuesText,
} from '../src/index';
import { at, exercise, GYM, id, idGen, ms, profile, routine, routineExercise, T0_MS, template } from './fixtures';
import { apply, expectError, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * Cardio sets (Ben, 19 Oct: "rowing machine or bike … with a timer and
 * distance"): time and distance, both optional but at least one; a timer
 * that counts up from a stored start; pace per 500 m on the rower and ski
 * erg, per km elsewhere; never progressed by load or reps; kept out of
 * e1RM, volume and muscle set counts.
 */

const sp = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ');
const ROWER = exercise(0, 'Rowing machine', { id: catalogueExerciseId('rowing-erg'), catalogueKey: 'rowing-erg', measurement: 'cardio', movementPattern: 'conditioning', compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', primaryMuscles: ['quads', 'glutes', 'lats'] });
const BIKE = exercise(0, 'Exercise bike', { id: catalogueExerciseId('exercise-bike'), catalogueKey: 'exercise-bike', measurement: 'cardio', movementPattern: 'conditioning', compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', primaryMuscles: ['quads', 'glutes'] });

const view = (s: SessionAggregate, seconds: number) => buildActiveSetView({ aggregate: s, nowMs: ms(seconds), gymName: 'Main', previous: {}, painFlagged: new Set(), edits: null, withTimeLeft: false });
const tableView = (s: SessionAggregate, seconds: number) => buildWorkoutTableView({ aggregate: s, nowMs: ms(seconds), gymName: 'Main', previous: {}, painFlagged: new Set(), edits: null, withTimeLeft: false });

function withRower(): { s: SessionAggregate; setId: string } {
  let s = startFixture().state;
  s = apply(s, buildAddExerciseCommand({ opId: 'add-row', owner: profile(), exercise: ROWER, equipmentId: null, at: at(5), newId: idGen(61_000) }));
  const [row] = setsFor(s, ROWER.id);
  if (row === undefined) throw new Error('no rower set');
  s = apply(s, { type: 'set_active_set', at: at(6), opId: 'act', setId: row.id, expectedVersion: s.session.version });
  return { s, setId: row.id };
}

describe('pace (19 Oct)', () => {
  it('per 500 m on the rower and ski erg, per km on everything else', () => {
    expect(paceUnitFor('rowing-erg')).toBe('500m');
    expect(paceUnitFor(catalogueExerciseId('ski-erg'))).toBe('500m');
    expect(paceUnitFor(catalogueExerciseId('treadmill-run'))).toBe('km');
    expect(paceUnitFor(BIKE.id)).toBe('km');
    expect(paceUnitFor('a-custom-exercise')).toBe('km');
  });

  it('20:00 for 4,800 m on the rower is 2:05 /500 m; 30:00 for 6 km on the treadmill is 5:00 /km', () => {
    expect(paceSeconds(1200, 4800, '500m')).toBeCloseTo(125);
    expect(sp(paceText({ durationS: 1200, distanceM: 4800 }, ROWER.id))).toBe('2:05 /500 m');
    expect(sp(paceText({ durationS: 1800, distanceM: 6000 }, 'treadmill-run'))).toBe('5:00 /km');
    expect(sp(paceText({ durationS: 3725, distanceM: 1000 }, 'treadmill-run'))).toBe('1:02:05 /km');
  });

  it('no pace without both a time and a distance above 0 (never estimated)', () => {
    expect(paceText({ durationS: 1200, distanceM: null }, ROWER.id)).toBeNull();
    expect(paceText({ durationS: null, distanceM: 4800 }, ROWER.id)).toBeNull();
    expect(paceText({ durationS: 0, distanceM: 4800 }, ROWER.id)).toBeNull();
    expect(paceText({ durationS: 1200, distanceM: 0 }, ROWER.id)).toBeNull();
  });
});

describe('cardio text', () => {
  it('`20:00 · 4,800 m`; either one alone; a dash with neither', () => {
    expect(sp(cardioValuesText({ durationS: 1200, distanceM: 4800 }))).toBe('20:00 · 4,800 m');
    expect(sp(cardioValuesText({ durationS: 3900, distanceM: null }))).toBe('1:05:00');
    expect(sp(cardioValuesText({ durationS: null, distanceM: 12500.5 }))).toBe('12,500.5 m');
    expect(cardioValuesText({ durationS: null, distanceM: undefined })).toBe('—');
    expect(sp(cardioDistanceText(850))).toBe('850 m');
  });

  it('valuesText and the table cell never show a load for cardio', () => {
    const v = { load: { value: 0, unit: 'kg' as const, convention: 'bodyweight' as const }, reps: null, durationS: 1200, distanceM: 4800 };
    expect(sp(valuesText(v, { convention: 'bodyweight', measurement: 'cardio' }))).toBe('20:00 · 4,800 m');
    expect(sp(rowValueCell({ ...v, rpe: null, rir: null }, 'cardio'))).toBe('20:00 · 4,800 m');
    expect(sp(targetText({ load: null, reps: null, durationS: 1200, distanceM: 4800, rpe: null, rir: null }, { convention: 'bodyweight', measurement: 'cardio' }))).toBe('Target 20:00 · 4,800 m');
    expect(sp(targetShort({ load: null, reps: null, durationS: 1200, distanceM: 4800, rpe: null, rir: null, source: 'coach' }, { convention: 'bodyweight' }))).toBe('Coach target 20:00 · 4,800 m');
  });

  it('old distance-only and time-only sets read correctly as cardio (the four machines migrated, 19 Oct)', () => {
    // A rowing set logged when the rower was a distance exercise had metres only; the air bike's had a time only.
    expect(sp(rowValueCell({ load: null, reps: null, durationS: null, distanceM: 2000, rpe: null, rir: null }, 'cardio'))).toBe('2,000 m');
    expect(sp(rowValueCell({ load: null, reps: null, durationS: 600, rpe: null, rir: null }, 'cardio'))).toBe('10:00');
  });
});

describe('logging a cardio set', () => {
  it('needs a time or a distance; either alone is enough', () => {
    const { s, setId } = withRower();
    expectError(reduceSession(s, logCmd(setId, { load: null, reps: null, durationS: null, rpe: null, rir: null }, 30)), 'invalid_values');
    const a = apply(s, logCmd(setId, { load: null, reps: null, durationS: null, rpe: null, rir: null, distanceM: 2000 }, 30));
    expect(a.sets.find((x) => x.id === setId)?.actual).toMatchObject({ durationS: null, distanceM: 2000 });
    const b = apply(s, logCmd(setId, { load: null, reps: null, durationS: 600, rpe: null, rir: null }, 30));
    expect(b.sets.find((x) => x.id === setId)?.actual).toMatchObject({ durationS: 600 });
  });

  it('logs a 20:00 · 4,800 m row and shows it with its pace in the table', () => {
    const { s, setId } = withRower();
    const done = apply(s, logCmd(setId, { load: null, reps: null, durationS: 1200, rpe: null, rir: null, distanceM: 4800 }, 1300));
    expect(done.sets.find((x) => x.id === setId)).toMatchObject({ status: 'completed', actual: { durationS: 1200, distanceM: 4800 } });
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(done))).success).toBe(true);
    const block = tableView(done, 1310).blocks.find((b) => b.kind === 'exercise' && b.card.exerciseId === ROWER.id);
    if (block?.kind !== 'exercise') throw new Error('no rower block');
    expect(block.card.columns).toEqual({ kind: 'cardio', loadLabel: null, valueLabel: 'TIME · DIST' });
    const row = block.card.rows[0];
    expect(sp(row?.cells.value)).toBe('20:00 · 4,800 m');
    expect(row?.cells.load).toBeNull();
    expect(sp(row?.pace)).toBe('2:05 /500 m');
    expect(row?.accessibilityLabel).toContain('20 minutes, 4800 metres');
  });

  it('the focus card offers time (by the minute) and distance (by 100 m), and a Start timer', () => {
    const { s } = withRower();
    const v = view(s, 10);
    expect(v.focus?.duration).toMatchObject({ value: null, up: { enabled: true, value: 60 } });
    expect(v.focus?.distance).toMatchObject({ value: null, up: { enabled: true, value: 100 } });
    expect(v.focus?.reps).toBeNull();
    expect(v.focus?.loadField).toBeNull();
    expect(v.focus?.missing).toBe('time');
    expect(v.focus?.workTimer).toMatchObject({ state: 'idle', label: 'Start', elapsedMs: null });
    expect(v.primary).toMatchObject({ kind: 'start_work', label: 'Start', logLabel: null });
  });
});

describe('the cardio timer: tap to start, ✓ logs the time (19 Oct)', () => {
  it('counts up from the stored start, whatever duration was asked; ✓ stops it and logs the time with the typed distance', () => {
    const { s: s0, setId } = withRower();
    const s1 = apply(s0, { type: 'start_work_interval', at: at(100), opId: 'start-row', setId, durationS: 45 });
    expect(s1.workInterval).toMatchObject({ setId, durationS: CARDIO_TIMER_CAP_S, status: 'running', startedAtUtc: at(100).utc });
    const running = view(s1, 100 + 754);
    expect(running.focus?.workTimer).toMatchObject({ state: 'running', label: 'Stop', elapsedMs: 754_000, remainingMs: null });
    // The big button logs the time so far (review S6); Stop is the small one.
    expect(running.primary).toEqual({ kind: 'log', label: 'Log 12:34' });
    expect(running.workAction).toEqual({ kind: 'stop_work', label: 'Stop' });
    // While it runs ✓ is live: the time comes from the timer.
    expect(running.focus?.missing).toBeNull();
    expect(running.focus?.logValues.durationS).toBe(754);

    const s2 = apply(s1, { type: 'save_draft', at: at(1290), setId, values: { load: null, reps: null, durationS: null, rpe: null, rir: null, distanceM: 4800 } });
    const s3 = apply(s2, logCmd(setId, { load: null, reps: null, durationS: 5, rpe: null, rir: null, distanceM: 4800 }, 1300));
    // The timer's 20:00 wins over any time in the command; the distance is as typed.
    expect(s3.sets.find((x) => x.id === setId)?.actual).toMatchObject({ durationS: 1200, distanceM: 4800 });
    expect(s3.workInterval).toBeNull();
  });

  it('survives a force-close: the time comes from the stored start, never a JS interval', () => {
    const { s: s0, setId } = withRower();
    const s1 = apply(s0, { type: 'start_work_interval', at: at(100), opId: 'start-row', setId, durationS: 1 });
    // What the store keeps is plain JSON; a relaunch rebuilds the view from it at a later clock.
    const reloaded = SessionAggregateSchema.parse(JSON.parse(JSON.stringify(s1)));
    expect(view(reloaded, 100 + 1800).focus?.workTimer?.elapsedMs).toBe(1_800_000);
    const wi = reloaded.workInterval;
    if (wi === null) throw new Error('no timer');
    expect(cardioElapsedMs(wi, T0_MS + (100 + 61) * 1000)).toBe(61_000);
  });

  it('Stop puts the time so far in the field; pause time is left out; ✓ then logs it', () => {
    const { s: s0, setId } = withRower();
    let s = apply(s0, { type: 'start_work_interval', at: at(100), opId: 'start-row', setId, durationS: 1 });
    s = apply(s, { type: 'pause', at: at(400), opId: 'p' });
    s = apply(s, { type: 'resume', at: at(460), opId: 'r' });
    s = apply(s, { type: 'stop_work_interval', at: at(760), opId: 'stop', setId });
    expect(s.sets.find((x) => x.id === setId)?.draft).toMatchObject({ durationS: 600 });
    const v = view(s, 770);
    expect(v.focus?.workTimer?.state).toBe('ended');
    expect(sp(v.focus?.logLabel)).toBe('Log 10:00');
  });

  it('a timed (non-cardio) set still refuses ✓ while its timer runs', () => {
    const plank = exercise(242, 'Plank', { measurement: 'duration', compatibleEquipment: [], defaultLoadConvention: 'bodyweight' });
    let s = startFixture().state;
    s = apply(s, buildAddExerciseCommand({ opId: 'add-plank', owner: profile(), exercise: plank, equipmentId: null, at: at(5), newId: idGen(62_000) }));
    const [p] = setsFor(s, plank.id);
    s = apply(s, { type: 'start_work_interval', at: at(10), opId: 'w', setId: p?.id ?? '', durationS: 45 });
    expectError(reduceSession(s, logCmd(p?.id ?? '', { load: null, reps: null, durationS: 30, rpe: null, rir: null }, 20)), 'work_interval_running');
  });
});

describe('targets: cardio repeats last time, never progresses', () => {
  it('the built-in rule never adds load or reps to cardio', () => {
    const t = calculateNextTargets({
      exerciseName: 'Rowing machine',
      measurement: 'cardio',
      history: [],
      rule: builtInDefaultRule('owner', 'kg', 1, 'compound'),
      equipment: null,
      unit: 'kg',
      convention: 'bodyweight',
      pain: { active: false, reportedAtUtc: null },
    });
    expect(t.decision).toBe('unsupported');
    expect(t.sets).toEqual([]);
  });

  it('next time (Repeat) targets last time’s time and distance', () => {
    const { s: s0, setId } = withRower();
    let s = apply(s0, logCmd(setId, { load: null, reps: null, durationS: 1200, rpe: null, rir: null, distanceM: 4800 }, 1300));
    for (const ex of s.exercises) if (s.sets.some((x) => x.sessionExerciseId === ex.id && x.status === 'pending')) s = apply(s, { type: 'skip_exercise', at: at(1400), opId: `skip-${ex.id}`, sessionExerciseId: ex.id });
    s = apply(s, { type: 'finish', at: at(1500), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    const out = startWorkoutFromSession({ opId: 'rep', owner: profile(), gymId: s.session.gymId ?? '', source: s, exercises: new Map([[ROWER.id, ROWER]]), gymEquipment: s.session.equipmentSnapshot, at: at(86_400), newId: idGen(63_000) });
    // Only the skipped lifts are listed: the row's time and distance come across.
    expect(out.notCopied.filter((x) => x.kind === 'distance')).toEqual([]);
    const row = out.aggregate.exercises.find((e) => e.exerciseId === ROWER.id);
    expect(row?.measurement).toBe('cardio');
    const next = out.aggregate.sets.filter((x) => x.sessionExerciseId === row?.id);
    expect(next).toHaveLength(1);
    expect(next[0]?.planned).toMatchObject({ load: null, reps: null, durationS: 1200, distanceM: 4800 });
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(out.aggregate))).success).toBe(true);
  });

  it('a new cardio slot is one 10-minute set', () => {
    expect(defaultSlotShape(ROWER)).toMatchObject({ workingSets: 1, reps: null, durationS: 600 });
  });
});

describe('Progress: cardio keeps out of e1RM, volume and muscle sets', () => {
  function finishedRow(): SessionAggregate {
    const { s: s0, setId } = withRower();
    let s = apply(s0, logCmd(setId, { load: null, reps: null, durationS: 1200, rpe: null, rir: null, distanceM: 4800 }, 1300));
    for (const ex of s.exercises) if (s.sets.some((x) => x.sessionExerciseId === ex.id && x.status === 'pending')) s = apply(s, { type: 'skip_exercise', at: at(1400), opId: `skip-${ex.id}`, sessionExerciseId: ex.id });
    return apply(s, { type: 'finish', at: at(1500), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
  }

  it('a cardio series has its own kind: distance and time, never Est. 1RM, top set or volume', () => {
    expect(seriesKind('bodyweight', null, 'cardio')).toBe('cardio');
    expect(metricsFor('cardio')).toEqual(['total_distance', 'best_distance', 'total_time']);
  });

  it('per-exercise history shows time, distance and pace; no records table', () => {
    const p = toProgressSession(finishedRow(), 'Pacific/Auckland', ms(2000));
    if (p === null) throw new Error('not in history');
    const series = collectExerciseSeries([p], ROWER.id);
    expect(series.map((x) => x.kind)).toEqual(['cardio']);
    const tab = buildExerciseTabView({ sessions: [p], exerciseId: ROWER.id, today: p.date, window: { from: '2000-01-01', to: p.date } });
    expect(tab?.measures.map((m) => m.key)).toEqual(['distance']);
    expect(sp(tab?.table.rows[0]?.cells.topSet)).toBe('20:00 · 4,800 m · 2:05 /500 m');
    expect(tab?.table.rows[0]?.cells.e1rm).toBe('—');
    expect(tab?.table.rows[0]?.cells.total).toBe('—');
  });
});

describe('finding cardio machines', () => {
  it('a Cardio filter; a rower needs no gym item and isn’t filed under Bodyweight', () => {
    expect(EQUIPMENT_FILTERS).toContain('cardio');
    expect(equipmentFiltersOf(ROWER)).toEqual(['cardio']);
    expect(needsNoEquipment(ROWER)).toBe(true);
  });

  it('the picker’s Cardio chip lists only cardio, A–Z', () => {
    const list = [{ exercise: { id: 'b', name: 'Bench press', measurement: 'reps' as const } }, { exercise: { id: ROWER.id, name: ROWER.name, measurement: 'cardio' as const } }, { exercise: { id: BIKE.id, name: BIKE.name, measurement: 'cardio' as const } }];
    expect(pickerSections(list, '', ['b'], { cardio: true })).toEqual([{ title: 'Cardio', items: [list[2], list[1]] }]);
    expect(pickerSections(list, 'row', [], { cardio: true }).map((x) => x.items.map((i) => i.exercise.name))).toEqual([['Rowing machine']]);
  });
});

describe('review fixes: ✓ at 0 s, Resume after Stop, old timers, the cap, Undo (S4, S6, S7)', () => {
  it('S4: a time or distance of 0 is no value; ✓ right after Start is refused and the timer keeps running', () => {
    expect(cardioHasValue({ durationS: 0, distanceM: null })).toBe(false);
    expect(cardioHasValue({ durationS: null, distanceM: 0 })).toBe(false);
    expect(cardioHasValue({ durationS: 1, distanceM: undefined })).toBe(true);
    const { s: s0, setId } = withRower();
    const s1 = apply(s0, { type: 'start_work_interval', at: at(100), opId: 'start-row', setId, durationS: 1 });
    expectError(reduceSession(s1, logCmd(setId, { load: null, reps: null, durationS: null, rpe: null, rir: null }, 100)), 'invalid_values');
    const v = view(s1, 100);
    expect(v.focus?.logLabel).toBeNull();
    expect(v.primary).toEqual({ kind: 'stop_work', label: 'Stop' });
    expect(s1.workInterval?.status).toBe('running');
    // A second later the big button logs it.
    expect(view(s1, 101).primary).toEqual({ kind: 'log', label: 'Log 0:01' });
  });

  it('S6: Stop then Resume carries the same timer on; ✓ logs both segments, the gap left out', () => {
    const { s: s0, setId } = withRower();
    let s = apply(s0, { type: 'start_work_interval', at: at(100), opId: 'start-row', setId, durationS: 1 });
    s = apply(s, { type: 'stop_work_interval', at: at(700), opId: 'stop', setId });
    const stopped = view(s, 760);
    expect(stopped.primary).toEqual({ kind: 'log', label: 'Log 10:00' });
    expect(stopped.workAction).toEqual({ kind: 'resume_work', label: 'Resume', durationS: CARDIO_TIMER_CAP_S });
    expect(stopped.focus?.workTimer).toMatchObject({ state: 'ended', elapsedMs: 600_000, resumable: true });
    // Resume a minute later (water): the count goes on from 10:00, never from 0.
    s = apply(s, { type: 'start_work_interval', at: at(760), opId: 'resume', setId, durationS: CARDIO_TIMER_CAP_S });
    expect(view(s, 760).focus?.workTimer?.elapsedMs).toBe(600_000);
    expect(view(s, 1360).focus?.workTimer?.elapsedMs).toBe(1_200_000);
    expect(view(s, 1360).workAction).toEqual({ kind: 'stop_work', label: 'Stop' });
    s = apply(s, logCmd(setId, { load: null, reps: null, durationS: null, rpe: null, rir: null, distanceM: 4800 }, 1360));
    expect(s.sets.find((x) => x.id === setId)?.actual).toMatchObject({ durationS: 1200, distanceM: 4800 });
  });

  it('S6: resumeCardioInterval only from a stopped timer under the cap', () => {
    const base: WorkInterval = { setId: 's', durationS: CARDIO_TIMER_CAP_S, startedAtUtc: at(0).utc, deadlineUtc: at(CARDIO_TIMER_CAP_S).utc, status: 'stopped', remainingMsAtPause: null, pausedMs: 0, endedAtUtc: at(300).utc };
    expect(resumeCardioInterval(base, ms(400))).toMatchObject({ status: 'running', pausedMs: 100_000, endedAtUtc: null, deadlineUtc: at(400 + CARDIO_TIMER_CAP_S - 300).utc });
    expect(resumeCardioInterval({ ...base, status: 'running', endedAtUtc: null }, ms(400))).toBeNull();
    expect(resumeCardioInterval({ ...base, status: 'completed', endedAtUtc: at(CARDIO_TIMER_CAP_S).utc }, ms(CARDIO_TIMER_CAP_S + 5))).toBeNull();
  });

  it('S7: an air-bike timer started before migration 20 (10-minute interval) runs on past 10:00 as cardio', () => {
    const { s: s0, setId } = withRower();
    // As stored by the old build: a timed interval to its 10:00 target.
    const old: SessionAggregate = { ...s0, workInterval: { setId, durationS: 600, startedAtUtc: at(100).utc, deadlineUtc: at(700).utc, status: 'running', remainingMsAtPause: null, pausedMs: 0, endedAtUtc: null } };
    expect(asCardioInterval(old.workInterval as WorkInterval)).toMatchObject({ durationS: CARDIO_TIMER_CAP_S, deadlineUtc: at(100 + CARDIO_TIMER_CAP_S).utc, startedAtUtc: at(100).utc });
    const ticked = reduceSession(old, { type: 'tick', at: at(800) });
    if (!ticked.ok) throw new Error('tick');
    expect(ticked.events.filter((e) => e.type === 'WorkIntervalEnded')).toEqual([]);
    expect(ticked.state.workInterval).toMatchObject({ status: 'running', durationS: CARDIO_TIMER_CAP_S });
    expect(view(ticked.state, 1300).focus?.workTimer?.elapsedMs).toBe(1_200_000);
    const done = apply(ticked.state, logCmd(setId, { load: null, reps: null, durationS: null, rpe: null, rir: null, distanceM: 6000 }, 1300));
    expect(done.sets.find((x) => x.id === setId)?.actual).toMatchObject({ durationS: 1200, distanceM: 6000 });
  });

  it('S7: the 4-hour cap ends the timer with the cap as the draft; nothing is logged; Start can’t restart it', () => {
    const { s: s0, setId } = withRower();
    const s1 = apply(s0, { type: 'start_work_interval', at: at(100), opId: 'start-row', setId, durationS: 1 });
    const r = reduceSession(s1, { type: 'tick', at: at(100 + CARDIO_TIMER_CAP_S + 5) });
    if (!r.ok) throw new Error('tick');
    expect(r.events).toEqual([expect.objectContaining({ type: 'WorkIntervalEnded', reason: 'completed', elapsedS: CARDIO_TIMER_CAP_S })]);
    const set = r.state.sets.find((x) => x.id === setId);
    expect(set).toMatchObject({ status: 'pending', draft: { durationS: CARDIO_TIMER_CAP_S } });
    expect(view(r.state, 100 + CARDIO_TIMER_CAP_S + 10).workAction).toBeNull();
    expectError(reduceSession(r.state, { type: 'start_work_interval', at: at(100 + CARDIO_TIMER_CAP_S + 10), opId: 'again', setId, durationS: 1 }), 'invalid_values');
  });

  it('S7: Undo of a cardio log puts its time and distance back in the field, with no timer running; logging again gives the same set', () => {
    const { s: s0, setId } = withRower();
    let s = apply(s0, { type: 'start_work_interval', at: at(100), opId: 'start-row', setId, durationS: 1 });
    s = apply(s, logCmd(setId, { load: null, reps: null, durationS: null, rpe: null, rir: null, distanceM: 4800 }, 1300));
    const logged = s.sets.find((x) => x.id === setId);
    s = apply(s, { type: 'undo_log', at: at(1310), opId: 'undo', setId, expectedSetVersion: logged?.version ?? 0 });
    const back = s.sets.find((x) => x.id === setId);
    expect(back).toMatchObject({ status: 'pending', actual: null, draft: { durationS: 1200, distanceM: 4800 } });
    expect(s.workInterval).toBeNull();
    const v = view(s, 1320);
    expect(v.focus?.workTimer?.state).toBe('idle');
    expect(v.primary.kind).toBe('start_work');
    expect(sp(v.primary.kind === 'start_work' ? v.primary.logLabel : null)).toBe('Log 20:00 · 4,800 m');
    s = apply(s, logCmd(setId, v.focus?.logValues ?? { load: null, reps: null, durationS: null, rpe: null, rir: null }, 1330, 'relog'));
    expect(s.sets.find((x) => x.id === setId)?.actual).toMatchObject({ durationS: 1200, distanceM: 4800 });
  });
});

describe('S5: a cardio time is typed as the machine shows it', () => {
  it('20:34 and 20.34 are 20 min 34 s; 20 is 20 minutes; 1:05:00 is an hour and 5 minutes', () => {
    expect(parseCardioTime('20:34')).toBe(1234);
    expect(parseCardioTime('20.34')).toBe(1234);
    expect(parseCardioTime('20,34')).toBe(1234);
    expect(parseCardioTime('20')).toBe(1200);
    expect(parseCardioTime('1:05:00')).toBe(3900);
    expect(parseCardioTime(' 0:45 ')).toBe(45);
  });

  it('half-typed or impossible times are no value (never a guess); nothing past 4 h', () => {
    expect(parseCardioTime('')).toBeNull();
    expect(parseCardioTime('20.3')).toBeNull();
    expect(parseCardioTime('20:75')).toBeNull();
    expect(parseCardioTime('20:')).toBeNull();
    expect(parseCardioTime('abc')).toBeNull();
    expect(parseCardioTime('4:00:01')).toBeNull();
    expect(parseCardioTime('240')).toBe(CARDIO_TIMER_CAP_S);
  });
});

describe('B1: next time repeats last time’s time and distance on every path', () => {
  const history = (over: Partial<HistorySession> = {}): HistorySession => ({
    sessionId: id(900),
    performedAtUtc: at(0).utc,
    equipmentId: null,
    gymId: GYM,
    imported: false,
    tz: 'Pacific/Auckland',
    routineName: 'Push + row',
    sets: [{ setType: 'working', side: null, load: null, reps: null, rpe: null, rir: null, durationS: 1200, distanceM: 4800, setId: id(901), version: 2, number: 1 }],
    ...over,
  });

  it('cardioRepeatTargets: the latest workout with a counted cardio set, as it was, sourced as a repeat', () => {
    const newer = history({ sessionId: 'new', performedAtUtc: at(86_400).utc, sets: [{ setType: 'working', side: null, load: null, reps: null, rpe: null, rir: null, durationS: 1500, setId: 'set-2' }] });
    const empty = history({ sessionId: 'newest', performedAtUtc: at(172_800).utc, sets: [{ setType: 'working', side: null, load: null, reps: null, rpe: null, rir: null, durationS: 0 }] });
    const t = cardioRepeatTargets([history(), newer, empty], { at: at(200_000) });
    expect(t?.map((x) => x.setType)).toEqual(['working']);
    expect(t?.map((x) => x.planned)).toEqual([expect.objectContaining({ load: null, reps: null, durationS: 1500, rpe: null, rir: null, source: 'repeat' })]);
    expect(t?.[0]?.planned.distanceM).toBeUndefined();
    const one = cardioRepeatTargets([history()], { at: at(200_000) });
    expect(one?.[0]?.planned).toMatchObject({ durationS: 1200, distanceM: 4800, provenance: { source: 'repeat', basis: { sessionId: id(900), sets: [{ setId: id(901), values: { durationS: 1200, distanceM: 4800 } }] } } });
    // Flagged sets and warm-ups don't set next time's target; no history, no target.
    expect(cardioRepeatTargets([history({ sets: [{ setType: 'working', side: null, load: null, reps: null, rpe: null, rir: null, durationS: 1200, exclusions: ['spotted'] }] })], { at: at(1) })).toBeNull();
    expect(cardioRepeatTargets([], { at: at(1) })).toBeNull();
  });

  it('a saved workout’s 10:00 row starts at last time’s 20:00 · 4,800 m (the routine’s set count kept)', () => {
    const r = routine([routineExercise(700, { exerciseId: ROWER.id, equipmentId: null, order: 0, setTemplates: [template(7001, { targetLoad: null, targetReps: null, targetDurationS: 600 })] })]);
    const targets = new Map([[ROWER.id, cardioRepeatTargets([history()], { at: at(90_000) }) ?? []]]);
    const out = planRoutineStart({ opId: 'rs-row', owner: profile(), gymId: GYM, routine: r, exercises: new Map([[ROWER.id, ROWER]]), knownEquipment: new Map(), gymEquipment: [], at: at(90_000), newId: idGen(81_000), targets });
    const sets = setsFor(out.aggregate, ROWER.id);
    expect(sets.map((x) => x.planned)).toEqual([expect.objectContaining({ load: null, reps: null, durationS: 1200, distanceM: 4800, source: 'repeat' })]);
    expect(sets[0]?.planned.provenance?.source).toBe('repeat');
    expect(SessionAggregateSchema.safeParse(JSON.parse(JSON.stringify(out.aggregate))).success).toBe(true);
    // A distance-only last time starts as a distance-only set.
    const distOnly = new Map([[ROWER.id, cardioRepeatTargets([history({ sets: [{ setType: 'working', side: null, load: null, reps: null, rpe: null, rir: null, distanceM: 2000 }] })], { at: at(90_000) }) ?? []]]);
    const out2 = planRoutineStart({ opId: 'rs-row-2', owner: profile(), gymId: GYM, routine: r, exercises: new Map([[ROWER.id, ROWER]]), knownEquipment: new Map(), gymEquipment: [], at: at(90_000), newId: idGen(82_000), targets: distOnly });
    expect(setsFor(out2.aggregate, ROWER.id).map((x) => x.planned)).toEqual([expect.objectContaining({ durationS: null, distanceM: 2000 })]);
  });

  it('cardioTemplatesWithTargets: each set takes its own, the last past the end; warm-ups untouched', () => {
    const ruleOf = new Map<string, PlannedSet>();
    const t = cardioTemplatesWithTargets(
      [template(1, { setType: 'warmup', targetReps: null, targetDurationS: 300 }), template(2, { targetReps: null, targetDurationS: 600 }), template(3, { targetReps: null, targetDurationS: 600, targetDistanceM: 1000 })],
      [{ setType: 'working', planned: { load: null, reps: null, durationS: 900, distanceM: 3000, rpe: null, rir: null } }],
      { newId: idGen(83_000), ruleOf },
    );
    expect(t.map((x) => [x.setType, x.targetDurationS, x.targetDistanceM])).toEqual([['warmup', 300, undefined], ['working', 900, 3000], ['working', 900, 3000]]);
    expect(ruleOf.size).toBe(2);
  });
});

describe('S1: today’s cardio edit and the add sheets take a long time and a distance', () => {
  const edit = (o: Record<string, unknown>) => TodayEditSchema.safeParse({ editId: id(910), opId: 'op-edit-1', atUtc: at(0).utc, replacesEditId: null, removed: null, kind: 'reps', slotKey: id(911), reps: null, ...o }).success;

  it('a cardio edit (it carries its distance) may hold 20:00 or a distance alone; any other row stays at most 10:00', () => {
    expect(edit({ durationS: 1200, distanceM: 4800 })).toBe(true);
    expect(edit({ durationS: null, distanceM: 5000 })).toBe(true);
    expect(edit({ durationS: CARDIO_TIMER_CAP_S, distanceM: null })).toBe(true);
    expect(edit({ durationS: null, distanceM: null })).toBe(false);
    expect(edit({ durationS: 1200 })).toBe(false);
    expect(edit({ durationS: 600 })).toBe(true);
  });

  it('today’s shape puts the time and distance on every working set; null clears the distance', () => {
    const ts = [template(1, { targetReps: null, targetDurationS: 600, targetDistanceM: 2000 }), template(2, { targetReps: null, targetDurationS: 600 })];
    const a = shapeTemplates(ts, { reps: { reps: null, durationS: 1200, distanceM: 4800 } }, { newId: idGen(84_000) });
    expect(a.map((x) => [x.targetDurationS, x.targetDistanceM])).toEqual([[1200, 4800], [1200, 4800]]);
    const b = shapeTemplates(ts, { reps: { reps: null, durationS: 1200, distanceM: null } }, { newId: idGen(85_000) });
    expect(b.map((x) => [x.targetDurationS, x.targetDistanceM])).toEqual([[1200, undefined], [1200, undefined]]);
  });

  it('an add with Ben’s time and distance (Library sheet) shapes the new cardio set', () => {
    const plan = shapeAddPlan(null, { workingSets: 1, durationS: null, distanceM: 5000 });
    expect(plan.map((x) => x.setType)).toEqual(['working']);
    expect(plan.map((x) => x.planned)).toEqual([expect.objectContaining({ reps: null, durationS: null, distanceM: 5000 })]);
  });

  it('a build’s distance-only cardio set is a whole target; a set with neither is still refused', () => {
    expect(DraftSetTemplateSchema.safeParse({ setType: 'working', reps: null, durationS: null, distanceM: 5000, targetRpe: null, restS: null }).success).toBe(true);
    expect(DraftSetTemplateSchema.safeParse({ setType: 'working', reps: null, durationS: null, targetRpe: null, restS: null }).success).toBe(false);
    expect(DraftSetTemplateSchema.safeParse({ setType: 'working', reps: { min: 8, max: 10 }, durationS: null, distanceM: 5000, targetRpe: null, restS: null }).success).toBe(false);
  });
});
