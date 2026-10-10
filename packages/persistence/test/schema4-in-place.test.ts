import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import { createSessionService, newPainFlag } from '@fizz/domain';
import { at, dumbbells, GYM, id, idGen, kg, logCmd, OWNER, profile, routine, routineExercise, SPLIT_SQUAT, template, values } from '@fizz/domain/testing';
import { migrate, MIGRATIONS, openStore, type SqlDriver, type SqlValue } from '../src/index';
import { memoryDriver } from './helpers';

/**
 * Build 91 on the phone is at schema 4 (exclusions, `Finish by`, retracted
 * pain flags). Opening that database with this build migrates it in place to
 * 5 (gym-switch columns), with every row read back unchanged (merge review N4).
 *
 * This build's repositories write the schema-5 columns, so they can't write a
 * schema-4 database. The schema-4 file is made the way build 91 left it:
 * a database migrated to 4 holding the same rows, without the schema-5 columns.
 */
const V5_ONLY: Record<string, readonly string[]> = { sessions: ['gym_changes'], session_exercises: ['continues_from_id', 'equipment_version'] };

async function copyIntoSchema4(from: SqlDriver, to: SqlDriver): Promise<void> {
  await migrate(to, MIGRATIONS, 4);
  const tables = await from.getAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  await to.exec('PRAGMA foreign_keys = OFF');
  for (const { name } of tables) {
    const cols = new Set((await to.getAll<{ name: string }>(`PRAGMA table_info(${name})`)).map((c) => c.name));
    if (cols.size === 0) continue;
    for (const row of await from.getAll(`SELECT * FROM ${name}`)) {
      for (const c of V5_ONLY[name] ?? []) expect(row[c] ?? null).toBeNull(); // nothing a schema-4 build couldn't have written
      const keys = Object.keys(row).filter((k) => cols.has(k));
      await to.run(`INSERT OR IGNORE INTO ${name} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => row[k] as SqlValue));
    }
  }
  await to.exec('PRAGMA foreign_keys = ON');
}

describe('a populated schema-4 database migrates in place to 5', () => {
  it('keeps an active workout with an exclusion and Finish by, and a pain flag; the workout carries on', async () => {
    const source = memoryDriver();
    const made = await openStore(source);
    await made.repos.profiles.save(profile(), null);
    await made.repos.equipment.save(dumbbells(), null);
    await made.repos.exercises.save(SPLIT_SQUAT, null);
    await made.repos.routines.save(
      routine([routineExercise(700, { exerciseId: SPLIT_SQUAT.id, equipmentId: dumbbells().id, setTemplates: [7001, 7002, 7003].map((n) => template(n, { targetLoad: kg(15, 'per_hand'), targetReps: { min: 8, max: 10 } })) })]),
      null,
    );
    const pain = newPainFlag({ id: id(950), ownerId: OWNER, opId: 'pain-1', exerciseId: SPLIT_SQUAT.id, exerciseName: SPLIT_SQUAT.name, area: 'knee', source: 'workout', checkInId: null, at: at(10) });
    expect(await made.repos.painFlags.save(pain, null)).toMatchObject({ ok: true });
    const svc = createSessionService(made.repos, idGen(80_000));
    const started = await svc.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sessionId = started.aggregate.session.id;
    const [first, second] = started.aggregate.sets;
    let latest: SessionAggregate = started.aggregate;
    const step = async (cmd: unknown) => {
      const r = await svc.dispatch(sessionId, cmd);
      if (!r.ok) throw new Error(r.error.code);
      latest = r.aggregate;
    };
    await step(logCmd(first?.id ?? '', values(kg(15, 'per_hand'), 10), 60, 'log-1'));
    await step({ type: 'correct_set', at: at(90), opId: 'mark-1', setId: first?.id ?? '', expectedSetVersion: 2, patch: { exclusions: ['spotted'] } });
    await step({ type: 'set_finish_by', at: at(100), opId: 'finish-by-1', finishBy: at(3600), expectedVersion: latest.session.version });

    const phone = memoryDriver();
    await copyIntoSchema4(source, phone);
    await made.close();
    expect(await phone.getFirst('PRAGMA user_version')).toEqual({ user_version: 4 });
    expect((await phone.getAll('PRAGMA table_info(sessions)')).some((c) => c.name === 'gym_changes')).toBe(false);

    const v5 = await openStore(phone);
    expect(v5.migration).toMatchObject({ from: 4, to: 5, applied: [5] });
    const read = await v5.repos.sessions.get(sessionId);
    expect(read).toEqual(latest);
    expect(read?.sets.find((s) => s.id === first?.id)?.exclusions).toEqual(['spotted']);
    expect(read?.session.finishBy).toEqual(at(3600));
    expect(read?.session.gymChanges).toBeUndefined();
    expect(await v5.repos.painFlags.get(pain.id)).toEqual(pain);

    // The migrated workout carries on at schema 5, and a relaunch recovers it.
    const svc5 = createSessionService(v5.repos, idGen(90_000));
    const logged = await svc5.dispatch(sessionId, logCmd(second?.id ?? '', values(kg(15, 'per_hand'), 9), 200, 'log-2'));
    expect(logged.ok).toBe(true);
    const recovered = await svc5.recover(OWNER, at(220));
    expect(recovered?.state.sets.find((s) => s.id === second?.id)?.status).toBe('completed');
    await v5.close();
  });
});
