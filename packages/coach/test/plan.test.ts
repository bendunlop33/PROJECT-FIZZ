import { describe, expect, it } from 'vitest';

import { doableHere, loadReferences, muscleGroupOf, type HistorySession } from '@fizz/domain';
import { assisted, barbell, dumbbells, exercise, GYM, id, OWNER, TZ } from '@fizz/domain/testing';
import type { EquipmentInstance, Exercise, Load, PainFlag, PlanDraft, SplitDay } from '@fizz/schemas';

import {
  buildTurnRegistry,
  classifyBenRequest,
  createPlanExecutor,
  gateFor,
  PLAN_NUDGE_LINE,
  planDayMinutes,
  planIdFor,
  planTopGroup,
  requestHas,
  revisesPlan,
  changesPlanInUse,
  runCoachTurn,
  type BuildContextView,
  type PlanDeps,
} from '../src/index';
import { ScriptedCoachModel } from './fake-model';
import { call, memoryStore, ports, reply, request, words } from './turn-fixtures';

/**
 * The plan builder's coach side (Ben, 19 Oct): `propose_plan` is offered
 * only on Ben's plan request (or a change to the plan in context), forced
 * like a build; every day is checked at the gym like a workout draft (pain
 * flags, usable here, loads per-hand / assisted); the plan and its record
 * are one write, idempotent; a new version needs the version the turn read
 * (rule 5); the message's numbers are checked; nothing is applied here.
 */

const ex = (n: number, name: string, key: string, over: Partial<Exercise> = {}): Exercise => exercise(n, name, { catalogueKey: key, ...over });
const BENCH = ex(210, 'Bench press', 'barbell-bench-press', { movementPattern: 'horizontal_push', mechanic: 'compound', primaryMuscles: ['chest'] });
const INCLINE = ex(211, 'Incline DB press', 'dumbbell-incline-press', { movementPattern: 'horizontal_push', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'compound', primaryMuscles: ['chest'] });
const OHP = ex(215, 'Overhead press', 'barbell-overhead-press', { movementPattern: 'vertical_push', mechanic: 'compound', primaryMuscles: ['shoulders'] });
const PULLUP = ex(218, 'Assisted pull-up', 'assisted-pull-up', { movementPattern: 'vertical_pull', compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance', mechanic: 'compound', primaryMuscles: ['lats'] });
const SQUAT = ex(220, 'Back squat', 'barbell-back-squat', { movementPattern: 'squat', mechanic: 'compound', primaryMuscles: ['quads'] });
const ALL = [BENCH, INCLINE, OHP, PULLUP, SQUAT];
const BAR = barbell({ gymId: GYM });
const RACK = dumbbells({ gymId: GYM });
const ASSIST = assisted({ gymId: GYM });
const GYM_EQ = { id: GYM, name: 'Main gym', equipment: [BAR, RACK, ASSIST] };
const NOW = Date.parse('2026-10-08T06:00:00.000Z');
const past = (n: number, eq: EquipmentInstance, load: Load, reps: number): HistorySession => ({
  sessionId: id(n),
  performedAtUtc: '2026-10-05T06:00:00.000Z',
  equipmentId: eq.id,
  gymId: GYM,
  imported: false,
  sets: [1, 2, 3].map(() => ({ setType: 'working' as const, side: null, load, reps, rpe: 8, rir: null })),
  tz: TZ,
});
const HISTORY = new Map<string, HistorySession[]>([
  [INCLINE.id, [past(900, RACK, { value: 22.5, unit: 'kg', convention: 'per_hand' }, 9)]],
  [PULLUP.id, [past(901, ASSIST, { value: 30, unit: 'kg', convention: 'assistance' }, 9)]],
  [BENCH.id, [past(902, BAR, { value: 100, unit: 'kg', convention: 'total' }, 9)]],
]);
const SPLIT: SplitDay[] = [
  { id: 'push', name: 'Push', bodyParts: ['Chest', 'Shoulders', 'Triceps'] },
  { id: 'pull', name: 'Pull', bodyParts: ['Back', 'Biceps'] },
  { id: 'legs', name: 'Legs', bodyParts: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
];

const FLAG: PainFlag = {
  id: id(950),
  ownerId: OWNER,
  version: 1,
  createdAtUtc: '2026-10-06T08:00:00.000Z',
  updatedAtUtc: '2026-10-06T08:00:00.000Z',
  exerciseId: OHP.id,
  exerciseName: 'Overhead press',
  area: 'shoulder',
  source: 'workout',
  checkInId: null,
  reportedAt: { utc: '2026-10-06T08:00:00.000Z', tz: TZ },
  status: 'active',
  clearedAtUtc: null,
  createdByOpId: 'flag',
};

function view(over: Partial<BuildContextView> = {}): BuildContextView {
  return {
    request: { quote: 'build me a 3-day plan', minutes: 60, focus: 'coach_picks', origin: 'text' },
    gym: { name: 'Main gym', typicalEquipment: false },
    usable: ALL.map((e) => ({ catalogueId: e.catalogueKey ?? '', name: e.name, equipment: e.compatibleEquipment[0] ?? 'none', measured: 'reps' as const })),
    busyToday: [],
    setBudget: 21,
    upNext: null,
    draft: null,
    plan: { splitDays: SPLIT.map((d) => ({ id: d.id, name: d.name, bodyParts: [...d.bodyParts], mainLift: null })), daysPerWeek: 3, minutesEach: 60, setBudget: 21, rotation: ['Push A'], current: null },
    ...over,
  };
}

function deps(store: Awaited<ReturnType<typeof memoryStore>>, plan: PlanDraft | null = null, over: Partial<PlanDeps> = {}): PlanDeps {
  return {
    store: store.repos.coach,
    request: { text: 'build me a 3-day plan', minutes: 60, minutesFromBen: null, gymId: GYM, gymName: 'Main gym', origin: 'text' },
    plan,
    splitDays: SPLIT,
    checkContext: (previous, opId) =>
      Promise.resolve({
        exerciseFor: (key: string) => ALL.find((e) => e.catalogueKey === key) ?? null,
        usable: (e: Exercise) => doableHere(e, GYM_EQ),
        substituteFor: () => null,
        painFlags: [FLAG],
        nowMs: NOW,
        tz: TZ,
        restPresetsS: [60, 90, 120, 180],
        ruleReps: () => null,
        previous,
        newSlotKey: (exerciseId: string, i: number) => `00000000-0000-4000-9${String(opId.length % 10)}${String(i).padStart(2, '0')}-${exerciseId.slice(-12)}`,
        loads: {
          refsFor: (e: Exercise) => loadReferences({ exercise: e, history: HISTORY.get(e.id) ?? [], ctx: { unit: 'kg', gym: GYM_EQ, knownEquipment: new Map(GYM_EQ.equipment.map((x) => [x.id, x])) }, nowMs: NOW }),
          painFor: () => null,
          askedHeavier: false,
        },
      }),
    mainLiftFor: (d) => (d?.id === 'legs' ? { exercise: SQUAT, skip: false } : null),
    exerciseOf: (eid) => ALL.find((e) => e.id === eid) ?? null,
    groupOf: muscleGroupOf,
    contextHash: 'ctx',
    equipmentVersion: 'eq',
    ...over,
  };
}

const pex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });
const loadOf = (value: number, convention: string) => ({ value, unit: 'kg', convention, basis: 'last time, same reps', from: 'own_history', relatedCatalogueId: null });
const PLAN_ARGS = {
  days: [
    { dayName: 'Push', splitDayId: 'push', focus: null, minutes: null, exercises: [pex('barbell-bench-press', { load: loadOf(100, 'total') }), pex('barbell-overhead-press'), pex('dumbbell-incline-press', { load: loadOf(22.5, 'per_hand') })] },
    { dayName: 'Pull', splitDayId: 'pull', focus: null, minutes: null, exercises: [pex('assisted-pull-up', { load: loadOf(30, 'assistance') })] },
    { dayName: 'Legs', splitDayId: 'legs', focus: null, minutes: 75, exercises: [pex('barbell-back-squat')] },
  ],
  message: 'Push, pull, legs across 3 days.',
  minutes: null,
  gymName: null,
};

describe('`propose_plan` is offered only on Ben’s plan request (rule 3)', () => {
  it('a plan request opens propose_plan (and not propose_workout); a session request opens propose_workout only', () => {
    const tools = (text: string, extra: Record<string, unknown> = {}) => buildTurnRegistry(gateFor({ kind: 'general', input: words(text), previousOffer: null, structuralSignals: [], ...extra })).tools.map((t) => t.name);
    expect(tools('build me a 4-day plan')).toContain('propose_plan');
    expect(tools('build me a 4-day plan')).not.toContain('propose_workout');
    expect(tools('build me a push session')).not.toContain('propose_plan');
    expect(tools('how did my week go?')).not.toContain('propose_plan');
    // In a workout turn: never.
    expect(buildTurnRegistry(gateFor({ kind: 'workout', input: words('build me a 4-day plan'), previousOffer: null, structuralSignals: [] })).tools.map((t) => t.name)).not.toContain('propose_plan');
    // With an open plan in the thread, change words revise it.
    expect(tools('make legs shorter', { planInContext: true })).toContain('propose_plan');
    expect(tools('only 3 days', { planInContext: true })).toContain('propose_plan');
    expect(tools('make legs shorter')).not.toContain('propose_plan');
    expect(revisesPlan('what do you think of legs day?')).toBe(false);
    // Review planview-19oct B1: Library's prefilled `Change my plan: …` changes the plan in use.
    expect(tools('Change my plan: swap squats for leg press', { planInContext: true })).toContain('propose_plan');
    expect(tools('Change my plan: more arms', { planInContext: true })).toContain('propose_plan');
    expect(tools('Change my plan: more arms')).not.toContain('propose_plan');
    expect(requestHas(classifyBenRequest('PPL week, 60 min each', 'general'), 'build_plan')).toBe(true);
  });

  it('changesPlanInUse: words that name the plan and change it; never a question about it or a multi-week block', () => {
    for (const t of ['Change my plan: swap squats for leg press', 'Change Pull in my plan: replace rows with cable rows', 'Change my plan: ', 'can you tweak my plan so legs is shorter', 'my plan needs fewer days', 'swap bench in the plan for dumbbells']) expect(changesPlanInUse(t), t).toBe(true);
    for (const t of ['What do you think of my plan?', 'how is my plan going', 'build me a 4-day plan', 'change my bench to 100', 'Change my plan to a 6 week block']) expect(changesPlanInUse(t), t).toBe(false);
  });

  it('a day’s length: its own, else Ben’s stated length, else the model’s for every day, else his usual; stepped and bounded', () => {
    const r = { minutes: 45, minutesFromBen: null };
    expect(planDayMinutes({ minutes: 75 }, 60, r)).toBe(75);
    expect(planDayMinutes({ minutes: null }, 60, r)).toBe(60);
    expect(planDayMinutes({ minutes: null }, 60, { minutes: 45, minutesFromBen: 50 })).toBe(50);
    expect(planDayMinutes({ minutes: null }, null, r)).toBe(45);
    expect(planDayMinutes({ minutes: 500 }, null, r)).toBe(180);
  });
});

describe('planTopGroup: the group most of a day’s working sets train', () => {
  const FACE_PULL = ex(230, 'Face pull', 'cable-face-pull', { movementPattern: 'horizontal_pull', primaryMuscles: ['rear_delts', 'upper_back'] });
  const LATERAL = ex(231, 'Lateral raise', 'dumbbell-lateral-raise', { movementPattern: 'vertical_push', primaryMuscles: ['side_delts'] });
  const known = [FACE_PULL, LATERAL, PULLUP];
  const set = (setType: 'warmup' | 'working') => ({ setType, reps: { min: 10, max: 15 }, durationS: null, targetRpe: setType === 'warmup' ? null : 8, restS: null });
  const slot = (e: Exercise, working: number, warmups = 0) => ({ exerciseId: e.id, setTemplates: [...Array.from({ length: warmups }, () => set('warmup')), ...Array.from({ length: working }, () => set('working'))] });
  const top = (slots: ReturnType<typeof slot>[]) => planTopGroup({ slots }, { exerciseOf: (eid) => known.find((e) => e.id === eid) ?? null, groupOf: muscleGroupOf });

  it('a day of mostly face pulls is mostly Back (rear delts are Back, §9 Q13)', () => {
    expect(top([slot(FACE_PULL, 4), slot(LATERAL, 3)])).toBe('Back');
    expect(top([slot(FACE_PULL, 2), slot(PULLUP, 2), slot(LATERAL, 3)])).toBe('Back');
  });
  it('warm-ups don’t count; unknown exercises are skipped; nothing known is null', () => {
    expect(top([slot(FACE_PULL, 2), slot(LATERAL, 3, 4)])).toBe('Shoulders');
    expect(top([{ exerciseId: 'gone', setTemplates: [set('working')] }])).toBeNull();
    expect(planTopGroup({ slots: [slot(FACE_PULL, 3)] }, {})).toBeNull();
  });
});

describe('a plan turn end to end (fake model)', () => {
  it('stores a checked plan with its record: days mapped to the split, a flagged lift left out, per-hand and assisted loads checked; nothing applied', async () => {
    const store = await memoryStore();
    const model = new ScriptedCoachModel([[call('propose_plan', PLAN_ARGS), { type: 'completed' }], reply('Here is your week.')]);
    const req = request({ input: words('build me a 3-day plan'), context: { session: null, gymName: 'Main gym', painFlags: [FLAG], checkIn: null, memories: [], catalogue: [], build: view() } });
    const result = await runCoachTurn(req, ports(store, model, createPlanExecutor(deps(store))));
    expect(result.status).toBe('completed');
    expect(model.offeredTools()[0]).toContain('propose_plan');
    const card = result.cards[0]?.record;
    expect(card).toMatchObject({ status: 'committed', detail: { kind: 'build_plan', versionN: 1, parentN: null, name: '3-day plan', days: [{ name: 'Push', exerciseCount: 2, leftOut: 1 }, { name: 'Pull', exerciseCount: 1, leftOut: 0 }, { name: 'Legs', exerciseCount: 1, leftOut: 0 }] } });
    expect(card?.guardNotes.map((n) => n.text.replaceAll(' ', ' '))).toContain('Push: Overhead press left out · shoulder flagged 6 Oct');
    expect(result.cards[0]?.rendered.text).toBe('Plan ready: 3-day plan · Push, Pull, Legs · 1 left out. Not applied.');
    const plans = await store.repos.planDrafts.listByOwner(OWNER);
    expect(plans).toHaveLength(1);
    const v = plans[0]?.versions[0];
    expect(plans[0]).toMatchObject({ id: planIdFor(card?.opId ?? ''), status: 'open', applied: null });
    expect(v?.days.map((d) => [d.name, d.splitDayId, d.minutes])).toEqual([
      ['Push', 'push', 60],
      ['Pull', 'pull', 60],
      ['Legs', 'legs', 75],
    ]);
    const load = (d: number, s: number) => v?.days[d]?.plan.slots[s]?.setTemplates.find((t) => t.setType !== 'warmup')?.load?.load ?? null;
    expect(load(0, 1)).toEqual({ value: 22.5, unit: 'kg', convention: 'per_hand' });
    expect(load(1, 0)).toEqual({ value: 30, unit: 'kg', convention: 'assistance' });
    // Nothing in Ben's workouts changed: a plan is a proposal.
    expect(await store.repos.routines.listByOwner(OWNER)).toEqual([]);
    // The same call replayed in the same turn changes nothing twice.
    const again = await createPlanExecutor(deps(store)).propose_plan?.({ tool: 'propose_plan', args: PLAN_ARGS }, { ownerId: OWNER, turnId: req.turnId, opId: card?.opId ?? '', now: { utc: '2026-10-08T06:00:01.000Z', tz: TZ }, benWords: null, messagePain: null, intent: 'general' });
    expect(again).toMatchObject({ kind: 'action', replayed: true });
    expect(await store.repos.planDrafts.listByOwner(OWNER)).toHaveLength(1);
    await store.close();
  });

  it('a text answer is nudged once with the plan line, then the call is forced by name', async () => {
    const store = await memoryStore();
    const model = new ScriptedCoachModel([reply('Day 1 push, day 2 pull, day 3 legs.'), [call('propose_plan', PLAN_ARGS), { type: 'completed' }], reply('Built.')]);
    const result = await runCoachTurn(request({ input: words('build me a 3-day plan'), context: { session: null, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [], build: view() } }), ports(store, model, createPlanExecutor(deps(store))));
    expect(JSON.stringify(model.requests[1]?.input)).toContain(PLAN_NUDGE_LINE);
    expect(model.requests[1]?.toolChoice).toEqual({ type: 'function', name: 'propose_plan' });
    expect(result.cards[0]?.record.detail.kind).toBe('build_plan');
    await store.close();
  });

  it('a new version needs the plan as the turn read it (rule 5); every day failing is a refused record and no plan', async () => {
    const store = await memoryStore();
    const model = new ScriptedCoachModel([[call('propose_plan', PLAN_ARGS), { type: 'completed' }], reply('Done.')]);
    await runCoachTurn(request({ input: words('build me a 3-day plan'), context: { session: null, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [], build: view() } }), ports(store, model, createPlanExecutor(deps(store))));
    const plan = (await store.repos.planDrafts.listByOwner(OWNER))[0];
    if (plan === undefined) throw new Error('plan');
    const two = { ...PLAN_ARGS, days: PLAN_ARGS.days.slice(0, 2) };
    const m2 = new ScriptedCoachModel([[call('propose_plan', two, 'c2'), { type: 'completed' }], reply('Two days.')]);
    const r2 = await runCoachTurn(request({ turnId: id(71_002), input: words('only 2 days'), planInContext: true, context: { session: null, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [], build: view() } }), ports(store, m2, createPlanExecutor(deps(store, plan))));
    expect(r2.cards[0]?.record.detail).toMatchObject({ kind: 'build_plan', versionN: 2, parentN: 1, name: '2-day plan' });
    // An executor holding the old version: stale, nothing written.
    const m3 = new ScriptedCoachModel([[call('propose_plan', two, 'c3'), { type: 'completed' }], reply('Again.')]);
    const r3 = await runCoachTurn(request({ turnId: id(71_003), input: words('only 2 days'), planInContext: true, context: { session: null, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [], build: view() } }), ports(store, m3, createPlanExecutor(deps(store, plan))));
    expect(r3.cards[0]?.record).toMatchObject({ status: 'stale', detail: { kind: 'build_plan' } });
    expect((await store.repos.planDrafts.get(plan.id))?.currentVersion).toBe(2);

    const bad = { ...PLAN_ARGS, days: [{ ...PLAN_ARGS.days[0], exercises: [pex('barbell-overhead-press'), pex('landmine-twist')] }] };
    const m4 = new ScriptedCoachModel([[call('propose_plan', bad, 'c4'), { type: 'completed' }], reply('Nothing fits.')]);
    const r4 = await runCoachTurn(request({ turnId: id(71_004), input: words('build me a 1 day plan'), context: { session: null, gymName: null, painFlags: [FLAG], checkIn: null, memories: [], catalogue: [], build: view() } }), ports(store, m4, createPlanExecutor(deps(store))));
    expect(r4.cards[0]?.record).toMatchObject({ status: 'rejected', failure: 'no day had anything usable here' });
    expect(await store.repos.planDrafts.listByOwner(OWNER)).toHaveLength(1);
    await store.close();
  });

  it('a change to the plan in use (`basedOn`, review planview-19oct B1) is a new open plan; the plan in use is never written', async () => {
    const store = await memoryStore();
    const model = new ScriptedCoachModel([[call('propose_plan', PLAN_ARGS), { type: 'completed' }], reply('Done.')]);
    await runCoachTurn(request({ input: words('build me a 3-day plan'), context: { session: null, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [], build: view() } }), ports(store, model, createPlanExecutor(deps(store))));
    const stored = (await store.repos.planDrafts.listByOwner(OWNER))[0];
    if (stored === undefined) throw new Error('plan');
    const inUse: PlanDraft = { ...stored, status: 'applied', applied: { mode: 'add', versionN: 1, opId: 'apply-x', atUtc: '2026-10-08T07:00:00.000Z', made: [], rotationOff: [] } };
    const two = { ...PLAN_ARGS, days: PLAN_ARGS.days.slice(0, 2) };
    const m2 = new ScriptedCoachModel([[call('propose_plan', two, 'c2'), { type: 'completed' }], reply('Two days.')]);
    const r2 = await runCoachTurn(request({ turnId: id(71_005), input: words('Change my plan: only 2 days'), planInContext: true, context: { session: null, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [], build: view() } }), ports(store, m2, createPlanExecutor(deps(store, null, { basedOn: inUse }))));
    const detail = r2.cards[0]?.record.detail;
    expect(detail).toMatchObject({ kind: 'build_plan', versionN: 1, parentN: null, name: '2-day plan' });
    if (detail?.kind !== 'build_plan') throw new Error('card');
    expect(detail.planId).not.toBe(stored.id);
    expect((await store.repos.planDrafts.get(detail.planId))?.status).toBe('open');
    expect(await store.repos.planDrafts.get(stored.id)).toEqual(stored);
    await store.close();
  });

  it('the message’s numbers are checked: one from the plan stays, an invented one is dropped', async () => {
    const store = await memoryStore();
    const args = { ...PLAN_ARGS, message: 'Legs gets 75 minutes. You squatted 180 kg last week.' };
    const model = new ScriptedCoachModel([[call('propose_plan', args), { type: 'completed' }], reply('Here it is.')]);
    await runCoachTurn(request({ input: words('build me a 3-day plan'), context: { session: null, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [], build: view() } }), ports(store, model, createPlanExecutor(deps(store))));
    expect((await store.repos.planDrafts.listByOwner(OWNER))[0]?.versions[0]?.rationale).toBe('Legs gets 75 minutes.');
    await store.close();
  });

  it('a gym Ben hasn’t saved is refused with the saved names; nothing is built', async () => {
    const store = await memoryStore();
    const r = await createPlanExecutor(deps(store, null, { gyms: ['Main gym'], gymFor: () => Promise.resolve(null) })).propose_plan?.({ tool: 'propose_plan', args: { ...PLAN_ARGS, gymName: 'Moon base' } }, { ownerId: OWNER, turnId: 't', opId: 'op', now: { utc: '2026-10-08T06:00:01.000Z', tz: TZ }, benWords: null, messagePain: null, intent: 'general' });
    expect(r).toEqual({ kind: 'refused', line: 'Not built: no saved gym called "Moon base". Saved gyms: "Main gym". Use one of them, or null for the selected gym.' });
    expect(await store.repos.planDrafts.listByOwner(OWNER)).toEqual([]);
    await store.close();
  });
});
