import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { NBSP } from '@fizz/domain';
import type { TextCoachState } from '@fizz/providers';
import type { Routine, SessionAggregate, SetTemplate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Workouts library review B1: a coach target for next time (D21) never
 * replaces a library workout's structure. Ben's later edit wins; the
 * coach's load and reps go on the matching Auto sets. The overview and
 * Start show the same thing. Scripted model; nothing here proves the route.
 */

class StepModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: ((req: ModelRequest) => ModelEvent[])[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1];
    const events = step === undefined ? [{ type: 'error' as const, error: 'unavailable' as const }] : step(request);
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

/** Bench 3 × 60 × 8 at RPE 10, saved as Push A; the coach saves 57.5 kg × 5 (`sets` sets) for next time. */
async function withCoachTarget(s: AppServices, sets: number | null): Promise<{ gymId: string; routine: Routine; first: string }> {
  const gymId = await setUpGym(h, s);
  const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 8, rpe: 10 }] }]);
  const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1', addToRotation: true });
  if (!saved.ok) throw new Error(saved.message);
  model = new StepModel([
    (req) => {
      const w = yourData(req).workout;
      return call('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: w.exercises[0]?.exerciseId, target: { load: { value: 57.5, unit: 'kg', convention: 'total' }, reps: { min: 5, max: 5 } }, sets, reason: 'Every set was RPE 10.' }] });
    },
    () => reply('All three sets were RPE 10.'),
  ]);
  await s.coach.runSummaryTurn(first);
  expect((await s.coach.nextTargets(first))[0]).toMatchObject({ status: 'saved', sets });
  return { gymId, routine: saved.routine, first };
}

async function overviewAndStart(s: AppServices, gymId: string, routineId: string): Promise<{ detail: string | undefined; load: string | undefined; workingSets: number; started: SessionAggregate }> {
  const page = await s.overview.load({ target: { kind: 'routine', routineId }, gymId });
  if (!page) throw new Error('no overview');
  const row = page.view.rows.find((r) => r.name === 'Bench press');
  const started = await s.workout.start({ gymId, opId: 'start-push-a', checkIn: null, routineOf: routineId });
  if (!started.ok) throw new Error(started.error.message);
  return { detail: row?.detail.replaceAll(NBSP, ' '), load: row?.load.value, workingSets: page.view.workingSets, started: started.aggregate };
}

const working = (a: SessionAggregate) => a.sets.filter((x) => x.setType !== 'warmup').sort((x, y) => x.index - y.index);

describe('B1: a coach target and a later editor change', () => {
  it('Ben restructures Bench as 1 Top 4–6 + 3 Back-off 6–8 after the coach saved 3 × 57.5 × 5: overview and Start keep his structure', async () => {
    const { services: s } = await h.launch();
    const { gymId, routine } = await withCoachTarget(s, 3);
    h.clockMs += 60 * 60 * 1000;
    const ed = await s.routines.editor({ routineId: routine.id, gymId });
    const slot = ed?.exercises[0];
    if (!slot) throw new Error('no slot');
    const base = slot.setTemplates.find((t) => t.setType !== 'warmup');
    if (!base) throw new Error('no set');
    const warmups = slot.setTemplates.filter((t) => t.setType === 'warmup');
    const sets: SetTemplate[] = [
      ...warmups,
      { ...base, id: h.ids(), setType: 'top', targetLoad: null, targetReps: { min: 4, max: 6 } },
      ...[1, 2, 3].map(() => ({ ...base, id: h.ids(), setType: 'backoff' as const, targetLoad: null, targetReps: { min: 6, max: 8 } })),
    ];
    const u = await s.routines.update({ routineId: routine.id, edit: { name: 'Push A', exercises: [{ ...slot, setTemplates: sets }] }, expectedVersion: routine.version, opId: 'restructure' });
    if (!u.ok) throw new Error(u.message);
    h.clockMs += 2 * DAY;

    const { detail, load, workingSets, started } = await overviewAndStart(s, gymId, routine.id);
    const work = working(started);
    expect(work.map((x) => x.setType)).toEqual(['top', 'backoff', 'backoff', 'backoff']);
    expect(work[0]?.planned).toMatchObject({ load: { value: 57.5 }, reps: { min: 5, max: 5 }, source: 'coach' });
    expect(work.slice(1).every((x) => x.planned.reps?.min === 6 && x.planned.reps.max === 8 && x.planned.source !== 'coach')).toBe(true);
    // Overview == Start.
    expect(workingSets).toBe(4);
    expect(load).toBe('57.5');
    expect(detail).toBe('1 × 5 + 3 × 6–8');
  });

  it('a one-type workout edited to 4 sets after a coach 3-set target keeps 4 sets, at the coach’s load and reps', async () => {
    const { services: s } = await h.launch();
    const { gymId, routine } = await withCoachTarget(s, 3);
    h.clockMs += 60 * 60 * 1000;
    const ed = await s.routines.editor({ routineId: routine.id, gymId });
    const slot = ed?.exercises[0];
    const base = slot?.setTemplates.find((t) => t.setType !== 'warmup');
    if (!slot || !base) throw new Error('no slot');
    const four = [...slot.setTemplates.filter((t) => t.setType === 'warmup'), ...[1, 2, 3, 4].map(() => ({ ...base, id: h.ids(), targetLoad: null }))];
    const u = await s.routines.update({ routineId: routine.id, edit: { name: 'Push A', exercises: [{ ...slot, setTemplates: four }] }, expectedVersion: routine.version, opId: 'four' });
    if (!u.ok) throw new Error(u.message);
    h.clockMs += 2 * DAY;
    const { workingSets, started } = await overviewAndStart(s, gymId, routine.id);
    expect(working(started)).toHaveLength(4);
    expect(workingSets).toBe(4);
    expect(working(started).every((x) => x.planned.load?.value === 57.5 && x.planned.reps?.min === 5)).toBe(true);
  });

  it('not edited since the target: the coach’s set count is used (D21)', async () => {
    const { services: s } = await h.launch();
    const { gymId, routine } = await withCoachTarget(s, 2);
    h.clockMs += 2 * DAY;
    const { workingSets, started } = await overviewAndStart(s, gymId, routine.id);
    expect(working(started)).toHaveLength(2);
    expect(workingSets).toBe(2);
  });
});
