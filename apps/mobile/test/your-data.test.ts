import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@fizz/persistence';

import type { CopyDestination } from '../src/backup/backup-service';
import type { CredentialPort, PersonalFilesPort } from '../src/backup/data-domain-service';
import { rollbackConfirmMessage, rollbackRowView } from '../src/backup/restore-view';
import { resetAlertView } from '../src/backup/data-domain-view';
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
function fakeKeychain(opts: { online?: boolean; failWipe?: 'once' | 'always'; revokeDelayMs?: number } = {}) {
  const items = new Map([
    ['fizz.chatgpt.registration', '{"v":1,"hostId":"h"}'],
    ['fizz.chatgpt.tokens', '{"v":1}'],
  ]);
  const calls: string[] = [];
  let failWipe = opts.failWipe ?? null;
  const port: CredentialPort = {
    signOut() {
      calls.push('signOut');
      const had = items.has('fizz.chatgpt.tokens');
      items.delete('fizz.chatgpt.tokens');
      if (!had) return Promise.resolve({ revokeOnline: null });
      return Promise.resolve({
        revokeOnline: () =>
          new Promise<boolean>((resolve) => {
            setTimeout(() => {
              calls.push('revoked');
              resolve(opts.online ?? true);
            }, opts.revokeDelayMs ?? 0);
          }),
      });
    },
    wipe() {
      calls.push('wipe');
      if (failWipe !== null) {
        if (failWipe === 'once') failWipe = null;
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

/** Ben's data with strings to search for afterwards (check 29a, check 30). */
async function bensData(s: Awaited<ReturnType<Harness['launch']>>['services']) {
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
  const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 2 });
  if (!ci.ok) throw new Error('check-in');
  const noted = await s.checkIns.update(ci.checkIn.id, { note: 'Slept badly' }, ci.checkIn.version, h.ids());
  if (!noted.ok) throw new Error('note');
  const bench = (await s.workout.pickerExercises('none', 'bench')).find((p) => p.exercise.name === 'Bench press');
  const flagged = await s.pain.flagFromCheckIn({ checkIn: noted.checkIn, exercises: [{ id: bench?.exercise.id ?? '', name: 'Bench press' }], area: 'shoulder', opId: 'flag-1' });
  const flagId = flagged.ok ? flagged.flagIds?.[0] : undefined;
  if (!flagId) throw new Error('flag');
  const ownerId = (await s.yourData.profile())?.id ?? '';
  // Personal strings: none may be left in any file on the phone after Delete, or in a knowledge export.
  return { gymId, personal: [ownerId, 'Main Gym', 'Slept badly', ci.checkIn.id, flagId] };
}

function filesHolding(h: Harness, strings: readonly string[]): string[] {
  return [...h.containerFiles()].filter(([, text]) => strings.some((p) => text.includes(p))).map(([name]) => name);
}

describe('Delete my data (keep coaching knowledge)', () => {
  it('removes every owner-scoped record and every backup on this phone, signs out, cancels alerts, keeps coaching knowledge (check 30)', async () => {
    const keychain = fakeKeychain();
    const files = fakeFiles();
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port, personalFiles: files.port });
    const { services: s } = await h.launch();
    const { gymId, personal } = await bensData(s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 8 }] }]);
    await s.backups.backUpOnPhone('manual');
    await s.backups.markTrialRunDone();
    expect((await s.backups.saveCopyTo(folder().dest)).ok).toBe(true);
    await workoutWithRestRunning(s, gymId);
    await h.settle(s);
    expect(h.pending.size).toBe(1);
    expect(h.backupFiles.size).toBeGreaterThanOrEqual(3);
    expect(filesHolding(h, personal).length).toBeGreaterThan(0);
    const knowledgeBefore = tablesOf((await s.data.buildExport('coaching_knowledge')).text);

    const summary = await s.data.summary();
    expect(summary.counts.yourData).toMatchObject({ workouts: 2, gyms: 1, painFlags: 1, checkIns: 1 });
    expect(summary.counts.coachingKnowledge.exercises).toBeGreaterThan(0);
    expect(summary.lastCopyToFiles).not.toBeNull();

    const r = await s.data.deleteMyData({ opId: 'delete-1', stamp: summary.stamp });
    expect(r).toEqual({ ok: true, duplicate: false, signedOutOnline: true });

    // Your data: nothing left. Coaching knowledge: identical.
    const after = await s.data.summary();
    expect(after.counts.yourData.records).toBe(0);
    expect(after.lastCopyToFiles).toBeNull();
    expect(tablesOf((await s.data.buildExport('coaching_knowledge')).text)).toEqual(knowledgeBefore);
    expect(Object.keys(tablesOf((await s.data.buildExport('your_data')).text))).toEqual([]);
    // Credentials, files outside SQLite, alerts.
    expect(keychain.calls).toEqual(['signOut', 'revoked', 'wipe']);
    expect(keychain.items.size).toBe(0);
    expect(files.files.size).toBe(0);
    expect(h.pending.size).toBe(0);
    expect(s.developer.databaseNames().previous).toBeNull();

    // No file on this phone holds anything of Ben's: one backup is left, coaching knowledge only; the record started again.
    expect(filesHolding(h, personal)).toEqual([]);
    const copies = await s.restore.copiesOnPhone();
    expect(copies.map((c) => c.reason)).toEqual(['after_delete']);
    expect(copies[0]).toMatchObject({ finishedWorkouts: 0, loggedSets: 0 });
    expect([...h.backupFiles.keys()]).toEqual([copies[0]?.fileName]);
    const status = await s.backups.getStatus();
    expect(status.trialRunDoneAtUtc).toBeNull();
    expect(status.offPhone.lastCopy).toBeNull();

    // Relaunch: first run (no profile), nothing to resume.
    await h.forceClose();
    const relaunched = await h.launch();
    expect(relaunched.personalDataCleared).toBe(false);
    expect(relaunched.setup.profile).toBeNull();
    expect(relaunched.setup.step).toBe('welcome');
    expect(filesHolding(h, personal)).toEqual([]);
  });

  it('leaves no file of Ben’s anywhere in the container: settings, crash notes, probe database, picked-file copies, caches, old database files (review r2 B1, S4)', async () => {
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: fakeKeychain().port });
    const { services: s } = await h.launch();
    const { personal } = await bensData(s);
    const [ownerId] = personal;
    // Files outside SQLite, as the phone keeps them (Root's list, via createPersonalFiles).
    h.documents.set('device-prefs.json', `{"themeDirection":"d1","owner":"${ownerId ?? ''}"}`);
    h.documents.set('device-prefs.json.tmp', '{"owner":"Main Gym"}');
    h.documents.set('coach-connection.json', '{"model":"gpt","note":"Main Gym"}');
    h.documents.set('last-error.json', '{"message":"Slept badly"}');
    h.documents.set('guide-open.json', '{"gym":"Main Gym"}');
    h.documents.set('backup-state.damaged-2026-10-08T17-00-00-000Z.json', '{"label":"Main Gym"}');
    // A FitNotes CSV and a backup picked from Files: iOS copies both into tmp/<bundle>-Inbox (B1).
    const backupText = [...h.backupFiles.values()][0] ?? '';
    expect(backupText).toContain('Main Gym');
    h.tmp.set('com.bendunlop.fizz-Inbox/FitNotes_Export.csv', 'Date,Exercise,Category,Weight,Reps\n2026-10-01,Bench press,Chest,60,8,Slept badly');
    h.tmp.set('com.bendunlop.fizz-Inbox/fizz-backup-2026-10-08.json', backupText);
    h.cache.set('com.bendunlop.fizz/Cache.db', 'Main Gym');
    // The capability probe's database.
    writeFileSync(join(h.dir, 'fizz-probe.db'), 'Main Gym');
    writeFileSync(join(h.dir, 'fizz-probe.db-wal'), 'Slept badly');
    const holding = filesHolding(h, personal);
    for (const f of ['tmp/com.bendunlop.fizz-Inbox/FitNotes_Export.csv', 'tmp/com.bendunlop.fizz-Inbox/fizz-backup-2026-10-08.json', 'SQLite/fizz-probe.db', 'device-prefs.json']) expect(holding).toContain(f);
    expect(holding.some((f) => /^SQLite\/training-/.test(f))).toBe(true);

    const { stamp } = await s.data.summary();
    expect(await s.data.deleteMyData({ opId: 'everything', stamp })).toMatchObject({ ok: true });
    expect(filesHolding(h, personal)).toEqual([]);
    expect([...h.documents.keys()]).toEqual([]);
    expect(h.tmp.size).toBe(0);
    expect(h.cache.size).toBe(0);
    // One training database (the new, knowledge-only one) and the slot record; no old file, no probe.
    expect(readdirSync(h.dir).filter((n) => n.endsWith('.db'))).toEqual(['fizz-meta.db', s.developer.databaseNames().current].sort());
  });

  it('a rest alert scheduled before a relaunch is cancelled by a delete finished at launch (review r2 S1)', async () => {
    h = createHarness();
    const { services: s } = await h.launch();
    const { gymId } = await bensData(s);
    await workoutWithRestRunning(s, gymId);
    await h.settle(s);
    expect(h.pending.size).toBe(1);
    // The phone refuses to cancel: the step fails, and says so, after the swap.
    h.alertsFail = true;
    const { stamp } = await s.data.summary();
    expect(await s.data.deleteMyData({ opId: 'with-rest', stamp })).toMatchObject({ ok: false, deleted: true, step: 'alerts' });
    expect(h.pending.size).toBe(1);
    // Force-close; the next run knows nothing about what was scheduled.
    await h.forceClose();
    h.alertsFail = false;
    const relaunched = await h.launch();
    expect(relaunched.personalDataCleared).toBe(true);
    expect(relaunched.setup.step).toBe('welcome');
    expect(h.pending.size).toBe(0);
  });

  it('Continue after a backups failure leaves a Finish deleting that removes only the old backups (review r2 S2)', async () => {
    const keychain = fakeKeychain();
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port });
    const { services: s } = await h.launch();
    const { personal } = await bensData(s);
    expect((await s.backups.backUpOnPhone('manual')).ok).toBe(true);
    const old = [...h.backupFiles.keys()];
    expect(old.length).toBeGreaterThan(0);
    // Backup files can't be deleted, at this run and the next.
    const realDelete = h.backupFiles.delete.bind(h.backupFiles);
    h.backupFiles.delete = () => false;
    const { stamp } = await s.data.summary();
    expect(await s.data.deleteMyData({ opId: 'stuck-backups', stamp })).toMatchObject({ ok: false, deleted: true, step: 'backups' });
    await h.forceClose();
    expect(await h.start()).toMatchObject({ kind: 'delete_unfinished', deleted: true, step: 'backups' });

    // Continue: first run. Ben sets up and logs a workout; it is backed up.
    h.clockMs += 3_600_000;
    const opened = await h.start({ interruptedDelete: 'leave' });
    if (opened.kind !== 'ready') throw new Error(opened.kind);
    const s2 = opened.services;
    expect(await s2.data.leftover()).toEqual({ step: 'backups', steps: ['backups'], atUtc: h.now().utc });
    // The sign-in went first, before the stuck backups (review r3 B1).
    expect(keychain.items.size).toBe(0);
    // Ben signs in to ChatGPT again: Finish deleting leaves that alone (review r3 N1).
    keychain.items.set('fizz.chatgpt.tokens', '{"v":2}');
    const signOuts = keychain.calls.filter((c) => c === 'signOut').length;
    const gymId = await setUpGym(h, s2);
    h.clockMs += 60_000;
    await logWorkout(h, s2, gymId, [{ exercise: 'Bench press', sets: [{ load: 40, reps: 5 }] }]);
    const fresh = (await s2.restore.copiesOnPhone()).map((c) => c.fileName).filter((n) => !old.includes(n));
    expect(fresh.length).toBeGreaterThan(0);
    // Old backups are still on this phone.
    const oldOnly = personal.filter((p) => !['Main Gym', personal[0]].includes(p));
    expect(filesHolding(h, oldOnly).length).toBeGreaterThan(0);

    // What the fresh backups hold now: Finish deleting must leave these very files, not remake them (review r4 N3).
    const freshText = new Map(fresh.map((n) => [n, h.backupFiles.get(n)]));
    const freshCopies = (await s2.restore.copiesOnPhone()).filter((c) => fresh.includes(c.fileName));
    // A later clock, so a backup remade by Finish deleting would get a new name and reason.
    h.clockMs += 3_600_000;

    // Finish deleting while files still can't go: says so, keeps the line.
    expect(await s2.data.finishLeftover()).toEqual({ ok: false, step: 'backups', message: expect.stringMatching(/couldn’t be deleted/) as string });
    expect(await s2.data.leftover()).toMatchObject({ step: 'backups' });

    h.backupFiles.delete = realDelete;
    expect(await s2.data.finishLeftover()).toEqual({ ok: true });
    expect(await s2.data.leftover()).toBeNull();
    // Nothing of the old data is left; what Ben logged since, and its backups, are kept.
    expect(filesHolding(h, oldOnly)).toEqual([]);
    for (const n of old) expect(h.backupFiles.has(n)).toBe(false);
    for (const n of fresh) expect(h.backupFiles.get(n)).toBe(freshText.get(n));
    expect((await s2.restore.copiesOnPhone()).map((c) => c.fileName)).toEqual(fresh);
    expect((await s2.restore.copiesOnPhone()).filter((c) => fresh.includes(c.fileName))).toEqual(freshCopies);
    expect((await s2.yourData.counts()).finishedWorkouts).toBe(1);
    expect([...keychain.items.keys()]).toEqual(['fizz.chatgpt.tokens']);
    expect(keychain.calls.filter((c) => c === 'signOut')).toHaveLength(signOuts);
    // A repeat is a no-op.
    expect(await s2.data.finishLeftover()).toEqual({ ok: true });
  });

  it('Continue after the old database file wouldn’t go: Finish deleting removes it, never swaps again (review r2 S2)', async () => {
    h = createHarness();
    const { services: s } = await h.launch();
    const { personal } = await bensData(s);
    h.failDbRemove = true;
    const { stamp } = await s.data.summary();
    expect(await s.data.deleteMyData({ opId: 'stuck-db', stamp })).toMatchObject({ ok: false, deleted: true, step: 'database' });
    expect(filesHolding(h, personal).some((f) => f.startsWith('SQLite/training-'))).toBe(true);
    await h.forceClose();
    expect(await h.start()).toMatchObject({ kind: 'delete_unfinished', deleted: true, step: 'database' });
    const opened = await h.start({ interruptedDelete: 'leave' });
    if (opened.kind !== 'ready') throw new Error(opened.kind);
    const s2 = opened.services;
    expect(await s2.data.leftover()).toMatchObject({ step: 'database' });
    const gymId = await setUpGym(h, s2);
    await logWorkout(h, s2, gymId, [{ exercise: 'Bench press', sets: [{ load: 40, reps: 5 }] }]);

    h.failDbRemove = false;
    expect(await s2.data.finishLeftover()).toEqual({ ok: true });
    const oldOnly = personal.filter((p) => !['Main Gym', personal[0]].includes(p));
    expect(filesHolding(h, oldOnly)).toEqual([]);
    expect(readdirSync(h.dir).filter((n) => n.startsWith('training-') && n.endsWith('.db'))).toEqual([s2.developer.databaseNames().current]);
    // The new workout is untouched.
    expect((await s2.yourData.counts()).finishedWorkouts).toBe(1);
  });

  it('a settings-files step that always fails never keeps the ChatGPT sign-in on the phone (review r3 B1)', async () => {
    const keychain = fakeKeychain();
    const stuckFiles: PersonalFilesPort = { remove: () => Promise.reject(new Error('Couldn’t delete Cache.db')) };
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port, personalFiles: stuckFiles });
    const { services: s } = await h.launch();
    const { personal } = await bensData(s);
    await workoutWithRestRunning(s, (await s.yourData.currentGym())?.id ?? '');
    await h.settle(s);
    const { stamp } = await s.data.summary();
    expect(await s.data.deleteMyData({ opId: 'stuck-files', stamp })).toEqual({ ok: false, reason: 'failed', message: 'Couldn’t delete Cache.db', deleted: true, step: 'settings_files' });
    // Every other step still ran.
    expect(keychain.items.size).toBe(0);
    expect(h.pending.size).toBe(0);
    expect((await s.restore.copiesOnPhone()).map((c) => c.reason)).toEqual(['after_delete']);
    expect(filesHolding(h, personal)).toEqual([]);

    await h.forceClose();
    expect(await h.start()).toMatchObject({ kind: 'delete_unfinished', deleted: true, step: 'settings_files' });
    const opened = await h.start({ interruptedDelete: 'leave' });
    if (opened.kind !== 'ready') throw new Error(opened.kind);
    expect(await opened.services.data.leftover()).toMatchObject({ step: 'settings_files', steps: ['settings_files'] });
    expect(await opened.services.data.finishLeftover()).toMatchObject({ ok: false, step: 'settings_files' });
    expect(keychain.items.size).toBe(0);
  });

  it('Finish deleting keeps going after a failed step: alerts stuck, settings files still removed (review r4 N2)', async () => {
    let filesStuck = true;
    let removed = 0;
    const files: PersonalFilesPort = {
      remove() {
        if (filesStuck) return Promise.reject(new Error('Couldn’t delete device-prefs.json'));
        removed += 1;
        return Promise.resolve();
      },
    };
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: fakeKeychain().port, personalFiles: files });
    const { services: s } = await h.launch();
    await bensData(s);
    h.alertsFail = true;
    expect(await s.data.deleteMyData({ opId: 'two-stuck', stamp: (await s.data.summary()).stamp })).toMatchObject({ ok: false, deleted: true, step: 'alerts' });
    await h.forceClose();
    const opened = await h.start({ interruptedDelete: 'leave' });
    if (opened.kind !== 'ready') throw new Error(opened.kind);
    const s2 = opened.services;
    expect(await s2.data.leftover()).toMatchObject({ step: 'alerts', steps: ['alerts', 'settings_files'] });

    // Alerts still can't be cancelled; the files now can. The later step runs anyway.
    filesStuck = false;
    expect(await s2.data.finishLeftover()).toMatchObject({ ok: false, step: 'alerts' });
    expect(removed).toBe(1);
    expect(await s2.data.leftover()).toMatchObject({ step: 'alerts', steps: ['alerts'] });

    h.alertsFail = false;
    expect(await s2.data.finishLeftover()).toEqual({ ok: true });
    expect(await s2.data.leftover()).toBeNull();
    // settings_files was done already, so it isn't run again.
    expect(removed).toBe(1);
  });

  it('a later full Delete clears an earlier Continue: no leftover line, nothing for Finish deleting to do (review r3 S1)', async () => {
    const keychain = fakeKeychain();
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port });
    const { services: s } = await h.launch();
    await bensData(s);
    expect((await s.backups.backUpOnPhone('manual')).ok).toBe(true);
    const realDelete = h.backupFiles.delete.bind(h.backupFiles);
    h.backupFiles.delete = () => false;
    expect(await s.data.deleteMyData({ opId: 'first', stamp: (await s.data.summary()).stamp })).toMatchObject({ ok: false, step: 'backups' });
    await h.forceClose();
    const opened = await h.start({ interruptedDelete: 'leave' });
    if (opened.kind !== 'ready') throw new Error(opened.kind);
    const s2 = opened.services;
    expect(await s2.data.leftover()).toMatchObject({ step: 'backups' });
    const gymId = await setUpGym(h, s2);
    await logWorkout(h, s2, gymId, [{ exercise: 'Bench press', sets: [{ load: 40, reps: 5 }] }]);
    await h.settle(s2);
    h.backupFiles.delete = realDelete;
    h.clockMs += 60_000;
    expect(await s2.data.deleteMyData({ opId: 'second', stamp: (await s2.data.summary()).stamp })).toMatchObject({ ok: true, duplicate: false });
    expect(await s2.data.leftover()).toBeNull();
    // Ben sets up again and signs in: Finish deleting isn't offered and would do nothing.
    keychain.items.set('fizz.chatgpt.tokens', '{"v":2}');
    const calls = keychain.calls.length;
    expect(await s2.data.finishLeftover()).toEqual({ ok: true });
    expect(keychain.calls).toHaveLength(calls);
    expect(keychain.items.has('fizz.chatgpt.tokens')).toBe(true);
  });

  it('Finish deleting during a workout keeps its rest alert, cancels the old one, and the workout recovers after the relaunch (review r3 S3, N2)', async () => {
    let failFiles = true;
    const files: PersonalFilesPort = {
      remove() {
        if (failFiles) return Promise.reject(new Error('Couldn’t delete device-prefs.json'));
        h.documents.clear();
        return Promise.resolve();
      },
    };
    h = createHarness('2026-10-08T17:00:00.000Z', { personalFiles: files });
    const { services: s } = await h.launch();
    const { gymId } = await bensData(s);
    await workoutWithRestRunning(s, gymId);
    await h.settle(s);
    const [oldAlert] = [...h.pending.keys()];
    if (oldAlert === undefined) throw new Error('no alert');
    // Alerts and settings files both fail; every other step runs.
    h.alertsFail = true;
    expect(await s.data.deleteMyData({ opId: 'mid', stamp: (await s.data.summary()).stamp })).toMatchObject({ ok: false, deleted: true, step: 'alerts' });
    await h.forceClose();
    expect(await h.start()).toMatchObject({ kind: 'delete_unfinished', step: 'alerts' });
    const opened = await h.start({ interruptedDelete: 'leave' });
    if (opened.kind !== 'ready') throw new Error(opened.kind);
    const s2 = opened.services;
    expect(await s2.data.leftover()).toMatchObject({ step: 'alerts', steps: ['alerts', 'settings_files'] });

    // A new workout with its rest running, and this phone's prefs.
    await workoutWithRestRunning(s2, await setUpGym(h, s2));
    await h.settle(s2);
    const active = await s2.sessions.active();
    if (!active) throw new Error('no workout');
    const newAlert = `fizz.rest.${active.session.id}`;
    expect([...h.pending.keys()].sort()).toEqual([newAlert, oldAlert].sort());
    h.documents.set('device-prefs.json', '{"look":"dark"}');

    h.alertsFail = false;
    failFiles = false;
    expect(await s2.data.finishLeftover()).toEqual({ ok: true });
    expect([...h.pending.keys()]).toEqual([newAlert]);
    expect(await s2.data.leftover()).toBeNull();

    // The screen relaunches: the workout and its alert are recovered.
    await h.forceClose();
    const again = await h.launch();
    const recovered = await again.services.sessions.active();
    expect(recovered?.session.id).toBe(active.session.id);
    expect(recovered?.sets.filter((x) => x.status === 'completed')).toHaveLength(1);
    expect([...h.pending.keys()]).toEqual([newAlert]);
  });

  it('a Continue recorded before the step order changed still finishes every step that never ran (review r3 B1)', async () => {
    let text: string | null = JSON.stringify({
      version: 1,
      pending: null,
      done: [{ opId: 'old', kind: 'delete_my_data', atUtc: '2026-10-08T16:00:00.000Z', signedOutOnline: null, unfinished: 'backups' }],
    });
    h = createHarness('2026-10-08T17:00:00.000Z', {
      ledger: {
        read: () => Promise.resolve(text),
        write: (t) => {
          text = t;
          return Promise.resolve();
        },
      },
    });
    const { services: s } = await h.launch();
    expect(await s.data.leftover()).toEqual({ step: 'coach_sign_in', steps: ['coach_sign_in', 'backups', 'settings_files'], atUtc: '2026-10-08T16:00:00.000Z' });
    expect(await s.data.finishLeftover()).toEqual({ ok: true });
    expect(await s.data.leftover()).toBeNull();
  });

  it('is idempotent by op ID: a repeat returns the first result and leaves one knowledge-only backup', async () => {
    h = createHarness();
    const { services: s } = await h.launch();
    await bensData(s);
    const { stamp } = await s.data.summary();
    const [a, b] = await Promise.all([s.data.deleteMyData({ opId: 'twice', stamp }), s.data.deleteMyData({ opId: 'twice', stamp })]);
    expect(a).toEqual({ ok: true, duplicate: false, signedOutOnline: null });
    expect(b).toEqual({ ok: true, duplicate: true, signedOutOnline: null });
    expect((await s.restore.copiesOnPhone()).map((c) => c.reason)).toEqual(['after_delete']);
  });

  it('refuses a stale confirmation and changes nothing (rule 5)', async () => {
    const keychain = fakeKeychain();
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port });
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { stamp } = await s.data.summary();
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const backups = new Map(h.backupFiles);
    const r = await s.data.deleteMyData({ opId: 'stale', stamp });
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
    expect((await s.yourData.counts()).finishedWorkouts).toBe(1);
    expect(h.backupFiles).toEqual(backups);
    expect(keychain.calls).toEqual([]);
  });

  it('a force-close part-way is finished by the next launch before anything is shown (check 31)', async () => {
    const keychain = fakeKeychain({ failWipe: 'once' });
    const files = fakeFiles();
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port, personalFiles: files.port });
    const { services: s } = await h.launch();
    const { personal } = await bensData(s);
    const { stamp } = await s.data.summary();
    // The app dies while deleting the Keychain items.
    expect(await s.data.deleteMyData({ opId: 'killed', stamp })).toEqual({ ok: false, reason: 'failed', message: 'killed', deleted: true, step: 'coach_sign_in' });
    expect(keychain.items.size).toBeGreaterThan(0);
    await h.forceClose();

    const relaunched = await h.launch();
    expect(relaunched.personalDataCleared).toBe(true);
    expect(relaunched.signOutNotConfirmed).toBe(false);
    expect(relaunched.setup.step).toBe('welcome');
    expect(keychain.items.size).toBe(0);
    expect(files.files.size).toBe(0);
    expect(filesHolding(h, personal)).toEqual([]);
    expect((await relaunched.services.data.summary()).counts.yourData.records).toBe(0);
    // The same op ID now reads as done.
    expect(await relaunched.services.data.deleteMyData({ opId: 'killed', stamp: 'anything' })).toMatchObject({ ok: true, duplicate: true });
  });

  it('a second tap finishes an unfinished delete; both op IDs then read as done (review N3)', async () => {
    const keychain = fakeKeychain({ failWipe: 'once' });
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port });
    const { services: s } = await h.launch();
    await bensData(s);
    const { stamp } = await s.data.summary();
    expect(await s.data.deleteMyData({ opId: 'first', stamp })).toMatchObject({ ok: false, deleted: true });
    expect(await s.data.deleteMyData({ opId: 'second', stamp: 'whatever' })).toEqual({ ok: true, duplicate: false, signedOutOnline: null });
    expect(keychain.items.size).toBe(0);
    expect(await s.data.deleteMyData({ opId: 'first', stamp })).toMatchObject({ ok: true, duplicate: true });
    expect(await s.data.deleteMyData({ opId: 'second', stamp })).toMatchObject({ ok: true, duplicate: true });
  });

  it('a resume that keeps failing says the data is deleted and names the step; Continue opens first run and never deletes again (review S1)', async () => {
    const keychain = fakeKeychain({ failWipe: 'always' });
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port });
    const { services: s } = await h.launch();
    await bensData(s);
    const { stamp } = await s.data.summary();
    expect(await s.data.deleteMyData({ opId: 'stuck', stamp })).toMatchObject({ ok: false, deleted: true, step: 'coach_sign_in' });
    await h.forceClose();

    // Each launch tries again and says what is true.
    expect(await h.start()).toEqual({ kind: 'delete_unfinished', deleted: true, step: 'coach_sign_in', message: 'killed' });
    expect(await h.start()).toMatchObject({ kind: 'delete_unfinished', deleted: true });

    // Continue: the app opens at first run; the marker is gone.
    const opened = await h.start({ interruptedDelete: 'leave' });
    if (opened.kind !== 'ready') throw new Error(opened.kind);
    expect(opened.setup.step).toBe('welcome');
    const gymId = await setUpGym(h, opened.services);
    await logWorkout(h, opened.services, gymId, [{ exercise: 'Bench press', sets: [{ load: 40, reps: 5 }] }]);
    await h.forceClose();
    // A later launch doesn't retry the delete over the new data.
    const later = await h.launch();
    expect((await later.services.yourData.counts()).finishedWorkouts).toBe(1);
    expect(await later.services.data.deleteMyData({ opId: 'stuck', stamp: 'x' })).toMatchObject({ ok: true, duplicate: true });
  });

  it('says when ChatGPT couldn’t be signed out online in time; a late answer writes nothing back (review S3)', async () => {
    const keychain = fakeKeychain({ revokeDelayMs: 200 });
    const files = fakeFiles();
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port, personalFiles: files.port, signOutTimeoutMs: 20 });
    const { services: s } = await h.launch();
    await bensData(s);
    const { stamp } = await s.data.summary();
    const r = await s.data.deleteMyData({ opId: 'slow', stamp });
    expect(r).toEqual({ ok: true, duplicate: false, signedOutOnline: false });
    expect(keychain.items.size).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(keychain.calls).toEqual(['signOut', 'wipe', 'revoked']);
    expect(keychain.items.size).toBe(0);
    expect(files.files.size).toBe(0);
  });

  it('a sign-out that never answers doesn’t hold Delete: the Keychain is still wiped, and the sign-out isn’t confirmed (review r4 N4)', async () => {
    const keychain = fakeKeychain();
    const hung: CredentialPort = { signOut: () => new Promise(() => undefined), wipe: () => keychain.port.wipe() };
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: hung, personalFiles: fakeFiles().port, signOutTimeoutMs: 20 });
    const { services: s } = await h.launch();
    await bensData(s);
    const r = await s.data.deleteMyData({ opId: 'hung', stamp: (await s.data.summary()).stamp });
    expect(r).toEqual({ ok: true, duplicate: false, signedOutOnline: false });
    expect(keychain.items.size).toBe(0);
    expect(await s.data.leftover()).toBeNull();
  });

  it('a sign-out that throws (a Keychain read error) still wipes the Keychain; the outcome names the sign-in, and Finish deleting wipes again (review r5 S2)', async () => {
    const keychain = fakeKeychain({ failWipe: 'once' });
    let signOuts = 0;
    const throwing: CredentialPort = {
      signOut: () => {
        signOuts += 1;
        return Promise.reject(new Error('Keychain item couldn’t be read'));
      },
      wipe: () => keychain.port.wipe(),
    };
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: throwing, personalFiles: fakeFiles().port });
    const { services: s } = await h.launch();
    const { personal } = await bensData(s);
    // The first wipe fails too, so Finish deleting has the step left: both runs must still reach the wipe.
    const r = await s.data.deleteMyData({ opId: 'throws', stamp: (await s.data.summary()).stamp });
    expect(r).toMatchObject({ ok: false, reason: 'failed', deleted: true, step: 'coach_sign_in' });
    expect(keychain.calls).toEqual(['wipe']);
    expect(keychain.items.size).toBe(2);
    expect(filesHolding(h, personal)).toEqual([]);

    await h.forceClose();
    expect(await h.start()).toMatchObject({ kind: 'delete_unfinished', deleted: true, step: 'coach_sign_in' });
    const opened = await h.start({ interruptedDelete: 'leave' });
    if (opened.kind !== 'ready') throw new Error(opened.kind);
    expect(await opened.services.data.leftover()).toMatchObject({ step: 'coach_sign_in' });
    // Finish deleting: the sign-out throws again, the wipe runs anyway and empties the Keychain.
    expect(await opened.services.data.finishLeftover()).toMatchObject({ ok: false, step: 'coach_sign_in' });
    expect(keychain.items.size).toBe(0);
    expect(signOuts).toBeGreaterThanOrEqual(2);
  });

  it('a sign-out that throws on the first try never leaves the Keychain full (review r5 S2)', async () => {
    const keychain = fakeKeychain();
    const throwing: CredentialPort = { signOut: () => Promise.reject(new Error('locked')), wipe: () => keychain.port.wipe() };
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: throwing, personalFiles: fakeFiles().port });
    const { services: s } = await h.launch();
    await bensData(s);
    const r = await s.data.deleteMyData({ opId: 'locked', stamp: (await s.data.summary()).stamp });
    expect(r).toMatchObject({ ok: false, reason: 'failed', deleted: true, step: 'coach_sign_in' });
    expect(keychain.items.size).toBe(0);
    expect(keychain.calls).toEqual(['wipe']);
  });

  it('a delete finished at launch that couldn’t confirm the ChatGPT sign-out online says so on first run (review r2 N4)', async () => {
    const keychain = fakeKeychain({ online: false });
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port });
    const { services: s } = await h.launch();
    await bensData(s);
    // Signed out offline, then the alerts step fails, then force-closed.
    h.alertsFail = true;
    const { stamp } = await s.data.summary();
    expect(await s.data.deleteMyData({ opId: 'offline', stamp })).toMatchObject({ ok: false, deleted: true, step: 'alerts' });
    expect(keychain.items.size).toBe(0);
    await h.forceClose();
    h.alertsFail = false;
    const relaunched = await h.launch();
    expect(relaunched.setup.step).toBe('welcome');
    expect(keychain.items.size).toBe(0);
    expect(relaunched.signOutNotConfirmed).toBe(true);
  });

  it('a damaged ledger is kept aside once Ben confirms, instead of refusing for ever (review N1)', async () => {
    let text: string | null = '{not json';
    const kept: string[] = [];
    h = createHarness('2026-10-08T17:00:00.000Z', {
      ledger: {
        read: () => Promise.resolve(text),
        write: (t) => {
          text = t;
          return Promise.resolve();
        },
        keepDamagedCopy: (suffix) => {
          kept.push(suffix);
          return Promise.resolve(`data-ops.damaged-${suffix}.json`);
        },
      },
    });
    // Launch with a damaged ledger opens as usual.
    const { services: s } = await h.launch();
    await bensData(s);
    const { stamp } = await s.data.summary();
    expect(await s.data.deleteMyData({ opId: 'after-damage', stamp })).toMatchObject({ ok: true });
    expect(kept).toHaveLength(1);
  });
});

describe('Reset coaching knowledge', () => {
  it('puts the bundled knowledge back, keeps exercises Ben’s records use, never changes Your data or credentials, and can be undone (check 31a)', async () => {
    const keychain = fakeKeychain();
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: keychain.port });
    const { services: s } = await h.launch();
    await bensData(s);
    h.clockMs += 86_400_000;
    const mineBefore = tablesOf((await s.data.buildExport('your_data')).text);
    const knownBefore = tablesOf((await s.data.buildExport('coaching_knowledge')).text);
    const backups = h.backupFiles.size;

    const { stamp } = await s.data.summary();
    const r = await s.data.resetCoachingKnowledge({ opId: 'reset-1', stamp });
    expect(r).toEqual({ ok: true, duplicate: false, status: 'switched' });
    expect(tablesOf((await s.data.buildExport('your_data')).text)).toEqual(mineBefore);
    const knownAfter = tablesOf((await s.data.buildExport('coaching_knowledge')).text);
    expect(knownAfter).not.toEqual(knownBefore);
    // Every starter exercise is there.
    const ids = (t: Tables) => (t.exercises ?? []).map((e) => e.id).sort();
    expect(ids(knownAfter)).toEqual(ids(knownBefore));
    expect(keychain.calls).toEqual([]);
    expect(h.backupFiles.size).toBe(backups + 1);
    expect((await s.restore.copiesOnPhone())[0]?.reason).toBe('before_reset');
    // A repeat of the op is a no-op.
    expect(await s.data.resetCoachingKnowledge({ opId: 'reset-1', stamp })).toEqual({ ok: true, duplicate: true, status: 'unchanged' });

    // Undo last reset: the row is offered, and Undo brings the old knowledge back with Your data unchanged.
    const target = s.restore.rollbackTarget();
    expect(target.last?.reason).toBe('reset');
    expect(rollbackRowView(target, { nowMs: h.clockMs, tz: 'Europe/London' })?.title).toBe('Undo last reset');
    expect(await s.restore.undo()).toEqual({ ok: true });
    expect(tablesOf((await s.data.buildExport('coaching_knowledge')).text)).toEqual(knownBefore);
    expect(tablesOf((await s.data.buildExport('your_data')).text)).toEqual(mineBefore);
    expect(rollbackRowView(s.restore.rollbackTarget(), { nowMs: h.clockMs, tz: 'Europe/London' })?.title).toBe('Switch back to the reset coaching knowledge');
  });

  it('is refused while a workout is unfinished (DX4): no backup, nothing changed (review r2 S3)', async () => {
    h = createHarness();
    const { services: s } = await h.launch();
    const { gymId } = await bensData(s);
    await workoutWithRestRunning(s, gymId);
    await h.settle(s);
    const backups = new Map(h.backupFiles);
    const before = await s.data.buildExport('coaching_knowledge');
    const { stamp } = await s.data.summary();
    expect(await s.data.resetCoachingKnowledge({ opId: 'mid-workout', stamp })).toMatchObject({ ok: false, reason: 'workout_unfinished', block: { title: 'Workout' } });
    expect(h.backupFiles).toEqual(backups);
    expect((await s.data.buildExport('coaching_knowledge')).text).toBe(before.text);
    expect(s.restore.rollbackTarget().last).toBeNull();
    // The op isn't recorded as done: after the workout it can still run.
    const active = await s.sessions.active();
    if (!active) throw new Error('no workout');
    const fin = await s.workout.dispatch(active.session.id, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: active.session.version, endedAt: null });
    expect(fin.ok).toBe(true);
    await h.settle(s);
    h.clockMs += 60_000;
    expect(await s.data.resetCoachingKnowledge({ opId: 'mid-workout', stamp: (await s.data.summary()).stamp })).toMatchObject({ ok: true, duplicate: false });
  });

  it('is refused against a stale confirmation, with no backup and nothing changed (rule 5)', async () => {
    h = createHarness();
    const { services: s } = await h.launch();
    const { gymId } = await bensData(s);
    const { stamp } = await s.data.summary();
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 65, reps: 5 }] }]);
    const backups = new Map(h.backupFiles);
    const before = await s.data.buildExport('coaching_knowledge');
    expect(await s.data.resetCoachingKnowledge({ opId: 'stale', stamp })).toMatchObject({ ok: false, reason: 'stale' });
    expect(h.backupFiles).toEqual(backups);
    expect((await s.data.buildExport('coaching_knowledge')).text).toBe(before.text);
    expect(s.restore.rollbackTarget().last).toBeNull();
  });

  it('resets nothing when the backup before it can’t be written', async () => {
    h = createHarness();
    const { services: s } = await h.launch();
    await bensData(s);
    h.clockMs += 86_400_000;
    const { stamp } = await s.data.summary();
    const before = await s.data.buildExport('coaching_knowledge');
    h.backupFiles.set = () => {
      throw new Error('ENOSPC: no space left on device');
    };
    expect(await s.data.resetCoachingKnowledge({ opId: 'full', stamp })).toEqual({ ok: false, reason: 'backup_failed', message: 'This iPhone is out of space.' });
    expect((await s.data.buildExport('coaching_knowledge')).text).toBe(before.text);
    expect((await s.data.summary()).stamp).toBe(stamp);
  });
});

describe('Reset and the copy kept for Undo (review r5 B1, S1)', () => {
  it('Reset → log a workout → Undo last reset keeps the workout; Reset again never deletes it', async () => {
    h = createHarness('2026-10-08T17:00:00.000Z');
    const { services: s } = await h.launch();
    const { gymId } = await bensData(s);
    const knownBefore = tablesOf((await s.data.buildExport('coaching_knowledge')).text);
    h.clockMs += 60_000;
    expect(await s.data.resetCoachingKnowledge({ opId: 'reset-1', stamp: (await s.data.summary()).stamp })).toMatchObject({ ok: true, status: 'switched' });
    h.clockMs += 86_400_000;
    const workout = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 65, reps: 5 }] }]);
    await h.settle(s);
    const mine = tablesOf((await s.data.buildExport('your_data')).text);

    // Undo last reset: only coaching knowledge comes back; the workout stays.
    const target = s.restore.rollbackTarget();
    const row = rollbackRowView(target, { nowMs: h.clockMs, tz: 'Europe/London' });
    expect(row && target.last && rollbackConfirmMessage(row, target.last.reason)).toMatch(/Your data isn’t changed\.$/);
    expect(await s.restore.undo()).toEqual({ ok: true });
    expect(tablesOf((await s.data.buildExport('your_data')).text)).toEqual(mine);
    expect(tablesOf((await s.data.buildExport('coaching_knowledge')).text)).toEqual(knownBefore);
    expect(tablesOf((await s.data.buildExport('your_data')).text).sessions?.some((r) => r.id === workout)).toBe(true);

    // Reset again: nothing only the Undo copy holds, so no warning, and the workout is still here.
    const summary = await s.data.summary();
    expect(summary.keptForUndo).toBeNull();
    expect(resetAlertView(summary, { tz: 'Europe/London' }).message).not.toMatch(/copy kept for Undo/);
    expect(await s.data.resetCoachingKnowledge({ opId: 'reset-2', stamp: summary.stamp })).toMatchObject({ ok: true, status: 'switched' });
    expect(tablesOf((await s.data.buildExport('your_data')).text)).toEqual(mine);
  });

  it('Undo last reset waits for an unfinished workout, as Reset does', async () => {
    h = createHarness('2026-10-08T17:00:00.000Z');
    const { services: s } = await h.launch();
    const { gymId } = await bensData(s);
    expect(await s.data.resetCoachingKnowledge({ opId: 'reset-1', stamp: (await s.data.summary()).stamp })).toMatchObject({ ok: true, status: 'switched' });
    h.clockMs += 60_000;
    await workoutWithRestRunning(s, gymId);
    await h.settle(s);
    expect(await s.restore.undoBlockedBy()).toMatchObject({ title: 'Workout' });
    expect(await s.restore.undo()).toMatchObject({ ok: false, reason: 'workout_unfinished' });
    expect(s.restore.rollbackTarget().last?.reason).toBe('reset');
  });

  it('Restore → Reset: the alert names the workout only the Undo copy holds, and Reset saves that copy as a backup first (scenario B)', async () => {
    h = createHarness('2026-10-08T17:00:00.000Z');
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    await h.settle(s);
    const first = (await s.restore.copiesOnPhone())[0]?.fileName ?? '';
    h.clockMs += 86_400_000;
    const second = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 8 }] }]);
    await h.settle(s);
    const text = await s.restore.readOnPhone(first);
    if (text === null) throw new Error('no backup');
    const checked = await s.restore.prepare(text);
    if (!checked.ok) throw new Error(checked.error.message);
    h.clockMs += 60_000;
    expect(await s.restore.restore(text, checked.preview.stamp)).toMatchObject({ ok: true, status: 'restored' });
    expect((await s.yourData.counts()).finishedWorkouts).toBe(1);

    h.clockMs += 60_000;
    const summary = await s.data.summary();
    expect(summary.keptForUndo).toMatchObject({ workouts: 1, unreadable: false });
    expect(resetAlertView(summary, { tz: 'Europe/London', locale: 'en-GB' }).message).toMatch(
      /The copy kept for Undo \(since Fri 9 Oct\) holds 1 workout that isn’t on this phone\. Reset saves that copy as a backup on this phone, then deletes it\.$/,
    );
    expect(await s.data.resetCoachingKnowledge({ opId: 'reset-b', stamp: summary.stamp })).toMatchObject({ ok: true, status: 'switched' });
    const copies = await s.restore.copiesOnPhone();
    const saved = copies.find((c) => c.reason === 'kept_for_undo');
    expect(saved).toBeDefined();
    expect(copies.some((c) => c.reason === 'before_reset')).toBe(true);
    expect(s.restore.rollbackTarget().last?.reason).toBe('reset');

    // That backup is the only place the second workout is, and it restores.
    const keptText = await s.restore.readOnPhone(saved?.fileName ?? '');
    expect(keptText).toContain(second);
    const p = await s.restore.prepare(keptText ?? '');
    if (!p.ok) throw new Error(p.error.message);
    expect(await s.restore.restore(keptText ?? '', p.preview.stamp)).toMatchObject({ ok: true, status: 'restored' });
    expect((await s.yourData.counts()).finishedWorkouts).toBe(2);
    // Never rotated away: it's kept like a backup Ben saved.
    expect(h.backupFiles.has(saved?.fileName ?? '')).toBe(true);
    expect(saved?.fileName.endsWith('-auto.json')).toBe(false);
  });

  it('Restore → Reset with no room for the copy kept for Undo resets nothing, and Undo last restore stays', async () => {
    h = createHarness('2026-10-08T17:00:00.000Z');
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    await h.settle(s);
    const first = (await s.restore.copiesOnPhone())[0]?.fileName ?? '';
    h.clockMs += 86_400_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 8 }] }]);
    await h.settle(s);
    const text = (await s.restore.readOnPhone(first)) ?? '';
    const checked = await s.restore.prepare(text);
    if (!checked.ok) throw new Error(checked.error.message);
    expect(await s.restore.restore(text, checked.preview.stamp)).toMatchObject({ ok: true });
    const summary = await s.data.summary();
    h.backupFiles.set = () => {
      throw new Error('ENOSPC: no space left on device');
    };
    expect(await s.data.resetCoachingKnowledge({ opId: 'full', stamp: summary.stamp })).toEqual({ ok: false, reason: 'backup_failed', message: 'This iPhone is out of space.' });
    expect(s.restore.rollbackTarget().last?.reason).toBe('restore');
    expect((await s.data.summary()).stamp).toBe(summary.stamp);
  });
});

describe('Reset and Delete with main’s backup rules (fix-backup merge)', () => {
  /** An idle gate the test opens and closes: closed, background backups wait (as behind Finish’s transition). */
  function idleGate() {
    let open = true;
    const waiting: (() => void)[] = [];
    return {
      idle: () => (open ? Promise.resolve() : new Promise<void>((r) => waiting.push(r))),
      close() {
        open = false;
      },
      release() {
        open = true;
        for (const r of waiting.splice(0)) r();
      },
      get waiting() {
        return waiting.length;
      },
    };
  }

  it('Restore → Reset with the UI never idle: the kept_for_undo and before_reset backups still run, and only the phone’s own backup counts as coverage', async () => {
    h = createHarness('2026-10-08T17:00:00.000Z');
    const gate = idleGate();
    const o = await h.start({ idle: gate.idle });
    if (o.kind !== 'ready') throw new Error(o.kind);
    const s = o.services;
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    await h.settle(s);
    const first = (await s.restore.copiesOnPhone())[0]?.fileName ?? '';
    h.clockMs += 86_400_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 8 }] }]);
    await h.settle(s);
    const text = (await s.restore.readOnPhone(first)) ?? '';
    const checked = await s.restore.prepare(text);
    if (!checked.ok) throw new Error(checked.error.message);
    h.clockMs += 60_000;
    expect(await s.restore.restore(text, checked.preview.stamp)).toMatchObject({ ok: true, status: 'restored' });
    await h.settle(s);

    // From here the UI never goes idle: a background backup would wait, Ben’s Reset must not.
    gate.close();
    h.clockMs += 60_000;
    const summary = await s.data.summary();
    expect(summary.keptForUndo).toMatchObject({ workouts: 1 });
    expect(await s.data.resetCoachingKnowledge({ opId: 'reset-idle', stamp: summary.stamp })).toMatchObject({ ok: true, status: 'switched' });
    expect(gate.waiting).toBe(0);

    const copies = await s.restore.copiesOnPhone();
    const kept = copies.find((c) => c.reason === 'kept_for_undo');
    const before = copies.find((c) => c.reason === 'before_reset');
    if (kept === undefined || before === undefined) throw new Error('missing backup');
    // Main’s single-pass hash: the recorded SHA-256 is of the file as written.
    expect(kept.sha256).toBe(sha256Hex(h.backupFiles.get(kept.fileName) ?? ''));
    expect(before.sha256).toBe(sha256Hex(h.backupFiles.get(before.fileName) ?? ''));
    // The kept copy’s digest is of the copy (two workouts), not of the phone (one).
    expect(kept.finishedWorkouts).toBe(2);
    expect(before.finishedWorkouts).toBe(1);
    expect(kept.finishedDigest).not.toBe(before.finishedDigest);
    // `before_reset` matches the phone’s digest; the older `kept_for_undo` one never stands for the phone.
    expect((await s.backups.getStatus()).onPhone).toMatchObject({ state: 'backed_up', lastSuccess: { fileName: before.fileName } });
    expect(await s.backups.ensureBackedUp()).toBeNull();

    gate.release();
  });

  it('Delete my data with the UI never idle: the coaching-knowledge-only backup runs at once and covers the phone', async () => {
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: fakeKeychain().port, personalFiles: fakeFiles().port });
    const gate = idleGate();
    const o = await h.start({ idle: gate.idle });
    if (o.kind !== 'ready') throw new Error(o.kind);
    const s = o.services;
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    await h.settle(s);
    gate.close();
    h.clockMs += 60_000;
    const { stamp } = await s.data.summary();
    expect(await s.data.deleteMyData({ opId: 'delete-idle', stamp })).toMatchObject({ ok: true });
    expect(gate.waiting).toBe(0);
    const copies = await s.restore.copiesOnPhone();
    expect(copies.map((c) => c.reason)).toEqual(['after_delete']);
    expect(copies[0]?.finishedWorkouts).toBe(0);
    expect(copies[0]?.sha256).toBe(sha256Hex(h.backupFiles.get(copies[0]?.fileName ?? '') ?? ''));
    expect((await s.backups.getStatus()).onPhone.state).toBe('backed_up');
    expect(await s.backups.ensureBackedUp()).toBeNull();
    gate.release();
  });
});

describe('with a saved pre-start draft (review r4 B1, S1)', () => {
  it('Data & backup, Export, Reset, Undo last reset and Delete all work; Reset keeps the draft, Delete removes it', async () => {
    h = createHarness('2026-10-08T17:00:00.000Z', { credentials: fakeKeychain().port, personalFiles: fakeFiles().port });
    const { services: s } = await h.launch();
    const { gymId } = await bensData(s);
    h.clockMs += 3_600_000;
    await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] },
      { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }] },
    ]);
    h.clockMs += 86_400_000;
    // Skip today on the overview: one saved draft row.
    const page = await s.overview.load({ target: { kind: 'next' }, gymId });
    const row = page?.view.rows.find((r) => r.name === 'Lateral raise');
    if (!page || !row) throw new Error('no overview');
    const edited = await s.overview.edit({ target: { kind: 'next' }, gymId, expectedDraftVersion: null, opId: 'skip-1', edit: { kind: 'skip', slotKey: row.slotKey } });
    expect(edited).toMatchObject({ ok: true });
    const draftNow = async () => (await s.overview.load({ target: { kind: 'next' }, gymId }))?.draft ?? null;
    const draft = await draftNow();
    expect(draft).not.toBeNull();

    // Data & backup loads; the draft is exported with My data only.
    const summary = await s.data.summary();
    expect(summary.counts.yourData.records).toBeGreaterThan(0);
    expect(tablesOf((await s.data.buildExport('your_data')).text).pre_start_drafts?.map((d) => [d.id, d.status])).toEqual([[draft?.id, 'open']]);
    expect(tablesOf((await s.data.buildExport('coaching_knowledge')).text).pre_start_drafts).toBeUndefined();

    // Reset keeps today's edits exactly as they were, and so does its Undo.
    expect(await s.data.resetCoachingKnowledge({ opId: 'reset-1', stamp: summary.stamp })).toMatchObject({ ok: true });
    expect(await draftNow()).toEqual(draft);
    expect(await s.restore.undo()).toEqual({ ok: true });
    expect(await draftNow()).toEqual(draft);

    // Delete removes it with the rest of Your data.
    const r = await s.data.deleteMyData({ opId: 'delete-1', stamp: (await s.data.summary()).stamp });
    expect(r).toMatchObject({ ok: true, duplicate: false });
    expect((await s.data.summary()).counts.yourData.records).toBe(0);
    expect(tablesOf((await s.data.buildExport('your_data')).text).pre_start_drafts).toBeUndefined();
  });
});

describe('Export', () => {
  it('My data and Coaching knowledge only go to the folder Ben picks; each holds one domain only (check 29a)', async () => {
    h = createHarness();
    const { services: s } = await h.launch();
    const { personal } = await bensData(s);
    const ownerId = personal[0] ?? '';
    const { dest, written } = folder();

    const known = await s.data.saveExportTo(dest, 'coaching_knowledge');
    expect(known).toMatchObject({ ok: true, destinationLabel: 'iCloud Drive › Fizz backups' });
    if (!known.ok) throw new Error('export failed');
    expect(known.fileName).toMatch(/^fizz-coaching-knowledge-2026-10-08-\d{4}\.json$/);
    const knownText = written.get(known.fileName) ?? '';
    expect(JSON.parse(knownText)).toMatchObject({ format: 'fizz-export', section: 'coaching_knowledge' });
    for (const p of personal) expect(knownText).not.toContain(p);
    expect(Object.keys(tablesOf(knownText))).toEqual(['exercises']);

    const mine = await s.data.saveExportTo(dest, 'your_data');
    if (!mine.ok) throw new Error('export failed');
    const mineText = written.get(mine.fileName) ?? '';
    const mineTables = tablesOf(mineText);
    expect(mineTables.profiles?.[0]?.id).toBe(ownerId);
    expect(mineTables.sessions).toHaveLength(1);
    expect(mineTables.exercises).toBeUndefined();
    for (const p of personal) expect(mineText).toContain(p);

    expect(await s.data.saveExportTo(folder(true).dest, 'your_data')).toMatchObject({ ok: false, reason: 'inside_app' });
  });

  it('with no Your data, says Nothing to export and writes no file (§3.5)', async () => {
    h = createHarness();
    const { services: s } = await h.launch();
    const { dest, written } = folder();
    expect(await s.data.saveExportTo(dest, 'your_data')).toEqual({ ok: false, reason: 'empty', message: 'Nothing to export' });
    expect(written.size).toBe(0);
  });
});
