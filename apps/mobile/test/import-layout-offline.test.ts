import { afterEach, describe, expect, it } from 'vitest';

import type { TextCoachState } from '@fizz/providers';

import { createHarness, setUpGym, type Harness } from './harness';
import { SpyLayoutPort, answerLayout, answerPreview, answerWith, layoutFixture, state } from './import-layout-helpers';

/**
 * Offline and without the coach (rule 1; checks 34, 55, 58): a new layout
 * stops honestly and **nothing is sent**; FitNotes and saved layouts import
 * with no network and no AI. A spy port records every request.
 */
let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

const STRONG = layoutFixture('strong-new-kg.synthetic.csv');
const SPEC = JSON.parse(layoutFixture('strong-new-kg.spec.json')) as unknown;

function launchWith(connection: () => TextCoachState, port: SpyLayoutPort | null) {
  h = createHarness('2026-10-12T09:00:00.000Z', port === null ? {} : { coach: { model: () => port, connection: () => Promise.resolve(connection()) } });
  return h.launch();
}

describe('a new layout with the coach unusable: Needs the coach, no request (check 34)', () => {
  it.each([
    ['not connected (no coach in this build)', null, 'not_connected'],
    ['not connected', 'not_connected', 'not_connected'],
    ['offline', 'offline', 'offline'],
    ['signed out', 'expired', 'signed_out'],
    ['usage limit', 'limit', 'limit'],
    ['model unavailable', 'model_gone', 'model_unavailable'],
  ] as const)('%s', async (_name, status, expected) => {
    const port = new SpyLayoutPort([answerWith(SPEC)]);
    const { services: s } = await launchWith(() => state(status ?? 'ok'), status === null ? null : port);
    await setUpGym(h, s);
    const r = await s.importLayouts.previewImport({ name: 'strong_workouts.csv', text: STRONG });
    expect(r).toMatchObject({ kind: 'new_table', columns: 13, rows: 15, coach: { state: expected } });
    if (r.kind !== 'new_table') return;
    const sample = s.importLayouts.buildImportSample(r.layoutId);
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample?.hash ?? '', 'op-1')).toEqual({ status: 'unavailable', reason: expected });
    expect(port.requests).toHaveLength(0);
    expect(await s.imports.list()).toEqual([]);
  });
});

describe('offline imports (check 34 second half, check 55)', () => {
  it('a FitNotes file imports with the coach offline: no request', async () => {
    const port = new SpyLayoutPort();
    const { services: s } = await launchWith(() => state('offline'), port);
    await setUpGym(h, s);
    const r = await s.importLayouts.previewImport({ name: 'FitNotes.csv', text: 'Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time\n2026-09-01,Lat Pulldown,Back,45.0,10,,,\n' });
    expect(r.kind).toBe('fitnotes');
    if (r.kind !== 'fitnotes' || r.result.kind !== 'preview') throw new Error('preview');
    const d = await answerPreview(s, r.result.draft);
    expect(await s.imports.commit(d.draftId, d.mappingVersion, 'op-fit')).toMatchObject({ ok: true, status: 'finished', written: 1 });
    expect(port.requests).toHaveLength(0);
  });

  it('after one import with Save layout on, a file with the same columns imports in airplane mode, with no request', async () => {
    let connection = state('ok');
    const port = new SpyLayoutPort([answerWith(SPEC)]);
    const { services: s } = await launchWith(() => connection, port);
    await setUpGym(h, s);
    // The first file: read with the coach, checked, imported, layout saved.
    const first = await s.importLayouts.previewImport({ name: 'strong_workouts.csv', text: STRONG });
    if (first.kind !== 'new_table') throw new Error(first.kind);
    const sample = s.importLayouts.buildImportSample(first.layoutId);
    expect(await s.importLayouts.proposeImportMapping(first.layoutId, sample?.hash ?? '', 'op-read-1')).toMatchObject({ status: 'proposed' });
    const v = await answerLayout(s, first.layoutId);
    const c = await s.importLayouts.confirmImportLayout(first.layoutId, v.layoutVersion);
    if (!c.ok || c.result.kind !== 'preview') throw new Error('preview');
    const d = await answerPreview(s, c.result.draft);
    expect(d.layout?.save).toEqual({ on: true, name: 'strong_workouts' });
    expect(await s.imports.commit(d.draftId, d.mappingVersion, 'op-commit-1')).toMatchObject({ ok: true, status: 'finished', written: 4 });
    expect(port.requests).toHaveLength(1);

    // Airplane mode: a newer export with the same columns.
    connection = state('offline');
    const newer = `${STRONG.trimEnd()}\n"5";"2025-03-10 07:00:00";"Push";"3400";"Bench Press (Barbell)";"1";"85";"6";"";"";"";"";""\n`;
    const second = await s.importLayouts.previewImport({ name: 'strong_workouts_nov.csv', text: newer });
    expect(second).toMatchObject({ kind: 'saved_layout', profileName: 'strong_workouts' });
    if (second.kind !== 'saved_layout' || second.result.kind !== 'preview') throw new Error(second.kind);
    expect(second.result.draft.layout).toMatchObject({ kind: 'saved', profileName: 'strong_workouts', unit: 'kg', unitSource: 'header', save: null });
    // Dates from the first import are skipped as already imported; only the new workout comes in.
    expect(second.result.draft.analysis.counts.workouts).toBe(1);
    const d2 = await answerPreview(s, second.result.draft);
    expect(await s.imports.commit(d2.draftId, d2.mappingVersion, 'op-commit-2')).toMatchObject({ ok: true, status: 'finished', written: 1 });
    expect(port.requests).toHaveLength(1);
  });
});

describe('an unfinished workout (AI15, check 58)', () => {
  it('blocks the import and the request: nothing is sent', async () => {
    const port = new SpyLayoutPort([answerWith(SPEC)]);
    const { services: s } = await launchWith(() => state('ok'), port);
    await setUpGym(h, s);
    const first = await s.importLayouts.previewImport({ name: 'strong_workouts.csv', text: STRONG });
    if (first.kind !== 'new_table') throw new Error(first.kind);
    const sample = s.importLayouts.buildImportSample(first.layoutId);
    const started = await s.workout.start({ gymId: (await s.yourData.currentGym())?.id ?? '', opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    expect(started.ok).toBe(true);
    expect(await s.importLayouts.proposeImportMapping(first.layoutId, sample?.hash ?? '', 'op-1')).toEqual({ status: 'refused', reason: 'workout_unfinished' });
    expect(await s.importLayouts.previewImport({ name: 'strong_workouts.csv', text: STRONG })).toMatchObject({ kind: 'blocked' });
    expect(port.requests).toHaveLength(0);
  });
});
