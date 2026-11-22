import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 1 Nov) Simple warm-up weights end to end on real SQLite: the switch (and the coach's `update_warmup_prefs`
 * when Ben asks) re-plans the open workout's warm-ups not yet done; a logged warm-up never changes; Undo puts back
 * exactly what was there. The coach's own idea changes nothing.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-20T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};

/** Every exercise's warm-ups: [load, status], in set order. */
const warmups = (a: SessionAggregate): Record<string, [number | null, string][]> => {
  const out: Record<string, [number | null, string][]> = {};
  for (const ex of a.exercises) {
    out[ex.exerciseName] = a.sets
      .filter((x) => x.sessionExerciseId === ex.id && x.setType === 'warmup' && x.status !== 'deleted')
      .sort((x, y) => x.index - y.index)
      .map((x) => [x.status === 'completed' ? (x.actual?.load?.value ?? null) : (x.planned.load?.value ?? null), x.status]);
  }
  return out;
};

/** A started push day: bench 92.5 kg (the 22 Oct steps are fiddly there), from the builder. */
async function started(): Promise<{ s: AppServices; sessionId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 92.5, reps: 5, rpe: 8 }, { load: 92.5, reps: 5, rpe: 8 }, { load: 92.5, reps: 5, rpe: 8 }] },
    { exercise: 'Triceps pushdown', sets: [{ load: 27.5, reps: 11, rpe: 8 }, { load: 27.5, reps: 11, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  const setup = await s.builder.initialSetup({ dayId: 'push' });
  const snap: BuilderSnapshot = ok(await s.builder.create({ ...setup, minutes: 60, supersets: false }, 'create-prefs')).snapshot;
  expect(slotsOf(snap.workout.blocks).length).toBeGreaterThan(0);
  const st = await s.builder.start(snap.draftId, { opId: 'start-prefs', expectedVersion: snap.version, gymId });
  if (!st.ok) throw new Error('not started');
  return { s, sessionId: st.sessionId };
}

const load = async (s: AppServices, id: string): Promise<SessionAggregate> => {
  const a = (await s.workout.load(id))?.aggregate;
  if (a === undefined) throw new Error('no session');
  return a;
};

describe('Simple warm-up weights (Ben, 1 Nov)', () => {
  it('the switch re-plans today’s pending warm-ups, never a logged one; Undo restores them; a stale version is refused', async () => {
    const { s, sessionId } = await started();
    const before = await load(s, sessionId);
    const was = warmups(before);
    // Default on: every planned warm-up load is the bar or a multiple of 5.
    for (const [l] of Object.values(was).flat()) if (l !== null) expect(l % 5).toBe(0);
    // Ben logs the bench's first warm-up as planned.
    const benchEx = before.exercises.find((e) => e.exerciseName === 'Bench press');
    const first = before.sets.filter((x) => x.sessionExerciseId === benchEx?.id && x.setType === 'warmup').sort((a, b) => a.index - b.index)[0];
    if (first === undefined || first.planned.load === null) throw new Error('no bench warm-up');
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-w1', setId: first.id, values: { load: first.planned.load, reps: first.planned.reps?.min ?? 5, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    expect(logged.ok).toBe(true);
    const afterLog = await load(s, sessionId);

    const view = await s.warmupPrefs.view();
    expect(view?.simpleLoads).toBe(true);
    // A stale version is refused and changes nothing (rule 5).
    expect(await s.warmupPrefs.setSimpleLoads(false, (view?.version ?? 1) + 5, h.ids())).toMatchObject({ ok: false, reason: 'stale' });
    const off = await s.warmupPrefs.setSimpleLoads(false, view?.version ?? 1, h.ids());
    if (!off.ok) throw new Error(off.reason);
    expect((await s.warmupPrefs.view())?.simpleLoads).toBe(false);
    const changed = await load(s, sessionId);
    // The logged warm-up is exactly as it was (rule 2).
    expect(changed.sets.find((x) => x.id === first.id)).toEqual(afterLog.sets.find((x) => x.id === first.id));
    expect(off.replanned).toBeGreaterThan(0);
    expect(warmups(changed)).not.toEqual(warmups(afterLog));
    // Every pending warm-up stays below its first working load.
    for (const ex of changed.exercises) {
      const W = changed.sets.find((x) => x.sessionExerciseId === ex.id && x.setType !== 'warmup')?.planned.load?.value ?? Infinity;
      for (const [l] of warmups(changed)[ex.exerciseName] ?? []) if (l !== null) expect(l).toBeLessThan(W);
    }

    const undone = await s.warmupPrefs.undo(off.undo, h.ids());
    expect(undone.ok).toBe(true);
    expect(undone.view?.simpleLoads).toBe(true);
    expect(warmups(await load(s, sessionId))).toEqual(warmups(afterLog));
  });

  it('the coach applies it when Ben asks (Undo on the card puts both back); its own idea changes nothing', async () => {
    const { s, sessionId } = await started();
    const was = warmups(await load(s, sessionId));

    model = new StepModel([() => toolCall('update_warmup_prefs', { simpleLoads: false, exercises: [], benAsked: false, benQuote: null }), () => replyWith('Want me to change your warm-ups?')]);
    const idea = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text: 'Bench felt heavy today', spoken: false }, turnId: h.ids() });
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('update_warmup_prefs');
    expect(model.requests[0]?.instructions).toContain('Never say you can’t change warm-ups');
    expect(idea.cards).toEqual([]);
    expect((await s.warmupPrefs.view())?.simpleLoads).toBe(true);

    const said = 'Use the exact warm-up weights, not the rounded ones';
    model = new StepModel([() => toolCall('update_warmup_prefs', { simpleLoads: false, exercises: [], benAsked: true, benQuote: said }), () => replyWith('Done.')]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text: said, spoken: false }, turnId: h.ids() });
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['committed', 'Simple warm-up weights off']]);
    expect((await s.warmupPrefs.view())?.simpleLoads).toBe(false);
    expect(warmups(await load(s, sessionId))).not.toEqual(was);

    const card = r.cards[0];
    if (card === undefined) throw new Error('card');
    const undo = await s.coach.undo(card.record.actionId, `undo:${card.record.actionId}`);
    expect(undo.result.status).toBe('written');
    expect((await s.warmupPrefs.view())?.simpleLoads).toBe(true);
    expect(warmups(await load(s, sessionId))).toEqual(was);
  });
});
