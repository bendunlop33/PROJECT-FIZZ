import { afterEach, describe, expect, it } from 'vitest';

import type { CopyDestination } from '../src/backup/backup-service';
import type { CredentialPort, PersonalFilesPort } from '../src/backup/data-domain-service';
import { rollbackRowView } from '../src/backup/restore-view';
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
