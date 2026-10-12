import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { OverviewGroup, OverviewRow, RowActions } from '@fizz/domain';

import {
  createEditLane,
  defaultChecked,
  nextDraftVersion,
  stepperCount,
  EDIT_MODE_COPY,
  editModeToast,
  editMoves,
  editRowCustomActions,
  editRowPills,
  editTopBar,
  loadPayload,
  repsDraftOf,
  repsDraftWith,
  repsPayload,
  repsSteps,
  typedLoadText,
  updateCardState,
  updateLink,
} from '../src/workout/overview-edits';

/**
 * Edit mode's screen-side rules (overview-today-edits §11.3–§11.8): pills and
 * VoiceOver actions per row state, which rows carry `↑` `↓`, the Update link
 * and card states, the Reps sheet's limits and payload, the typed load's
 * frame, minimal copy, and source checks (the screen computes nothing, calls
 * no coach, Start stays the only filled pill on the page, Reduce Motion).
 */

const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const actions = (over: Partial<RowActions> = {}): RowActions => ({ swap: true, undoSwap: false, skip: true, bringBack: false, doFirst: true, up: true, down: true, changeRoutine: false, remove: false, ...over });
const editRow = (over: Partial<OverviewRow['editRow']> = {}): OverviewRow['editRow'] => ({
  workingSets: 3,
  plannedSets: 3,
  setsText: '3 sets',
  setsDown: { workingSets: 2, clear: false },
  setsUp: { workingSets: 4, clear: false },
  repsText: '8–10 reps',
  reps: { min: 8, max: 10 },
  durationS: null,
  timed: false,
  repsEdited: false,
  plannedReps: { reps: { min: 8, max: 10 }, durationS: null },
  loadText: '30 kg each',
  noHistory: false,
  benLoad: false,
  intendedLoad: null,
  keypad: { unit: 'kg', convention: 'per_hand', equipmentId: 'rack', value: 30 },
  accessibilityLabel: '',
  ...over,
});
function row(name: string, over: Partial<OverviewRow> = {}): OverviewRow {
  return { name, slotKey: `slot-${name}`, indexText: '01', edit: null, actions: actions(), editRow: editRow(), ...over } as unknown as OverviewRow;
}

describe('Edit mode rows (§11.3, §11.7)', () => {
  it('pills: Swap · Skip; skipped: Bring back; added: Remove (never Skip or Swap)', () => {
    expect(editRowPills(row('Bench press')).map((p) => p.label)).toEqual(['Swap', 'Skip']);
    expect(editRowPills(row('Cable fly', { actions: actions({ swap: false, skip: false, bringBack: true }) })).map((p) => p.label)).toEqual(['Bring back']);
    expect(editRowPills(row('Face pull', { actions: actions({ swap: false, skip: false, remove: true }) })).map((p) => p.label)).toEqual(['Remove']);
    expect(editRowPills(row('Bench press', { actions: actions({ skip: false }) })).map((p) => p.label)).toEqual(['Swap']);
    expect(editRowPills(row('Bench press'))[0]?.accessibilityLabel).toBe('Swap: Bench press');
  });

  it('VoiceOver custom actions: Add set, Remove set, Change reps, Change target, Swap, Skip, Move up, Move down; disabled steps left out', () => {
    expect(editRowCustomActions(row('Incline'), { up: true, down: true }).map((a) => a.label)).toEqual(['Add set', 'Remove set', 'Change reps', 'Change target', 'Swap', 'Skip', 'Move up', 'Move down']);
    expect(editRowCustomActions(row('Bench', { editRow: editRow({ setsDown: null, keypad: null }) }), { up: false, down: true }).map((a) => a.name)).toEqual(['add_set', 'change_reps', 'swap', 'skip', 'move_down']);
    expect(editRowCustomActions(row('Fly', { edit: { kind: 'skipped', editId: 'e' } }), null).map((a) => a.label)).toEqual(['Bring back']);
  });

  it('↑ ↓ sit on single rows and a superset’s first member only (the group moves as one)', () => {
    const groups: OverviewGroup[] = [
      { kind: 'single', row: row('Bench press', { actions: actions({ up: false }) }) },
      { kind: 'superset', rows: [row('Lateral raise'), row('Triceps pushdown')] },
    ];
    const m = editMoves(groups);
    expect([...m.keys()]).toEqual(['slot-Bench press', 'slot-Lateral raise']);
    expect(m.get('slot-Bench press')).toMatchObject({ up: false, down: true, upLabel: 'Move Bench press up' });
    expect(m.get('slot-Lateral raise')?.downLabel).toBe('Move Lateral raise and Triceps pushdown down');
  });

  it('top bar: Reset only with edits', () => {
    expect(editTopBar({ editCount: 0 })).toEqual({ reset: false });
    expect(editTopBar({ editCount: 2 })).toEqual({ reset: true });
  });
});

describe('Update Push A and Save to Workouts (§11.5, TE15)', () => {
  const lines = [
    { key: 'swap:a', checked: true },
    { key: 'remove:b', checked: false },
  ];
  it('the link: Update on a saved workout with lines; Save to Workouts on a next session with edits; nothing otherwise', () => {
    expect(updateLink({ templateCard: { routineName: 'Push A' }, routine: { name: 'Push A' }, view: { editCount: 2 } })).toEqual({ kind: 'update', text: 'Update Push A ›' });
    expect(updateLink({ templateCard: null, routine: null, view: { editCount: 1 } })).toEqual({ kind: 'save', text: 'Save to Workouts ›' });
    expect(updateLink({ templateCard: null, routine: { name: 'Push A' }, view: { editCount: 1 } })).toBeNull();
    expect(updateLink({ templateCard: null, routine: null, view: { editCount: 0 } })).toBeNull();
  });
  it('skips start unticked; Apply needs a tick; out of date once Push A moved; applied shows Undo', () => {
    const checked = defaultChecked(lines);
    expect([...checked]).toEqual(['swap:a']);
    const card = { routineVersion: 3, draftVersion: 7, applied: null };
    expect(updateCardState(card, { routineVersion: 3, draftVersion: 7 }, checked)).toEqual({ state: 'ready', applyEnabled: true });
    expect(updateCardState(card, { routineVersion: 3, draftVersion: 7 }, new Set())).toEqual({ state: 'ready', applyEnabled: false });
    expect(updateCardState(card, { routineVersion: 4, draftVersion: 7 }, checked)).toEqual({ state: 'out_of_date', applyEnabled: false });
    expect(updateCardState({ ...card, applied: 'act' }, { routineVersion: 4, draftVersion: 8 }, checked).state).toBe('applied');
  });
  it('review B3: a draft edit while the card is open (Ben taps + again) makes it out of date: no Apply of values he never saw', () => {
    const checked = defaultChecked(lines);
    const card = { routineVersion: 3, draftVersion: 7, applied: null };
    expect(updateCardState(card, { routineVersion: 3, draftVersion: 8 }, checked)).toEqual({ state: 'out_of_date', applyEnabled: false });
    expect(updateCardState(card, { routineVersion: 3, draftVersion: null }, checked).state).toBe('out_of_date');
  });
});

describe('Reps sheet and the load keypad (§11.4, TE17)', () => {
  it('opens on today’s reps; Range ↔ Exact; steps stay within 1–50 and To ≥ From; back at the plan is a clear', () => {
    const d = repsDraftOf(editRow());
    expect(d).toEqual({ kind: 'reps', exact: false, min: 8, max: 10 });
    expect(repsSteps({ kind: 'reps', exact: false, min: 1, max: 1 }).from?.down).toMatchObject({ enabled: false });
    expect(repsSteps({ kind: 'reps', exact: false, min: 8, max: 8 }).to?.down).toMatchObject({ enabled: false });
    expect(repsSteps({ kind: 'reps', exact: true, min: 50, max: 50 }).from?.up).toMatchObject({ enabled: false, reason: 'Max 50' });
    const six = repsDraftWith(repsDraftWith(d, 'from', 6), 'to', 8);
    expect(repsPayload(six, editRow().plannedReps)).toEqual({ kind: 'reps', reps: { min: 6, max: 8 }, durationS: null });
    expect(repsPayload(d, editRow().plannedReps)).toEqual({ kind: 'clear' });
    const exact = repsDraftWith(d, 'exact');
    expect(exact).toEqual({ kind: 'reps', exact: true, min: 8, max: 8 });
    expect(repsDraftWith(exact, 'range')).toEqual({ kind: 'reps', exact: false, min: 8, max: 10 });
    expect(repsDraftWith(d, 'from', 99)).toMatchObject({ min: 50, max: 50 });
    expect(repsDraftWith(d, 'to', 2)).toMatchObject({ min: 8, max: 8 });
  });
  it('work time: ±5 s within 0:05–10:00', () => {
    const t = repsDraftOf(editRow({ timed: true, reps: null, durationS: 45 }));
    expect(t).toEqual({ kind: 'time', seconds: 45 });
    expect(repsSteps({ kind: 'time', seconds: 5 }).time?.down).toMatchObject({ enabled: false });
    expect(repsSteps({ kind: 'time', seconds: 600 }).time?.up).toMatchObject({ enabled: false });
    expect(repsPayload({ kind: 'time', seconds: 60 }, { reps: null, durationS: 45 })).toEqual({ kind: 'reps', reps: null, durationS: 60 });
    expect(repsDraftWith(t, 'time', 2)).toEqual({ kind: 'time', seconds: 5 });
  });
  it('the typed load keeps the row’s frame (kg/lb, each, assisted); nonsense is refused', () => {
    const k = { unit: 'lb' as const, convention: 'per_hand' as const, equipmentId: null, value: null };
    expect(loadPayload(52.5, k)).toEqual({ value: 52.5, unit: 'lb', convention: 'per_hand' });
    expect(loadPayload(Number.NaN, k)).toBeNull();
    expect(loadPayload(-1, k)).toBeNull();
    expect(typedLoadText({ value: 27.5, unit: 'kg', convention: 'stack' })).toBe('27.5 kg');
    expect(typedLoadText({ value: 20, unit: 'kg', convention: 'per_hand' })).toBe('20 kg each');
    expect(typedLoadText({ value: 30, unit: 'kg', convention: 'assistance' })).toBe('−30 kg');
  });
});

describe('minimal copy (§11.8)', () => {
  const spec = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'design', 'overview-today-edits.md'), 'utf8');
  const norm = (t: string) => t.replaceAll('’', "'").replaceAll('✓ ', '').toLowerCase();
  const copy = norm(spec.slice(spec.indexOf('### 11.3'), spec.indexOf('### 11.9')));
  it('every fixed string is in the spec', () => {
    const fixed = [
      ...Object.values(EDIT_MODE_COPY).map((v) => (typeof v === 'function' ? v('Push A') : v)),
      editModeToast.added('Face pull'),
      editModeToast.removed('Face pull'),
      editModeToast.target('27.5 kg'),
      editModeToast.updated('Push A'),
    ];
    for (const text of fixed) {
      if (text === 'Search') continue; // the picker's search field placeholder (exercise-library.md)
      expect(copy).toContain(norm(text.replace(/\.$/, '')).replace('reps · push a', 'reps · incline db press').replace('nothing else here at push a', 'nothing else here at main gym'));
    }
  });
});

describe('source checks', () => {
  const screen = read('screens/workout/WorkoutOverviewScreen.tsx');
  const sheets = read('screens/workout/OverviewEditSheets.tsx');
  const ui = read('ui/edit-mode.tsx');

  it('the screen and sheets format only: no planning, fitting, ranking or template change here (TE2, §6.5)', () => {
    for (const src of [screen, sheets, ui]) {
      expect(code(src)).not.toMatch(/applyDraftCommand|rankSubstitutions|rankAddCandidates|substituteTargets|addTargets|moveSlot|planWithTodayEdits|snapPlanToGym|resolveTodayEdits|applyEditsToRoutine|templateLinesFromEdits|roundToAvailableLoad|fixedLoadSteps/);
    }
    expect(code(screen)).toContain('services.overview.clearEdit(');
    expect(code(screen)).toContain('services.routines');
  });

  it('no AI: nothing in Edit mode calls the coach (TE-B12)', () => {
    const calls = code(screen).match(/services\.coach\.\w+/g) ?? [];
    expect(calls.every((m) => m === 'services.coach.tapNextTarget')).toBe(true);
    expect(code(ui)).not.toMatch(/services|fetch\(/);
    expect(code(sheets)).not.toMatch(/services\.|fetch\(/);
  });

  it('Start stays the only filled pill on the page; Apply is an outline accent; Set target is the keypad sheet’s own primary', () => {
    expect(screen.match(/<PrimaryButton\b/g)).toHaveLength(1);
    expect(ui).not.toMatch(/<PrimaryButton\b/);
    expect(ui).not.toMatch(/backgroundColor: (pressed \? [^:]+ : )?theme\.colors\.accent\b/);
    expect(sheets.match(/<PrimaryButton\b/g)).toHaveLength(1);
  });

  it('targets ≥ 44 pt: steppers, ↑ ↓, value buttons, check rows; links 52 pt', () => {
    const minHeights = [...ui.matchAll(/\bminHeight: (\d+)/g)].map((m) => Number(m[1]));
    expect(minHeights.length).toBeGreaterThan(0);
    expect(minHeights.every((n) => n >= 44)).toBe(true);
    expect(ui).toContain('width: 44,\n        height: 44,');
    expect(ui).toContain('minHeight: 52');
  });

  it('Reduce Motion: no animation in Edit mode; the sheets are the shared BottomCard (fades with Reduce Motion)', () => {
    expect(ui).not.toMatch(/Animated|LayoutAnimation|withTiming|withSpring/);
    expect(sheets).not.toMatch(/Animated|LayoutAnimation|withTiming|withSpring/);
    expect(sheets).toContain('<BottomCard');
  });

  it('VoiceOver: each row is one element with its custom actions; checkboxes say checked', () => {
    expect(ui).toContain('accessibilityActions={customActions.map((a) => ({ name: a.name, label: a.label }))}');
    expect(ui).toContain('accessibilityRole="checkbox"');
    expect(ui).toContain('accessibilityState={{ checked, disabled: stale }}');
  });

  it('⋯ → Reorder opens Edit mode (TE11 retires the v0.2 Reorder mode)', () => {
    expect(screen).not.toContain('ReorderRow');
    expect(code(screen)).toMatch(/picked === TODAY_EDITS_COPY\.reorder\) \{\s*setOpen\(null\);\s*setEditing\(true\);/);
  });
});

describe('review S2: quick stepper taps all land', () => {
  it('the next write builds on the newer of the page’s draft and the last write’s', () => {
    expect(nextDraftVersion(null, null)).toBeNull();
    expect(nextDraftVersion({ id: 'd', version: 3 }, null)).toBe(3);
    // The first write landed; the page hasn't re-read yet (it still shows v3, or no draft at all).
    expect(nextDraftVersion({ id: 'd', version: 3 }, { id: 'd', version: 4 })).toBe(4);
    expect(nextDraftVersion(null, { id: 'd', version: 1 })).toBe(1);
    // The page caught up (or something else moved it further).
    expect(nextDraftVersion({ id: 'd', version: 6 }, { id: 'd', version: 4 })).toBe(6);
    // A new draft (a new day): the page's.
    expect(nextDraftVersion({ id: 'e', version: 1 }, { id: 'd', version: 9 })).toBe(1);
  });

  it('a second + steps from the count the first write left until the page shows it', () => {
    expect(stepperCount(3, 7, undefined)).toBe(3);
    expect(stepperCount(3, 7, { count: 4, version: 8 })).toBe(4);
    expect(stepperCount(4, 8, { count: 4, version: 8 })).toBe(4);
    // The page is newer than the pending write: the page wins.
    expect(stepperCount(5, 9, { count: 4, version: 8 })).toBe(5);
    expect(stepperCount(3, null, { count: 4, version: 1 })).toBe(4);
  });

  it('the lane queues stepper taps behind a running write and drops other taps', async () => {
    const lane = createEditLane();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const first = lane.run(() => new Promise<string>((r) => { release = () => { order.push('first'); r('first'); }; }));
    expect(lane.busy()).toBe(true);
    const queued = lane.run(() => { order.push('queued'); return Promise.resolve('queued'); }, { queue: true });
    const dropped = lane.run(() => { order.push('dropped'); return Promise.resolve('dropped'); });
    expect(await dropped).toBeNull();
    release();
    expect(await first).toBe('first');
    expect(await queued).toBe('queued');
    expect(order).toEqual(['first', 'queued']);
    expect(lane.busy()).toBe(false);
    // A failed write doesn't block the lane.
    await expect(lane.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await lane.run(() => Promise.resolve('after'))).toBe('after');
  });
});
