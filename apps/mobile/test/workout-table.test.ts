import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP, tableLogLabel, type TableRow } from '@fizz/domain';
import type { SessionCommand } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { anchorReducer, anchorScrollY, bottomSpacerHeight, chipsFor, isTileFocused, rowTap, selectCommand, selectRowFlow, showsFolded, workoutMenu, workoutViewOf, type AnchorEvent, type AnchorRequest, type SelectOutcome } from '../src/workout/table';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * The workout Table view (active-workout §2A): anchoring and auto-advance,
 * the chips, row taps that select and never log, Finish placement, and the
 * whole loop on real SQLite with no coach: open anchored, log from the pill,
 * select a row, force-close mid-rest and relaunch on the same set.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

describe('anchor position (§2A.4)', () => {
  it('puts the anchor directly under its pinned header, or the header in place on the first row', () => {
    // Card at 400, header 120 tall; open row 300 below the card top (two done rows above it).
    expect(anchorScrollY({ cardTop: 400, headerHeight: 120, anchorTop: 700 })).toBe(580);
    // Set 1 is open: the anchor sits right under the header, so the header stays in its natural place.
    expect(anchorScrollY({ cardTop: 400, headerHeight: 120, anchorTop: 520 })).toBe(400);
    expect(anchorScrollY({ cardTop: 0, headerHeight: 120, anchorTop: 120 })).toBe(0);
  });

  it('the bottom spacer lets the anchor reach the top on the last sets, and is never negative', () => {
    expect(bottomSpacerHeight({ viewportHeight: 600, contentEnd: 1000, anchorY: 800 })).toBe(400);
    expect(bottomSpacerHeight({ viewportHeight: 600, contentEnd: 3000, anchorY: 800 })).toBe(0);
  });
});

describe('anchor requests: what may move the list (WT3, WT7)', () => {
  const step = (events: AnchorEvent[], reduceMotion = false): AnchorRequest | null => events.reduce<AnchorRequest | null>((cur, e) => anchorReducer(cur, e, { reduceMotion }), null);

  it('opening (Start, Resume, relaunch) and switching back from Focus jump without animation', () => {
    expect(step([])).toBeNull();
    expect(step([{ kind: 'opened' }])).toEqual({ animated: false, target: 'anchor', focus: true });
    expect(step([{ kind: 'view_switched' }])).toEqual({ animated: false, target: 'anchor', focus: true });
  });

  it('each Log auto-advances with motion; under Reduce Motion it jumps to the same place', () => {
    // VoiceOver focus moves to the new open row after a Log (S5).
    expect(step([{ kind: 'logged' }])).toEqual({ animated: true, target: 'anchor', focus: true });
    expect(step([{ kind: 'logged' }], true)).toEqual({ animated: false, target: 'anchor', focus: true });
    expect(step([{ kind: 'now_chip' }], true)).toEqual({ animated: false, target: 'anchor', focus: false });
  });

  it('only the open row’s own tiles move the list when the keypad opens; a note or rename keyboard doesn’t', () => {
    const load = { tile: 'load' };
    const reps = { tile: 'reps' };
    const note = { field: 'note' };
    expect(isTileFocused(reps, [load, reps, null, null])).toBe(true);
    expect(isTileFocused(note, [load, reps, null, null])).toBe(false);
    expect(isTileFocused(null, [load, reps, null, null])).toBe(false);
    expect(isTileFocused(null, [null, null])).toBe(false);
  });

  it('the keypad anchors the open row itself, not the after-set block above it (WT39, review S3)', () => {
    expect(step([{ kind: 'keypad_opened' }])).toEqual({ animated: true, target: 'open_row', focus: false });
    // A Log after it lands on the after-set block again.
    expect(step([{ kind: 'keypad_opened' }, { kind: 'applied' }, { kind: 'logged' }])).toMatchObject({ target: 'anchor' });
  });

  it('timers, toasts, effort taps, offers and reloads never move the list; Ben scrolling cancels a pending move', () => {
    const quiet: AnchorEvent[] = [{ kind: 'reloaded' }, { kind: 'rest_ended' }, { kind: 'effort' }, { kind: 'offer' }, { kind: 'toast' }];
    expect(step(quiet)).toBeNull();
    expect(step([{ kind: 'logged' }, { kind: 'user_scrolled' }])).toBeNull();
    expect(step([{ kind: 'logged' }, { kind: 'applied' }, ...quiet])).toBeNull();
  });

  it('selecting a row on screen moves nothing; from off-screen (voice, a menu) it re-anchors', () => {
    expect(step([{ kind: 'selected', onScreen: true }])).toBeNull();
    expect(step([{ kind: 'selected', onScreen: false }])).toEqual({ animated: true, target: 'anchor', focus: false });
  });
});

describe('chips (WT8, WT9)', () => {
  const base = { doneCount: 3, firstDoneTop: 0, openTop: 700, openBottom: 1000, scrollY: 580, viewportHeight: 600, pinnedHeight: 120 };
  it('anchored: `↑ N done` shows, no Now chip', () => {
    expect(chipsFor(base)).toEqual({ done: true, now: null });
  });
  it('a fresh workout: nothing done, no chip', () => {
    expect(chipsFor({ ...base, doneCount: 0, firstDoneTop: null, openTop: 120, openBottom: 400, scrollY: 0 })).toEqual({ done: false, now: null });
  });
  it('scrolled up past the open row: Now ↓ and the title instead of the done chip', () => {
    expect(chipsFor({ ...base, scrollY: 0 })).toEqual({ done: false, now: 'below' });
  });
  it('scrolled down past it: Now ↑', () => {
    expect(chipsFor({ ...base, scrollY: 1200 })).toEqual({ done: false, now: 'above' });
  });
});

describe('row taps (WT10, WT11, WT12; Ben decision 4)', () => {
  const row = (state: TableRow['state']) => ({ state, setId: `set-${state}` });
  it('a done row opens the correction sheet; a pending row (ring included) only selects; open and skipped do nothing', () => {
    expect(rowTap(row('done'))).toEqual({ kind: 'edit', setId: 'set-done' });
    expect(rowTap(row('pending'))).toEqual({ kind: 'select', setId: 'set-pending' });
    expect(rowTap(row('open'))).toEqual({ kind: 'none' });
    expect(rowTap(row('skipped'))).toEqual({ kind: 'none' });
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
  });
});

describe('folding (§2A.3)', () => {
  const folded = { key: 'bench', folded: { name: 'Bench press', summary: '100 × 8', skipped: false, accessibilityLabel: '' } };
  it('a finished block folds; expanded, it stays open until the open row moves to another block', () => {
    expect(showsFolded(folded, {}, 'row')).toBe(true);
    expect(showsFolded(folded, { bench: 'row' }, 'row')).toBe(false);
    expect(showsFolded(folded, { bench: 'row' }, 'face')).toBe(true);
    expect(showsFolded({ key: 'row', folded: null }, {}, 'row')).toBe(false);
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

  it('a superset keeps Adjust and acts on the open member: the group ⋯ uses the domain’s menu target, never A1 by position (review B3)', () => {
    const list = readFileSync(join(import.meta.dirname, '..', 'src', 'screens/workout/WorkoutTable.tsx'), 'utf8');
    expect(list).toMatch(/onMenu\(superset\.menuTarget\)/);
    expect(list).not.toMatch(/members\[0\]/);
    expect(list).toMatch(/<SupersetHeader[^>]*adjust=\{current \? props\.adjust : null\}/);
    // Each member line opens its own sheet and menu.
    expect(list).toMatch(/onMenu\(m\.sessionExerciseId\)/);
    expect(list).toMatch(/onName\(\{ sessionExerciseId: m\.sessionExerciseId/);
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
    expect(rowTap(third)).toEqual({ kind: 'select', setId: third.setId });
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
    // The screen opens anchored on it, without animation.
    expect(anchorReducer(null, { kind: 'opened' }, { reduceMotion: false })).toEqual({ animated: false, target: 'anchor', focus: true });
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
