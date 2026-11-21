import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TodayScreen } from '../../src/screens/TodayScreen';
import type { AppServices } from '../../src/services/app-services';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';
import { benWithHistory, DAY, harness, MONDAY, todayData, withPlan, type Ben } from './seed';

/**
 * (Ben, 21 Nov: MS3 amended) Today rendered over real SQLite, no AI: `2 days behind · Adjust today?` opens the two
 * choices; Longer → Apply puts the extras on today's Your workout (Push A), `Applied · Undo` takes them off again.
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  await h.cleanup();
});

async function doDay(ben: Ben, name: string): Promise<void> {
  const s: AppServices = ben.s;
  const d = await todayData(s);
  const day = d.days.find((x) => x.name === name);
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error(`no ${name}`);
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId: ben.gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  const id = r.aggregate.session.id;
  for (;;) {
    const a = (await s.workout.load(id))?.aggregate;
    const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup');
    if (a === undefined || set === undefined) break;
    const conv = a.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: conv === 'bodyweight' ? 0 : 20, unit: 'kg', convention: conv }, reps: set.planned.reps?.min ?? 8, durationS: set.planned.durationS, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
  }
  const now = await s.workout.load(id);
  const fin = await s.workout.dispatch(id, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
}

describe('Today: behind, the longer choice (no AI)', () => {
  it('Adjust today? → Usual and Longer; Longer → Apply → the extras on today’s draft; Undo', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben, { sessions: 5, split: 'ppl', schedule: 'set', days: [0, 1, 2, 3, 5] });
    await doDay(ben, 'Legs');
    h.clockMs = Date.parse(MONDAY) + 3 * DAY;
    const d = await todayData(ben.s);
    const longer = ben.s.todaySession.behindLonger(d);
    if (longer === null) throw new Error('no longer choice');
    const r = await renderScreen(h, ben.launched, TodayScreen, { name: 'Today' }, (t) => t.includes('2 days behind'));
    await r.press('2 days behind· Adjust today?');
    await r.waitFor((t) => t.includes(`Usual · ~${String(longer.usualMinutes)} min`) && t.includes(`Longer · ~${String(longer.minutes)} min · + `), 'both choices');
    expect(r.text()).toContain('Built-in');
    const longerRow = r.text().split('|').find((x) => x.startsWith('Longer · ')) ?? '';
    await r.press(longerRow);
    await r.press('Apply');
    await r.waitFor((t) => t.includes('Undo'), 'Applied · Undo');
    const after = await todayData(ben.s);
    expect(after.days.find((x) => x.key === after.nextKey)?.name).toBe('Push A');
    const draft = await ben.s.builder.todayDraft();
    if (draft === null) throw new Error('no draft');
    const ids = (await ben.s.builder.read(draft.draftId))?.workout.blocks.flatMap((b) => b.slots.map((x) => x.exerciseId)) ?? [];
    for (const x of longer.extras) expect(ids).toContain(x.exerciseId);
    await r.press('Undo');
    await r.waitFor((t) => t.includes('2 days behind'), 'the offer back after Undo');
    const back = (await ben.s.builder.read(draft.draftId))?.workout.blocks.flatMap((b) => b.slots.map((x) => x.exerciseId)) ?? [];
    for (const x of longer.extras) expect(back).not.toContain(x.exerciseId);
    expectHealthy(r);
    await r.unmount();
  });
});
