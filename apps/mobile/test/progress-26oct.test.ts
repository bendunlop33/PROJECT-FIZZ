import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultLiftPicks, newPainFlag, trackedLiftPicks } from '@fizz/domain';

import { barbell, dumbbells, gym, HISTORY_EXERCISES, id, largeHistory, profile, stack } from '@fizz/domain/testing';
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

describe('one exercise-progress screen (Ben, 26 Oct): Lifts and Exercise detail share one model', () => {
  it('the Lifts model carries BEST REPS for the period, all-time RECORDS and a pain flag, for the series showing; every row opens a workout', async () => {
    const store = await openStore(openNodeDriver(':memory:'));
    try {
      await store.repos.profiles.save(profile(), null);
      await store.repos.gyms.save(gym(2, { isDefault: true }), null);
      for (const eq of [barbell(), stack(), dumbbells()]) await store.repos.equipment.save(eq, null);
      for (const ex of HISTORY_EXERCISES) await store.repos.exercises.save(ex, null);
      const history = largeHistory({ weeks: 30, perWeek: 2 });
      for (const x of history) await store.repos.sessions.save(x, null);
      const ids = new Set(history.map((x) => x.session.id));
      const nowIso = '2026-10-08T18:05:00.000Z';
      const svc = createProgressService({
        store: () => store,
        now: () => ({ utc: nowIso, tz: 'Europe/London' }),
        profile: async () => (await store.repos.profiles.get(profile().id)) ?? null,
        saveSettings: () => Promise.resolve({ ok: true }),
        catalogueExercises: () => [],
        dispatch: () => Promise.reject(new Error('unused')),
        slicer: () => () => Promise.resolve(),
        // (Ben, 26 Oct) Records are the tracked lifts' New bests: bench tracked, its newest workout's set a best.
        newBests: () => Promise.resolve(benchBests()),
      });
      const bench = HISTORY_EXERCISES[0]?.id ?? '';
      const benchBests = () => {
        const last = [...history].reverse().find((x) => x.exercises.some((e) => e.exerciseId === bench));
        const set = last?.sets.find((x) => x.status === 'completed' && x.setType !== 'warmup' && x.actual?.load != null && x.actual.reps != null && last.exercises.find((e) => e.id === x.sessionExerciseId)?.exerciseId === bench);
        const load = set?.actual?.load;
        if (last === undefined || set === undefined || load == null) throw new Error('no bench set');
        return { tracked: new Set([bench]), claims: [{ sessionId: last.session.id, exerciseId: bench, date: last.session.startedAt.utc.slice(0, 10), startedMs: Date.parse(last.session.startedAt.utc), load: load.value, unit: load.unit, reps: set.actual?.reps ?? 0, convention: load.convention, view: { exerciseId: bench, text: 'New best', accessibilityLabel: 'New best' } }] };
      };
      const tab = await svc.exerciseTab({ exerciseId: bench, period: '6m' });
      const extras = tab?.extras;
      if (!extras || !tab.view) throw new Error('no extras');
      expect(extras.seriesId).toBe(tab.view.seriesId);
      expect(extras.repTable?.by).toBe('weight');
      expect(extras.repTable?.rows.length).toBeGreaterThan(0);
      for (const r of extras.repTable?.rows ?? []) if (r.sessionId !== null) expect(ids.has(r.sessionId)).toBe(true);
      expect(extras.records).not.toBeNull();
      expect(extras.records?.items.map((r) => r.sessionId)).toEqual([benchBests().claims[0]?.sessionId]);
      for (const r of extras.records?.items ?? []) expect(ids.has(r.sessionId)).toBe(true);
      expect(extras.pain).toBeNull();
      // Every chart point is a workout (a tap opens it).
      for (const p of tab.view.chart.points) expect(ids.has(p.sessionId)).toBe(true);
      // By reps, and a shorter period narrows BEST REPS like the chart (records stay all-time).
      const byReps = await svc.exerciseTab({ exerciseId: bench, period: '6m', repBy: 'reps' });
      expect(byReps?.extras?.repTable?.by).toBe('reps');
      const month = await svc.exerciseTab({ exerciseId: bench, period: '1m' });
      expect(month?.extras?.records?.items.length).toBe(extras.records?.items.length);
      // Opened on an old workout (a Summary row): its series and a period wide enough to hold it.
      const oldest = history.find((x) => x.exercises.some((e) => e.exerciseId === bench));
      if (!oldest) throw new Error('no bench workout');
      const opened = await svc.exerciseTab({ exerciseId: bench, period: '6m', open: { sessionId: oldest.session.id, sessionExerciseId: null } });
      expect(opened?.view?.chart.points.map((p) => p.sessionId)).toContain(oldest.session.id);
      // A pain flag on the exercise shows (rule 9), at once (a write).
      await store.repos.painFlags.save(newPainFlag({ id: id(9_260_001), ownerId: profile().id, opId: 'pain-bench-26oct', exerciseId: bench, exerciseName: 'Bench', area: null, source: 'check_in', checkInId: null, at: { utc: nowIso, tz: 'Europe/London' } }), null);
      const flagged = await svc.exerciseTab({ exerciseId: bench, period: '6m' });
      expect(flagged?.extras?.pain?.text).toMatch(/^Pain flag since/);
    } finally {
      await store.close();
    }
  });

  it('Exercise detail opens a lift with the same view as the Lifts chip (one period set, no chips)', async () => {
    const { s, gymId } = await setUp();
    const ids: string[] = [];
    for (const load of [60, 62.5, 65]) {
      ids.push(await logWorkout(h, s, gymId, [w('Bench press', load)]));
      h.clockMs += 2 * DAY;
    }
    const lifts = await s.progress.exerciseTab({ period: '6m' });
    const bench = lifts?.view?.exerciseId ?? '';
    // Exercise detail asks for the exercise (no remembered pick): the same view.
    const detail = await s.progress.exerciseTab({ exerciseId: bench, remembered: null, period: '6m' });
    expect(detail?.view).toEqual(lifts?.view);
    expect(detail?.extras).toEqual(lifts?.extras);
    expect(detail?.view?.chart.points.map((p) => p.sessionId)).toEqual(ids);
  });
});

describe('a PB or a chart point opens its workout (Ben, 26 Oct)', () => {
  it('Overview lift points carry the workout of their top set; the PB ring is the newest workout', async () => {
    const { s, gymId } = await setUp();
    const ids: string[] = [];
    // One workout a week for 4 weeks, heavier each time: the newest top set is a PB.
    for (const load of [60, 62.5, 65, 67.5]) {
      ids.push(await logWorkout(h, s, gymId, [w('Bench press', load, 6)]));
      h.clockMs += 7 * DAY;
    }
    const bench = (await s.progress.exercises({ query: 'Bench press' }))?.view.rows[0]?.exerciseId ?? '';
    const data = await s.reviews.progress();
    if (data === null) throw new Error('no overview');
    expect((await s.training.change({ kind: 'progress_lifts', exerciseIds: [bench], reps: { [bench]: 6 } }, data.trainingVersion, 'op-pick-bench')).ok).toBe(true);
    const lift = (await s.reviews.progress())?.lifts.lifts.find((l) => l.exerciseId === bench);
    if (!lift) throw new Error('no bench line');
    expect(lift.points.map((p) => p.sessionId)).toEqual(ids);
    expect(lift.latestPb).toBe(true);
    expect(lift.points.at(-1)).toMatchObject({ pb: true, sessionId: ids.at(-1) });
  });
});

describe('monthly recap (Ben, 26 Oct): facts only, offline, dismissible, Your data', () => {
  it('on the 1st–7th, for the month just ended (nothing read otherwise); a record and a lift open their workout; dismissed stays dismissed after a force-close', async () => {
    const { s, gymId } = await setUp();
    // September: one workout. October: three, heavier.
    h.clockMs = Date.parse('2026-09-20T17:00:00.000Z');
    await logWorkout(h, s, gymId, [w('Bench press', 70)]);
    const october: string[] = [];
    for (const [day, load] of [[5, 75], [12, 77.5], [19, 80]] as const) {
      h.clockMs = Date.parse(`2026-10-${String(day).padStart(2, '0')}T17:00:00.000Z`);
      october.push(await logWorkout(h, s, gymId, [w('Bench press', load)]));
    }
    // Late October: the card isn't shown (September's recap is past its days).
    h.clockMs = Date.parse('2026-10-26T09:00:00.000Z');
    expect(await s.progress.recap()).toBeNull();

    h.clockMs = Date.parse('2026-11-02T09:00:00.000Z');
    const card = await s.progress.recap();
    if (card === null) throw new Error('no recap');
    expect(card.view).toMatchObject({ month: '2026-10', title: 'October', previousTitle: 'September' });
    expect(card.view.stats.map((x) => [x.label, x.value, x.previous])).toEqual([
      ['Workouts', '3', '1'],
      ['Time', expect.any(String), expect.any(String)],
    ]);
    expect(card.view.lifts[0]?.name).toBe('Bench press');
    expect(card.view.lifts[0]?.text.replace(/\u00a0/g, ' ')).toBe('70 × 5 → 80 × 5');
    expect(card.view.lifts[0]?.sessionId).toBe(october[2]);
    for (const r of card.view.records) expect(october).toContain(r.sessionId);
    // (Ben, 26 Oct; one definition of best) The recap's records are exactly the month's Summary `New best`s, and
    // the same rows Training's RECORDS and the exercise screen list.
    const summaryBests = (await Promise.all(october.map(async (id) => ((await s.reviews.sessionBests(id)).length > 0 ? [id] : [])))).flat();
    expect(card.view.records.map((r) => r.sessionId).sort()).toEqual([...summaryBests].sort());
    expect(card.view.records).toHaveLength(3);
    expect(card.view.line.replace(/\u00a0/g, ' ')).toMatch(/· 3 records$/);
    const home = await s.progress.home({ range: { from: '2026-10-01', to: '2026-10-31' } });
    const homeRecords = home?.view.dataState === 'normal' ? home.view.records.items.map((r) => [r.sessionId, r.value]) : [];
    expect(homeRecords).toEqual(card.view.records.map((r) => [r.sessionId, r.text]));
    const benchId = (await s.progress.exercises())?.view.rows.find((r) => r.name === 'Bench press')?.exerciseId ?? '';
    const detail = (await s.progress.exerciseDetail({ exerciseId: benchId }))?.view;
    expect(detail?.records?.items.filter((r) => october.includes(r.sessionId)).map((r) => [r.sessionId, r.value])).toEqual(homeRecords);
    const ring = (await s.reviews.progress())?.lifts.lifts.find((l) => l.exerciseId === benchId)?.points.filter((p) => p.pb).map((p) => p.sessionId) ?? [];
    for (const id of ring) expect(summaryBests).toContain(id);
    expect(JSON.stringify(card.view)).not.toMatch(/≈|score|recovery|readiness/i);
    // Answered from memory while nothing is written.
    expect(await s.progress.recap()).toBe(card);

    expect((await s.progress.dismissRecap('2026-10')).ok).toBe(true);
    expect(await s.progress.recap()).toBeNull();
    // Stored in Your data (the profile): a force-close keeps it.
    expect((await s.yourData.profile())?.progress?.recapDismissed).toBe('2026-10');
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(await s2.progress.recap()).toBeNull();
    // The same month again writes nothing more.
    expect((await s2.progress.dismissRecap('2026-10')).ok).toBe(true);
    // After the 7th: not shown either way; next month's recap shows again.
    h.clockMs = Date.parse('2026-11-08T09:00:00.000Z');
    expect(await s2.progress.recap()).toBeNull();
  });

  it('no workout last month: no card', async () => {
    const { s, gymId } = await setUp();
    h.clockMs = Date.parse('2026-09-20T17:00:00.000Z');
    await logWorkout(h, s, gymId, [w('Bench press', 70)]);
    h.clockMs = Date.parse('2026-11-02T09:00:00.000Z');
    expect(await s.progress.recap()).toBeNull();
  });
});

describe('screens (source; no React renderer in tests)', () => {
  const src = (p: string) => readFileSync(join(import.meta.dirname, '../src', p), 'utf8');

  it('a PB ring or a point opens its workout on Overview; a chart point, record or best-reps row in Lifts and Exercise detail', () => {
    const charts = src('reviews/charts.tsx');
    expect(charts).toContain('onOpenWorkout(ring.sessionId);');
    expect(charts).toContain('onOpenWorkout(p.sessionId);');
    const tab = src('screens/progress/ExercisesTab.tsx');
    expect(tab).toContain("navigation.navigate('Summary', { sessionId, back: true });");
    expect(tab).toContain('onOpen={openWorkout}');
    expect(src('progress/exercise-line-chart.tsx')).toContain('if (onOpen !== undefined) onOpen(p.sessionId);');
  });

  it('the recap card leads Overview while it shows, reads only while Overview shows, and dismisses with a write', () => {
    const section = src('reviews/ReviewsSection.tsx');
    expect(section).toContain("useScreenData((s) => s.progress.recap(), { enabled: active })");
    expect(section).toContain('services.progress.dismissRecap(recap.month)');
    expect(section.indexOf('{recapCard}')).toBeLessThan(section.indexOf('{showWeek ? ('));
    const card = src('reviews/RecapCard.tsx');
    expect(card).toContain('accessibilityLabel={`Dismiss ${view.title} recap`}');
    // Values only (minimal copy): no explanations, no score.
    expect(card).not.toMatch(/score|great job|keep it up|recovery/i);
  });
});
