import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRequest } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';

import { starterChips } from '../src/coach/sheet-view';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Backlog §4.3 item 1: the coach reads past training, gym equipment and the
 * built-in rule's targets through the app's local store, and Today offers
 * `How am I doing?`. Real SQLite, scripted model; the plan route is not
 * involved (spike S3 still has to pass on the iPhone).
 */

let h: Harness;
let model: StepModel;
let connection: TextCoachState;
beforeEach(() => {
  model = new StepModel([]);
  connection = CONNECTED;
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(connection) } });
});
afterEach(async () => {
  await h.cleanup();
});

/** Every tool output the model was sent, parsed. */
function outputs(): Record<string, unknown>[] {
  const last = model.requests.at(-1);
  return (last?.input ?? []).flatMap((i) => (i.type === 'function_call_output' ? [JSON.parse(i.output) as Record<string, unknown>] : []));
}

function contextOf(req: ModelRequest, label: string): string {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith(label));
  return block?.type === 'message' ? block.content : '';
}

async function twoBenchWorkouts() {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
  h.clockMs += 3 * 86_400_000;
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 8 }, { load: 62.5, reps: 7, rpe: 9 }] }]);
  h.clockMs += 86_400_000;
  const bench = (await s.workout.recentExerciseIds(8))[0] ?? '';
  return { s, gymId, bench };
}

describe('How am I doing? (Today)', () => {
  it('the chip is Ben’s own words; the coach reads the overview from local workouts; nothing is written', async () => {
    const { s } = await twoBenchWorkouts();
    const chip = starterChips({ kind: 'today' }, await s.coach.availability(), false).find((c) => c.label === 'How am I doing?');
    expect(chip?.label).toBe('How am I doing?');
    if (!chip?.input) throw new Error('no chip');
    model = new StepModel([() => toolCall('get_training_overview', { weeks: 4 }), () => replyWith('Two bench sessions; 60 to 62.5 kg.')]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: chip.input, turnId: h.ids() });
    expect(r.status).toBe('completed');
    // Your data and Coaching knowledge stay separate blocks (rule 10); history is no longer "not available".
    const first = model.requests[0];
    if (!first) throw new Error('no request');
    expect(contextOf(first, 'NOT AVAILABLE')).not.toContain('Training history before this workout');
    expect(contextOf(first, 'COACHING KNOWLEDGE')).not.toContain('Bench press');
    const [overview] = outputs();
    expect(overview).toMatchObject({ status: 'ok', data: { domain: 'Your data', workouts: 2, trends: [{ exercise: 'Bench press', trend: 'up', workouts: 2 }] } });
    expect(r.cards).toEqual([]);
    const described = await s.coach.describe({ kind: 'today' }, null);
    expect(described.yourData.map((d) => d.label)).toContain('Past workouts and gym equipment');
    expect(described.coachingKnowledge.map((d) => d.label).join(' ')).not.toMatch(/workouts/);
  });
});

describe('past training, equipment and built-in targets for one exercise', () => {
  it('history lists the sets as logged; equipment gives real loads; the built-in rule is labelled a comparison', async () => {
    const { s, bench } = await twoBenchWorkouts();
    model = new StepModel([
      () => toolCall('get_recent_training', { exerciseId: bench, sessions: 5 }),
      () => toolCall('get_gym_equipment', { exerciseId: bench }),
      () => toolCall('get_progression_targets', { exerciseId: bench }),
      () => replyWith('Hold 62.5 until all sets hit 8.'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'How is bench going?', spoken: false }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    const [history, equipment, targets] = outputs() as { data: Record<string, unknown> }[];
    expect(history?.data).toMatchObject({ domain: 'Your data', exercise: 'Bench press', totalSessions: 2 });
    const sessions = (history?.data.sessions ?? []) as { sets: { reps: number; load: { value: number; unit: string; convention: string } }[] }[];
    expect(sessions[0]?.sets.map((x) => [x.load.value, x.load.unit, x.reps])).toEqual([
      [62.5, 'kg', 8],
      [62.5, 'kg', 7],
    ]);
    expect(equipment?.data).toMatchObject({ domain: 'Your data', gym: 'Main Gym', exercise: 'Bench press' });
    const items = (equipment?.data.items ?? []) as { convention: string; max: number | null }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.max !== null)).toBe(true);
    expect(targets?.data).toMatchObject({ domain: 'Your data', label: 'built-in rule (fallback), for comparison', exercise: 'Bench press' });
    // Target RPE as the next workout would plan it (merge with target RPE): the built-in rule's for each working set, none on warm-ups.
    const targetSets = (targets?.data.sets ?? []) as { type: string; target: string; rpe: number | null }[];
    const working = targetSets.filter((x) => x.type === 'working');
    expect(working.length).toBeGreaterThan(0);
    for (const x of working) {
      expect(typeof x.rpe).toBe('number');
      expect(x.target).toMatch(new RegExp(`@ RPE ${String(x.rpe)}$`));
    }
    for (const x of targetSets.filter((t) => t.type === 'warmup' || t.type === 'drop')) expect(x.rpe).toBeNull();
    // Review S3: last time's reps (8, 7: the lower median), the planned count and the Why? reason, as the builder reads them.
    expect(targets?.data.lastReps).toBe(7);
    expect(typeof targets?.data.plannedReps).toBe('number');
    expect((targets?.data.why as string[]).length).toBeGreaterThan(0);
    expect(r.toolLog.map((l) => l.text)).toEqual(['Read your history', 'Read your gym’s equipment', 'Read next targets']);
  });

  it('a pain flag shows on the built-in targets; an exercise never done reads as not available', async () => {
    const { s, bench } = await twoBenchWorkouts();
    const flagged = await s.pain.flagMovement({ exerciseId: bench, exerciseName: 'Bench press', opId: h.ids() });
    expect(flagged.ok).toBe(true);
    model = new StepModel([() => toolCall('get_progression_targets', { exerciseId: bench }), () => toolCall('get_recent_training', { exerciseId: '00000000-0000-4000-8000-000000009999', sessions: 3 }), () => replyWith('Bench stays put while it hurts.')]);
    await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'What about bench next time?', spoken: false }, turnId: h.ids() });
    const [targets, missing] = outputs() as { data: Record<string, unknown> }[];
    expect(targets?.data.painFlag).toBe('pain flag on: no increases');
    expect(missing?.data).toEqual({ domain: 'Your data', not_available: 'no workouts with that exercise' });
  });
});

describe('Coach v3 history reads (ADR 0027): records, recent workouts, another gym by name', () => {
  it('records carry the e1RM labelled an estimate; recent workouts list sets as logged; the hotel gym reads by name with a summary', async () => {
    const { s, bench } = await twoBenchWorkouts();
    await s.setup.saveGym({ gymId: h.ids(), name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') });
    model = new StepModel([
      () => toolCall('get_exercise_records', { exerciseId: bench }),
      () => toolCall('get_recent_sessions', { count: 1 }),
      () => toolCall('get_gym_equipment', { exerciseId: null, gymName: 'hotel gym' }),
      () => toolCall('get_gym_equipment', { exerciseId: null, gymName: 'Moon gym' }),
      () => replyWith('Bench is moving.'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'What is my best bench?', spoken: false }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    const [records, recent, hotel, moon] = outputs() as { data: Record<string, unknown> }[];
    const line = (records?.data.records as { heaviest: { load: { value: number } }; bestE1rm: { label: string; text: string; value: number } | null }[])[0];
    expect(line?.heaviest.load.value).toBe(62.5);
    // 62.5 × (1 + 8/30) = 79.17 → 79 (0.5 kg display rounding); always an estimate.
    expect(line?.bestE1rm?.value).toBe(79);
    expect(line?.bestE1rm?.label).toMatch(/estimate, not a tested max/);
    expect(line?.bestE1rm?.text).toMatch(/^≈ 79\skg \(est\.\)$/u);
    const sessions = recent?.data.sessions as { exercises: { name: string; sets: string[] }[] }[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.exercises[0]?.name).toBe('Bench press');
    expect(sessions[0]?.exercises[0]?.sets.map((x) => x.replace(/\u00a0/g, ' '))).toEqual(['62.5 kg × 8', '62.5 kg × 7 @ RPE 9']);
    expect(hotel?.data).toMatchObject({ gym: 'Hotel gym', exercise: null });
    expect((hotel?.data.summary as string[]).some((l) => / each$/.test(l))).toBe(true);
    expect(hotel?.data.savedGyms).toEqual(expect.arrayContaining(['Main Gym', 'Hotel gym']));
    expect(moon?.data).toEqual({ domain: 'Your data', not_available: 'no saved gym by that name, or no such exercise' });
    expect(r.toolLog.map((l) => l.text)).toEqual(['Read your records', 'Read your recent workouts', 'Read your gym’s equipment', 'Read your gym’s equipment']);
  });
});
