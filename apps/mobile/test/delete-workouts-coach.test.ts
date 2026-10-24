import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { COACH_INSTRUCTIONS } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';
import type { WorkoutSet } from '@fizz/schemas';

import { seesLabel } from '../src/coach/sheet-view';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Deleting a workout the coach has worked from (delete-workouts §3.2, §5;
 * review S6): coach next-session targets (DW13, DW14), a coach write citing
 * a workout deleted meanwhile (DW16), pain flags (DW17), the coach chip
 * and decline (DW16, DW33), and a purge of a workout with targets and a
 * coach note (ADR 0024 keeps them; review S7 waits on Ben).
 */

class StepModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: ((req: ModelRequest) => ModelEvent[] | Promise<ModelEvent[]>)[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1];
    const events = step === undefined ? [{ type: 'error' as const, error: 'unavailable' as const }] : await step(request);
    for (const e of events) {
      await Promise.resolve();
      yield e;
    }
  }
}

function yourData(req: ModelRequest): { workout: { sessionId: string; version: number; exercises: { exerciseId: string }[] } } {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as ReturnType<typeof yourData>;
}

const call = (name: string, args: unknown): ModelEvent[] => [{ type: 'tool_call', callId: `c-${name}`, name, arguments: JSON.stringify(args) }, { type: 'completed' }];
const reply = (message: string): ModelEvent[] => call('reply', { message, offer: null });
const benchTarget = (req: ModelRequest) => {
  const w = yourData(req).workout;
  return call('set_next_session_targets', {
    sourceSessionId: w.sessionId,
    sourceVersion: w.version,
    targets: [{ exerciseId: w.exercises[0]?.exerciseId, target: { load: { value: 57.5, unit: 'kg', convention: 'total' }, reps: null }, sets: null, reason: 'Every set was RPE 10.' }],
  });
};

const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };
const DAY = 86_400_000;

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-10T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

type Services = Awaited<ReturnType<Harness['launch']>>['services'];

/** Push A logged at RPE 10, saved as a routine, and the coach's 57.5 kg bench target saved from its summary. */
async function coachTargetFrom(s: Services, gymId: string) {
  const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 7, rpe: 10 }] }]);
  const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1' });
  if (!saved.ok) throw new Error(saved.message);
  model = new StepModel([benchTarget, () => reply('Both sets were RPE 10.')]);
  expect((await s.coach.runSummaryTurn(first))?.status).toBe('completed');
  expect((await s.coach.nextTargets(first)).map((r) => r.status)).toEqual(['saved']);
  return { first, routineId: saved.routine.id };
}

async function deleteOne(s: Services, sessionId: string, opId: string) {
  const row = await s.repeat.describeById(sessionId);
  if (!row) throw new Error('no row');
  const out = await s.history.deleteWorkouts([{ sessionId, expectedVersion: row.version }], opId);
  if (!out.ok) throw new Error(out.message);
  return out.refs.map((r) => ({ sessionId: r.sessionId, expectedVersion: r.version }));
}

const coachPlanned = (sets: readonly WorkoutSet[]) =>
  sets.filter((x) => x.setType !== 'warmup').every((x) => x.planned.source === 'coach' && x.planned.load?.value === 57.5);

describe('coach next-session targets and a deleted source (DW13, DW14)', () => {
  it('DW13: suspended while the workout is deleted; back after Restore when the routine hasn’t been started since', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { first, routineId } = await coachTargetFrom(s, gymId);
    const undo = await deleteOne(s, first, 'del-1');
    h.clockMs += DAY;
    const whileDeleted = await s.workout.start({ gymId, opId: 'start-deleted', checkIn: null, routineOf: routineId });
    if (!whileDeleted.ok) throw new Error(whileDeleted.error.message);
    expect(coachPlanned(whileDeleted.aggregate.sets)).toBe(false);
    // Nothing was logged: discarding it gives the routine back unstarted.
    const d = await s.workout.dispatch(whileDeleted.aggregate.session.id, { type: 'discard', at: h.now(), opId: 'discard-1', expectedVersion: whileDeleted.aggregate.session.version, confirmedLoggedSets: 0 });
    expect(d.ok).toBe(true);

    expect((await s.history.restoreWorkouts(undo, 'restore-1')).ok).toBe(true);
    const afterRestore = await s.workout.start({ gymId, opId: 'start-restored', checkIn: null, routineOf: routineId });
    if (!afterRestore.ok) throw new Error(afterRestore.error.message);
    expect(coachPlanned(afterRestore.aggregate.sets)).toBe(true);
  });

  it('DW13: a routine started (and finished) while it was deleted keeps the coach’s targets as history after Restore', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { first, routineId } = await coachTargetFrom(s, gymId);
    const undo = await deleteOne(s, first, 'del-1');
    h.clockMs += DAY;
    const between = await s.workout.start({ gymId, opId: 'start-between', checkIn: null, routineOf: routineId });
    if (!between.ok) throw new Error(between.error.message);
    // One set logged, so it is the routine's last workout.
    const set = between.aggregate.sets.find((x) => x.setType !== 'warmup');
    if (!set) throw new Error('no set');
    h.clockMs += 60_000;
    // A saved workout's loads are Auto (workout library WL7): with its only workout deleted there is no history, so no planned load; Ben types one.
    expect(set.planned.load).toBeNull();
    const logged = await s.workout.dispatch(between.aggregate.session.id, { type: 'log_set', at: h.now(), opId: 'log-between', setId: set.id, values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const fin = await s.workout.dispatch(between.aggregate.session.id, { type: 'finish', at: h.now(), opId: 'fin-between', expectedVersion: logged.aggregate.session.version, endedAt: null });
    expect(fin.ok).toBe(true);
    await h.settle(s);
    expect((await s.history.restoreWorkouts(undo, 'restore-1')).ok).toBe(true);
    h.clockMs += DAY;
    const next = await s.workout.start({ gymId, opId: 'start-next', checkIn: null, routineOf: routineId });
    if (!next.ok) throw new Error(next.error.message);
    expect(coachPlanned(next.aggregate.sets)).toBe(false);
  });

  it('DW14: a target already used in a later workout stays as it was when the earlier workout is deleted', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { first, routineId } = await coachTargetFrom(s, gymId);
    h.clockMs += DAY;
    const later = await s.workout.start({ gymId, opId: 'start-later', checkIn: null, routineOf: routineId });
    if (!later.ok) throw new Error(later.error.message);
    expect(coachPlanned(later.aggregate.sets)).toBe(true);
    const plannedBefore = later.aggregate.sets.map((x) => ({ id: x.id, planned: x.planned, version: x.version }));
    await deleteOne(s, first, 'del-1');
    const reread = await s.workout.load(later.aggregate.session.id);
    expect(reread?.aggregate.sets.map((x) => ({ id: x.id, planned: x.planned, version: x.version }))).toEqual(plannedBefore);
    expect((await s.coach.nextTargets(first))[0]?.usedBySessionId).toBe(later.aggregate.session.id);
  });
});

describe('a coach write citing a workout deleted meanwhile is stale (DW16, rule 5)', () => {
  it('the summary turn’s targets are refused when the workout is deleted while the coach is answering', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }] }]);
    model = new StepModel([
      async (req) => {
        // Ben deletes the workout from its Summary while the review is running.
        await deleteOne(s, first, 'del-mid-turn');
        return benchTarget(req);
      },
      () => reply('Ok.'),
    ]);
    await s.coach.runSummaryTurn(first);
    expect(await s.coach.nextTargets(first)).toEqual([]);
    // Out of the coach's context: `What the coach can see` and the chip.
    const seen = await s.coach.describe({ kind: 'summary', sessionId: first }, null);
    expect(seen.yourData.map((d) => d.label)).not.toContain('This workout');
  });

  it('the chip reads `Deleted workout`; the coach has no delete tool and declines with the spec’s line (DW33)', () => {
    expect(seesLabel({ kind: 'summary', sessionId: 'x' }, 'Push A', false, 'deleted')).toBe('Deleted workout');
    expect(seesLabel({ kind: 'summary', sessionId: 'x' }, 'Push A', false, 'unavailable')).toBe('Workout unavailable');
    expect(seesLabel({ kind: 'summary', sessionId: 'x' }, 'Push A', false)).toBe('Sees: Push A');
    expect(seesLabel({ kind: 'today' }, null, false, 'deleted')).toBe('Sees: Today');
    expect(COACH_INSTRUCTIONS).toContain('reply only: "Delete workouts from Past workouts."');
  });
});

describe('get_recent_actions and a deleted workout (§5, DW16; review r3 S1)', () => {
  /** Runs a turn whose model calls `get_recent_actions`, and returns the tool output it was given. */
  async function recentActionsSeen(s: Services, entry: Parameters<Services['coach']['send']>[0]['entry']): Promise<string> {
    let seen = '';
    model = new StepModel([
      () => call('get_recent_actions', { limit: 10 }),
      (req) => {
        const out = req.input.find((i) => i.type === 'function_call_output');
        if (out?.type !== 'function_call_output') throw new Error('no tool output');
        seen = out.output;
        return reply('Ok.');
      },
    ]);
    const r = await s.coach.send({ entry, threadId: null, input: { kind: 'words', text: 'What did you change recently?', spoken: false }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    return seen;
  }

  it('neither Today nor the deleted workout’s thread sees its targets; after Restore both do; a purge hides them for good', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { first } = await coachTargetFrom(s, gymId);
    const today = { kind: 'today' } as const;
    const own = { kind: 'summary', sessionId: first } as const;
    expect(await recentActionsSeen(s, today)).toContain('57.5');
    expect(await recentActionsSeen(s, own)).toContain('57.5');

    const undo = await deleteOne(s, first, 'del-1');
    expect(await recentActionsSeen(s, today)).not.toContain('57.5');
    // The deleted workout's own thread reads that workout's actions only, which are hidden: not every action Ben has.
    expect(await recentActionsSeen(s, own)).not.toContain('57.5');

    expect((await s.history.restoreWorkouts(undo, 'restore-1')).ok).toBe(true);
    expect(await recentActionsSeen(s, today)).toContain('57.5');
    expect(await recentActionsSeen(s, own)).toContain('57.5');

    const again = await deleteOne(s, first, 'del-2');
    expect(again).toHaveLength(1);
    expect(await s.history.deleteNow([first], 'now-1')).toEqual({ ok: true, purged: 1 });
    expect(await recentActionsSeen(s, today)).not.toContain('57.5');
  });
});

describe('pain flags raised in a deleted workout (DW17, DW-D6)', () => {
  it('stay active, and progression on that movement stays blocked', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sets = [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 }));
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets }]);
    h.clockMs += 2 * DAY;
    const second = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets }]);
    const bench = (await s.workout.summary(second))?.exercises.find((e) => e.name === 'Bench press');
    if (!bench) throw new Error('no bench');
    expect((await s.pain.flagMovement({ exerciseId: bench.exerciseId, exerciseName: 'Bench press', opId: 'pain-1' })).ok).toBe(true);
    await deleteOne(s, second, 'del-2');
    expect((await s.pain.active()).map((f) => f.exerciseName)).toEqual(['Bench press']);
    expect((await s.workout.summary(first))?.nextTime?.rows.find((r) => r.exerciseName === 'Bench press')?.decision).toBe('halted_pain');
  });
});

describe('purging a workout the coach reviewed (§6.4; ADR 0024 keeps coach records, review S7)', () => {
  it('Delete now leaves integrity clean; the kept coach note and targets still read', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { first } = await coachTargetFrom(s, gymId);
    await deleteOne(s, first, 'del-1');
    expect(await s.history.deleteNow([first], 'now-1')).toEqual({ ok: true, purged: 1 });
    expect(await s.history.presence(first)).toEqual({ kind: 'gone' });
    expect((await s.integrity.checkAll())?.report.ok).toBe(true);
    // Kept until Ben decides (S7): readable, never applied (the source is gone).
    expect((await s.coach.nextTargets(first)).map((r) => r.status)).toEqual(['saved']);
    expect(await s.coach.summaryNote(first)).toBe('Both sets were RPE 10.');
  });
});
