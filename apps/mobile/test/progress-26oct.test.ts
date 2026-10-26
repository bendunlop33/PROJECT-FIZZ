import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultLiftPicks, trackedLiftPicks } from '@fizz/domain';

import { barbell, dumbbells, gym, HISTORY_EXERCISES, largeHistory, profile, stack } from '@fizz/domain/testing';
import { openStore } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';

import { createProgressService } from '../src/services/progress-service';
import { createHarness, logWorkout, type Harness } from './harness';

/**
 * Progress, Ben 26 Oct (app-review-26oct findings 1, 5, 9; competitor pass 4 #6, #9), through the app services on
 * real SQLite: answers kept while nothing is written (and read again after any write), one list of tracked lifts
 * for Overview and Lifts, and the Lifts tab's targets read without full workouts.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-01T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;
const w = (exercise: string, load: number, reps = 5) => ({ exercise, sets: [{ load, reps }, { load, reps }] });

async function setUp() {
  const { services: s } = await h.launch();
  await s.setup.saveUnits('kg');
  const gym = await s.setup.useTypicalGym();
  await s.setup.complete();
  return { s, gymId: gym.ok ? (gym.gymId ?? '') : '' };
}

describe('tracked lifts: Overview picks lead the Lifts chips (Ben, 26 Oct)', () => {
  it('domain: picks with history first, then the defaults, each once, up to 6', () => {
    const defaults = { ids: ['squat', 'bench', 'dead', 'row', 'ohp'], source: 'history' as const };
    const logged = (id: string) => id !== 'never';
    expect(trackedLiftPicks({ picked: [], defaults, logged })).toBe(defaults);
    expect(trackedLiftPicks({ picked: ['never'], defaults, logged })).toBe(defaults);
    expect(trackedLiftPicks({ picked: ['hip', 'bench', 'hip'], defaults, logged })).toEqual({ ids: ['hip', 'bench', 'squat', 'dead', 'row', 'ohp'], source: 'picked' });
    expect(trackedLiftPicks({ picked: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], defaults, logged }).ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    // The defaults themselves are unchanged (no plan, nothing logged: none).
    expect(defaultLiftPicks({ planMains: null, sessions: [], info: () => null, today: '2026-10-01' })).toEqual({ ids: [], source: 'none' });
  });

  it('a lift picked on Overview (`Edit`, progress_lifts) is the first Lifts chip and the tab opens on it; Overview shows it too', async () => {
    const { s, gymId } = await setUp();
    await logWorkout(h, s, gymId, [w('Back squat', 100), w('Deadlift', 140)]);
    h.clockMs += 2 * DAY;
    await logWorkout(h, s, gymId, [w('Bench press', 80), w('Lateral raise', 10, 12)]);
    h.clockMs += 2 * DAY;

    const before = await s.progress.exerciseTab({ period: '6m' });
    expect(before?.lifts.chips.map((c) => c.label)).not.toContain('Lateral raise');
    const hip = (await s.progress.exercises({ query: 'Lateral raise' }))?.view.rows[0]?.exerciseId ?? '';
    const overview = await s.reviews.progress();
    if (overview === null) throw new Error('no overview');
    const saved = await s.training.change({ kind: 'progress_lifts', exerciseIds: [hip], reps: { [hip]: 12 } }, overview.trainingVersion, 'op-pick-hip');
    expect(saved.ok).toBe(true);
    // No reload signal is needed: the write itself makes both read again.
    const after = await s.progress.exerciseTab({ period: '6m' });
    expect(after?.lifts.source).toBe('picked');
    expect(after?.lifts.chips[0]).toMatchObject({ label: 'Lateral raise', selected: true });
    expect(after?.lifts.chips.map((c) => c.label)).toEqual(['Lateral raise', 'Bench press', 'Back squat', 'Deadlift']);
    expect(after?.view?.title).toBe('Lateral raise');
    const shown = await s.reviews.progress();
    expect(shown?.lifts.lifts.map((l) => l.name)).toEqual(['Lateral raise']);
    // After a force-close, the same.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await s2.progress.exerciseTab({ period: '6m' }))?.lifts.chips[0]?.label).toBe('Lateral raise');
  });
});

describe('answers kept while nothing is written (Ben, 26 Oct: "Progress slow")', () => {
  it('a return with nothing changed gets the very same objects; any write (a workout, a setting) reads again', async () => {
    const { s, gymId } = await setUp();
    await logWorkout(h, s, gymId, [w('Bench press', 80)]);
    h.clockMs += 2 * DAY;
    const shell = await s.progress.shell();
    expect(shell).toMatchObject({ hasData: true, resume: null });
    const [home, tab, data, consistency] = [await s.progress.home(), await s.progress.exerciseTab({ period: '6m' }), await s.reviews.progress(), await s.plans.consistency()];
    expect(await s.progress.shell()).toBe(shell);
    expect(await s.progress.home()).toBe(home);
    expect(await s.progress.exerciseTab({ period: '6m' })).toBe(tab);
    expect(await s.reviews.progress()).toBe(data);
    expect(await s.plans.consistency()).toBe(consistency);

    // A new workout: every answer reads again and counts it.
    await logWorkout(h, s, gymId, [w('Bench press', 85)]);
    const home2 = await s.progress.home();
    expect(home2).not.toBe(home);
    const tab2 = await s.progress.exerciseTab({ period: '6m' });
    expect(tab2?.view?.chart.points).toHaveLength(2);
    expect((await s.reviews.progress())?.week).not.toBe(data?.week);

    // A setting (the shared period) is a write too.
    expect((await s.progress.saveSettings({ period: '3m' })).ok).toBe(true);
    expect((await s.progress.home())?.period).toBe('3m');
    expect((await s.progress.shell())?.period).toBe('3m');
  });

  it('an unfinished workout shows on the ResumeBar at once, from the cached shell', async () => {
    const { s, gymId } = await setUp();
    await logWorkout(h, s, gymId, [w('Bench press', 80)]);
    const quiet = await s.progress.shell();
    expect(quiet?.resume).toBeNull();
    const started = await s.workout.start({ gymId, opId: 'op-start-unfinished', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    expect(started.ok).toBe(true);
    expect((await s.progress.shell())?.resume).not.toBeNull();
  });
});

describe('Lifts targets read without full workouts (review 26 Oct finding 9)', () => {
  it('targets come from one batched summary read (no `sessions.get`), and a period or measure change reads none again', async () => {
    const store = await openStore(openNodeDriver(':memory:'));
    try {
      await store.repos.profiles.save(profile(), null);
      await store.repos.gyms.save(gym(2, { isDefault: true }), null);
      for (const eq of [barbell(), stack(), dumbbells()]) await store.repos.equipment.save(eq, null);
      for (const ex of HISTORY_EXERCISES) await store.repos.exercises.save(ex, null);
      for (const x of largeHistory({ weeks: 30, perWeek: 2 })) await store.repos.sessions.save(x, null);
      const svc = createProgressService({
        store: () => store,
        now: () => ({ utc: '2026-10-08T18:05:00.000Z', tz: 'Europe/London' }),
        profile: async () => (await store.repos.profiles.get(profile().id)) ?? null,
        saveSettings: () => Promise.resolve({ ok: true }),
        catalogueExercises: () => [],
        dispatch: () => Promise.reject(new Error('unused')),
        slicer: () => () => Promise.resolve(),
      });
      const calls = { get: 0, getMany: 0 };
      const sessions = store.repos.sessions;
      const origGet = sessions.get.bind(sessions);
      const origMany = sessions.getMany.bind(sessions);
      sessions.get = (id) => {
        calls.get += 1;
        return origGet(id);
      };
      sessions.getMany = (ids) => {
        calls.getMany += 1;
        return origMany(ids);
      };
      await svc.prewarm();
      const before = calls.getMany;
      const bench = HISTORY_EXERCISES[0]?.id ?? '';
      const tab = await svc.exerciseTab({ exerciseId: bench, period: '6m' });
      expect(tab?.targets?.rows.length).toBe(20);
      expect(calls.get).toBe(0);
      expect(calls.getMany).toBe(before + 1);
      await svc.exerciseTab({ exerciseId: bench, period: '3m' });
      await svc.exerciseTab({ exerciseId: bench, period: '3m', measure: 'weight' });
      await svc.exerciseTab({ exerciseId: bench, period: '3m', measure: 'weight', trailing: 10 });
      expect(calls.getMany).toBe(before + 1);
      expect(calls.get).toBe(0);
    } finally {
      await store.close();
    }
  });
});
