import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Review B3 (docs/reviews/retire-workout-overview.md): the coach's `next workout` change
 * (`propose_next_workout_change`, ADR 0020 §3) used to be written into the Workout overview's pre-start draft when
 * that page loaded. The overview is retired (Ben, 22 Oct) and nothing else reads that draft: Your workout and
 * Today's Start plan from builder drafts. An Apply would land nowhere while the card said `Applied` (rules 1-3), so
 * the tool is withheld until it lands in the builder again (open for Ben), and an older card can't be applied.
 * `get_substitutions` stays. The structural checks themselves stay unit-tested in `@fizz/domain` and `@fizz/coach`.
 * Real SQLite, scripted model, offline for everything but the scripted coach.
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

const ask = (s: AppServices, text: string) => s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

async function againNames(s: AppServices, sessionId: string, opId: string): Promise<string[]> {
  const r = await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, opId);
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(r.message);
  return slotsOf(r.snapshot.workout.blocks).map((x) => r.snapshot.facts[x.exerciseId]?.name ?? '?');
}

describe('the coach’s next-workout change is withheld (review B3)', () => {
  it('Ben asks for a swap next time: the tool isn’t offered (swap options still are), no card, and Your workout is unchanged', async () => {
    const { s, sessionId } = await pushDay();
    const before = await againNames(s, sessionId, 'open-before');
    expect(before).toEqual(['Bench press', 'Lateral raise', 'Triceps pushdown']);
    model = new StepModel([() => replyWith('A cable kickback would be a fair swap next time.')]);
    const r = await ask(s, 'Swap the triceps pushdown for something else next time');
    expect(r.status).toBe('completed');
    const tools = model.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(tools).toContain('get_substitutions');
    expect(tools).not.toContain('propose_next_workout_change');
    expect(r.cards).toEqual([]);
    expect(await againNames(s, sessionId, 'open-after')).toEqual(before);
  });

  it('a pain flag since the workout (a structural signal) doesn’t open it either', async () => {
    const { s, sessionId } = await pushDay();
    const agg = (await s.workout.load(sessionId))?.aggregate;
    const bench = agg?.exercises.find((e) => e.exerciseName === 'Bench press');
    expect((await s.pain.flagMovement({ exerciseId: bench?.exerciseId ?? '', exerciseName: 'Bench press', opId: 'pain-1' })).ok).toBe(true);
    model = new StepModel([() => replyWith('Noted.')]);
    await ask(s, 'What should I change?');
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('propose_next_workout_change');
  });

  it('a call to it anyway changes nothing and makes no card (rule 3)', async () => {
    const { s, sessionId } = await pushDay();
    const agg = (await s.workout.load(sessionId))?.aggregate;
    const push = agg?.exercises.find((e) => e.exerciseName === 'Triceps pushdown');
    model = new StepModel([
      () => toolCall('propose_next_workout_change', { sourceSessionId: sessionId, sourceVersion: agg?.session.version ?? 1, changes: [{ change: 'remove', exerciseId: push?.exerciseId }], reason: 'Shorter.' }),
      () => replyWith('Ok.'),
    ]);
    const r = await ask(s, 'Drop the pushdowns next time');
    expect(r.cards.filter((c) => c.record.detail.kind === 'propose_next_workout_change')).toEqual([]);
    expect(await againNames(s, sessionId, 'open-after-call')).toEqual(['Bench press', 'Lateral raise', 'Triceps pushdown']);
  });

  it('Apply on an unknown or older card is refused', async () => {
    const { s } = await pushDay();
    expect(await s.coach.tapProposal('00000000-0000-4000-8000-00000000abcd', 'apply')).toMatchObject({ ok: false });
  });
});
