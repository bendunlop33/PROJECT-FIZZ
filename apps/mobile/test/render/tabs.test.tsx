import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LibraryScreen } from '../../src/screens/library/LibraryScreen';
import { ProfileScreen } from '../../src/screens/profile/ProfileScreen';
import { ProgressScreen } from '../../src/screens/progress/ProgressScreen';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';
import { benWithHistory, harness, withPlan } from './seed';

/**
 * Progress (Lifts, Training month, Body), Library › Plan and Profile rendered over real SQLite with two weeks of
 * history and a plan in use (ADR 0037). Each tab of Progress reads only while it shows, so each switch is a
 * loading → loaded transition of its own.
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('Progress', () => {
  it('Lifts, then Training (this month), then Body', async () => {
    const ben = await benWithHistory(h);
    const r = await renderScreen(h, ben.launched, ProgressScreen, { name: 'ProgressHome' }, (t) => t.includes('Bench press') && t.includes('Est. 1RM'));
    expectHealthy(r);
    // The lift's trend chart drew through its (Skia) canvas once laid out, not the no-Skia fallback.
    expect(r.all((n) => n.type === 'Canvas').length).toBeGreaterThan(0);
    await r.press('Training');
    await r.waitFor((t) => t.includes('October workouts') && t.includes('MUSCLES · SETS'), 'Training this month');
    await r.layout();
    await r.press('Body');
    await r.waitFor((t) => t.includes('Bodyweight'), 'Body');
    await r.layout();
    expect(r.errors).toEqual([]);
    await r.unmount();
  });
});

describe('Library › Plan', () => {
  it('the plan in use: this week’s days with the next one', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben);
    const r = await renderScreen(h, ben.launched, LibraryScreen, { name: 'LibraryHome' }, (t) => t.includes('4-day plan') && t.includes('Next'));
    expect(r.text()).toContain('Edit plan');
    expectHealthy(r);
    await r.unmount();
  });
});

describe('Profile', () => {
  it('the gym, the plan’s split and the honest unavailable states', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben);
    const r = await renderScreen(h, ben.launched, ProfileScreen, { name: 'ProfileHome' }, (t) => t.includes('Main Gym') && t.includes('Set by your plan'));
    expect(r.text()).toContain('Not connected');
    expectHealthy(r);
    await r.unmount();
  });
});
