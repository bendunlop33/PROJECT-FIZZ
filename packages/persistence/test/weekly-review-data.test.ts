import { afterEach, describe, expect, it } from 'vitest';

import { at, id, OWNER, profile, richFinishedSession } from '@fizz/domain/testing';
import type { TrainingReview } from '@fizz/schemas';
import { createBackup, DatabaseManager, exportTables } from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { tempDir } from './helpers';

/**
 * Weekly reviews (workout-builder-v3 §6.2) are Your data (rule 10): stored as their own records with the
 * facts apart from the coach's words, carried by backups and Your data exports, removed by Delete my data;
 * never in Coaching knowledge. Session feel (migration 32) travels with the workout row.
 */

const dirs: { cleanup: () => void }[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) d.cleanup();
});

function managerIn(): Promise<DatabaseManager> {
  const d = tempDir();
  dirs.push(d);
  let n = 0;
  return DatabaseManager.open({ host: nodeDatabaseHost(d.dir), newName: () => `wr-${String(Date.now())}-${String((n += 1))}.db` });
}

const APP = { name: 'GymSmarter', version: '0.1.0', build: null };

function weekly(): TrainingReview {
  return {
    id: id(9901),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: at(10).utc,
    updatedAtUtc: at(10).utc,
    subject: { kind: 'weekly', weekMonday: '2026-10-05' },
    inputsHash: 'weekly-h1',
    facts: [
      { kind: 'sessions_vs_plan', done: 3, planned: 4 },
      { kind: 'week_sessions', weekMonday: '2026-10-05', done: 3, planned: 4, workouts: 3, runs: 2 },
      { kind: 'week_day', name: 'Legs', done: false, localDate: null },
      { kind: 'runs', count: 2, distanceM: 20000 },
      { kind: 'feel', easy: 0, good: 2, hard: 1 },
      { kind: 'lift_trend', exerciseId: id(200), points: [{ sessionId: id(301), localDate: '2026-10-06', load: { value: 95, unit: 'kg', convention: 'total' }, reps: 6, estimate: 114 }], target: { value: 120, unit: 'kg', convention: 'total' }, metric: 'e1rm', lowerIsBetter: false, targetReps: 1, was: { value: 105, isEstimate: true } },
    ],
    coach: { status: 'reviewed', verdict: 'Good week', lines: ['3 of 4 sessions.'], actionIds: [], numbersChecked: true },
    status: 'current',
    supersededById: null,
    opIds: ['weekly-1'],
    createdAt: at(10),
    proposals: [{ id: 'p1', source: 'code', change: { kind: 'template_sets', routineId: id(9002), routineName: 'Legs', expectedVersion: 4, exerciseId: id(210), exerciseName: 'Leg curl', fromSets: 3, toSets: 4 }, reason: '4 sets the last 2 times', status: 'open', actionId: null }],
  };
}

async function populate(m: DatabaseManager): Promise<void> {
  await m.store.repos.profiles.save(profile(), null);
  const s = richFinishedSession();
  await m.store.repos.sessions.save({ ...s, session: { ...s.session, feel: { value: 'hard', at: at(9000) } } }, null);
  expect(await m.store.repos.reviews.record(OWNER, weekly())).toMatchObject({ status: 'written' });
}

describe('weekly reviews and session feel are Your data (rule 10)', () => {
  it('a backup round trip keeps the weekly review whole (facts, coach words, proposals) and the workout’s feel', async () => {
    const src = await managerIn();
    await populate(src);
    const before = await src.store.db.read((q) => exportTables(q));
    const made = await createBackup(src.store, { at: at(500), app: APP });
    await src.close();
    const dst = await managerIn();
    expect(await dst.restore(made.text, at(600))).toMatchObject({ ok: true, status: 'restored' });
    expect(await dst.store.db.read((q) => exportTables(q))).toEqual(before);
    expect(await dst.store.repos.reviews.get(id(9901))).toEqual(weekly());
    expect((await dst.store.repos.sessions.get(richFinishedSession().session.id))?.session.feel).toEqual({ value: 'hard', at: at(9000) });
    await dst.close();
  });

  it('Your data export carries them, Coaching knowledge doesn’t; Delete my data removes them', async () => {
    const m = await managerIn();
    await populate(m);
    const mine = await m.exportDomain('your_data');
    expect(mine.tables.reviews).toHaveLength(1);
    expect(JSON.stringify(mine.tables.sessions)).toContain('"hard"');
    const known = await m.exportDomain('coaching_knowledge');
    expect(known.tables.reviews).toBeUndefined();
    expect(known.tables.sessions).toBeUndefined();
    expect(await m.deleteYourData()).toMatchObject({ ok: true, status: 'switched' });
    const left = await m.store.db.read((q) => exportTables(q));
    expect(left.reviews).toEqual([]);
    expect(left.sessions).toEqual([]);
    await m.close();
  });
});
