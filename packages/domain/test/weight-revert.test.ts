import { describe, expect, it } from 'vitest';
import type { SessionAggregate, SessionCommand, SetValues } from '@fizz/schemas';

import {
  buildActiveSetView,
  buildPlannedSetEditView,
  buildWorkoutTableView,
  NBSP,
  pendingOwnValues,
  reconcileDraftEdits,
  reduceSession,
  saveDraftCommand,
  shownPlanned,
  type ActiveViewInput,
  type DraftEdits,
  type TableRow,
} from '../src/index';
import { at, kg, lb, ms, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * 21 Oct (Ben, build B, Back workout): "If I change the weights from pre set
 * then it keeps flicking back to before". Regression tests for each cause:
 * R1 rows other than the open one drew the preset over his draft; R2 a stale
 * screen edit was saved back over his newer target; R4 a typed value rounded
 * back onto the preset was reported as a change (exercise-popup tests).
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const input = (aggregate: SessionAggregate, over: Partial<ActiveViewInput> = {}): ActiveViewInput => ({ aggregate, nowMs: ms(10), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null, ...over });
const rowsOf = (s: SessionAggregate): TableRow[] => buildWorkoutTableView(input(s)).blocks.flatMap((b) => (b.kind === 'exercise' ? b.card.rows : b.superset.rounds.flatMap((r) => r.rows)));
const row = (s: SessionAggregate, setId: string): TableRow => {
  const r = rowsOf(s).find((x) => x.setId === setId);
  if (!r) throw new Error('row');
  return r;
};

function benchSets(s: SessionAggregate) {
  const [w, b1, b2] = setsFor(s, BENCH);
  if (!w || !b1 || !b2) throw new Error('fixture');
  return { w, b1, b2 };
}

const draft = (setId: string, v: SetValues, setVersion?: number): SessionCommand => saveDraftCommand({ setId, values: v, ...(setVersion !== undefined ? { setVersion } : {}) }, at(20));
const select = (s: SessionAggregate, setId: string, opId = `sel-${setId}`): SessionCommand => ({ type: 'set_active_set', at: at(21), opId, setId, expectedVersion: s.session.version });
const editPlanned = (setId: string, version: number, load: number, opId = 'edit-110'): SessionCommand => ({ type: 'edit_planned_set', at: at(30), opId, setId, expectedSetVersion: version, patch: { load: kg(load) } });

describe('R1: a pending row shows Ben’s own value, not the preset, after another row opens', () => {
  it('a draft 105 on set 1 stays 105 in its table cell after set 2 is opened (the reported flick)', () => {
    let s = startFixture().state;
    const { b1, b2 } = benchSets(s);
    s = apply(s, select(s, b1.id));
    s = apply(s, draft(b1.id, values(kg(105), 8)));
    s = apply(s, select(s, b2.id));
    const r = row(s, b1.id);
    expect(r.state).toBe('pending');
    expect(r.cells.load).toBe('105');
    // Reps equal to the top of the range aren't an edit: the row keeps its range.
    expect(plain(r.cells.value)).toBe('6–8');
    expect(r.accessibilityLabel).toContain('your edit');
    // The untouched row still shows its target.
    expect(row(s, b2.id).state).toBe('open');
    // Opening set 1 again shows the same value: no flick either way.
    s = apply(s, select(s, b1.id, 'sel-back'));
    expect(buildActiveSetView(input(s)).focus?.cells).toEqual({ load: '105', value: '8' });
  });

  it('own reps read as one number; a draft equal to the target is not an edit', () => {
    let s = startFixture().state;
    const { b1, b2 } = benchSets(s);
    s = apply(s, draft(b1.id, values(kg(100), 7)));
    s = apply(s, draft(b2.id, values(kg(100), 8)));
    expect([row(s, b1.id).cells.load, plain(row(s, b1.id).cells.value)]).toEqual(['100', '7']);
    expect([row(s, b2.id).cells.load, plain(row(s, b2.id).cells.value)]).toEqual(['100', '6–8']);
    expect(pendingOwnValues(s.sets.find((x) => x.id === b2.id) ?? b2, s.exercises[0] ?? { unit: 'kg', loadConvention: 'total', measurement: 'reps' })).toEqual({});
  });

  it('the Focus list row and the Edit set sheet open on Ben’s value too', () => {
    let s = startFixture().state;
    const { b1, b2 } = benchSets(s);
    s = apply(s, draft(b2.id, values(kg(105), 8)));
    const focusRows = buildActiveSetView(input(s)).focus?.rows ?? [];
    expect(plain(focusRows.find((r) => r.setId === b2.id)?.text)).toContain('105');
    const sheet = buildPlannedSetEditView(s, b2.id);
    expect(sheet?.loadField?.value).toBe(105);
    // Save there makes his value the target.
    expect(sheet?.patch).toMatchObject({ load: kg(105) });
    expect(buildPlannedSetEditView(s, b1.id)?.loadField?.value).toBe(100);
  });

  it('a draft load in another unit or convention is never drawn as the row’s (kg/lb, per-hand, stack)', () => {
    let s = startFixture().state;
    const { b1 } = benchSets(s);
    s = apply(s, draft(b1.id, values(lb(225), 8)));
    expect(row(s, b1.id).cells.load).toBe('100');
    const [r1] = setsFor(s, ROW);
    if (!r1) throw new Error('fixture');
    s = apply(s, draft(r1.id, values(kg(25, 'per_hand'), 12)));
    expect(row(s, r1.id).cells.load).toBe('50');
    s = apply(s, draft(r1.id, values(kg(55, 'stack'), 12)));
    expect(row(s, r1.id).cells.load).toBe('55');
  });

  it('done sets and sets without a draft are unchanged', () => {
    let s = startFixture().state;
    const { w, b1 } = benchSets(s);
    s = apply(s, logCmd(w.id, values(kg(60), 10), 10));
    const done = s.sets.find((x) => x.id === w.id);
    if (!done) throw new Error('fixture');
    expect(shownPlanned(done, { unit: 'kg', loadConvention: 'total', measurement: 'reps' })).toBe(done.planned);
    expect(shownPlanned(b1, { unit: 'kg', loadConvention: 'total', measurement: 'reps' })).toBe(b1.planned);
  });
});

describe('R2: a stale screen edit never overwrites Ben’s newer target', () => {
  it('Edit set to 110 after an unsaved 100: the screen edit is dropped, the late save is refused, 110 stays (reload too)', () => {
    let s = startFixture().state;
    const { b1 } = benchSets(s);
    s = apply(s, select(s, b1.id));
    const edits: DraftEdits = { setId: b1.id, values: values(kg(100), 7), setVersion: b1.version };
    s = apply(s, saveDraftCommand(edits, at(20)));
    s = apply(s, editPlanned(b1.id, b1.version, 110));
    const after = s.sets.find((x) => x.id === b1.id);
    expect(after?.planned.load).toEqual(kg(110));
    expect(after?.draft).toBeNull();
    // The screen's edits: gone, so the open row shows 110.
    const live = reconcileDraftEdits(edits, s);
    expect(live).toBeNull();
    expect(buildActiveSetView(input(s, { edits: live })).focus?.cells.load).toBe('110');
    // The debounced save that was already queued with the old values is refused (rule 5).
    expectError(reduceSession(s, saveDraftCommand(edits, at(31))), 'stale_version');
    // A later reload (no screen state) still shows 110, in the open row and in the table.
    expect(buildActiveSetView(input(s)).focus?.cells.load).toBe('110');
    expect(row(s, b1.id).cells.load).toBe('110');
  });

  it('a coach change keeps Ben’s edit (coach-adjustments §4.3), re-based so the next save lands', () => {
    let s = startFixture().state;
    const { w, b1, b2 } = benchSets(s);
    s = apply(s, logCmd(w.id, values(kg(60), 10), 10));
    const edits: DraftEdits = { setId: b1.id, values: values(kg(105), 8), setVersion: b1.version };
    s = apply(s, saveDraftCommand(edits, at(20)));
    s = expectOk(reduceSession(s, { type: 'adjust_pending_targets', at: at(100), opId: 'coach:1', expectedVersion: s.session.version, actionId: 'act-1', changes: [{ setId: b1.id, target: { load: kg(95), reps: { min: 8, max: 8 } } }, { setId: b2.id, target: { load: kg(95), reps: { min: 8, max: 8 } } }], removeSetIds: [], addSets: [] })).state;
    const live = reconcileDraftEdits(edits, s);
    expect(live?.values.load).toEqual(kg(105));
    expect(live?.setVersion).toBe(s.sets.find((x) => x.id === b1.id)?.version);
    expect(reduceSession(s, saveDraftCommand(live ?? edits, at(101))).ok).toBe(true);
  });

  it('an unchanged set keeps the same edits object; an older copy on screen never re-bases', () => {
    const s = startFixture().state;
    const { b1 } = benchSets(s);
    const edits: DraftEdits = { setId: b1.id, values: values(kg(105), 8), setVersion: b1.version };
    expect(reconcileDraftEdits(edits, s)).toBe(edits);
    const ahead: DraftEdits = { ...edits, setVersion: b1.version + 3 };
    expect(reconcileDraftEdits(ahead, s)).toBe(ahead);
    expect(reconcileDraftEdits(null, s)).toBeNull();
  });

  it('edits for a set that was logged or deleted are dropped', () => {
    let s = startFixture().state;
    const { w } = benchSets(s);
    const edits: DraftEdits = { setId: w.id, values: values(kg(62.5), 10), setVersion: w.version };
    s = apply(s, logCmd(w.id, values(kg(62.5), 10), 10));
    expect(reconcileDraftEdits(edits, s)).toBeNull();
  });

  it('a save without a version still works (older callers, restart recovery)', () => {
    let s = startFixture().state;
    const { b1 } = benchSets(s);
    s = apply(s, editPlanned(b1.id, b1.version, 110));
    s = apply(s, draft(b1.id, values(kg(112.5), 8)));
    expect(s.sets.find((x) => x.id === b1.id)?.draft?.load).toEqual(kg(112.5));
  });
});

describe('Setting a row back to its preset clears Ben’s draft (no silent no-op)', () => {
  it('edit_planned_set to the same target over a draft is a change: the draft goes, the row shows the target', () => {
    let s = startFixture().state;
    const { b1 } = benchSets(s);
    s = apply(s, draft(b1.id, values(kg(105), 8)));
    expect(row(s, b1.id).cells.load).toBe('105');
    const r = expectOk(reduceSession(s, editPlanned(b1.id, b1.version, 100)));
    expect(r.events.map((e) => e.type)).toContain('PlannedSetEdited');
    expect(r.state.sets.find((x) => x.id === b1.id)?.draft).toBeNull();
    expect(row(r.state, b1.id).cells.load).toBe('100');
    // Duplicate op: applied once.
    const again = reduceSession(r.state, editPlanned(b1.id, b1.version, 100));
    expect(again.ok && again.duplicate).toBe(true);
  });

  it('with no draft the same target is still a no-op', () => {
    const s = startFixture().state;
    const { b1 } = benchSets(s);
    const r = expectOk(reduceSession(s, editPlanned(b1.id, b1.version, 100)));
    expect(r.events).toEqual([]);
    expect(r.state).toBe(s);
  });
});
