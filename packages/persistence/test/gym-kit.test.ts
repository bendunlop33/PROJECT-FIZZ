import { afterEach, describe, expect, it } from 'vitest';

import { buildQuickGymDraft, materialiseGymDraft, stableStringify } from '@fizz/domain';
import { at, barbell, dumbbells, GYM, gym as gymFixture, idGen, OWNER, profile } from '@fizz/domain/testing';
import type { EquipmentInstance } from '@fizz/schemas';

import { checkIntegrity, createBackup, DatabaseManager, deleteDocumentIn, EQUIPMENT_SPEC, migrate, MIGRATIONS, parseBackup, sha256Hex, type BackupFile } from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/**
 * (Ben, 20 Oct; ADR 0030) Kettlebells, EZ / trap bars, the Smith machine,
 * benches and racks as gym items: migration 29 widens `equipment.kind`, every
 * row kept; a full gym with them saves in one write, round-trips a backup and
 * a restore, and a retry is a duplicate.
 */

let dirs: { dir: string; cleanup: () => void }[] = [];
afterEach(() => {
  for (const d of dirs) d.cleanup();
  dirs = [];
});
function manager(): Promise<DatabaseManager> {
  const d = tempDir();
  dirs.push(d);
  let n = 0;
  return DatabaseManager.open({ host: nodeDatabaseHost(d.dir), newName: () => `k-${String(Date.now())}-${String((n += 1))}.db` });
}

const APP = { name: 'GymSmarter', version: '0.1.0', build: null };

describe('migration 29 in place on a schema-28 database', () => {
  it('keeps every equipment row and its index; takes the new kinds; refuses unknown ones', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS, 28);
    const row = (rid: string, kind: string) => `INSERT INTO equipment (id, owner_id, gym_id, kind, version, updated_at_utc, data) VALUES ('${rid}', 'o', 'g', '${kind}', 1, 't', '{}')`;
    await db.run(row('e1', 'barbell'));
    await db.run(row('e2', 'bodyweight_station'));
    await expect(db.run(row('e3', 'kettlebell'))).rejects.toThrow();
    const before = await db.getAll('SELECT * FROM equipment ORDER BY id');
    expect(await migrate(db, MIGRATIONS, 29)).toEqual({ from: 28, to: 29, applied: [29] });
    expect(await db.getAll('SELECT * FROM equipment ORDER BY id')).toEqual(before);
    for (const [i, kind] of ['kettlebell', 'ez_bar', 'trap_bar', 'smith_machine', 'bench', 'rack'].entries()) await db.run(row(`n${String(i)}`, kind));
    await expect(db.run(row('bad', 'sled'))).rejects.toThrow();
    expect(await db.getAll("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'equipment' AND name NOT LIKE 'sqlite_%'")).toEqual([{ name: 'equipment_gym' }]);
  });
});

describe('a gym with the new kinds', () => {
  it('saves in one write (a retry is a duplicate), round-trips a backup and restore', async () => {
    const m = await manager();
    await m.store.repos.profiles.save(profile(), null);
    const made = materialiseGymDraft(buildQuickGymDraft({ setup: 'small', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: ['kettlebells', 'ez_bar', 'trap_bar', 'smith_machine', 'bench'] }), {
      name: 'Hotel',
      ownerId: OWNER,
      gymId: GYM,
      isDefault: true,
      atUtc: at(0).utc,
      newId: idGen(40_000),
      setup: 'small',
    });
    if (!made.ok) throw new Error(JSON.stringify(made.issues));
    expect(await m.store.repos.gyms.createWithEquipment(made.gym, made.equipment)).toMatchObject({ ok: true });
    expect(await m.store.repos.gyms.createWithEquipment(made.gym, made.equipment)).toMatchObject({ ok: true, duplicate: true });
    const saved = await m.store.repos.equipment.listByGym(GYM);
    expect(saved.map((e) => [e.kind, e.availability])).toEqual([
      ['dumbbells', 'available'],
      ['kettlebell', 'available'],
      ['ez_bar', 'available'],
      ['trap_bar', 'available'],
      ['smith_machine', 'available'],
      ['bench', 'available'],
      // An unticked rack: saved retired, so the gym knows it has none.
      ['rack', 'retired'],
    ]);
    // A version check still guards edits to the new kinds (rule 5).
    const smith = saved.find((e) => e.kind === 'smith_machine');
    if (smith === undefined) throw new Error('no smith');
    expect(await m.store.repos.equipment.save({ ...smith, barMass: 20, version: 2 }, 1)).toMatchObject({ ok: true });
    await expect(m.store.repos.equipment.save({ ...smith, barMass: 25, version: 2 }, 1)).resolves.toMatchObject({ ok: false });

    const backup = await createBackup(m.store, { at: at(60), app: APP });
    const target = await manager();
    expect(await target.restore(backup.text, at(120))).toMatchObject({ ok: true, status: 'restored' });
    expect(await target.store.repos.equipment.listByGym(GYM)).toEqual(await m.store.repos.equipment.listByGym(GYM));
    expect((await checkIntegrity(target.store.db)).ok).toBe(true);
    // The old kinds still save as before.
    expect(await target.store.repos.equipment.save(barbell({ gymId: GYM }), null)).toMatchObject({ ok: true });
    await m.close();
    await target.close();
  });
});

describe('review ben-kit S5: a schema-28 backup restores into the v29 store', () => {
  it('migrates on restore; every item kept as it was; the new kinds save after', async () => {
    const m = await manager();
    await m.store.repos.profiles.save(profile(), null);
    await m.store.repos.gyms.save(gymFixture(2, { isDefault: true }), null);
    const old: EquipmentInstance[] = [barbell({ gymId: GYM }), dumbbells({ gymId: GYM })];
    for (const e of old) expect(await m.store.repos.equipment.save(e, null)).toMatchObject({ ok: true });
    const made = await createBackup(m.store, { at: at(60), app: APP });
    const parsed = await parseBackup(made.text);
    if (!parsed.ok) throw new Error('backup');
    // The same file as a schema-28 build wrote it (its tables are the same; only the kinds widened).
    const body: Partial<BackupFile> = { ...parsed.file, schemaVersion: 28 };
    delete body.checksum;
    const text = JSON.stringify({ ...body, checksum: { algorithm: 'sha-256', value: sha256Hex(stableStringify(body)) } });

    const target = await manager();
    expect(await target.restore(text, at(120))).toMatchObject({ ok: true, status: 'restored', preview: { needsMigration: true } });
    expect(await target.store.repos.equipment.listByGym(GYM)).toEqual(await m.store.repos.equipment.listByGym(GYM));
    expect((await checkIntegrity(target.store.db)).ok).toBe(true);
    const bench = materialiseGymDraft(buildQuickGymDraft({ setup: 'home', unit: 'kg', dumbbells: null, extras: ['bench'] }), {
      name: 'x',
      ownerId: OWNER,
      gymId: GYM,
      isDefault: false,
      atUtc: at(130).utc,
      newId: idGen(41_000),
      setup: 'home',
    });
    if (!bench.ok) throw new Error('draft');
    const b = bench.equipment.find((e) => e.kind === 'bench');
    if (b === undefined) throw new Error('no bench');
    expect(await target.store.repos.equipment.save(b, null)).toMatchObject({ ok: true });
    await m.close();
    await target.close();
  });
});

describe('review ben-kit B3: Undo removes a bench or rack record it added, only at the version it saved', () => {
  it('deletes at the expected version; refuses a newer one', async () => {
    const m = await manager();
    await m.store.repos.profiles.save(profile(), null);
    await m.store.repos.gyms.save(gymFixture(2, { isDefault: true }), null);
    const made = materialiseGymDraft(buildQuickGymDraft({ setup: 'home', unit: 'kg', dumbbells: null, extras: [] }), {
      name: 'x',
      ownerId: OWNER,
      gymId: GYM,
      isDefault: false,
      atUtc: at(0).utc,
      newId: idGen(42_000),
      setup: 'home',
    });
    if (!made.ok) throw new Error('draft');
    const rack = made.equipment.find((e) => e.kind === 'rack');
    if (rack === undefined) throw new Error('no rack');
    await m.store.repos.equipment.save(rack, null);
    expect(await m.store.db.write((tx) => deleteDocumentIn(tx, EQUIPMENT_SPEC, rack.id, 2))).toBe(false);
    expect(await m.store.repos.equipment.get(rack.id)).not.toBeNull();
    expect(await m.store.db.write((tx) => deleteDocumentIn(tx, EQUIPMENT_SPEC, rack.id, 1))).toBe(true);
    expect(await m.store.repos.equipment.get(rack.id)).toBeNull();
    await m.close();
  });
});
