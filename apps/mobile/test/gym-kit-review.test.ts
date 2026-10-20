import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP, NO_FILTERS } from '@fizz/domain';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Review ben-kit (20 Oct; ADR 0030) through the app services on real SQLite:
 * a lift left out for a missing rack says so (overview, Start, the set card
 * after a relaunch, the picker); the coach's "no bench here" takes effect on
 * a gym with no bench record and its Undo brings the exercises back; Why?
 * names an assumed incline bench.
 */
const DAY = 86_400_000;
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-20T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function hotelWithBarNoRack(s: AppServices): Promise<string> {
  const hotelId = h.ids();
  const r = await s.setup.saveGym({ gymId: hotelId, name: 'Hotel', draft: s.coachingKnowledge.buildQuickGymDraft({ setup: 'small', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: ['bench', 'barbell'] }), setup: 'small' });
  if (!r.ok) throw new Error(r.message);
  return hotelId;
}

describe('B1 and S5: a routine lift left out for a missing rack', () => {
  it('the overview and Start name the rack; the stored fit reads the same after a relaunch; the picker says Needs a rack', async () => {
    const { services: s } = await h.launch();
    const mainId = await setUpGym(h, s);
    const first = await logWorkout(h, s, mainId, [
      { exercise: 'Overhead press', sets: [{ load: 40, reps: 5 }, { load: 40, reps: 5 }] },
      { exercise: 'Dumbbell bench press', sets: [{ load: 20, reps: 10 }] },
    ]);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Press', opId: 'save-1', addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    h.clockMs += 2 * DAY;
    const hotelId = await hotelWithBarNoRack(s);

    const page = await s.overview.load({ target: { kind: 'next' }, gymId: hotelId });
    if (!page) throw new Error('no overview');
    const press = page.view.rows.find((r) => r.name === 'Overhead press');
    expect(press?.load.value).toBe('—');
    expect(press?.missingEquipment).toBe('rack');
    // The bench is here: the dumbbell bench press keeps its target.
    expect(page.view.rows.find((r) => r.name === 'Dumbbell bench press')?.missingEquipment).toBeNull();

    const started = await s.overview.start({ startOf: page.startOf, gymId: hotelId, opId: 'start-hotel', checkIn: null, expectedPreviewKey: page.view.previewKey });
    if (!started.ok) throw new Error(JSON.stringify(started.error));
    const sessionId = started.aggregate.session.id;
    const pressEx = started.aggregate.exercises.find((e) => e.exerciseName === 'Overhead press');
    const pressSets = started.aggregate.sets.filter((x) => x.sessionExerciseId === pressEx?.id && x.setType !== 'warmup');
    expect(pressSets.length).toBeGreaterThan(0);
    expect(pressSets.every((x) => x.planned.load === null && x.planned.snap?.reason === 'not_here' && x.planned.snap.stations?.join() === 'rack')).toBe(true);

    // Force-close and relaunch: the stored fit is read, not re-run.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const data = await s2.workout.load(sessionId);
    if (!data) throw new Error('no workout');
    const reloaded = data.aggregate.sets.filter((x) => x.sessionExerciseId === pressEx?.id && x.setType !== 'warmup');
    expect(reloaded.map((x) => x.planned.snap)).toEqual(pressSets.map((x) => x.planned.snap));
    const v = s2.workout.view(data, h.clockMs, null);
    expect(v.focus?.exerciseName).toBe('Overhead press');
    expect(plain(v.focus?.snapNote?.text)).toBe('No load target · no rack here · plan 40 kg');

    const picks = await s2.workout.pickerExercises(sessionId, 'Overhead press');
    const ohp = picks.find((p) => p.exercise.name === 'Overhead press');
    expect([ohp?.equipment, ohp?.needs]).toEqual([[], ['rack']]);
  });
});

describe('B3: the coach’s "no bench here" on a gym set up before benches existed', () => {
  const say = (s: AppServices, text: string) => s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

  it('Apply leaves the bench exercises out; Undo brings them back', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gymId = h.ids();
    // The commercial preset without its bench and rack: no record of either, as Ben's gyms are today.
    const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
    const r = await s.setup.saveGym({ gymId, name: 'Main Gym', draft: { ...draft, items: draft.items.filter((i) => i.equipment.kind !== 'bench' && i.equipment.kind !== 'rack') } });
    if (!r.ok) throw new Error(r.message);
    await s.setup.complete();

    // Library › At Main Gym: what this gym can do now (read from the gym as saved).
    const atGym = async (name: string) => {
      const b = await s.library.browse({ query: name, filters: { ...NO_FILTERS, atGym: true } });
      return (b?.view.sections ?? []).some((x) => x.rows.some((r) => r.name === name));
    };
    expect(await atGym('Dumbbell bench press')).toBe(true);

    model = new StepModel([() => toolCall('update_gym', { gymName: null, changes: [{ op: 'remove', equipment: 'bench' }], reason: 'Ben said so', benAsked: true, benQuote: 'this gym has no bench' }), () => replyWith('Got it.')]);
    const said = await say(s, 'this gym has no bench');
    const card = said.cards.find((c) => c.record.detail.kind === 'update_gym')?.record;
    expect(card).toMatchObject({ status: 'committed', detail: { lines: ['Bench: not here'] } });

    expect(await atGym('Dumbbell bench press')).toBe(false);
    expect(await atGym('Incline dumbbell press')).toBe(false);
    expect(await atGym('Dumbbell curl')).toBe(true);
    // A workout started now plans no bench work's picker items, and says why.
    const started = await s.workout.start({ gymId, opId: 'start-after', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const gone = (await s.workout.pickerExercises(started.aggregate.session.id, 'Dumbbell bench press')).find((x) => x.exercise.name === 'Dumbbell bench press');
    expect([gone?.equipment, gone?.needs]).toEqual([[], ['bench']]);

    await s.coach.undo(card?.actionId ?? '', 'u1');
    expect(await atGym('Dumbbell bench press')).toBe(true);
    expect(await atGym('Incline dumbbell press')).toBe(true);
    // Back to no record at all (a retired one would still say "no bench here").
    expect((await s.yourData.equipment(gymId)).some((e) => e.kind === 'bench')).toBe(false);
  });
});

describe('N1: Why? names an assumed incline bench', () => {
  it('an incline press on a full gym’s assumed adjustable bench says so', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gymId = h.ids();
    const r = await s.setup.saveGym({ gymId, name: 'Main gym', draft: s.coachingKnowledge.buildQuickGymDraft({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 }), setup: 'full' });
    if (!r.ok) throw new Error(r.message);
    await s.setup.complete();
    await logWorkout(h, s, gymId, [{ exercise: 'Incline dumbbell press', sets: [1, 2, 3].map(() => ({ load: 20, reps: 10, rpe: 8 })) }]);
    h.clockMs += 2 * DAY;
    const started = await s.workout.start({ gymId, opId: 'start-2', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const p = (await s.workout.pickerExercises(sessionId, 'Incline dumbbell press')).find((x) => x.exercise.name === 'Incline dumbbell press');
    const added = await s.workout.addExercise({ sessionId, exerciseId: p?.exercise.id ?? '', equipmentId: p?.equipment[0]?.id ?? null, opId: 'add-1' });
    if (!added.ok) throw new Error(added.error.message);
    const e = await s.workout.explainTarget(sessionId, added.aggregate.sets[0]?.id ?? '');
    const equipment = e?.rows.find((x) => x.key === 'equipment')?.lines.map(plain).join(' ');
    expect(equipment).toContain('Assumed dumbbells');
    expect(equipment).toContain('Assumed incline bench');
  });
});
