import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';

import type { BuilderSnapshot, SetupInput } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, StepModel } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Review b3-builder-20oct fixes on real SQLite (B1–B4, S1–S9): each case
 * reproduces the reviewer's failure and checks the fixed behaviour.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  const model = new StepModel([]);
  h = createHarness('2026-10-20T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${'message' in r ? String(r.message) : ''}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};
const names = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((sl) => snap.facts[sl.exerciseId]?.name ?? '?');
const slotNamed = (snap: BuilderSnapshot, name: string) => {
  const sl = slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.name === name);
  if (sl === undefined) throw new Error(`no ${name} in ${names(snap).join(', ')}`);
  return sl;
};
const pushSetup = async (s: AppServices, over: Partial<SetupInput> = {}): Promise<SetupInput> => ({ ...(await s.builder.initialSetup({ dayId: 'push' })), ...over });

async function withPushdown(s: AppServices, snap: BuilderSnapshot): Promise<BuilderSnapshot> {
  if (names(snap).includes('Triceps pushdown')) return snap;
  const c = await s.builder.exerciseChoices(snap.draftId, { slotKey: null, group: 'Triceps' });
  const pd = c?.sections.flatMap((x) => x.items).find((i) => i.name === 'Triceps pushdown');
  if (pd === undefined) throw new Error('no pushdown');
  return ok(await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: pd.exerciseId }, { opId: 'add-pd', basis: { version: snap.version } })).snapshot;
}

describe('B3: the built-in rule’s load stands as the rule gave it', () => {
  it('hold after a miss on 8–12: 50 × 9 @ 8 stays 50, Why reads Last time', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Triceps pushdown', sets: [{ load: 50, reps: 9, rpe: 8 }, { load: 50, reps: 9, rpe: 8 }, { load: 50, reps: 9, rpe: 8 }] }]);
    h.clockMs += DAY;
    const snap = await withPushdown(s, ok(await s.builder.create(await pushSetup(s), 'c-1')).snapshot);
    const pd = slotNamed(snap, 'Triceps pushdown');
    expect(pd.source).toBe('rule');
    const work = pd.rows.filter((r) => r.type !== 'warmup');
    expect(work.every((r) => r.load === 50)).toBe(true);
    expect(await s.builder.whyWeight(snap.draftId, pd.key)).toEqual(['Last time']);
  });

  it('an increase on 8–12 is the rule’s own next load, never more', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Triceps pushdown', sets: [{ load: 50, reps: 12, rpe: 8 }, { load: 50, reps: 12, rpe: 8 }, { load: 50, reps: 12, rpe: 8 }] }]);
    h.clockMs += DAY;
    const snap = await withPushdown(s, ok(await s.builder.create(await pushSetup(s), 'c-1')).snapshot);
    const pd = slotNamed(snap, 'Triceps pushdown');
    const work = pd.rows.filter((r) => r.type !== 'warmup').map((r) => r.load ?? 0);
    const top = Math.max(...work);
    expect(top).toBeGreaterThan(50);
    // One step up from last time (a stack step is at most 5 kg here), never a formula rescale.
    expect(top - 50).toBeLessThanOrEqual(5);
    const why = await s.builder.whyWeight(snap.draftId, pd.key);
    expect(why[0]).toBe(`Last time + ${String(top - 50)}`);
  });
});
