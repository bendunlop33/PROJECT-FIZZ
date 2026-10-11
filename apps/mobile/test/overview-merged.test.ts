import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCell, NBSP, type OverviewRow } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { OverviewData } from '../src/services/workout-services';
import { startFromOverview } from '../src/workout/overview-start';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * The overview after the gym-switch merge, on real SQLite: the preview is
 * the shared fit Start uses (`snapPlanToGym` through `planRoutineStart`),
 * also after the gym chip changes gym.
 */

const DAY = 86_400_000;

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function load(s: AppServices, gymId: string): Promise<OverviewData> {
  const page = await s.overview.load({ target: { kind: 'next' }, gymId });
  if (!page) throw new Error('no overview');
  return page;
}

/** Every pending set Start made, against the row the page showed for it. */
function matchesSession(row: OverviewRow, agg: SessionAggregate): void {
  const ex = agg.exercises.find((e) => e.exerciseId === row.exerciseId);
  if (!ex) throw new Error(`no ${row.name}`);
  const working = agg.sets.filter((x) => x.sessionExerciseId === ex.id && x.setType !== 'warmup' && x.pairedWithSetId === null).sort((a, b) => a.index - b.index);
  expect(row.detail.startsWith(`${String(working.length)}${NBSP}×${NBSP}`)).toBe(true);
  expect(row.load.value).toBe(loadCell(working[0]?.planned.load ?? null, ex.loadConvention, null, false).value);
}

const ports = (s: AppServices, gymId: string) => ({
  start: (q: Parameters<AppServices['overview']['start']>[0]) => s.overview.start(q),
  reload: () => s.overview.load({ target: { kind: 'next' }, gymId }),
});

describe('preview == Start after a gym switch (shared fit)', () => {
  it('the gym chip switches gym: the rows re-fit by snapPlanToGym, and Start at that gym creates exactly them', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] },
      { exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 10 }, { load: 32.5, reps: 10 }] },
    ]);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1' });
    if (!saved.ok) throw new Error(saved.message);
    h.clockMs += 2 * DAY;
    const hotelId = h.ids();
    expect((await s.setup.saveGym({ gymId: hotelId, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);

    const main = await load(s, gymId);
    const mainDb = main.view.rows.find((r) => r.name === 'Dumbbell bench press');
    expect(mainDb?.rounded).toBe(false);

    // What the chip does: select the gym, then the page re-reads at it.
    expect(await s.gyms.select(hotelId)).toMatchObject({ ok: true, changed: true });
    const hotel = await load(s, hotelId);
    expect(hotel.view.previewKey).not.toBe(main.view.previewKey);
    const db = hotel.view.rows.find((r) => r.name === 'Dumbbell bench press');
    const bench = hotel.view.rows.find((r) => r.name === 'Bench press');
    // The hotel rack stops at 25 kg: capped, never above its max (rule 4).
    expect(db?.load.value).toBe('25');
    expect(db?.rounded).toBe(true);
    expect(db?.panel.find((l) => l.key === 'rounded')?.value.replaceAll(NBSP, ' ')).toBe('Rack tops out at 25 kg each');
    // No barbell: reps kept, no load target, and the panel names what's missing.
    expect(bench?.load.value).toBe('—');
    expect(bench?.missingEquipment).not.toBeNull();

    const r = await startFromOverview(ports(s, hotelId), { page: hotel, opId: 'op-hotel', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'started') throw new Error(r.kind);
    const agg = r.outcome.aggregate;
    expect(agg.session.gymId).toBe(hotelId);
    for (const row of hotel.view.rows) matchesSession(row, agg);
    // The saved fit is the one the preview showed.
    const dbEx = agg.exercises.find((e) => e.exerciseName === 'Dumbbell bench press');
    const benchEx = agg.exercises.find((e) => e.exerciseName === 'Bench press');
    const dbSets = agg.sets.filter((x) => x.sessionExerciseId === dbEx?.id && x.setType !== 'warmup');
    const benchSets = agg.sets.filter((x) => x.sessionExerciseId === benchEx?.id && x.setType !== 'warmup');
    expect(dbSets.every((x) => x.planned.snap?.outcome === 'capped' && x.planned.snap.by === 'start' && x.planned.load?.value === 25)).toBe(true);
    expect(benchSets.every((x) => x.planned.load === null && x.planned.snap?.outcome === 'dropped' && x.planned.snap.reason === 'not_here')).toBe(true);
  });
});
