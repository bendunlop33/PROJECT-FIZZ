import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Review workout-loop S2: a record that fails to decode never leaves Ben with
 * a blank screen or stops today's logging.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

function corrupt(dbFile: string, sessionId: string) {
  const db = new DatabaseSync(join(h.dir, dbFile));
  // An empty snapshot name fails validation when the session is read.
  db.prepare("UPDATE session_exercises SET exercise_name = '' WHERE session_id = ?").run(sessionId);
  db.close();
}

describe('unreadable records', () => {
  it('a past workout that fails to decode only hides the Last line; logging carries on', async () => {
    let { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const old = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const file = s.developer.databaseNames().current;
    await h.forceClose();
    corrupt(file, old);
    // (ADR 0032) History reads use the workout's stored summary (made when it was whole) until the integrity check
    // finds the workout damaged and drops its summary. The launch runs that check in the background; here the launch's
    // background work is held and the check awaited, so its repair is seen.
    s = (await h.launch({ backgroundGate: () => new Promise<void>(() => undefined) })).services;
    expect((await s.integrity.checkAll())?.report.staleSummaries).toEqual([old]);
    h.clockMs += 86_400_000;
    // A new workout with the same exercise still loads and logs.
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 8 }] }]);
    const loaded = await s.workout.load(id);
    expect(Object.values(loaded?.previous ?? { x: 1 })).toEqual([null]);
  });

  it('an unfinished workout that fails to decode is not auto-opened; launch reports it and restore is not blocked', async () => {
    let { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const started = await s.workout.start({ gymId, opId: 'active', checkIn: null });
    if (!started.ok) throw new Error('start');
    await s.workout.addExercise({ sessionId: started.aggregate.session.id, exerciseId: (await s.coachingKnowledge.exercises()).find((e) => e.name === 'Bench press')?.id ?? '', equipmentId: null, opId: 'add' });
    const file = s.developer.databaseNames().current;
    await h.forceClose();
    corrupt(file, started.aggregate.session.id);

    const launched = await h.launch();
    expect(launched.recovery).toBeNull();
    expect(launched.recoveryError).toMatch(/.+/);
    s = launched.services;
    await expect(s.workout.load()).rejects.toThrow();
    expect(await s.restore.blockedBy()).toBeNull();
  });

  it('Today and Start still work with one unreadable finished workout; Repeat skips it with a count (review S1)', async () => {
    let { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const older = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    h.clockMs += 86_400_000;
    const broken = await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 45, reps: 10 }] }]);
    const file = s.developer.databaseNames().current;
    await h.forceClose();
    corrupt(file, broken);
    s = (await h.launch()).services;
    h.clockMs += 86_400_000;

    // Everything Today's loader reads resolves.
    await expect(Promise.all([s.yourData.currentGym(), s.today.view(), s.sessions.active(), s.checkIns.unlinked(), s.repeat.last()])).resolves.toBeDefined();
    // The newest readable workout is offered; the broken one is skipped and counted.
    expect((await s.repeat.last())?.sessionId).toBe(older);
    expect(await s.repeat.candidates()).toMatchObject({ rows: [{ sessionId: older }], unreadable: 1 });
    // Start isn't blocked.
    const started = await s.workout.start({ gymId, opId: 'after-corrupt', checkIn: null });
    expect(started.ok).toBe(true);
  });

  it('Repeat candidates are limited: only the newest N are decoded', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      h.clockMs += 86_400_000;
      ids.push(await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]));
    }
    expect((await s.repeat.candidates(2)).rows.map((c) => c.sessionId)).toEqual([ids[3], ids[2]]);
  });
});
