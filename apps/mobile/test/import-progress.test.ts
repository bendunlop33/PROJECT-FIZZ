import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ImportDraft } from '../src/import/import-service';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

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

async function importFile(s: AppServices): Promise<string> {
  const opened = await s.imports.open({ name: 'FitNotes_Export_synthetic.csv', text: FILE });
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
  expect(draft.analysis.counts).toMatchObject({ workouts: 6, sets: 23 });
  const r = await s.imports.commit(draft.draftId, draft.mappingVersion, 'import-op');
  if (!r.ok) throw new Error(r.reason);
  expect(r).toMatchObject({ status: 'finished', written: 6 });
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
    expect((await s.progress.home({ days: 30 }))?.view.dataState).toBe('empty');

    await importFile(s);

    const sessions = async (days: 7 | 14 | 30 | 60) => {
      const v = (await s.progress.home({ days, grouping: 'body_part' }))?.view;
      if (v?.dataState !== 'normal') throw new Error(`expected data for ${String(days)} days`);
      return v;
    };
    // 6–12 Oct: 7 and 9 Oct. 29 Sep–12 Oct: + 2 and 5 Oct. 13 Sep–12 Oct: + 21 Sep. 14 Aug–12 Oct: the same five (3 Aug is older).
    expect((await sessions(7)).activity.stats[0]).toEqual({ value: '2', label: 'SESSIONS' });
    expect((await sessions(14)).activity.stats[0]).toEqual({ value: '4', label: 'SESSIONS' });
    expect((await sessions(30)).activity.stats[0]).toEqual({ value: '5', label: 'SESSIONS' });
    const sixty = await sessions(60);
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
    // The session picker groups imports by their FitNotes Category (Decision 1), all startable.
    const picker = await s.sessions.list(gymId);
    const labels = [picker?.upNext, ...(picker?.fromHistory ?? []), ...(picker?.older ?? [])].filter((r) => r !== null && r !== undefined).map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(['Back', 'Chest', 'Legs']));

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
    // 7 FitNotes sets: 3 ramp, 120 × 4 once, then 100 × 6, 6, 5. The top set and back-offs are 4 working sets;
    // the rule holds at the back-off load (not every set at 120, and not 7 sets).
    expect(plan.length).toBe(4);
    for (const [load] of plan) expect(load).toBe(100);
  });

  it('B1, S1: Up next is the longest gap (not the workout just done), and Start from it plans the back-off block', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await importFile(s);
    const past = (await s.history.pastWorkouts()).rows;
    const benchDay = past.find((r) => r.localDate === '2026-10-05')?.sessionId;
    const bench = await exerciseIdOf(s, 'Bench press');
    // Legs (9 Oct) was just done; Back was 7 Oct; Chest (5 Oct) has the longest gap (Decision 2).
    const next = await s.next.preview(gymId);
    expect(next?.sourceSessionId).toBe(benchDay);
    const picker = await s.sessions.list(gymId);
    expect(picker?.upNext).toMatchObject({ label: 'Chest', sourceSessionId: benchDay, target: { kind: 'next' } });
    // One tap: the overview's Start is the same plan.
    const page = await s.overview.load({ target: { kind: 'next' }, gymId });
    if (!page) throw new Error('no overview');
    const r = await s.overview.start({ startOf: page.startOf, gymId, opId: 'start-up-next', checkIn: { kind: 'skipped', atUtc: h.now().utc }, expectedPreviewKey: page.view.previewKey, draft: null });
    if (!r.ok) throw new Error(r.error.message);
    const plan = plannedOf(r.aggregate, bench);
    // 7 FitNotes sets with one at 70 × 4, then 60 × 8 three times: 4 working sets at 60, never 7 × 70.
    expect(plan.length).toBe(4);
    for (const [load] of plan) expect(load).toBe(60);
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

  it('B2: Add exercise after top + back-offs shows them all as Last (FitNotes) and plans that many sets from the back-off load', async () => {
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
    expect(planned).toHaveLength(4);
    for (const p of planned) {
      expect(p.load).toMatchObject({ value: 60, unit: 'kg', convention: 'total' });
      expect(p.provenance?.basis).toMatchObject({ imported: true });
    }
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
});
