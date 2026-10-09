import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toIso, toMs } from '@fizz/domain';
import { richFinishedSession } from '@fizz/domain/testing';
import { openStore, parseBackup, sha256Hex, type Store } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { ZonedTimestamp } from '@fizz/schemas';

import { createBackupService, type BackupFileStore, type CopyDestination, type TextFile } from '../src/backup/backup-service';
import { backupFileName, emptyManifest, parseManifest, planRotation, type BackupRecord } from '../src/backup/manifest';

const TZ = 'Europe/London';
const APP = { name: 'Fizz', version: '0.1.0', build: '9' };

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
}

class MemoryText implements TextFile {
  text: string | null = null;
  read() {
    return Promise.resolve(this.text);
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
    expect(status.onPhone.line.detail).toBe('The first backup runs after your first workout.');
    expect(status.offPhone.line.text).toBe('No copy off this phone yet');

    await store.repos.sessions.save(richFinishedSession(), null);
    expect((await svc.getStatus()).onPhone.state).toBe('pending');

    const run = await svc.backUpOnPhone('workout_finished');
    if (!run.ok) throw new Error(run.error);
    expect(run.record.fileName).toBe('fizz-backup-2026-10-08-1905-auto.json');
    const text = files.files.get(run.record.fileName) ?? '';
    expect(parseBackup(text).ok).toBe(true);
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
    expect(status.onPhone.line.detail).toBe('This iPhone is out of space. Your workouts are still saved on this phone.');

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

  it('records the trial run without claiming to verify it', async () => {
    const svc = service();
    await svc.markTrialRunDone();
    expect((await svc.getStatus()).trialRunDoneAtUtc).toBe(toIso(clockMs));
    expect(parseManifest(JSON.stringify(emptyManifest())).problem).toBeNull();
  });
});
