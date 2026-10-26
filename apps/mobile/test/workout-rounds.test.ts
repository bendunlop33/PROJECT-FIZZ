import { describe, expect, it } from 'vitest';
import type { SupersetCard, TableBlock, TableCard, TableRow, WorkoutTableView } from '@fizz/domain';

import {
  bottomChrome,
  buildRounds,
  clockText,
  keepInView,
  lastLogMs,
  lastTimeText,
  overTimeText,
  overviewRows,
  offRoundPill,
  overviewTitle,
  positionKey,
  queueSelect,
  resetsPick,
  SELECT_IDLE,
  selectLanded,
  roundPrimary,
  roundRows,
  roundStrip,
  revealOffset,
  revealSetId,
  rirCellText,
  selectOnShow,
  setClockMs,
  setClockStartMs,
  shownRoundIndex,
  stepLabel,
  stepRound,
  timerBarMode,
  timerRoundIndex,
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
    last: null,
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
    rir: { text: '2', value: 2, target: true, spoken: 'target 2 reps in reserve' },
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

describe('rows: numbering, set types and the RIR cell (§2)', () => {
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

  it('(Ben, 26 Oct) RIR cell: the target dimmed until logged, then what was logged; Ben\'s own before logging in full ink; none for warm-ups', () => {
    const rir = (text: string, target: boolean) => ({ text, value: Number(text), target, spoken: '' });
    expect(rirCellText({ state: 'pending', setType: 'working', rir: rir('1', true) })).toEqual({ text: '1', target: true });
    expect(rirCellText({ state: 'open', setType: 'working', rir: rir('1.5', true) })).toEqual({ text: '1.5', target: true });
    expect(rirCellText({ state: 'open', setType: 'working', rir: rir('3', false) })).toEqual({ text: '3', target: false });
    expect(rirCellText({ state: 'done', setType: 'working', rir: rir('2', false) })).toEqual({ text: '2', target: false });
    expect(rirCellText({ state: 'done', setType: 'working', rir: null })).toBeNull();
    expect(rirCellText({ state: 'pending', setType: 'warmup', rir: rir('1', true) })).toBeNull();
    expect(rirCellText({ state: 'skipped', setType: 'working', rir: rir('1', true) })).toBeNull();
  });

  it('VoiceOver reads the set, its values, its reps in reserve (target or logged) and whether it is done (§6)', () => {
    const [w, cur, done] = roundRows([
      row({ setType: 'warmup', effort: null, rir: null, spoken: '20 kilograms, 10 reps' }),
      row({ state: 'open', spoken: '7.5 kilograms each, 12 reps', rir: { text: '1', value: 1, target: true, spoken: 'target 1 rep in reserve' } }),
      row({ state: 'done', spoken: '7.5 kilograms each, 11 reps', rir: { text: '1', value: 1, target: false, spoken: '1 rep in reserve' } }),
    ]);
    expect(w?.accessibilityLabel).toBe('Warm-up, 20 kilograms, 10 reps, not done');
    expect(cur?.accessibilityLabel).toBe('Set 1, 7.5 kilograms each, 12 reps, target 1 rep in reserve, current, not done');
    expect(done?.accessibilityLabel).toBe('Set 2, 7.5 kilograms each, 11 reps, 1 rep in reserve, done');
  });
});

describe('rounds from the table view (§1.3)', () => {
  it('one round per block; a superset is 3a / 3b; the works line only (Ben, 26 Oct); working-set progress', () => {
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
    // (Ben, 26 Oct) The header shows the muscles only: the rep range is in the REPS cells, the target in RIR.
    expect(bench?.subline).toBe('Chest, front delts, triceps');
    expect(bench?.progressText).toBe('1/3');
    expect(bench?.anchor).toBe(2);
    expect(rounds[0]?.current).toBe(true);
    expect(rounds[0]?.doneSets).toBe(1);
    expect(rounds[0]?.totalSets).toBe(3);
    expect(rounds[1]?.exercises[0]?.subline).toBeNull();
    expect(rounds[2]?.exercises[0]?.subline).toBe('Rear delts');
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

describe('(Ben, 26 Oct) one scroll per round page: the current set comes into view only when it is off-screen', () => {
  it('a row already in view: no move (no jump when logging a set that stays on screen)', () => {
    expect(revealOffset({ offset: 100, viewHeight: 400, rowTop: 200, rowHeight: 44, context: 44, margin: 8 })).toBe(100);
    expect(revealOffset({ offset: 0, viewHeight: 400, rowTop: 356, rowHeight: 44 })).toBe(0);
  });

  it('below the fold: just enough to show it (and a margin), never past its own top', () => {
    expect(revealOffset({ offset: 0, viewHeight: 400, rowTop: 500, rowHeight: 44, context: 44, margin: 8 })).toBe(500 + 44 + 8 - 400);
    // A row taller than the view (the open row with notes): its top stays in view.
    expect(revealOffset({ offset: 0, viewHeight: 200, rowTop: 500, rowHeight: 300, context: 44, margin: 8 })).toBe(456);
  });

  it('above the view: back up to it with the set just done above it in view', () => {
    expect(revealOffset({ offset: 600, viewHeight: 400, rowTop: 300, rowHeight: 44, context: 44 })).toBe(256);
    expect(revealOffset({ offset: 600, viewHeight: 400, rowTop: 20, rowHeight: 44, context: 44 })).toBe(0);
  });

  it('before the page is measured it never moves', () => {
    expect(revealOffset({ offset: 30, viewHeight: 0, rowTop: 900, rowHeight: 44 })).toBe(30);
  });

  it('reveals the open row, else the round\'s first set to do', () => {
    const open = buildRounds(view([card('A', [row({ state: 'done' }), row({ state: 'open', setId: 'cur' })])]), works)[0];
    expect(revealSetId(open)).toBe('cur');
    const todo = buildRounds(view([card('A', [row({ state: 'done' }), row({ setId: 'next' })])]), works)[0];
    expect(revealSetId(todo)).toBe('next');
    expect(revealSetId(buildRounds(view([card('A', [row({ state: 'done' })])]), works)[0])).toBeNull();
    expect(revealSetId(undefined)).toBeNull();
  });

  it('a cell being typed in stays in view (the smallest move)', () => {
    expect(keepInView(90, 135, 45, 45)).toBe(45);
    expect(keepInView(0, 135, 180, 45)).toBe(90);
    expect(keepInView(45, 135, 90, 45)).toBe(45);
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

  it('with the number pad up (Ben, 23 Oct): no SET clock and no Log / coach / mic bar; a running rest stays slim; the pad closing brings them back', () => {
    expect(bottomChrome({ tableMode: true, keypadUp: false, rest: null })).toEqual({ timer: 'set', actionBar: true });
    expect(bottomChrome({ tableMode: true, keypadUp: false, rest: { kind: 'running' } })).toEqual({ timer: 'rest', actionBar: true });
    expect(bottomChrome({ tableMode: true, keypadUp: true, rest: null })).toEqual({ timer: null, actionBar: false });
    expect(bottomChrome({ tableMode: true, keypadUp: true, rest: { kind: 'ended' } })).toEqual({ timer: null, actionBar: false });
    expect(bottomChrome({ tableMode: true, keypadUp: true, rest: { kind: 'running' } })).toEqual({ timer: 'rest_slim', actionBar: false });
    expect(bottomChrome({ tableMode: true, keypadUp: true, rest: { kind: 'paused' } })).toEqual({ timer: 'rest_slim', actionBar: false });
    // Focus view keeps its own layout.
    expect(bottomChrome({ tableMode: false, keypadUp: true, rest: null })).toEqual({ timer: null, actionBar: true });
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
    const rs = buildRounds(view([card('Bench', [row({ state: 'done' }), row({ state: 'open', cells: { load: '7.5', value: `8–12` }, rir: { text: '1', value: 1, target: true, spoken: '' }, restAfterS: 90 })], { loadHeader: 'KG EACH' })]), works);
    const r0 = rs[0];
    if (r0 === undefined) throw new Error('round');
    expect(whyView(r0, 0)).toMatchObject({ target: '7.5 kg each × 8–12 · RIR 1', rest: 'Rest 1:30', restSeconds: 90, last: '16 Oct · 7.5 × 12, 12, 12' });
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

describe('round changes: one select at a time, no bounce, never a Log that only selects (spec S2, logic S1–S3)', () => {
  it('fast swipes 2 → 3 → 4: the select for 4 waits for 3, then goes with its version; the page stays on 4', () => {
    let q = SELECT_IDLE;
    let out = queueSelect(q, 'r3');
    expect(out.send).toBe('r3');
    q = out.q;
    out = queueSelect(q, 'r4');
    expect(out.send).toBeNull();
    q = out.q;
    expect(q).toEqual({ inFlight: 'r3', queued: 'r4' });
    // The select for 3 lands late: it doesn't reset Ben's pick (it was a round change's own select)…
    const sent = new Set(['r3']);
    expect(resetsPick('r3', sent)).toBe(false);
    // …and 4's goes next.
    const landed = selectLanded(q, true);
    expect(landed.send).toBe('r4');
    expect(selectLanded(landed.q, true)).toEqual({ q: SELECT_IDLE, send: null });
  });
  it('a pick with nothing to select (a done round) cancels the wait; a refused select drops it', () => {
    let out = queueSelect(SELECT_IDLE, 'r3');
    out = queueSelect(out.q, 'r4');
    out = queueSelect(out.q, null);
    expect(out.q).toEqual({ inFlight: 'r3', queued: null });
    expect(selectLanded(out.q, true).send).toBeNull();
    const again = queueSelect(queueSelect(SELECT_IDLE, 'r3').q, 'r4');
    expect(selectLanded(again.q, false)).toEqual({ q: SELECT_IDLE, send: null });
    expect(queueSelect(SELECT_IDLE, null)).toEqual({ q: SELECT_IDLE, send: null });
  });
  it('a log, untick, delete or relaunch brings the page back to the open row', () => {
    expect(resetsPick('logged-next', new Set(['r3']))).toBe(true);
    expect(resetsPick(null, new Set())).toBe(true);
  });
  it('the pill on a round not current yet never says Log: Go to Set 1 / Go to 3a · Set 1 / Back to round 2 while a work timer runs', () => {
    const rs = buildRounds(
      view([
        card('Plank', [row({ state: 'open', setId: 'plank-1' })]),
        card('Bench', [row({ setType: 'warmup', state: 'pending', setId: 'w' }), row({ setId: 'b1' })]),
        superset([
          { name: 'Fly', rows: [row({ setId: 'f1' })] },
          { name: 'Crunch', rows: [row({ setId: 'c1' })] },
        ]),
      ]),
      works,
    );
    const r = (i: number) => {
      const x = rs[i];
      if (x === undefined) throw new Error('no round');
      return x;
    };
    expect(offRoundPill(r(1), { timerRound: null })).toEqual({ kind: 'select', label: 'Go to Warm-up' });
    expect(offRoundPill(r(2), { timerRound: null })).toEqual({ kind: 'select', label: 'Go to 3a · Set 1' });
    expect(timerRoundIndex(rs, { setId: 'plank-1', status: 'running' })).toBe(0);
    expect(timerRoundIndex(rs, { setId: 'plank-1', status: 'stopped' })).toBeNull();
    expect(timerRoundIndex(rs, null)).toBeNull();
    expect(offRoundPill(r(1), { timerRound: 0 })).toEqual({ kind: 'back', label: 'Back to round 1', index: 0 });
  });
});

describe('SET clock and pauses (spec S7)', () => {
  it('a 10 min pause neither counts nor makes the clock jump on Resume; it freezes while paused', () => {
    const start = 1_000_000;
    // 2 min after the rest ended, then paused 10 min, resumed 1 min ago.
    expect(setClockMs({ startMs: start, nowMs: start + 13 * 60_000, pausedMs: 10 * 60_000 })).toBe(3 * 60_000);
    // While paused, pausedMsWithin grows with now: the clock stands still.
    expect(setClockMs({ startMs: start, nowMs: start + 5 * 60_000, pausedMs: 3 * 60_000 })).toBe(2 * 60_000);
    expect(setClockMs({ startMs: start, nowMs: start + 6 * 60_000, pausedMs: 4 * 60_000 })).toBe(2 * 60_000);
    expect(setClockMs({ startMs: start, nowMs: start - 5, pausedMs: 0 })).toBe(0);
  });
});

describe('only the latest log offers Untick (spec S6)', () => {
  it('canUntick is the latest logged set only; other done rows are corrected instead', () => {
    const a = row({ state: 'done', setId: 'a' });
    const b = row({ state: 'done', setId: 'b' });
    const c = row({ state: 'open', setId: 'c' });
    const rs = roundRows([a, b, c], 'b');
    expect(rs.map((r) => r.canUntick)).toEqual([false, true, false]);
    expect(roundRows([a, b, c]).some((r) => r.canUntick)).toBe(false);
    const [ex] = buildRounds(view([card('Bench', [a, b, c])]), works, 'a')[0]?.exercises ?? [];
    expect(ex?.rows.map((r) => r.canUntick)).toEqual([true, false, false]);
  });
});
