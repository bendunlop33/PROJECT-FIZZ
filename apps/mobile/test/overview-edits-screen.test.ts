import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { OverviewGroup, OverviewRow, RowActions } from '@fizz/domain';

import {
  changeCardState,
  createOpIds,
  editMenuItems,
  editPills,
  editToast,
  listHeaderText,
  noSwapsText,
  pageToast,
  reorderUnits,
  rowCustomActions,
  showsWhy,
  swapSubtitle,
  swapTap,
  TODAY_EDITS_COPY,
  type ChangeCard,
} from '../src/workout/overview-edits';

/**
 * The overview's today's-edits UI rules (overview-today-edits.md §2–§5) and
 * source checks: pills in the spec's order per row state, VoiceOver custom
 * actions, Reorder rows (a superset moves as one), the change-review card's
 * states, one opId per intent, toasts once, minimal copy, and that the
 * screen computes nothing and calls no coach.
 */

const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const actions = (over: Partial<RowActions> = {}): RowActions => ({ swap: true, undoSwap: false, skip: true, bringBack: false, doFirst: true, up: true, down: true, changeRoutine: false, ...over });
function row(name: string, over: Partial<OverviewRow> = {}): OverviewRow {
  return { name, slotKey: `slot-${name}`, indexText: '01', edit: null, actions: actions(), ...over } as unknown as OverviewRow;
}

describe('row panel pills (§2.2)', () => {
  it('normal: Swap today · Skip today · Do first; the first row has no Do first; the last exercise left has no Skip today', () => {
    expect(editPills(row('Bench press')).map((p) => p.label)).toEqual(['Swap today', 'Skip today', 'Do first']);
    expect(editPills(row('Bench press', { actions: actions({ doFirst: false }) })).map((p) => p.label)).toEqual(['Swap today', 'Skip today']);
    expect(editPills(row('Bench press', { actions: actions({ skip: false }) })).map((p) => p.label)).toEqual(['Swap today', 'Do first']);
    expect(editPills(row('Bench press'))[0]?.accessibilityLabel).toBe('Swap today: Bench press');
  });
  it('swapped: Undo swap · Swap again · Skip today · Do first; skipped: Bring back only, and no Why?', () => {
    const swapped = row('DB bench press', { edit: { kind: 'swapped', editId: 'e', fromExerciseId: 'x', fromName: 'Bench press' }, actions: actions({ undoSwap: true, changeRoutine: true }) });
    expect(editPills(swapped).map((p) => p.label)).toEqual(['Undo swap', 'Swap again', 'Skip today', 'Do first']);
    const skipped = row('Cable fly', { edit: { kind: 'skipped', editId: 'e' }, actions: actions({ swap: false, skip: false, bringBack: true, doFirst: false }) });
    expect(editPills(skipped).map((p) => p.label)).toEqual(['Bring back']);
    expect(showsWhy(skipped)).toBe(false);
    expect(showsWhy(swapped)).toBe(true);
  });
  it('VoiceOver custom actions: Swap today, Skip today / Bring back, Do first, Move up, Move down', () => {
    expect(rowCustomActions(row('Bench press')).map((a) => a.label)).toEqual(['Swap today', 'Skip today', 'Do first', 'Move up', 'Move down']);
    expect(rowCustomActions(row('Cable fly', { actions: actions({ swap: false, skip: false, bringBack: true, doFirst: false, down: false }) })).map((a) => a.label)).toEqual(['Bring back', 'Move up']);
  });
});

describe('list header, menu, Reorder and the Swap sheet (§2.1, §2.3, §2.4)', () => {
  it('`5 exercises · 3 edited` only with edits; the menu adds Reorder, and Reset today’s edits only with edits', () => {
    expect(listHeaderText({ exerciseCount: 5, editCount: 3 })).toBe('5 exercises · 3 edited');
    expect(listHeaderText({ exerciseCount: 1, editCount: 0 })).toBe('1 exercise');
    const rows = [row('a'), row('b')];
    expect(editMenuItems({ editCount: 0, rows })).toEqual(['Reorder']);
    expect(editMenuItems({ editCount: 2, rows })).toEqual(['Reorder', 'Reset today’s edits']);
    expect(editMenuItems({ editCount: 0, rows: [row('a')] })).toEqual([]);
  });
  it('a superset is one Reorder row with its members stacked; skipped members say so; ↑ / ↓ from the domain', () => {
    const groups: OverviewGroup[] = [
      { kind: 'single', row: row('Incline DB press', { actions: actions({ up: false }) }) },
      { kind: 'superset', rows: [row('Lateral raise'), row('Triceps pushdown', { edit: { kind: 'skipped', editId: 'e' } })] },
    ];
    const units = reorderUnits(groups);
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({ names: ['Incline DB press'], up: false, down: true, upLabel: 'Move Incline DB press up' });
    expect(units[1]).toMatchObject({ slotKey: 'slot-Lateral raise', superset: true, names: ['Lateral raise', 'Triceps pushdown'], skipped: [false, true], downLabel: 'Move Lateral raise and Triceps pushdown down' });
  });
  it('a sheet tap: the planned exercise is Undo; a flagged one asks first; else picked at once', () => {
    expect(swapTap({ planned: true, mayHurt: null })).toBe('undo');
    expect(swapTap({ planned: false, mayHurt: { flagId: 'f', confirm: { title: 't', message: 'm', confirm: 'Add anyway', cancel: 'Choose another' } } })).toBe('confirm');
    expect(swapTap({ planned: false, mayHurt: null })).toBe('pick');
    expect(noSwapsText('Main gym')).toBe('No swaps at Main gym.');
    expect(swapSubtitle('Main gym')).toBe('Main gym · today');
  });
});

describe('change-review card, opIds and page toasts', () => {
  const card: ChangeCard = { slotKey: 's', routineVersion: 3, fromName: 'Bench press', toName: 'DB bench press', toExerciseId: 'x', editId: 'e', state: 'ready' };
  it('ready while the routine is at the card’s version; out of date once it moved (Apply hidden); applied after Apply', () => {
    expect(changeCardState(card, 3)).toBe('ready');
    expect(changeCardState(card, 4)).toBe('out_of_date');
    expect(changeCardState({ ...card, state: 'applied', actionId: 'a' }, 4)).toBe('applied');
  });
  it('one opId per intent until it lands, so a retry after an error reuses it', () => {
    let n = 0;
    const ops = createOpIds(() => `op-${String((n += 1))}`);
    expect(ops.of('skip:a')).toBe('op-1');
    expect(ops.of('skip:a')).toBe('op-1');
    expect(ops.of('skip:b')).toBe('op-2');
    ops.done('skip:a');
    expect(ops.of('skip:a')).toBe('op-3');
  });
  it('`Earlier edits cleared` when the page says so; `Plan changed · 1 edit removed` once per draft version', () => {
    expect(pageToast({ cleared: true, removedEdits: 0, draft: null }, new Set())).toEqual({ key: 'cleared', text: 'Earlier edits cleared' });
    const t = pageToast({ cleared: false, removedEdits: 1, draft: { id: 'd', version: 2 } }, new Set());
    expect(t?.text).toBe('Plan changed · 1 edit removed');
    expect(pageToast({ cleared: false, removedEdits: 1, draft: { id: 'd', version: 2 } }, new Set([t?.key ?? '']))).toBeNull();
    // A coach change refused at this gym (review S1): said once.
    expect(pageToast({ cleared: false, removedEdits: 0, draft: null, coachRefused: 1 }, new Set())).toEqual({ key: 'coach-refused', text: 'Coach change didn’t fit here' });
    expect(pageToast({ cleared: false, removedEdits: 0, draft: null, coachRefused: 1 }, new Set(['coach-refused']))).toBeNull();
    expect(pageToast({ cleared: false, removedEdits: 2, draft: { id: 'd', version: 3 } }, new Set([t?.key ?? '']))?.text).toBe('Plan changed · 2 edits removed');
    expect(pageToast({ cleared: false, removedEdits: 0, draft: null }, new Set())).toBeNull();
  });
});

describe('minimal copy (§5)', () => {
  const spec = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'design', 'overview-today-edits.md'), 'utf8');
  const norm = (t: string) => t.replaceAll('’', "'").toLowerCase();
  const copy = norm(spec.slice(spec.indexOf('## 5. Copy'), spec.indexOf('## 6. Data needed')));
  it('every fixed string is in the spec’s copy table', () => {
    const fixed = [
      ...Object.values(TODAY_EDITS_COPY).map((v) => (typeof v === 'function' ? v('Push A') : v)),
      editToast.swapped('Bench press', 'DB bench press'),
      editToast.skipped('Cable fly'),
      editToast.first('Incline DB press'),
      editToast.orderReset,
      editToast.editsReset,
      editToast.routineChanged('Push A'),
      editToast.planChanged(1),
      editToast.cantUndo('Push A'),
    ];
    for (const text of fixed) expect(copy).toContain(norm(text.replace(/\.$/, '').replace(/^· /, '')));
  });
});

describe('source checks', () => {
  const screen = read('screens/workout/WorkoutOverviewScreen.tsx');
  const ui = read('ui/today-edits.tsx');
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('the screen formats only: it never applies an edit, ranks a candidate or computes an order or target (TE2, §6.5)', () => {
    expect(code(screen)).not.toMatch(/applyDraftCommand|rankSubstitutions|substituteTargets|moveSlot|planWithTodayEdits|snapPlanToGym|resolveTodayEdits/);
    expect(code(screen)).toMatch(/services\.overview\.move\(\{ \.\.\.b, slotKey: r\.slotKey, how \}\)/);
  });

  it('no AI: today’s edits, the Swap sheet and the card never call the coach (TE-A10)', () => {
    const calls = code(screen).match(/services\.coach\.\w+/g) ?? [];
    expect(calls.every((m) => m === 'services.coach.tapNextTarget')).toBe(true);
    expect(code(ui)).not.toMatch(/services|fetch\(/);
  });

  it('Start stays the only filled pill: Apply is an outline in the accent’s text colour (TE-A18)', () => {
    expect(screen.match(/<PrimaryButton\b/g)).toHaveLength(1);
    expect(ui).not.toMatch(/<PrimaryButton\b/);
    expect(ui).not.toMatch(/backgroundColor: (pressed \? [^:]+ : )?theme\.colors\.accent\b/);
    expect(ui).toContain("borderColor: theme.colors.accent");
  });

  it('targets: Reorder buttons 44 × 44, Swap rows ≥ 64 pt; no other fixed size on text', () => {
    const sizes = [...ui.matchAll(/\b(height|width|minHeight): (\d+)/g)].map((m) => `${m[1] ?? ''}:${m[2] ?? ''}`).sort();
    expect(sizes).toEqual(['height:44', 'minHeight:44', 'minHeight:64', 'width:3', 'width:44']);
  });

  it('Reduce Motion: no animation in Reorder or the sheet rows; the Swap sheet is the shared BottomCard (fades with Reduce Motion)', () => {
    expect(ui).not.toMatch(/Animated|LayoutAnimation|withTiming|withSpring/);
    expect(read('ui/sheet.tsx')).toContain("animationType={theme.a11y.reduceMotion ? 'fade' : 'slide'}");
  });

  it('rows are keyed by slot, and VoiceOver custom actions run the same edits', () => {
    expect(screen).toContain('key={r.slotKey}');
    expect(screen).toContain('open={open === r.slotKey}');
    expect(read('ui/overview.tsx')).toContain('accessibilityActions={customActions.map((a) => ({ name: a.name, label: a.label }))}');
  });

  it('rule 10: drafts are Your data and never reach coach context', () => {
    const coachFiles = ['coach/coach-service.ts', 'coach/sheet-view.ts', 'coach/slot-view.ts', 'coach/next-time-view.ts'];
    for (const f of coachFiles) expect(read(f)).not.toMatch(/drafts|PreStartDraft|pre_start/);
    expect(readFileSync(join(__dirname, '..', '..', '..', 'packages', 'coach', 'src', 'context.ts'), 'utf8')).not.toMatch(/drafts|PreStartDraft|pre_start/);
  });

  it('Start sends the draft the page showed (ADR 0022 §3)', () => {
    expect(read('workout/overview-start.ts')).toContain('draft: draftOf(req.page)');
  });
});
