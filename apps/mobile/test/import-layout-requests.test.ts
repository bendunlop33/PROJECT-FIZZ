import { describe, expect, it } from 'vitest';

import { buildImportSample, readTable } from '@fizz/domain';
import { sha256Hex, type Store } from '@fizz/persistence';
import { ImportMappingSpecV1Schema, type ImportLayoutRequest, type UserProfile } from '@fizz/schemas';

import type { ImportService } from '../src/import/import-service';
import { createLayoutService } from '../src/import/layout-service';
import { SpyLayoutPort, answerWith, layoutFixture } from './import-layout-helpers';

/**
 * The layout service's request bookkeeping against an in-memory request
 * store whose writes can be timed (reviews S1, S5): `Stop` during the
 * request record's write sends nothing, and a stored layout is checked
 * against the file again before it is reused.
 */
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const AT = { utc: '2026-10-12T09:00:00.000Z', tz: 'Europe/London' };
const STRONG = layoutFixture('strong-new-kg.synthetic.csv');
const SPEC = JSON.parse(layoutFixture('strong-new-kg.spec.json')) as unknown;

function fakeStore(onSave: (r: ImportLayoutRequest) => void = () => undefined) {
  const requests: ImportLayoutRequest[] = [];
  const importProfiles = {
    list: () => Promise.resolve({ profiles: [], damaged: [] }),
    request: (owner: string, op: string) => Promise.resolve(requests.find((r) => r.ownerId === owner && r.operationId === op) ?? null),
    proposedFor: (owner: string, sampleHash: string, fileHash: string) =>
      Promise.resolve([...requests].reverse().find((r) => r.ownerId === owner && r.sampleHash === sampleHash && r.fileHash === fileHash && r.state === 'proposed' && r.closedAt === null && r.spec !== null) ?? null),
    latestFor: (owner: string, sampleHash: string) => Promise.resolve([...requests].reverse().find((r) => r.ownerId === owner && r.sampleHash === sampleHash) ?? null),
    saveRequest: async (r: ImportLayoutRequest, expected: number | null) => {
      onSave(r);
      await Promise.resolve();
      const i = requests.findIndex((x) => x.id === r.id);
      if (expected === null ? i >= 0 : requests[i]?.version !== expected) return { ok: false as const, error: 'stale' as const };
      if (i >= 0) requests[i] = r;
      else requests.push(r);
      return { ok: true as const };
    },
  };
  const store = { repos: { importProfiles, imports: { listJobs: () => Promise.resolve([]) } } } as unknown as Store;
  return { store, requests };
}

function service(store: Store, port: SpyLayoutPort) {
  let n = 0;
  return createLayoutService({
    store: () => store,
    now: () => AT,
    newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
    profile: () => Promise.resolve({ id: OWNER } as UserProfile),
    activeWorkout: () => Promise.resolve(null),
    imports: {} as ImportService,
    coach: { availability: () => Promise.resolve({ status: 'ok', model: 'gpt-test' }), model: () => port },
  });
}

describe('`Stop` while the request record is written (review S5)', () => {
  it('nothing is sent, and the record says `stopped`', async () => {
    const port = new SpyLayoutPort([answerWith(SPEC)]);
    let stop = (): void => undefined;
    const { store, requests } = fakeStore((r) => {
      if (r.state === 'sent') stop();
    });
    const s = service(store, port);
    const r = await s.previewImport({ name: 'strong_workouts.csv', text: STRONG });
    if (r.kind !== 'new_table') throw new Error(r.kind);
    stop = () => {
      s.stop(r.layoutId);
    };
    const sample = s.buildImportSample(r.layoutId);
    expect(await s.proposeImportMapping(r.layoutId, sample?.hash ?? '', 'op-1')).toEqual({ status: 'failed', reason: 'stopped' });
    expect(port.requests).toHaveLength(0);
    expect(requests[0]).toMatchObject({ state: 'failed', failure: 'stopped' });
  });
});

describe('a stored layout is checked against the whole file before it is reused (review S1)', () => {
  function stored(spec: unknown, over: Partial<ImportLayoutRequest> = {}): ImportLayoutRequest {
    const table = readTable(STRONG);
    if (!table) throw new Error('table');
    return {
      id: '00000000-0000-4000-8000-000000009301',
      ownerId: OWNER,
      version: 2,
      createdAtUtc: AT.utc,
      updatedAtUtc: AT.utc,
      operationId: 'earlier-op',
      sampleHash: sha256Hex(buildImportSample(table, { hidden: [] }).json),
      fileHash: sha256Hex(STRONG),
      instructionsHash: 'a'.repeat(64),
      route: 'chatgpt_plan',
      model: 'gpt-test',
      chars: 100,
      state: 'proposed',
      failure: null,
      unavailable: null,
      spec: ImportMappingSpecV1Schema.parse(spec),
      reasons: [],
      sentAt: AT,
      finishedAt: AT,
      closedAt: null,
      ...over,
    };
  }

  it('one that passes is reused, nothing sent', async () => {
    const port = new SpyLayoutPort([answerWith(SPEC)]);
    const { store, requests } = fakeStore();
    requests.push(stored(SPEC));
    const s = service(store, port);
    expect(await s.previewImport({ name: 'strong_workouts.csv', text: STRONG })).toMatchObject({ kind: 'new_table', reused: true });
    expect(port.requests).toHaveLength(0);
  });

  it('one that fails the checks on this file isn’t reused: the tap sends a new request', async () => {
    // Schema-valid, but names a column index that isn't the file's `Reps` (check 3).
    const broken = { ...(SPEC as object), reps: { header: 'Reps', index: 6 } };
    const port = new SpyLayoutPort([answerWith(SPEC)]);
    const { store, requests } = fakeStore();
    requests.push(stored(broken));
    const s = service(store, port);
    const r = await s.previewImport({ name: 'strong_workouts.csv', text: STRONG });
    expect(r).toMatchObject({ kind: 'new_table', reused: false });
    if (r.kind !== 'new_table') return;
    const sample = s.buildImportSample(r.layoutId);
    expect(await s.proposeImportMapping(r.layoutId, sample?.hash ?? '', 'op-1')).toMatchObject({ status: 'proposed', reused: false });
    expect(port.requests).toHaveLength(1);
  });

  it('one Ben already acted on (closed) or from a record with no file checksum isn’t reused', async () => {
    for (const over of [{ closedAt: AT }, { fileHash: null }]) {
      const port = new SpyLayoutPort([answerWith(SPEC)]);
      const { store, requests } = fakeStore();
      requests.push(stored(SPEC, over));
      const s = service(store, port);
      expect(await s.previewImport({ name: 'strong_workouts.csv', text: STRONG })).toMatchObject({ kind: 'new_table', reused: false });
    }
  });

  it('a replayed operation ID from another file’s sample adopts nothing (review N5)', async () => {
    const port = new SpyLayoutPort([]);
    const { store, requests } = fakeStore();
    requests.push(stored(SPEC, { operationId: 'op-1', sampleHash: 'b'.repeat(64) }));
    const s = service(store, port);
    const r = await s.previewImport({ name: 'strong_workouts.csv', text: STRONG });
    if (r.kind !== 'new_table') throw new Error(r.kind);
    const sample = s.buildImportSample(r.layoutId);
    expect(await s.proposeImportMapping(r.layoutId, sample?.hash ?? '', 'op-1')).toEqual({ status: 'refused', reason: 'sample_changed' });
    expect(s.getLayoutReview(r.layoutId)).toBeNull();
  });
});
