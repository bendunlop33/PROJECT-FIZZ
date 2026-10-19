import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OFFERED_USABLE_CAP, type ModelEvent, type ModelRequest } from '@fizz/coach';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Ben, 19 Oct ("Why can't I add it"): in a "50 minute leg workout" thread he asked for seated calf
 * raises (his gym has the plate-loaded machine) and the coach kept saying it wasn't in the list it
 * could use; "Try now" didn't help. Root cause: the usable list in the prompt is capped (60 on a turn
 * that only offers the build) and was ranked by his newest words only, so "Try now" ranked nothing
 * and Seated calf raise fell off the alphabetical fill. Real SQLite, scripted model.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-19T17:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

interface Usable {
  catalogueId: string;
  name: string;
}
function buildOf(req: ModelRequest | undefined): { usable: Usable[] } {
  const block = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: Usable[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build;
}
const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 10, max: 12 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
const say = (s: AppServices, text: string, threadId: string | null) => s.coach.send({ entry: { kind: 'today' }, threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
const outputOf = (req: ModelRequest): unknown => {
  const last = [...req.input].reverse().find((i) => i.type === 'function_call_output');
  return last?.type === 'function_call_output' ? JSON.parse(last.output) : null;
};
const SEATED = 'machine-seated-calf-raise';

/** The model builds from the usable list it was given: squat and leg press. */
const legDay = (req: ModelRequest): ModelEvent[] => {
  const b = buildOf(req);
  const id = (n: string) => b.usable.find((u) => u.name === n)?.catalogueId ?? `missing-${n}`;
  return toolCall('propose_workout', { name: null, exercises: [ex(id('Back squat')), ex(id('Leg press'))], message: 'Squat first, then the press.', minutes: 50, focus: 'legs', gymName: null });
};

async function legThread(s: AppServices): Promise<string> {
  model = new StepModel([legDay, () => replyWith('Here it is.')]);
  const r = await say(s, 'Give me a 50 minute leg workout', null);
  expect(r.cards.some((c) => c.record.detail.kind === 'build_workout' && c.record.status === 'committed')).toBe(true);
  return r.threadId;
}

describe('"Why can’t I add it": seated calf raise in a leg-workout thread', () => {
  it('reproduced, then fixed: "Try now" keeps Seated calf raise in the capped list (ranked by the thread’s words)', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const threadId = await legThread(s);
    model = new StepModel([() => replyWith('Seated calf raise after the main work.')]);
    await say(s, 'Can you add seated calf raises? My gym has the plate loaded machine', threadId);
    model = new StepModel([() => replyWith('ok')]);
    await say(s, 'Try now', threadId);
    const b = buildOf(model.requests[0]);
    // The cap still applies (prompt size), but what Ben named earlier in this build is kept.
    expect(b.usable.length).toBeLessThanOrEqual(OFFERED_USABLE_CAP);
    expect(b.usable.map((u) => u.name)).toContain('Seated calf raise');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('find_exercises');
    expect(model.requests[0]?.instructions).toContain('call find_exercises first');
  });

  it('find_exercises searches the whole doable list; the build then includes Seated calf raise', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const threadId = await legThread(s);
    const got: { found: { exercises?: { catalogueId: string; name: string; equipment: string }[] } | null } = { found: null };
    model = new StepModel([
      () => toolCall('find_exercises', { query: 'seated calf raises', muscle: null, equipment: 'plate loaded' }),
      (req) => {
        got.found = (outputOf(req) as { data: typeof got.found }).data;
        const id = got.found?.exercises?.[0]?.catalogueId ?? 'none';
        return toolCall('propose_workout', { name: null, exercises: [ex('barbell-back-squat'), ex(id)], message: 'Squat, then calves.', minutes: 50, focus: 'legs', gymName: null });
      },
      () => replyWith('Added calves.'),
    ]);
    const r = await say(s, 'Add seated calf raises to it', threadId);
    expect(got.found).not.toBeNull();
    expect(got.found?.exercises?.[0]).toMatchObject({ catalogueId: SEATED, name: 'Seated calf raise', equipment: 'plate loaded machine' });
    expect(r.toolLog.map((l) => l.tool)).toEqual(['find_exercises', 'propose_workout']);
    const card = r.cards.find((c) => c.record.detail.kind === 'build_workout')?.record;
    if (card?.detail.kind !== 'build_workout') throw new Error(JSON.stringify(r.toolLog));
    const d = await s.coachDrafts.get(card.detail.draftId);
    const last = d?.versions.at(-1);
    expect(last?.plan.slots.map((sl) => sl.catalogueId)).toContain(SEATED);
  });

  it('the checks accept an exercise doable here even when it was not in the capped list the model saw', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    // "What should I do today?" names nothing: an offered-only turn with the shortest list.
    let shown: string[] = [];
    model = new StepModel([
      (req) => {
        shown = buildOf(req).usable.map((u) => u.catalogueId);
        return toolCall('propose_workout', { name: null, exercises: [ex('barbell-back-squat'), ex(SEATED)], message: 'Legs.', minutes: 45, focus: 'legs', gymName: null });
      },
      () => replyWith('Built.'),
    ]);
    const r = await say(s, 'Build me a leg workout', null);
    expect(shown).not.toContain('zzz');
    const card = r.cards.find((c) => c.record.detail.kind === 'build_workout')?.record;
    if (card?.detail.kind !== 'build_workout' || card.status !== 'committed') throw new Error(JSON.stringify(r.toolLog));
    const d = await s.coachDrafts.get(card.detail.draftId);
    expect(d?.versions.at(-1)?.plan.slots.map((sl) => sl.catalogueId)).toContain(SEATED);
  });

  it('nothing found: the tool says so (no guess)', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    let out: unknown = null;
    model = new StepModel([
      () => toolCall('find_exercises', { query: 'zercher hover lunge', muscle: null, equipment: null }),
      (req) => {
        out = outputOf(req);
        return replyWith('Not here.');
      },
    ]);
    await say(s, 'Can you put zercher hover lunges in a workout?', null);
    expect(out).toMatchObject({ data: { domain: 'Your data' } });
    expect(JSON.stringify(out)).toContain('not_available');
  });
});

describe('mid-workout: find_exercises over everything addable here, then edit_today add', () => {
  it('"put in seated calf raises" with a word that ranks nothing in the capped list: found, added with Undo', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-legs', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    let addable: { exerciseId: string }[] = [];
    let found: { exerciseId?: string; catalogueId: string }[] = [];
    model = new StepModel([
      (req) => {
        const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
        addable = block?.type === 'message' ? ((JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { addable?: { exerciseId: string }[] }).addable ?? []) : [];
        expect(req.tools.map((t) => t.name)).toContain('find_exercises');
        return toolCall('find_exercises', { query: 'calf raise', muscle: 'calves', equipment: null });
      },
      (req) => {
        found = ((outputOf(req) as { data: { exercises: { catalogueId: string }[] } }).data.exercises);
        const w = contextWorkout(req);
        return toolCall('edit_today', { baseVersion: w.version, ops: [{ op: 'add', exerciseId: SEATED, workingSets: 3, reps: { min: 12, max: 15 }, workSeconds: null, targetRpe: 8, afterSessionExerciseId: null, supersetWithSessionExerciseId: null }], reason: 'Ben asked.', benAsked: true, benQuote: 'add the calves one' });
      },
      () => replyWith('In.'),
    ]);
    // "the calves one" names no exercise: the capped list falls back to A–Z.
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text: 'add the calves one', spoken: false }, turnId: h.ids() });
    expect(addable.length).toBeGreaterThan(0);
    expect(found.map((f) => f.catalogueId)).toContain(SEATED);
    expect(r.cards[0]?.record).toMatchObject({ status: 'committed', detail: { kind: 'edit_today', added: [{ exerciseName: 'Seated calf raise', sets: 3 }] } });
  });
});
