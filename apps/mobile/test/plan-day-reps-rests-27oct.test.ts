import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { AppServices } from '../src/services/app-services';
import type { TodaySelection, TodaySessionData } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 27 Oct) Today drafts a plan day exactly as stored, its reps and rests too. Setup as live-time-27oct.
 * Original note there: (Ben, 27 Oct: "if I add an exercise without changing the time it changes the time automatically, and if I manually
 * change an exercise it should update too") Time shows the live estimate of the workout on the page, by the one
 * estimate (`estimateBuilderSeconds`) on Today's card, Your workout and the workout editor; `Time ±` steps from it and
 * fits; Ben's own edits are never cut to hold the length, and past it the number is in the warning tone. Real SQLite,
 * offline, no coach call for any of it.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Monday 12 Oct 2026, 08:00 in London.
  h = createHarness('2026-10-12T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

type Ex = [string, Record<string, unknown>?];
const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });
const kgLoad = (value: number, convention = 'total') => ({ value, unit: 'kg', convention, basis: 'last time, same reps', from: 'own_history', relatedCatalogueId: null });
const DAYS: [string, string | null, Ex[]][] = [
  ['Push', 'push', [['Bench press', { reps: { min: 6, max: 8 }, load: kgLoad(100) }], ['Incline dumbbell press', { load: kgLoad(27.5, 'per_hand') }], ['Triceps pushdown', { load: kgLoad(30, 'stack') }]]],
  ['Pull', 'pull', [['Lat pulldown', { load: kgLoad(60, 'stack') }], ['Barbell row', { reps: { min: 6, max: 8 }, load: kgLoad(70) }]]],
  ['Legs', 'legs', [['Back squat', { reps: { min: 5, max: 6 }, load: kgLoad(100) }]]],
];

function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map(([n, over]) => ex(idOf(n), over ?? {})) })), message: 'Push, pull, legs.', minutes: null, gymName: null });
};

async function benWithPlan() {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] }]);
  h.clockMs += DAY;
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
  const card = r.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const planId = card.detail.planId;
  const c = await s.plans.card({ planId, versionN: 1 });
  expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  h.clockMs += 3_600_000;
  return { s, gymId, planId };
}

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no data');
  return d;
}
const sel = (data: TodaySessionData, dayKey: string, over: Partial<TodaySelection['controls']> = {}): TodaySelection => {
  const c = data.initial[dayKey];
  if (c === undefined) throw new Error(`no controls for ${dayKey}`);
  return { dayKey, controls: { ...c, ...over } };
};
const dayKeyOf = (data: TodaySessionData, name: string) => data.days.find((d) => d.name === name)?.key ?? '';

const plain = (t: string) => t.replaceAll(NBSP, ' ');

describe('Today drafts the plan day’s stored reps and rests (Ben, 27 Oct)', () => {
  it('edit a plan day’s reps and rest in Library › Plan › day › Edit: Today’s card shows them and its time moves; a started workout keeps what it started with', async () => {
    const { s, gymId } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const before = s.todaySession.card(data, sel(data, key));
    const routineId = data.days.find((d) => d.key === key)?.templates[0]?.routineId ?? '';
    const ed = await s.routines.editor({ routineId, gymId });
    if (ed === null || before === null || ed.routine === null) throw new Error('no editor');
    const inclineName = before.list.find((r) => r.fullName.toLowerCase().includes('incline'))?.fullName ?? '';
    expect(plain(before.list.find((r) => r.fullName === inclineName)?.sets ?? '')).toBe('3 × 8–10');

    // Ben sets Incline press to 15–20 reps and 2:30 rest on the plan day, and saves.
    const exercises = ed.exercises.map((e, i) =>
      i !== ed.exercises.findIndex((x) => x.setTemplates.length > 0 && x.exerciseId === before.list.find((r) => r.fullName === inclineName)?.exerciseId)
        ? e
        : { ...e, restBySetType: { working: { seconds: 150 } }, setTemplates: e.setTemplates.map((t) => (t.setType === 'warmup' ? t : { ...t, targetReps: { min: 15, max: 20 } })) },
    );
    const saved = await s.routines.update({ routineId, edit: { name: ed.routine.name, exercises }, expectedVersion: ed.routine.version, opId: 'save-reps-rest' });
    expect(saved.ok).toBe(true);

    const after = await loaded(s);
    const card = s.todaySession.card(after, sel(after, key));
    expect(plain(card?.list.find((r) => r.fullName === inclineName)?.sets ?? '')).toBe('3 × 15–20');
    expect(card?.minutes ?? 0).toBeGreaterThan(before.minutes);
    // The editor times the day the same way (one estimate).
    expect(await s.routines.estimate({ exercises, gymId, routineId })).toBe(card?.minutes);

    // Started: the workout has the plan day's reps and rest; a later plan-day edit doesn't touch it (rule 2).
    const c = await s.todaySession.commit(after, sel(after, key), 'commit-1');
    if (!c.ok) throw new Error(c.message);
    const started = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: 'start-1', checkIn: null });
    if (!started.ok) throw new Error('not started');
    const active = await s.sessions.active();
    if (active === null) throw new Error('no session');
    const inclineEx = active.exercises.find((e) => e.exerciseName === inclineName);
    const workSets = active.sets.filter((x) => x.sessionExerciseId === inclineEx?.id && x.setType === 'working');
    expect(workSets.length).toBe(3);
    expect(workSets.every((x) => x.planned.reps?.min === 15)).toBe(true);
    expect(workSets.every((x) => x.rest.seconds === 150)).toBe(true);
    const snapshotOf = (a: typeof active) => JSON.stringify(a.sets.map((x) => [x.id, x.planned, x.rest]));
    const was = snapshotOf(active);

    const ed2 = await s.routines.editor({ routineId, gymId });
    if (ed2 === null || ed2.routine === null) throw new Error('no editor');
    const again = ed2.exercises.map((e) => ({ ...e, restBySetType: { working: { seconds: 60 } } }));
    expect((await s.routines.update({ routineId, edit: { name: ed2.routine.name, exercises: again }, expectedVersion: ed2.routine.version, opId: 'save-rest-2' })).ok).toBe(true);
    const still = await s.sessions.active();
    if (still === null) throw new Error('no session');
    expect(snapshotOf(still)).toBe(was);
  });
});
