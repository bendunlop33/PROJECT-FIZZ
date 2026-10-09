import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toIso, toMs } from '@fizz/domain';
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
    app: { name: 'Fizz', version: '0.1.0', build: 'test' },
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
    await s.manager.close().catch(() => undefined);
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
    expect([...backupFiles.keys()].some((n) => n.endsWith('-auto.json'))).toBe(true);
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
    expect(Object.keys(s.coachingKnowledge).sort()).toEqual(['buildGymDraft', 'exercises', 'gymPresets']);
    expect(Object.keys(s.yourData).sort()).toEqual(['counts', 'currentGym', 'equipment', 'gyms', 'profile']);
    // Presets carry nothing about Ben.
    const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
    expect(JSON.stringify(draft)).not.toMatch(/ownerId|gymId/);
  });
});
