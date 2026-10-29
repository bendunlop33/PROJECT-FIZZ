import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TodayScreen } from '../../src/screens/TodayScreen';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen, type Rendered } from './render-screen';
import { benWithHistory, harness, todayData, withPlan } from './seed';

/**
 * (Ben, 29 Oct: day sheet; docs/design/day-sheet.md) Today's day sheet and card picker rendered over real SQLite
 * (ADR 0037): a tap on a coming tile opens that day's sheet (its plan day, status, exercises and this week's
 * actions); Edit shows the scope and Add exercise; Skip this week writes with Undo; the card's `⌄` lists the week's
 * days with weekday and status. No React warning on the way.
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  await h.cleanup();
});

/** Tap the element whose VoiceOver label matches (a tile, the card's title). */
async function tapLabel(r: Rendered, label: RegExp, last = false): Promise<void> {
  const found = r.all((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && label.test(n.props.accessibilityLabel));
  const target = last ? found.at(-1) : found[0];
  if (target === undefined) throw new Error(`nothing labelled ${String(label)}`);
  const onPress = target.props.onPress as (e: unknown) => unknown;
  await act(async () => {
    await onPress({ nativeEvent: {} });
  });
}

describe('the day sheet', () => {
  it('a coming Set days tile: its plan day, Planned, its exercises, Do today instead / Move to… / Skip / Edit; Edit shows the scope', async () => {
    const ben = await benWithHistory(h);
    // Set days Mon, Wed, Fri, Sat on a Monday.
    await withPlan(h, ben, { sessions: 4, schedule: 'set', days: [0, 2, 4, 5] });
    const wed = (await todayData(ben.s)).week.planned.find((d) => d.localDate === '2026-10-21')?.name ?? 'no day';
    const r = await renderScreen(h, ben.launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Up next'));
    await tapLabel(r, /^Wednesday 21: /);
    await r.waitFor((t) => t.includes(`Wed · ${wed}`), 'the day sheet');
    const text = r.text();
    for (const w of ['Planned', 'Do today instead', 'Move to…', 'Skip this week', 'Edit', 'Exercise', 'Sets']) expect(text).toContain(w);
    // The sheet's Edit (the card has its own, above it).
    await tapLabel(r, /^Edit$/, true);
    await r.waitFor((t) => t.includes('This week only') && t.includes('Every week') && t.includes('＋ Add exercise'), 'the day editor');
    expectHealthy(r);
    await r.unmount();
  });

  it('Skip this week: the day is skipped with Undo; the sheet reads Skipped', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben, { sessions: 4, schedule: 'set', days: [0, 2, 4, 5] });
    const r = await renderScreen(h, ben.launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Up next'));
    await tapLabel(r, /^Friday 23: /);
    await r.waitFor((t) => t.includes('Skip this week'), 'the day sheet');
    await r.press('Skip this week');
    await r.waitFor((t) => t.includes('skipped') && t.includes('Undo'), 'the skip toast');
    await r.waitFor((t) => t.includes('Skipped') && t.includes('Unskip'), 'the sheet after the skip');
    expect((await todayData(ben.s)).skipped).toHaveLength(1);
    expectHealthy(r);
    await r.unmount();
  });

  it('a rest day opens too: Rest, nothing to change', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben, { sessions: 4, schedule: 'set', days: [0, 2, 4, 5] });
    const r = await renderScreen(h, ben.launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Up next'));
    await tapLabel(r, /^Tuesday 20$/);
    await r.waitFor((t) => t.includes('Tue 20 Oct') && t.includes('Rest'), 'the rest day sheet');
    expect(r.text()).not.toContain('Skip this week');
    expectHealthy(r);
    await r.unmount();
  });
});

describe('the card picker', () => {
  it('`⌄` lists the week’s plan days with weekday and status: Up next today, the rest Planned on their weekdays', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben, { sessions: 4, schedule: 'set', days: [0, 2, 4, 5] });
    const r = await renderScreen(h, ben.launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Up next'));
    await tapLabel(r, /\. Change today’s workout$/);
    await r.waitFor((t) => t.includes('Today’s workout'), 'the picker');
    const labels = r.all((n) => n.props.accessibilityRole === 'button' && typeof n.props.accessibilityLabel === 'string' && /^(Monday|Wednesday|Friday|Saturday), /.test(n.props.accessibilityLabel)).map((n) => n.props.accessibilityLabel as string);
    const rows = [...new Set(labels)];
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/^Monday, .+, Up next, selected$/);
    for (const x of rows.slice(1)) expect(x).toMatch(/, Planned$/);
    for (const w of ['Mon', 'Wed', 'Fri', 'Sat']) expect(r.text()).toContain(w);
    expectHealthy(r);
    await r.unmount();
  });
});
