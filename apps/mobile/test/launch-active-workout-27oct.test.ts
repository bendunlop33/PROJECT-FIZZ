import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLockScreenContent } from '@fizz/domain';
import type { PlanBuilderAnswers } from '@fizz/schemas';

import { activityProps } from '../src/live-activity/controller';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { buildRounds } from '../src/workout/rounds';
import { CONNECTED, StepModel } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 27 Oct: "crashed after trying to start workout", then "flashes then closes" on every launch, build 419 and
 * 449.) A launch with a started workout in the store: the services boot, recovery opens into it, and everything the
 * workout screen and the Lock Screen compute on that launch works on a plan day with a superset; a started workout
 * the app can't read boots too, isn't opened, and is left exactly as stored (never repaired or rewritten).
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-19T07:00:00.000Z', { coach: { model: () => new StepModel([]), connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

async function startPush(s: AppServices, gymId: string): Promise<string> {
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] },
    { exercise: 'Back squat', sets: [{ load: 120, reps: 5, rpe: 8 }] },
  ]);
  h.clockMs += 3_600_000;
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const a: PlanBuilderAnswers = { ...session.answers, sessions: 3, split: 'ppl', minutes: 45, supersets: true, weeks: 6 };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const data = await loaded(s);
  const d = data.days.find((x) => x.name === 'Push');
  const controls = d === undefined ? undefined : data.initial[d.key];
  if (d === undefined || controls === undefined) throw new Error('no Push');
  const c = await s.todaySession.commit(data, { dayKey: d.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error(r.error.message);
  return r.aggregate.session.id;
}

describe('launch with a started workout (27 Oct crash loop)', () => {
  it('boots, opens into the workout, and the workout screen’s and Lock Screen’s first render compute', async () => {
    const first = await h.launch();
    const gymId = await setUpGym(h, first.services);
    const sessionId = await startPush(first.services, gymId);
    await h.forceClose();
    h.clockMs += 60_000;

    const launched = await h.launch();
    expect(launched.recoveryError).toBeNull();
    expect(launched.recovery?.state.session.id).toBe(sessionId);
    expect(launched.recovery?.openInto).toBe('active_workout');
    const s = launched.services;
    const w = await s.workout.load();
    if (w === null) throw new Error('no workout');
    const now = h.clockMs;
    expect(s.workout.view(w, now, null)).toBeTruthy();
    s.workout.timeLeft(w, now);
    buildRounds(s.workout.tableView(w, now, null), () => null, null);
    const nav = s.workout.navigation(w, null);
    if (nav.shownSetId !== null) s.workout.glance(w, nav.shownSetId);
    s.workout.restSets(w);
    s.workout.timeFit(w, 5);
    for (const e of w.aggregate.exercises) s.workout.cardFacts(w, e.id);
    const content = buildLockScreenContent(w.aggregate, now, 'Europe/London');
    expect(content).not.toBeNull();
    if (content !== null) expect(JSON.stringify(activityProps(content, true, true)).length).toBeLessThan(4096);
    // Today under it (the workout opens over Tabs).
    expect(await s.sessions.active()).not.toBeNull();
    await s.today.view();
  }, 120_000);

  it('a started workout it can’t read: boots, not opened, read errors are reported, and the stored rows are untouched', async () => {
    const first = await h.launch();
    const gymId = await setUpGym(h, first.services);
    const sessionId = await startPush(first.services, gymId);
    const file = first.services.developer.databaseNames().current;
    await h.forceClose();
    const db = new DatabaseSync(join(h.dir, file));
    // An unexpected shape: session exercises with an empty name.
    db.prepare("UPDATE session_exercises SET exercise_name = '' WHERE session_id = ?").run(sessionId);
    const before = JSON.stringify(db.prepare('SELECT * FROM session_exercises WHERE session_id = ? ORDER BY id').all(sessionId)) + JSON.stringify(db.prepare('SELECT * FROM sessions WHERE id = ?').all(sessionId));
    db.close();

    const launched = await h.launch();
    expect(launched.kind).toBe('ready');
    expect(launched.recovery).toBeNull();
    expect(launched.recoveryError).toMatch(/.+/);
    // Today shows its honest error state for it (`Your unfinished workout couldn’t be read.`), not a crash.
    await expect(launched.services.sessions.active()).rejects.toThrow(/Corrupt sessions row/);
    await h.forceClose();
    const after = new DatabaseSync(join(h.dir, file));
    expect(JSON.stringify(after.prepare('SELECT * FROM session_exercises WHERE session_id = ? ORDER BY id').all(sessionId)) + JSON.stringify(after.prepare('SELECT * FROM sessions WHERE id = ?').all(sessionId))).toBe(before);
    after.close();
  }, 120_000);
});
