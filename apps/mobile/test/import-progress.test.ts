import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ImportDraft } from '../src/import/import-service';
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
 * layout. Today is Mon 12 Oct; the history ends Thu 8 Oct, so short windows
 * legitimately hold only the last few workouts.
 */

const NOW = '2026-10-12T08:00:00.000Z';
const HEADER = 'Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time';
/** Pull days (Lat Pulldown) and push days (bench with a FitNotes-style ramp: lighter sets first, no warm-up flag). */
const FILE = [
  HEADER,
  '2026-08-01,Lat Pulldown,Back,40.0,10,,,',
  '2026-08-01,Lat Pulldown,Back,40.0,10,,,',
  '2026-09-20,Flat Barbell Bench Press,Chest,40.0,10,,,',
  '2026-09-20,Flat Barbell Bench Press,Chest,62.5,6,,,',
  '2026-09-20,Flat Barbell Bench Press,Chest,62.5,6,,,',
  '2026-10-01,Lat Pulldown,Back,45.0,10,,,',
  '2026-10-01,Lat Pulldown,Back,45.0,9,,,',
  '2026-10-06,Flat Barbell Bench Press,Chest,40.0,10,,,',
  '2026-10-06,Flat Barbell Bench Press,Chest,52.5,5,,,',
  '2026-10-06,Flat Barbell Bench Press,Chest,65.0,8,,,',
  '2026-10-06,Flat Barbell Bench Press,Chest,65.0,8,,,',
  '2026-10-06,Flat Barbell Bench Press,Chest,65.0,8,,,',
  '2026-10-08,Lat Pulldown,Back,47.5,10,,,',
  '2026-10-08,Lat Pulldown,Back,47.5,8,,,',
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
  expect(draft.analysis.counts).toMatchObject({ workouts: 5, sets: 14 });
  const r = await s.imports.commit(draft.draftId, draft.mappingVersion, 'import-op');
  if (!r.ok) throw new Error(r.reason);
  expect(r).toMatchObject({ status: 'finished', written: 5 });
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
    // 6–12 Oct: 6 and 8 Oct. 29 Sep–12 Oct: + 1 Oct. 13 Sep–12 Oct: + 20 Sep. 14 Aug–12 Oct: the same four (1 Aug is older).
    expect((await sessions(7)).activity.stats[0]).toEqual({ value: '2', label: 'SESSIONS' });
    expect((await sessions(14)).activity.stats[0]).toEqual({ value: '3', label: 'SESSIONS' });
    expect((await sessions(30)).activity.stats[0]).toEqual({ value: '4', label: 'SESSIONS' });
    const sixty = await sessions(60);
    expect(sixty.activity.stats[0]).toEqual({ value: '4', label: 'SESSIONS' });
    // FitNotes has no times: time in gym is honestly absent, never invented (rule 6).
    expect(JSON.stringify(sixty.activity)).toContain('No times for imported workouts');
    // Muscles: Back from the pulldowns, Chest from the bench.
    const keys = sixty.muscles.rows.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['Back', 'Chest']));

    // Calendar: October has the three imported days.
    const cal = await s.progress.calendar('2026-10');
    const imported = Object.entries(cal?.view.days ?? {}).filter(([, rows]) => rows.some((r) => r.imported));
    expect(imported.map(([d]) => d).sort()).toEqual(['2026-10-01', '2026-10-06', '2026-10-08']);

    // Exercises list and exercise detail: both exercises, with every imported workout as a point.
    const list = (await s.progress.exercises())?.view.rows.map((r) => r.name) ?? [];
    expect(list).toEqual(expect.arrayContaining(['Lat pulldown', 'Bench press']));
    const pulldown = await exerciseIdOf(s, 'Lat pulldown');
    const detail = (await s.progress.exerciseDetail({ exerciseId: pulldown, range: 'all' }))?.view;
    expect(detail?.points).toHaveLength(3);
  });

  it('history, Today and the workout: Past workouts lists them, Up next and the picker start from them, Last and targets come from FitNotes on real equipment', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await importFile(s);

    // Past workouts: every imported workout, tagged as imported.
    const past = await s.history.pastWorkouts();
    expect(past.rows.map((r) => [r.localDate, r.source])).toEqual([
      ['2026-10-08', 'import'],
      ['2026-10-06', 'import'],
      ['2026-10-01', 'import'],
      ['2026-09-20', 'import'],
      ['2026-08-01', 'import'],
    ]);
    // Today: Up next is built from the newest imported workout; the lift highlight is labelled FitNotes.
    const lift = await s.today.liftHighlight();
    expect(lift).toMatchObject({ exerciseName: 'Lat pulldown', imported: true });
    expect(lift?.text).toMatch(/^47\.5/);
    const next = await s.next.preview(gymId);
    expect(next?.sourceSessionId).toBe(past.rows[0]?.sessionId);
    // The session picker groups imports by their FitNotes Category (Decision 1), all startable.
    const picker = await s.sessions.list(gymId);
    const labels = [picker?.upNext, ...(picker?.fromHistory ?? []), ...(picker?.older ?? [])].filter((r) => r !== null && r !== undefined).map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(['Back', 'Chest']));

    // Start next from the newest imported workout (8 Oct pulldowns): the rule's targets from FitNotes, fitted to the gym's stack (rule 4).
    const fromNext = await s.workout.start({ gymId, opId: 'start-next', checkIn: { kind: 'skipped', atUtc: h.now().utc }, nextOf: past.rows[0]?.sessionId ?? '' });
    if (!fromNext.ok) throw new Error(fromNext.error.message);
    const stack = fromNext.aggregate.session.equipmentSnapshot.find((e) => e.id === fromNext.aggregate.exercises[0]?.equipmentId);
    expect(stack?.kind).toBe('weight_stack');
    const nextLoads = fromNext.aggregate.sets.map((x) => x.planned.load);
    expect(nextLoads.length).toBeGreaterThan(0);
    // Held at FitNotes' 47.5 (10 and 8 reps), which this stack can't make: rounded toward easier, never up.
    expect(stack?.kind === 'weight_stack' ? [stack.stackLoads.includes(47.5), stack.stackLoads.includes(45)] : null).toEqual([false, true]);
    for (const l of nextLoads) expect(l).toMatchObject({ value: 45, unit: 'kg', convention: 'stack' });
    const discarded = await s.workout.dispatch(fromNext.aggregate.session.id, { type: 'discard', at: h.now(), opId: 'discard-next', expectedVersion: fromNext.aggregate.session.version, confirmedLoggedSets: 0 });
    expect(discarded.ok).toBe(true);

    // In a workout: Bench press gets `Last (FitNotes, 6 Oct)` from the working sets (the ramp read as warm-ups) and a planned load on real plates.
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
    expect(prev?.sets.map((x) => [x.values.load?.value, x.values.reps])).toEqual([[65, 8], [65, 8], [65, 8]]);
    const planned = loaded?.aggregate.sets.filter((x) => x.sessionExerciseId === row?.id).map((x) => x.planned) ?? [];
    expect(planned.length).toBeGreaterThan(0);
    // Hold at 65 (8 reps is inside the built-in range): never from the 40 kg ramp set, never null.
    for (const p of planned) {
      expect(p.load).toMatchObject({ unit: 'kg', convention: 'total' });
      expect(p.load?.value).toBeGreaterThanOrEqual(65);
      expect(p.provenance?.basis).toMatchObject({ imported: true });
    }
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
    // Four weeks back from 12 Oct: 20 Sep, 1, 6 and 8 Oct.
    expect(overview).toMatchObject({ status: 'ok', data: { workouts: 4 } });
    expect(history?.data).toMatchObject({ exercise: 'Lat pulldown', totalSessions: 3 });
    expect(JSON.stringify(history?.data)).toContain('FitNotes import');
    expect(targets?.data).toMatchObject({ exercise: 'Lat pulldown', label: 'built-in rule (fallback), for comparison' });
    expect(targets?.data.not_available).toBeUndefined();
  });
});
