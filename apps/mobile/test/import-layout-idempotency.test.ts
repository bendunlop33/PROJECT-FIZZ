import { afterEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';
import { SpyLayoutPort, answerLayout, answerPreview, answerWith, layoutFixture, state } from './import-layout-helpers';

/**
 * Import from any app: idempotent writes at the service level (rule 5) and
 * an lb file end to end (units and dumbbell conventions explicit). Every
 * file is synthetic.
 */
let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

const STRONG = layoutFixture('strong-new-kg.synthetic.csv');
const STRONG_SPEC = JSON.parse(layoutFixture('strong-new-kg.spec.json')) as unknown;
const HEVY_LB = layoutFixture('hevy-lbs.synthetic.csv');
const HEVY_LB_SPEC = JSON.parse(layoutFixture('hevy-lbs.spec.json')) as unknown;

const limit = (): ModelEvent[] => [{ type: 'heartbeat' }, { type: 'error', error: 'usage_limit' }];

async function launch(steps: ((req: ModelRequest) => ModelEvent[])[]) {
  const port = new SpyLayoutPort(steps);
  h = createHarness('2026-10-12T09:00:00.000Z', { coach: { model: () => port, connection: () => Promise.resolve(state('ok')) } });
  const { services: s } = await h.launch();
  await setUpGym(h, s);
  return { s, port };
}

async function newTable(s: AppServices, text: string, name: string) {
  const r = await s.importLayouts.previewImport({ name, text });
  if (r.kind !== 'new_table') throw new Error(r.kind);
  const sample = s.importLayouts.buildImportSample(r.layoutId);
  if (!sample) throw new Error('sample');
  return { layoutId: r.layoutId, hash: sample.hash };
}

describe('the layout request is idempotent by operation ID (rule 5)', () => {
  it('a double tap with the same operation ID sends one request and gives the same result', async () => {
    const { s, port } = await launch([answerWith(STRONG_SPEC), answerWith(STRONG_SPEC)]);
    const { layoutId, hash } = await newTable(s, STRONG, 'strong_workouts.csv');
    const [a, b] = await Promise.all([s.importLayouts.proposeImportMapping(layoutId, hash, 'op-1'), s.importLayouts.proposeImportMapping(layoutId, hash, 'op-1')]);
    expect(a).toMatchObject({ status: 'proposed' });
    expect(b).toMatchObject({ status: 'proposed' });
    expect(port.requests).toHaveLength(1);
    expect(await s.importLayouts.proposeImportMapping(layoutId, hash, 'op-1')).toMatchObject({ status: 'proposed' });
    expect(port.requests).toHaveLength(1);
  });

  it('a repeat of a failed operation replays the failure and sends nothing; `Try again` is a new operation', async () => {
    const { s, port } = await launch([limit, answerWith(STRONG_SPEC)]);
    const { layoutId, hash } = await newTable(s, STRONG, 'strong_workouts.csv');
    expect(await s.importLayouts.proposeImportMapping(layoutId, hash, 'op-1')).toEqual({ status: 'unavailable', reason: 'limit' });
    expect(await s.importLayouts.proposeImportMapping(layoutId, hash, 'op-1')).toEqual({ status: 'unavailable', reason: 'limit' });
    expect(port.requests).toHaveLength(1);
    expect(await s.importLayouts.proposeImportMapping(layoutId, hash, 'op-2')).toMatchObject({ status: 'proposed' });
    expect(port.requests).toHaveLength(2);
    expect(await s.imports.list()).toEqual([]);
  });
});

describe('a finished layout import committed again (rule 5)', () => {
  it('the same operation ID writes nothing new: the draft is used up, so the repeat is refused', async () => {
    const { s } = await launch([answerWith(STRONG_SPEC)]);
    const { layoutId, hash } = await newTable(s, STRONG, 'strong_workouts.csv');
    expect(await s.importLayouts.proposeImportMapping(layoutId, hash, 'read-1')).toMatchObject({ status: 'proposed' });
    const v = await answerLayout(s, layoutId);
    const c = await s.importLayouts.confirmImportLayout(layoutId, v.layoutVersion);
    if (!c.ok || c.result.kind !== 'preview') throw new Error('preview');
    const draft = await answerPreview(s, c.result.draft);
    const first = await s.imports.commit(draft.draftId, draft.mappingVersion, 'op-commit');
    expect(first).toMatchObject({ ok: true, status: 'finished', written: 4 });
    const again = await s.imports.commit(draft.draftId, draft.mappingVersion, 'op-commit');
    expect(again).toEqual({ ok: false, reason: 'not_found' });
    expect(await s.yourData.counts()).toMatchObject({ finishedWorkouts: 4 });
    expect(await s.imports.list()).toHaveLength(1);
  });
});

describe('an lb file end to end (Hevy `weight_lbs`)', () => {
  it('stores lb values as written, never converted; dumbbells per hand, barbells total', async () => {
    const { s } = await launch([answerWith(HEVY_LB_SPEC)]);
    const { layoutId, hash } = await newTable(s, HEVY_LB, 'workout_data.csv');
    expect(await s.importLayouts.proposeImportMapping(layoutId, hash, 'read-1')).toMatchObject({ status: 'proposed' });
    const v = await answerLayout(s, layoutId);
    expect(v.review.questions.some((q) => q.kind === 'unit')).toBe(false);
    const c = await s.importLayouts.confirmImportLayout(layoutId, v.layoutVersion);
    if (!c.ok || c.result.kind !== 'preview') throw new Error('preview');
    const draft = await answerPreview(s, c.result.draft);
    const r = await s.imports.commit(draft.draftId, draft.mappingVersion, 'op-commit');
    if (!r.ok) throw new Error(r.reason);
    const job = await s.imports.job(r.jobId);
    expect(job?.job).toMatchObject({ source: 'layout', layout: { unit: 'lb', unitSource: 'header' } });
    const sets = (job?.rows ?? []).flatMap((x) => (x.result === 'imported' && x.imported ? [{ name: x.exerciseName, set: x.imported }] : []));
    expect(sets.length).toBeGreaterThan(0);
    for (const { set } of sets) expect(set.unit).toBe('lb');
    const bench = sets.find((x) => x.name === 'Bench Press (Barbell)' && x.set.reps === 8);
    expect(bench?.set).toMatchObject({ convention: 'total', unit: 'lb', load: { value: 185, unit: 'lb' } });
    const incline = sets.find((x) => x.name === 'Incline Bench Press (Dumbbell)' && x.set.reps === 10);
    expect(incline?.set).toMatchObject({ convention: 'per_hand', unit: 'lb', load: { value: 50, unit: 'lb' } });
  });
});
