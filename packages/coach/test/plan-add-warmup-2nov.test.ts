import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import { ProposePlanAddArgsSchema, type ActionDetail } from '@fizz/schemas';

import { createStoreExecutors, type CoachExecutors } from '../src/executors';
import { createPlanAddExecutor, PLAN_ADD_LINE, warmupAskedIn, type PlanAddRequest, type PlanSwapPrepared } from '../src/plan-swap';
import { COACH_TOOLS } from '../src/registry';
import { runCoachTurn } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { call, id, memoryStore, ports, reply, request, words } from './turn-fixtures';

/**
 * (Ben, 2 Nov: "yes if i ask for it. to be clear the warm-up could be any cardio exercise") `propose_plan_add`'s
 * `warmup` flag: it passes validation on the add and on each `also` add, and it reaches the app's port only when Ben's
 * words this turn call the cardio a warm-up. The coach's flag alone is never enough. Scripted model, real SQLite.
 */

let stores: Store[] = [];
afterEach(async () => {
  for (const s of stores) await s.close();
  stores = [];
});
async function store(): Promise<Store> {
  const s = await memoryStore();
  stores.push(s);
  return s;
}

const ADD: Extract<ActionDetail, { kind: 'propose_plan_swap' }> = {
  kind: 'propose_plan_swap',
  op: 'add',
  planId: id(500),
  planName: 'PPL',
  addId: 'exercise-bike',
  addName: 'Exercise bike',
  afterId: null,
  afterName: null,
  sets: 1,
  reps: null,
  load: null,
  position: 'first',
  durationS: 480,
  warmup: true,
  days: [{ routineId: id(501), routineName: 'Legs A', versionBefore: 3, edits: [{ kind: 'add', rowId: id(511), afterRowId: null, afterName: null, first: true }], before: ['Back squat'], after: ['Exercise bike', 'Back squat'] }],
  today: null,
};

function executors(s: Store, seen: PlanAddRequest[]): CoachExecutors {
  return {
    ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: null }),
    ...createPlanAddExecutor({
      store: s.repos.coach,
      prepare: (r): Promise<PlanSwapPrepared> => {
        seen.push(r);
        return Promise.resolve({ kind: 'ok', detail: ADD });
      },
    }),
  };
}

const ctx = {
  session: null,
  gymName: 'Main Gym',
  painFlags: [],
  checkIn: null,
  memories: [],
  catalogue: [],
  plan: { today: '2026-11-02', inUse: { name: 'PPL', paused: null, days: [{ name: 'Legs A', exercises: [{ catalogueId: 'barbell-back-squat', name: 'Back squat' }] }, { name: 'Push A', exercises: [{ catalogueId: 'barbell-bench-press', name: 'Bench press' }] }] } },
};

const ARGS = {
  add: 'exercise-bike',
  days: ['Legs A'],
  after: null,
  workingSets: 1,
  reps: null,
  load: null,
  position: 'first',
  before: null,
  minutes: 8,
  distanceM: null,
  warmup: true,
  also: [{ add: 'ski-erg', days: ['Push A'], position: 'first', before: null, after: null, workingSets: 1, reps: null, minutes: 4, distanceM: null, warmup: true }],
  notIncluded: null,
  reason: 'Cardio warm-up first.',
};

async function turn(text: string, args: object): Promise<PlanAddRequest[]> {
  const s = await store();
  const seen: PlanAddRequest[] = [];
  const model = new ScriptedCoachModel([[call('propose_plan_add', args), { type: 'completed' }], reply('Here it is for your plan.')]);
  const r = await runCoachTurn(request({ input: words(text), planInUse: true, context: ctx }), ports(s, model, executors(s, seen)));
  expect(r.status).toBe('completed');
  return seen;
}

describe('warmupAskedIn: Ben’s words call it a warm-up', () => {
  it('reads warm-up in his words, any spelling; not otherwise', () => {
    for (const t of ['bike 8 min first as a warm-up', 'Row 4 min to warm up', 'treadmill warmup on push days', 'ski erg first, warm‑ups please', 'something for warming up first']) expect(warmupAskedIn(t), t).toBe(true);
    for (const t of ['add a 10 min row at the end', 'it was warm in the gym', 'bike for 8 minutes first on leg days', '']) expect(warmupAskedIn(t), t).toBe(false);
    expect(warmupAskedIn(null)).toBe(false);
  });
});

describe('propose_plan_add’s warmup flag', () => {
  it('passes validation on the add and on each also add; absent (older calls) still parses', () => {
    expect(ProposePlanAddArgsSchema.safeParse(ARGS).success).toBe(true);
    const older: Record<string, unknown> = { ...ARGS, also: [{ ...ARGS.also[0], warmup: undefined }] };
    delete older.warmup;
    expect(ProposePlanAddArgsSchema.safeParse(older).success).toBe(true);
    expect(ProposePlanAddArgsSchema.safeParse({ ...ARGS, warmup: 'yes' }).success).toBe(false);
  });

  it('“… as a warm-up”: the flag reaches the port on both adds (a ski erg as well as a bike: any cardio)', async () => {
    const seen = await turn('Bike 8 min first on leg days and ski erg 4 min first on push days, as a warm-up', ARGS);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.warmup).toBe(true);
    expect(seen[0]?.also?.map((x) => [x.add, x.warmup])).toEqual([['ski-erg', true]]);
  });

  it('no warm-up in his words: the coach’s flag is dropped (a normal timed exercise)', async () => {
    const seen = await turn('Add an 8 min bike first on leg days and 4 min ski erg first on push days', ARGS);
    expect(seen[0]?.warmup).toBeUndefined();
    expect(seen[0]?.also?.[0]?.warmup).toBeUndefined();
  });

  it('the coach leaves it null when he asked: nothing is marked', async () => {
    const seen = await turn('Bike 8 min first on leg days as a warm-up', { ...ARGS, warmup: null, also: null });
    expect(seen[0]?.warmup).toBeUndefined();
  });

  it('the instructions say when (only when Ben calls it a warm-up) and never limit it to a bike or rower', () => {
    const tool = COACH_TOOLS.find((t) => t.name === 'propose_plan_add');
    expect(tool?.description).toContain('warmup (each add): true only when Ben calls that cardio or timed add a warm-up (any cardio exercise)');
    expect(PLAN_ADD_LINE).toContain('any cardio or timed exercise can be one');
    expect(PLAN_ADD_LINE).not.toMatch(/only (?:a |the )?(?:bike|rower)/i);
  });
});
