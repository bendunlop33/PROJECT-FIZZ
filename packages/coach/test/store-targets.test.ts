import { afterEach, describe, expect, it } from 'vitest';
import { nextSessionBases, reduceSession } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { SessionAggregate } from '@fizz/schemas';
import { createEditTodayExecutor } from '../src/edit-today';
import {
  createNextTargetsExecutor,
  createSessionReadExecutor,
  createStoreExecutors,
  nextTargetRowId,
  nextTargetTapRecord,
  undoCoachAction,
  type CoachExecutors,
} from '../src/executors';
import { runCoachTurn } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { at, call, id, kg, memoryStore, OWNER, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

/**
 * C7 and C8 against the real SQLite store: today's targets and their record
 * in one transaction (with Undo through the reducer), and next-session
 * targets (D21) with per-row taps and the CA10 stale rule.
 */

const nb = (s: string): string => s.replace(/\u00a0/g, ' ');
const BENCH_ID = id(1010);
const DB_ID = id(1020);

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

async function saved(s: Store, agg: SessionAggregate): Promise<SessionAggregate> {
  const r = await s.repos.sessions.save(agg, null);
  if (!r.ok) throw new Error('save failed');
  return agg;
}

function todayExecutors(s: Store): CoachExecutors {
  const load = () => s.repos.sessions.get(SESSION);
  return {
    ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: SESSION }),
    get_active_session: createSessionReadExecutor({ loadSession: load, gymName: 'Main Gym' }),
    // Coach v3: the one tool for today's workout, through the same session-command write.
    edit_today: createEditTodayExecutor({ store: s.repos.coach, loadSession: load, painFlags: () => Promise.resolve([]), sessionPainUnspecified: false, gymName: 'Main Gym' }),
  };
}

const lower = (baseVersion = 7) => ({
  baseVersion,
  ops: [
    { op: 'set', setId: id(102), target: { load: kg(95), reps: { min: 8, max: 8 } } },
    { op: 'set', setId: id(103), target: { load: kg(95), reps: { min: 8, max: 8 } } },
  ],
  reason: 'Set 2 was RPE 10.',
  benAsked: true,
  benQuote: 'Drop the last two to 95',
});

describe("today's sets: the reducer command and the record in one transaction (C7)", () => {
  it('Ben asks; sets 3–4 become coach targets in SQLite; a replay changes nothing twice; Undo puts 100 back', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', lower(), 'x1'), { type: 'completed' }], [call('edit_today', lower(), 'x2'), { type: 'completed' }], reply('That should keep you at 8.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Drop the last two to 95'), context: { session: workout(), gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] } }), ports(s, model, todayExecutors(s)));
    expect(r.cards.map((c) => nb(c.rendered.text))).toEqual(['Changed sets 3–4 to 95 kg × 8 (targets).']);
    expect(r.toolLog.map((l) => l.outcome)).toEqual(['committed', 'replayed']);
    const after = await s.repos.sessions.get(SESSION);
    expect(after?.session.version).toBe(8);
    expect(after?.sets.find((x) => x.id === id(103))?.planned).toMatchObject({ load: kg(95), source: 'coach', coach: { actionId: r.cards[0]?.record.actionId } });
    // Done sets never change.
    expect(after?.sets.find((x) => x.id === id(101))).toEqual(workout().sets.find((x) => x.id === id(101)));

    // Ben logs set 3, then taps Undo: set 4 goes back, set 3 stays as logged.
    const logged = reduceSession(after as SessionAggregate, { type: 'log_set', at: at(500), opId: 'log-3', setId: id(102), values: { load: kg(95), reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: id(4444) });
    if (!logged.ok) throw new Error(logged.error.message);
    await s.repos.sessions.save(logged.state, after?.revision ?? 0);
    const u = await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId: r.cards[0]?.record.actionId ?? '', opId: 'undo-tap-1', now: at(600) });
    expect(u.result.status).toBe('written');
    expect(u.undo.detail).toMatchObject({ kind: 'undo', alreadyLogged: [3], restored: [{ changes: [{ setNumber: 4, after: { load: kg(100) } }] }] });
    const back = await s.repos.sessions.get(SESSION);
    expect(back?.sets.find((x) => x.id === id(103))?.planned).toEqual(workout().sets.find((x) => x.id === id(103))?.planned);
    expect(back?.sets.find((x) => x.id === id(102))?.status).toBe('completed');
    // A double tap undoes once.
    expect((await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId: r.cards[0]?.record.actionId ?? '', opId: 'undo-tap-1', now: at(601) })).result.status).toBe('replayed');
  });

  it('rule 4: Undo after a gym change is refused as gym_changed and leaves the sets as they are (review r2 B1)', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', lower(), 'x1'), { type: 'completed' }], reply('Okay.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Drop the last two to 95'), context: { session: workout(), gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] } }), ports(s, model, todayExecutors(s)));
    const after = (await s.repos.sessions.get(SESSION)) as SessionAggregate & { revision: number };
    // A gym change recorded after the coach change (the switch itself is covered in the domain tests).
    const change = { actionId: 'gym-change-1', opId: 'switch-1', kind: 'change' as const, mode: 'gym_switch' as const, at: at(550), fromGymId: after.session.gymId, toGymId: id(9999), afterFingerprint: 'f', changedSetIds: [], draftsReplaced: [] };
    const moved = { ...after, session: { ...after.session, gymId: id(9999), gymChanges: [change], version: after.session.version + 1 } };
    const w = await s.repos.sessions.save(moved, after.revision);
    expect(w.ok).toBe(true);
    const u = await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId: r.cards[0]?.record.actionId ?? '', opId: 'undo-tap-gym', now: at(600) });
    expect(u.result).toEqual({ status: 'not_possible', reason: 'gym_changed' });
    expect(u.undo).toMatchObject({ status: 'rejected', failure: 'gym changed' });
    expect((await s.repos.sessions.get(SESSION))?.sets.find((x) => x.id === id(103))?.planned).toMatchObject({ load: kg(95), source: 'coach' });
  });

  it('rule 5: the workout moved on between the read and the write; the record says stale and nothing changes', async () => {
    const s = await store();
    await saved(s, workout(8));
    const model = new ScriptedCoachModel([[call('edit_today', lower(7)), { type: 'completed' }], reply('Okay.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Drop the last two to 95'), context: { session: workout(8), gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] } }), ports(s, model, todayExecutors(s)));
    expect(r.cards.map((c) => c.record.status)).toEqual(['stale']);
    expect((await s.repos.sessions.get(SESSION))?.sets.find((x) => x.id === id(103))?.planned.source).toBeUndefined();
  });

  it('get_active_session reads the workout fresh with set IDs and the version', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('get_active_session', {}), { type: 'completed' }], reply('Bench is next.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('What is next?'), context: { session: workout(), gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] } }), ports(s, model, todayExecutors(s)));
    const out = model.requests[1]?.input.find((i) => i.type === 'function_call_output');
    expect(out?.type === 'function_call_output' ? out.output : '').toContain('"version":7');
    expect(r.toolLog[0]).toMatchObject({ outcome: 'read', text: "Read today's workout" });
  });
});

function finished(): SessionAggregate {
  const w = workout();
  // Every set done; the workout finished at 10 min.
  return {
    ...w,
    session: { ...w.session, status: 'finished', endedAt: at(600), activeSetId: null },
    sets: w.sets.map((x) => (x.status === 'completed' ? x : { ...x, status: 'completed', actual: { load: x.planned.load, reps: 8, durationS: null, rpe: 8, rir: null }, completedAt: at(300), completedByOpId: `op-${x.id}` })),
  };
}

function builtIn(): Map<string, { setType: string; planned: { load: ReturnType<typeof kg> | null; reps: { min: number; max: number } | null } }[]> {
  return new Map([
    [BENCH_ID, [1, 2, 3, 4].map(() => ({ setType: 'working', planned: { load: kg(102.5), reps: { min: 6, max: 8 } } }))],
    [DB_ID, [1, 2].map(() => ({ setType: 'working', planned: { load: kg(22.5, 'per_hand'), reps: { min: 9, max: 11 } } }))],
  ]);
}

function summaryExecutors(s: Store, source: SessionAggregate): CoachExecutors {
  return {
    set_next_session_targets: createNextTargetsExecutor({
      store: s.repos.coach,
      source,
      bases: nextSessionBases(source, builtIn()),
      painFlags: () => Promise.resolve([]),
      gymName: 'Main Gym',
      workoutLabel: 'Push A',
      benAskedForMoreSets: false,
    }),
  };
}

const nextArgs = (version: number) => ({
  sourceSessionId: SESSION,
  sourceVersion: version,
  targets: [
    { exerciseId: BENCH_ID, target: { load: kg(97.5), reps: null }, sets: null, reason: 'Sets 1–2 were RPE 10.' },
    { exerciseId: DB_ID, target: { load: kg(30, 'per_hand'), reps: null }, sets: null, reason: 'Easy today.' },
  ],
});

describe('next-session targets (C8, D21): small saved by default, bigger proposed, Undo per row', () => {
  it('one summary turn: bench −2.5% is saved, dumbbells +33% is a proposal; the card is the saved record', async () => {
    const s = await store();
    const source = await saved(s, finished());
    const model = new ScriptedCoachModel([[call('set_next_session_targets', nextArgs(7)), { type: 'completed' }], reply('Bench felt heavy, so a touch lighter.')]);
    const r = await runCoachTurn(request({ kind: 'summary', input: { kind: 'summary' }, context: { session: source, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] } }), ports(s, model, summaryExecutors(s, source)));
    expect(model.offeredTools()[0]).toContain('set_next_session_targets');
    expect(r.cards[0]?.record.status).toBe('committed');
    expect(nb(r.cards[0]?.rendered.text ?? '')).toBe('Next Push A: Bench press 97.5 kg × 6–8 (target). Suggested for next Push A: Dumbbell press 30 kg each × 8–10 (target). Not applied.');
    const rows = await s.repos.coach.listNextTargets(OWNER, SESSION);
    expect(rows.map((x) => [x.exerciseName, x.status, x.pctChange])).toEqual(
      expect.arrayContaining([
        ['Bench press', 'saved', -2.5],
        ['Dumbbell press', 'proposed', 33.3],
      ]),
    );
    expect(rows.find((x) => x.exerciseId === BENCH_ID)?.builtIn).toEqual({ load: kg(102.5), reps: { min: 6, max: 8 } });
  });

  it('Undo on one row → built-in for that exercise only; Use coach target puts it back; a stale tap is refused; a double tap acts once', async () => {
    const s = await store();
    const source = await saved(s, finished());
    await runCoachTurn(request({ kind: 'summary', input: { kind: 'summary' }, context: { session: source, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] } }), ports(s, new ScriptedCoachModel([[call('set_next_session_targets', nextArgs(7)), { type: 'completed' }], reply('Ok.')]), summaryExecutors(s, source)));
    const row = await s.repos.coach.getNextTarget(nextTargetRowId(SESSION, BENCH_ID));
    if (row === null) throw new Error('no row');
    const undo = nextTargetTapRecord(row, 'undo', { opId: 'tap-1', now: at(700) });
    expect(await s.repos.coach.setNextTargetStatus(OWNER, { rowId: row.id, expectedVersion: row.version, ...undo })).toMatchObject({ status: 'written', row: { status: 'undone' } });
    expect(await s.repos.coach.setNextTargetStatus(OWNER, { rowId: row.id, expectedVersion: row.version, ...undo })).toMatchObject({ status: 'replayed' });
    const other = await s.repos.coach.getNextTarget(nextTargetRowId(SESSION, DB_ID));
    expect(other?.status).toBe('proposed');
    const undone = await s.repos.coach.getNextTarget(row.id);
    const stale = nextTargetTapRecord(row, 'use_coach', { opId: 'tap-2', now: at(701) });
    expect(await s.repos.coach.setNextTargetStatus(OWNER, { rowId: row.id, expectedVersion: row.version, ...stale })).toEqual({ status: 'not_possible', reason: 'changed_since' });
    const again = nextTargetTapRecord(undone ?? row, 'use_coach', { opId: 'tap-3', now: at(702) });
    expect(await s.repos.coach.setNextTargetStatus(OWNER, { rowId: row.id, expectedVersion: undone?.version ?? 0, ...again })).toMatchObject({ status: 'written', row: { status: 'saved' } });
  });

  it('several row taps are one write: one refused tap writes none of them; a repeat replays (review S3)', async () => {
    const s = await store();
    const source = await saved(s, finished());
    await runCoachTurn(request({ kind: 'summary', input: { kind: 'summary' }, context: { session: source, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] } }), ports(s, new ScriptedCoachModel([[call('set_next_session_targets', nextArgs(7)), { type: 'completed' }], reply('Ok.')]), summaryExecutors(s, source)));
    const bench = await s.repos.coach.getNextTarget(nextTargetRowId(SESSION, BENCH_ID));
    const other = await s.repos.coach.getNextTarget(nextTargetRowId(SESSION, DB_ID));
    if (bench === null || other === null) throw new Error('no rows');
    const tap = (row: typeof bench, opId: string, version = row.version) => ({ rowId: row.id, expectedVersion: version, ...nextTargetTapRecord(row, row.status === 'proposed' ? 'not_now' : 'undo', { opId, now: at(700) }) });
    // The second tap is stale (Ben's view had an older version): nothing is written, not even the first.
    expect(await s.repos.coach.setNextTargetStatuses(OWNER, [tap(bench, 'all-1'), tap(other, 'all-2', other.version - 1)])).toEqual({ status: 'not_possible', rowId: other.id, reason: 'changed_since' });
    expect(await s.repos.coach.getNextTarget(bench.id)).toMatchObject({ status: 'saved', version: bench.version });
    expect(await s.repos.coach.findActionByOpId(OWNER, 'all-1')).toBeNull();
    // Both fit: both written in one go; the same taps again replay.
    expect(await s.repos.coach.setNextTargetStatuses(OWNER, [tap(bench, 'all-3'), tap(other, 'all-4')])).toMatchObject({ status: 'written', rows: [{ status: 'undone' }, { status: 'not_applied' }] });
    expect(await s.repos.coach.setNextTargetStatuses(OWNER, [tap(bench, 'all-3'), tap(other, 'all-4')])).toMatchObject({ status: 'replayed' });
  });

  it('CA10: an answer after a workout started from this one is stale and saves nothing', async () => {
    const s = await store();
    const source = await saved(s, finished());
    const next = workout();
    await s.repos.coach.noteStartFrom(OWNER, SESSION, 'start-2', at(899).utc);
    await saved(s, { ...next, session: { ...next.session, id: id(9100), startOperationId: 'start-2', startedAt: at(900) }, exercises: [], sets: [] });
    const r = await runCoachTurn(
      request({ kind: 'summary', input: { kind: 'summary' }, context: { session: source, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] } }),
      ports(s, new ScriptedCoachModel([[call('set_next_session_targets', nextArgs(7)), { type: 'completed' }], reply('Ok.')]), summaryExecutors(s, source)),
    );
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['stale', "Couldn't set next targets."]]);
    expect(await s.repos.coach.listNextTargets(OWNER, SESSION)).toEqual([]);
  });

  it('an unrelated workout started since doesn’t make the answer stale (review S2)', async () => {
    const s = await store();
    const source = await saved(s, finished());
    const next = workout();
    await saved(s, { ...next, session: { ...next.session, id: id(9100), startOperationId: 'start-other', startedAt: at(900) }, exercises: [], sets: [] });
    const r = await runCoachTurn(
      request({ kind: 'summary', input: { kind: 'summary' }, context: { session: source, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] } }),
      ports(s, new ScriptedCoachModel([[call('set_next_session_targets', nextArgs(7)), { type: 'completed' }], reply('Ok.')]), summaryExecutors(s, source)),
    );
    expect(r.cards[0]?.record.status).toBe('committed');
    expect((await s.repos.coach.listNextTargets(OWNER, SESSION)).every((x) => x.usedBySessionId === null)).toBe(true);
  });

  it('a summary turn names the wrong workout or an old version: refused, nothing saved', async () => {
    const s = await store();
    const source = await saved(s, finished());
    const r = await runCoachTurn(
      request({ kind: 'summary', input: { kind: 'summary' }, context: { session: source, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] } }),
      ports(s, new ScriptedCoachModel([[call('set_next_session_targets', nextArgs(6)), { type: 'completed' }], reply('Ok.')]), summaryExecutors(s, source)),
    );
    expect(r.cards[0]?.record.status).toBe('stale');
    expect(await s.repos.coach.listNextTargets(OWNER, SESSION)).toEqual([]);
  });

  it('Undo all reverts every saved row in one transaction', async () => {
    const s = await store();
    const source = await saved(s, finished());
    const r = await runCoachTurn(request({ kind: 'summary', input: { kind: 'summary' }, context: { session: source, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] } }), ports(s, new ScriptedCoachModel([[call('set_next_session_targets', nextArgs(7)), { type: 'completed' }], reply('Ok.')]), summaryExecutors(s, source)));
    const u = await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId: r.cards[0]?.record.actionId ?? '', opId: 'undo-all', now: at(800) });
    expect(u.result.status).toBe('written');
    const rows = await s.repos.coach.listNextTargets(OWNER, SESSION);
    expect(rows.map((x) => x.status).sort()).toEqual(['proposed', 'undone']);
  });
});
