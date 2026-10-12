import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import type { CoachToolCall } from '@fizz/schemas';
import { createAdjustExecutor, createStoreExecutors, type ToolCallContext } from '../src/executors';
import { at, FakeTodayTargets, id, memoryStore, OWNER, workout } from './turn-fixtures';

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

const ctx = (opId: string): ToolCallContext => ({ ownerId: OWNER, turnId: id(77), opId, now: at(5), benWords: null, messagePain: null, intent: 'general' });
const SQUAT = id(1050);

describe('store executors', () => {
  it('forget_memory with an old version is a stale card; nothing is forgotten; a replay is the same record', async () => {
    const s = await store();
    const ex = createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: null });
    const saved = await ex.save_memory?.({ tool: 'save_memory', args: { text: 'Hates lunges', quote: 'remember I hate lunges' } }, ctx('t:save'));
    const memoryId = saved?.kind === 'action' && saved.record.detail.kind === 'save_memory' ? saved.record.detail.memoryId : '';
    const forget: CoachToolCall = { tool: 'forget_memory', args: { memoryId, expectedVersion: 3 } };
    const r = await ex.forget_memory?.(forget, ctx('t:forget'));
    expect(r).toMatchObject({ kind: 'action', record: { status: 'stale', failure: 'it changed since' } });
    const again = await ex.forget_memory?.(forget, ctx('t:forget'));
    expect(again).toMatchObject({ kind: 'action', replayed: true });
    expect(await s.repos.coach.getMemory(memoryId)).toMatchObject({ status: 'active' });
  });

  it("Ben's \"remember\" of a general rule goes to the playbook, never memory; unclear words wait for his choice (CM9, review coach-tools r2 S1)", async () => {
    const s = await store();
    const ex = createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: null });
    const rule: CoachToolCall = { tool: 'save_memory', args: { text: 'Always deload every 5th week', quote: 'remember to always deload every 5th week' } };
    const r = await ex.save_memory?.(rule, ctx('t:rule'));
    expect(r).toMatchObject({ kind: 'action', replayed: false, record: { status: 'committed', detail: { kind: 'add_playbook_candidate', text: 'Always deload every 5th week' } } });
    expect(await s.repos.coach.listMemories(OWNER, 'all')).toEqual([]);
    expect(await s.repos.coach.listPlaybookCandidates()).toMatchObject([{ text: 'Always deload every 5th week', statedBy: 'ben', status: 'to_review' }]);
    // A replay (the same opId) is the same record; nothing is written twice.
    expect(await ex.save_memory?.(rule, ctx('t:rule'))).toMatchObject({ kind: 'action', replayed: true });
    expect(await s.repos.coach.listPlaybookCandidates()).toHaveLength(1);

    const unclear = await ex.save_memory?.({ tool: 'save_memory', args: { text: 'Avoid lunges', quote: 'remember to avoid lunges' } }, ctx('t:unclear'));
    expect(unclear).toMatchObject({ kind: 'action', record: { status: 'proposed', detail: { kind: 'suggest_memory', text: 'Avoid lunges' } } });
    expect(await s.repos.coach.listMemories(OWNER, 'all')).toMatchObject([{ text: 'Avoid lunges', status: 'suggested', source: 'ben_asked' }]);

    const personal = await ex.save_memory?.({ tool: 'save_memory', args: { text: 'Keep sessions under 45 minutes on weekdays', quote: 'remember my weekday sessions are 45 minutes max' } }, ctx('t:personal'));
    expect(personal).toMatchObject({ kind: 'action', record: { status: 'committed', detail: { kind: 'save_memory' } } });
  });

  it("Ben's \"remember\" of his own constraint without a subject never lands in the playbook (review coach-tools r3 S1, rule 10)", async () => {
    const s = await store();
    const ex = createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: null });
    const health = await ex.save_memory?.({ tool: 'save_memory', args: { text: 'Should not bench heavy until the shoulder settles', quote: "remember I shouldn't bench heavy until my shoulder settles" } }, ctx('t:health'));
    expect(health).toMatchObject({ kind: 'action', record: { status: 'committed', detail: { kind: 'save_memory' } } });
    const short = await ex.save_memory?.({ tool: 'save_memory', args: { text: 'Should keep sessions short', quote: 'remember I should keep sessions short' } }, ctx('t:short'));
    expect(short).toMatchObject({ kind: 'action', record: { status: 'committed', detail: { kind: 'save_memory' } } });
    const rest = await ex.save_memory?.({ tool: 'save_memory', args: { text: 'Rest 3 minutes between heavy sets', quote: 'remember to rest 3 minutes between heavy sets' } }, ctx('t:rest'));
    expect(rest).toMatchObject({ kind: 'action', record: { status: 'proposed', detail: { kind: 'suggest_memory' } } });
    expect(await s.repos.coach.listPlaybookCandidates()).toEqual([]);
    expect(await s.repos.coach.listMemories(OWNER, 'all')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Should not bench heavy until the shoulder settles', status: 'active' }),
        expect.objectContaining({ text: 'Should keep sessions short', status: 'active' }),
        expect.objectContaining({ text: 'Rest 3 minutes between heavy sets', status: 'suggested', source: 'ben_asked' }),
      ]),
    );
  });

  it('pain flags: an unknown exercise is refused (never guessed); an exercise already flagged is refused with why', async () => {
    const s = await store();
    const ex = createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: (x) => Promise.resolve(x === SQUAT ? 'Back squat' : null) }, sessionId: null });
    const unknown = await ex.set_pain_flag?.({ tool: 'set_pain_flag', args: { exerciseIds: [id(9999)], area: 'knee', quote: 'my knee hurts' } }, ctx('t:p0'));
    expect(unknown).toMatchObject({ record: { status: 'rejected' } });
    const first = await ex.set_pain_flag?.({ tool: 'set_pain_flag', args: { exerciseIds: [SQUAT], area: 'knee', quote: 'my knee hurts' } }, ctx('t:p1'));
    expect(first).toMatchObject({ record: { status: 'committed', detail: { exerciseNames: ['Back squat'] } } });
    const second = await ex.set_pain_flag?.({ tool: 'set_pain_flag', args: { exerciseIds: [SQUAT], area: 'knee', quote: 'still hurts' } }, ctx('t:p2'));
    expect(second).toMatchObject({ record: { status: 'rejected', failure: 'Back squat is already flagged' } });
    expect(await s.repos.painFlags.listActive(OWNER)).toHaveLength(1);
  });
});

describe('adjust executor (the seam for the session command)', () => {
  it('a kg request on lb equipment is never converted silently; a completed set is never changed (rule 2)', async () => {
    const s = await store();
    const targets = new FakeTodayTargets(workout(), s);
    const run = createAdjustExecutor({ store: s.repos.coach, targets, loadSession: () => Promise.resolve(targets.state), painFlags: () => Promise.resolve([]), sessionPainUnspecified: false, gymName: null });
    const r = await run(
      {
        tool: 'adjust_pending_sets',
        args: {
          baseVersion: 7,
          exercises: [{ sessionExerciseId: id(10), sets: [{ setId: id(101), target: { load: { value: 95, unit: 'kg', convention: 'total' }, reps: null } }, { setId: id(102), target: { load: { value: 210, unit: 'lb', convention: 'total' }, reps: null } }], addSet: null, removeSetId: null }],
          reason: 'Set 2 was RPE 10.',
        },
      },
      { ...ctx('t:adj'), intent: 'too_hard' },
    );
    expect(r.kind).toBe('action');
    const rec = r.kind === 'action' ? r.record : null;
    expect(rec?.status).toBe('committed');
    expect(rec?.guardNotes.map((n) => n.kind)).toEqual(expect.arrayContaining(['completed_set_dropped', 'converted']));
    const changed = rec?.detail.kind === 'adjust_pending_sets' ? rec.detail.exercises[0]?.changes : [];
    expect(changed?.map((c) => c.setNumber)).toEqual([3]);
    expect(changed?.[0]?.after?.load?.unit).toBe('kg');
    expect(rec?.reason).toBe('Set 2 was RPE 10.');
  });

  it('a reason that itself claims a change is not kept on the card (CC3)', async () => {
    const s = await store();
    const targets = new FakeTodayTargets(workout(), s);
    const run = createAdjustExecutor({ store: s.repos.coach, targets, loadSession: () => Promise.resolve(targets.state), painFlags: () => Promise.resolve([]), sessionPainUnspecified: false, gymName: null });
    const r = await run(
      {
        tool: 'adjust_pending_sets',
        args: { baseVersion: 7, exercises: [{ sessionExerciseId: id(10), sets: [{ setId: id(102), target: { load: { value: 95, unit: 'kg', convention: 'total' }, reps: null } }], addSet: null, removeSetId: null }], reason: 'I also removed set 4.' },
      },
      ctx('t:adj2'),
    );
    expect(r.kind === 'action' ? r.record.reason : 'x').toBeNull();
  });
});
