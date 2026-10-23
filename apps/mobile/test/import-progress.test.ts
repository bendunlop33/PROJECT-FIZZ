import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ImportDraft } from '../src/import/import-service';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Imported FitNotes history feeds everything that reads history (Ben,
 * 12 Oct 2026: "The imported data doesn't show up in progressions etc").
 * B7 (approved 11 Oct 2026): FitNotes history counts as `Last (FitNotes,
 * date)` and for targets, labelled, with every load fitted to the gym's
 * real equipment (rule 4), and imported workouts are repeatable.
 *
 * The file is synthetic: invented dates and numbers in the FitNotes Android
 * layout, in the shapes FitNotes history really has (review import-progress
 * B1, B2): a leading ramp, and a ramp to one top set followed by back-offs.
 * Today is Mon 12 Oct; the history ends Fri 9 Oct, so short windows
 * legitimately hold only the last few workouts.
 */

const NOW = '2026-10-12T08:00:00.000Z';
const HEADER = 'Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time';
/** Pull days (Lat Pulldown), push days (bench) and one leg day (squat). No warm-up flag in FitNotes. */
const FILE = [
  HEADER,
  '2026-08-03,Lat Pulldown,Back,40.0,10,,,',
  '2026-08-03,Lat Pulldown,Back,40.0,10,,,',
  // A leading ramp: one lighter set, then the working sets.
  '2026-09-21,Flat Barbell Bench Press,Chest,40.0,10,,,',
  '2026-09-21,Flat Barbell Bench Press,Chest,62.5,6,,,',
  '2026-09-21,Flat Barbell Bench Press,Chest,62.5,6,,,',
  '2026-10-02,Lat Pulldown,Back,45.0,10,,,',
  '2026-10-02,Lat Pulldown,Back,45.0,9,,,',
  // Ramp, one top set, then back-offs: 7 sets, 1 at the top load.
  '2026-10-05,Flat Barbell Bench Press,Chest,40.0,10,,,',
  '2026-10-05,Flat Barbell Bench Press,Chest,50.0,5,,,',
  '2026-10-05,Flat Barbell Bench Press,Chest,60.0,3,,,',
  '2026-10-05,Flat Barbell Bench Press,Chest,70.0,4,,,',
  '2026-10-05,Flat Barbell Bench Press,Chest,60.0,8,,,',
  '2026-10-05,Flat Barbell Bench Press,Chest,60.0,8,,,',
  '2026-10-05,Flat Barbell Bench Press,Chest,60.0,8,,,',
  '2026-10-07,Lat Pulldown,Back,47.5,10,,,',
  '2026-10-07,Lat Pulldown,Back,47.5,8,,,',
  // The newest workout: the same shape on squat.
  '2026-10-09,Barbell Squat,Legs,60.0,5,,,',
  '2026-10-09,Barbell Squat,Legs,80.0,3,,,',
  '2026-10-09,Barbell Squat,Legs,100.0,2,,,',
  '2026-10-09,Barbell Squat,Legs,120.0,4,,,',
  '2026-10-09,Barbell Squat,Legs,100.0,6,,,',
  '2026-10-09,Barbell Squat,Legs,100.0,6,,,',
  '2026-10-09,Barbell Squat,Legs,100.0,5,,,',
].join('\n');

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness(NOW, { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function importFile(s: AppServices, text = FILE, counts = { workouts: 6, sets: 23 }): Promise<string> {
  const opened = await s.imports.open({ name: 'FitNotes_Export_synthetic.csv', text });
  if (opened.kind !== 'preview') throw new Error(`expected a preview, got ${opened.kind}`);
  let draft: ImportDraft = opened.draft;
  const step = async (change: Parameters<AppServices['imports']['answer']>[2]) => {
    const r = await s.imports.answer(draft.draftId, draft.mappingVersion, change);
    if (!r.ok) throw new Error(r.reason);
    draft = r.draft;
  };
  for (const n of draft.analysis.names.filter((x) => x.needsAnswer)) if (n.match.exerciseId) await step({ kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId } });
  if (draft.analysis.total?.open) await step({ kind: 'total', answer: 'total' });
  if (draft.analysis.perHand?.open) await step({ kind: 'per_hand', answer: 'each' });
  expect(draft.analysis.counts).toMatchObject(counts);
  const r = await s.imports.commit(draft.draftId, draft.mappingVersion, 'import-op');
  if (!r.ok) throw new Error(r.reason);
  expect(r).toMatchObject({ status: 'finished', written: counts.workouts });
  return r.jobId;
}

async function exerciseIdOf(s: AppServices, name: string): Promise<string> {
  const id = (await s.coachingKnowledge.exercises()).find((e) => e.name === name)?.id;
  if (!id) throw new Error(`no ${name}`);
  return id;
}

describe('imported FitNotes history feeds Progress, history, targets and the coach', () => {
  it('Progress: sessions per window, time in gym, muscles, calendar, exercises and exercise detail, fresh right after the commit', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    // Read (and cache) Progress before the import: nothing yet.
    await s.progress.prewarm();
    expect((await s.progress.home({ period: '1m' }))?.view.dataState).toBe('empty');

    await importFile(s);

    const sessions = async (range: { from: string; to: string }) => {
      const v = (await s.progress.home({ range, grouping: 'body_part' }))?.view;
      if (v?.dataState !== 'normal') throw new Error(`expected data for ${range.from}–${range.to}`);
      return v;
    };
    // 6–12 Oct: 7 and 9 Oct. 29 Sep–12 Oct: + 2 and 5 Oct. 13 Sep–12 Oct: + 21 Sep. 14 Aug–12 Oct: the same five (3 Aug is older).
    expect((await sessions({ from: '2026-10-06', to: '2026-10-12' })).activity.stats[0]).toEqual({ value: '2', label: 'SESSIONS' });
    expect((await sessions({ from: '2026-09-29', to: '2026-10-12' })).activity.stats[0]).toEqual({ value: '4', label: 'SESSIONS' });
    expect((await sessions({ from: '2026-09-13', to: '2026-10-12' })).activity.stats[0]).toEqual({ value: '5', label: 'SESSIONS' });
    const sixty = await sessions({ from: '2026-08-14', to: '2026-10-12' });
    expect(sixty.activity.stats[0]).toEqual({ value: '5', label: 'SESSIONS' });
    // FitNotes has no times: time in gym is honestly absent, never invented (rule 6).
    expect(JSON.stringify(sixty.activity)).toContain('No times for imported workouts');
    // Muscles: Back from the pulldowns, Chest from the bench.
    const keys = sixty.muscles.rows.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['Back', 'Chest']));

    // Calendar: October has the four imported days.
    const cal = await s.progress.calendar('2026-10');
    const imported = Object.entries(cal?.view.days ?? {}).filter(([, rows]) => rows.some((r) => r.imported));
    expect(imported.map(([d]) => d).sort()).toEqual(['2026-10-02', '2026-10-05', '2026-10-07', '2026-10-09']);

    // Exercises list and exercise detail: every exercise, with every imported workout as a point.
    const list = (await s.progress.exercises())?.view.rows.map((r) => r.name) ?? [];
    expect(list).toEqual(expect.arrayContaining(['Lat pulldown', 'Bench press']));
    const pulldown = await exerciseIdOf(s, 'Lat pulldown');
    const detail = (await s.progress.exerciseDetail({ exerciseId: pulldown, range: 'all' }))?.view;
    expect(detail?.points).toHaveLength(3);
  });

  it('history and Today: Past workouts lists them, the lift highlight is labelled, and Start next fits FitNotes loads to the stack', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await importFile(s);

    // Past workouts: every imported workout, tagged as imported.
    const past = await s.history.pastWorkouts();
    expect(past.rows.map((r) => [r.localDate, r.source])).toEqual([
      ['2026-10-09', 'import'],
      ['2026-10-07', 'import'],
      ['2026-10-05', 'import'],
      ['2026-10-02', 'import'],
      ['2026-09-21', 'import'],
      ['2026-08-03', 'import'],
    ]);
    const [squatDay, pullDay] = past.rows.map((r) => r.sessionId);
    // Today: the lift highlight is the newest workout's top set, labelled FitNotes.
    const lift = await s.today.liftHighlight();
    expect(lift).toMatchObject({ imported: true });
    expect(lift?.text).toMatch(/^120/);
    expect(squatDay).toBeDefined();
    // The session picker groups unnamed imports by the title the overview gives them (Decision 1, F20), all startable.
    const picker = await s.sessions.list(gymId);
    const labels = [picker?.upNext, ...(picker?.fromHistory ?? []), ...(picker?.older ?? [])].filter((r) => r !== null && r !== undefined).map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(['Pull', 'Push', 'Legs']));

    // Start next from the pull workout (7 Oct pulldowns, 2 sets): the rule's targets from FitNotes, fitted to the stack (rule 4).
    const fromNext = await s.workout.start({ gymId, opId: 'start-next', checkIn: { kind: 'skipped', atUtc: h.now().utc }, nextOf: pullDay ?? '' });
    if (!fromNext.ok) throw new Error(fromNext.error.message);
    const stack = fromNext.aggregate.session.equipmentSnapshot.find((e) => e.id === fromNext.aggregate.exercises[0]?.equipmentId);
    expect(stack?.kind).toBe('weight_stack');
    const nextLoads = fromNext.aggregate.sets.map((x) => x.planned.load);
    // Two sets done, two planned: the default never adds sets FitNotes didn't have.
    expect(nextLoads).toHaveLength(2);
    // Held at FitNotes' 47.5 (10 and 8 reps), which this stack can't make: rounded toward easier, never up.
    expect(stack?.kind === 'weight_stack' ? [stack.stackLoads.includes(47.5), stack.stackLoads.includes(45)] : null).toEqual([false, true]);
    for (const l of nextLoads) expect(l).toMatchObject({ value: 45, unit: 'kg', convention: 'stack' });
  });

  /** The working sets of one exercise in a started or previewed workout, as [load, reps min–max]. */
  const plannedOf = (a: SessionAggregate, exerciseId: string) => {
    const row = a.exercises.find((e) => e.exerciseId === exerciseId);
    return a.sets
      .filter((x) => x.sessionExerciseId === row?.id && x.setType !== 'warmup')
      .sort((x, y) => x.index - y.index)
      .map((x) => [x.planned.load?.value ?? null, x.planned.reps === null ? null : `${String(x.planned.reps.min)}–${String(x.planned.reps.max)}`]);
  };

  it('B1: Start next from a ramp, a top single and back-offs plans the back-off block, never every set at the top load', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await importFile(s);
    const [squatDay] = (await s.history.pastWorkouts()).rows.map((r) => r.sessionId);
    const squat = (await s.workout.load(squatDay ?? ''))?.aggregate.exercises[0]?.exerciseId ?? '';
    const started = await s.workout.start({ gymId, opId: 'start-squat', checkIn: { kind: 'skipped', atUtc: h.now().utc }, nextOf: squatDay ?? '' });
    if (!started.ok) throw new Error(started.error.message);
    const plan = plannedOf(started.aggregate, squat);
    // 7 FitNotes sets: 3 ramp, 120 × 4 once, then 100 × 6, 6, 5. The back-offs are the 3 judged working sets
    // and the top set is context (r3 S1); the rule holds at the back-off load (not every set at 120, and not 7 sets).
    expect(plan.length).toBe(3);
    for (const [load] of plan) expect(load).toBe(100);
  });

  it('B1, S1: Up next is the longest gap (not the workout just done), and Start from it plans the back-off block', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await importFile(s);
    const past = (await s.history.pastWorkouts()).rows;
    const benchDay = past.find((r) => r.localDate === '2026-10-05')?.sessionId;
    const bench = await exerciseIdOf(s, 'Bench press');
    // Legs (9 Oct) was just done; Pull was 7 Oct; Push (5 Oct) has the longest gap (Decision 2).
    const next = await s.next.preview(gymId);
    expect(next?.sourceSessionId).toBe(benchDay);
    const picker = await s.sessions.list(gymId);
    expect(picker?.upNext).toMatchObject({ label: 'Push', sourceSessionId: benchDay, target: { kind: 'next' } });
    // One tap: the overview's Start is the same plan.
    const page = await s.overview.load({ target: { kind: 'next' }, gymId });
    if (!page) throw new Error('no overview');
    const r = await s.overview.start({ startOf: page.startOf, gymId, opId: 'start-up-next', checkIn: { kind: 'skipped', atUtc: h.now().utc }, expectedPreviewKey: page.view.previewKey, draft: null });
    if (!r.ok) throw new Error(r.error.message);
    const plan = plannedOf(r.aggregate, bench);
    // 7 FitNotes sets with one at 70 × 4, then 60 × 8 three times: 3 judged working sets (r3 S1), never 7 × 70. Every set
    // at 60 reached the top of bench's 3–6 range; the heavier 70 × 4 is context, not judged at 60 (r2 B1): one step up from 60.
    expect(plan.length).toBe(3);
    for (const [load] of plan) expect(load).toBe(62.5);
  });

  it('B1: Repeat of a FitNotes workout is the workout as done, ramp included, each set at its own load (fitted)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await importFile(s);
    const [squatDay] = (await s.history.pastWorkouts()).rows.map((r) => r.sessionId);
    const squat = (await s.workout.load(squatDay ?? ''))?.aggregate.exercises[0]?.exerciseId ?? '';
    const repeated = await s.workout.start({ gymId, opId: 'repeat-squat', checkIn: { kind: 'skipped', atUtc: h.now().utc }, repeatOf: squatDay ?? '' });
    if (!repeated.ok) throw new Error(repeated.error.message);
    expect(plannedOf(repeated.aggregate, squat).map(([load]) => load)).toEqual([60, 80, 100, 120, 100, 100, 100]);
  });

  it('B2: Add exercise after top + back-offs shows them all as Last (FitNotes) and plans the back-offs (r3 S1), progressed from the back-off load', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await importFile(s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sid = started.aggregate.session.id;
    const bench = await exerciseIdOf(s, 'Bench press');
    const barbell = (await s.workout.pickerExercises(sid, 'Bench press')).find((p) => p.exercise.id === bench)?.equipment[0];
    const added = await s.workout.addExercise({ sessionId: sid, exerciseId: bench, equipmentId: barbell?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
    const loaded = await s.workout.load(sid);
    const row = loaded?.aggregate.exercises.find((e) => e.exerciseId === bench);
    const prev = row ? loaded?.previous[row.id] : null;
    expect(prev).toMatchObject({ imported: true });
    // The ramp (40, 50, 60 × 3) is left out; the top set and the back-offs are Ben's working sets.
    expect(prev?.sets.map((x) => [x.values.load?.value, x.values.reps])).toEqual([[70, 4], [60, 8], [60, 8], [60, 8]]);
    const planned = loaded?.aggregate.sets.filter((x) => x.sessionExerciseId === row?.id).map((x) => x.planned) ?? [];
    expect(planned).toHaveLength(3);
    for (const p of planned) {
      // From the back-off load: 60 × 8 on every back-off is past the top of 3–6, so one step up (r2 B1).
      expect(p.load).toMatchObject({ value: 62.5, unit: 'kg', convention: 'total' });
      expect(p.provenance?.basis).toMatchObject({ imported: true });
    }
  });

  it("r2 S1: Why? on Start next from FitNotes never says 'Not checked' once a set is fitted to a real item", async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await importFile(s);
    const past = (await s.history.pastWorkouts()).rows;
    for (const date of ['2026-10-07', '2026-10-05']) {
      const sourceId = past.find((r) => r.localDate === date)?.sessionId ?? '';
      const started = await s.workout.start({ gymId, opId: `start-why-${date}`, checkIn: { kind: 'skipped', atUtc: h.now().utc }, nextOf: sourceId });
      if (!started.ok) throw new Error(started.error.message);
      const sid = started.aggregate.session.id;
      const sets = started.aggregate.sets.filter((x) => x.planned.load !== null);
      expect(sets.length).toBeGreaterThan(0);
      for (const set of sets) {
        expect(started.aggregate.exercises.find((e) => e.id === set.sessionExerciseId)?.equipmentId).not.toBeNull();
        const why = JSON.stringify(await s.workout.explainTarget(sid, set.id));
        expect(why).not.toContain('Not checked');
        // Pulldown (7 Oct): FitNotes' 47.5 rounded to the stack's 45, and Why? says so. Bench (5 Oct): 62.5 is exact, no note.
        if (date === '2026-10-07') expect(why).toMatch(/Rounded to 45\skg\sstack/);
        else {
          expect(why).not.toMatch(/Rounded/);
          // 18 Oct: Why? is one short line per row; the rule's facts stay in the stored provenance.
          const stored = JSON.stringify(set.planned.provenance);
          expect(stored).toContain('1 heavier top set was kept as context; reps were judged on the 3 sets at 60 kg');
          expect(stored).toContain('all 3 judged sets reached 6+ reps at 60 kg');
        }
      }
      const fin = await s.workout.dispatch(sid, { type: 'discard', at: h.now(), opId: h.ids(), expectedVersion: started.aggregate.session.version, confirmedLoggedSets: 0 });
      if (!fin.ok) throw new Error(fin.error.message);
    }
  });

  it('r2 S2: Up next when the newest workout is an in-app routine session whose routine is gone: the longest gap, not that session', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await importFile(s);
    // Today (12 Oct) in the app: a pull workout saved as a routine in the rotation, then deleted.
    const today = await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 50, reps: 10 }, { load: 50, reps: 10 }] }]);
    const saved = await s.routines.saveFromSession({ sessionId: today, name: 'Row day', opId: 'save-row', addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    const gone = await s.routines.remove({ routineId: saved.routine.id, expectedVersion: saved.routine.version, opId: 'remove-row' });
    expect(gone.ok).toBe(true);
    const past = (await s.history.pastWorkouts()).rows;
    expect(past[0]?.sessionId).toBe(today);
    const benchDay = past.find((r) => r.localDate === '2026-10-05')?.sessionId;
    // D19's fallback would be today's workout; Decision 2 picks Chest (5 Oct), the longest gap.
    expect((await s.next.preview(gymId))?.sourceSessionId).toBe(benchDay);
    expect((await s.sessions.list(gymId))?.upNext).toMatchObject({ sourceSessionId: benchDay, target: { kind: 'next' } });
    const page = await s.overview.load({ target: { kind: 'next' }, gymId });
    if (!page) throw new Error('no overview');
    const r = await s.overview.start({ startOf: page.startOf, gymId, opId: 'start-up-next-gone', checkIn: { kind: 'skipped', atUtc: h.now().utc }, expectedPreviewKey: page.view.previewKey, draft: null });
    if (!r.ok) throw new Error(r.error.message);
    const bench = await exerciseIdOf(s, 'Bench press');
    const plan = plannedOf(r.aggregate, bench);
    expect(plan.length).toBe(3);
    for (const [load] of plan) expect(load).toBe(62.5);
  });

  it('S2: pain mentioned from Today offers the movements of the last workout, FitNotes included', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    await importFile(s);
    const [squatDay] = (await s.history.pastWorkouts()).rows.map((r) => r.sessionId);
    const squat = (await s.workout.load(squatDay ?? ''))?.aggregate.exercises[0];
    const r = await s.coach.painChoices({ kind: 'today' }, 'my knee hurts');
    expect(r.choices).toEqual([{ exerciseId: squat?.exerciseId, name: squat?.exerciseName }]);
  });

  it('the coach reads imported history and gets built-in targets from it', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    await importFile(s);
    const pulldown = await exerciseIdOf(s, 'Lat pulldown');
    model = new StepModel([
      () => toolCall('get_training_overview', { weeks: 4 }),
      () => toolCall('get_recent_training', { exerciseId: pulldown, sessions: 5 }),
      () => toolCall('get_progression_targets', { exerciseId: pulldown }),
      () => replyWith('Pulldown is moving up.'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'How is my pulldown going?', spoken: false }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    const last = model.requests.at(-1);
    const [overview, history, targets] = (last?.input ?? []).flatMap((i) => (i.type === 'function_call_output' ? [JSON.parse(i.output) as { status: string; data: Record<string, unknown> }] : []));
    // Four weeks back from 12 Oct: 21 Sep, 2, 5, 7 and 9 Oct.
    expect(overview).toMatchObject({ status: 'ok', data: { workouts: 5 } });
    expect(history?.data).toMatchObject({ exercise: 'Lat pulldown', totalSessions: 3 });
    expect(JSON.stringify(history?.data)).toContain('FitNotes import');
    expect(targets?.data).toMatchObject({ exercise: 'Lat pulldown', label: 'built-in rule (fallback), for comparison' });
    expect(targets?.data.not_available).toBeUndefined();
  });

  describe('r3 B1: working sets then a lighter finisher', () => {
    const finisherFile = (rows: readonly [string, number, number][]) =>
      [HEADER, ...rows.map(([d, kg, reps]) => `${d},Flat Barbell Bench Press,Chest,${kg.toFixed(1)},${String(reps)},,,`)].join('\n');

    it('Start next increases from the working load, not the finisher, and plans the working sets', async () => {
      const { services: s } = await h.launch();
      const gymId = await setUpGym(h, s);
      // A ramp, 3 working sets at the top of bench's 3–6 range, then a lighter finisher.
      await importFile(s, finisherFile([['2026-10-05', 40, 10], ['2026-10-05', 60, 6], ['2026-10-05', 60, 6], ['2026-10-05', 60, 6], ['2026-10-05', 40, 12]]), { workouts: 1, sets: 5 });
      const [day] = (await s.history.pastWorkouts()).rows.map((r) => r.sessionId);
      const bench = await exerciseIdOf(s, 'Bench press');
      const started = await s.workout.start({ gymId, opId: 'start-finisher', checkIn: { kind: 'skipped', atUtc: h.now().utc }, nextOf: day ?? '' });
      if (!started.ok) throw new Error(started.error.message);
      const plan = plannedOf(started.aggregate, bench);
      expect(plan.length).toBe(3);
      for (const [load] of plan) expect(load).toBe(62.5);
      const set = started.aggregate.sets.find((x) => x.planned.load !== null);
      // 18 Oct: Why? is brief; the rule's facts stay in the stored provenance.
      const why = JSON.stringify(set?.planned.provenance);
      expect(why).toContain('1 lighter set than 60 kg (a finisher or drop set) was not judged');
      expect(why).toContain('all 3 judged sets reached 6+ reps at 60 kg');
    });

    it('a miss at the working load twice, each followed by a finisher in range: Start next holds the working load (Ben, 23 Oct: a reset waits for Apply)', async () => {
      const { services: s } = await h.launch();
      const gymId = await setUpGym(h, s);
      const rows: [string, number, number][] = [];
      for (const d of ['2026-10-02', '2026-10-05']) rows.push([d, 60, 2], [d, 60, 2], [d, 60, 2], [d, 40, 6]);
      await importFile(s, finisherFile(rows), { workouts: 2, sets: 8 });
      const [day] = (await s.history.pastWorkouts()).rows.map((r) => r.sessionId);
      const bench = await exerciseIdOf(s, 'Bench press');
      const started = await s.workout.start({ gymId, opId: 'start-finisher-miss', checkIn: { kind: 'skipped', atUtc: h.now().utc }, nextOf: day ?? '' });
      if (!started.ok) throw new Error(started.error.message);
      const plan = plannedOf(started.aggregate, bench);
      expect(plan.length).toBe(3);
      // Read from the working load (60), never the finisher (40); the rule's reset is only offered (Ben, 23 Oct).
      for (const [load] of plan) expect(load).toBe(60);
      const set = started.aggregate.sets.find((x) => x.planned.load !== null);
      const why = JSON.stringify(set?.planned.provenance);
      expect(why).toContain('2 sessions in a row fell below 3 reps at 60 kg');
    });
  });
});
