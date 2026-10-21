import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP, tableLogLabel, type TableRow } from '@fizz/domain';
import type { SessionCommand } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { cellEditReducer, correctionPatch, doneRowEditing, loadCellA11y, valueCellA11y, openRowEditing, runRowTap, rowTap, selectCommand, selectRowFlow, workoutMenu, workoutViewOf, type SelectOutcome } from '../src/workout/table';
import { buildRounds, queueSelect, resetsPick, roundPrimary, roundStrip, SELECT_IDLE, selectLanded, selectOnShow, shownRoundIndex } from '../src/workout/rounds';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * The workout table (active-workout §2A, workout-table-v3): row taps that
 * select and never log, a done row's ✓ that unticks, Finish placement, and
 * the whole loop on real SQLite with no coach: open on the stored set, log
 * from the pill, select a row, force-close mid-rest and relaunch on the same
 * set. The v3 round page's layout is in workout-rounds.test.ts.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

describe('row taps (WT10, WT11, WT12; Ben decision 4)', () => {
  const row = (state: TableRow['state']) => ({ state, setId: `set-${state}` });
  it('a done row opens Edit set and its ✓ unticks it (v3 §3); a pending row opens Edit set and its ring only selects; open and skipped do nothing', () => {
    expect(rowTap(row('done'))).toEqual({ kind: 'edit', setId: 'set-done' });
    expect(rowTap(row('done'), 'marker')).toEqual({ kind: 'untick', setId: 'set-done' });
    expect(rowTap(row('pending'))).toEqual({ kind: 'edit', setId: 'set-pending' });
    expect(rowTap(row('pending'), 'marker')).toEqual({ kind: 'select', setId: 'set-pending' });
    expect(rowTap(row('open'), 'marker')).toEqual({ kind: 'none' });
    expect(rowTap(row('open'))).toEqual({ kind: 'none' });
    expect(rowTap(row('skipped'))).toEqual({ kind: 'none' });
  });
  it('a KG or REPS cell edits in place (18 Oct): pending selects then opens the cell, done corrects in its row; no full-screen editor', () => {
    const cols = { loadLabel: 'KG', valueLabel: 'REPS' } as const;
    expect(rowTap({ ...row('pending'), columns: cols }, 'load')).toEqual({ kind: 'select_edit', setId: 'set-pending', field: 'load' });
    expect(rowTap({ ...row('pending'), columns: cols }, 'value')).toEqual({ kind: 'select_edit', setId: 'set-pending', field: 'reps' });
    expect(rowTap({ ...row('done'), columns: cols }, 'load')).toEqual({ kind: 'correct', setId: 'set-done', field: 'load' });
    expect(rowTap({ ...row('done'), columns: { loadLabel: null, valueLabel: 'TIME' } }, 'value')).toEqual({ kind: 'correct', setId: 'set-done', field: 'time' });
    expect(rowTap({ ...row('done'), columns: { loadLabel: 'KG', valueLabel: 'DIST' } }, 'value')).toEqual({ kind: 'correct', setId: 'set-done', field: 'distance' });
    // A row with no load column has no load cell: the set number still opens Edit set.
    expect(rowTap({ ...row('pending'), columns: { loadLabel: null, valueLabel: 'REPS' } }, 'load')).toEqual({ kind: 'edit', setId: 'set-pending' });
    expect(rowTap({ ...row('open'), columns: cols }, 'load')).toEqual({ kind: 'none' });
    expect(rowTap({ ...row('skipped'), columns: cols }, 'value')).toEqual({ kind: 'none' });
    const calls: string[] = [];
    const h = { dismissKeyboard: () => calls.push('dismiss'), edit: () => calls.push('edit'), select: () => calls.push('select'), selectEdit: (id: string, f: string) => calls.push(`selectEdit:${id}:${f}`), correct: (id: string, f: string) => calls.push(`correct:${id}:${f}`), untick: (id: string) => calls.push(`untick:${id}`) };
    runRowTap({ ...row('pending'), columns: cols }, h, 'load');
    runRowTap({ ...row('done'), columns: cols }, h, 'value');
    runRowTap({ ...row('done'), columns: cols }, h, 'marker');
    expect(calls).toEqual(['dismiss', 'selectEdit:set-pending:load', 'dismiss', 'correct:set-done:reps', 'dismiss', 'untick:set-done']);
  });
});

describe('in-place cell editing (18 Oct; review S3, S4, S6)', () => {
  const open = { kind: 'tap', setId: 's2', field: 'load', row: 'open' } as const;
  it('a cell tap opens it; the same tap, Done or a tap elsewhere closes it', () => {
    const s = cellEditReducer(null, open);
    expect(s).toEqual({ setId: 's2', field: 'load', row: 'open' });
    expect(cellEditReducer(s, open)).toBeNull();
    expect(cellEditReducer(s, { kind: 'close' })).toBeNull();
    // Another cell moves the editor there.
    expect(cellEditReducer(s, { ...open, field: 'reps' })).toEqual({ setId: 's2', field: 'reps', row: 'open' });
  });
  it('a Log closes it, so an Undo that makes the set current again never reopens it', () => {
    const s = cellEditReducer(null, open);
    const logged = cellEditReducer(s, { kind: 'logged' });
    expect(logged).toBeNull();
    // After Undo, s2 is active again: nothing is open.
    expect(openRowEditing(logged, 's2')).toBeNull();
    // Without the close, the stale edit would have shown up again on s2.
    expect(openRowEditing(s, 's2')).toBe('load');
    expect(openRowEditing(s, 's3')).toBeNull();
    expect(cellEditReducer(s, { kind: 'selected' })).toBeNull();
  });
  it('Enter load opens the open row’s load cell and never toggles it shut', () => {
    const s = cellEditReducer(null, { kind: 'enter', setId: 's2', field: 'load' });
    expect(openRowEditing(s, 's2')).toBe('load');
    expect(cellEditReducer(s, { kind: 'enter', setId: 's2', field: 'load' })).toEqual(s);
  });
  it('a done row’s edit is a correction, never the open row’s draft', () => {
    const s = cellEditReducer(null, { kind: 'tap', setId: 's1', field: 'reps', row: 'done' });
    expect(doneRowEditing(s)).toEqual({ setId: 's1', field: 'reps', row: 'done' });
    expect(openRowEditing(s, 's1')).toBeNull();
    expect(doneRowEditing(cellEditReducer(null, open))).toBeNull();
  });
  it('a correction sends only what changed, and nothing when unchanged (rule 2: one versioned write on close)', () => {
    const kg = (value: number) => ({ value, unit: 'kg' as const, convention: 'total' as const });
    const actual = { load: kg(100), reps: 8, durationS: null, distanceM: null };
    expect(correctionPatch(actual, actual)).toBeNull();
    expect(correctionPatch(actual, { ...actual, reps: 7 })).toEqual({ reps: 7 });
    expect(correctionPatch(actual, { ...actual, load: kg(102.5) })).toEqual({ load: kg(102.5) });
  });
  it('a select is set_active_set, versioned; never log_set', () => {
    const at = { utc: '2026-10-08T17:00:00.000Z', tz: 'Europe/London' };
    expect(selectCommand('s3', 7, at, 'op-1')).toEqual({ type: 'set_active_set', at, opId: 'op-1', setId: 's3', expectedVersion: 7 });
  });
});

describe('selectRowFlow: save the open row’s draft, then select (review S6, N9)', () => {
  const at = { utc: '2026-10-10T07:00:00.000Z', tz: 'Europe/London' };
  const draft = { type: 'save_draft' as const, at, setId: 'open', values: { load: null, reps: 5, durationS: null, rpe: null, rir: null } };
  const ok = (version: number): SelectOutcome => ({ ok: true, aggregate: { session: { version } } });

  it('saves the draft first and selects with the version the save returned; never logs', async () => {
    const calls: SessionCommand[] = [];
    const r = await selectRowFlow({
      setId: 'third',
      version: 7,
      draft,
      at,
      opId: 'sel-1',
      save: (cmd) => {
        calls.push(cmd);
        return Promise.resolve(ok(7));
      },
      select: (cmd) => {
        calls.push(cmd);
        return Promise.resolve(ok(8));
      },
    });
    expect(r).toEqual({ ok: true });
    expect(calls.map((c) => c.type)).toEqual(['save_draft', 'set_active_set']);
    expect(calls[1]).toMatchObject({ setId: 'third', expectedVersion: 7, opId: 'sel-1' });
    expect(calls.some((c) => c.type === 'log_set')).toBe(false);
  });

  it('no draft: selects straight away on the screen’s version; a failed save still selects', async () => {
    const seen: number[] = [];
    await selectRowFlow({ setId: 's', version: 4, draft: null, at, opId: 'o', save: () => Promise.reject(new Error('not called')), select: (cmd) => (seen.push(cmd.expectedVersion), Promise.resolve(ok(5))) });
    await selectRowFlow({ setId: 's', version: 4, draft, at, opId: 'o2', save: () => Promise.resolve({ ok: false, error: { code: 'write_failed', message: 'disk' } }), select: (cmd) => (seen.push(cmd.expectedVersion), Promise.resolve(ok(5))) });
    expect(seen).toEqual([4, 4]);
  });

  it('a refused select is reported: stale (a double tap) quietly, anything else with its reason', async () => {
    const refuse = (code: string) => selectRowFlow({ setId: 's', version: 4, draft: null, at, opId: 'o', save: () => Promise.resolve(ok(4)), select: () => Promise.resolve({ ok: false, error: { code, message: `refused: ${code}` } }) });
    expect(await refuse('stale_version')).toMatchObject({ ok: false, quiet: true });
    expect(await refuse('set_not_pending')).toEqual({ ok: false, quiet: false, code: 'set_not_pending', message: 'refused: set_not_pending' });
    // A write conflict is a real failure, never a silent dead tap (review r2 S4).
    expect(await refuse('write_conflict')).toMatchObject({ ok: false, quiet: false, code: 'write_conflict' });
  });
});

describe('Finish placement and the top bar menu (WT27, WT28, check 14)', () => {
  it('Finish is in ⋯ (and the Log slot only when all is done), never in the list; Focus view leads', () => {
    const m = workoutMenu({ view: 'table', paused: false, openEnded: false, ax: false, gymName: 'Main Gym' });
    expect(m.map((x) => x.label)).toEqual(['Focus view', 'Pause workout', 'Rename workout', 'Ask the coach', 'Finish workout', 'Edit workout times', 'Discard workout']);
    expect(workoutMenu({ view: 'focus', paused: true, openEnded: true, ax: true, gymName: 'Main Gym' }).map((x) => x.label)).toEqual([
      'Table view',
      'Resume workout',
      'Gym: Main Gym ›',
      'Ask the coach',
      'Finish workout',
      'Edit workout times',
      'Discard workout',
    ]);
  });

  it('Table is the default view', () => {
    expect(workoutViewOf(undefined)).toBe('table');
    expect(workoutViewOf('focus')).toBe('focus');
  });

  it('v3: each exercise (3a, 3b) has its own ⋯ and name sheet; Adjust sits on the exercise with the open row (review B3)', () => {
    const list = readFileSync(join(import.meta.dirname, '..', 'src', 'screens/workout/WorkoutTable.tsx'), 'utf8');
    expect(list).toMatch(/p\.onMenu\(ex\.sessionExerciseId\)/);
    expect(list).toMatch(/p\.onName\(\{ sessionExerciseId: ex\.sessionExerciseId/);
    expect(list).toContain('{ex.isCurrent ? p.adjust : null}');
    expect(list).not.toMatch(/members\[0\]/);
  });

  it('the Table code has one Log path and no Finish in the list, and never computes progression or loads', () => {
    const src = join(import.meta.dirname, '..', 'src');
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
    const loggers = files(src).filter((f) => /type: 'log_set'/.test(readFileSync(f, 'utf8')));
    expect(loggers.map((f) => relative(src, f))).toEqual(['screens/workout/WorkoutScreen.tsx']);
    expect(readFileSync(join(src, 'screens/workout/WorkoutScreen.tsx'), 'utf8').match(/type: 'log_set'/g)).toHaveLength(1);
    const list = readFileSync(join(src, 'screens/workout/WorkoutTable.tsx'), 'utf8');
    expect(list).not.toMatch(/Finish workout/);
    const table = list + readFileSync(join(src, 'workout/table.ts'), 'utf8');
    expect(table).not.toMatch(/'log_set'|commitSet/);
    expect(table).not.toMatch(/getAchievableLoads|roundToAvailableLoad|stepLoad|calculateNextTargets|nextTarget/);
  });
});

// ---------------------------------------------------------------------------
// End to end on real SQLite, no coach connected (WT42, rule 1)

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function benchWorkout(s: AppServices): Promise<string> {
  const gymId = await setUpGym(h, s);
  const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const picks = await s.workout.pickerExercises(sessionId, 'Bench press');
  const bench = picks.find((p) => p.exercise.name === 'Bench press');
  const added = await s.workout.addExercise({ sessionId, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId: 'add-bench' });
  if (!added.ok) throw new Error(added.error.message);
  return sessionId;
}

const load60 = { value: 60, unit: 'kg' as const, convention: 'total' as const };

describe('the Table loop end to end, offline (WT1, WT6, WT10, WT13, WT42)', () => {
  it('opens on set 1; one Log saves exactly the pill; the next row opens; no coach needed', async () => {
    const { services: s } = await h.launch();
    expect((await s.coach.availability()).status).not.toBe('ok');
    const sessionId = await benchWorkout(s);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const t = s.workout.tableView(data, h.clockMs, null);
    const first = t.anchor?.setId ?? '';
    const v0 = s.workout.view(data, h.clockMs, null);
    expect(first).toBe(v0.focus?.setId);
    expect(t.doneCount).toBe(0);

    const edits = { setId: first, values: { ...(v0.focus?.draft ?? { load: null, reps: null, durationS: null, rpe: null, rir: null }), load: load60 } };
    const v = s.workout.view(data, h.clockMs, edits);
    const pill = tableLogLabel(v.primary, s.workout.tableView(data, h.clockMs, edits).log, { offscreen: false });
    expect(plain(pill.label)).toBe('Set 1 · Log 60 kg × 6');
    h.clockMs += 30_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v.focus?.opId ?? '', setId: first, values: v.focus?.logValues ?? edits.values, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    expect(logged.aggregate.sets.find((x) => x.id === first)?.actual).toMatchObject({ load: load60, reps: 6 });

    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const after = s.workout.tableView(data, h.clockMs, null);
    expect(after.doneCount).toBe(1);
    expect(after.anchor?.setId).not.toBe(first);
    expect(after.anchor?.setId).toBe(s.workout.view(data, h.clockMs, null).focus?.setId);
  });

  it('tapping a non-current row selects it and never logs; the previous row keeps its draft', async () => {
    const { services: s } = await h.launch();
    const sessionId = await benchWorkout(s);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const t = s.workout.tableView(data, h.clockMs, null);
    const rows = t.blocks[0]?.kind === 'exercise' ? t.blocks[0].card.rows : [];
    const [open, , third] = rows;
    if (!open || !third) throw new Error('rows');
    expect(rowTap(third, 'marker')).toEqual({ kind: 'select', setId: third.setId });
    // The screen's own flow: the open row's unsaved edit is saved, then the select, on the version the save returned.
    const selected = await selectRowFlow({
      setId: third.setId,
      version: data.aggregate.session.version,
      draft: { type: 'save_draft', at: h.now(), setId: open.setId, values: { load: load60, reps: 5, durationS: null, rpe: null, rir: null } },
      at: h.now(),
      opId: 'sel-1',
      save: (cmd) => s.workout.dispatch(sessionId, cmd),
      select: (cmd) => s.workout.dispatch(sessionId, cmd),
    });
    expect(selected).toEqual({ ok: true });
    const sel = await s.workout.load();
    if (!sel) throw new Error('no workout');
    expect(sel.aggregate.sets.filter((x) => x.status === 'completed')).toHaveLength(0);
    // A second tap on the same row with the old version is refused as stale, quietly, and changes nothing.
    const again = await selectRowFlow({ setId: third.setId, version: data.aggregate.session.version, draft: null, at: h.now(), opId: 'sel-dup', save: (cmd) => s.workout.dispatch(sessionId, cmd), select: (cmd) => s.workout.dispatch(sessionId, cmd) });
    expect(again).toMatchObject({ ok: false, quiet: true });
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(s.workout.tableView(data, h.clockMs, null).anchor?.setId).toBe(third.setId);
    // Back to the first row: its draft is still there.
    const back = await s.workout.dispatch(sessionId, selectCommand(open.setId, sel.aggregate.session.version, h.now(), 'sel-2'));
    if (!back.ok) throw new Error(back.error.message);
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(s.workout.view(data, h.clockMs, null).focus?.draft).toMatchObject({ load: load60, reps: 5 });
  });

  it('force-close mid-rest: relaunch lands on the same open row, its unsaved edit and the stored rest deadline', async () => {
    let { services: s } = await h.launch();
    const sessionId = await benchWorkout(s);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const v0 = s.workout.view(data, h.clockMs, { setId: s.workout.tableView(data, h.clockMs, null).anchor?.setId ?? '', values: { load: load60, reps: 6, durationS: null, rpe: null, rir: null } });
    h.clockMs += 30_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v0.focus?.opId ?? '', setId: v0.focus?.setId ?? '', values: v0.focus?.logValues ?? { load: load60, reps: 6, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const before = s.workout.tableView(data, h.clockMs, null);
    const openId = before.anchor?.setId ?? '';
    // An unsaved edit on the open row (the screen saves it as a draft after 300 ms).
    const saved = await s.workout.dispatch(sessionId, { type: 'save_draft', at: h.now(), setId: openId, values: { load: { ...load60, value: 62.5 }, reps: 5, durationS: null, rpe: null, rir: null } });
    if (!saved.ok) throw new Error(saved.error.message);
    const deadline = s.workout.view(data, h.clockMs, null).rest;
    expect(deadline?.kind).toBe('running');

    await h.forceClose();
    h.clockMs += 20_000;
    const relaunch = await h.launch();
    s = relaunch.services;
    expect(relaunch.recovery?.openInto).toBe('active_workout');
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const t = s.workout.tableView(data, h.clockMs, null);
    expect(t.anchor?.setId).toBe(openId);
    expect(t.doneCount).toBe(1);
    // v3: the page opens on the round with that set, and its box positions on it.
    const rounds = buildRounds(t, (id) => data.worksLines?.[id] ?? null);
    const shown = rounds[shownRoundIndex(rounds, null)];
    expect(shown?.current).toBe(true);
    expect(shown?.exercises.flatMap((e) => e.rows).find((r) => r.current)?.setId).toBe(openId);
    expect(data.worksLines?.[data.aggregate.exercises[0]?.exerciseId ?? '']).toMatch(/chest/i);
    const v = s.workout.view(data, h.clockMs, null);
    expect(v.focus?.setId).toBe(openId);
    expect(v.focus?.draft).toMatchObject({ load: { value: 62.5 }, reps: 5 });
    expect(v.focus?.draftSource).toBe('draft');
    expect(v.rest).toMatchObject({ kind: 'running' });
    if (v.rest?.kind !== 'running' || deadline?.kind !== 'running') throw new Error('rest');
    expect(v.rest.deadlineUtc).toBe(deadline.deadlineUtc);
    expect(v.rest.remainingMs).toBe(deadline.remainingMs - 20_000);
  });

  it('while resting, Log saves the open row and ends the rest; its alert is cancelled (WT13)', async () => {
    const { services: s } = await h.launch();
    const sessionId = await benchWorkout(s);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const firstId = s.workout.tableView(data, h.clockMs, null).anchor?.setId ?? '';
    const values = { load: load60, reps: 6, durationS: null, rpe: null, rir: null };
    const one = s.workout.view(data, h.clockMs, { setId: firstId, values });
    const r1 = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: one.focus?.opId ?? '', setId: firstId, values: one.focus?.logValues ?? values, restTimerId: h.ids() });
    if (!r1.ok) throw new Error(r1.error.message);
    await h.settle(s);
    const alertsBefore = [...h.pending.values()].map((a) => a.key);
    expect(alertsBefore).toHaveLength(1);
    h.clockMs += 10_000;
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const two = s.workout.view(data, h.clockMs, null);
    expect(two.phase).toBe('resting');
    const r2 = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: two.focus?.opId ?? '', setId: two.focus?.setId ?? '', values: two.focus?.logValues ?? values, restTimerId: h.ids() });
    if (!r2.ok) throw new Error(r2.error.message);
    await h.settle(s);
    expect(r2.aggregate.sets.filter((x) => x.status === 'completed')).toHaveLength(2);
    // One alert per workout: the old deadline's alert is replaced by the new rest's, never left to fire.
    const after = [...h.pending.values()].map((a) => a.key);
    expect(after).toHaveLength(1);
    for (const k of alertsBefore) expect(after).not.toContain(k);
  });
});

describe('cell labels (review S7)', () => {
  it('never reads `BW kg` or `— kg`', () => {
    expect(loadCellA11y('KG', '82.5')).toBe('Load 82.5 kg');
    expect(loadCellA11y('LB', '185')).toBe('Load 185 lb');
    expect(loadCellA11y('ASSIST KG', '20')).toBe('Assistance 20 kg');
    expect(loadCellA11y('+KG', '10')).toBe('Added load 10 kg');
    expect(loadCellA11y('+KG', 'BW')).toBe('Added load: bodyweight');
    expect(loadCellA11y('KG', '—')).toBe('Load: none');
    expect(loadCellA11y('KG', null)).toBe('Load: none');
    expect(loadCellA11y(null, '25\u00a0lb each')).toBe('Load 25 lb each');
  });
  it('reads ranges as words', () => {
    expect(valueCellA11y('REPS', '6–8')).toBe('Reps 6 to 8');
    expect(valueCellA11y('REPS', '—')).toBe('Reps: none');
    expect(valueCellA11y('TIME', '0:45')).toBe('Time 0:45');
    expect(valueCellA11y('DIST', '20\u00a0m')).toBe('Distance 20 m');
  });
});

describe('the v3 round page end to end, offline (workout-table-v3 §1–§3)', () => {
  it('one round per exercise; a finished round advances; a done round offers Next round; only the last log unticks; swipe-delete has Undo', async () => {
    const { services: s } = await h.launch();
    const sessionId = await benchWorkout(s);
    const picks = await s.workout.pickerExercises(sessionId, 'Lat pulldown');
    const pull = picks.find((p) => p.exercise.name === 'Lat pulldown') ?? picks[0];
    if (!pull) throw new Error('no second exercise');
    const added = await s.workout.addExercise({ sessionId, exerciseId: pull.exercise.id, equipmentId: pull.equipment[0]?.id ?? null, opId: 'add-pull' });
    if (!added.ok) throw new Error(added.error.message);

    const roundsNow = async () => {
      const d = await s.workout.load();
      if (!d) throw new Error('no workout');
      const r = buildRounds(s.workout.tableView(d, h.clockMs, null), (id) => d.worksLines?.[id] ?? null);
      return { d, r, shown: shownRoundIndex(r, null) };
    };
    let { d, r, shown } = await roundsNow();
    expect(r.map((x) => x.exercises.map((e) => e.label))).toEqual([['1'], ['2']]);
    expect(shown).toBe(0);
    expect(r[0]?.exercises[0]?.subline).toMatch(/chest/i);
    const step = roundPrimary({ rounds: r, shown, primary: s.workout.view(d, h.clockMs, null).primary });
    expect(step.kind).toBe('step');
    expect(step.kind === 'step' ? step.label : '').toMatch(/^(Warm-up|Set 1) · (Log|Enter) /);

    // Log every bench set: the page follows the open row into round 2 by itself.
    const loggedIds: string[] = [];
    for (let i = 0; i < 10 && r[0]?.hasPending === true; i += 1) {
      const f = s.workout.view(d, h.clockMs, null).focus;
      if (!f) throw new Error('no open row');
      h.clockMs += 60_000;
      const values = { ...f.logValues, load: f.logValues.load ?? load60, reps: f.logValues.reps ?? 6 };
      const out = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: f.opId, setId: f.setId, values, restTimerId: h.ids() });
      if (!out.ok) throw new Error(out.error.message);
      loggedIds.push(f.setId);
      ({ d, r, shown } = await roundsNow());
    }
    expect(r[0]?.done).toBe(true);
    expect(shown).toBe(1);
    expect(roundStrip(r, shown).map((c) => c.text)).toEqual(['✓ 1', '2']);
    // Back on the done round: nothing to select, and Log reads Next round.
    expect(selectOnShow(r[0])).toBeNull();
    expect(roundPrimary({ rounds: r, shown: 0, primary: s.workout.view(d, h.clockMs, null).primary })).toEqual({ kind: 'next_round', label: 'Next round', index: 1 });

    // A done row's ✓: only the latest log unticks; an older one is corrected instead.
    const older = d.aggregate.sets.find((x) => x.id === loggedIds[0]);
    const refused = await s.workout.dispatch(sessionId, { type: 'undo_log', at: h.now(), opId: 'untick-old', setId: older?.id ?? '', expectedSetVersion: older?.version ?? 0 });
    expect(refused).toMatchObject({ ok: false, error: { code: 'not_latest_set' } });
    const latest = d.aggregate.sets.find((x) => x.id === loggedIds.at(-1));
    const unticked = await s.workout.dispatch(sessionId, { type: 'undo_log', at: h.now(), opId: 'untick-new', setId: latest?.id ?? '', expectedSetVersion: latest?.version ?? 0 });
    expect(unticked.ok).toBe(true);
    ({ d, r, shown } = await roundsNow());
    expect(shown).toBe(0);
    expect(r[0]?.exercises[0]?.rows.find((x) => x.current)?.setId).toBe(latest?.id);

    // Swipe left on a pending row: deleted at once, and Undo brings it back (versioned, audited).
    const pending = r[1]?.exercises[0]?.rows[0];
    const set = d.aggregate.sets.find((x) => x.id === pending?.setId);
    const del = await s.workout.dispatch(sessionId, { type: 'delete_set', at: h.now(), opId: 'swipe-del', setId: set?.id ?? '', expectedSetVersion: set?.version ?? 0 });
    expect(del.ok).toBe(true);
    ({ r } = await roundsNow());
    expect(r[1]?.exercises[0]?.rows.some((x) => x.setId === set?.id)).toBe(false);
    expect((await s.workout.undoOp({ sessionId, targetOpId: 'swipe-del' })).ok).toBe(true);
    ({ r } = await roundsNow());
    expect(r[1]?.exercises[0]?.rows.some((x) => x.setId === set?.id)).toBe(true);
    // A stale delete (the set changed since it was shown) is refused, never applied to newer state.
    const stale = await s.workout.dispatch(sessionId, { type: 'delete_set', at: h.now(), opId: 'swipe-stale', setId: set?.id ?? '', expectedSetVersion: set?.version ?? 0 });
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale_version' } });
  });
});

describe('the v3 round page over real SQLite: supersets, relaunch, round change then log, done-set delete (wo-v3 logic S4)', () => {
  async function supersetWorkout(s: AppServices): Promise<{ sessionId: string; benchRow: string; pullRow: string }> {
    const sessionId = await benchWorkout(s);
    const picks = await s.workout.pickerExercises(sessionId, 'Lat pulldown');
    const pull = picks.find((p) => p.exercise.name === 'Lat pulldown') ?? picks[0];
    if (!pull) throw new Error('no second exercise');
    const added = await s.workout.addExercise({ sessionId, exerciseId: pull.exercise.id, equipmentId: pull.equipment[0]?.id ?? null, opId: 'add-pull' });
    if (!added.ok) throw new Error(added.error.message);
    const rows = [...added.aggregate.exercises].sort((a, b) => a.order - b.order);
    const benchRow = rows[0]?.id ?? '';
    const pullRow = rows[1]?.id ?? '';
    const linked = await s.workout.linkSuperset({ sessionId, sessionExerciseId: pullRow, withSessionExerciseId: benchRow, opId: 'link-1', expectedVersion: added.aggregate.session.version });
    if (!linked.ok) throw new Error(linked.error.message);
    return { sessionId, benchRow, pullRow };
  }
  const roundsNow = async (s: AppServices) => {
    const d = await s.workout.load();
    if (!d) throw new Error('no workout');
    const r = buildRounds(s.workout.tableView(d, h.clockMs, null), (id) => d.worksLines?.[id] ?? null);
    return { d, r };
  };
  const logOpen = async (s: AppServices, sessionId: string) => {
    const { d } = await roundsNow(s);
    const f = s.workout.view(d, h.clockMs, null).focus;
    if (!f) throw new Error('no open row');
    h.clockMs += 30_000;
    const row = d.aggregate.exercises.find((e) => e.id === f.sessionExerciseId);
    const up = f.loadField?.up;
    const load = f.logValues.load ?? (up?.enabled === true && row ? { value: up.value, unit: row.unit, convention: row.loadConvention } : load60);
    const out = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: f.opId, setId: f.setId, values: { ...f.logValues, load, reps: f.logValues.reps ?? 6 }, restTimerId: h.ids() });
    if (!out.ok) throw new Error(out.error.message);
    return { setId: f.setId, aggregate: out.aggregate };
  };

  it('a → b has no rest, the rest follows b; a relaunch mid-superset lands on the open round', async () => {
    const { services: s } = await h.launch();
    const { sessionId } = await supersetWorkout(s);
    let { r } = await roundsNow(s);
    expect(r).toHaveLength(1);
    expect(r[0]?.exercises.map((e) => e.label)).toEqual(['1a', '1b']);
    // Log through the warm-ups (if any) and the first a.
    let guard = 0;
    while (guard < 10 && r[0]?.exercises.find((e) => e.rows.some((x) => x.current))?.label !== '1b') {
      await logOpen(s, sessionId);
      ({ r } = await roundsNow(s));
      guard += 1;
    }
    expect(r[0]?.exercises.find((e) => e.rows.some((x) => x.current))?.label).toBe('1b');
    const { d: before } = await roundsNow(s);
    expect(before.aggregate.restTimer?.status).not.toBe('running');
    const b = await logOpen(s, sessionId);
    expect(b.aggregate.restTimer?.status).toBe('running');
    expect(b.aggregate.restTimer?.setId).toBe(b.setId);
    const openBefore = (await roundsNow(s)).r[0]?.exercises.flatMap((e) => e.rows).find((x) => x.current)?.setId;
    // Force-close and relaunch: the same round, the same open row.
    const { services: s2 } = await h.launch();
    const { r: r2 } = await roundsNow(s2);
    expect(shownRoundIndex(r2, null)).toBe(0);
    expect(r2[0]?.exercises.flatMap((e) => e.rows).find((x) => x.current)?.setId).toBe(openBefore);
  });

  it('a round change selects (never logs), the next Log lands on the shown round\'s set, a relaunch keeps it; replayed opIds are no-ops', async () => {
    const { services: s } = await h.launch();
    const sessionId = await benchWorkout(s);
    const picks = await s.workout.pickerExercises(sessionId, 'Lat pulldown');
    const pull = picks.find((p) => p.exercise.name === 'Lat pulldown') ?? picks[0];
    const added = await s.workout.addExercise({ sessionId, exerciseId: pull?.exercise.id ?? '', equipmentId: pull?.equipment[0]?.id ?? null, opId: 'add-pull' });
    if (!added.ok) throw new Error(added.error.message);
    let { d, r } = await roundsNow(s);
    expect(shownRoundIndex(r, null)).toBe(0);
    const doneBefore = d.aggregate.sets.filter((x) => x.status === 'completed').length;
    // Swipe to round 2: one set_active_set through the queue.
    const { q, send } = queueSelect(SELECT_IDLE, selectOnShow(r[1]));
    expect(send).toBe(r[1]?.firstPendingSetId);
    const sel = selectCommand(send ?? '', d.aggregate.session.version, h.now(), 'round-sel-1');
    const out = await s.workout.dispatch(sessionId, sel);
    expect(out.ok).toBe(true);
    expect(selectLanded(q, true).send).toBeNull();
    // The select doesn't reset the pick: the page stays on round 2.
    expect(resetsPick(send, new Set([send ?? '']))).toBe(false);
    ({ d, r } = await roundsNow(s));
    expect(d.aggregate.sets.filter((x) => x.status === 'completed')).toHaveLength(doneBefore);
    expect(shownRoundIndex(r, null)).toBe(1);
    // The same select replayed (a retry) changes nothing.
    const replay = await s.workout.dispatch(sessionId, sel);
    expect(replay.ok ? replay.aggregate.session.version : -1).toBe(d.aggregate.session.version);
    // Log: it lands on round 2's set.
    const logged = await logOpen(s, sessionId);
    expect(logged.setId).toBe(send);
    // Relaunch: still round 2.
    const { services: s2 } = await h.launch();
    expect(shownRoundIndex((await roundsNow(s2)).r, null)).toBe(1);
  });

  it('swipe-delete of a done set: audited with the logged values, Undo brings it back, and the untick window ends', async () => {
    const { services: s } = await h.launch();
    const sessionId = await benchWorkout(s);
    const first = await logOpen(s, sessionId);
    const second = await logOpen(s, sessionId);
    let { d } = await roundsNow(s);
    const done = d.aggregate.sets.find((x) => x.id === second.setId);
    const del = await s.workout.dispatch(sessionId, { type: 'delete_set', at: h.now(), opId: 'swipe-done', setId: done?.id ?? '', expectedSetVersion: done?.version ?? 0 });
    expect(del.ok).toBe(true);
    if (!del.ok) return;
    const audit = del.aggregate.audit.filter((a) => a.kind === 'deleted' && a.setId === done?.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.before?.status).toBe('completed');
    // A replayed delete is a no-op, not a second delete.
    const again = await s.workout.dispatch(sessionId, { type: 'delete_set', at: h.now(), opId: 'swipe-done', setId: done?.id ?? '', expectedSetVersion: done?.version ?? 0 });
    expect(again.ok ? again.aggregate.audit.filter((a) => a.kind === 'deleted').length : -1).toBe(1);
    // The delete ends the untick window: the older log can't be unticked past it.
    ({ d } = await roundsNow(s));
    const older = d.aggregate.sets.find((x) => x.id === first.setId);
    const untick = await s.workout.dispatch(sessionId, { type: 'undo_log', at: h.now(), opId: 'untick-past-delete', setId: older?.id ?? '', expectedSetVersion: older?.version ?? 0 });
    expect(untick).toMatchObject({ ok: false, error: { code: 'not_latest_set' } });
    expect((await s.workout.undoOp({ sessionId, targetOpId: 'swipe-done' })).ok).toBe(true);
    ({ d } = await roundsNow(s));
    expect(d.aggregate.sets.find((x) => x.id === done?.id)?.status).toBe('completed');
    expect(d.aggregate.sets.find((x) => x.id === done?.id)?.actual).toEqual(done?.actual);
  });
});
