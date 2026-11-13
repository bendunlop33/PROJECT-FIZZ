import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { libraryChangeCounts, libraryChangeMarks, NBSP, nextTimeCardRows } from '@fizz/domain';
import type { TextCoachState } from '@fizz/providers';
import type { Routine } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Redesign 27 Oct, D2 and D5 end to end on real SQLite: the coach's next-time target for a saved workout shows as one
 * change (`1 change · next week`), marked on that workout's Bench row (was / now) and counted for its `✦1`; Undo is
 * the row's own versioned write (a retried tap replays; a tap on an older read is refused, never overwrites), and
 * the change survives a force-close. Offline: no coach call to read or undo. A corrected source set hides it.
 * Scripted model; nothing here proves the route.
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
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

let h: Harness;
let model: StepModel;
let online = true;
beforeEach(() => {
  online = true;
  model = new StepModel([]);
  h = createHarness('2026-10-10T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(online ? CONNECTED : { status: 'not_connected' } as never) } });
});
afterEach(async () => {
  await h.cleanup();
});

/** Bench 3 × 60 × 8 at RPE 10 saved as Push A; the coach saves 57.5 kg × 5 for next time. */
async function withCoachTarget(s: AppServices): Promise<{ gymId: string; routine: Routine; first: string }> {
  const gymId = await setUpGym(h, s);
  const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 8, rpe: 10 }] }]);
  const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1', addToRotation: true });
  if (!saved.ok) throw new Error(saved.message);
  model = new StepModel([
    (req) => {
      const w = yourData(req).workout;
      return call('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: w.exercises[0]?.exerciseId, target: { load: { value: 57.5, unit: 'kg', convention: 'total' }, reps: { min: 5, max: 5 } }, sets: null, reason: 'Every set was RPE 10.' }] });
    },
    () => reply('All three sets were RPE 10.'),
  ]);
  await s.coach.runSummaryTurn(first);
  expect((await s.coach.nextTargets(first))[0]).toMatchObject({ status: 'saved' });
  return { gymId, routine: saved.routine, first };
}

describe('Library › Plan › Changes: the coach’s next-time change', () => {
  it('one change, marked on its workout’s row, ✦1; Undo is versioned (replay, stale refused); survives a force-close; offline', async () => {
    const { services: s } = await h.launch();
    const { routine, first } = await withCoachTarget(s);
    online = false;

    const data = await s.libraryChanges.read();
    if (data === null) throw new Error('no data');
    expect(data.view.count).toBe(1);
    expect(data.view.rowText).toBe('1 change · next week');
    const row = data.view.tweaks[0];
    if (row === undefined) throw new Error('no row');
    expect(plain(row.title)).toMatch(/^Bench press .* → 57\.5 kg/);
    expect(row).toMatchObject({ sub: 'Push A', routineId: routine.id, taps: ['undo'], state: 'made' });
    expect(row.why[0]).toBe('“Every set was RPE 10.”');
    const mark = libraryChangeMarks(data.view, routine.id).get(row.exerciseId);
    expect(plain(mark?.now)).toBe('57.5 kg');
    expect(libraryChangeCounts(data.view).get(routine.id)).toBe(1);
    expect(nextTimeCardRows(data.view, routine.id)).toHaveLength(1);

    // Force-close and relaunch: the same change, read from SQLite.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const again = await s2.libraryChanges.read();
    expect(again?.view.tweaks.map((x) => x.key)).toEqual([row.key]);
    if (again === null) throw new Error('no data');

    // Undo: the row's own write (no coach call), then gone from the list; a retried tap (same op ID) replays.
    const before = model.requests.length;
    const u = await s2.libraryChanges.tap(again, row, 'undo', 'undo-1');
    expect(u.ok).toBe(true);
    if (u.ok) expect(plain(u.text)).toMatch(/^Bench press back to /);
    expect(await s2.libraryChanges.tap(again, row, 'undo', 'undo-1')).toMatchObject({ ok: true });
    expect(model.requests.length).toBe(before);
    expect((await s2.coach.nextTargets(first))[0]?.status).toBe('undone');
    const after = await s2.libraryChanges.read();
    expect(after?.view.count).toBe(0);
    expect(after?.view.rowText).toBeNull();

    // A tap from the older read with a new op ID is refused (rule 5): never applied to the newer state.
    expect(await s2.libraryChanges.tap(again, row, 'undo', 'undo-2')).toEqual({ ok: false, message: 'Out of date' });
    expect((await s2.coach.nextTargets(first))[0]?.status).toBe('undone');
  });

  it('a corrected set on the source workout hides the change (it no longer fits); never invented', async () => {
    const { services: s } = await h.launch();
    const { first } = await withCoachTarget(s);
    const agg = (await s.workout.load(first))?.aggregate;
    const set = agg?.sets.find((x) => x.setType !== 'warmup' && x.status === 'completed');
    if (!agg || !set) throw new Error('no set');
    const fixed = await s.workout.correctSet({ sessionId: first, setId: set.id, expectedSetVersion: set.version, patch: { reps: 2 }, opId: 'fix-1' });
    expect(fixed.ok).toBe(true);
    const data = await s.libraryChanges.read();
    expect(data?.view.count).toBe(0);
  });

  it('nothing to show: no row, no marks', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const data = await s.libraryChanges.read();
    expect(data?.view).toMatchObject({ count: 0, rowText: null, tweaks: [], offers: [] });
  });
});
