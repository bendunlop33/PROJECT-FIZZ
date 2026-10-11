import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import { threadRows } from '../src/coach/sheet-view';
import { startFromOverview } from '../src/workout/overview-start';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Backlog §4.3 item 2 (ADR 0020 §3, CLAUDE.md rule 3): the coach suggests
 * swapping, removing or reordering exercises in the next workout as a card
 * with before/after, only when Ben asks or something changed. Nothing changes
 * until Apply; Apply writes Ben's own today-edits into the next workout's
 * draft, Undo takes them back, and once a workout starts from that plan the
 * card is out of date (rule 5). Real SQLite, scripted model.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

interface OverviewOut {
  sessions: { sessionId: string; version: number; exercises: { exerciseId: string; name: string }[] }[];
}

function outputsOf(req: ModelRequest): { status: string; data: unknown }[] {
  return req.input.flatMap((i) => (i.type === 'function_call_output' ? [JSON.parse(i.output) as { status: string; data: unknown }] : []));
}

async function pushDay(): Promise<{ s: AppServices; gymId: string; sessionId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const sessionId = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }] },
    { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }] },
  ]);
  h.clockMs += DAY;
  return { s, gymId, sessionId };
}

/** The model reads the overview, then swap options for the pushdown, then proposes the first option. */
function swapPushdownSteps(over: { version?: (v: number) => number } = {}): ((req: ModelRequest) => ModelEvent[])[] {
  return [
    () => toolCall('get_training_overview', { weeks: 4 }),
    (req) => {
      const ov = outputsOf(req)[0]?.data as OverviewOut;
      const push = ov.sessions[0]?.exercises.find((e) => e.name === 'Triceps pushdown');
      return toolCall('get_substitutions', { exerciseId: push?.exerciseId });
    },
    (req) => {
      const [ovOut, subsOut] = outputsOf(req);
      const ov = ovOut?.data as OverviewOut;
      const w = ov.sessions[0];
      const push = w?.exercises.find((e) => e.name === 'Triceps pushdown');
      const options = (subsOut?.data as { options: { exerciseId: string }[] }).options;
      return toolCall('propose_next_workout_change', {
        sourceSessionId: w?.sessionId,
        sourceVersion: (over.version ?? ((v) => v))(w?.version ?? 1),
        changes: [{ change: 'swap', fromExerciseId: push?.exerciseId, toExerciseId: options[0]?.exerciseId }],
        reason: 'Some variety.',
      });
    },
    () => replyWith('Here is a swap to try.'),
  ];
}

const ask = (s: AppServices, text: string) => s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

async function rowNames(s: AppServices, gymId: string, sessionId: string): Promise<string[]> {
  const page = await s.overview.load({ target: { kind: 'session', sourceSessionId: sessionId }, gymId });
  if (!page) throw new Error('no overview');
  return page.view.rows.filter((r) => r.edit?.kind !== 'skipped').map((r) => r.name);
}

describe('structural proposals: Apply card, before/after, Undo', () => {
  it('Ben asks for a swap: a card with before/after; nothing changes until Apply; Apply shows on the next workout; Undo takes it back', async () => {
    const { s, gymId, sessionId } = await pushDay();
    const before = await rowNames(s, gymId, sessionId);
    expect(before).toEqual(['Bench press', 'Lateral raise', 'Triceps pushdown']);
    model = new StepModel(swapPushdownSteps());
    const r = await ask(s, 'Swap the triceps pushdown for something else next time');
    expect(r.status).toBe('completed');
    // The model was offered the tool because Ben asked (rule 3).
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_next_workout_change');
    const subs = outputsOf(model.requests[2] as ModelRequest)[1]?.data as { domain: string; options: { name: string }[] };
    expect(subs.domain).toBe('Your data');
    expect(subs.options.length).toBeGreaterThan(0);
    expect(subs.options.map((o) => o.name)).not.toContain('Triceps pushdown');
    const card = r.cards[0]?.record;
    expect(card).toMatchObject({ status: 'proposed', detail: { kind: 'propose_next_workout_change', before: ['Bench press', 'Lateral raise', 'Triceps pushdown'] } });
    if (card?.detail.kind !== 'propose_next_workout_change') throw new Error('no card');
    const swapIn = card.detail.after?.[2] ?? '';
    expect(card.detail.after).toEqual(['Bench press', 'Lateral raise', swapIn]);
    expect(card.detail.changes).toEqual([{ change: 'swap', text: `Triceps pushdown → ${swapIn}` }]);

    // Suggested: Not now · Apply, and the next workout is unchanged.
    const thread = await s.coach.loadThread(r.threadId);
    if (!thread) throw new Error('no thread');
    const row = threadRows(thread).find((x) => x.kind === 'card');
    expect(row?.kind === 'card' ? row.card.proposal : null).toMatchObject({ title: 'Next workout', canApply: true, undoActionId: null, before: 'Bench press · Lateral raise · Triceps pushdown' });
    expect(row?.kind === 'card' ? row.card.status.word : null).toBe('Suggested');
    expect(await rowNames(s, gymId, sessionId)).toEqual(before);

    // Apply (a double tap is one write) → the overview shows the swap as Ben's own edit.
    const applied = await s.coach.tapProposal(card.actionId, 'apply');
    const again = await s.coach.tapProposal(card.actionId, 'apply');
    expect(applied.ok && again.ok && applied.record.actionId === again.record.actionId).toBe(true);
    if (!applied.ok) throw new Error('not applied');
    expect(await rowNames(s, gymId, sessionId)).toEqual(['Bench press', 'Lateral raise', swapIn]);
    // A second load writes nothing new.
    const p1 = await s.overview.load({ target: { kind: 'session', sourceSessionId: sessionId }, gymId });
    const p2 = await s.overview.load({ target: { kind: 'session', sourceSessionId: sessionId }, gymId });
    expect(p2?.draft?.version).toBe(p1?.draft?.version);
    const appliedRow = threadRows((await s.coach.loadThread(r.threadId)) ?? thread).find((x) => x.kind === 'card');
    expect(appliedRow?.kind === 'card' ? appliedRow.card.proposal : null).toMatchObject({ canApply: false, undoActionId: applied.record.actionId });
    // Not now after Apply is refused.
    expect((await s.coach.tapProposal(card.actionId, 'not_now')).ok).toBe(false);

    // Undo → the swap is taken back on the next load.
    const undone = await s.coach.undo(applied.record.actionId, `undo:${applied.record.actionId}`);
    expect(undone.result.status).toBe('written');
    expect(await rowNames(s, gymId, sessionId)).toEqual(before);
    const undoneRow = threadRows((await s.coach.loadThread(r.threadId)) ?? thread).find((x) => x.kind === 'card');
    expect(undoneRow?.kind === 'card' ? undoneRow.card.status.word : null).toBe('Undone');
  });

  it('Not now: nothing changes and the card reads Not applied', async () => {
    const { s, gymId, sessionId } = await pushDay();
    model = new StepModel(swapPushdownSteps());
    const r = await ask(s, 'Swap the triceps pushdown for something else next time');
    const id = r.cards[0]?.record.actionId ?? '';
    expect((await s.coach.tapProposal(id, 'not_now')).ok).toBe(true);
    expect((await s.coach.tapProposal(id, 'apply')).ok).toBe(false);
    expect(await rowNames(s, gymId, sessionId)).toEqual(['Bench press', 'Lateral raise', 'Triceps pushdown']);
    const row = threadRows((await s.coach.loadThread(r.threadId)) ?? { thread: null as never, messages: [], turns: new Map(), actionsByTurn: new Map() }).find((x) => x.kind === 'card');
    expect(row?.kind === 'card' ? row.card.status.word : null).toBe('Not applied');
  });

  it('a stale version is refused; once a workout starts from that plan, Apply is out of date and Undo is refused (rule 5)', async () => {
    const { s, gymId, sessionId } = await pushDay();
    model = new StepModel(swapPushdownSteps({ version: (v) => v + 5 }));
    const stale = await ask(s, 'Swap the triceps pushdown for something else next time');
    expect(stale.cards[0]?.record.status).toBe('stale');

    model = new StepModel(swapPushdownSteps());
    const r = await ask(s, 'Swap the triceps pushdown for something else next time');
    const id = r.cards[0]?.record.actionId ?? '';
    const started = await s.workout.start({ gymId, opId: 'start-next', checkIn: null, nextOf: sessionId });
    expect(started.ok).toBe(true);
    const tap = await s.coach.tapProposal(id, 'apply');
    expect(tap).toEqual({ ok: false, state: 'out_of_date' });
    const row = threadRows((await s.coach.loadThread(r.threadId)) ?? { thread: null as never, messages: [], turns: new Map(), actionsByTurn: new Map() }).find((x) => x.kind === 'card');
    expect(row?.kind === 'card' ? row.card.proposal?.canApply : null).toBe(false);
    expect(row?.kind === 'card' ? row.card.status.word : null).toBe('Out of date');
  });

  it('Undo after the next workout started is refused; the started workout keeps the swap', async () => {
    const { s, gymId, sessionId } = await pushDay();
    model = new StepModel(swapPushdownSteps());
    const r = await ask(s, 'Swap the triceps pushdown for something else next time');
    const applied = await s.coach.tapProposal(r.cards[0]?.record.actionId ?? '', 'apply');
    if (!applied.ok) throw new Error('not applied');
    const names = await rowNames(s, gymId, sessionId);
    h.clockMs += 60_000;
    const page = await s.overview.load({ target: { kind: 'session', sourceSessionId: sessionId }, gymId });
    if (!page) throw new Error('no overview');
    const run = await startFromOverview(
      { start: (q: Parameters<AppServices['overview']['start']>[0]) => s.overview.start(q), reload: () => s.overview.load({ target: { kind: 'session', sourceSessionId: sessionId }, gymId }) },
      { page, opId: 'start-next-2', checkIn: { kind: 'skipped', atUtc: h.now().utc } },
    );
    if (run.kind !== 'started') throw new Error('not started');
    const started = run.outcome;
    expect([...started.aggregate.exercises].sort((a, b) => a.order - b.order).map((e) => e.exerciseName)).toEqual(names);
    const undone = await s.coach.undo(applied.record.actionId, `undo:${applied.record.actionId}`);
    expect(undone.result).toMatchObject({ status: 'not_possible', reason: 'changed_since' });
  });

  it('a plain question never gets the structural tool; a call to it changes nothing (rule 3)', async () => {
    const { s } = await pushDay();
    model = new StepModel([() => toolCall('get_training_overview', { weeks: 4 }), () => replyWith('Going well.')]);
    const r = await ask(s, 'How am I doing?');
    expect(r.status).toBe('completed');
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('propose_next_workout_change');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('get_substitutions');
    expect(r.cards).toEqual([]);
  });

  it('a pain flag since that workout opens the tool without a request; a pain-flagged exercise is never swapped in', async () => {
    const { s, sessionId } = await pushDay();
    const bench = (await s.workout.load(sessionId))?.aggregate.exercises.find((e) => e.exerciseName === 'Bench press');
    const lateral = (await s.workout.load(sessionId))?.aggregate.exercises.find((e) => e.exerciseName === 'Lateral raise');
    if (!bench || !lateral) throw new Error('no exercises');
    h.clockMs += 60_000;
    const flagged = await s.pain.flagMovement({ exerciseId: lateral.exerciseId, exerciseName: 'Lateral raise', opId: h.ids() });
    expect(flagged.ok).toBe(true);
    const version = (await s.workout.load(sessionId))?.aggregate.session.version ?? 1;
    model = new StepModel([
      () => toolCall('propose_next_workout_change', { sourceSessionId: sessionId, sourceVersion: version, changes: [{ change: 'swap', fromExerciseId: bench.exerciseId, toExerciseId: lateral.exerciseId }], reason: 'Shoulder.' }),
      () => replyWith('Not that one.'),
    ]);
    const r = await ask(s, 'What do you think about my plan?');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_next_workout_change');
    // Lateral raise is already in the plan, so this is dropped; nothing proposed.
    expect(r.cards[0]?.record.status).toBe('rejected');
  });

  it('a routine: the proposal is for that routine; once the routine changes, Apply is out of date', async () => {
    const { s, gymId, sessionId } = await pushDay();
    const saved = await s.routines.saveFromSession({ sessionId, name: 'Push A', opId: 'save-push-a' });
    if (!saved.ok) throw new Error(saved.message);
    const started = await s.workout.start({ gymId, opId: 'start-routine', checkIn: null, routineOf: saved.routine.id });
    if (!started.ok) throw new Error(started.error.message);
    const agg = started.aggregate;
    h.clockMs += 60_000;
    const push = agg.exercises.find((e) => e.exerciseName === 'Triceps pushdown');
    const lateral = agg.exercises.find((e) => e.exerciseName === 'Lateral raise');
    model = new StepModel([
      () => toolCall('propose_next_workout_change', { sourceSessionId: agg.session.id, sourceVersion: agg.session.version, changes: [{ change: 'remove', exerciseId: push?.exerciseId }, { change: 'reorder', exerciseIds: [lateral?.exerciseId, agg.exercises.find((e) => e.exerciseName === 'Bench press')?.exerciseId] }], reason: 'Shorter.' }),
      () => replyWith('Try that.'),
    ]);
    const r = await ask(s, 'Drop the triceps pushdown next time and do laterals first');
    const card = r.cards[0]?.record;
    expect(card).toMatchObject({ status: 'proposed', detail: { workoutLabel: 'Push A', basis: { kind: 'routine', routineId: saved.routine.id }, basisVersion: saved.routine.version, after: ['Lateral raise', 'Bench press'] } });
    if (card?.detail.kind !== 'propose_next_workout_change') throw new Error('no card');
    expect(card.detail.changes.map((c) => c.text)).toEqual(['Triceps pushdown out', 'New order: Lateral raise, Bench press']);
    // Ben changes the routine himself (the change-review route): the proposal no longer fits.
    const op = card.detail.ops?.[0];
    const slotKey = op !== undefined && op.change === 'remove' ? op.slotKey : '';
    const rope = (await s.workout.pickerExercises(agg.session.id, 'Rope triceps pushdown', { withCatalogue: true })).find((x) => x.exercise.name === 'Rope triceps pushdown');
    const swapped = await s.routines.applyTemplateSwap({ routineId: saved.routine.id, expectedRoutineVersion: saved.routine.version, slotKey, toExerciseId: rope?.exercise.id ?? '', draft: null, opId: 'tmpl-1' });
    expect(swapped).toMatchObject({ ok: true });
    expect(await s.coach.tapProposal(card.actionId, 'apply')).toEqual({ ok: false, state: 'out_of_date' });
  });
});
