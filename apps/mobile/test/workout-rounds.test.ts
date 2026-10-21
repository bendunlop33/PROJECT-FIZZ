import { describe, expect, it } from 'vitest';
import type { SupersetCard, TableBlock, TableCard, TableRow, WorkoutTableView } from '@fizz/domain';

import {
  boxAnchor,
  boxFades,
  boxFirstRow,
  buildRounds,
  clockText,
  fitRoundBoxes,
  keepInView,
  lastLogMs,
  lastTimeText,
  overTimeText,
  overviewRows,
  overviewTitle,
  pageOffsetFor,
  positionKey,
  roundPrimary,
  roundRows,
  roundStrip,
  rpeCellText,
  selectOnShow,
  setClockStartMs,
  shownRoundIndex,
  stepLabel,
  stepRound,
  timerBarMode,
  upNextText,
  whyView,
} from '../src/workout/rounds';

/**
 * Active workout v3 (workout-table-v3.md): the round page's pure view model.
 * Rows come from the domain's table view; these tests build them directly.
 */

const NBSP = ' ';
let seq = 0;
function row(over: Partial<TableRow> = {}): TableRow {
  seq += 1;
  return {
    setId: `s${String(seq)}`,
    number: seq,
    pairedWithSetId: null,
    badges: [],
    note: null,
    status: 'pending',
    text: '',
    edited: false,
    exclusions: [],
    exclusionTag: null,
    notCounted: null,
    exclusionAccessibility: null,
    version: 1,
    gymCaption: null,
    partStart: null,
    state: 'pending',
    setType: 'working',
    restAfterS: 90,
    spoken: '100 kilograms, 6 reps',
    columns: { kind: 'load_reps', loadLabel: 'KG', valueLabel: 'REPS' },
    cells: { load: '100', value: '6' },
    effort: `@${NBSP}8`,
    pace: null,
    todayChange: null,
    memberTag: null,
    blockTitle: '',
    blockValue: '',
    accessibilityLabel: '',
    ...over,
  };
}

function card(name: string, rows: TableRow[], over: Partial<TableCard> = {}): TableBlock {
  const c: TableCard = {
    key: `k-${name}`,
    sessionExerciseId: `se-${name}`,
    exerciseId: `ex-${name}`,
    name,
    headerLine: '',
    lastLine: 'Last 16 Oct: 7.5 × 12, 12, 12',
    subtitle: '',
    note: null,
    progress: { done: 0, total: rows.length },
    progressText: '',
    progressAccessibility: '',
    painBadge: false,
    columns: { kind: 'load_reps' as const, loadLabel: 'KG', valueLabel: 'REPS' as const },
    loadHeader: 'KG',
    repTarget: `6–8${NBSP}reps`,
    topSet: { value: 100, unit: 'kg' },
    rows,
    isCurrent: rows.some((r) => r.state === 'open'),
    hasPending: rows.some((r) => r.state === 'pending' || r.state === 'open'),
    unilateral: false,
    ...over,
  };
  return { kind: 'exercise', key: c.key, folded: null, card: c };
}

function superset(members: { name: string; rows: TableRow[]; loadHeader?: string }[]): TableBlock {
  const tags = members.map((_, i) => `A${String(i + 1)}`);
  const withTags = members.map((m, i) => m.rows.map((r) => ({ ...r, memberTag: tags[i] ?? null })));
  const n = Math.max(...withTags.map((r) => r.length));
  const rounds = Array.from({ length: n }, (_, k) => ({ n: k + 1, rows: withTags.flatMap((rs) => (rs[k] ? [rs[k]] : [])) }));
  const ss = {
    key: `ss-${members[0]?.name ?? ''}`,
    label: 'Superset A',
    round: { n: 1, of: n },
    roundText: '',
    members: members.map((m, i) => ({
      tag: tags[i] ?? '',
      sessionExerciseId: `se-${m.name}`,
      exerciseId: `ex-${m.name}`,
      name: m.name,
      unitCaption: '',
      painBadge: false,
      columns: { kind: 'load_reps', loadLabel: 'KG', valueLabel: 'REPS' },
      note: null,
      isCurrent: (withTags[i] ?? []).some((r) => r.state === 'open'),
      rows: withTags[i] ?? [],
      loadHeader: m.loadHeader ?? 'KG',
      repTarget: `8–12${NBSP}reps`,
      topSet: null,
      lastLine: 'No previous result',
      progress: { done: 0, total: 0 },
      hasPending: true,
    })),
    columns: null,
    menuTarget: '',
    rounds,
    progress: { done: 0, total: 0 },
    progressText: '',
    isCurrent: false,
    hasPending: true,
  } as unknown as SupersetCard;
  return { kind: 'superset', key: ss.key, folded: null, superset: ss };
}

const view = (blocks: TableBlock[]): Pick<WorkoutTableView, 'blocks'> => ({ blocks });
const works = (id: string) => (id === 'ex-Bench' ? 'Chest, front delts, triceps' : id === 'ex-Fly' ? 'Rear delts' : null);

describe('rows: numbering, set types and the RPE cell (§2)', () => {
  it('numbers working sets 1..n; warm-ups read W and are not counted; Top / Back-off / Drop labels from the set type', () => {
    const rows = roundRows([
      row({ setType: 'warmup', effort: null, state: 'done', spoken: '20 kilograms, 10 reps' }),
      row({ setType: 'warmup', effort: null }),
      row({ setType: 'top' }),
      row({ setType: 'backoff' }),
      row({ setType: 'drop', effort: null }),
      row({}),
    ]);
    expect(rows.map((r) => [r.label, r.number, r.typeLabel, r.warmup, r.stepName])).toEqual([
      ['W', null, null, true, 'Warm-up'],
      ['W', null, null, true, 'Warm-up'],
      ['1', 1, 'Top', false, 'Set 1'],
      ['2', 2, 'Back-off', false, 'Set 2'],
      ['3', 3, 'Drop', false, 'Set 3'],
      ['4', 4, null, false, 'Set 4'],
    ]);
  });

  it('the other side of a single-side log shares its partner\'s number and is not a set of its own (logic B2)', () => {
    const left = row({ badges: ['L'], state: 'done', status: 'done' });
    const right = row({ badges: ['R'], pairedWithSetId: left.setId, state: 'open' });
    const rows = [left, right, row(), row()];
    expect(roundRows(rows).map((r) => [r.label, r.stepName, r.companion])).toEqual([
      ['1L', 'Set 1', false],
      ['1R', 'Set 1', true],
      ['2', 'Set 2', false],
      ['3', 'Set 3', false],
    ]);
    const [ex] = buildRounds(view([card('Split squat', rows)]), works)[0]?.exercises ?? [];
    // The pair is one set, not done until both sides are.
    expect(ex?.progressText).toBe('0/3');
    const both = [left, { ...right, state: 'done' as const }, row(), row()];
    const [ex2] = buildRounds(view([card('Split squat', both)]), works)[0]?.exercises ?? [];
    expect(ex2?.progressText).toBe('1/3');
    // The pill names the right side as set 1.
    const p = roundPrimary({ rounds: buildRounds(view([card('Split squat', rows)]), works), shown: 0, primary: { kind: 'log', label: 'Log 20 kg × 8' } });
    expect(p).toEqual({ kind: 'step', label: 'Set 1 · Log 20 kg × 8' });
  });

  it('a warm-up\'s other side stays a warm-up', () => {
    const left = row({ badges: ['L'], setType: 'warmup', state: 'done' });
    const right = row({ badges: ['R'], setType: 'warmup', pairedWithSetId: left.setId });
    expect(roundRows([left, right, row()]).map((r) => r.label)).toEqual(['WL', 'WR', '1']);
  });

  it('RPE column: the target @9 until logged, then the logged RPE (or RIR); none for warm-ups', () => {
    expect(rpeCellText({ state: 'pending', setType: 'working', effort: `@${NBSP}9` })).toBe('@9');
    expect(rpeCellText({ state: 'open', setType: 'working', effort: `@${NBSP}8.5` })).toBe('@8.5');
    expect(rpeCellText({ state: 'done', setType: 'working', effort: `RPE${NBSP}8` })).toBe('8');
    expect(rpeCellText({ state: 'done', setType: 'working', effort: `RIR${NBSP}2` })).toBe('RIR 2');
    expect(rpeCellText({ state: 'done', setType: 'working', effort: null })).toBeNull();
    expect(rpeCellText({ state: 'pending', setType: 'warmup', effort: `@${NBSP}9` })).toBeNull();
  });

  it('VoiceOver reads the set, its values, the target RPE and whether it is done (§6)', () => {
    const [w, cur, done] = roundRows([
      row({ setType: 'warmup', effort: null, spoken: '20 kilograms, 10 reps' }),
      row({ state: 'open', spoken: '7.5 kilograms each, 12 reps', effort: `@${NBSP}9` }),
      row({ state: 'done', spoken: '7.5 kilograms each, 11 reps', effort: `RPE${NBSP}9` }),
    ]);
    expect(w?.accessibilityLabel).toBe('Warm-up, 20 kilograms, 10 reps, not done');
    expect(cur?.accessibilityLabel).toBe('Set 1, 7.5 kilograms each, 12 reps, target RPE 9, current, not done');
    expect(done?.accessibilityLabel).toBe('Set 2, 7.5 kilograms each, 11 reps, RPE 9, done');
  });
});

describe('rounds from the table view (§1.3)', () => {
  it('one round per block; a superset is 3a / 3b; works line · rep target; working-set progress', () => {
    const rounds = buildRounds(
      view([
        card('Bench', [row({ setType: 'warmup', state: 'done', effort: null }), row({ state: 'done' }), row({ state: 'open' }), row({})]),
        card('Pulldown', [row({}), row({})]),
        superset([
          { name: 'Fly', rows: [row({}), row({})], loadHeader: 'KG EACH' },
          { name: 'Crunch', rows: [row({}), row({})] },
        ]),
      ]),
      works,
    );
    expect(rounds.map((r) => [r.n, r.superset, r.exercises.map((e) => e.label)])).toEqual([
      [1, false, ['1']],
      [2, false, ['2']],
      [3, true, ['3a', '3b']],
    ]);
    const bench = rounds[0]?.exercises[0];
    expect(bench?.subline).toBe('Chest, front delts, triceps · 6–8 reps');
    expect(bench?.progressText).toBe('1/3');
    expect(bench?.anchor).toBe(2);
    expect(rounds[0]?.current).toBe(true);
    expect(rounds[0]?.doneSets).toBe(1);
    expect(rounds[0]?.totalSets).toBe(3);
    expect(rounds[1]?.exercises[0]?.subline).toBe('6–8 reps');
    expect(rounds[2]?.exercises[0]?.subline).toBe('Rear delts · 8–12 reps');
    expect(rounds[2]?.exercises[0]?.loadHeader).toBe('KG EACH');
  });

  it('in a superset the member up next is bright and the other dimmed, a → b → a', () => {
    const fly1 = row({ state: 'done' });
    const cr1 = row({ state: 'open' });
    const r = buildRounds(view([superset([{ name: 'Fly', rows: [fly1, row({})] }, { name: 'Crunch', rows: [cr1, row({})] }])]), works)[0];
    expect(r?.exercises.map((e) => [e.upNext, e.dim, e.anchor])).toEqual([
      [false, true, 1],
      [true, false, 0],
    ]);
    expect(r?.firstPendingSetId).toBe(cr1.setId);
    // After 3b the next set is 3a's: 3a's box moves to its next set and 3b dims.
    const after = buildRounds(view([superset([{ name: 'Fly', rows: [row({ state: 'done' }), row({ state: 'open' })] }, { name: 'Crunch', rows: [row({ state: 'done' }), row({})] }])]), works)[0];
    expect(after?.exercises.map((e) => [e.upNext, e.dim, e.anchor])).toEqual([
      [true, false, 1],
      [false, true, 1],
    ]);
  });

  it('a finished round: nothing dimmed, done, no set to select', () => {
    const r = buildRounds(view([superset([{ name: 'Fly', rows: [row({ state: 'done' })] }, { name: 'Crunch', rows: [row({ state: 'done' })] }])]), works)[0];
    expect(r?.done).toBe(true);
    expect(r?.exercises.every((e) => !e.dim)).toBe(true);
    expect(r?.firstPendingSetId).toBeNull();
    expect(r?.exercises[0]?.anchor).toBe(0);
  });
});

describe('which round shows, and moving between them (§3)', () => {
  const rounds = buildRounds(view([card('A', [row({ state: 'done' })]), card('B', [row({ state: 'open' }), row({})]), card('C', [row({})])]), works);

  it('the picked round, else the one with the open row, else the first with sets to do, else the last', () => {
    expect(shownRoundIndex(rounds, null)).toBe(1);
    expect(shownRoundIndex(rounds, rounds[0]?.key ?? '')).toBe(0);
    expect(shownRoundIndex(rounds, 'gone')).toBe(1);
    const noOpen = buildRounds(view([card('A', [row({ state: 'done' })]), card('C', [row({})])]), works);
    expect(shownRoundIndex(noOpen, null)).toBe(1);
    const allDone = buildRounds(view([card('A', [row({ state: 'done' })]), card('C', [row({ state: 'done' })])]), works);
    expect(shownRoundIndex(allDone, null)).toBe(1);
    expect(shownRoundIndex([], null)).toBe(0);
  });

  it('moving to a round with sets to do selects its first one (a set_active_set, never a log); a done round or the open round selects nothing', () => {
    expect(selectOnShow(rounds[2])).toBe(rounds[2]?.firstPendingSetId);
    expect(selectOnShow(rounds[1])).toBeNull();
    expect(selectOnShow(rounds[0])).toBeNull();
    expect(selectOnShow(undefined)).toBeNull();
  });

  it('swipes stay within the rounds', () => {
    expect(stepRound(1, 'next', 3)).toBe(2);
    expect(stepRound(1, 'prev', 3)).toBe(0);
    expect(stepRound(2, 'next', 3)).toBeNull();
    expect(stepRound(0, 'prev', 3)).toBeNull();
  });

  it('the strip: ✓ on done rounds, a·b on supersets, the shown one marked; VoiceOver reads the round', () => {
    const rs = buildRounds(view([card('Bench', [row({ state: 'done' })]), superset([{ name: 'Fly', rows: [row({ state: 'done' }), row({ state: 'open' })] }, { name: 'Crunch', rows: [row({ state: 'done' }), row({})] }])]), works);
    const chips = roundStrip(rs, 1);
    expect(chips.map((c) => [c.text, c.done, c.shown])).toEqual([
      ['✓ 1', true, false],
      ['2a·b', false, true],
    ]);
    expect(chips[1]?.accessibilityLabel).toBe('Round 2, superset, 2 of 4 sets done, showing');
    expect(chips[0]?.accessibilityLabel).toBe('Round 1, Bench, 1 of 1 set done');
  });

  it('Up next: the next round with sets to do; a superset names both', () => {
    const rs = buildRounds(view([card('Bench', [row({ state: 'open' })]), card('Done', [row({ state: 'done' })]), superset([{ name: 'Fly', rows: [row({})] }, { name: 'Crunch', rows: [row({})] }])]), works);
    expect(upNextText(rs, 0)).toBe('3 Fly + Crunch');
    expect(upNextText(rs, 2)).toBeNull();
  });
});

describe('the Log pill names the step (§1.6)', () => {
  it('3a · Set 3 · Log …; Set 2 · Log …; Warm-up · Log …', () => {
    expect(stepLabel({ member: '3a', stepName: 'Set 3', primary: 'Log 7.5 kg each × 12' })).toBe('3a · Set 3 · Log 7.5 kg each × 12');
    expect(stepLabel({ member: null, stepName: 'Set 2', primary: 'Log 100 kg × 6' })).toBe('Set 2 · Log 100 kg × 6');
    const rs = buildRounds(view([card('Bench', [row({ setType: 'warmup', state: 'open', effort: null }), row({})])]), works);
    expect(roundPrimary({ rounds: rs, shown: 0, primary: { kind: 'log', label: 'Log 20 kg × 10' } })).toEqual({ kind: 'step', label: 'Warm-up · Log 20 kg × 10' });
    const ss = buildRounds(view([superset([{ name: 'Fly', rows: [row({ state: 'done' }), row({ state: 'done' }), row({ state: 'open' })] }, { name: 'Crunch', rows: [row({ state: 'done' }), row({ state: 'done' }), row({})] }])]), works);
    expect(roundPrimary({ rounds: ss, shown: 0, primary: { kind: 'log', label: 'Log 7.5 kg each × 12' } })).toEqual({ kind: 'step', label: '1a · Set 3 · Log 7.5 kg each × 12' });
    expect(roundPrimary({ rounds: ss, shown: 0, primary: { kind: 'start_work', label: 'Start 0:45' } })).toEqual({ kind: 'step', label: '1a · Set 3 · Start 0:45' });
  });

  it('a done round reads Next round (to the next round with sets to do); all done falls back to the view (Finish)', () => {
    const rs = buildRounds(view([card('A', [row({ state: 'done' })]), card('B', [row({ state: 'open' })]), card('C', [row({})])]), works);
    expect(roundPrimary({ rounds: rs, shown: 0, primary: { kind: 'log', label: 'Log 100 kg × 6' } })).toEqual({ kind: 'next_round', label: 'Next round', index: 1 });
    const done = buildRounds(view([card('A', [row({ state: 'done' })])]), works);
    expect(roundPrimary({ rounds: done, shown: 0, primary: { kind: 'finish', label: 'Finish workout' } })).toEqual({ kind: 'view' });
    expect(roundPrimary({ rounds: rs, shown: 1, primary: { kind: 'resume', label: 'Resume' } })).toEqual({ kind: 'view' });
  });

  it('while a select is in flight (the open row not on the shown round) the view label shows', () => {
    const rs = buildRounds(view([card('A', [row({ state: 'open' })]), card('B', [row({})])]), works);
    expect(roundPrimary({ rounds: rs, shown: 1, primary: { kind: 'log', label: 'Log 100 kg × 6' } })).toEqual({ kind: 'view' });
  });
});

describe('row boxes: the round fits one screen (§2)', () => {
  const h = (n: number, each = 45) => Array.from({ length: n }, () => each);

  it('everything fits: no box scrolls, Up next shows', () => {
    const fit = fitRoundBoxes({ available: 800, fixed: 300, upNext: 20, boxes: [{ heights: h(4), anchor: 1 }] });
    expect(fit).toEqual({ boxes: [{ rows: 4, first: 0, offset: 0, height: null }], upNext: true, pageScroll: false });
  });

  it('the box with the most rows shrinks first, row by row, aiming for 3 each', () => {
    // 8 + 3 rows; room for 9 rows beside the fixed part and Up next.
    const fit = fitRoundBoxes({ available: 300 + 20 + 9 * 45, fixed: 300, upNext: 20, boxes: [{ heights: h(8), anchor: 6 }, { heights: h(3), anchor: 0 }] });
    expect(fit.boxes.map((b) => b.rows)).toEqual([6, 3]);
    expect(fit.upNext).toBe(true);
    expect(fit.boxes[0]?.height).toBe(6 * 45);
    expect(fit.boxes[1]?.height).toBeNull();
  });

  it('Up next gives way before a box drops below 3', () => {
    const fit = fitRoundBoxes({ available: 300 + 6 * 45 + 10, fixed: 300, upNext: 20, boxes: [{ heights: h(5), anchor: 0 }, { heights: h(5), anchor: 0 }] });
    expect(fit.boxes.map((b) => b.rows)).toEqual([3, 3]);
    expect(fit.upNext).toBe(false);
  });

  it('never below 2 rows; when even that can’t fit, boxes keep 2 rows, Up next hides and the page scrolls (spec B3)', () => {
    const two = fitRoundBoxes({ available: 300 + 4 * 45, fixed: 300, upNext: 20, boxes: [{ heights: h(5), anchor: 0 }, { heights: h(5), anchor: 0 }] });
    expect(two.boxes.map((b) => b.rows)).toEqual([2, 2]);
    expect(two.pageScroll).toBe(false);
    const none = fitRoundBoxes({ available: 300 + 3 * 45, fixed: 300, upNext: 20, boxes: [{ heights: h(5), anchor: 0 }, { heights: h(5), anchor: 0 }] });
    expect(none.pageScroll).toBe(true);
    expect(none.boxes.map((b) => [b.rows, b.height])).toEqual([
      [2, 90],
      [2, 90],
    ]);
    expect(none.upNext).toBe(false);
  });

  it('keypad open on a small phone, superset round 3a + 3b: the page scrolls, boxes keep 2 rows around the open row, the round never reflows to full lists (spec B3)', () => {
    // SE: 667 pt; the round page has ~470 pt with the keypad closed and ~210 pt once the keypad and its bar are up.
    const boxes = [
      { heights: [45, 45, 45, 45], anchor: 2 },
      { heights: [45, 45, 96, 45], anchor: 2 }, // 3b's open row is taller (cells and links)
    ];
    const closed = fitRoundBoxes({ available: 470, fixed: 230, upNext: 28, boxes });
    expect(closed.pageScroll).toBe(false);
    const open = fitRoundBoxes({ available: 210, fixed: 230, upNext: 28, boxes });
    expect(open.pageScroll).toBe(true);
    expect(open.upNext).toBe(false);
    expect(open.boxes.map((b) => b.rows)).toEqual([2, 2]);
    // 3b's open row (index 2) is in its box's 2 rows.
    const b = open.boxes[1];
    expect(b !== undefined && b.first <= 2 && 2 < b.first + b.rows).toBe(true);
    // The page then scrolls so the row being typed in clears the keypad: the page shows 210 pt from y 100 (window).
    expect(pageOffsetFor({ pageOffset: 0, pageTop: 100, pageHeight: 210, rowTop: 100 + 380, rowHeight: 96 })).toBe(380 + 96 - 210);
    // Already in view: no move.
    expect(pageOffsetFor({ pageOffset: 40, pageTop: 100, pageHeight: 210, rowTop: 150, rowHeight: 45 })).toBe(40);
    // Above the view: scroll up to it.
    expect(pageOffsetFor({ pageOffset: 200, pageTop: 100, pageHeight: 210, rowTop: 60, rowHeight: 45 })).toBe(160);
  });

  it('＋ Set: the box anchors on the new row until the next log, untick or round change, so it never lands out of sight (spec B2)', () => {
    const rs = buildRounds(view([card('Bench', [row({ state: 'open' }), row({}), row({}), row({ setId: 'added' })])]), works);
    const ex = rs[0]?.exercises[0];
    if (!ex) throw new Error('no exercise');
    expect(ex.anchor).toBe(0);
    expect(boxAnchor(ex, null)).toBe(0);
    expect(boxAnchor(ex, 'added')).toBe(3);
    expect(boxAnchor(ex, 'not-here')).toBe(0);
    // 3 sets all fitted; the 4th makes the box scroll at 3 rows. Anchored on the current set it would hide the new row…
    const onCurrent = fitRoundBoxes({ available: 300 + 3 * 45, fixed: 300, upNext: 0, boxes: [{ heights: h(4), anchor: boxAnchor(ex, null) }] }).boxes[0];
    expect(onCurrent?.first).toBe(0);
    expect(onCurrent !== undefined && 3 < onCurrent.first + onCurrent.rows).toBe(false);
    // …anchored on the new row, it shows it.
    const pinned = fitRoundBoxes({ available: 300 + 3 * 45, fixed: 300, upNext: 0, boxes: [{ heights: h(4), anchor: boxAnchor(ex, 'added') }] }).boxes[0];
    expect(pinned).toEqual({ rows: 3, first: 1, offset: 45, height: 135 });
  });

  it('a box with only 1 or 2 rows never shrinks', () => {
    const fit = fitRoundBoxes({ available: 300 + 4 * 45, fixed: 300, upNext: 0, boxes: [{ heights: h(1), anchor: 0 }, { heights: h(6), anchor: 0 }] });
    expect(fit.boxes.map((b) => b.rows)).toEqual([1, 3]);
  });

  it('uses each row’s own height (the open row is taller with notes under it)', () => {
    const heights = [45, 45, 45, 120, 45, 45];
    const fit = fitRoundBoxes({ available: 100 + 45 * 2 + 120, fixed: 100, upNext: 0, boxes: [{ heights, anchor: 3 }] });
    expect(fit.boxes[0]).toEqual({ rows: 3, first: 1, offset: 45, height: 45 + 45 + 120 });
  });

  it('positions the current set with up to 3 done above it, kept in range', () => {
    expect(boxFirstRow(8, 3, 6)).toBe(4);
    expect(boxFirstRow(8, 5, 6)).toBe(3);
    expect(boxFirstRow(8, 3, 0)).toBe(0);
    expect(boxFirstRow(8, 3, 7)).toBe(5);
    expect(boxFirstRow(4, 3, 3)).toBe(1);
    expect(boxFirstRow(3, 3, 2)).toBe(0);
    expect(boxFirstRow(10, 6, 9)).toBe(4);
  });

  it('a cell being typed in stays in its box (the smallest move), fades show more rows', () => {
    expect(keepInView(90, 135, 45, 45)).toBe(45);
    expect(keepInView(0, 135, 180, 45)).toBe(90);
    expect(keepInView(45, 135, 90, 45)).toBe(45);
    expect(boxFades({ offset: 0, viewHeight: 135, contentHeight: 270 })).toEqual({ top: false, bottom: true });
    expect(boxFades({ offset: 135, viewHeight: 135, contentHeight: 270 })).toEqual({ top: true, bottom: false });
    expect(boxFades({ offset: 0, viewHeight: 270, contentHeight: 270 })).toEqual({ top: false, bottom: false });
  });

  it('re-positions on a log, an untick or a round change; not on anything else', () => {
    const a = buildRounds(view([card('A', [row({ state: 'done' }), row({ state: 'open', setId: 'x' })])]), works)[0];
    const b = buildRounds(view([card('A', [row({ state: 'done' }), row({ state: 'done' })])]), works)[0];
    expect(positionKey(a, 'x')).not.toBe(positionKey(b, null));
    expect(positionKey(a, 'x')).toBe(positionKey(a, 'x'));
    expect(positionKey(undefined, null)).toBe('');
  });
});

describe('timer bar (§1.5)', () => {
  it('REST while a rest runs or is paused, else the SET clock', () => {
    expect(timerBarMode({ kind: 'running' })).toBe('rest');
    expect(timerBarMode({ kind: 'paused' })).toBe('rest');
    expect(timerBarMode({ kind: 'ended' })).toBe('set');
    expect(timerBarMode(null)).toBe('set');
  });

  it('SET counts up from the rest’s end, or the last log when that came later, else the start', () => {
    const ended = { kind: 'ended' as const, timerId: 't', endedAtUtc: '2026-10-20T10:02:00.000Z', restedMs: 90_000, skipped: false };
    const start = Date.parse('2026-10-20T10:00:00.000Z');
    expect(setClockStartMs({ rest: ended, lastLogMs: Date.parse('2026-10-20T10:00:30.000Z'), startedAtMs: start })).toBe(Date.parse('2026-10-20T10:02:00.000Z'));
    // 3a → 3b has no rest: the clock runs from the 3a log.
    expect(setClockStartMs({ rest: ended, lastLogMs: Date.parse('2026-10-20T10:03:00.000Z'), startedAtMs: start })).toBe(Date.parse('2026-10-20T10:03:00.000Z'));
    expect(setClockStartMs({ rest: null, lastLogMs: null, startedAtMs: start })).toBe(start);
    expect(setClockStartMs({ rest: { ...ended, endedAtUtc: null }, lastLogMs: null, startedAtMs: start })).toBe(start);
  });

  it('the last log time, and the clock text', () => {
    expect(lastLogMs([{ status: 'completed', completedAt: { utc: '2026-10-20T10:00:00.000Z' } }, { status: 'pending', completedAt: null }, { status: 'completed', completedAt: { utc: '2026-10-20T10:05:00.000Z' } }])).toBe(Date.parse('2026-10-20T10:05:00.000Z'));
    expect(lastLogMs([])).toBeNull();
    expect(clockText(25_000)).toBe('0:25');
    expect(clockText(724_000)).toBe('12:04');
    expect(clockText(3_729_000)).toBe('1:02:09');
    expect(clockText(-5)).toBe('0:00');
  });
});

describe('header and overview (§4, §5)', () => {
  it('+12 min only while over; never negative', () => {
    expect(overTimeText(12)).toBe(`+12${NBSP}min`);
    expect(overTimeText(null)).toBeNull();
    expect(overTimeText(0)).toBeNull();
  });

  it('overview rows: label, name, works, sets done/total, top set in kg (lb says so), done and current', () => {
    const rs = buildRounds(view([card('Bench', [row({ state: 'done' }), row({ state: 'done' })]), superset([{ name: 'Fly', rows: [row({ state: 'open' })] }, { name: 'Crunch', rows: [row({})] }]), card('Curl', [row({})], { topSet: { value: 45, unit: 'lb' } })]), works);
    const rows = overviewRows(rs, 1, works);
    expect(rows.map((r) => [r.label, r.name, r.works, r.sets, r.top, r.done, r.current, r.roundIndex])).toEqual([
      ['1', 'Bench', 'Chest, front delts, triceps', '2/2', '100', true, false, 0],
      ['2a', 'Fly', 'Rear delts', '0/1', '—', false, true, 1],
      ['2b', 'Crunch', null, '0/1', '—', false, true, 1],
      ['3', 'Curl', null, '0/1', `45${NBSP}lb`, false, false, 2],
    ]);
    expect(rows[0]?.accessibilityLabel).toBe('1, Bench, 2 of 2 sets done, top set 100 kilograms, done');
  });

  it('title with about N min (time so far plus the estimate, to 5 min)', () => {
    expect(overviewTitle('Upper body', 20 * 60_000, 33)).toBe(`Upper body · about 55${NBSP}min`);
    expect(overviewTitle('Upper body', 0, null)).toBe('Upper body');
  });
});

describe('Why? sheet (§2)', () => {
  it('full target, rest, last time; in a superset the rest is after the round (the last member’s)', () => {
    const rs = buildRounds(view([card('Bench', [row({ state: 'done' }), row({ state: 'open', cells: { load: '7.5', value: `8–12` }, effort: `@${NBSP}9`, restAfterS: 90 })], { loadHeader: 'KG EACH' })]), works);
    const r0 = rs[0];
    if (r0 === undefined) throw new Error('round');
    expect(whyView(r0, 0)).toMatchObject({ target: '7.5 kg each × 8–12 @ 9', rest: 'Rest 1:30', restSeconds: 90, last: '16 Oct · 7.5 × 12, 12, 12' });
    const ss = buildRounds(view([superset([{ name: 'Fly', rows: [row({ state: 'open', restAfterS: 0 })] }, { name: 'Crunch', rows: [row({ restAfterS: 90 })] }])]), works)[0];
    if (ss === undefined) throw new Error('superset');
    const why = whyView(ss, 0);
    expect(why?.rest).toBe('1:30 after the round');
    expect(why?.restSetId).toBe(ss.exercises[1]?.rows[0]?.setId);
    expect(why?.last).toBeNull();
  });

  it('last line without history reads nothing', () => {
    expect(lastTimeText('No previous result')).toBeNull();
    expect(lastTimeText(`Last 1 Oct: 100${NBSP}×${NBSP}8, 8`)).toBe('1 Oct · 100 × 8, 8');
  });
});
