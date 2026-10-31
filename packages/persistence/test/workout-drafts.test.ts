import { afterEach, describe, expect, it } from 'vitest';

import { discardWorkoutDraft, newBuilderDraft, newWorkoutDraft, restoreWorkoutDraft, addDraftVersion, builderSetupOf, currentDraftVersion, ruleSetupOf } from '@fizz/domain';
import { at, hotelFixture, id, OWNER, profile } from '@fizz/domain/testing';
import type { ActionRecord, SessionAggregate, WorkoutDraft, WorkoutDraftVersion } from '@fizz/schemas';

import { checkIntegrity, createBackup, DatabaseManager, domainOf, exportTables, fenceHolds, openStore, type Store } from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/**
 * Coach-built workout drafts in SQLite (workout-builder §8.2, migration 13):
 * the coach's write (draft + `build_workout` record in one transaction,
 * idempotent on the opId, a stale version refused), Ben's versioned writes,
 * the 14-day expiry, a Start that marks the draft `started` inside the
 * session's own transaction (and moves the fence), backup and restore (Your
 * data), and a force-close.
 */

let dirs: { dir: string; cleanup: () => void }[] = [];
afterEach(() => {
  for (const d of dirs) d.cleanup();
  dirs = [];
});
function managerIn(dir?: string): Promise<DatabaseManager> {
  let path = dir;
  if (path === undefined) {
    const d = tempDir();
    dirs.push(d);
    path = d.dir;
  }
  let n = 0;
  return DatabaseManager.open({ host: nodeDatabaseHost(path), newName: () => `w-${String(Date.now())}-${String((n += 1))}.db` });
}

const DRAFT = id(6100);
const { pushA, BENCH } = hotelFixture;

function version(over: Partial<WorkoutDraftVersion> = {}): WorkoutDraftVersion {
  return {
    n: 1,
    parentN: null,
    status: 'current',
    actionId: id(6200),
    turnId: 'turn-1',
    request: { text: 'build me a 45-minute push session for this gym', minutes: 45, focus: 'push', gymId: null, origin: 'text' },
    rawArgs: '{"exercises":[]}',
    plan: { slots: [{ slotKey: id(6300), exerciseId: BENCH, catalogueId: 'barbell-bench-press', order: 0, main: true, supersetGroup: null, setTemplates: [{ setType: 'working', reps: { min: 6, max: 8 }, durationS: null, targetRpe: 8, restS: null }] }] },
    fitMinutes: 45,
    checks: [],
    rationale: 'Bench first.',
    contextHash: 'ctx',
    equipmentVersion: 'eq',
    createdAt: at(0),
    ...over,
  };
}

function record(opId: string, d: WorkoutDraft): ActionRecord {
  const v = currentDraftVersion(d);
  return {
    actionId: v.actionId,
    turnId: 'turn-1',
    opId,
    status: 'committed',
    author: 'coach',
    detail: { kind: 'build_workout', draftId: d.id, versionN: v.n, parentN: v.parentN, name: d.name, exerciseCount: v.plan.slots.length, leftOut: 0, gymName: null, lines: [] },
    failure: null,
    reason: v.rationale,
    evidenceRefs: [],
    guardNotes: [],
    entityVersions: [],
    undoneBy: null,
    createdAt: v.createdAt,
  };
}

async function seeded(store: Store): Promise<WorkoutDraft> {
  await store.repos.profiles.save(profile(), null);
  const d = newWorkoutDraft({ id: DRAFT, ownerId: OWNER, version: version(), opId: 'build-1', at: at(0) });
  expect(await store.repos.coach.commit(OWNER, { kind: 'workout_draft', action: record('build-1', d), draft: d, expectedVersion: null })).toMatchObject({ status: 'written' });
  return d;
}

/** A workout started from the draft. */
function startedFrom(d: WorkoutDraft, opId = 'start-1', startAt = at(60)): SessionAggregate {
  const a = pushA();
  const sid = id(4100 + opId.length);
  return {
    ...a,
    session: { ...a.session, id: sid, routineId: null, routineName: d.name, startOperationId: opId, startedAt: startAt, lastActivityAtUtc: startAt.utc, coachDraft: { draftId: d.id, version: d.currentVersion, name: d.name } },
    sets: a.sets.map((s) => ({ ...s, sessionId: sid })),
    exercises: a.exercises.map((e) => ({ ...e, sessionId: sid })),
  };
}

describe('the coach writes a draft with its record, once (rule 5)', () => {
  it('a replayed opId is the same write; a new version on a stale draft version writes nothing; on the current one it lands with its record', async () => {
    const store = await openStore(memoryDriver());
    const d = await seeded(store);
    expect(await store.repos.coach.commit(OWNER, { kind: 'workout_draft', action: record('build-1', d), draft: d, expectedVersion: null })).toMatchObject({ status: 'replayed' });
    expect(await store.repos.workoutDrafts.listByOwner(OWNER)).toHaveLength(1);
    // Another first draft with the same ID (a different opId) can't overwrite it.
    expect(await store.repos.coach.commit(OWNER, { kind: 'workout_draft', action: record('build-2', d), draft: d, expectedVersion: null })).toEqual({ status: 'conflict', reason: 'already_exists' });

    const v2 = addDraftVersion(d, { version: version({ actionId: id(6201), rationale: 'Shorter.' }), expectedVersion: d.version, opId: 'build-3', at: at(30) });
    if (v2.kind !== 'write') throw new Error(v2.kind);
    expect(await store.repos.coach.commit(OWNER, { kind: 'workout_draft', action: record('build-3', v2.next), draft: v2.next, expectedVersion: 7 })).toEqual({ status: 'conflict', reason: 'stale_version' });
    expect((await store.repos.workoutDrafts.get(DRAFT))?.version).toBe(1);
    expect(await store.repos.coach.commit(OWNER, { kind: 'workout_draft', action: record('build-3', v2.next), draft: v2.next, expectedVersion: 1 })).toMatchObject({ status: 'written' });
    expect(await store.repos.workoutDrafts.get(DRAFT)).toMatchObject({ currentVersion: 2, version: 2 });
    expect((await store.repos.coach.getAction(id(6201)))?.detail).toMatchObject({ kind: 'build_workout', versionN: 2, parentN: 1 });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });

  it('a closed draft takes no new version (discarded, started or past 14 days)', async () => {
    const store = await openStore(memoryDriver());
    const d = await seeded(store);
    const gone = await store.repos.workoutDrafts.write(OWNER, DRAFT, (c) => discardWorkoutDraft(c, { expectedVersion: 1, opId: 'discard', at: at(10) }));
    expect(gone).toMatchObject({ status: 'written', draft: { status: 'discarded', version: 2 } });
    const v2 = addDraftVersion({ ...d, version: 2 }, { version: version({ actionId: id(6202) }), expectedVersion: 2, opId: 'build-4', at: at(30) });
    if (v2.kind !== 'write') throw new Error(v2.kind);
    expect(await store.repos.coach.commit(OWNER, { kind: 'workout_draft', action: record('build-4', v2.next), draft: v2.next, expectedVersion: 2 })).toEqual({ status: 'conflict', reason: 'stale_version' });
    await store.close();
  });
});

describe('Ben’s draft writes: versioned, idempotent, 14 days (BD4)', () => {
  it('Discard and its Undo; a retried tap is replayed; a stale one changes nothing', async () => {
    const store = await openStore(memoryDriver());
    await seeded(store);
    const discard = (c: WorkoutDraft) => discardWorkoutDraft(c, { expectedVersion: 1, opId: 'discard', at: at(10) });
    expect(await store.repos.workoutDrafts.write(OWNER, DRAFT, discard)).toMatchObject({ status: 'written' });
    expect(await store.repos.workoutDrafts.write(OWNER, DRAFT, discard)).toMatchObject({ status: 'replayed', draft: { version: 2 } });
    expect(await store.repos.workoutDrafts.write(OWNER, DRAFT, (c) => restoreWorkoutDraft(c, { expectedVersion: 1, opId: 'restore', at: at(20) }))).toMatchObject({ status: 'stale' });
    expect(await store.repos.workoutDrafts.write(OWNER, DRAFT, (c) => restoreWorkoutDraft(c, { expectedVersion: 2, opId: 'restore', at: at(20) }))).toMatchObject({ status: 'written', draft: { status: 'open', version: 3 } });
    expect(await store.repos.workoutDrafts.write(id(999), DRAFT, discard)).toEqual({ status: 'missing' });
    await store.close();
  });

  it('expires after 14 days, once; a started draft is never expired', async () => {
    const store = await openStore(memoryDriver());
    const d = await seeded(store);
    expect(await store.repos.workoutDrafts.expire(OWNER, at(13 * 86_400).utc)).toEqual([]);
    const closed = await store.repos.workoutDrafts.expire(OWNER, d.expiresAtUtc);
    expect(closed.map((x) => [x.id, x.status, x.version])).toEqual([[DRAFT, 'expired', 2]]);
    expect(await store.repos.workoutDrafts.expire(OWNER, at(20 * 86_400).utc)).toEqual([]);
    await store.close();
  });
});

describe('Start marks the draft started in the session’s own transaction (§6.3)', () => {
  it('the draft row is in the fence; a second start from it is stale; the session keeps the provenance', async () => {
    const store = await openStore(memoryDriver());
    const d = await seeded(store);
    const fence = { rows: [{ table: 'workout_drafts' as const, id: DRAFT, version: 1 }], sets: [] };
    expect(await store.db.read((q) => fenceHolds(q, fence))).toBe(true);
    const a = startedFrom(d);
    expect(await store.repos.sessions.save(a, null, fence)).toMatchObject({ ok: true });
    expect(await store.repos.workoutDrafts.get(DRAFT)).toMatchObject({ status: 'started', sessionId: a.session.id, startedAtUtc: at(60).utc, version: 2 });
    expect(await store.db.read((q) => fenceHolds(q, fence))).toBe(false);
    expect((await store.repos.sessions.get(a.session.id))?.session.coachDraft).toEqual({ draftId: DRAFT, version: 1, name: 'Push · 45 min' });
    // Started: it can't be the start of another workout (the write refuses; nothing is created).
    await store.repos.sessions.save({ ...a, session: { ...a.session, status: 'finished', endedAt: at(600) } }, a.revision).catch(() => undefined);
    const again = startedFrom(d, 'start-again', at(700));
    expect(await store.repos.sessions.save(again, null)).toMatchObject({ ok: false, error: 'stale_inputs' });
    expect(await store.repos.sessions.get(again.session.id)).toBeNull();
    await store.close();
  });

  it('an expired draft starts nothing', async () => {
    const store = await openStore(memoryDriver());
    const d = await seeded(store);
    const late = startedFrom(d, 'start-late', { utc: d.expiresAtUtc, tz: d.tz });
    expect(await store.repos.sessions.save(late, null)).toMatchObject({ ok: false, error: 'stale_inputs' });
    expect(await store.repos.workoutDrafts.get(DRAFT)).toMatchObject({ status: 'open' });
    await store.close();
  });
});

describe('Your data: backup, restore, relaunch (rule 10)', () => {
  it('drafts are Your data; a backup carries them and a restore keeps an open one open on its own clock; a relaunch reads it back', async () => {
    expect(domainOf('workout_drafts', {})).toBe('your_data');
    const d = tempDir();
    dirs.push(d);
    const src = await managerIn(d.dir);
    const draft = await seeded(src.store);
    const before = await src.store.db.read((q) => exportTables(q));
    expect(before.workout_drafts).toHaveLength(1);
    const made = await createBackup(src.store, { at: at(100), app: { name: 'GymSmarter', version: '0.1.0', build: null } });
    await src.close();

    const again = await managerIn(d.dir);
    expect(await again.store.repos.workoutDrafts.get(DRAFT)).toEqual(draft);
    await again.close();

    const dst = await managerIn();
    expect(await dst.restore(made.text, at(200))).toMatchObject({ ok: true });
    expect(await dst.store.repos.workoutDrafts.get(DRAFT)).toEqual(draft);
    expect((await checkIntegrity(dst.store.db)).ok).toBe(true);
    await dst.close();
  });
});

describe('a builder draft stored before D5 (Ben, 22–23 Oct: Arms and Core) still loads', () => {
  it('Biceps and Triceps rows read as one Arms row, a `Triceps` / `Abs` carry-over as Arms / Core; through relaunch and a backup restore', async () => {
    const d = tempDir();
    dirs.push(d);
    const src = await managerIn(d.dir);
    await src.store.repos.profiles.save(profile(), null);
    const setup = {
      dayId: 'chest',
      minutes: 60,
      mainLiftExerciseId: null,
      supersets: true,
      groups: [
        { parts: ['Chest' as const], count: 3 },
        { parts: ['Triceps' as const], count: 1 },
        { parts: ['Biceps' as const], count: 1 },
        { parts: ['Core' as const], count: 1 },
      ],
      carryOver: { choice: 'carried' as const, atUtc: at(5).utc, items: [{ group: 'Arms' as const, sets: 3, exerciseId: id(6301), toDayIndex: 1, toDayName: 'Back' }, { group: 'Core' as const, sets: 2, exerciseId: id(6302), toDayIndex: 1, toDayName: 'Back' }] },
    };
    const draft = newBuilderDraft({ id: DRAFT, ownerId: OWNER, opId: 'build-d5', actionId: id(6201), name: 'Chest', key: { planId: null, dayIndex: null, splitDayId: 'chest', mainLiftExerciseId: null, localDate: '2026-10-20' }, setup, plan: version().plan, focus: 'chest', gymId: null, equipmentVersion: 'eq', contextHash: 'ctx', at: at(0) });
    expect(await src.store.repos.workoutDrafts.createBuilderDraft(OWNER, draft)).toMatchObject({ status: 'written' });
    // The row as an older build wrote it: pre-D5 group keys in the stored JSON.
    await src.store.db.write((tx) => tx.run(`UPDATE workout_drafts SET data = replace(replace(data, '"group":"Arms"', '"group":"Triceps"'), '"group":"Core"', '"group":"Abs"') WHERE id = ?`, [DRAFT]));
    const raw = await src.store.db.read((q) => q.getFirst<{ data: string }>('SELECT data FROM workout_drafts WHERE id = ?', [DRAFT]));
    expect(raw?.data).toContain('"group":"Triceps"');
    expect(raw?.data).toContain('"group":"Abs"');

    const check = (got: Awaited<ReturnType<Store['repos']['workoutDrafts']['get']>>) => {
      const st = got === null ? null : builderSetupOf(got);
      expect(st?.carryOver?.items.map((x) => x.group)).toEqual(['Arms', 'Core']);
      const rules = st === null ? null : ruleSetupOf(st);
      expect(rules?.groups).toEqual([
        { group: 'Chest', count: 3 },
        { group: 'Arms', count: 2 },
        { group: 'Core', count: 1 },
      ]);
      // Both arm parts were rows: Arms picks either.
      expect(rules?.armParts).toBeUndefined();
    };
    check(await src.store.repos.workoutDrafts.get(DRAFT));
    const made = await createBackup(src.store, { at: at(100), app: { name: 'GymSmarter', version: '0.1.0', build: null } });
    await src.close();

    const again = await managerIn(d.dir);
    check(await again.store.repos.workoutDrafts.get(DRAFT));
    await again.close();

    const dst = await managerIn();
    expect(await dst.restore(made.text, at(200))).toMatchObject({ ok: true });
    check(await dst.store.repos.workoutDrafts.get(DRAFT));
    expect((await checkIntegrity(dst.store.db)).ok).toBe(true);
    await dst.close();
  });
});
