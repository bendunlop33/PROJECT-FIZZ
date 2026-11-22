import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createExerciseListExecutors } from '@fizz/coach';
import { buildExercisePickerView, currentGymEquipment, doableHere, type PickerEntry, type PickerIndex } from '@fizz/domain';
import type { CustomExerciseFields, Exercise } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { createHarness, type Harness } from './harness';

/**
 * (Ben, 27 Oct: "when I searched exercise bike it didn't come up … check others too") Every exercise Ben has (the
 * whole bundled catalogue plus one of his own), at three gyms (the default full gym, a dumbbell-only home gym, an
 * empty gym): searching its exact name, each alias, a lowercase part of its name and its words in another order finds
 * it in every Add picker (the workout in progress, the workout editor, Your workout), and the coach's
 * `find_exercises` resolves it (usable here, or in Ben's list with the reason it can't be added now; never "not in
 * the list"). The only exercises a host leaves out are the ones its write refuses, named here (`EXPECTED_OUT`).
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-27T08:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const MINE: CustomExerciseFields = { name: 'Zottman curl (mine)', equipment: 'dumbbells', loadConvention: 'per_hand', primaryMuscles: ['biceps'], measurement: 'reps', laterality: 'bilateral' };

type GymKind = 'full' | 'home_dumbbells' | 'empty';

async function gym(s: AppServices, kind: GymKind): Promise<string> {
  await s.setup.saveUnits('kg');
  const draft =
    kind === 'full'
      ? s.coachingKnowledge.buildQuickGymDraft({ setup: 'full', unit: 'kg', dumbbellStep: 2 })
      : s.coachingKnowledge.buildQuickGymDraft({ setup: 'home', unit: 'kg', dumbbells: kind === 'empty' ? null : { max: 30, step: 2 }, extras: [] });
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft });
  await s.setup.complete();
  const g = await s.yourData.currentGym();
  if (!g) throw new Error('no gym');
  return g.id;
}

const opened = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status === 'written' || r.status === 'replayed') return r.snapshot;
  throw new Error(`builder ${r.status}`);
};

/** What Ben might type for one exercise. */
function queriesFor(e: PickerEntry): string[] {
  const name = e.exercise.name;
  const lower = name.toLowerCase();
  const words = lower.split(/\s+/);
  const partial = lower.slice(0, Math.max(3, Math.ceil(lower.length * 0.6))).trim();
  return [...new Set([name, ...e.aliases, partial, ...(words.length > 1 ? [[...words].reverse().join(' ')] : [])])];
}

const found = (index: PickerIndex, query: string, id: string): boolean =>
  buildExercisePickerView({ index, query, group: null, exclude: [], suggested: [] }).sections.some((s) => s.parts.some((p) => p.rows.some((r) => r.exerciseId === id)));

/** What each host leaves out by design: the same refusal its write makes. */
const EXPECTED_OUT = {
  // A saved workout has no distance target (EL-B13).
  template: (e: PickerEntry) => e.exercise.measurement === 'distance',
  // Your workout: distance-only work (carries, sleds) has no time or reps target the builder holds.
  builder: (e: PickerEntry) => e.exercise.measurement === 'distance',
} as const;

describe.each<GymKind>(['full', 'home_dumbbells', 'empty'])('every exercise is found at a %s gym', (kind) => {
  it('in every Add picker, by name, alias, part of the name and words in another order; and by the coach', async () => {
    const { services: s } = await h.launch();
    const gymId = await gym(s, kind);
    const mine = await s.customExercises.create({ fields: MINE, opId: 'mine' });
    if (!mine.ok) throw new Error('custom exercise');
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const session = await s.exercisePicker.forSession(started.aggregate.session.id, null);
    const all = session.entries;
    // The whole catalogue (237) and Ben's own.
    expect(all.length).toBeGreaterThanOrEqual(238);
    expect(all.some((e) => e.exercise.name === MINE.name)).toBe(true);

    const template = await s.exercisePicker.forTemplate(gymId);
    const draft = opened(await s.builder.create(await s.builder.initialSetup({ dayId: 'legs' }), 'legs'));
    const builderAdd = await s.exercisePicker.forDraft(draft.draftId, { add: true });

    // The coach's lookup, as the coach service builds it: usable here first, the rest of his list with a reason.
    const gymNow = (await s.yourData.currentGym()) ?? null;
    const snapGym = { id: gymId, name: 'Main Gym', equipment: currentGymEquipment(started.aggregate.session) };
    const usable = all.filter((e) => e.exercise.measurement !== 'distance' && doableHere(e.exercise as Exercise, snapGym));
    const usableIds = new Set(usable.map((e) => e.exercise.id));
    const find = createExerciseListExecutors({
      pool: () => Promise.resolve(usable.map((e) => ({ catalogueId: e.exercise.id, exercise: e.exercise, aliases: e.aliases }))),
      elsewhere: () => Promise.resolve(all.filter((e) => !usableIds.has(e.exercise.id)).map((e) => ({ catalogueId: e.exercise.id, exercise: e.exercise, aliases: e.aliases, why: 'not here' }))),
    }).find_exercises;
    if (find === undefined || gymNow === null) throw new Error('no find');

    const misses: string[] = [];
    for (const e of all) {
      const id = e.exercise.id;
      for (const q of queriesFor(e)) {
        if (!found(session, q, id)) misses.push(`workout Add: ${e.exercise.name} ← "${q}"`);
        if (!EXPECTED_OUT.template(e) && !found(template, q, id)) misses.push(`editor: ${e.exercise.name} ← "${q}"`);
        if (!EXPECTED_OUT.builder(e) && !found(builderAdd, q, id)) misses.push(`Your workout Add: ${e.exercise.name} ← "${q}"`);
      }
      // The coach: by name and each alias (what Ben says), with the role words around it ("8 min … warm up").
      for (const q of [e.exercise.name, ...e.aliases, `10 min ${e.exercise.name} warm up`]) {
        const r = await find({ tool: 'find_exercises', args: { query: q, muscle: null, equipment: null } }, { ownerId: 'o', turnId: 't', opId: 'op', now: h.now() } as never);
        const text = JSON.stringify(r);
        if (!text.includes(`"catalogueId":"${id}"`)) misses.push(`coach: ${e.exercise.name} ← "${q}"`);
      }
    }
    expect(misses).toEqual([]);
  }, 600_000);
});
