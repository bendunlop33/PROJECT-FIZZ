import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { discardConfirmation, toIso, toMs } from '@fizz/domain';
import { idGen } from '@fizz/domain/testing';
import type { ZonedTimestamp } from '@fizz/schemas';

import type { BackupFileStore, TextFile } from '../src/backup/backup-service';
import { createExpoDatabaseHost } from '../src/data/expo-driver';
import type { AppServices } from '../src/services/app-services';
import { setupStep, unitFromMeasurementSystem } from '../src/services/setup';
import { startApp, type StartupOutcome } from '../src/services/startup';
import { fakeHostDeps } from './fake-expo-sqlite';

const TZ = 'Europe/London';

let dir: string;
let clockMs: number;
let ids: () => string;
let dbNames: number;
let backupFiles: Map<string, string>;
let manifestText: string | null;
const open: AppServices[] = [];

function files(): BackupFileStore {
  return {
    write: (n, t) => {
      backupFiles.set(n, t);
      return Promise.resolve();
    },
    read: (n) => Promise.resolve(backupFiles.get(n) ?? null),
    remove: (n) => {
      backupFiles.delete(n);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...backupFiles.keys()]),
  };
}
const manifest: TextFile = {
  read: () => Promise.resolve(manifestText),
  write: (t) => {
    manifestText = t;
    return Promise.resolve();
  },
};

async function launch(): Promise<StartupOutcome> {
  const outcome = await startApp({
    host: createExpoDatabaseHost(fakeHostDeps(dir)),
    newDatabaseName: () => `training-${String(++dbNames)}.db`,
    backupFiles: files(),
    backupManifest: manifest,
    now: (): ZonedTimestamp => ({ utc: toIso(clockMs), tz: TZ }),
    newId: ids,
    app: { name: 'GymSmarter', version: '0.1.0', build: 'test' },
    locale: 'en-GB',
  });
  if (outcome.kind === 'ready') open.push(outcome.services);
  return outcome;
}

async function ready(): Promise<Extract<StartupOutcome, { kind: 'ready' }>> {
  const o = await launch();
  if (o.kind !== 'ready') throw new Error(`startup: ${o.kind}`);
  return o;
}

async function idle(s: AppServices) {
  for (let i = 0; i < 200 && s.backups.isRunning; i += 1) await new Promise((r) => setTimeout(r, 5));
  // Let any background work queued at launch settle too.
  await new Promise((r) => setTimeout(r, 20));
}

async function closeAll() {
  for (const s of open.splice(0)) {
    await idle(s);
    await s.close().catch(() => undefined);
  }
}

async function setUp(s: AppServices) {
  expect(await s.setup.saveUnits('kg')).toEqual({ ok: true });
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  expect(await s.setup.saveGym({ gymId: ids(), name: 'Main gym', draft })).toEqual({ ok: true });
  expect(await s.setup.complete()).toEqual({ ok: true });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fizz-app-services-'));
  clockMs = toMs('2026-10-08T17:00:00.000Z');
  ids = idGen(1);
  dbNames = 0;
  backupFiles = new Map();
  manifestText = null;
});
afterEach(async () => {
  await closeAll();
  rmSync(dir, { recursive: true, force: true });
});

describe('first run (onboarding.md §3.1)', () => {
  it('derives the step from stored data', () => {
    expect(unitFromMeasurementSystem('us')).toBe('lb');
    expect(unitFromMeasurementSystem('uk')).toBe('kg');
    expect(unitFromMeasurementSystem(null)).toBe('kg');
  });

  it('walks Welcome → units → gym → data → done, and each write is safe to repeat', async () => {
    const { services: s, setup } = await ready();
    expect(setup.step).toBe('welcome');
    expect(await s.setup.saveUnits('kg')).toEqual({ ok: true });
    expect(await s.setup.saveUnits('kg')).toEqual({ ok: true });
    expect(await s.setup.saveUnits('lb')).toEqual({ ok: true });
    let state = await s.setup.getState();
    expect(state.step).toBe('gym');
    expect(state.profile?.preferredUnit).toBe('lb');
    expect(state.profile?.restPresets.map((p) => p.seconds)).toEqual([60, 90, 180]);

    const gymId = ids();
    const draft = s.coachingKnowledge.buildGymDraft('commercial', 'lb');
    expect(await s.setup.saveGym({ gymId, name: '  ', draft })).toEqual({ ok: false, message: 'Give the gym a name' });
    // Double tap: same gym ID, one gym.
    const [a, b] = await Promise.all([s.setup.saveGym({ gymId, name: 'Main gym', draft }), s.setup.saveGym({ gymId, name: 'Main gym', draft })]);
    expect([a, b]).toEqual([{ ok: true }, { ok: true }]);
    state = await s.setup.getState();
    expect(state.step).toBe('data');
    expect(state.gyms).toHaveLength(1);
    expect(state.gyms[0]?.isDefault).toBe(true);
    expect(await s.yourData.equipment(gymId)).toHaveLength(4);

    expect(await s.setup.complete()).toEqual({ ok: true });
    expect((await s.setup.getState()).step).toBe('done');
  });

  it('resumes on the data step after a force-close (check 4) and skip-gym goes there too', async () => {
    const first = await ready();
    await first.services.setup.saveUnits('kg');
    await first.services.setup.skipGym();
    await closeAll();
    const again = await ready();
    expect(again.setup.step).toBe('data');
    expect(again.setup.gyms).toEqual([]);
  });

  it('Back over a saved gym never creates a second gym, and Skip after it keeps the gym (review B1)', async () => {
    const { services: s } = await ready();
    await s.setup.saveUnits('kg');
    const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
    const first = ids();
    expect(await s.setup.saveGym({ gymId: first, name: 'Main gym', draft })).toEqual({ ok: true });
    // Back, then Save gym again from a fresh visit (new ID): refused, honestly.
    expect(await s.setup.saveGym({ gymId: ids(), name: 'Main gym', draft })).toEqual({
      ok: false,
      message: 'A gym is already saved.',
    });
    // A retry of the first save is still a duplicate, not an error.
    expect(await s.setup.saveGym({ gymId: first, name: 'Main gym', draft })).toEqual({ ok: true });
    expect(await s.setup.skipGym()).toEqual({ ok: true });
    const state = await s.setup.getState();
    expect(state.gyms.map((g) => g.id)).toEqual([first]);
    expect(state.profile?.setup?.gymStep).toBe('saved');
    // After setup, Add gym (same flow) can add a second gym.
    await s.setup.complete();
    expect(await s.setup.saveGym({ gymId: ids(), name: 'Hotel', draft: null })).toEqual({ ok: true });
    expect(await s.yourData.gyms()).toHaveLength(2);
  });

  it('saveUnits creates exactly one owner profile, even when called concurrently (review S1)', async () => {
    const { services: s } = await ready();
    const results = await Promise.all([s.setup.saveUnits('kg'), s.setup.saveUnits('kg'), s.setup.saveUnits('kg')]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect((await s.setup.getState()).profile?.preferredUnit).toBe('kg');
    expect((await s.yourData.counts()).gyms).toBe(0);
    const current = s.developer.databaseNames().current;
    const db = new DatabaseSync(join(dir, current), { readOnly: true });
    expect(db.prepare('SELECT count(*) AS n FROM profiles').get()).toEqual({ n: 1 });
    db.close();
  });

  it('treats a restored profile without setup tracking as set up', () => {
    const profile = { setup: undefined } as unknown as Parameters<typeof setupStep>[0];
    expect(setupStep(profile, 0)).toBe('done');
    expect(setupStep(null, 3)).toBe('welcome');
  });
});

describe('workouts and recovery', () => {
  it('starts one session per opId and reopens it after a restart (< 6 h)', async () => {
    const { services: s } = await ready();
    await setUp(s);
    const gym = await s.yourData.currentGym();
    if (!gym) throw new Error('no gym');
    const first = await s.sessions.startEmpty({ gymId: gym.id, opId: 'start-1' });
    const dup = await s.sessions.startEmpty({ gymId: gym.id, opId: 'start-1' });
    expect(first.ok && dup.ok && dup.duplicate && dup.aggregate.session.id === first.aggregate.session.id).toBe(true);
    const other = await s.sessions.startEmpty({ gymId: gym.id, opId: 'start-2' });
    expect(other.ok ? null : other.error.code).toBe('session_already_active');
    await closeAll();

    clockMs += 30 * 60_000;
    const relaunch = await ready();
    expect(relaunch.recovery?.openInto).toBe('active_workout');
    expect(relaunch.recovery?.state.session.status).toBe('active');
    await closeAll();

    clockMs += 7 * 3600_000;
    const later = await ready();
    expect(later.recovery?.openInto).toBe('today');
  });

  it('defers the launch catch-up backup while a workout is unfinished (review S4)', async () => {
    const { services: s } = await ready();
    await setUp(s);
    const gym = await s.yourData.currentGym();
    if (!gym) throw new Error('no gym');
    const one = await s.sessions.startEmpty({ gymId: gym.id, opId: 'start-1' });
    if (!one.ok) throw new Error(one.error.message);
    clockMs += 60_000;
    await s.sessions.finish(one.aggregate, 'finish-1');
    await idle(s);
    // The backup is lost (e.g. iOS stopped it) and a new workout is in progress.
    backupFiles.clear();
    manifestText = null;
    const two = await s.sessions.startEmpty({ gymId: gym.id, opId: 'start-2' });
    if (!two.ok) throw new Error(two.error.message);
    await closeAll();

    clockMs += 60_000;
    const relaunch = await ready();
    await idle(relaunch.services);
    expect(relaunch.recovery?.openInto).toBe('active_workout');
    expect(backupFiles.size).toBe(0);
    await closeAll();

    // With no workout in progress, the launch catches up.
    const s3 = (await ready()).services;
    const active = await s3.sessions.active();
    if (!active) throw new Error('no active');
    await s3.sessions.discard(active.session.id, discardConfirmation(active), 'discard-2');
    await closeAll();
    await ready().then((o) => idle(o.services));
    // The catch-up starts after the launch's background integrity turns; give it time under load.
    await vi.waitFor(() => {
      expect([...backupFiles.keys()].some((n) => n.endsWith('-auto.json'))).toBe(true);
    });
  });

  it('backs up on this phone after Finish, once, without the finish waiting for it', async () => {
    const { services: s } = await ready();
    await setUp(s);
    const gym = await s.yourData.currentGym();
    if (!gym) throw new Error('no gym');
    const started = await s.sessions.startEmpty({ gymId: gym.id, opId: 'start-1' });
    if (!started.ok) throw new Error(started.error.message);
    clockMs += 60_000;

    const stale = await s.sessions.dispatch(started.aggregate.session.id, {
      type: 'finish',
      at: { utc: toIso(clockMs), tz: TZ },
      opId: 'finish-stale',
      expectedVersion: started.aggregate.session.version + 5,
      endedAt: null,
    });
    expect(stale.ok ? null : stale.error.code).toBe('stale_version');

    const finished = await s.sessions.finish(started.aggregate, 'finish-1');
    expect(finished.ok).toBe(true);
    expect(s.backups.isRunning).toBe(true); // started, not awaited by finish
    await idle(s);
    const again = await s.sessions.finish(started.aggregate, 'finish-1');
    expect(again.ok && again.duplicate).toBe(true);
    await idle(s);

    const auto = [...backupFiles.keys()].filter((n) => n.endsWith('-auto.json'));
    expect(auto).toEqual(['fizz-backup-2026-10-08-1801-auto.json']);
    const status = await s.backups.getStatus();
    expect(status.onPhone.state).toBe('backed_up');
    expect(status.onPhone.line.text).toBe('Backed up on this phone · 18:01');
    expect((await s.yourData.counts()).finishedWorkouts).toBe(1);
  });

  it('catches up a backup at launch when the last one was cut short', async () => {
    const first = await ready();
    await setUp(first.services);
    const gym = await first.services.yourData.currentGym();
    const started = await first.services.sessions.startEmpty({ gymId: gym?.id ?? '', opId: 's' });
    if (!started.ok) throw new Error('start failed');
    await first.services.sessions.finish(started.aggregate, 'f');
    await idle(first.services);
    backupFiles.clear();
    manifestText = null; // as if the backup never landed
    await closeAll();

    const second = await ready();
    await idle(second.services);
    // The catch-up is queued at launch, not awaited by it: under full-suite load it can start after `idle`'s
    // short settle, so wait for it (up to 5 s) rather than for a fixed time (review session-picker N1), and for its
    // integrity check too, which is recorded after the file lands (review progress-B r3 N3).
    const landed = () => [...backupFiles.keys()].some((n) => n.endsWith('-auto.json'));
    const settled = () => landed() && !second.services.backups.isRunning && second.services.integrity.last() !== null;
    for (let i = 0; i < 250 && !settled(); i += 1) await new Promise((r) => setTimeout(r, 20));
    expect(landed()).toBe(true);
    expect(second.services.integrity.last()?.report.ok).toBe(true);
  });
});

describe('startup failures are reported, never guessed', () => {
  it('refuses a database from a newer build and leaves it untouched', async () => {
    const first = await ready();
    await closeAll();
    expect(first.kind).toBe('ready');
    const raw = new DatabaseSync(join(dir, 'training-1.db'));
    raw.exec('PRAGMA user_version = 99');
    raw.close();
    const o = await launch();
    expect(o.kind).toBe('schema_too_new');
    const check = new DatabaseSync(join(dir, 'training-1.db'));
    expect(check.prepare('PRAGMA user_version').get()).toEqual({ user_version: 99 });
    check.close();
  });
});

describe('Your data and Coaching knowledge are separate (rule 10)', () => {
  it('exposes owner-scoped records only under yourData and general ones only under coachingKnowledge', async () => {
    const { services: s } = await ready();
    expect(Object.keys(s.coachingKnowledge).sort()).toEqual(['buildGymDraft', 'ensureStarterExercises', 'exercises', 'gymPresets']);
    // The starter exercise list is seeded at launch, owner-free, and seeding again adds nothing.
    const exercises = await s.coachingKnowledge.exercises();
    expect(exercises.length).toBeGreaterThan(20);
    expect(exercises.every((e) => e.ownerId === null)).toBe(true);
    expect(await s.coachingKnowledge.ensureStarterExercises()).toBe(0);
    expect(Object.keys(s.yourData).sort()).toEqual(['counts', 'currentGym', 'equipment', 'gyms', 'profile']);
    // Presets carry nothing about Ben.
    const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
    expect(JSON.stringify(draft)).not.toMatch(/ownerId|gymId/);
  });
});

describe('starter exercises after the ID scheme change (review B2)', () => {
  it('removes unreferenced pre-B2 starter rows at launch and keeps referenced ones', async () => {
    const { services: s } = await ready();
    const { LEGACY_STARTER_IDS, starterExercises } = await import('@fizz/domain');
    const legacy = starterExercises('2026-10-08T00:00:00.000Z').slice(0, 2).map((e, i) => ({ ...e, id: LEGACY_STARTER_IDS[i] ?? '' }));
    await s.close();
    const current = (await ready()).services;
    const names = current.developer.databaseNames().current;
    await current.close();
    const db = new DatabaseSync(join(dir, names));
    for (const e of legacy) db.prepare('INSERT INTO exercises (id, owner_id, version, updated_at_utc, data) VALUES (?, NULL, 1, ?, ?)').run(e.id, e.updatedAtUtc, JSON.stringify(e));
    // The second legacy row is used by a pain flag, so it stays.
    db.prepare("INSERT INTO pain_flags (id, owner_id, exercise_id, status, version, updated_at_utc, data) VALUES ('p1', 'o', ?, 'cleared', 1, '2026-10-08T00:00:00.000Z', '{}')").run(legacy[1]?.id ?? '');
    db.close();
    const again = (await ready()).services;
    const ids = (await again.coachingKnowledge.exercises()).map((e) => e.id);
    expect(ids).not.toContain(legacy[0]?.id);
    expect(ids).toContain(legacy[1]?.id);
    expect(ids.filter((id) => !LEGACY_STARTER_IDS.includes(id))).toHaveLength(starterExercises('x').length);
  });
});
