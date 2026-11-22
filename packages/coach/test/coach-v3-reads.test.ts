import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import type { ExerciseRecordsView, RecentSessionsView } from '@fizz/domain';
import type { CoachExecutors, ToolResult } from '../src/executors';
import { functionToolDefinitions } from '../src/function-tools';
import { buildTurnRegistry, COACH_TOOLS } from '../src/registry';
import { createTrainingReadExecutors, type TrainingReadPort } from '../src/training-read';
import { MAX_MODEL_STEPS, MAX_READ_CALLS, READ_LIMIT_LINE, runCoachTurn } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { call, memoryStore, ports, reply, request, words } from './turn-fixtures';

/**
 * Coach v3, slice 3 (ADR 0027, Ben 18 Oct): the coach can look up Ben's history (records with the
 * e1RM labelled an estimate, recent workouts, a gym summary), at most `MAX_READ_CALLS` reads a
 * turn, identical reads answered from the turn's cache.
 */

let stores: Store[] = [];
async function store(): Promise<Store> {
  const s = await memoryStore();
  stores.push(s);
  return s;
}
afterEach(async () => {
  for (const s of stores) await s.close();
  stores = [];
});

const EX = '00000000-0000-4000-8000-000000000200';
const EX2 = '00000000-0000-4000-8000-000000000201';

function countingReads(): { executors: CoachExecutors; calls: string[] } {
  const calls: string[] = [];
  const read =
    (name: string) =>
    (c: { tool: string; args: unknown }): Promise<ToolResult> => {
      calls.push(`${name}:${JSON.stringify(c.args)}`);
      return Promise.resolve({ kind: 'read', data: { domain: 'Your data', n: calls.length } });
    };
  return {
    calls,
    executors: {
      get_exercise_records: read('records'),
      get_recent_sessions: read('sessions'),
      get_recent_training: read('training'),
      get_gym_equipment: read('equipment'),
    },
  };
}

describe('read tools are offered and strict', () => {
  it('records, recent sessions and the gym read are offered on general and workout turns; get_gym_equipment takes a gym name', () => {
    for (const kind of ['general', 'workout'] as const) {
      const names = buildTurnRegistry({ kind, benRequest: null, acceptedOffer: false, benPainWords: false, structuralSignals: [] }).tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['get_exercise_records', 'get_recent_sessions', 'get_gym_equipment']));
    }
    const defs = functionToolDefinitions(COACH_TOOLS.filter((t) => t.name === 'get_gym_equipment' || t.name === 'get_exercise_records'));
    const gym = defs.find((d) => d.name === 'get_gym_equipment');
    expect((gym?.parameters as { required: string[] }).required).toEqual(['exerciseId', 'gymName']);
    expect(defs.find((d) => d.name === 'get_exercise_records')?.description).toMatch(/estimate/);
  });
});

describe('read cap and cache (runCoachTurn)', () => {
  it(`at most ${String(MAX_READ_CALLS)} reads a turn: the next is refused with the limit line, and the reply still lands`, async () => {
    const s = await store();
    const { executors, calls } = countingReads();
    const model = new ScriptedCoachModel([
      [call('get_exercise_records', { exerciseId: EX }, 'r1'), { type: 'completed' }],
      [call('get_recent_sessions', { count: 3 }, 'r2'), { type: 'completed' }],
      [call('get_recent_training', { exerciseId: EX, sessions: 3 }, 'r3'), { type: 'completed' }],
      [call('get_exercise_records', { exerciseId: EX2 }, 'r4'), { type: 'completed' }],
      [call('get_gym_equipment', { exerciseId: null, gymName: null }, 'r5'), { type: 'completed' }],
      reply('Your bench is moving well.'),
    ]);
    const r = await runCoachTurn(request({ input: words('how is my bench going?') }), ports(s, model, executors));
    expect(r.status).toBe('completed');
    expect(calls).toHaveLength(MAX_READ_CALLS);
    expect(r.toolLog.filter((l) => l.outcome === 'not_allowed').map((l) => l.text)).toEqual(['Read limit reached.']);
    const sixth = model.requests[5]?.input.at(-1);
    expect(sixth).toMatchObject({ type: 'function_call_output', callId: 'r5' });
    expect(JSON.parse((sixth as { output: string }).output)).toEqual({ status: 'not_allowed', line: READ_LIMIT_LINE });
    expect(MAX_MODEL_STEPS).toBe(6);
  });

  it('the same read twice in a turn runs once; the second gets the cached output and does not count', async () => {
    const s = await store();
    const { executors, calls } = countingReads();
    const model = new ScriptedCoachModel([
      [call('get_exercise_records', { exerciseId: EX }, 'r1'), { type: 'completed' }],
      [call('get_exercise_records', { exerciseId: EX }, 'r2'), { type: 'completed' }],
      reply('Noted.'),
    ]);
    const r = await runCoachTurn(request({ input: words('what is my best bench?') }), ports(s, model, executors));
    expect(r.status).toBe('completed');
    expect(calls).toHaveLength(1);
    const outputs = model.requests.flatMap((q) => q.input).filter((i) => i.type === 'function_call_output') as { callId: string; output: string }[];
    const first = outputs.find((o) => o.callId === 'r1')?.output;
    expect(outputs.find((o) => o.callId === 'r2')?.output).toBe(first);
    expect(r.toolLog.filter((l) => l.outcome === 'read')).toHaveLength(1);
  });
});

describe('createTrainingReadExecutors: new reads', () => {
  const view = (records: ExerciseRecordsView['records']): ExerciseRecordsView => ({ domain: 'Your data', note: 'n', exercise: 'Bench press', records, totalSessions: records.length });
  const port = (over: Partial<TrainingReadPort>): TrainingReadPort => ({
    exerciseHistory: () => Promise.resolve(null),
    overview: () => Promise.reject(new Error('unused')),
    equipment: () => Promise.resolve(null),
    builtInTargets: () => Promise.resolve(null),
    ...over,
  });

  it('no records or no workouts read as not available (never guessed); absent port methods withhold the tools', async () => {
    const ex = createTrainingReadExecutors(port({ exerciseRecords: () => Promise.resolve(view([])), recentSessions: (): Promise<RecentSessionsView> => Promise.resolve({ domain: 'Your data', note: 'n', sessions: [] }) }));
    const rec = await ex.get_exercise_records?.({ tool: 'get_exercise_records', args: { exerciseId: EX } }, {} as never);
    expect(rec).toEqual({ kind: 'read', data: { domain: 'Your data', not_available: 'no logged sets with a load for that exercise' } });
    const ses = await ex.get_recent_sessions?.({ tool: 'get_recent_sessions', args: { count: 3 } }, {} as never);
    expect(ses).toMatchObject({ data: { not_available: 'no finished workouts' } });
    const bare = createTrainingReadExecutors(port({}));
    expect(bare.get_exercise_records).toBeUndefined();
    expect(bare.get_recent_sessions).toBeUndefined();
  });

  it('a gym name that matches no saved gym says so', async () => {
    let asked: [string | null, string | null | undefined] | null = null;
    const ex = createTrainingReadExecutors(
      port({
        equipment: (e, g) => {
          asked = [e, g];
          return Promise.resolve(null);
        },
      }),
    );
    const r = await ex.get_gym_equipment?.({ tool: 'get_gym_equipment', args: { exerciseId: null, gymName: 'Moon gym' } }, {} as never);
    expect(asked).toEqual([null, 'Moon gym']);
    expect(r).toMatchObject({ data: { not_available: 'no saved gym by that name, or no such exercise' } });
  });
});
