import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, type Harness } from './harness';

/**
 * (Ben, 1 Nov) The coach's `set_main_lift` for today: `edit_today`'s `main` op, in every chat with the workout live
 * (ADR 0039), through the workout's own `set_main_lift` step: applied at once when Ben asks, no set changes, Undo on
 * the card. Real SQLite, scripted model. No migration: the record is `edit_today`'s.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-26T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function livePlanWorkout(s: AppServices): Promise<{ sessionId: string }> {
  await s.setup.saveUnits('kg');
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
  await s.setup.complete();
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5] }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  if (!(await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() })).ok) throw new Error('not applied');
  const gym = await s.yourData.currentGym();
  const d = await s.todaySession.load();
  const day = d?.days.find((x) => x.key === d.nextKey);
  const controls = day === undefined ? undefined : d?.initial[day.key];
  if (gym === null || d == null || day === undefined || controls === undefined) throw new Error('no Up next');
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId: gym.id, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  return { sessionId: r.aggregate.session.id };
}

const say = (s: AppServices, text: string, entry: { kind: 'today' } | { kind: 'workout'; sessionId: string }) => s.coach.send({ entry, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
const second = (req: ModelRequest): ModelEvent[] => {
  const w = contextWorkout(req);
  const ex = w.exercises[1];
  if (ex === undefined) throw new Error('no second exercise');
  return toolCall('edit_today', { baseVersion: w.version, ops: [{ op: 'main', sessionExerciseId: ex.sessionExerciseId }], reason: 'Ben asked.', benAsked: true, benQuote: 'make the second one my main lift today' });
};

describe('set_main_lift from the coach', () => {
  for (const from of ['workout', 'today'] as const) {
    it(`from ${from === 'workout' ? 'the live workout’s sheet' : 'Today'}: applied at once, no set changes, Undo`, async () => {
      const { services: s } = await h.launch();
      const { sessionId } = await livePlanWorkout(s);
      const before = (await s.workout.load(sessionId))?.aggregate;
      if (before === undefined) throw new Error('no workout');
      const target = [...before.exercises].sort((a, b) => a.order - b.order)[1];
      model = new StepModel([second, () => replyWith('Done.')]);
      const r = await say(s, 'make the second one my main lift today', from === 'workout' ? { kind: 'workout', sessionId } : { kind: 'today' });
      expect(model.requests[0]?.tools.map((t) => t.name)).toContain('edit_today');
      const record = r.cards[0]?.record;
      expect([record?.detail.kind, record?.status]).toEqual(['edit_today', 'committed']);
      const after = (await s.workout.load(sessionId))?.aggregate;
      expect(after?.session.planDay?.mainLiftExerciseId).toBe(target?.exerciseId);
      expect(after?.sets.map((x) => [x.id, x.status, x.planned.load, x.planned.reps, x.rest.seconds])).toEqual(before.sets.map((x) => [x.id, x.status, x.planned.load, x.planned.reps, x.rest.seconds]));
      if (record === undefined) throw new Error('no card');
      expect((await s.coach.undo(record.actionId, `undo:${record.actionId}`)).result.status).toBe('written');
      expect((await s.workout.load(sessionId))?.aggregate.session.planDay?.mainLiftExerciseId).toBe(before.session.planDay?.mainLiftExerciseId);
    });
  }
});
