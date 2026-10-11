import { describe, expect, it } from 'vitest';
import { reduceSession } from '@fizz/domain';
import { at, hotelFixture, id, kg, logCmd, OWNER, profile, values } from '@fizz/domain/testing';
import type { CoachMessage, CoachThread, CoachTurn } from '@fizz/schemas';
import { checkIntegrity, latestVersion, migrate, MIGRATIONS, openStore, type SqlDriver, type SqlValue } from '../src/index';
import { memoryDriver } from './helpers';

/**
 * A phone that ran a main build is at schema 5 (gym switch). Coach storage
 * is migration 6, so opening that database with a coach build adds the coach
 * tables and keeps every gym-switch row (coach review B1). Were coach still
 * numbered 5, the migrator would treat this database as current and the
 * first `Ask` would fail on a missing table.
 */
const COACH_TABLES = ['coach_threads', 'coach_turns', 'coach_messages', 'coach_actions', 'memories', 'playbook_candidates', 'next_session_targets', 'next_target_uses', 'coach_offers'];

async function copyIntoSchema5(from: SqlDriver, to: SqlDriver): Promise<void> {
  await migrate(to, MIGRATIONS, 5);
  const tables = await from.getAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  await to.exec('PRAGMA foreign_keys = OFF');
  for (const { name } of tables) {
    const cols = new Set((await to.getAll<{ name: string }>(`PRAGMA table_info(${name})`)).map((c) => c.name));
    if (cols.size === 0) continue; // a coach table: not there at 5
    for (const row of await from.getAll(`SELECT * FROM ${name}`)) {
      const keys = Object.keys(row).filter((k) => cols.has(k));
      await to.run(`INSERT OR IGNORE INTO ${name} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => row[k] as SqlValue));
    }
  }
  await to.exec('PRAGMA foreign_keys = ON');
}

function switchedWorkout() {
  const { BENCH, HOTEL, HOTEL_EQ, exerciseSets, propose, pushA, switchCmd } = hotelFixture;
  const ok = (r: ReturnType<typeof reduceSession>) => {
    if (!r.ok) throw new Error(r.error.message);
    return r.state;
  };
  let s = pushA();
  const bench = exerciseSets(s, BENCH);
  s = ok(reduceSession(s, logCmd(bench[0]?.id ?? '', values(kg(100), 8), 60)));
  s = ok(reduceSession(s, switchCmd(propose(s, { id: HOTEL, equipment: HOTEL_EQ }), 320)));
  return s;
}

const THREAD = id(900);
const TURN = id(901);
const thread: CoachThread = { id: THREAD, ownerId: OWNER, version: 1, createdAtUtc: at(0).utc, updatedAtUtc: at(0).utc, sessionId: null, title: 'How am I doing?' };
const turn: CoachTurn = {
  id: TURN,
  ownerId: OWNER,
  version: 1,
  createdAtUtc: at(0).utc,
  updatedAtUtc: at(0).utc,
  threadId: THREAD,
  kind: 'general',
  status: 'running',
  error: null,
  model: 'gpt-6.1-sol',
  contextHash: 'ctx-1',
  startedAt: at(0),
  endedAtUtc: null,
  toolLog: [],
};
const benMessage: Omit<CoachMessage, 'ordinal'> = { id: id(902), ownerId: OWNER, threadId: THREAD, turnId: TURN, createdAt: at(0), body: { role: 'ben', input: { kind: 'words', text: 'How am I doing?', spoken: false } } };

describe('a populated schema-5 (gym switch) database migrates in place to 6 (coach)', () => {
  it('keeps a switched workout, adds the coach tables, and the first Ask works', async () => {
    expect(MIGRATIONS.find((m) => m.version === 5)?.name).toBe('gym-switch');
    expect(MIGRATIONS.find((m) => m.version === 6)?.name).toBe('coach');
    expect(latestVersion()).toBe(6);

    const source = memoryDriver();
    const made = await openStore(source);
    await made.repos.profiles.save(profile(), null);
    const switched = switchedWorkout();
    expect(switched.session.gymChanges).toHaveLength(1);
    await made.repos.sessions.save(switched, null);

    const phone = memoryDriver();
    await copyIntoSchema5(source, phone);
    await made.close();
    expect(await phone.getFirst('PRAGMA user_version')).toEqual({ user_version: 5 });
    const before = await phone.getAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    for (const t of COACH_TABLES) expect(before.map((r) => r.name)).not.toContain(t);

    const v6 = await openStore(phone);
    expect(v6.migration).toMatchObject({ from: 5, to: 6, applied: [6] });
    const after = await phone.getAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    for (const t of COACH_TABLES) expect(after.map((r) => r.name)).toContain(t);
    expect(await v6.repos.sessions.get(switched.session.id)).toEqual(switched);

    const started = await v6.repos.coach.startTurn({ thread, newThread: true, turn, benMessage });
    expect(started).toMatchObject({ replayed: false, benMessage: { ordinal: 0 } });
    expect(await v6.repos.coach.listNextTargets(OWNER, switched.session.id)).toEqual([]);
    expect((await checkIntegrity(v6.db)).ok).toBe(true);
    await v6.close();
  });
});
