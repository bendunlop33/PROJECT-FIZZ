import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seesLabel } from '../src/coach/sheet-view';
import { mixHex, weekBarsLayout } from '../src/progress/chart-layout';
import { createHarness, logWorkout, type Harness } from './harness';

/**
 * Progress custom period through the services (Ben, 12 Oct 2026: "flexibility
 * to select time period"): shared by the home and Muscles, cleared by a
 * preset, made valid (never past today), for this run only; and part-week
 * bars drawn lighter.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-09-01T17:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;

async function setUp() {
  const { services: s } = await h.launch();
  await s.setup.saveUnits('kg');
  const gym = await s.setup.useTypicalGym();
  await s.setup.complete();
  const gymId = gym.ok ? (gym.gymId ?? '') : '';
  // 1 Sep, 15 Sep, 1 Oct and 12 Oct 2026, 18:00 London.
  for (const d of ['2026-09-01', '2026-09-15', '2026-10-01', '2026-10-12']) {
    h.clockMs = Date.parse(`${d}T17:00:00.000Z`);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
  }
  h.clockMs = Date.parse('2026-10-12T19:00:00.000Z');
  return s;
}

describe('custom period', () => {
  it('Show applies the dates to the home (and so Muscles); a preset clears it; the bounds come with the home', async () => {
    const s = await setUp();
    const before = await s.progress.home();
    expect(before).toMatchObject({ days: 30, range: null, today: '2026-10-12', earliest: '2026-09-01' });

    s.progress.choosePeriod({ from: '2026-09-01', to: '2026-09-30' });
    const custom = await s.progress.home();
    if (custom?.view.dataState !== 'normal') throw new Error('expected normal');
    expect(custom.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(custom.view.window).toMatchObject({ preset: null, days: 30, from: '2026-09-01', to: '2026-09-30' });
    expect(custom.view.activity.stats[0]?.value).toBe('2');
    expect(custom.view.datesLine).toBe('1 Sep – 30 Sep');

    // A preset ends the custom period.
    expect(await s.progress.saveSettings({ days: 7 })).toEqual({ ok: true });
    const preset = await s.progress.home();
    expect(preset).toMatchObject({ days: 7, range: null });
  });

  it('dates past today are pulled back to today; reversed dates are put right', async () => {
    const s = await setUp();
    s.progress.choosePeriod({ from: '2026-10-01', to: '2026-12-31' });
    expect((await s.progress.home())?.range).toEqual({ from: '2026-10-01', to: '2026-10-12' });
    s.progress.choosePeriod({ from: '2026-10-10', to: '2026-10-02' });
    expect((await s.progress.home())?.range).toEqual({ from: '2026-10-02', to: '2026-10-02' });
  });

  it('is for this run only: a relaunch shows the saved preset', async () => {
    const s = await setUp();
    s.progress.choosePeriod({ from: '2026-09-01', to: '2026-09-30' });
    expect((await s.progress.home())?.range).not.toBeNull();
    await h.forceClose();
    h.clockMs += DAY;
    const { services: s2 } = await h.launch();
    expect((await s2.progress.home())?.range).toBeNull();
  });
});

describe('part-week bars', () => {
  it('carry their partial flag into the layout; the lighter colour is the bar mixed into the card', () => {
    const rects = weekBarsLayout([0, 3, 1], 300, 3, { height: 64, maxBarWidth: 28, gap: 8, radius: 4 }, [true, false, true]);
    expect(rects.map((r) => r.partial)).toEqual([true, false, true]);
    expect(weekBarsLayout([1], 100, 3, { height: 64, maxBarWidth: 28, gap: 8, radius: 4 })[0]?.partial).toBe(false);
    expect(mixHex('#B5ADA5', '#181615', 0.45)).toBe('#5f5a56');
    expect(mixHex('#ffffff', '#000000', 1)).toBe('#ffffff');
    expect(mixHex('text.secondary', '#000000', 0.5)).toBe('text.secondary');
  });
});

describe('the coach on a custom period', () => {
  it('the sheet and `What the coach can see` name the dates, never "last N days"', async () => {
    expect(seesLabel({ kind: 'progress', days: 30, range: { from: '2026-09-01', to: '2026-09-30' } }, null, false)).toBe('Sees: Progress · 1 Sep – 30 Sep');
    expect(seesLabel({ kind: 'progress', days: 30 }, null, false)).toBe('Sees: Progress · last 30 days');
    const s = await setUp();
    const d = await s.coach.describe({ kind: 'progress', days: 30, range: { from: '2026-09-01', to: '2026-09-30' } }, null);
    expect(d.yourData).toContainEqual({ label: 'Opened from', detail: 'Progress · 1 Sep – 30 Sep' });
  });
});
