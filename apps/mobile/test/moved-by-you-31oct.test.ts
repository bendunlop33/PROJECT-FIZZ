import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import type { Harness } from './harness';
import { benWithHistory, DAY, harness, withPlan } from './render/seed';

/**
 * (Ben, 31 Oct: "it should move everything") Real SQLite, offline: a Set days plan (Mon, Wed, Fri, Sat); on Tuesday
 * Ben moves Friday's day onto today with `Move to…`. It is Up next with `Moved by you · Undo` (`plans.movedToday`);
 * Undo puts the move back (the day sheet's own Undo, or `unmove` when another change came after). Versioned.
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  await h.cleanup();
});

async function nextDay(s: AppServices): Promise<number | null> {
  const d = await s.todaySession.load();
  return d?.days.find((x) => x.key === d.nextKey)?.dayIndex ?? null;
}

async function moveFridayOntoTuesday(s: AppServices): Promise<{ planId: string }> {
  const ov = await s.plans.overview();
  if (ov == null) throw new Error('no plan');
  expect(await s.plans.weekChange({ planId: ov.planId, expectedVersion: ov.planVersion, opId: h.ids(), change: { kind: 'place', moves: [{ dayIndex: 2, weekday: 1 }] } })).toMatchObject({ ok: true });
  return { planId: ov.planId };
}

describe('Moved by you · Undo', () => {
  it('Friday’s day moved onto today is Up next with Moved by you; Undo (the day sheet’s own) puts it back', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben, { sessions: 4, schedule: 'set', days: [0, 2, 4, 5] });
    h.clockMs += DAY; // Tuesday 20 Oct
    expect(await ben.s.plans.movedToday(2)).toBeNull();
    await moveFridayOntoTuesday(ben.s);
    expect(await nextDay(ben.s)).toBe(2);
    const moved = await ben.s.plans.movedToday(2);
    expect(moved).toMatchObject({ dayIndex: 2, undo: 'last' });
    if (moved === null) throw new Error('not moved');
    // Another day isn't marked.
    expect(await ben.s.plans.movedToday(0)).toBeNull();
    // A stale Undo (an older version) is refused; the right one puts the move back.
    expect(await ben.s.plans.undoWeekChange({ planId: moved.planId, expectedVersion: moved.version - 1, opId: h.ids() })).toMatchObject({ ok: false });
    expect(await ben.s.plans.undoWeekChange({ planId: moved.planId, expectedVersion: moved.version, opId: h.ids() })).toMatchObject({ ok: true });
    expect(await ben.s.plans.movedToday(2)).toBeNull();
    expect(await nextDay(ben.s)).not.toBe(2);
  });

  it('another change since the move: Undo takes this week’s move of the day back (`unmove`), the other change stays', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben, { sessions: 4, schedule: 'set', days: [0, 2, 4, 5] });
    h.clockMs += DAY;
    const { planId } = await moveFridayOntoTuesday(ben.s);
    const ov = await ben.s.plans.overview();
    expect(await ben.s.plans.weekChange({ planId, expectedVersion: ov?.planVersion ?? 0, opId: h.ids(), change: { kind: 'skip', dayIndex: 3 } })).toMatchObject({ ok: true });
    const moved = await ben.s.plans.movedToday(2);
    expect(moved).toMatchObject({ undo: 'unmove' });
    if (moved === null) throw new Error('not moved');
    const op = h.ids();
    expect(await ben.s.plans.weekChange({ planId, expectedVersion: moved.version, opId: op, change: { kind: 'unmove', dayIndex: 2 } })).toMatchObject({ ok: true });
    // The same op ID again replays (idempotent); nothing moves twice.
    expect(await ben.s.plans.weekChange({ planId, expectedVersion: moved.version, opId: op, change: { kind: 'unmove', dayIndex: 2 } })).toMatchObject({ ok: true });
    expect(await ben.s.plans.movedToday(2)).toBeNull();
    expect((await ben.s.todaySession.load())?.skipped.length).toBe(1);
  });
});
