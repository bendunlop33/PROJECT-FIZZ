import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TodayScreen } from '../../src/screens/TodayScreen';
import { contextMenuItems, roundContextMenu } from '../../src/workout/exercise-menu';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen, type Rendered } from './render-screen';
import { benWithHistory, harness, todayData, withPlan } from './seed';

/**
 * (Ben, 1 Nov) `Make main lift` on the day sheet's Edit (Every week), rendered over real SQLite: an exercise's
 * `Make main lift` writes the plan day's template with `… · main lift every week` and Undo; This week only doesn't
 * offer it. The in-workout menu lists it right after Swap.
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  await h.cleanup();
});

async function tapLabel(r: Rendered, label: RegExp, last = false): Promise<void> {
  const found = r.all((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && label.test(n.props.accessibilityLabel));
  const target = last ? found.at(-1) : found[0];
  if (target === undefined) throw new Error(`nothing labelled ${String(label)}`);
  const onPress = target.props.onPress as (e: unknown) => unknown;
  await act(async () => {
    await onPress({ nativeEvent: {} });
  });
}

describe('the day sheet’s Edit: Make main lift', () => {
  it('Every week only; writes the template with Undo; no React warning', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben, { sessions: 4, schedule: 'set', days: [0, 2, 4, 5] });
    const wed = (await todayData(ben.s)).week.planned.find((d) => d.localDate === '2026-10-21')?.name ?? 'no day';
    const r = await renderScreen(h, ben.launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Up next'));
    await tapLabel(r, /^Wednesday 21: /);
    await r.waitFor((t) => t.includes(`Wed · ${wed}`), 'the day sheet');
    await tapLabel(r, /^Edit$/, true);
    await r.waitFor((t) => t.includes('Every week') && t.includes('＋ Add exercise'), 'the day editor');

    // A compound that isn't the day's main lift.
    await tapLabel(r, /^Lat pulldown/, true);
    await r.waitFor((t) => t.includes('Swap'), 'the row’s actions');
    // From Today the scope starts at This week only: no Make main lift there.
    expect(r.text()).not.toContain('Make main lift');
    await r.press('Every week');
    await r.waitFor((t) => t.includes('Make main lift'), 'Make main lift under Every week');
    await r.press('Make main lift');
    await r.waitFor((t) => t.includes('main lift every week') && t.includes('Undo'), 'the toast');
    await r.press('Undo');
    await r.waitFor((t) => !t.includes('main lift every week'), 'undone');
    expectHealthy(r);
    await r.unmount();
  });
});

describe('the in-workout menu', () => {
  it('Make main lift right after Swap (movecur’s order: Undo… · moves · Swap · Make main lift · Add set …), only when offered', () => {
    const base = { canSwap: true, moves: { up: true, down: false, first: false, toEnd: true }, plates: false, swapped: { from: 'Bench press', to: 'Incline press' } };
    const m = roundContextMenu({ ...base, makeMain: true });
    expect(m.rows.map((x) => x.label).slice(0, 3)).toEqual(['Swap exercise', 'Make main lift', 'Add set']);
    expect(contextMenuItems(m).map((x) => x.action)).toEqual(['undo_swap', 'move_to_end', 'move_up', 'swap', 'make_main', 'add_set', 'history', 'notes', 'skip_exercise']);
    expect(contextMenuItems(roundContextMenu(base)).some((x) => x.action === 'make_main')).toBe(false);
  });
});
