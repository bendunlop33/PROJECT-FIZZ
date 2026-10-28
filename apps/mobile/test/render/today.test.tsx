import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BuilderWorkoutScreen } from '../../src/screens/builder/BuilderWorkoutScreen';
import { TodayScreen } from '../../src/screens/TodayScreen';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';
import { benWithHistory, doPlanDay, harness, todayData, withPlan } from './seed';

/**
 * Today in its three plan states, and Your workout opened from its Edit, rendered over real SQLite (ADR 0037):
 * the first frame (nothing until the local read) and the loaded one, with no React warning on the way.
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('Today', () => {
  it('a plan day: Up next with Start', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben);
    const day = (await todayData(ben.s)).days[0]?.name ?? 'no day';
    const r = await renderScreen(h, ben.launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Up next') && t.includes(day));
    expect(r.text()).toContain('Start Plan Workout');
    expectHealthy(r);
    await r.unmount();
  });

  it('a rest day on a Set days plan (Tue, Thu, Sat on a Monday): Rest day and the next day', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben, { sessions: 3, split: null, schedule: 'set', days: [1, 3, 5] });
    const r = await renderScreen(h, ben.launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Rest day'));
    expect(r.text()).toContain('· Tue');
    expectHealthy(r);
    await r.unmount();
  });

  it('done for today: the workout with its Summary link', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben);
    await doPlanDay(h, ben);
    const r = await renderScreen(h, ben.launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Summary ›'));
    expect(r.text()).not.toContain('Up next');
    expectHealthy(r);
    await r.unmount();
  });
});

describe('Your workout', () => {
  it('opened from Today’s Edit: the plan day’s exercises, Time and Start', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben);
    const data = await todayData(ben.s);
    const key = data.nextKey;
    const controls = key === null ? undefined : data.initial[key];
    if (key === null || controls === undefined) throw new Error('no plan day');
    const c = await ben.s.todaySession.commit(data, { dayKey: key, controls }, h.ids());
    if (!c.ok) throw new Error(c.message);
    const day = data.days.find((d) => d.key === key)?.name ?? 'no day';
    const r = await renderScreen(h, ben.launched, BuilderWorkoutScreen, { name: 'BuilderWorkout', params: { draftId: c.draftId, back: 'Today' } }, (t) => t.includes(day) && t.includes('＋ Add exercise'));
    expect(r.text()).toContain('Start');
    expectHealthy(r);
    await r.unmount();
  });
});
