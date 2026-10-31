import { afterEach, describe, expect, it } from 'vitest';
import { at, OWNER, profile } from '@fizz/domain/testing';
import {
  checkIntegrity,
  createBackup,
  DatabaseManager,
  domainOf,
  filterDomain,
  migrate,
  MIGRATIONS,
  openStore,
  parseBackup,
  readUserVersion,
  trainingProfileId,
  YOUR_DATA_TABLES,
  type Store,
} from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/** Training details and split (migration 16; Ben 13 Oct D5, D7, D8). */

const APP = { name: 'PROJECT-FIZZ', version: '0.1.0', build: null };
const W = (opId: string, expectedVersion: number) => ({ opId, expectedVersion, atUtc: at(10).utc, nowYear: 2026, today: '2026-10-14' });

const stores: Store[] = [];
const cleanups: (() => void)[] = [];
const managers: DatabaseManager[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
  for (const m of managers.splice(0)) await m.close().catch(() => undefined);
  for (const c of cleanups.splice(0)) c();
});

async function fresh(): Promise<Store> {
  const s = await openStore(memoryDriver());
  stores.push(s);
  await s.repos.profiles.save(profile(), null);
  return s;
}

async function manager(): Promise<DatabaseManager> {
  const d = tempDir();
  cleanups.push(d.cleanup);
  let n = 0;
  const m = await DatabaseManager.open({ host: nodeDatabaseHost(d.dir), newName: () => `training-${String((n += 1))}.db` });
  managers.push(m);
  return m;
}

describe('migration 16', () => {
  it('adds training_profiles in place on a schema-15 database', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 15);
    expect(await migrate(db, MIGRATIONS, 16)).toEqual({ from: 15, to: 16, applied: [16] });
    expect(await readUserVersion(db)).toBe(16);
    expect(await db.getAll("SELECT name FROM sqlite_master WHERE name = 'training_profiles'")).toHaveLength(1);
  });
});

describe('SqliteTrainingProfiles (rule 5)', () => {
  it('nothing is stored until asked; ensure writes the defaults once', async () => {
    const s = await fresh();
    expect(await s.repos.trainingProfiles.get(OWNER)).toBeNull();
    const a = await s.repos.trainingProfiles.ensure(OWNER, at(1).utc);
    const b = await s.repos.trainingProfiles.ensure(OWNER, at(2).utc);
    expect(b).toEqual(a);
    expect(a).toMatchObject({ id: trainingProfileId(OWNER), version: 1, checkInWeeks: 6, sessionMinutes: 45, selfNextTargets: false });
  });

  it('a change is versioned; a repeated op ID is replayed; a stale version is refused', async () => {
    const s = await fresh();
    await s.repos.trainingProfiles.ensure(OWNER, at(1).utc);
    const w = await s.repos.trainingProfiles.change(OWNER, { kind: 'add_weight', entry: { id: 'w1', date: '2026-10-13', value: 180, unit: 'lb' } }, W('op-1', 1));
    expect(w).toMatchObject({ status: 'written', profile: { version: 2 } });
    const again = await s.repos.trainingProfiles.change(OWNER, { kind: 'add_weight', entry: { id: 'w1', date: '2026-10-13', value: 180, unit: 'lb' } }, W('op-1', 1));
    expect(again.status).toBe('replayed');
    const stale = await s.repos.trainingProfiles.change(OWNER, { kind: 'goal', goal: 'muscle' }, W('op-2', 1));
    expect(stale).toMatchObject({ status: 'stale', profile: { version: 2 } });
    const stored = await s.repos.trainingProfiles.get(OWNER);
    expect(stored?.version).toBe(2);
    expect(stored?.weights).toHaveLength(1);
    expect(stored?.goal).toBeUndefined();
  });

  it('the first change can come before ensure (version 1 is the defaults)', async () => {
    const s = await fresh();
    expect(await s.repos.trainingProfiles.change(OWNER, { kind: 'gender', gender: 'male' }, W('op-1', 1))).toMatchObject({ status: 'written', profile: { version: 2, about: { gender: 'male' } } });
  });

  it('an invalid value is refused and nothing is written', async () => {
    const s = await fresh();
    expect((await s.repos.trainingProfiles.change(OWNER, { kind: 'session_minutes', minutes: 5 }, W('op-1', 1))).status).toBe('invalid');
    expect(await s.repos.trainingProfiles.get(OWNER)).toBeNull();
  });
});

describe('Your data: backup, restore, export and delete cover it (rule 10)', () => {
  it('is a Your-data table, never Coaching knowledge', () => {
    expect(YOUR_DATA_TABLES).toContain('training_profiles');
    expect(domainOf('training_profiles', {})).toBe('your_data');
  });

  it('a backup carries it; a restore brings it back intact; Delete my data removes it', async () => {
    const source = await manager();
    await source.store.repos.profiles.save(profile(), null);
    await source.store.repos.trainingProfiles.change(OWNER, { kind: 'preset_split', split: 'clsb' }, W('op-1', 1));
    await source.store.repos.trainingProfiles.change(OWNER, { kind: 'birth_year', year: 1990 }, W('op-2', 2));
    const made = await createBackup(source.store, { at: at(20), app: APP });
    const parsed = await parseBackup(made.text);
    if (!parsed.ok) throw new Error('backup');
    expect(filterDomain(parsed.file.tables, 'your_data').training_profiles).toHaveLength(1);
    expect(filterDomain(parsed.file.tables, 'coaching_knowledge').training_profiles).toEqual([]);

    const target = await manager();
    expect(await target.restore(made.text, at(30))).toMatchObject({ ok: true, status: 'restored' });
    expect(await target.store.repos.trainingProfiles.get(OWNER)).toEqual(await source.store.repos.trainingProfiles.get(OWNER));
    expect((await checkIntegrity(target.store.db)).ok).toBe(true);

    expect(await target.deleteYourData()).toMatchObject({ ok: true });
    expect(await target.store.repos.trainingProfiles.get(OWNER)).toBeNull();
  });

  it('a damaged row fails the integrity check', async () => {
    const s = await fresh();
    await s.repos.trainingProfiles.ensure(OWNER, at(1).utc);
    await s.db.write((tx) => tx.run("UPDATE training_profiles SET data = json_set(data, '$.checkInWeeks', 99)"));
    expect((await checkIntegrity(s.db)).ok).toBe(false);
  });
});

describe('lift targets (Ben, 20 Oct): Your data, versioned, in backups', () => {
  const target = {
    id: 'target-1',
    exerciseId: '00000000-0000-4000-8000-0000000000b1',
    exerciseName: 'Bench Press',
    kind: 'one_rm' as const,
    load: { value: 225, unit: 'lb' as const, convention: 'total' as const },
    reps: 1,
    byDate: '2027-03-01',
    setAtUtc: at(10).utc,
    setOnDate: '2026-10-14',
    was: { value: 200, date: '2026-10-01', isEstimate: true },
    setBy: 'ben' as const,
  };

  it('the setting and the targets survive a backup and restore exactly', async () => {
    const source = await manager();
    await source.store.repos.profiles.save(profile(), null);
    await source.store.repos.trainingProfiles.change(OWNER, { kind: 'lift_targets_on', on: true }, W('op-1', 1));
    await source.store.repos.trainingProfiles.change(OWNER, { kind: 'set_lift_target', target }, W('op-2', 2));
    const made = await createBackup(source.store, { at: at(20), app: APP });
    const target2 = await manager();
    expect(await target2.restore(made.text, at(30))).toMatchObject({ ok: true, status: 'restored' });
    const back = await target2.store.repos.trainingProfiles.get(OWNER);
    expect(back?.liftTargetsOn).toBe(true);
    expect(back?.liftTargets).toEqual([target]);
    expect((await checkIntegrity(target2.store.db)).ok).toBe(true);
  });

  it('a fourth exercise is refused and nothing is written', async () => {
    const s = await fresh();
    let v = 1;
    for (const n of [1, 2, 3]) {
      const r = await s.repos.trainingProfiles.change(OWNER, { kind: 'set_lift_target', target: { ...target, id: `t${String(n)}`, exerciseId: `ex-${String(n)}` } }, W(`op-${String(n)}`, v));
      expect(r.status).toBe('written');
      v = r.profile.version;
    }
    const r = await s.repos.trainingProfiles.change(OWNER, { kind: 'set_lift_target', target: { ...target, id: 't4', exerciseId: 'ex-4' } }, W('op-4', v));
    expect(r.status).toBe('invalid');
    expect((await s.repos.trainingProfiles.get(OWNER))?.liftTargets).toHaveLength(3);
  });
});

describe('migration 27 (coach lift targets; 25 on its branch, renumbered on merge)', () => {
  it('keeps every coach action (pause_plan and update_gym included) and allows set_lift_target', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 26);
    const ins = (rid: string, kind: string) =>
      `INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('${rid}', 'o', 'op-${rid}', NULL, NULL, '${kind}', 'committed', 1, 't', 't', '{}')`;
    for (const [rid, kind] of [['a1', 'propose_exercise'], ['a2', 'pause_plan'], ['a3', 'update_gym'], ['a4', 'undo']] as const) await db.run(ins(rid, kind));
    await expect(db.run(ins('a5', 'set_lift_target'))).rejects.toThrow();
    const before = await db.getAll('SELECT * FROM coach_actions ORDER BY id');
    expect(await migrate(db, MIGRATIONS, 27)).toEqual({ from: 26, to: 27, applied: [27] });
    expect(await db.getAll('SELECT * FROM coach_actions ORDER BY id')).toEqual(before);
    await db.run(ins('a5', 'set_lift_target'));
    await db.run(ins('a6', 'pause_plan'));
    await db.run(ins('a7', 'update_gym'));
    await expect(db.run(ins('a8', 'not_a_kind'))).rejects.toThrow();
    await expect(db.run("DELETE FROM coach_actions WHERE id = 'a1'")).rejects.toThrow(/never deleted/);
    const row = (await db.getAll("SELECT sql FROM sqlite_master WHERE name = 'coach_actions'"))[0];
    expect(String(row?.sql)).toContain("'set_lift_target'");
    expect(String(row?.sql)).toContain("'pause_plan'");
    expect(String(row?.sql)).toContain("'update_gym'");
  });
});

describe('bodyweight entries (Ben, 27 Oct): Your data, versioned, in backups', () => {
  it('log, edit, delete and restore round-trip; a repeated op ID writes once; a stale version is refused; Health samples stay local', async () => {
    const source = await manager();
    await source.store.repos.profiles.save(profile(), null);
    const tp = source.store.repos.trainingProfiles;
    const add = (id: string, date: string, value: number, unit: 'kg' | 'lb', v: number) => tp.change(OWNER, { kind: 'add_weight', entry: { id, date, value, unit } }, W(id, v));
    expect((await add('w1', '2026-10-10', 83.2, 'kg', 1)).status).toBe('written');
    expect((await add('w1', '2026-10-10', 83.2, 'kg', 1)).status).toBe('replayed');
    expect((await add('w2', '2026-10-12', 182, 'lb', 2)).status).toBe('written');
    expect((await add('w3', '2026-10-13', 82, 'kg', 2)).status).toBe('stale');
    expect((await tp.change(OWNER, { kind: 'edit_weight', entryId: 'w2', value: 82.6, unit: 'kg', date: '2026-10-12' }, W('e1', 3))).status).toBe('written');
    expect((await tp.change(OWNER, { kind: 'delete_weight', entryId: 'w1' }, W('d1', 4))).status).toBe('written');
    // Undo of the delete: the same entry back.
    expect((await tp.change(OWNER, { kind: 'add_weight', entry: { id: 'w1', date: '2026-10-10', value: 83.2, unit: 'kg' } }, W('u1', 5))).status).toBe('written');
    await source.store.repos.health.replaceSamples(OWNER, 'weight', '2026-01-01T00:00:00.000Z', [
      { uuid: 'b0000000-0000-4000-8000-000000000001', kg: 81, atUtc: '2026-10-14T06:00:00.000Z', tz: 'Europe/London', sourceName: 'Withings', sourceBundleId: 'w' },
    ]);
    const before = await tp.get(OWNER);
    expect(before?.weights.map((w) => [w.id, w.value, w.unit])).toEqual([
      ['w1', 83.2, 'kg'],
      ['w2', 82.6, 'kg'],
    ]);
    const made = await createBackup(source.store, { at: at(20), app: APP });
    const target = await manager();
    expect(await target.restore(made.text, at(30))).toMatchObject({ ok: true, status: 'restored' });
    expect((await target.store.repos.trainingProfiles.get(OWNER))?.weights).toEqual(before?.weights);
    // Read from Health: local to the install (re-read after a restore), never in the backup.
    expect(await target.store.repos.health.weightSamples(OWNER)).toEqual([]);
    expect(await target.deleteYourData()).toMatchObject({ ok: true });
    expect(await target.store.repos.trainingProfiles.get(OWNER)).toBeNull();
  });
});
