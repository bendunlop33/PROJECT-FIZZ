import { afterEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import { checkLayoutView, readingResultView } from '../src/import/layout-views';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';
import { SpyLayoutPort, answerLayout, answerPreview, answerWith, layoutFixture, state } from './import-layout-helpers';

/**
 * A layout that fails the checks is sent back to the coach **once** with
 * code's reasons (same sample, nothing new from the file), and if it still
 * fails, Check the layout asks Ben the open question instead of stopping
 * (ADR 0026 amendment, 13 Oct 2026). Synthetic files only.
 */
const STRONG = layoutFixture('strong-new-kg.synthetic.csv');
const SPEC = JSON.parse(layoutFixture('strong-new-kg.spec.json')) as Record<string, unknown>;
/** Wrong in two ways code can check: a unit token not in the header, and a marker not in the file. */
const BAD = {
  ...SPEC,
  load: { column: { header: 'Weight (kg)', index: 6 }, unit: { kind: 'header_token', column: { header: 'Weight (kg)', index: 6 }, token: 'lbs' } },
  setType: { column: { header: 'Set Order', index: 5 }, values: [{ cell: 'W', meaning: 'warmup' }, { cell: 'X', meaning: 'drop' }] },
};
const BAD_REASONS = [{ kind: 'unit_token', token: 'lbs' }, { kind: 'marker', token: '' }];

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

async function newTable(s: AppServices, text = STRONG) {
  const r = await s.importLayouts.previewImport({ name: 'strong_workouts.csv', text });
  if (r.kind !== 'new_table') throw new Error(r.kind);
  const sample = s.importLayouts.buildImportSample(r.layoutId);
  if (!sample) throw new Error('sample');
  return { r, sample };
}

describe('one correction, then Ben’s answer (never a dead end)', () => {
  it('a bad layout then a good one: the second request carries only the same sample, its own call and code’s reasons', async () => {
    const { s, port } = await launch([answerWith(BAD), answerWith(SPEC)]);
    const { r, sample } = await newTable(s);
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1')).toEqual({ status: 'proposed', layoutVersion: 1, reused: false });
    expect(port.requests).toHaveLength(2);
    const [first, second] = port.requests;
    expect(second?.instructions).toBe(first?.instructions);
    expect(second?.tools).toEqual(first?.tools);
    expect(second?.input).toHaveLength(3);
    expect(second?.input[0]).toEqual({ type: 'message', role: 'user', content: sample.json });
    expect(second?.input[1]).toMatchObject({ type: 'function_call', name: 'submit_import_layout', arguments: JSON.stringify(BAD) });
    const out = second?.input[2];
    if (out?.type !== 'function_call_output') throw new Error('output');
    expect(out.output).toContain('The unit token "lbs" is not a whole word');
    expect(out.output).toContain('A set-type marker listed is not in that column');
    // A good correction is used as usual: no `Why?` line, and the import commits.
    const v = s.importLayouts.getLayoutReview(r.layoutId);
    expect(v?.checks).toEqual([]);
    if (!v) return;
    expect(checkLayoutView(v, 'en-GB').checksLine).toBeNull();
    const answered = await answerLayout(s, r.layoutId);
    const c = await s.importLayouts.confirmImportLayout(r.layoutId, answered.layoutVersion);
    if (!c.ok || c.result.kind !== 'preview') throw new Error('preview');
    const d = await answerPreview(s, c.result.draft);
    const done = await s.imports.commit(d.draftId, d.mappingVersion, 'op-commit');
    expect(done).toMatchObject({ ok: true, status: 'finished' });
    if (!done.ok) return;
    expect((await s.imports.job(done.jobId))?.job.layout).toMatchObject({ requestsSent: 2 });
    // The same tap again: the stored result, nothing sent.
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1')).toMatchObject({ status: 'proposed' });
    expect(port.requests).toHaveLength(2);
  });

  it('a layout the coach never fixes: code keeps what it can check, Ben answers the open questions, and the reasons are behind Why?', async () => {
    const { s, port } = await launch([answerWith(BAD), answerWith(BAD)]);
    const { r, sample } = await newTable(s);
    const result = await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1');
    expect(result).toEqual({ status: 'proposed', layoutVersion: 1, reused: false, checks: BAD_REASONS });
    expect(readingResultView(result).next).toBe('check');
    expect(port.requests).toHaveLength(2);
    // Force-closed before Ben acts: the same file reuses the stored layout and its reasons; nothing is sent again.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const again = await newTable(s2);
    expect(again.r.reused).toBe(true);
    expect(await s2.importLayouts.proposeImportMapping(again.r.layoutId, again.sample.hash, 'op-1')).toMatchObject({ status: 'proposed' });
    expect(port.requests).toHaveLength(2);
    const v = s2.importLayouts.getLayoutReview(again.r.layoutId);
    if (!v) throw new Error('review');
    const view = checkLayoutView(v, 'en-GB');
    expect(view.checksLine).toEqual({ text: 'Didn’t pass every check', why: '“lbs” isn’t in the column name.\nIts marker isn’t in the file.' });
    // The unit is the header's own word, never the coach's `lbs`; the file's markers are asked.
    expect(v.review.unit).toMatchObject({ unit: 'kg', source: 'header' });
    expect(v.review.questions.flatMap((q) => (q.kind === 'marker' ? [q.marker.token] : []))).toEqual(['W', 'D']);
    expect(view.primary.enabled).toBe(false);
    const answered = await answerLayout(s2, again.r.layoutId);
    expect(answered.review).toMatchObject({ open: 0, ready: true });
    const c = await s2.importLayouts.confirmImportLayout(again.r.layoutId, answered.layoutVersion);
    if (!c.ok || c.result.kind !== 'preview') throw new Error('preview');
    const d = await answerPreview(s2, c.result.draft);
    expect(await s2.imports.commit(d.draftId, d.mappingVersion, 'op-commit')).toMatchObject({ ok: true, status: 'finished' });
    expect(port.requests).toHaveLength(2);
  });

  it('the correction can’t be sent (offline): the first layout is kept in part, offline', async () => {
    const { s, port } = await launch([answerWith(BAD), () => [{ type: 'error', error: 'network' }]]);
    const { r, sample } = await newTable(s);
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1')).toMatchObject({ status: 'proposed', checks: BAD_REASONS });
    expect(port.requests).toHaveLength(2);
  });

  it('nothing checkable left: the reasons, with Try again (Ben’s tap)', async () => {
    const packed = { ...SPEC, layout: { kind: 'row_per_exercise_packed', sets: { header: 'Sets', index: 3 }, notation: 'sets_x_reps' } };
    const { s, port } = await launch([answerWith(packed), answerWith(packed)]);
    const { r, sample } = await newTable(s);
    const result = await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1');
    expect(result).toMatchObject({ status: 'rejected' });
    expect(readingResultView(result).primary).toEqual({ label: 'Try again', action: 'retry' });
    expect(s.importLayouts.getLayoutReview(r.layoutId)).toBeNull();
    expect(port.requests).toHaveLength(2);
  });

  it('Stop during the correction: nothing adopted', async () => {
    const { s } = await launch([answerWith(BAD), () => [{ type: 'heartbeat' }, { type: 'heartbeat' }, ...answerWith(SPEC)()]]);
    const { r, sample } = await newTable(s);
    const p = s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1');
    // Let the first answer arrive and the correction start, then Stop.
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    s.importLayouts.stop(r.layoutId);
    expect(await p).toEqual({ status: 'failed', reason: 'stopped' });
    expect(s.importLayouts.getLayoutReview(r.layoutId)).toBeNull();
  });
});
