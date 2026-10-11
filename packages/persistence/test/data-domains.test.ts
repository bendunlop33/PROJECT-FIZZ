import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newCheckIn, newPainFlag } from '@fizz/domain';
import {
  assisted,
  at,
  barbell,
  doubleProgression,
  dumbbells,
  exercise,
  gym,
  id,
  idGen,
  OWNER,
  profile,
  richFinishedSession,
  routine,
  routineExercise,
  SPLIT_SQUAT,
  stack,
  unilateralSession,
} from '@fizz/domain/testing';
import { ActionRecordSchema, type ActionDetail, type ActionRecord, type Exercise } from '@fizz/schemas';
import {
  CLASSIFIED_TABLES,
  checkIntegrity,
  DatabaseManager,
  domainOf,
  exportDomain,
  exportTables,
  filterDomain,
  type DatabaseHost,
  type SqlDriver,
  type SqlRow,
  type Store,
  userTables,
} from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { tempDir } from './helpers';

/**
 * `Delete my data` and `Reset coaching knowledge` at the database level
 * (data-import-export §4.5, checks 30, 31, 31a; CLAUDE.md rule 10), on real
 * SQLite files.
 */

let dirs: { dir: string; cleanup: () => void }[] = [];
function dir(): string {
  const d = tempDir();
  dirs.push(d);
  return d.dir;
}
let managers: DatabaseManager[] = [];
afterEach(async () => {
  for (const m of managers) await m.close().catch(() => undefined);
  managers = [];
  for (const d of dirs) d.cleanup();
  dirs = [];
});

const counters = new Map<string, number>();
function names(directory: string): () => string {
  return () => {
    const n = (counters.get(directory) ?? 0) + 1;
    counters.set(directory, n);
    return `training-${String(n)}.db`;
  };
}

async function openManager(directory: string, host: DatabaseHost = nodeDatabaseHost(directory), newName = names(directory)): Promise<DatabaseManager> {
  const m = await DatabaseManager.open({ host, newName });
  managers.push(m);
  return m;
}

let seq = 5000;
function action(detail: ActionDetail): ActionRecord {
  seq += 1;
  return ActionRecordSchema.parse({
    actionId: id(seq),
    turnId: null,
    opId: `op-${String(seq)}`,
    status: 'committed',
    author: 'ben',
    detail,
    failure: null,
    reason: null,
    evidenceRefs: [],
    guardNotes: [],
    entityVersions: [],
    undoneBy: null,
    createdAt: at(seq),
  });
}

/** A knowledge exercise nothing of Ben's uses (a reset removes it). */
const UNUSED = exercise(260, 'Landmine press');
/** One the bundled list ships (a reset brings it back). */
const BUNDLED = exercise(270, 'Goblet squat');

/** Both domains, every kind of Your-data record including coach records. */
async function populate(store: Store): Promise<void> {
  const { repos } = store;
  await repos.profiles.save(profile({ preferredUnit: 'lb' }), null);
  await repos.gyms.save(gym(2, { isDefault: true }), null);
  for (const eq of [barbell(), dumbbells({ unit: 'lb', loads: [5, 10, 12.5], maxLoad: 12.5 }), stack({ addOns: [2.5] }), assisted()]) await repos.equipment.save(eq, null);
  await repos.exercises.save(SPLIT_SQUAT, null);
  await repos.exercises.save(UNUSED, null);
  await repos.exercises.save(exercise(241, 'Custom press', { ownerId: OWNER, source: 'custom' }), null);
  await repos.routines.save(routine([routineExercise(700, { exerciseId: SPLIT_SQUAT.id })]), null);
  await repos.progressionRules.save(doubleProgression(), null);
  await repos.sessions.save(richFinishedSession(), null);
  const active = unilateralSession('start-active', idGen(97_000));
  const checkIn = newCheckIn({ id: id(300), ownerId: OWNER, opId: 'checkin-op', score: 2, reasons: ['tired'], note: 'Slept badly', at: at(10), localDate: '2026-10-08' });
  await repos.checkIns.save(checkIn, null);
  await repos.painFlags.save(
    newPainFlag({ id: id(301), ownerId: OWNER, opId: 'pain-op', exerciseId: SPLIT_SQUAT.id, exerciseName: SPLIT_SQUAT.name, area: 'knee', source: 'check_in', checkInId: checkIn.id, at: at(11) }),
    null,
  );
  await repos.sessions.save({ ...active, session: { ...active.session, checkIn: { kind: 'answered', checkInId: checkIn.id } } }, null);
  const m = action({ kind: 'save_memory', memoryId: id(400), text: 'Trains before work' });
  await repos.coach.commit(OWNER, {
    kind: 'save_memory',
    action: m,
    memory: { id: id(400), ownerId: OWNER, version: 1, createdAtUtc: at(1).utc, updatedAtUtc: at(1).utc, text: 'Trains before work', contentKey: 'memory:trains', status: 'active', quote: 'I train before work', createdByActionId: m.actionId },
  });
  const c = action({ kind: 'add_playbook_candidate', candidateId: id(401), text: 'Deload every 6 weeks' });
  await repos.coach.commit(OWNER, {
    kind: 'playbook_candidate',
    action: c,
    candidate: { id: id(401), version: 1, createdAtUtc: at(1).utc, updatedAtUtc: at(1).utc, text: 'Deload every 6 weeks', contentKey: 'playbook:deload', statedBy: 'ben', status: 'to_review', createdByActionId: c.actionId },
  });
}

const snapshot = (store: Store) => store.db.read((q) => exportTables(q));
const dbFiles = (d: string) => readdirSync(d).filter((f) => f.endsWith('.db')).sort();
const rowsOf = (tables: Record<string, SqlRow[]>) => Object.values(tables).reduce((n, r) => n + r.length, 0);

describe('data domains', () => {
  it('every table at the current schema belongs to exactly one rule (a new table fails here until classified)', async () => {
    const m = await openManager(dir());
    const tables = await m.store.db.read((q) => userTables(q));
    expect([...CLASSIFIED_TABLES].sort()).toEqual(tables);
    expect(() => domainOf('something_new', {})).toThrow(/isn.t assigned/);
    expect(domainOf('exercises', { owner_id: null })).toBe('coaching_knowledge');
    expect(domainOf('exercises', { owner_id: OWNER })).toBe('your_data');
    expect(domainOf('playbook_candidates', {})).toBe('coaching_knowledge');
    expect(domainOf('memories', {})).toBe('your_data');
  });

  it('exports one domain only: Coaching knowledge has no owner-scoped record; My data has no knowledge record', async () => {
    const m = await openManager(dir());
    await populate(m.store);
    const known = await m.store.db.read((q) => exportDomain(q, 'coaching_knowledge'));
    expect(Object.keys(known.tables).sort()).toEqual(['exercises', 'playbook_candidates']);
    for (const rows of Object.values(known.tables)) for (const r of rows) expect(r.owner_id ?? null).toBeNull();
    // Check 29a: no known personal string anywhere in the file.
    const knownText = JSON.stringify(known);
    for (const personal of [OWNER, 'Slept badly', 'Trains before work', 'I train before work', 'knee', id(300), id(301), id(400), gym(2).name]) expect(knownText).not.toContain(personal);
    // JSON columns are opened, not escaped text.
    expect(known.tables.playbook_candidates?.[0]?.data).toMatchObject({ text: 'Deload every 6 weeks' });

    const mine = await m.store.db.read((q) => exportDomain(q, 'your_data'));
    expect(mine.tables.playbook_candidates).toBeUndefined();
    expect(mine.tables.exercises?.map((r) => r.id)).toEqual([id(241)]);
    for (const t of ['profiles', 'sessions', 'session_sets', 'check_ins', 'pain_flags', 'memories', 'coach_actions']) expect(mine.tables[t]?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('deleteYourData', () => {
  let d: string;
  let m: DatabaseManager;
  beforeEach(async () => {
    d = dir();
    m = await openManager(d);
    await populate(m.store);
  });

  it('removes every Your-data record, leaves Coaching knowledge identical, and keeps no copy of the old data', async () => {
    const before = await snapshot(m.store);
    const { stamp, counts } = await m.domainSummary();
    expect(counts.yourData).toMatchObject({ workouts: 1, gyms: 1, routines: 1, checkIns: 1, painFlags: 1, memories: 1 });
    expect(counts.coachingKnowledge).toMatchObject({ exercises: 2, playbookCandidates: 1 });

    const r = await m.deleteYourData({ expectedStamp: stamp });
    expect(r).toMatchObject({ ok: true, status: 'switched' });
    const after = await snapshot(m.store);
    expect(rowsOf(filterDomain(after, 'your_data'))).toBe(0);
    expect(filterDomain(after, 'coaching_knowledge')).toEqual(filterDomain(before, 'coaching_knowledge'));
    expect((await checkIntegrity(m.store.db)).ok).toBe(true);
    // The old file is gone; there's no rollback to Ben's data.
    expect(m.databaseNames).toEqual({ current: 'training-2.db', previous: null, orphan: null });
    expect(m.rollbackTarget).toEqual({ available: false, last: null });
    expect(dbFiles(d)).toEqual(['fizz-meta.db', 'training-2.db']);

    // Survives a relaunch; a repeat changes nothing.
    await m.close();
    m = await openManager(d);
    expect(rowsOf(filterDomain(await snapshot(m.store), 'your_data'))).toBe(0);
    expect(await m.deleteYourData()).toMatchObject({ ok: true, status: 'unchanged' });
    expect(m.databaseNames.current).toBe('training-2.db');
  });

  it('is refused against a stale confirmation: nothing changes', async () => {
    const { stamp } = await m.domainSummary();
    await m.store.repos.gyms.save(gym(3), null);
    const before = await snapshot(m.store);
    expect(await m.deleteYourData({ expectedStamp: stamp })).toMatchObject({ ok: false, error: { code: 'preview_stale' } });
    expect(await snapshot(m.store)).toEqual(before);
    expect(m.databaseNames).toEqual({ current: 'training-1.db', previous: null, orphan: null });
  });

  it('also drops the copy kept for Undo restore (it holds Ben’s data) and the last-restore record', async () => {
    // Make a rollback generation by restoring a backup of the same data plus one more gym.
    const { createBackup } = await import('../src/index');
    await m.store.repos.gyms.save(gym(3), null);
    const text = (await createBackup(m.store, { at: at(50), app: { name: 'x', version: '1', build: null } })).text;
    await m.store.repos.gyms.save(gym(4), null);
    expect(await m.restore(text, at(60))).toMatchObject({ ok: true, status: 'restored' });
    expect(m.rollbackTarget.available).toBe(true);
    expect(await m.deleteYourData()).toMatchObject({ ok: true, status: 'switched' });
    expect(m.rollbackTarget).toEqual({ available: false, last: null });
    expect(dbFiles(d)).toEqual(['fizz-meta.db', m.databaseNames.current]);
  });

  it('an old file whose quiet removal failed is still removed, never dropped from the slots and left on disk (review r2 N1)', async () => {
    await m.close();
    const real = nodeDatabaseHost(d);
    const failOnce = new Set<string>();
    const host: DatabaseHost = {
      open: (name) => real.open(name),
      async remove(name) {
        if (failOnce.delete(name)) throw new Error(`busy: ${name}`);
        await real.remove(name);
      },
    };
    m = await openManager(d, host);
    const { createBackup } = await import('../src/index');
    const backupOf = async (n: number) => {
      await m.store.repos.gyms.save(gym(n), null);
      return (await createBackup(m.store, { at: at(n), app: { name: 'x', version: '1', build: null } })).text;
    };
    const first = await backupOf(3);
    await m.store.repos.gyms.save(gym(4), null);
    expect(await m.restore(first, at(60))).toMatchObject({ ok: true, status: 'restored' });
    const second = await backupOf(5);
    await m.store.repos.gyms.save(gym(6), null);
    // The second restore drops the oldest file; its removal fails, so it stays as the orphan.
    const oldest = m.databaseNames.previous ?? '';
    failOnce.add(oldest);
    expect(await m.restore(second, at(70))).toMatchObject({ ok: true, status: 'restored' });
    expect(m.databaseNames.orphan).toBe(oldest);
    expect(dbFiles(d)).toContain(oldest);

    expect(await m.deleteYourData()).toMatchObject({ ok: true, status: 'switched' });
    expect(m.databaseNames).toEqual({ current: m.databaseNames.current, previous: null, orphan: null });
    expect(dbFiles(d)).toEqual(['fizz-meta.db', m.databaseNames.current]);
  });

  it('a force-close at any point leaves either all of Ben’s data or none of it; a relaunch can finish the clean-up', async () => {
    const before = await snapshot(m.store);
    await m.close();
    // Kill the app at every meta write: copy the files as they are on disk at that moment.
    const real = nodeDatabaseHost(d);
    const crashes: string[] = [];
    const snap = () => {
      const target = join(dir(), 'crash');
      mkdirSync(target);
      cpSync(d, target, { recursive: true });
      crashes.push(target);
    };
    const host: DatabaseHost = {
      async open(name) {
        const driver = await real.open(name);
        if (name !== 'fizz-meta.db') return driver;
        const wrapped: SqlDriver = {
          ...driver,
          exec: (s) => driver.exec(s),
          run: (s, p) => driver.run(s, p),
          getAll: (s, p) => driver.getAll(s, p),
          getFirst: (s, p) => driver.getFirst(s, p),
          close: () => driver.close(),
          async withExclusiveTransaction(fn) {
            snap();
            const out = await driver.withExclusiveTransaction(fn);
            snap();
            return out;
          },
        };
        return wrapped;
      },
      remove: (name) => real.remove(name),
    };
    m = await openManager(d, host);
    const startAt = crashes.length;
    expect(await m.deleteYourData()).toMatchObject({ ok: true, status: 'switched' });
    const points = crashes.slice(startAt);
    expect(points.length).toBeGreaterThanOrEqual(4);
    const seen = new Set<string>();
    for (const p of points) {
      const after = await openManager(p, nodeDatabaseHost(p), names(p));
      const now = await snapshot(after.store);
      const mine = rowsOf(filterDomain(now, 'your_data'));
      if (mine === 0) {
        seen.add('none');
        expect(filterDomain(now, 'coaching_knowledge')).toEqual(filterDomain(before, 'coaching_knowledge'));
        // Finish what the app would finish on relaunch: no file with Ben's data is left.
        expect(await after.deleteYourData()).toMatchObject({ ok: true, status: 'unchanged' });
        expect(dbFiles(p)).toEqual(['fizz-meta.db', after.databaseNames.current]);
      } else {
        seen.add('all');
        expect(now).toEqual(before);
      }
      await after.close();
    }
    expect(seen).toEqual(new Set(['all', 'none']));
  });
});

describe('meta database migration 3 (reset switch reason)', () => {
  it('keeps the slots and the last restore of a version-2 meta database, then accepts a reset', async () => {
    const d = dir();
    const first = await openManager(d);
    await populate(first.store);
    await first.close();
    managers = managers.filter((x) => x !== first);
    // Put the meta database back to version 2 as an older build left it, with a restore recorded.
    const meta = await nodeDatabaseHost(d).open('fizz-meta.db');
    await meta.exec(`DROP TABLE database_slots;
      CREATE TABLE database_slots (
        id INTEGER PRIMARY KEY CHECK (id = 1), current_name TEXT NOT NULL, previous_name TEXT, orphan_name TEXT,
        switched_at_utc TEXT, switch_reason TEXT CHECK (switch_reason IN ('restore', 'rollback'))
      ) STRICT;
      ALTER TABLE database_slots ADD COLUMN orphan_reason TEXT CHECK (orphan_reason IN ('restore', 'check', 'dropped'));
      INSERT INTO database_slots (id, current_name, switched_at_utc, switch_reason) VALUES (1, 'training-1.db', '${at(5).utc}', 'restore');
      PRAGMA user_version = 2;`);
    await meta.close();

    const m = await openManager(d);
    expect(m.databaseNames).toEqual({ current: 'training-1.db', previous: null, orphan: null });
    expect(m.rollbackTarget.last).toEqual({ atUtc: at(5).utc, reason: 'restore' });
    expect(await m.resetKnowledge([BUNDLED], { at: at(6) })).toMatchObject({ ok: true, status: 'switched' });
    expect(m.rollbackTarget.last?.reason).toBe('reset');
  });
});

describe('resetKnowledge', () => {
  let d: string;
  let m: DatabaseManager;
  const bundled: readonly Exercise[] = [BUNDLED, SPLIT_SQUAT];
  beforeEach(async () => {
    d = dir();
    m = await openManager(d);
    await populate(m.store);
  });

  it('restores the bundled knowledge, keeps exercises Ben’s records use, and leaves Your data identical', async () => {
    const before = await snapshot(m.store);
    const { stamp } = await m.domainSummary();
    expect(await m.resetKnowledge(bundled, { expectedStamp: stamp })).toMatchObject({ ok: true, status: 'switched' });
    const after = await snapshot(m.store);
    expect(filterDomain(after, 'your_data')).toEqual(filterDomain(before, 'your_data'));
    const known = filterDomain(after, 'coaching_knowledge');
    expect(known.exercises?.map((r) => r.id).sort()).toEqual([BUNDLED.id, SPLIT_SQUAT.id].sort());
    expect(known.playbook_candidates).toEqual([]);
    expect((await checkIntegrity(m.store.db)).ok).toBe(true);
    // One rollback generation is kept.
    expect(m.databaseNames).toEqual({ current: 'training-2.db', previous: 'training-1.db', orphan: null });

    // A repeat is unchanged; a rollback brings the old knowledge back.
    expect(await m.resetKnowledge(bundled)).toMatchObject({ ok: true, status: 'unchanged' });
    expect(m.databaseNames.current).toBe('training-2.db');
    expect(dbFiles(d)).toEqual(['fizz-meta.db', 'training-1.db', 'training-2.db']);
    expect(await m.rollback(at(99))).toMatchObject({ ok: true });
    expect(await snapshot(m.store)).toEqual(before);
  });

  it('records the reset for Undo last reset; undoing and redoing swap the two (check 31a), and survive a relaunch', async () => {
    const before = await snapshot(m.store);
    expect(await m.resetKnowledge(bundled, { at: at(90) })).toMatchObject({ ok: true, status: 'switched' });
    const reset = await snapshot(m.store);
    expect(m.rollbackTarget).toEqual({ available: true, last: { atUtc: at(90).utc, reason: 'reset' } });
    await m.close();
    m = await openManager(d);
    expect(m.rollbackTarget.last?.reason).toBe('reset');
    expect(await m.rollback(at(91))).toMatchObject({ ok: true });
    expect(m.rollbackTarget.last).toEqual({ atUtc: at(91).utc, reason: 'undo_reset' });
    expect(await snapshot(m.store)).toEqual(before);
    expect(await m.rollback(at(92))).toMatchObject({ ok: true });
    expect(m.rollbackTarget.last?.reason).toBe('reset');
    expect(await snapshot(m.store)).toEqual(reset);
    // Delete my data after a reset leaves nothing to undo.
    expect(await m.deleteYourData()).toMatchObject({ ok: true, status: 'switched' });
    expect(m.rollbackTarget).toEqual({ available: false, last: null });
  });

  it('is refused against a stale confirmation', async () => {
    const { stamp } = await m.domainSummary();
    await m.store.repos.exercises.save(exercise(280, 'Hatfield squat'), null);
    const before = await snapshot(m.store);
    expect(await m.resetKnowledge(bundled, { expectedStamp: stamp })).toMatchObject({ ok: false, error: { code: 'preview_stale' } });
    expect(await snapshot(m.store)).toEqual(before);
  });

  it('a failed build changes nothing and leaves no file behind', async () => {
    const before = await snapshot(m.store);
    const broken: Exercise = { ...BUNDLED, id: 'not-an-id' };
    expect(await m.resetKnowledge([broken])).toMatchObject({ ok: false });
    expect(await snapshot(m.store)).toEqual(before);
    expect(dbFiles(d)).toEqual(['fizz-meta.db', 'training-1.db']);
    expect(m.databaseNames).toEqual({ current: 'training-1.db', previous: null, orphan: null });
  });
});
