import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP, toIso, toMs } from '@fizz/domain';
import { idGen } from '@fizz/domain/testing';
import type { ZonedTimestamp } from '@fizz/schemas';

import { createRestAlertController, type NotifierPort, type PlannedRestAlert } from '../src/alerts/rest-alerts';
import type { BackupFileStore, TextFile } from '../src/backup/backup-service';
import { createExpoDatabaseHost } from '../src/data/expo-driver';
import type { AppServices } from '../src/services/app-services';
import { startApp, type StartupOutcome } from '../src/services/startup';
import { fakeHostDeps } from './fake-expo-sqlite';

/**
 * The workout loop end to end through the app services, on real SQLite (the
 * expo-sqlite stand-in), including force-close relaunches: Today → check-in →
 * Active set → Rest → Summary (flow-first-milestone §8, as far as Linux can).
 */

const TZ = 'Europe/London';
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

let dir: string;
let clockMs: number;
let ids: () => string;
let dbNames: number;
let backupFiles: Map<string, string>;
let manifestText: string | null;
/** The phone's pending notifications, which survive a force-close. */
let pending: Map<string, PlannedRestAlert>;
let alertCalls: string[];
const open: AppServices[] = [];

const now = (): ZonedTimestamp => ({ utc: toIso(clockMs), tz: TZ });
const files = (): BackupFileStore => ({
  write: (n, t) => {
    backupFiles.set(n, t);
    return Promise.resolve();
  },
  read: (n) => Promise.resolve(backupFiles.get(n) ?? null),
  remove: (n) => {
    backupFiles.delete(n);
    return Promise.resolve();
  },
});
const manifest: TextFile = {
  read: () => Promise.resolve(manifestText),
  write: (t) => {
    manifestText = t;
    return Promise.resolve();
  },
};
const notifier: NotifierPort = {
  schedule: (a) => {
    alertCalls.push(`schedule ${a.key}`);
    pending.set(a.identifier, a);
    return Promise.resolve();
  },
  cancel: (id) => {
    alertCalls.push(`cancel ${id}`);
    pending.delete(id);
    return Promise.resolve();
  },
};

async function launch(): Promise<Extract<StartupOutcome, { kind: 'ready' }>> {
  const o = await startApp({
    host: createExpoDatabaseHost(fakeHostDeps(dir)),
    newDatabaseName: () => `training-${String(++dbNames)}.db`,
    backupFiles: files(),
    backupManifest: manifest,
    now,
    newId: ids,
    app: { name: 'GymSmarter', version: '0.1.0', build: 'test' },
    locale: 'en-GB',
    restAlerts: createRestAlertController(notifier),
  });
  if (o.kind !== 'ready') throw new Error(o.kind);
  open.push(o.services);
  return o;
}

async function settle(s: AppServices) {
  for (let i = 0; i < 200 && s.backups.isRunning; i += 1) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 20));
}

/** Force-close: nothing is flushed or awaited beyond what already committed. */
async function forceClose() {
  for (const s of open.splice(0)) {
    await settle(s);
    await s.close().catch(() => undefined);
  }
}

async function setUp(s: AppServices): Promise<string> {
  await s.setup.saveUnits('kg');
  await s.setup.saveGym({ gymId: ids(), name: 'Main Gym', draft: s.coachingKnowledge.buildGymDraft('commercial', 'kg') });
  await s.setup.complete();
  const gym = await s.yourData.currentGym();
  if (!gym) throw new Error('no gym');
  return gym.id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fizz-loop-'));
  clockMs = toMs('2026-10-08T17:00:00.000Z');
  ids = idGen(1);
  dbNames = 0;
  backupFiles = new Map();
  manifestText = null;
  pending = new Map();
  alertCalls = [];
});
afterEach(async () => {
  await forceClose();
  rmSync(dir, { recursive: true, force: true });
});

describe('check-in before the session exists (check-in.md)', () => {
  it('a score links to exactly one workout in the start write; a retried record is a duplicate', async () => {
    const { services: s } = await launch();
    const gymId = await setUp(s);
    expect(await s.checkIns.gate()).toEqual({ kind: 'ask' });
    const rec = await s.checkIns.record({ checkInId: ids(), opId: 'ci-op', score: 4 });
    if (!rec.ok) throw new Error(rec.message);
    expect(await s.checkIns.record({ checkInId: rec.checkIn.id, opId: 'ci-op', score: 4 })).toMatchObject({ ok: true, duplicate: true });
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'answered', checkInId: rec.checkIn.id } });
    if (!started.ok) throw new Error(started.error.message);
    expect(started.aggregate.session.checkIn).toEqual({ kind: 'answered', checkInId: rec.checkIn.id });
    // Double tap on Start: one session.
    const again = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'answered', checkInId: rec.checkIn.id } });
    expect(again.ok && again.duplicate && again.aggregate.session.id === started.aggregate.session.id).toBe(true);
    // The linked check-in is never reused.
    expect(await s.checkIns.unlinked()).toBeNull();
  });

  it('swiped away after a score: reused by the next Start within 2 h (Today shows the line), asked again after', async () => {
    const { services: s } = await launch();
    await setUp(s);
    const rec = await s.checkIns.record({ checkInId: ids(), opId: 'ci-1', score: 3 });
    if (!rec.ok) throw new Error(rec.message);
    const upd = await s.checkIns.update(rec.checkIn.id, { reasons: ['tired'] }, 1, 'ci-1-reasons');
    expect(upd).toMatchObject({ ok: true, checkIn: { version: 2, reasons: ['tired'] } });
    // A stale edit is refused.
    expect(await s.checkIns.update(rec.checkIn.id, { score: 2 }, 1, 'ci-1-stale')).toMatchObject({ ok: false, stale: true });
    clockMs += 30 * 60_000;
    expect(await s.checkIns.gate()).toEqual({ kind: 'reuse', checkInId: rec.checkIn.id });
    expect((await s.today.view())?.unlinkedCheckIn?.id).toBe(rec.checkIn.id);
    clockMs += 2 * 3600_000;
    expect(await s.checkIns.gate()).toEqual({ kind: 'ask' });
  });

  it('pain with a movement flags it (progression stops); without one, the summary asks to choose', async () => {
    const { services: s } = await launch();
    const gymId = await setUp(s);
    const bench = (await s.coachingKnowledge.exercises()).find((e) => e.name === 'Bench press');
    if (!bench) throw new Error('no bench');
    const rec = await s.checkIns.record({ checkInId: ids(), opId: 'ci', score: 2 });
    if (!rec.ok) throw new Error(rec.message);
    const withPain = await s.checkIns.update(rec.checkIn.id, { reasons: ['pain'] }, 1, 'ci-r');
    if (!withPain.ok) throw new Error(withPain.message);
    const flagged = await s.pain.flagFromCheckIn({ checkIn: withPain.checkIn, exercises: [bench], area: 'shoulder', opId: 'pain-1' });
    if (!flagged.ok) throw new Error(flagged.message);
    // Retry: same flags, not doubled.
    await s.pain.flagFromCheckIn({ checkIn: flagged.checkIn, exercises: [bench], area: 'shoulder', opId: 'pain-1' });
    expect((await s.pain.active()).map((f) => [f.exerciseName, f.source, f.area])).toEqual([['Bench press', 'check_in', 'shoulder']]);
    expect(flagged.checkIn.painFlagIds).toHaveLength(1);
    const started = await s.workout.start({ gymId, opId: 'start-p', checkIn: { kind: 'answered', checkInId: rec.checkIn.id } });
    if (!started.ok) throw new Error(started.error.message);
    const loaded = await s.workout.load();
    expect(loaded?.painFlagged.has(bench.id)).toBe(true);
    // Undo on the pain toast clears it.
    expect(await s.pain.clear(flagged.flagIds ?? [])).toBe(true);
    expect(await s.pain.active()).toEqual([]);
  });
});

describe('the loop: add exercise, log, rest, force-close, finish, summary', () => {
  it('runs end to end and recovers at every point', async () => {
    let { services: s } = await launch();
    const gymId = await setUp(s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;

    // Empty: Add exercise. The picker lists Bench press with this gym's barbell.
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(s.workout.view(data, clockMs, null).primary).toEqual({ kind: 'add_exercise', label: 'Add exercise' });
    const picks = await s.workout.pickerExercises(sessionId, 'bench');
    const bench = picks.find((p) => p.exercise.name === 'Bench press');
    expect(bench?.equipment.map((e) => e.kind)).toEqual(['barbell']);
    const added = await s.workout.addExercise({ sessionId, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId: 'add-1' });
    expect(added.ok).toBe(true);
    expect((await s.workout.addExercise({ sessionId, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId: 'add-1' })).ok).toBe(true);

    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    let v = s.workout.view(data, clockMs, null);
    expect(v.primary).toEqual({ kind: 'enter', field: 'load', label: 'Enter load' });
    const setId = v.focus?.setId ?? '';
    // Draft edit saved (debounced in the app), then a force-close.
    const draft = { load: { value: 60, unit: 'kg' as const, convention: 'total' as const }, reps: 8, durationS: null, rpe: null, rir: null };
    expect((await s.workout.dispatch(sessionId, { type: 'save_draft', at: now(), setId, values: draft })).ok).toBe(true);
    await forceClose();

    clockMs += 20_000;
    let relaunch = await launch();
    s = relaunch.services;
    expect(relaunch.recovery?.openInto).toBe('active_workout');
    expect(relaunch.recovery?.notices.map((n) => n.kind)).toEqual(['restored', 'unsaved_edit_restored']);
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    v = s.workout.view(data, clockMs, null);
    expect(v.focus?.draftSource).toBe('draft');
    expect(plain(v.primary.label)).toBe('Log 60 kg × 8');

    // No history: three working sets in the built-in range (audit B1), so the first log starts a rest.
    expect(data.aggregate.sets.map((x) => x.planned.reps)).toEqual([{ min: 3, max: 6 }, { min: 3, max: 6 }, { min: 3, max: 6 }]);

    // Log, twice with the same opId (double tap): one set, one rest, one alert.
    const log = { type: 'log_set' as const, at: now(), opId: v.focus?.opId ?? '', setId, values: v.focus?.logValues ?? draft, restTimerId: ids() };
    const first = await s.workout.dispatch(sessionId, log);
    const second = await s.workout.dispatch(sessionId, { ...log, restTimerId: ids() });
    expect(first.ok && !first.duplicate).toBe(true);
    expect(second.ok && second.duplicate).toBe(true);
    await settle(s);
    expect([...pending.values()].map((p) => [p.fireAtMs - clockMs, plain(p.body)])).toEqual([[180_000, 'Next: Bench press · 3–6 reps (no load target)']]);

    // Force-close during rest; reopen 10 s later: the remaining time is right, one alert.
    await forceClose();
    clockMs += 10_000;
    relaunch = await launch();
    s = relaunch.services;
    await settle(s);
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    v = s.workout.view(data, clockMs, null);
    expect(v.rest).toMatchObject({ kind: 'running', remainingMs: 170_000 });
    expect(pending.size).toBe(1);
    expect(plain(v.justSaved?.text)).toBe('60 kg × 8');
    // Effort chip: rest unchanged.
    const effort = await s.workout.dispatch(sessionId, { type: 'correct_set', at: now(), opId: 'rpe-1', setId, expectedSetVersion: v.justSaved?.setVersion ?? 0, patch: { rpe: 8 } });
    expect(effort.ok && effort.aggregate.restTimer?.deadlineUtc).toBe(data.aggregate.restTimer?.deadlineUtc);

    // Skip rest: alert cancelled. Log the second set (prefilled from this session's last set).
    clockMs += 5_000;
    await s.workout.dispatch(sessionId, { type: 'skip_rest', at: now(), opId: `skip:${data.aggregate.restTimer?.id ?? ''}`, timerId: data.aggregate.restTimer?.id ?? '' });
    await settle(s);
    expect(pending.size).toBe(0);
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    v = s.workout.view(data, clockMs, null);
    // The target's reps, with the load from this session's last set.
    expect(v.focus?.draftSource).toBe('target');
    expect(v.focus?.draft.load?.value).toBe(60);
    const l2 = await s.workout.dispatch(sessionId, { type: 'log_set', at: now(), opId: v.focus?.opId ?? '', setId: v.focus?.setId ?? '', values: v.focus?.logValues ?? draft, restTimerId: ids() });
    expect(l2.ok).toBe(true);
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    v = s.workout.view(data, clockMs, null);
    // Set 3 is next, after a rest; Finish skips it.
    expect(v.focus?.setNumber).toBe(3);
    expect(v.rest).toMatchObject({ kind: 'running' });

    // Finish: summary, backup, no alert left.
    clockMs += 60_000;
    const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: now(), opId: 'finish-1', expectedVersion: data.aggregate.session.version, endedAt: null });
    expect(fin.ok).toBe(true);
    await settle(s);
    expect(pending.size).toBe(0);
    expect([...backupFiles.keys()].some((n) => n.endsWith('-auto.json'))).toBe(true);
    const sum = await s.workout.summary(sessionId);
    expect(sum?.facts).toMatchObject({ workingSets: 2, exercisesDone: 1 });
    expect(sum?.nextTime?.sourceTag).toBe('Built-in rule (coach not connected)');
    expect(plain(sum?.exercises[0]?.results)).toBe('60×8 · 60×6');
    expect((await s.today.view())?.main).toMatchObject({ kind: 'done_today', title: 'Workout' });
    expect((await s.today.view())?.week.text).toBe('1 workout this week');

    // Edit times on the summary: end earlier (audited), refused before the last set.
    const tooEarly = await s.workout.dispatch(sessionId, { type: 'update_session_timing', at: now(), opId: 'time-0', expectedVersion: fin.ok ? fin.aggregate.session.version : 0, startedAt: null, endedAt: { utc: toIso(clockMs - 10 * 60_000), tz: TZ } });
    expect(tooEarly.ok ? null : tooEarly.error.code).toBe('invalid_time');
    const edited = await s.workout.dispatch(sessionId, { type: 'update_session_timing', at: now(), opId: 'time-1', expectedVersion: fin.ok ? fin.aggregate.session.version : 0, startedAt: null, endedAt: { utc: toIso(clockMs - 30_000), tz: TZ } });
    expect(edited.ok).toBe(true);
    expect((await s.workout.summary(sessionId))?.timingEdited).toEqual({ start: false, end: true });
  });

  it('a rest that ended while the app was closed: no alert left, Ready with the count-up', async () => {
    let { services: s } = await launch();
    const gymId = await setUp(s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const press = (await s.workout.pickerExercises(sessionId, 'lat pulldown'))[0];
    await s.workout.addExercise({ sessionId, exerciseId: press?.exercise.id ?? '', equipmentId: press?.equipment[0]?.id ?? null, opId: 'add' });
    let data = await s.workout.load();
    const f = data ? s.workout.view(data, clockMs, { setId: data.aggregate.session.activeSetId ?? '', values: { load: { value: 45, unit: 'kg', convention: 'stack' }, reps: 12, durationS: null, rpe: null, rir: null } }).focus : null;
    await s.workout.dispatch(sessionId, { type: 'add_set', at: now(), opId: 'add-set', sessionExerciseId: data?.aggregate.exercises[0]?.id ?? '', newSetId: ids(), setType: null });
    await s.workout.dispatch(sessionId, { type: 'log_set', at: now(), opId: f?.opId ?? '', setId: f?.setId ?? '', values: f?.logValues ?? { load: null, reps: null, durationS: null, rpe: null, rir: null }, restTimerId: ids() });
    await settle(s);
    expect(pending.size).toBe(1);
    await forceClose();
    // iOS delivers the notification at the deadline while Fizz is closed.
    clockMs += 5 * 60_000;
    pending.clear();
    alertCalls = [];
    s = (await launch()).services;
    await settle(s);
    expect(alertCalls.every((c) => c.startsWith('cancel'))).toBe(true);
    expect(pending.size).toBe(0);
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(s.workout.view(data, clockMs, null).rest).toMatchObject({ kind: 'ended', skipped: false });
  });
});
