import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { NBSP } from '@fizz/domain';
import type { TextCoachState } from '@fizz/providers';
import type { Routine, SessionAggregate, SetTemplate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Workouts library review B1 (rounds 1 and 2) and r2 S1: a coach target for
 * next time (D21) never replaces a library workout's structure. Ben's later
 * edit to a slot wins on set count and reps; the coach's load is used only
 * where its reps fit his range, else the built-in rule's. A rename, rotation
 * toggle or saving the workout after the target is not an edit. The
 * overview and Start show the same thing. Scripted model; nothing here
 * proves the route.
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

/**
 * Bench 3 × 60 × 8 at RPE 10, saved as Push A; the coach saves 57.5 kg × 5
 * (`sets` sets) for next time. `order: 'target_first'` is the Summary order
 * (the coach turn runs, then Ben taps `Save to Workouts`; review r2 S1).
 */
async function withCoachTarget(s: AppServices, sets: number | null, order: 'save_first' | 'target_first' = 'save_first'): Promise<{ gymId: string; routine: Routine; first: string }> {
  const gymId = await setUpGym(h, s);
  const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 8, rpe: 10 }] }]);
  const save = async (): Promise<Routine> => {
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1', addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    return saved.routine;
  };
  const before = order === 'save_first' ? await save() : null;
  model = new StepModel([
    (req) => {
      const w = yourData(req).workout;
      return call('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: w.exercises[0]?.exerciseId, target: { load: { value: 57.5, unit: 'kg', convention: 'total' }, reps: { min: 5, max: 5 } }, sets, reason: 'Every set was RPE 10.' }] });
    },
    () => reply('All three sets were RPE 10.'),
  ]);
  await s.coach.runSummaryTurn(first);
  expect((await s.coach.nextTargets(first))[0]).toMatchObject({ status: 'saved', sets });
  if (before !== null) return { gymId, routine: before, first };
  h.clockMs += 60 * 1000;
  return { gymId, routine: await save(), first };
}

/** The editor's Bench slot with its working sets replaced by `make(base)`; warm-ups kept. */
async function editBench(s: AppServices, gymId: string, routine: Routine, opId: string, make: (base: SetTemplate) => SetTemplate[]): Promise<void> {
  const ed = await s.routines.editor({ routineId: routine.id, gymId });
  const slot = ed?.exercises[0];
  const base = slot?.setTemplates.find((t) => t.setType !== 'warmup');
  if (!slot || !base) throw new Error('no slot');
  const sets = [...slot.setTemplates.filter((t) => t.setType === 'warmup'), ...make(base)];
  const u = await s.routines.update({ routineId: routine.id, edit: { name: 'Push A', exercises: [{ ...slot, setTemplates: sets }] }, expectedVersion: routine.version, opId });
  if (!u.ok) throw new Error(u.message);
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
    // His 4–6 stays (B1 r2); the coach's 5 reps fit it, so the coach's 57.5 kg is used.
    expect(work[0]?.planned).toMatchObject({ load: { value: 57.5 }, reps: { min: 4, max: 6 }, source: 'coach' });
    expect(work.slice(1).every((x) => x.planned.reps?.min === 6 && x.planned.reps.max === 8 && x.planned.source !== 'coach')).toBe(true);
    // Overview == Start.
    expect(workingSets).toBe(4);
    expect(load).toBe('57.5');
    expect(detail).toBe('1 × 4–6 + 3 × 6–8');
  });

  it('WL-A4: Ben changes Bench to 6–8 after the coach’s 57.5 × 5: overview and Start show 6–8 at the built-in rule’s load', async () => {
    const { services: s } = await h.launch();
    const { gymId, routine } = await withCoachTarget(s, null);
    h.clockMs += 60 * 60 * 1000;
    await editBench(s, gymId, routine, 'reps-6-8', (base) => [1, 2, 3].map(() => ({ ...base, id: h.ids(), targetLoad: null, targetReps: { min: 6, max: 8 } })));
    h.clockMs += 2 * DAY;
    const { detail, load, workingSets, started } = await overviewAndStart(s, gymId, routine.id);
    const work = working(started);
    expect(work).toHaveLength(3);
    expect(work.every((x) => x.planned.reps?.min === 6 && x.planned.reps.max === 8 && x.planned.source === 'built_in_rule')).toBe(true);
    expect(work.every((x) => x.planned.load?.value !== 57.5)).toBe(true);
    expect(work[0]?.planned.provenance?.guardNotes).toContain('Kept your edit: 6–8 reps');
    // Overview == Start.
    expect(workingSets).toBe(3);
    expect(detail).toBe('3 × 6–8');
    expect(load).toBe(String(work[0]?.planned.load?.value));
  });

  it('a one-type workout edited to 4 sets after a coach 3-set target keeps 4 sets and its own reps; Why? says so', async () => {
    const { services: s } = await h.launch();
    const { gymId, routine } = await withCoachTarget(s, 3);
    h.clockMs += 60 * 60 * 1000;
    let reps: SetTemplate['targetReps'] = null;
    await editBench(s, gymId, routine, 'four', (base) => {
      reps = base.targetReps;
      return [1, 2, 3, 4].map(() => ({ ...base, id: h.ids(), targetLoad: null }));
    });
    h.clockMs += 2 * DAY;
    const { workingSets, started } = await overviewAndStart(s, gymId, routine.id);
    expect(working(started)).toHaveLength(4);
    expect(workingSets).toBe(4);
    expect(working(started).every((x) => JSON.stringify(x.planned.reps) === JSON.stringify(reps))).toBe(true);
    expect(working(started)[0]?.planned.provenance?.guardNotes.some((n) => n.startsWith('Kept your edit: 4 sets'))).toBe(true);
  });

  it('S1: the coach target on Summary, then Save to Workouts on the same Summary: the next Start uses the coach’s 2 sets', async () => {
    const { services: s } = await h.launch();
    const { gymId, routine } = await withCoachTarget(s, 2, 'target_first');
    h.clockMs += 2 * DAY;
    const { workingSets, started } = await overviewAndStart(s, gymId, routine.id);
    expect(working(started)).toHaveLength(2);
    expect(workingSets).toBe(2);
    expect(working(started).every((x) => x.planned.load?.value === 57.5 && x.planned.reps?.min === 5 && x.planned.source === 'coach')).toBe(true);
  });

  it('S1: a rename and a rotation toggle after the target are not edits: the coach’s 2 sets stay', async () => {
    const { services: s } = await h.launch();
    const { gymId, routine } = await withCoachTarget(s, 2);
    h.clockMs += 60 * 60 * 1000;
    const off = await s.routines.setRotation({ routineId: routine.id, on: false, expectedVersion: routine.version, opId: 'rot-off' });
    if (!off.ok) throw new Error('rotation');
    const renamed = await s.routines.rename({ routineId: routine.id, name: 'Push B', expectedVersion: off.routine.version, opId: 'ren' });
    if (!renamed.ok) throw new Error('rename');
    h.clockMs += 2 * DAY;
    const { workingSets, started } = await overviewAndStart(s, gymId, routine.id);
    expect(working(started)).toHaveLength(2);
    expect(workingSets).toBe(2);
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
