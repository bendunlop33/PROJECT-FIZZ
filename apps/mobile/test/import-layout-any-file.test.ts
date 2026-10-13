import { afterEach, describe, expect, it } from 'vitest';

import { stableStringify } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { sha256Hex } from '@fizz/persistence';

import { checkLayoutView } from '../src/import/layout-views';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';
import { SpyLayoutPort, answerLayout, answerPreview, answerWith, layoutFixture, state } from './import-layout-helpers';

/**
 * Generic spreadsheet layouts end to end on real SQLite (review B1): a wide
 * `Set 1…Set n` file and a packed `3x8 @ 100` file with no weight column go
 * from `Choose file` to a committed import, answering only through
 * `updateImportLayout` as the screens do. Also the stale `layoutVersion` at
 * commit (check 53, review S3) and a remapped layout's own spec hash (S4).
 * Every file is synthetic.
 */
let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

async function launch(steps: ((req: ModelRequest) => ModelEvent[])[]) {
  const port = new SpyLayoutPort(steps);
  h = createHarness('2026-10-12T09:00:00.000Z', { coach: { model: () => port, connection: () => Promise.resolve(state('ok')) } });
  const { services: s } = await h.launch();
  await setUpGym(h, s);
  return { s, port };
}

async function readAndCheck(s: AppServices, name: string, text: string, unit?: 'kg' | 'lb') {
  const r = await s.importLayouts.previewImport({ name, text });
  if (r.kind !== 'new_table') throw new Error(r.kind);
  const sample = s.importLayouts.buildImportSample(r.layoutId);
  expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample?.hash ?? '', `read-${name}`)).toMatchObject({ status: 'proposed' });
  const v = await answerLayout(s, r.layoutId, unit === undefined ? {} : { unit });
  return { layoutId: r.layoutId, v };
}

describe('wide and packed-with-load files import end to end (review B1)', () => {
  it('`Set 1…Set 4` with `100x8` cells: `Weight unit` is asked, answered on the screen, and the import commits', async () => {
    const { s, port } = await launch([answerWith(JSON.parse(layoutFixture('spreadsheet-wide.spec.json')))]);
    const { layoutId, v } = await readAndCheck(s, 'sheet.csv', layoutFixture('spreadsheet-wide.synthetic.csv'), 'lb');
    expect(v.review.questions.map((q) => q.kind)).toEqual(['record_kind', 'unit', 'notation']);
    expect(v.review).toMatchObject({ open: 0, pending: 0, stuck: 0, ready: true, unit: { unit: 'lb', source: 'answer' } });
    expect(checkLayoutView(v, 'en-GB').primary).toEqual({ label: 'Use this layout', enabled: true });
    const c = await s.importLayouts.confirmImportLayout(layoutId, v.layoutVersion);
    if (!c.ok || c.result.kind !== 'preview') throw new Error('preview');
    const d = await answerPreview(s, c.result.draft);
    expect(d.layout).toMatchObject({ unit: 'lb', unitSource: 'answer' });
    const done = await s.imports.commit(d.draftId, d.mappingVersion, 'op-commit');
    expect(done).toMatchObject({ ok: true, status: 'finished' });
    if (!done.ok) return;
    const job = await s.imports.job(done.jobId);
    const imported = (job?.rows ?? []).filter((x) => x.result === 'imported');
    // One set per filled `Set n` cell; 3 workouts by date.
    expect(new Set(imported.map((x) => x.sessionId)).size).toBe(3);
    expect(imported.length).toBeGreaterThan(0);
    expect(job?.job.layout).toMatchObject({ unit: 'lb', unitSource: 'answer' });
    expect(port.requests).toHaveLength(1);
  });

  it('`3x8 @ 100` with no Weight column: `Weight unit` is asked, answered, and the import commits in that unit', async () => {
    const { s } = await launch([answerWith(JSON.parse(layoutFixture('spreadsheet-packed-at.spec.json')))]);
    const { layoutId, v } = await readAndCheck(s, 'packed.csv', layoutFixture('spreadsheet-packed-at.synthetic.csv'), 'kg');
    expect(v.review.questions.map((q) => q.kind)).toEqual(['record_kind', 'unit', 'notation']);
    expect(v.review).toMatchObject({ open: 0, pending: 0, stuck: 0, ready: true });
    const c = await s.importLayouts.confirmImportLayout(layoutId, v.layoutVersion);
    if (!c.ok || c.result.kind !== 'preview') throw new Error('preview');
    const d = await answerPreview(s, c.result.draft);
    const done = await s.imports.commit(d.draftId, d.mappingVersion, 'op-commit');
    expect(done).toMatchObject({ ok: true, status: 'finished' });
    if (!done.ok) return;
    const job = await s.imports.job(done.jobId);
    expect(job?.job.layout).toMatchObject({ unit: 'kg', unitSource: 'answer' });
    const parts = (job?.rows ?? []).filter((x) => x.line === 2);
    // `3x8 @ 100`: three sets from one cell.
    expect(parts.map((x) => x.part)).toEqual([0, 1, 2]);
  });
});

describe('a stale layout version at commit (check 53, review S3)', () => {
  it('a preview made before the layout was changed on Check the layout commits nothing', async () => {
    const STRONG = layoutFixture('strong-new-kg.synthetic.csv');
    const { s } = await launch([answerWith(JSON.parse(layoutFixture('strong-new-kg.spec.json')))]);
    const { layoutId, v } = await readAndCheck(s, 'strong_workouts.csv', STRONG);
    const c = await s.importLayouts.confirmImportLayout(layoutId, v.layoutVersion);
    if (!c.ok || c.result.kind !== 'preview') throw new Error('preview');
    const d = await answerPreview(s, c.result.draft);
    // Back on Check the layout, Ben changes a marker: the preview he made is now stale.
    const changed = s.importLayouts.updateImportLayout(layoutId, { kind: 'marker', token: 'D', meaning: 'working' }, v.layoutVersion);
    expect(changed.ok).toBe(true);
    expect(await s.imports.commit(d.draftId, d.mappingVersion, 'op-commit')).toEqual({ ok: false, reason: 'layout_changed' });
    expect(await s.yourData.counts()).toMatchObject({ finishedWorkouts: 0 });
    // Confirming again makes a fresh preview from the version in effect, which commits.
    const now = s.importLayouts.getLayoutReview(layoutId);
    const c2 = await s.importLayouts.confirmImportLayout(layoutId, now?.layoutVersion ?? 0);
    if (!c2.ok || c2.result.kind !== 'preview') throw new Error('preview');
    const d2 = await answerPreview(s, c2.result.draft);
    expect(await s.imports.commit(d2.draftId, d2.mappingVersion, 'op-commit-2')).toMatchObject({ ok: true, status: 'finished' });
  });
});

describe('Changed columns record the spec that read the rows (rule 6, review S4)', () => {
  it('a remapped layout’s job and new saved layout carry the remapped spec’s own hash', async () => {
    const STRONG = layoutFixture('strong-new-kg.synthetic.csv');
    const { s } = await launch([answerWith(JSON.parse(layoutFixture('strong-new-kg.spec.json')))]);
    const { layoutId, v } = await readAndCheck(s, 'strong_workouts.csv', STRONG);
    const c = await s.importLayouts.confirmImportLayout(layoutId, v.layoutVersion);
    if (!c.ok || c.result.kind !== 'preview') throw new Error('preview');
    const d = await answerPreview(s, c.result.draft);
    const first = await s.imports.commit(d.draftId, d.mappingVersion, 'op-commit-1');
    if (!first.ok) throw new Error(first.reason);
    const firstHash = (await s.imports.job(first.jobId))?.job.layout?.specHash;

    // The same export with a `Gym` column added after `Workout Name`: every later index moves by one.
    const lines = STRONG.trimEnd().split('\n');
    const withGym = lines
      .map((l, i) => {
        const cells = l.split(';');
        cells.splice(3, 0, i === 0 ? '"Gym"' : '"Home"');
        return cells.join(';');
      })
      .join('\n');
    const newer = `${withGym}\n"5";"2025-03-10 07:00:00";"Push";"Home";"3400";"Bench Press (Barbell)";"1";"85";"6";"";"";"";"";""\n`;
    const second = await s.importLayouts.previewImport({ name: 'strong_workouts_nov.csv', text: newer });
    if (second.kind !== 'saved_layout_changed') throw new Error(second.kind);
    const v2 = await answerLayout(s, second.layoutId);
    const c2 = await s.importLayouts.confirmImportLayout(second.layoutId, v2.layoutVersion);
    if (!c2.ok || c2.result.kind !== 'preview') throw new Error('preview');
    const d2 = await answerPreview(s, c2.result.draft);
    const done = await s.imports.commit(d2.draftId, d2.mappingVersion, 'op-commit-2');
    if (!done.ok) throw new Error(done.reason);
    const job = (await s.imports.job(done.jobId))?.job;
    const saved = await s.importLayouts.getLayout(job?.layout?.savedProfileId ?? '');
    if (!saved) throw new Error('saved layout');
    // The saved layout's spec is the remapped one that read the rows; the job and the layout both carry its own hash.
    expect(saved.spec.exercise.index).toBe(5);
    expect(saved.provenance.specHash).toBe(sha256Hex(stableStringify(saved.spec)));
    expect(job?.layout?.specHash).toBe(saved.provenance.specHash);
    expect(job?.layout?.specHash).not.toBe(firstHash);
  });
});
