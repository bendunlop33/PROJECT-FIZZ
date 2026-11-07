import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, logWorkout, type Harness } from './harness';

/**
 * Progress › Exercises tab through the app services (Ben, 13–14 Oct 2026):
 * stored workouts in, the tab's view out; the tab's own period; the same
 * numbers after a relaunch (force-close). Local only: no coach or network.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-01T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;
const sp = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ');

describe('exerciseTab', () => {
  it('defaults to the most recent exercise; measure, trailing and period change the view; a relaunch shows the same', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gym = await s.setup.useTypicalGym();
    await s.setup.complete();
    const gymId = gym.ok ? (gym.gymId ?? '') : '';
    expect((await s.progress.exerciseTab({ period: '6m' }))?.view).toBeNull();

    for (const load of [60, 62.5, 65]) {
      await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load, reps: 5 }, { load, reps: 5 }] }]);
      h.clockMs += 2 * DAY;
    }
    const tab = await s.progress.exerciseTab({ period: '6m' });
    const v = tab?.view;
    if (!v) throw new Error('no view');
    expect(v.title).toBe('Bench press');
    expect(v.measure).toBe('e1rm');
    expect(v.stats.map((x) => x.label)).toEqual(['Est. 1RM', 'Best set', 'Sessions']);
    expect(v.stats[2]?.value).toBe('3');
    expect(sp(v.stats[1]?.value)).toBe('65 kg × 5');
    expect(v.chart.points).toHaveLength(3);
    expect(v.table.rows.map((r) => r.cells.sets)).toEqual(['2', '2', '2']);
    expect(sp(tab.datesLine)).toBe('8 Apr – 7 Oct');

    const w = (await s.progress.exerciseTab({ period: '6m', measure: 'weight', trailing: 3 }))?.view;
    expect(w?.chart.points.map((p) => p.value)).toEqual([60, 62.5, 65]);
    expect(w?.chart.points.map((p) => p.average)).toEqual([60, 61.25, 62.5]);

    const custom = await s.progress.exerciseTab({ period: '6m', range: { from: '2026-05-01', to: '2026-05-31' } });
    expect(custom?.view?.empty).toBe('No sessions in this period.');
    expect(custom?.range).toEqual({ from: '2026-05-01', to: '2026-05-31' });

    const { services: s2 } = await h.launch();
    const again = (await s2.progress.exerciseTab({ period: '6m', measure: 'weight', trailing: 3 }))?.view;
    expect(again?.chart.points.map((p) => p.average)).toEqual([60, 61.25, 62.5]);
  });

  it('(Ben, 26 Oct) no plan: the chips are his most-trained main compounds and the tab opens on the first; his last pick wins while it has history; a relaunch the same', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gym = await s.setup.useTypicalGym();
    await s.setup.complete();
    const gymId = gym.ok ? (gym.gymId ?? '') : '';
    const w = (exercise: string, load: number) => ({ exercise, sets: [{ load, reps: 5 }, { load, reps: 5 }] });
    await logWorkout(h, s, gymId, [w('Back squat', 100), w('Deadlift', 140)]);
    h.clockMs += 2 * DAY;
    await logWorkout(h, s, gymId, [w('Bench press', 80), w('Barbell row', 70), w('Lateral raise', 10)]);
    h.clockMs += 2 * DAY;
    await logWorkout(h, s, gymId, [w('Back squat', 102.5), w('Overhead press', 50)]);
    h.clockMs += 2 * DAY;
    // The newest workout is lateral raises only: the old default (most recent) would open on them.
    await logWorkout(h, s, gymId, [w('Lateral raise', 12)]);

    const tab = await s.progress.exerciseTab({ period: '6m' });
    expect(tab?.lifts.source).toBe('history');
    expect(tab?.lifts.chips.map((c) => c.label)).toEqual(['Back squat', 'Bench press', 'Deadlift', 'Barbell row', 'Overhead press']);
    expect(tab?.lifts.chips.map((c) => c.selected)).toEqual([true, false, false, false, false]);
    expect(tab?.view?.title).toBe('Back squat');

    const rowId = tab?.lifts.chips.find((c) => c.label === 'Barbell row')?.exerciseId ?? '';
    const remembered = await s.progress.exerciseTab({ period: '6m', remembered: rowId });
    expect(remembered?.view?.title).toBe('Barbell row');
    expect(remembered?.lifts.chips.find((c) => c.selected)?.label).toBe('Barbell row');
    // A remembered lift with no history (deleted, another store) falls back to the first main lift.
    expect((await s.progress.exerciseTab({ period: '6m', remembered: 'gone' }))?.view?.title).toBe('Back squat');

    // An exercise opened from elsewhere (not a main lift) leads the chips, selected.
    const raiseId = (await s.progress.exercises({ query: 'Lateral raise' }))?.view.rows[0]?.exerciseId ?? '';
    const raise = await s.progress.exerciseTab({ period: '6m', exerciseId: raiseId });
    expect(raise?.lifts.chips[0]).toMatchObject({ label: 'Lateral raise', selected: true });

    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await s2.progress.exerciseTab({ period: '6m', remembered: rowId }))?.view?.title).toBe('Barbell row');
    expect((await s2.progress.exerciseTab({ period: '6m' }))?.lifts.chips.map((c) => c.label)).toEqual(['Back squat', 'Bench press', 'Deadlift', 'Barbell row', 'Overhead press']);
  });

    it('opening on a record: its series, a period wide enough to hold it, the unreadable count (review S3, S5)', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gym = await s.setup.useTypicalGym();
    await s.setup.complete();
    const gymId = gym.ok ? (gym.gymId ?? '') : '';
    const old = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 5 }] }]);
    h.clockMs += 100 * DAY;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 70, reps: 5 }] }]);
    const plain = await s.progress.exerciseTab({ period: '1m' });
    expect(plain?.period).toBe('1m');
    expect(plain?.view?.chart.points).toHaveLength(1);
    expect(plain?.unreadable).toBe(0);
    const opened = await s.progress.exerciseTab({ period: '1m', open: { sessionId: old, sessionExerciseId: null } });
    expect(opened?.period).toBe('6m');
    expect(opened?.range).toBeNull();
    expect(opened?.view?.chart.points.map((p) => p.sessionId)).toContain(old);
  });

  it('Total weight (20 Oct): per-hand loads count each dumbbell from the catalogue; a goblet squat is one dumbbell', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gym = await s.setup.useTypicalGym();
    await s.setup.complete();
    const gymId = gym.ok ? (gym.gymId ?? '') : '';
    await logWorkout(h, s, gymId, [
      { exercise: 'Dumbbell bench press', sets: [{ load: 20, reps: 10 }, { load: 20, reps: 10 }] },
      { exercise: 'Goblet squat', sets: [{ load: 20, reps: 10 }, { load: 20, reps: 10 }] },
    ]);
    const list = await s.progress.exercises();
    const idOf = (name: string) => list?.view.rows.find((r) => r.name === name)?.exerciseId ?? null;
    const press = (await s.progress.exerciseTab({ period: '6m', exerciseId: idOf('Dumbbell bench press'), measure: 'total' }))?.view;
    expect(press?.measure).toBe('total');
    expect(press?.chart.unit).toBe('kg');
    // 20 kg each × 10 × 2 sets × 2 dumbbells.
    expect(press?.chart.points.map((p) => p.value)).toEqual([800]);
    expect(press?.table.rows[0]?.cells.total).toBe('800');
    // Review B1: the header says `kg each` for the top set; TOTAL has its own plain `kg` (both dumbbells counted).
    expect(press?.table.unit.replace(/\u00a0/g, ' ')).toBe('kg each');
    expect(press?.table.totalUnit).toBe('kg');
    expect(press?.series).toEqual([]);
    expect(press?.info).toBeNull();
    const goblet = (await s.progress.exerciseTab({ period: '6m', exerciseId: idOf('Goblet squat'), measure: 'total' }))?.view;
    expect(goblet?.chart.points.map((p) => p.value)).toEqual([400]);
  });
});
