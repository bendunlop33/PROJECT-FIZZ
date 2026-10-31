import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { previewView, resultsView } from '../src/import/views';
import type { ImportDraft } from '../src/import/import-service';
import { createHarness, setUpGym, type Harness } from './harness';
import { SpyLayoutPort, answerPreview, state } from './import-layout-helpers';

/**
 * FitNotes 2 (iPhone) workout export (variant `D`) through the app on real
 * SQLite: recognised offline with no coach, the unit asked once with
 * nothing selected, `NotStarted` sets skipped and listed, warm-ups, RPE and
 * RIR kept, each workout's real start, end and name, and Undo import. The
 * file is synthetic (packages/domain/test/fixtures/fitnotes/D.synthetic.csv).
 */
const D = readFileSync(new URL('../../../packages/domain/test/fixtures/fitnotes/D.synthetic.csv', import.meta.url), 'utf8');

let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

async function launch() {
  // The coach is offline: nothing here may need it.
  const port = new SpyLayoutPort([]);
  h = createHarness('2026-10-13T09:00:00.000Z', { coach: { model: () => port, connection: () => Promise.resolve(state('offline')) } });
  const { services: s } = await h.launch();
  await setUpGym(h, s);
  return { s, port };
}

describe('FitNotes 2 workout export (variant D)', () => {
  it('previews offline, asks the unit once, and commits workouts with their real times and names', async () => {
    const { s, port } = await launch();
    const r = await s.importLayouts.previewImport({ name: 'FitNotesWorkouts.csv', text: D });
    if (r.kind !== 'fitnotes' || r.result.kind !== 'preview') throw new Error(r.kind);
    let d: ImportDraft = r.result.draft;
    expect(d.variant).toBe('D');
    expect(d.analysis.unit).toEqual({ rows: 8, answer: null, kind: 'no_unit' });
    const before = previewView(d, 'en-GB');
    expect(before.detection).toBe('FitNotes 2 (iPhone) CSV · weight unit not in the file');
    expect(before.questions.find((q) => q.key.kind === 'unit')).toMatchObject({ answered: false, line: { text: 'Weight unit: kg or lb?' } });
    expect(before.skipped.map((x) => x.line.text)).toContain('2 sets not done');
    expect(before.kept.map((x) => x.text)).toEqual(expect.arrayContaining(['Start and end times', 'Warm-ups as in the file']));

    const u = await s.imports.answer(d.draftId, d.mappingVersion, { kind: 'both_columns', answer: 'kg' });
    if (!u.ok) throw new Error(u.reason);
    // A stale version is refused (rule 5).
    expect(await s.imports.answer(d.draftId, d.mappingVersion, { kind: 'both_columns', answer: 'lb' })).toMatchObject({ ok: false });
    d = await answerPreview(s, u.draft);
    expect(previewView(d, 'en-GB').detection).toBe('FitNotes 2 (iPhone) CSV · weights in kg');
    expect(d.analysis.ready).toBe(true);
    expect(d.analysis.counts.workouts).toBe(4);

    const done = await s.imports.commit(d.draftId, d.mappingVersion, 'op-commit');
    expect(done).toMatchObject({ ok: true, status: 'finished', written: 4, total: 4 });
    // The finished draft can't be committed again (rule 5).
    expect(await s.imports.commit(d.draftId, d.mappingVersion, 'op-commit')).toMatchObject({ ok: false });
    if (!done.ok) return;
    const job = await s.imports.job(done.jobId);
    const rows = job?.rows ?? [];
    expect(rows.filter((x) => x.result === 'skipped_not_a_set').map((x) => x.detail)).toEqual(['Not done', 'Not done']);
    const imported = rows.filter((x) => x.result === 'imported');
    expect(imported.find((x) => x.line === 2)?.imported).toMatchObject({ setType: 'warmup', unit: 'kg', load: { value: 40, unit: 'kg' } });
    expect(imported.find((x) => x.line === 3)?.imported).toMatchObject({ rpe: 8, rir: 2 });
    const results = job ? resultsView(job, 'en-GB') : null;
    expect(results?.skipped.find((x) => x.result === 'skipped_not_a_set')?.title).toBe('2 sets not done');
    expect(await s.yourData.counts()).toMatchObject({ finishedWorkouts: 4 });
    expect(port.requests).toHaveLength(0);

    // After a restart, the workouts read back with their names and times.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const past = await s2.history.pastWorkouts();
    expect(past.rows).toHaveLength(4);
    expect(past.rows.map((x) => [x.title, x.startedAtUtc, x.localDate])).toEqual([
      ['Evening', '2026-03-06T18:15:00.000Z', null],
      ['Morning', '2026-03-06T06:00:00.000Z', null],
      ['Pull', '2026-03-04T17:30:00.000Z', null],
      ['Push (Heavy)', '2026-03-02T07:05:00.000Z', null],
    ]);

    // Undo import takes all four back.
    const again = await s2.imports.job(done.jobId);
    if (!again) throw new Error('job');
    expect(await s2.imports.revert(done.jobId, again.job.version, 'op-undo')).toMatchObject({ ok: true });
    expect(await s2.yourData.counts()).toMatchObject({ finishedWorkouts: 0 });
  });
});
