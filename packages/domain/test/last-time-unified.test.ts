import { describe, expect, it } from 'vitest';

import type { SessionAggregate } from '@fizz/schemas';
import { buildActiveSetView, buildLockScreenContent, buildWorkoutTableView, lastTimeMatch, lastTimeOfSet, NBSP, type ComparableSet, type PreviousSession } from '../src/index';
import { kg, ms, TZ, values } from './fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * (Ben, 26 Oct) One last-time rule (`lastTimeMatch`) for the table rows, the open row's `Last` / `Copy last`, the
 * Lock Screen line and the rest-done notification: working-set n ↔ last time's working-set n, warm-ups excluded,
 * same item / unit / convention, never a guess.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const prevOf = (sets: ComparableSet[]): PreviousSession => ({ sessionId: 'prev', performedAtUtc: '2026-10-01T06:00:00.000Z', gymId: null, imported: false, sets });
const hist = (...sets: [number, number][]): ComparableSet[] => sets.map(([l, r], index) => ({ index, values: values(kg(l), r) }));

function surfaces(state: SessionAggregate, setId: string, sets: ComparableSet[]) {
  const row = state.sets.find((s) => s.id === setId)?.sessionExerciseId ?? '';
  const previous = { [row]: prevOf(sets) };
  const input = { aggregate: state, nowMs: ms(31), gymName: null, previous, painFlagged: new Set<string>(), edits: null };
  const table = buildWorkoutTableView(input);
  const rows = table.blocks.flatMap((b) => (b.kind === 'exercise' ? b.card.rows : b.superset.members.flatMap((m) => m.rows)));
  const focus = buildActiveSetView(input).focus;
  const lock = buildLockScreenContent(state, ms(31), TZ, { lastComparable: (id) => (id === row ? sets : undefined) });
  return {
    tableRow: plain(rows.find((r) => r.setId === setId)?.last?.text ?? null),
    focus: focus?.setId === setId ? plain(focus.previous?.text ?? null) : 'not focused',
    lockLine: plain(lock?.line3 ?? ''),
    rule: plain(lastTimeOfSet(state, setId, sets)?.text ?? null),
  };
}

describe('one last-time rule across surfaces', () => {
  const { state } = startFixture();
  const [warm, w1, w2] = setsFor(state, BENCH);
  if (!warm || !w1 || !w2) throw new Error('fixture');
  const resting = apply(state, logCmd(warm.id, values(kg(60), 10), 30));

  it('the first working set (after a warm-up) reads last time’s first working set everywhere', () => {
    const s = surfaces(resting, w1.id, hist([100, 8], [100, 7]));
    expect(s).toEqual({ tableRow: '100 × 8', focus: '100 kg × 8', lockLine: 'Last 100 kg × 8', rule: '100 kg × 8' });
  });

  it('the second working set with only one last time: nothing anywhere (the open row no longer falls back to the last set)', () => {
    const afterW1 = apply(resting, logCmd(w1.id, values(kg(100), 8), 200));
    const s = surfaces(afterW1, w2.id, hist([100, 8]));
    expect(s).toEqual({ tableRow: '', focus: '', lockLine: '', rule: '' });
  });

  it('a warm-up has no last time', () => {
    expect(lastTimeMatch(state, warm.id, hist([100, 8]))).toBeNull();
  });

  it('last time logged one side at a time: a left and a right count as one set, so set 2 is not last time’s right side', () => {
    const sided: ComparableSet[] = [
      { index: 0, values: values(kg(20), 10), side: 'left' },
      { index: 1, values: values(kg(20), 9), side: 'right' },
      { index: 2, values: values(kg(22.5), 8), side: 'left' },
      { index: 3, values: values(kg(22.5), 8), side: 'right' },
    ];
    expect(plain(lastTimeOfSet(state, w1.id, sided)?.text)).toBe('20 kg × 10');
    expect(plain(lastTimeOfSet(state, w2.id, sided)?.text)).toBe('22.5 kg × 8');
  });
});
