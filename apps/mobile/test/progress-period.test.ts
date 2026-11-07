import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seesLabel } from '../src/coach/sheet-view';
import { createHarness, logWorkout, type Harness } from './harness';

/**
 * Progress custom period through the services (Ben, 12 Oct 2026: "flexibility
 * to select time period"): shared by the home and Muscles, cleared by a
 * preset, made valid (never past today), for this run only.
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
    expect(before).toMatchObject({ period: '1m', range: null, today: '2026-10-12', earliest: '2026-09-01' });

    s.progress.choosePeriod({ from: '2026-09-01', to: '2026-09-30' });
    const custom = await s.progress.home();
    if (custom?.view.dataState !== 'normal') throw new Error('expected normal');
    expect(custom.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(custom.view.window).toMatchObject({ preset: null, days: 30, from: '2026-09-01', to: '2026-09-30' });
    expect(custom.view.activity.stats[0]?.value).toBe('2');
    expect(custom.view.datesLine).toBe('1 Sep – 30 Sep');

    // A preset ends the custom period.
    expect(await s.progress.saveSettings({ period: '3m' })).toEqual({ ok: true });
    const preset = await s.progress.home();
    expect(preset).toMatchObject({ period: '3m', range: null });
  });

  it('dates past today are pulled back to today; reversed dates are put right', async () => {
    const s = await setUp();
    s.progress.choosePeriod({ from: '2026-10-01', to: '2026-12-31' });
    expect((await s.progress.home())?.range).toEqual({ from: '2026-10-01', to: '2026-10-12' });
    s.progress.choosePeriod({ from: '2026-10-10', to: '2026-10-02' });
    expect((await s.progress.home())?.range).toEqual({ from: '2026-10-02', to: '2026-10-10' });
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

describe('the coach on a custom period', () => {
  it('the sheet and `What the coach can see` name the dates, never "last N days"', async () => {
    expect(seesLabel({ kind: 'progress', period: '1m', range: { from: '2026-09-01', to: '2026-09-30' } }, null, false, null, '2026-10-12')).toBe('Sees: Progress · 1\u00a0Sep – 30\u00a0Sep');
    expect(seesLabel({ kind: 'progress', period: '1m', range: { from: '2025-09-01', to: '2025-09-30' } }, null, false, null, '2026-10-12')).toBe('Sees: Progress · 1\u00a0Sep – 30\u00a0Sep\u00a02025');
    expect(seesLabel({ kind: 'progress', period: '1m', range: { from: '2025-10-13', to: '2026-10-12' } }, null, false, null, '2026-10-12')).toBe(
      'Sees: Progress · 13\u00a0Oct\u00a02025 – 12\u00a0Oct\u00a02026',
    );
    // No known today: the year is named rather than guessed.
    expect(seesLabel({ kind: 'progress', period: '1m', range: { from: '2026-09-01', to: '2026-09-30' } }, null, false)).toBe('Sees: Progress · 1\u00a0Sep – 30\u00a0Sep\u00a02026');
    expect(seesLabel({ kind: 'progress', period: '1m' }, null, false)).toBe('Sees: Progress · last month');
    const s = await setUp();
    const d = await s.coach.describe({ kind: 'progress', period: '1m', range: { from: '2026-09-01', to: '2026-09-30' } }, null);
    expect(d.yourData).toContainEqual({ label: 'Opened from', detail: 'Progress · 1\u00a0Sep – 30\u00a0Sep' });
    const past = await s.coach.describe({ kind: 'progress', period: '1m', range: { from: '2025-09-01', to: '2025-09-30' } }, null);
    expect(past.yourData).toContainEqual({ label: 'Opened from', detail: 'Progress · 1\u00a0Sep – 30\u00a0Sep\u00a02025' });
  });

  it('the sheet’s `today` for `Sees:` is the profile zone’s, as the coach context uses (review ben-bugs r2 N2)', async () => {
    const { services: fresh } = await h.launch();
    expect(await fresh.coach.today()).toBeNull(); // before setup: no profile
    const s = await setUp();
    h.clockMs = Date.parse('2026-10-12T23:30:00.000Z'); // 00:30 on 13 Oct in London (BST)
    expect(await s.coach.today()).toBe('2026-10-13');
  });
});
