import { describe, expect, it } from 'vitest';

import type { DatabaseManager, DomainCounts, DomainSwitchOutcome } from '@fizz/persistence';

import type { BackupService, TextFile } from '../src/backup/backup-service';
import { createDataDomainService } from '../src/backup/data-domain-service';

/**
 * Delete my data when the database swap itself fails (review S1, S5): with
 * Ben's data still there nothing was deleted, the marker is cleared and the
 * app opens as it was; it never claims the data is gone, and never leaves a
 * marker that would brick the launch.
 */

const counts = (records: number): DomainCounts => ({
  yourData: { workouts: 0, sets: 0, gyms: 0, routines: 0, checkIns: 0, painFlags: 0, memories: 0, coachThreads: 0, imports: 0, records },
  coachingKnowledge: { exercises: 1, playbookCandidates: 0, records: 1 },
});

function world(opts: { swap: () => Promise<DomainSwitchOutcome>; records: () => number }) {
  let ledger: string | null = null;
  const file: TextFile = {
    read: () => Promise.resolve(ledger),
    write: (t) => {
      ledger = t;
      return Promise.resolve();
    },
  };
  const wiped: string[] = [];
  const manager = {
    domainSummary: () => Promise.resolve({ counts: counts(opts.records()), stamp: 'stamp' }),
    deleteYourData: () => opts.swap(),
    forgetPrevious: () => Promise.resolve(),
  } as unknown as DatabaseManager;
  const backups = {
    getStatus: () => Promise.resolve({ offPhone: { lastCopy: null } }),
    whenIdle: () => Promise.resolve(),
    wipeOnPhone: () => {
      wiped.push('backups');
      return Promise.resolve({ ok: false, error: 'x' });
    },
  } as unknown as BackupService;
  const svc = createDataDomainService({
    manager,
    backups,
    ledger: file,
    now: () => ({ utc: '2026-10-09T08:00:00.000Z', tz: 'Europe/London' }),
    app: { name: 'GymSmarter', version: '0.1.0', build: 'test' },
    bundledKnowledge: () => [],
  });
  return {
    svc,
    wiped,
    ledger: () => (ledger === null ? null : (JSON.parse(ledger) as { pending: unknown })),
    setLedger: (value: unknown) => {
      ledger = JSON.stringify(value);
    },
  };
}

const failed: DomainSwitchOutcome = { ok: false, error: { code: 'restore_failed', message: 'The file couldn’t be written (ENOSPC).' } };

describe('Delete my data when the swap fails', () => {
  it('before the switch: nothing deleted, no marker, no clean-up run', async () => {
    const w = world({ swap: () => Promise.resolve(failed), records: () => 12 });
    expect(await w.svc.deleteMyData({ opId: 'a', stamp: 'stamp' })).toEqual({ ok: false, reason: 'failed', message: 'The file couldn’t be written (ENOSPC).', deleted: false, step: 'database' });
    expect(w.ledger()?.pending).toBeNull();
    expect(w.wiped).toEqual([]);
    expect(await w.svc.resumeInterrupted()).toEqual({ kind: 'none' });
  });

  it('after the switch (the old file wouldn’t go): deleted, the marker stays, and a resume never swaps again', async () => {
    let swaps = 0;
    const w = world({
      swap: () => {
        swaps += 1;
        return Promise.resolve(failed);
      },
      records: () => 0,
    });
    expect(await w.svc.deleteMyData({ opId: 'a', stamp: 'stamp' })).toMatchObject({ ok: false, deleted: true, step: 'database' });
    expect(w.ledger()?.pending).toMatchObject({ opId: 'a', swapped: true, failedStep: 'database' });
    expect(await w.svc.resumeInterrupted()).toEqual({ kind: 'finished' });
    expect(swaps).toBe(1);
    expect(w.wiped).toEqual(['backups']);
  });

  it('a force-close after the marker, then a swap that fails at launch: not deleted, marker cleared, the app opens', async () => {
    const w = world({ swap: () => Promise.reject(new Error('disk I/O error')), records: () => 12 });
    w.setLedger({ version: 1, pending: { kind: 'delete_my_data', opId: 'a', startedAtUtc: '2026-10-09T07:59:00.000Z' }, done: [] });
    expect(await w.svc.resumeInterrupted()).toEqual({ kind: 'not_deleted', message: 'disk I/O error' });
    expect(w.ledger()?.pending).toBeNull();
    expect(await w.svc.resumeInterrupted()).toEqual({ kind: 'none' });
    expect(w.wiped).toEqual([]);
  });
});
