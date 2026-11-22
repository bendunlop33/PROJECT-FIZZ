import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  analyseImport,
  buildImportedSession,
  createSessionService,
  DEFAULT_ANSWERS,
  parseFitNotesCsv,
  planImportRows,
  starterExercises,
  toIso,
  toMs,
  type MatchCandidate,
} from '@fizz/domain';
import { idGen, largeHistory, OWNER, profile, richFinishedSession } from '@fizz/domain/testing';
import { openStore, parseBackup, sha256Hex, type Store } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { ImportJob, ZonedTimestamp } from '@fizz/schemas';

import { createBackupService, type BackupFileStore, type CopyDestination, type TextFile } from '../src/backup/backup-service';
import { backupFileName, emptyManifest, parseManifest, planRotation, type BackupRecord } from '../src/backup/manifest';
import { backupKeepView, buildBackupStatus, onPhoneState } from '../src/backup/status';

const TZ = 'Europe/London';
const APP = { name: 'GymSmarter', version: '0.1.0', build: '9' };

class MemoryFiles implements BackupFileStore {
  readonly files = new Map<string, string>();
  failWrite: Error | null = null;
  corruptOnWrite = false;
  write(name: string, text: string) {
    if (this.failWrite) return Promise.reject(this.failWrite);
    this.files.set(name, this.corruptOnWrite ? `${text} ` : text);
    return Promise.resolve();
  }
  read(name: string) {
    return Promise.resolve(this.files.get(name) ?? null);
  }
  remove(name: string) {
    this.files.delete(name);
    return Promise.resolve();
  }
  list() {
    return Promise.resolve([...this.files.keys()]);
  }
}

class MemoryText implements TextFile {
  text: string | null = null;
  failRead: Error | null = null;
  readonly copies = new Map<string, string | null>();
  read() {
    if (this.failRead) return Promise.reject(this.failRead);
    return Promise.resolve(this.text);
  }
  keepDamagedCopy(suffix: string) {
    const name = `backup-state.damaged-${suffix}.json`;
    this.copies.set(name, this.text);
    return Promise.resolve(name);
  }
  write(text: string) {
    this.text = text;
    return Promise.resolve();
  }
}

let store: Store;
let files: MemoryFiles;
let manifest: MemoryText;
let clockMs: number;
const now = (): ZonedTimestamp => ({ utc: toIso(clockMs), tz: TZ });

function service() {
  return createBackupService({ store: () => store, files, manifest, now, app: APP, locale: 'en-GB' });
}

/**
 * A real FitNotes import of two workouts through the import repository
 * (create job, write each workout, finish), as the import service does it.
 * Returns the committed job.
 */
async function importTwoWorkouts(): Promise<ImportJob> {
  const at = now();
  await store.repos.profiles.save(profile(), null);
  const exercises = starterExercises(at.utc);
  for (const e of exercises) await store.repos.exercises.save(e, null);
  const csv = ['Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time', '2026-10-01,Lat pulldown,Back,40,10,,,', '2026-10-03,Lat pulldown,Back,45,8,,,'].join('\n');
  const p = parseFitNotesCsv(csv, '2026-10-08');
  if (!p.ok) throw new Error('not parsed');
  const candidates: MatchCandidate[] = exercises.map((e) => ({
    exerciseId: e.id,
    name: e.name,
    aliases: [],
    catalogueKey: e.catalogueKey ?? null,
    laterality: e.laterality,
    defaultLoadConvention: e.defaultLoadConvention,
    compatibleEquipment: e.compatibleEquipment,
    implements: null,
  }));
  const a = analyseImport(p, { ownerId: OWNER, candidates, aliases: new Map(), appDates: new Set<string>(), importedDates: new Map(), defaultUnit: 'kg' }, DEFAULT_ANSWERS);
  const jobId = '00000000-0000-4000-8000-000000009001';
  const rows = planImportRows(p, a, { jobId, defaultUnit: 'kg' });
  const job: ImportJob = {
    id: jobId,
    ownerId: OWNER,
    version: 1,
    createdAtUtc: at.utc,
    updatedAtUtc: at.utc,
    source: 'fitnotes',
    fileName: 'FitNotes_Export_synthetic.csv',
    checksum: 'a'.repeat(64),
    variant: 'A1-kg',
    header: p.firstLine,
    timezone: TZ,
    startedAt: at,
    operationId: 'commit-1',
    mappingVersion: 1,
    answers: DEFAULT_ANSWERS,
    counts: { rows: a.rowCount, workouts: a.counts.workouts, sets: a.counts.sets, exercises: a.counts.exercises, byResult: { imported: 2, skipped_cardio: 0, skipped_unsupported: 0, skipped_duplicate: 0, skipped_date_exists: 0, skipped_exercise: 0, unreadable: 0 } },
    dateRange: a.dateRange,
    status: 'committing',
    finishedAt: null,
    revert: null,
  };
  const lat = candidates.find((c) => c.name === 'Lat pulldown')?.exerciseId ?? '';
  const created = await store.repos.imports.createJob(job, rows, { exercises: [], aliases: [{ name: 'Lat pulldown', nameKey: 'lat pulldown', target: { kind: 'exercise', exerciseId: lat } }], at, newId: idGen(50_000) });
  if (!created.ok) throw new Error(created.error);
  for (const date of ['2026-10-01', '2026-10-03']) {
    const written = await store.repos.imports.commitWorkout(jobId, buildImportedSession({ ownerId: OWNER, jobId, operationId: job.operationId, tz: TZ, gymId: null, importedAtUtc: at.utc, date, rows }));
    if (written !== 'written') throw new Error(written);
  }
  const done = await store.repos.imports.finishJob(jobId, 1, at);
  if (!done.ok) throw new Error(done.error);
  return done.job;
}

beforeEach(async () => {
  store = await openStore(openNodeDriver(':memory:'));
  files = new MemoryFiles();
  manifest = new MemoryText();
  clockMs = toMs('2026-10-08T18:05:00.000Z');
});
afterEach(async () => {
  await store.close();
});

describe('file names and rotation plan', () => {
  it('uses local time, marks automatic files and avoids clashes', () => {
    const ms = toMs('2026-10-08T18:05:00.000Z');
    expect(backupFileName(ms, TZ, 'automatic', new Set())).toBe('fizz-backup-2026-10-08-1905-auto.json');
    expect(backupFileName(ms, 'Pacific/Auckland', 'manual', new Set())).toBe('fizz-backup-2026-10-09-0705.json');
    expect(backupFileName(ms, TZ, 'automatic', new Set(['fizz-backup-2026-10-08-1905-auto.json']))).toBe('fizz-backup-2026-10-08-1905-2-auto.json');
  });

  it('only ever plans to delete the oldest automatic files beyond keep', () => {
    const rec = (n: number, kind: BackupRecord['kind'], fileName = `fizz-backup-2026-10-${String(10 + n)}-1200${kind === 'automatic' ? '-auto' : ''}.json`): BackupRecord => ({
      fileName,
      kind,
      reason: kind === 'automatic' ? 'workout_finished' : 'manual',
      createdAtUtc: `2026-10-${String(10 + n)}T12:00:00.000Z`,
      tz: TZ,
      sha256: '0'.repeat(64),
      textLength: 1,
      finishedWorkouts: n,
      loggedSets: 0,
      exercises: 0,
      integrityOk: true,
      integrityIssues: 0,
    });
    const list = [rec(1, 'automatic'), rec(2, 'manual'), rec(3, 'automatic'), rec(4, 'automatic'), rec(5, 'automatic', 'not-ours.json')];
    expect(planRotation(list, 2, 'x').map((r) => r.fileName)).toEqual(['fizz-backup-2026-10-11-1200-auto.json']);
  });

  it('never deletes the newest backup that passed its integrity check (review B2, SP2)', () => {
    const rec = (day: number, integrityOk: boolean): BackupRecord => ({
      fileName: `fizz-backup-2026-11-${String(day).padStart(2, '0')}-1200-auto.json`,
      kind: 'automatic',
      reason: 'workout_finished',
      createdAtUtc: `2026-11-${String(day).padStart(2, '0')}T12:00:00.000Z`,
      tz: TZ,
      sha256: '0'.repeat(64),
      textLength: 1,
      finishedWorkouts: day,
      loggedSets: 0,
      exercises: 0,
      integrityOk,
      integrityIssues: integrityOk ? 0 : 1,
    });
    // One good backup, then 15 damaged ones (e.g. a schema tightened in a later build).
    const list = [rec(1, true), ...Array.from({ length: 15 }, (_, i) => rec(i + 2, false))];
    const doomed = planRotation(list, 14, rec(16, false).fileName).map((r) => r.fileName);
    expect(doomed).not.toContain(rec(1, true).fileName);
    expect(doomed).toEqual([rec(2, false).fileName]);
    // Once a newer good backup exists, the old good one rotates normally.
    const healed = [...list, rec(17, true)];
    expect(planRotation(healed, 14, rec(17, true).fileName).map((r) => r.fileName)).toEqual([rec(3, false).fileName, rec(2, false).fileName, rec(1, true).fileName]);
  });
});

describe('backup service', () => {
  it('starts at "Saved on this phone", then backs up after a finished workout', async () => {
    const svc = service();
    let status = await svc.getStatus();
    expect(status.onPhone.state).toBe('nothing_yet');
    expect(status.onPhone.line.text).toBe('Saved on this phone');
    expect(status.onPhone.line.detail).toBeNull();
    expect(status.offPhone.line.text).toBe('No copy off this phone yet');

    await store.repos.sessions.save(richFinishedSession(), null);
    expect((await svc.getStatus()).onPhone.state).toBe('pending');

    const run = await svc.backUpOnPhone('workout_finished');
    if (!run.ok) throw new Error(run.error);
    expect(run.record.fileName).toBe('fizz-backup-2026-10-08-1905-auto.json');
    const text = files.files.get(run.record.fileName) ?? '';
    expect((await parseBackup(text)).ok).toBe(true);
    expect(run.record.sha256).toBe(sha256Hex(text));
    expect(run.record.finishedWorkouts).toBe(1);

    status = await svc.getStatus();
    expect(status.onPhone.state).toBe('backed_up');
    expect(status.onPhone.line.text).toBe('Backed up on this phone · 19:05');
    clockMs += 24 * 3600_000;
    expect((await svc.getStatus()).onPhone.line.text).toBe('Backed up on this phone · Thu 8 Oct, 19:05');
  });

  it('keeps the last 14 automatic files, deleting only after the new one is checked', async () => {
    const svc = service();
    files.files.set('my-own-copy.json', 'Ben saved this');
    const manual = await svc.backUpOnPhone('manual');
    expect(manual.ok).toBe(true);
    const names: string[] = [];
    for (let i = 0; i < 16; i += 1) {
      clockMs += 60_000;
      const run = await svc.backUpOnPhone('workout_finished');
      if (!run.ok) throw new Error(run.error);
      names.push(run.record.fileName);
    }
    const auto = [...files.files.keys()].filter((n) => n.endsWith('-auto.json')).sort();
    expect(auto).toEqual(names.slice(2).sort());
    expect(files.files.has('my-own-copy.json')).toBe(true);
    expect(manual.ok && files.files.has(manual.record.fileName)).toBe(true);
    expect(parseManifest(manifest.text).manifest.onPhone.files).toHaveLength(15);
  });

  it('Keep 7 / All copies (DX9): applies at the next backup, never deletes on its own, All keeps every copy', async () => {
    const svc = service();
    for (let i = 0; i < 10; i += 1) {
      clockMs += 60_000;
      await svc.backUpOnPhone('workout_finished');
    }
    const autos = () => [...files.files.keys()].filter((n) => n.endsWith('-auto.json'));
    expect(autos()).toHaveLength(10);
    expect(await svc.setKeep(7)).toBe(true);
    // Changing the setting deletes nothing by itself.
    expect(autos()).toHaveLength(10);
    expect((await svc.getStatus()).keep).toBe(7);
    clockMs += 60_000;
    await svc.backUpOnPhone('workout_finished');
    expect(autos()).toHaveLength(7);
    expect(await svc.setKeep(null)).toBe(true);
    for (let i = 0; i < 20; i += 1) {
      clockMs += 60_000;
      await svc.backUpOnPhone('workout_finished');
    }
    expect(autos()).toHaveLength(27);
    expect(parseManifest(manifest.text).manifest.keep).toBeNull();
    expect(await svc.setKeep(0)).toBe(false);
  });

  it('says every workout is kept and each copy is a full backup (Ben, 11 Oct)', () => {
    const v = backupKeepView(14);
    expect(v.subtitle).toBe('On · keeps the last 14 copies');
    expect(v.line).toBe('Every workout is kept. Each copy is a full backup of all of them.');
    expect(v.choices.map((c) => [c.label, c.selected])).toEqual([['7', false], ['14', true], ['30', false], ['All', false]]);
    expect(backupKeepView(null).subtitle).toBe('On · keeps every copy');
    // A manifest saved before the setting existed (keep 14) still reads; the default is 14.
    expect(parseManifest(JSON.stringify({ ...emptyManifest(), keep: 14 })).manifest.keep).toBe(14);
    expect(buildBackupStatus(emptyManifest(), { finishedWorkouts: 0, backingUp: false, nowMs: 0, tz: TZ }).keep).toBe(14);
    expect(planRotation([], null, 'x')).toEqual([]);
  });

  it('never deletes a file whose content no longer matches what Fizz wrote', async () => {
    const svc = service();
    const first = await svc.backUpOnPhone('workout_finished');
    if (!first.ok) throw new Error(first.error);
    files.files.set(first.record.fileName, 'changed by someone else');
    for (let i = 0; i < 14; i += 1) {
      clockMs += 60_000;
      await svc.backUpOnPhone('workout_finished');
    }
    expect(files.files.get(first.record.fileName)).toBe('changed by someone else');
  });

  it('records a failed write honestly, and recovers on the next success', async () => {
    const svc = service();
    await store.repos.sessions.save(richFinishedSession(), null);
    files.failWrite = new Error('ENOSPC: no space left on device');
    const run = await svc.backUpOnPhone('workout_finished');
    expect(run).toEqual({ ok: false, error: 'This iPhone is out of space.' });
    let status = await svc.getStatus();
    expect(status.onPhone.state).toBe('failed');
    expect(status.onPhone.line.text).toBe('Last backup on this phone didn’t save');
    expect(status.onPhone.line.detail).toBe('This iPhone is out of space.');

    files.failWrite = null;
    clockMs += 60_000;
    expect((await svc.backUpOnPhone('manual')).ok).toBe(true);
    status = await svc.getStatus();
    expect(status.onPhone.state).toBe('backed_up');
  });

  it('treats a file that reads back differently as a failed backup', async () => {
    const svc = service();
    files.corruptOnWrite = true;
    const run = await svc.backUpOnPhone('manual');
    expect(run.ok).toBe(false);
    expect((await svc.getStatus()).onPhone.state).toBe('failed');
  });

  it('catches up at launch when a finished workout is not in the newest backup', async () => {
    const svc = service();
    expect(await svc.ensureBackedUp()).toBeNull();
    await store.repos.sessions.save(richFinishedSession(), null);
    const run = await svc.ensureBackedUp();
    expect(run?.ok && run.record.reason).toBe('catch_up');
    expect(await svc.ensureBackedUp()).toBeNull();
  });

  it('after Undo import, an interrupted after-Finish backup is pending and caught up at launch (B2)', async () => {
    const svc = service();
    // A real 2-workout FitNotes import; the after_import backup holds them.
    const job = await importTwoWorkouts();
    expect((await store.countRecords()).finishedWorkouts).toBe(2);
    expect((await svc.backUpOnPhone('after_import')).ok).toBe(true);
    // Undo import through the real path (`revertImport`): its workouts become `reverted`.
    const undo = await store.repos.imports.revertJob(job.id, job.version, 'undo-1', now());
    expect(undo).toMatchObject({ ok: true, workouts: 2 });
    expect((await store.countRecords()).finishedWorkouts).toBe(0);
    // One workout finishes, but iOS ends the app before its backup runs.
    clockMs += 3_600_000;
    await store.repos.sessions.save(richFinishedSession(), null);
    expect((await svc.getStatus()).onPhone.state).toBe('pending');
    expect((await svc.getStatus()).onPhone.line.text).toBe('Saved on this phone');
    const run = await svc.ensureBackedUp();
    expect(run?.ok && run.record.reason).toBe('catch_up');
    expect((await svc.getStatus()).onPhone.state).toBe('backed_up');
    expect(await svc.ensureBackedUp()).toBeNull();
  });

  it('a correction to a finished workout after its backup is pending and caught up (S1)', async () => {
    const svc = service();
    const workout = richFinishedSession();
    await store.repos.sessions.save(workout, null);
    expect((await svc.backUpOnPhone('workout_finished')).ok).toBe(true);
    expect((await svc.getStatus()).onPhone.state).toBe('backed_up');
    // That evening Ben corrects a set in History: same workouts, new content.
    const sessions = createSessionService(store.repos, idGen(90_000));
    const set = workout.sets.find((x) => x.status === 'completed');
    if (!set) throw new Error('fixture');
    clockMs += 3_600_000;
    const fixed = await sessions.dispatch(workout.session.id, {
      type: 'correct_set',
      at: now(),
      opId: 'fix-after-backup',
      setId: set.id,
      expectedSetVersion: set.version,
      patch: { load: { value: 17.5, unit: 'kg', convention: 'per_hand' } },
    });
    expect(fixed.ok).toBe(true);
    expect((await store.countRecords()).finishedWorkouts).toBe(1);
    expect((await svc.getStatus()).onPhone.state).toBe('pending');
    const run = await svc.ensureBackedUp();
    expect(run?.ok && run.record.reason).toBe('catch_up');
    // The new file holds the corrected load.
    const newest = run?.ok ? files.files.get(run.record.fileName) : undefined;
    const parsed = await parseBackup(newest ?? '');
    if (!parsed.ok) throw new Error(parsed.error.message);
    const row = parsed.file.tables.session_sets?.find((r) => r.id === set.id);
    expect(row?.actual_load_value).toBe(17.5);
    expect((await svc.getStatus()).onPhone.state).toBe('backed_up');
    expect(await svc.ensureBackedUp()).toBeNull();
  });

  it('after restoring a smaller backup, an interrupted after-Finish backup is pending and caught up (B2)', async () => {
    const svc = service();
    for (const s of largeHistory({ weeks: 1, perWeek: 3 })) await store.repos.sessions.save(s, null);
    expect((await svc.backUpOnPhone('workout_finished')).ok).toBe(true);
    // Restore an older backup holding one of those workouts: the services now read the
    // restored database, and the manifest is deliberately not rewound.
    const [first] = largeHistory({ weeks: 1, perWeek: 3 });
    const before = store;
    store = await openStore(openNodeDriver(':memory:'));
    await before.close();
    if (first) await store.repos.sessions.save(first, null);
    clockMs += 3_600_000;
    await store.repos.sessions.save(richFinishedSession(), null);
    expect((await store.countRecords()).finishedWorkouts).toBe(2);
    expect((await svc.getStatus()).onPhone.state).toBe('pending');
    expect((await svc.ensureBackedUp())?.ok).toBe(true);
    expect((await svc.getStatus()).onPhone.state).toBe('backed_up');
  });

  it('a record from before the digest falls back to the count (B2)', () => {
    const rec: BackupRecord = {
      fileName: 'fizz-backup-2026-10-08-1905-auto.json',
      kind: 'automatic',
      reason: 'workout_finished',
      createdAtUtc: '2026-10-08T18:05:00.000Z',
      tz: TZ,
      sha256: '0'.repeat(64),
      textLength: 1,
      finishedWorkouts: 3,
      loggedSets: 0,
      exercises: 0,
      integrityOk: true,
      integrityIssues: 0,
    };
    const m = { ...emptyManifest(), onPhone: { files: [rec], lastAttempt: null } };
    expect(parseManifest(JSON.stringify(m)).problem).toBeNull();
    expect(onPhoneState(m, { finishedWorkouts: 3, finishedDigest: 'a'.repeat(64), backingUp: false })).toBe('backed_up');
    expect(onPhoneState(m, { finishedWorkouts: 4, backingUp: false })).toBe('pending');
    const withDigest = { ...m, onPhone: { files: [{ ...rec, finishedDigest: 'b'.repeat(64) }], lastAttempt: null } };
    expect(onPhoneState(withDigest, { finishedWorkouts: 1, finishedDigest: 'a'.repeat(64), backingUp: false })).toBe('pending');
    expect(onPhoneState(withDigest, { finishedWorkouts: 1, finishedDigest: 'b'.repeat(64), backingUp: false })).toBe('backed_up');
  });

  it('queues runs one at a time and reports "Backing up…" meanwhile', async () => {
    const svc = service();
    const a = svc.backUpOnPhone('manual');
    expect(svc.isRunning).toBe(true);
    expect((await svc.getStatus()).onPhone.line.text).toBe('Backing up…');
    const b = svc.backUpOnPhone('manual');
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.ok && rb.ok && ra.record.fileName !== rb.record.fileName).toBe(true);
    expect(svc.isRunning).toBe(false);
  });

  it('waits for the UI to be idle before starting, so Finish’s Summary shows first (B1)', async () => {
    let release: () => void = () => undefined;
    const idle = new Promise<void>((r) => {
      release = r;
    });
    const svc = createBackupService({ store: () => store, files, manifest, now, app: APP, locale: 'en-GB', idle: () => idle });
    await store.repos.sessions.save(richFinishedSession(), null);
    const run = svc.backUpOnPhone('workout_finished');
    await new Promise((r) => setTimeout(r, 20));
    expect(svc.isRunning).toBe(true);
    expect(files.files.size).toBe(0);
    release();
    expect((await run).ok).toBe(true);
    expect(files.files.size).toBe(1);
  });

  it('runs Ben started don’t wait for idle (N4)', async () => {
    const never = new Promise<void>(() => undefined);
    const svc = createBackupService({ store: () => store, files, manifest, now, app: APP, locale: 'en-GB', idle: () => never });
    expect((await svc.backUpOnPhone('manual')).ok).toBe(true);
    clockMs += 60_000;
    expect((await svc.backUpOnPhone('before_import')).ok).toBe(true);
    expect(files.files.size).toBe(2);
  });

  it('saves a copy to Files, refuses a folder inside Fizz, and reminds after 30 days', async () => {
    const svc = service();
    const folder = new Map<string, string>();
    const dest = (insideApp: boolean): CopyDestination => ({
      label: 'iCloud Drive › Fizz backups',
      insideApp,
      write: (n, t) => {
        folder.set(n, t);
        return Promise.resolve();
      },
      read: (n) => Promise.resolve(folder.get(n) ?? null),
    });
    const refused = await svc.saveCopyTo(dest(true));
    expect(refused).toMatchObject({ ok: false, reason: 'inside_app' });
    expect(folder.size).toBe(0);

    const saved = await svc.saveCopyTo(dest(false));
    expect(saved).toEqual({ ok: true, fileName: 'fizz-backup-2026-10-08-1905.json', destinationLabel: 'iCloud Drive › Fizz backups' });
    let status = await svc.getStatus();
    expect(status.offPhone.line.text).toBe('Copy saved to Files · Thu 8 Oct');

    clockMs += 31 * 24 * 3600_000;
    status = await svc.getStatus();
    expect(status.offPhone.state).toBe('reminder');
    expect(status.offPhone.line.text).toBe('No copy off this phone since 8 Oct');
    await svc.dismissOffPhoneReminder();
    expect((await svc.getStatus()).offPhone.state).toBe('saved');
  });

  it('reports a failed copy without touching the record', async () => {
    const svc = service();
    const result = await svc.saveCopyTo({
      label: 'x',
      insideApp: false,
      write: () => Promise.reject(new Error('The folder can’t be reached')),
      read: () => Promise.resolve(null),
    });
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    expect(result.ok || result.message.endsWith('Your data on this phone is fine.')).toBe(true);
    expect((await svc.getStatus()).offPhone.state).toBe('none');
  });

  it('survives a damaged manifest without deleting anything', async () => {
    manifest.text = '{not json';
    files.files.set('fizz-backup-2026-10-01-1200-auto.json', 'older');
    const svc = service();
    const status = await svc.getStatus();
    expect(status.manifestProblem).toMatch(/started again/);
    expect((await svc.backUpOnPhone('manual')).ok).toBe(true);
    expect(files.files.has('fizz-backup-2026-10-01-1200-auto.json')).toBe(true);
  });

  it('keeps a copy of a damaged manifest before starting it again (review S2)', async () => {
    manifest.text = '{not json';
    const svc = service();
    expect((await svc.backUpOnPhone('manual')).ok).toBe(true);
    expect([...manifest.copies.values()]).toEqual(['{not json']);
    expect(parseManifest(manifest.text).problem).toBeNull();
    expect((await svc.getStatus()).manifestProblem).toBeNull();
  });

  it('never overwrites the record after a read error, and deletes nothing (review S2)', async () => {
    const svc = service();
    await svc.markTrialRunDone();
    for (let i = 0; i < 15; i += 1) {
      clockMs += 60_000;
      await svc.backUpOnPhone('workout_finished');
    }
    const before = manifest.text;
    const filesBefore = [...files.files.keys()].sort();
    manifest.failRead = new Error('I/O error');
    clockMs += 60_000;
    const run = await svc.backUpOnPhone('workout_finished');
    expect(run).toMatchObject({ ok: true, deleted: [] });
    expect(manifest.text).toBe(before);
    expect([...files.files.keys()].filter((n) => !filesBefore.includes(n))).toHaveLength(1);
    expect(filesBefore.every((n) => files.files.has(n))).toBe(true);
    const status = await svc.getStatus();
    expect(status.manifestProblem).toMatch(/couldn’t be read/);
    expect(status.trialRunDoneAtUtc).not.toBeNull();
    // Readable again: the record is intact and the next run carries on from it.
    manifest.failRead = null;
    expect((await svc.getStatus()).trialRunDoneAtUtc).not.toBeNull();
  });

  it('never overwrites an existing file with the same name (review S3)', async () => {
    files.files.set('fizz-backup-2026-10-08-1905.json', 'Ben’s own file');
    const svc = service();
    const run = await svc.backUpOnPhone('manual');
    expect(run).toMatchObject({ ok: true, record: { fileName: 'fizz-backup-2026-10-08-1905-2.json' } });
    expect(files.files.get('fizz-backup-2026-10-08-1905.json')).toBe('Ben’s own file');
    const folder = new Map<string, string>([['fizz-backup-2026-10-08-1905.json', 'earlier copy']]);
    const copy = await svc.saveCopyTo({
      label: 'iCloud Drive › Fizz',
      insideApp: false,
      write: (n, t) => {
        folder.set(n, t);
        return Promise.resolve();
      },
      read: (n) => Promise.resolve(folder.get(n) ?? null),
    });
    expect(copy).toMatchObject({ ok: true, fileName: 'fizz-backup-2026-10-08-1905-2.json' });
    expect(folder.get('fizz-backup-2026-10-08-1905.json')).toBe('earlier copy');
  });

  it('records the trial run without claiming to verify it', async () => {
    const svc = service();
    await svc.markTrialRunDone();
    expect((await svc.getStatus()).trialRunDoneAtUtc).toBe(toIso(clockMs));
    expect(parseManifest(JSON.stringify(emptyManifest())).problem).toBeNull();
  });
});

describe('Your-data backup kinds with main’s backup rules (fix-backup merge)', () => {
  it('Reset’s and Delete’s backups don’t wait for idle; background ones still do', async () => {
    const never = new Promise<void>(() => undefined);
    const svc = createBackupService({ store: () => store, files, manifest, now, app: APP, locale: 'en-GB', idle: () => never });
    expect((await svc.backUpOnPhone('kept_for_undo')).ok).toBe(true);
    clockMs += 60_000;
    expect((await svc.backUpOnPhone('before_reset')).ok).toBe(true);
    clockMs += 60_000;
    expect((await svc.wipeOnPhone()).ok).toBe(true);
    expect(files.files.size).toBe(1);
    void svc.backUpOnPhone('catch_up');
    await new Promise((r) => setTimeout(r, 20));
    expect(svc.isRunning).toBe(true);
  });

  it('a kept_for_undo backup of another store records that store’s digest and the file’s hash, and never counts as the phone’s backup', async () => {
    const kept = await openStore(openNodeDriver(':memory:'));
    try {
      await kept.repos.sessions.save(richFinishedSession(), null);
      const svc = service();
      // The phone has no finished workout; its own backup covers that.
      const own = await svc.backUpOnPhone('manual');
      if (!own.ok) throw new Error(own.error);
      clockMs += 60_000;
      const r = await svc.backUpOnPhone('kept_for_undo', { source: kept });
      if (!r.ok) throw new Error(r.error);
      expect(r.record).toMatchObject({ kind: 'manual', finishedWorkouts: 1, finishedDigest: await kept.finishedWorkoutsDigest() });
      expect(r.record.finishedDigest).not.toBe(await store.finishedWorkoutsDigest());
      expect(r.record.sha256).toBe(sha256Hex(files.files.get(r.record.fileName) ?? ''));
      const parsed = await parseBackup(files.files.get(r.record.fileName) ?? '');
      expect(parsed.ok && parsed.file.tables.sessions?.length).toBe(1);

      // Newest file, but of another database: the phone is still backed up by its own, and launch doesn't catch up.
      const status = await svc.getStatus();
      expect(status.onPhone).toMatchObject({ state: 'backed_up', lastSuccess: { fileName: own.record.fileName } });
      expect(status.copiesOnPhone[0]?.fileName).toBe(r.record.fileName);
      expect(await svc.ensureBackedUp()).toBeNull();

      // And with only a kept_for_undo backup, a phone with a finished workout is pending, never "backed up".
      await store.repos.sessions.save(richFinishedSession(), null);
      const onlyKept = { ...emptyManifest(), onPhone: { files: [r.record], lastAttempt: null } };
      expect(onPhoneState(onlyKept, { finishedWorkouts: 1, finishedDigest: await store.finishedWorkoutsDigest(), backingUp: false })).toBe('pending');
    } finally {
      await kept.close();
    }
  });

  it('rotation still keeps the newest restorable backup of the phone when a kept_for_undo backup is newer', () => {
    const rec = (n: number, extra: Partial<BackupRecord> = {}): BackupRecord => ({
      fileName: `fizz-backup-2026-10-${String(n).padStart(2, '0')}-1900-auto.json`,
      kind: 'automatic',
      reason: 'workout_finished',
      createdAtUtc: `2026-10-${String(n).padStart(2, '0')}T18:00:00.000Z`,
      tz: TZ,
      sha256: 'a'.repeat(64),
      textLength: 1,
      finishedWorkouts: 1,
      loggedSets: 1,
      exercises: 1,
      integrityOk: false,
      integrityIssues: 1,
      ...extra,
    });
    const good = rec(1, { integrityOk: true, integrityIssues: 0 });
    const damaged = [2, 3, 4].map((n) => rec(n));
    const keptCopy = rec(5, { fileName: 'fizz-backup-2026-10-05-1900.json', kind: 'manual', reason: 'kept_for_undo', integrityOk: true, integrityIssues: 0 });
    const plan = planRotation([good, ...damaged, keptCopy], 2, damaged[2]?.fileName ?? '');
    expect(plan.map((f) => f.fileName)).not.toContain(good.fileName);
    expect(plan.map((f) => f.fileName)).not.toContain(keptCopy.fileName);
  });
});

describe('wipeOnPhone (Delete my data, check 30)', () => {
  it('deletes every file in the backup folder, recorded or not, starts the record again, then writes one backup', async () => {
    const svc = service();
    await svc.backUpOnPhone('manual');
    clockMs += 60_000;
    await svc.backUpOnPhone('workout_finished');
    await svc.markTrialRunDone();
    files.files.set('fizz-backup-2026-10-01-0900.json', '{"stray":true}');
    expect(files.files.size).toBe(3);

    clockMs += 60_000;
    const r = await svc.wipeOnPhone();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect([...files.files.keys()]).toEqual([r.record.fileName]);
    expect(r.record.reason).toBe('after_delete');
    const status = await svc.getStatus();
    expect(status.copiesOnPhone.map((c) => c.fileName)).toEqual([r.record.fileName]);
    expect(status.trialRunDoneAtUtc).toBeNull();
  });

  it('throws when a file is still there, so Delete names the step and tries again', async () => {
    const svc = service();
    await svc.backUpOnPhone('manual');
    files.remove = () => Promise.resolve();
    await expect(svc.wipeOnPhone()).rejects.toThrow(/couldn’t be deleted/);
  });
});
