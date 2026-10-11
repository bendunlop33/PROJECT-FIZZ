import { afterEach, describe, expect, it } from 'vitest';

import type { CopyDestination } from '../src/backup/backup-service';
import type { CredentialPort, PersonalFilesPort } from '../src/backup/data-domain-service';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Export, Delete my data and Reset coaching knowledge through the app
 * services on real SQLite files (data-import-export §2.6, §2.7, §3.6, §4.5;
 * checks 30, 31, 31a; CLAUDE.md rule 10).
 */

let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

/** A Keychain stand-in: two items, sign-out and wipe recorded. */
function fakeKeychain(opts: { online?: boolean; failWipeOnce?: boolean; hangSignOut?: boolean } = {}) {
  const items = new Map([
    ['fizz.chatgpt.registration', '{"v":1,"hostId":"h"}'],
    ['fizz.chatgpt.tokens', '{"v":1}'],
  ]);
  const calls: string[] = [];
  let failWipe = opts.failWipeOnce ?? false;
  const port: CredentialPort = {
    signOut() {
      calls.push('signOut');
      if (opts.hangSignOut) return new Promise(() => undefined);
      const had = items.has('fizz.chatgpt.tokens');
      items.delete('fizz.chatgpt.tokens');
      return Promise.resolve({ revoked: had && (opts.online ?? true), hadSession: had });
    },
    wipe() {
      calls.push('wipe');
      if (failWipe) {
        failWipe = false;
        return Promise.reject(new Error('killed'));
      }
      items.clear();
      return Promise.resolve();
    },
  };
  return { port, items, calls };
}

function fakeFiles() {
  const files = new Set(['coach-connection.json', 'device-prefs.json']);
  const port: PersonalFilesPort = {
    remove() {
      files.clear();
      return Promise.resolve();
    },
  };
  return { port, files };
}

function folder(insideApp = false) {
  const written = new Map<string, string>();
  const dest: CopyDestination = {
    label: 'iCloud Drive › Fizz backups',
    insideApp,
    write: (n, t) => {
      written.set(n, t);
      return Promise.resolve();
    },
    read: (n) => Promise.resolve(written.get(n) ?? null),
  };
  return { dest, written };
}

type Tables = Record<string, Record<string, unknown>[]>;
const tablesOf = (text: string) => (JSON.parse(text) as { tables: Tables }).tables;

async function workoutWithRestRunning(s: Awaited<ReturnType<Harness['launch']>>['services'], gymId: string) {
  const started = await s.workout.start({ gymId, opId: 'unfinished', checkIn: null });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const picks = await s.workout.pickerExercises(sessionId, 'Bench press');
  const pick = picks.find((p) => p.exercise.name === 'Bench press');
  if (!pick) throw new Error('no bench');
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
  if (!added.ok) throw new Error(added.error.message);
  const set = added.aggregate.sets[0];
  const ex = added.aggregate.exercises[0];
  if (!set || !ex) throw new Error('no set');
  const r = await s.workout.dispatch(sessionId, {
    type: 'log_set',
    at: h.now(),
    opId: `log:${set.id}`,
    setId: set.id,
    values: { load: { value: 60, unit: ex.unit, convention: ex.loadConvention }, reps: 8, durationS: null, rpe: null, rir: null },
    restTimerId: h.ids(),
  });
  if (!r.ok) throw new Error(r.error.message);
}

describe('Delete my data (keep coaching knowledge)', () => {
  it('removes every owner-scoped record, signs out, cancels alerts, keeps coaching knowledge, and a backup made just before restores it all', async () => {
    const keychain = fakeKeychain();
    const files = fakeFiles();
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port, personalFiles: files.port });
    let { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    await workoutWithRestRunning(s, gymId);
    await h.settle(s);
    expect(h.pending.size).toBe(1);
    const profileId = (await s.yourData.profile())?.id ?? '';
    const knowledgeBefore = tablesOf((await s.data.buildExport('coaching_knowledge')).text);
    const backupsBefore = new Set(h.backupFiles.keys());

    const summary = await s.data.summary();
    expect(summary.counts.yourData).toMatchObject({ workouts: 1, gyms: 1 });
    expect(summary.counts.coachingKnowledge.exercises).toBeGreaterThan(0);
    expect(summary.lastCopyToFiles).toBeNull();

    const r = await s.data.deleteMyData({ opId: 'delete-1', stamp: summary.stamp });
    expect(r).toEqual({ ok: true, duplicate: false, signedOutOnline: true });

    // Your data: nothing left. Coaching knowledge: identical.
    const after = await s.data.summary();
    expect(after.counts.yourData.records).toBe(0);
    expect(tablesOf((await s.data.buildExport('coaching_knowledge')).text)).toEqual(knowledgeBefore);
    expect(Object.keys(tablesOf((await s.data.buildExport('your_data')).text))).toEqual([]);
    // Credentials, files outside SQLite, alerts.
    expect(keychain.calls).toEqual(['signOut', 'wipe']);
    expect(keychain.items.size).toBe(0);
    expect(files.files.size).toBe(0);
    expect(h.pending.size).toBe(0);
    expect(s.developer.databaseNames().previous).toBeNull();

    // The backup made right before is on this phone and labelled.
    const made = [...h.backupFiles.keys()].filter((n) => !backupsBefore.has(n));
    expect(made).toHaveLength(1);
    const copies = await s.restore.copiesOnPhone();
    expect(copies.find((c) => c.fileName === made[0])?.reason).toBe('before_delete');

    // Relaunch: first run (no profile), nothing to resume.
    await h.forceClose();
    const relaunched = await h.launch();
    s = relaunched.services;
    expect(relaunched.setup.profile).toBeNull();
    expect(relaunched.setup.step).toBe('welcome');

    // Restore from that backup brings everything back.
    const text = await s.restore.readOnPhone(made[0] ?? '');
    if (text === null) throw new Error('backup gone');
    const checked = await s.restore.prepare(text);
    if (!checked.ok) throw new Error(checked.error.message);
    expect(await s.restore.restore(text, checked.preview.stamp)).toMatchObject({ ok: true, status: 'restored' });
    expect((await s.yourData.profile())?.id).toBe(profileId);
    expect((await s.yourData.counts()).finishedWorkouts).toBe(1);
    expect(await s.sessions.active()).not.toBeNull();
  });

  it('is idempotent by op ID: a repeat returns the first result and makes no second backup', async () => {
    h = createHarness();
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const { stamp } = await s.data.summary();
    const [a, b] = await Promise.all([s.data.deleteMyData({ opId: 'twice', stamp }), s.data.deleteMyData({ opId: 'twice', stamp })]);
    expect(a).toEqual({ ok: true, duplicate: false, signedOutOnline: null });
    expect(b).toEqual({ ok: true, duplicate: true, signedOutOnline: null });
    expect((await s.restore.copiesOnPhone()).filter((c) => c.reason === 'before_delete')).toHaveLength(1);
  });

  it('refuses a stale confirmation and changes nothing (rule 5)', async () => {
    const keychain = fakeKeychain();
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port });
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { stamp } = await s.data.summary();
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const backups = h.backupFiles.size;
    const r = await s.data.deleteMyData({ opId: 'stale', stamp });
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
    expect((await s.yourData.counts()).finishedWorkouts).toBe(1);
    expect(h.backupFiles.size).toBe(backups);
    expect(keychain.calls).toEqual([]);
  });

  it('deletes nothing when the backup before it can’t be written', async () => {
    h = createHarness();
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const { stamp } = await s.data.summary();
    h.backupFiles.set = () => {
      throw new Error('ENOSPC: no space left on device');
    };
    const r = await s.data.deleteMyData({ opId: 'full', stamp });
    expect(r).toEqual({ ok: false, reason: 'backup_failed', message: 'This iPhone is out of space.' });
    expect((await s.yourData.counts()).finishedWorkouts).toBe(1);
    expect((await s.data.summary()).stamp).toBe(stamp);
  });

  it('a force-close part-way is finished by the next launch before anything is shown (check 31)', async () => {
    const keychain = fakeKeychain({ failWipeOnce: true });
    const files = fakeFiles();
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port, personalFiles: files.port });
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const { stamp } = await s.data.summary();
    // The app dies while deleting the Keychain items.
    expect(await s.data.deleteMyData({ opId: 'killed', stamp })).toMatchObject({ ok: false, reason: 'failed', pending: true });
    expect(keychain.items.size).toBeGreaterThan(0);
    await h.forceClose();

    const relaunched = await h.launch();
    expect(relaunched.setup.step).toBe('welcome');
    expect(keychain.items.size).toBe(0);
    expect(files.files.size).toBe(0);
    expect((await relaunched.services.data.summary()).counts.yourData.records).toBe(0);
    // The same op ID now reads as done.
    expect(await relaunched.services.data.deleteMyData({ opId: 'killed', stamp: 'anything' })).toMatchObject({ ok: true, duplicate: true });
  });

  it('says when ChatGPT couldn’t be signed out online; the sign-in is removed from the phone anyway', async () => {
    const keychain = fakeKeychain({ hangSignOut: true });
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port });
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const { stamp } = await s.data.summary();
    // The default timeout is 10 s; the hanging revoke is cut off by it.
    const r = await s.data.deleteMyData({ opId: 'offline', stamp });
    expect(r).toEqual({ ok: true, duplicate: false, signedOutOnline: false });
    expect(keychain.items.size).toBe(0);
  }, 20_000);
});

describe('Reset coaching knowledge', () => {
  it('puts the bundled knowledge back, keeps exercises Ben’s records use, never changes Your data or credentials', async () => {
    const keychain = fakeKeychain();
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port });
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const mineBefore = tablesOf((await s.data.buildExport('your_data')).text);
    const knownBefore = tablesOf((await s.data.buildExport('coaching_knowledge')).text);
    const backups = h.backupFiles.size;

    const { stamp } = await s.data.summary();
    const r = await s.data.resetCoachingKnowledge({ opId: 'reset-1', stamp });
    expect(r.ok).toBe(true);
    expect(tablesOf((await s.data.buildExport('your_data')).text)).toEqual(mineBefore);
    const knownAfter = tablesOf((await s.data.buildExport('coaching_knowledge')).text);
    // Every starter exercise is there; nothing about Ben is.
    const ids = (t: Tables) => (t.exercises ?? []).map((e) => e.id).sort();
    expect(ids(knownAfter)).toEqual(ids(knownBefore));
    expect(keychain.calls).toEqual([]);
    expect(h.backupFiles.size).toBe(backups + 1);
    expect((await s.restore.copiesOnPhone())[0]?.reason).toBe('before_reset');
    // A repeat of the op is a no-op.
    expect(await s.data.resetCoachingKnowledge({ opId: 'reset-1', stamp })).toEqual({ ok: true, duplicate: true, status: 'unchanged' });
  });
});

describe('Export', () => {
  it('My data and Coaching knowledge only go to the folder Ben picks; each holds one domain only', async () => {
    h = createHarness();
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const ownerId = (await s.yourData.profile())?.id ?? '';
    const { dest, written } = folder();

    const known = await s.data.saveExportTo(dest, 'coaching_knowledge');
    expect(known).toMatchObject({ ok: true, destinationLabel: 'iCloud Drive › Fizz backups' });
    if (!known.ok) throw new Error('export failed');
    expect(known.fileName).toMatch(/^fizz-coaching-knowledge-2026-10-08-\d{4}\.json$/);
    const knownText = written.get(known.fileName) ?? '';
    expect(JSON.parse(knownText)).toMatchObject({ format: 'fizz-export', section: 'coaching_knowledge' });
    expect(knownText).not.toContain(ownerId);
    expect(Object.keys(tablesOf(knownText))).toEqual(['exercises']);

    const mine = await s.data.saveExportTo(dest, 'your_data');
    if (!mine.ok) throw new Error('export failed');
    const mineTables = tablesOf(written.get(mine.fileName) ?? '');
    expect(mineTables.profiles?.[0]?.id).toBe(ownerId);
    expect(mineTables.sessions).toHaveLength(1);
    expect(mineTables.exercises).toBeUndefined();

    expect(await s.data.saveExportTo(folder(true).dest, 'your_data')).toMatchObject({ ok: false, reason: 'inside_app' });
  });
});
