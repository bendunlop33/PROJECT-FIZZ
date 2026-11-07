import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRequest } from '@fizz/coach';

import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Lift targets (Ben approved 20 Oct: "Yeah let's do lift targets as something that can be turned
 * on or off"): the setting hides everything while off; a target set from the plan block shows what
 * Ben had then and where he is now (est. labelled); a logged set at the target is `Hit <date>`; the
 * coach sees and sets them only while on, and only when Ben asks, with Undo.
 */

const plain = (x: string | null | undefined): string | null => (x == null ? null : x.replace(/\u00a0/g, ' '));

describe('lift targets in the app', () => {
  let h: Harness;
  let model: StepModel;
  beforeEach(() => {
    model = new StepModel([]);
    h = createHarness('2026-10-13T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
  });
  afterEach(async () => {
    await h.cleanup();
  });

  const block = (req: ModelRequest | undefined, head: string): string => {
    const b = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith(head));
    return b?.type === 'message' ? b.content : '';
  };

  it('off by default: nothing to show, the coach sees none and has no tool; on: the plan block can add one', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 5 }] }]);
    const off = await s.liftTargets.view();
    expect(off).toMatchObject({ on: false, lines: [], targets: [] });

    model = new StepModel([() => replyWith('Ok.')]);
    await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'I want to bench 100 kg by March', spoken: false }, turnId: h.ids() });
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('set_lift_target');
    expect(block(model.requests[0], 'YOUR DATA')).not.toContain('liftTargets');

    expect(await s.liftTargets.setOn(true, off?.version ?? 0, h.ids())).toMatchObject({ ok: true });
    const on = await s.liftTargets.view();
    expect(on?.on).toBe(true);
    expect(on?.canAdd).toBe(true);
    expect(on?.choices.map((c) => [c.name, c.convention, c.unit])).toEqual([['Bench press', 'total', 'kg']]);
  });

  it('set from the plan block: was, est. 1RM and time left; a logged single at the weight is Hit; Undo and Off hide it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 5 }] }]);
    let v = (await s.liftTargets.view())?.version ?? 0;
    expect(await s.liftTargets.setOn(true, v, h.ids())).toMatchObject({ ok: true });
    const view = await s.liftTargets.view();
    const bench = view?.choices[0];
    if (view === null || bench === undefined) throw new Error('no choice');
    const op = h.ids();
    const set = await s.liftTargets.set({ exerciseId: bench.exerciseId, kind: 'one_rm', value: 100, unit: 'kg', reps: 1, byDate: '2026-12-08', expectedVersion: view.version, opId: op });
    if (!set.ok) throw new Error(set.reason);
    // A double tap is the same write (rule 5).
    expect(await s.liftTargets.set({ exerciseId: bench.exerciseId, kind: 'one_rm', value: 100, unit: 'kg', reps: 1, byDate: '2026-12-08', expectedVersion: view.version, opId: op })).toMatchObject({ ok: true, version: set.version });
    // A stale version is refused.
    expect(await s.liftTargets.set({ exerciseId: bench.exerciseId, kind: 'one_rm', value: 110, unit: 'kg', reps: 1, byDate: null, expectedVersion: view.version, opId: h.ids() })).toMatchObject({ ok: false, reason: 'stale' });

    let line = (await s.liftTargets.view())?.lines[0];
    expect(plain(line?.title)).toBe('Bench press 100 kg');
    // 80 × (1 + 5/30) = 93.3 → est. 93.5, and the same when it was set.
    expect(plain(line?.detail)).toBe('est. 1RM 93.5 kg · was 93.5 kg on 13 Oct');
    expect(plain(line?.progress)).toBe('8 weeks left · ≈6.5 kg to go');
    expect(line?.hit).toBeNull();
    const detail = await s.liftTargets.forExercise(bench.exerciseId);
    expect(plain(detail?.line?.title)).toBe('Bench press 100 kg');

    // An estimate past the target isn't a hit; a logged single at 100 kg is.
    h.clockMs += 3 * 86_400_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 90, reps: 5 }] }]);
    line = (await s.liftTargets.view())?.lines[0];
    expect(plain(line?.detail)).toContain('est. 1RM 105 kg');
    expect(line?.hit).toBeNull();
    h.clockMs += 3 * 86_400_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 1 }] }]);
    line = (await s.liftTargets.view())?.lines[0];
    expect(plain(line?.hit)).toBe('Hit 19 Oct');
    expect(line?.progress).toBeNull();

    // Review S1: saving the same goal with a new date keeps its hit and "was".
    v = (await s.liftTargets.view())?.version ?? 0;
    expect(await s.liftTargets.set({ exerciseId: bench.exerciseId, kind: 'one_rm', value: 100, unit: 'kg', reps: 1, byDate: '2027-01-31', expectedVersion: v, opId: h.ids() })).toMatchObject({ ok: true });
    line = (await s.liftTargets.view())?.lines[0];
    expect(plain(line?.hit)).toBe('Hit 19 Oct');
    expect(plain(line?.detail)).toContain('was 93.5 kg on 13 Oct');

    // Off: every view is empty; the target is kept for when it's back on.
    v = (await s.liftTargets.view())?.version ?? 0;
    expect(await s.liftTargets.setOn(false, v, h.ids())).toMatchObject({ ok: true });
    expect((await s.liftTargets.view())?.lines).toEqual([]);
    expect((await s.liftTargets.forExercise(bench.exerciseId))?.line).toBeNull();
    v = (await s.liftTargets.view())?.version ?? 0;
    await s.liftTargets.setOn(true, v, h.ids());
    expect((await s.liftTargets.view())?.lines).toHaveLength(1);

    // Remove, then Undo brings back the same target.
    v = (await s.liftTargets.view())?.version ?? 0;
    const removed = await s.liftTargets.remove(bench.exerciseId, v, h.ids());
    if (!removed.ok) throw new Error('remove');
    expect((await s.liftTargets.view())?.lines).toEqual([]);
    expect(await s.liftTargets.restore(bench.exerciseId, removed.before, removed.version, h.ids())).toMatchObject({ ok: true });
    expect(plain((await s.liftTargets.view())?.lines[0]?.hit)).toBe('Hit 19 Oct');
  });

  it('per-hand dumbbells: a target per hand; assisted exercises are never offered', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [
      { exercise: 'Dumbbell bench press', sets: [{ load: 30, reps: 8 }] },
      { exercise: 'Lat pulldown', sets: [{ load: 50, reps: 10 }] },
    ]);
    const v = (await s.liftTargets.view())?.version ?? 0;
    await s.liftTargets.setOn(true, v, h.ids());
    const view = await s.liftTargets.view();
    const db = view?.choices.find((c) => c.name === 'Dumbbell bench press');
    expect(db?.convention).toBe('per_hand');
    if (view === null || db === undefined) throw new Error('no choice');
    const r = await s.liftTargets.set({ exerciseId: db.exerciseId, kind: 'weight_reps', value: 35, unit: 'kg', reps: 8, byDate: null, expectedVersion: view.version, opId: h.ids() });
    expect(r.ok).toBe(true);
    const line = (await s.liftTargets.view())?.lines[0];
    expect(plain(line?.title)).toBe('Dumbbell bench press 35 kg each × 8');
    expect(plain(line?.detail)).toBe('Best: 30 kg each × 8 on 13 Oct');
  });

  it('the coach: sees them while on; sets one Ben asks for with a card and Undo', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 5 }] }]);
    const v = (await s.liftTargets.view())?.version ?? 0;
    await s.liftTargets.setOn(true, v, h.ids());

    const said = 'I want to bench 100 kg by March';
    model = new StepModel([() => toolCall('set_lift_target', { exercise: 'bench press', kind: 'one_rm', load: 100, unit: 'kg', reps: null, byDate: '2027-03-01', benAsked: true, benQuote: said }), () => replyWith('Good goal.')]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: said, spoken: false }, turnId: h.ids() });
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('set_lift_target');
    expect(r.cards.map((c) => [c.record.status, plain(c.rendered.text)])).toEqual([['committed', 'Lift target: Bench press 100 kg by 1 Mar.']]);
    expect(plain((await s.liftTargets.view())?.lines[0]?.title)).toBe('Bench press 100 kg');

    // Next turn: the target is in YOUR DATA (est. 1RM labelled an estimate) with the planning line.
    model = new StepModel([() => replyWith('Ok.')]);
    await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Plan my week', spoken: false }, turnId: h.ids() });
    const mine = JSON.parse(block(model.requests[0], 'YOUR DATA').split('\n').slice(1).join('\n')) as { training?: { liftTargets?: unknown[] } };
    expect(mine.training?.liftTargets).toEqual([expect.objectContaining({ exercise: 'Bench press', target: '100 kg', estimatedOneRepMaxNow: { value: 93.5, date: '2026-10-13', isEstimate: true }, hit: null })]);
    expect(model.requests[0]?.instructions).toContain('liftTargets');

    const card = r.cards[0];
    if (card === undefined) throw new Error('card');
    const undo = await s.coach.undo(card.record.actionId, `undo:${card.record.actionId}`);
    expect(undo.result.status).toBe('written');
    expect((await s.liftTargets.view())?.lines).toEqual([]);
  });

  it('the coach’s own idea is only an offer; Apply sets exactly that target (review B1)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 5 }] }]);
    const v = (await s.liftTargets.view())?.version ?? 0;
    await s.liftTargets.setOn(true, v, h.ids());
    model = new StepModel([() => toolCall('set_lift_target', { exercise: 'bench press', kind: 'one_rm', load: 100, unit: 'kg', reps: null, byDate: null, benAsked: false, benQuote: null }), () => replyWith('Want a 100 kg target?')]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Bench is moving well', spoken: false }, turnId: h.ids() });
    expect(r.cards.map((c) => c.record.status)).toEqual(['proposed']);
    expect(r.offer).toBe('lift_target');
    expect((await s.liftTargets.view())?.lines).toEqual([]);
    // Apply: no model call, exactly the offered 100 kg.
    model = new StepModel([() => toolCall('set_lift_target', { exercise: 'bench press', kind: 'one_rm', load: 110, unit: 'kg', reps: null, byDate: null, benAsked: true, benQuote: 'Apply' })]);
    const a = await s.coach.send({ entry: { kind: 'today' }, threadId: r.threadId, input: { kind: 'accept_offer', offer: 'lift_target' }, turnId: h.ids() });
    expect(a.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect((await s.liftTargets.view())?.targets.map((t) => t.load.value)).toEqual([100]);
  });
});
