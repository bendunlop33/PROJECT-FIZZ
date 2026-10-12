import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@fizz/persistence';
import type { ModelEvent, ModelRequest } from '@fizz/coach';

import { provenanceLines, previewView } from '../src/import/views';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';
import { SpyLayoutPort, answerLayout, answerPreview, answerWith, layoutFixture, state } from './import-layout-helpers';

/**
 * Import from any app, end to end on real SQLite with a scripted ChatGPT-plan
 * port (data-import-export §9; checks 35, 36, 38, 50, 52, 53, 54). Every
 * file is synthetic.
 */
let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

const STRONG = layoutFixture('strong-new-kg.synthetic.csv');
const SPEC = JSON.parse(layoutFixture('strong-new-kg.spec.json')) as unknown;

async function launch(steps: ((req: ModelRequest) => ModelEvent[])[] = [answerWith(SPEC)]) {
  const port = new SpyLayoutPort(steps);
  h = createHarness('2026-10-12T09:00:00.000Z', { coach: { model: () => port, connection: () => Promise.resolve(state('ok')) } });
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  return { s, port, gymId };
}

async function newTable(s: AppServices, text = STRONG, name = 'strong_workouts.csv') {
  const r = await s.importLayouts.previewImport({ name, text });
  if (r.kind !== 'new_table') throw new Error(r.kind);
  const sample = s.importLayouts.buildImportSample(r.layoutId);
  if (!sample) throw new Error('sample');
  return { r, sample };
}

/** Read, check, confirm and answer the Strong file: the preview, ready to import. */
async function readToPreview(s: AppServices, text = STRONG, name = 'strong_workouts.csv') {
  const { r, sample } = await newTable(s, text, name);
  expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, `read-${name}`)).toMatchObject({ status: 'proposed' });
  const v = await answerLayout(s, r.layoutId);
  const c = await s.importLayouts.confirmImportLayout(r.layoutId, v.layoutVersion);
  if (!c.ok || c.result.kind !== 'preview') throw new Error('preview');
  return { layoutId: r.layoutId, draft: await answerPreview(s, c.result.draft) };
}

describe('what is sent (checks 36, 38)', () => {
  it('the request’s one message is the text shown, byte for byte; switching a column off changes both', async () => {
    const { s, port } = await launch();
    const { r, sample } = await newTable(s);
    const hidden = s.importLayouts.buildImportSample(r.layoutId, [2]);
    expect(hidden?.hash).not.toBe(sample.hash);
    expect(hidden?.hiddenCount).toBe(1);
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, hidden?.hash ?? '', 'op-1')).toMatchObject({ status: 'proposed' });
    const sent = port.requests[0]?.input[0];
    expect(sent?.type === 'message' ? sent.content : null).toBe(hidden?.json);
    expect(sha256Hex(sent?.type === 'message' ? sent.content : '')).toBe(hidden?.hash);
  });

  it('a hash that isn’t the text shown is refused, and nothing is sent', async () => {
    const { s, port } = await launch();
    const { r, sample } = await newTable(s);
    s.importLayouts.buildImportSample(r.layoutId, [1]);
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1')).toEqual({ status: 'refused', reason: 'sample_changed' });
    expect(port.requests).toHaveLength(0);
  });

  it('carries no Your data: not the gym, not logged history, not the file name; one forced tool', async () => {
    const { s, port, gymId } = await launch();
    await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 52.5, reps: 11 }] }]);
    const { r, sample } = await newTable(s);
    await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1');
    const req = port.requests[0];
    const text = JSON.stringify(req);
    for (const mine of ['Main Gym', 'Lat pulldown', '52.5', 'strong_workouts', 'ben@example.com', 'YOUR DATA', 'COACHING KNOWLEDGE']) expect(text).not.toContain(mine);
    expect(req?.tools.map((t) => t.name)).toEqual(['submit_import_layout']);
    expect(req?.toolChoice).toBe('required');
    expect(req?.parallelToolCalls).toBe(false);
    expect(req?.input).toHaveLength(1);
  });
});

describe('failures are honest and import nothing (checks 35, §9.3.3)', () => {
  it('a usage limit mid-request: nothing imported, the coach’s status untouched, one request only', async () => {
    const { s, port } = await launch([() => [{ type: 'heartbeat' }, { type: 'error', error: 'usage_limit' }]]);
    const { r, sample } = await newTable(s);
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1')).toEqual({ status: 'unavailable', reason: 'limit' });
    expect(await s.imports.list()).toEqual([]);
    expect(await s.importLayouts.getImportCoachStatus()).toEqual({ route: 'chatgpt_plan', state: 'ready' });
    expect(port.requests).toHaveLength(1);
    // The same tap again returns the stored result and sends nothing.
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1')).toEqual({ status: 'unavailable', reason: 'limit' });
    expect(port.requests).toHaveLength(1);
  });

  it('no layout returned, then `Try again` (Ben’s tap) sends once more', async () => {
    const { s, port } = await launch([() => [{ type: 'text_delta', delta: 'All checked, tap Import' }, { type: 'completed' }], answerWith(SPEC)]);
    const { r, sample } = await newTable(s);
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1')).toEqual({ status: 'failed', reason: 'no_layout_returned' });
    expect(s.importLayouts.getLayoutReview(r.layoutId)).toBeNull();
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-2')).toMatchObject({ status: 'proposed', reused: false });
    expect(port.requests).toHaveLength(2);
  });

  it('a layout that fails the checks is refused with code’s reasons; nothing of it is shown', async () => {
    const lying = { ...(SPEC as object), reps: { header: 'Reps', index: 6 } };
    const { s } = await launch([answerWith(lying)]);
    const { r, sample } = await newTable(s);
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1')).toEqual({ status: 'rejected', reasons: [{ kind: 'unknown_column', header: 'Reps' }] });
    expect(s.importLayouts.getLayoutReview(r.layoutId)).toBeNull();
  });

  it('`No sets found` when the coach says the file has none', async () => {
    const { s } = await launch([answerWith({ ...(SPEC as object), unsupported: 'no_set_rows', selfCheck: [] })]);
    const { r, sample } = await newTable(s);
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1')).toEqual({ status: 'unsupported' });
  });

  it('Stop: cancelled, a late answer thrown away, nothing imported', async () => {
    const { s } = await launch([() => [{ type: 'heartbeat' }, { type: 'heartbeat' }, { type: 'heartbeat' }, ...answerWith(SPEC)()]]);
    const { r, sample } = await newTable(s);
    const p = s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1');
    s.importLayouts.stop(r.layoutId);
    expect(await p).toEqual({ status: 'failed', reason: 'stopped' });
    expect(s.importLayouts.getLayoutReview(r.layoutId)).toBeNull();
  });

  it('a layout that arrived before the app was left is reused when the file is opened again: nothing sent twice', async () => {
    const { s, port } = await launch();
    const { r, sample } = await newTable(s);
    await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1');
    s.importLayouts.discard(r.layoutId);
    const again = await s.importLayouts.previewImport({ name: 'strong_workouts.csv', text: STRONG });
    expect(again).toMatchObject({ kind: 'new_table', reused: true });
    if (again.kind !== 'new_table') return;
    expect(await s.importLayouts.proposeImportMapping(again.layoutId, sample.hash, 'op-2')).toMatchObject({ status: 'proposed', reused: true });
    expect(port.requests).toHaveLength(1);
  });

  it('a request cut off by a force-close shows `Interrupted.` once, and imports nothing', async () => {
    // A port that never answers until it is cancelled: the app is closed while it waits.
    const hanging = {
      requests: 0,
      async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
        hanging.requests += 1;
        yield { type: 'heartbeat' };
        await new Promise<void>((resolve) => {
          req.signal?.addEventListener('abort', () => {
            resolve();
          });
        });
        yield { type: 'error', error: 'cancelled' };
      },
    };
    h = createHarness('2026-10-12T09:00:00.000Z', { coach: { model: () => hanging, connection: () => Promise.resolve(state('ok')) } });
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const { r, sample } = await newTable(s);
    const pending = s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1');
    while (hanging.requests === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    await h.forceClose();
    s.importLayouts.stop(r.layoutId);
    await pending.catch(() => undefined);
    const { services: s2 } = await h.launch();
    expect(await s2.importLayouts.previewImport({ name: 'strong_workouts.csv', text: STRONG })).toMatchObject({ kind: 'new_table', interrupted: true, reused: false });
    expect(await s2.importLayouts.previewImport({ name: 'strong_workouts.csv', text: STRONG })).toMatchObject({ kind: 'new_table', interrupted: false });
    expect(await s2.imports.list()).toEqual([]);
    expect(hanging.requests).toBe(1);
  });
});

describe('Check the layout (checks 43, 50; rule 5)', () => {
  it('Checks wait for Use this; a role change moves the other column to Not imported, with Undo; stale versions are refused', async () => {
    const { s } = await launch();
    const { r, sample } = await newTable(s);
    await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1');
    const v = s.importLayouts.getLayoutReview(r.layoutId);
    if (!v) throw new Error('review');
    expect(v.review.open).toBe(3);
    expect(await s.importLayouts.confirmImportLayout(r.layoutId, v.layoutVersion)).toEqual({ ok: false, reason: 'not_ready' });
    const moved = s.importLayouts.updateImportLayout(r.layoutId, { kind: 'role', column: 2, role: 'reps' }, v.layoutVersion);
    expect(moved).toMatchObject({ ok: true, layoutVersion: 2, displaced: [{ column: 7, header: 'Reps' }] });
    expect(s.importLayouts.updateImportLayout(r.layoutId, { kind: 'record_kind', answer: 'done' }, v.layoutVersion)).toEqual({ ok: false, reason: 'stale' });
    const undone = s.importLayouts.updateImportLayout(r.layoutId, { kind: 'undo' }, 2);
    expect(undone.ok && undone.review.columns[7]?.role).toBe('reps');
    expect(s.importLayouts.updateImportLayout(r.layoutId, { kind: 'role', column: 0, role: 'unit' }, 3)).toEqual({ ok: false, reason: 'refused', refusal: 'not_unit_words' });
    expect(s.importLayouts.updateImportLayout(r.layoutId, { kind: 'confirm', column: 4 }, 3)).toEqual({ ok: false, reason: 'not_a_check' });
  });

  it('A plan or template imports nothing', async () => {
    const { s } = await launch();
    const { r, sample } = await newTable(s);
    await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1');
    await answerLayout(s, r.layoutId);
    const v = s.importLayouts.getLayoutReview(r.layoutId);
    const plan = s.importLayouts.updateImportLayout(r.layoutId, { kind: 'record_kind', answer: 'plan' }, v?.layoutVersion ?? 0);
    expect(plan.ok && plan.review.plan).toBe(true);
    expect(await s.importLayouts.confirmImportLayout(r.layoutId, plan.ok ? plan.layoutVersion : 0)).toEqual({ ok: false, reason: 'plan' });
  });
});

describe('commit, resume and Undo (checks 52, 53, 54, 59)', () => {
  it('two Strong workouts on one date come in as two workouts, with their times as written and their provenance', async () => {
    const { s } = await launch();
    const { draft } = await readToPreview(s);
    const view = previewView(draft, 'en-GB');
    expect(view).toMatchObject({ detection: 'Coach layout · checked by you', unitLine: 'kg · from the column name', saveLayout: { on: true, name: 'strong_workouts' } });
    expect(view.kept.map((l) => l.text)).toContain('Times as in the file (no time zone)');
    const r = await s.imports.commit(draft.draftId, draft.mappingVersion, 'op-commit');
    expect(r).toMatchObject({ ok: true, status: 'finished', written: 4, total: 4 });
    if (!r.ok) return;
    const job = await s.imports.job(r.jobId);
    expect(job?.job).toMatchObject({ source: 'layout', variant: null, layout: { kind: 'coach', route: 'chatgpt_plan', model: 'gpt-test', requestsSent: 1, unit: 'kg', unitSource: 'header' } });
    const day = (job?.rows ?? []).filter((x) => x.result === 'imported' && x.localDate === '2025-03-04');
    expect(new Set(day.map((x) => x.sessionId)).size).toBe(2);
    const evening = day.find((x) => x.line === 7);
    if (!evening?.setId) throw new Error('row');
    const prov = await s.imports.provenance(evening.setId);
    expect(prov && provenanceLines(prov, 'en-GB')).toEqual({ source: 'strong_workouts.csv · row 7 · 18:02 (as in the file)', original: 'Original: 2 · 2025-03-04 18:02:11 · Legs · 2700 · Squat (Barbell) · 1 · 100 · 5 · Second workout of the day, evening slot' });
    const w = await s.yourData.counts();
    expect(w).toMatchObject({ finishedWorkouts: 4 });
  });

  it('force-closed mid-import, Continue finishes with exactly the planned workouts (check 53)', async () => {
    const { s } = await launch();
    const { draft } = await readToPreview(s);
    let n = 0;
    const first = await s.imports.commit(draft.draftId, draft.mappingVersion, 'op-commit', {
      onProgress: (w) => {
        n = w;
      },
      shouldStop: () => n >= 2,
    });
    expect(first).toMatchObject({ ok: true, status: 'stopped', written: 2, total: 4 });
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(await s2.imports.paused()).toMatchObject({ state: 'paused', written: 2, total: 4 });
    const again = await s2.imports.commit(draft.draftId, draft.mappingVersion, 'op-commit');
    expect(again).toMatchObject({ ok: true, status: 'finished', written: 4, total: 4 });
    expect(await s2.yourData.counts()).toMatchObject({ finishedWorkouts: 4 });
  });

  it('a stale layout version can’t be confirmed (rule 5)', async () => {
    const { s } = await launch();
    const { r, sample } = await newTable(s);
    await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1');
    const v = await answerLayout(s, r.layoutId);
    expect(await s.importLayouts.confirmImportLayout(r.layoutId, v.layoutVersion - 1)).toEqual({ ok: false, reason: 'stale' });
  });

  it('Undo this import hides every workout, deletes nothing, and takes the layout back; the next file is a new layout (check 54)', async () => {
    const { s, port } = await launch([answerWith(SPEC), answerWith(SPEC)]);
    const { draft } = await readToPreview(s);
    const r = await s.imports.commit(draft.draftId, draft.mappingVersion, 'op-commit');
    if (!r.ok) throw new Error(r.reason);
    expect((await s.importLayouts.listLayouts()).rows).toMatchObject([{ name: 'strong_workouts', state: 'in_use', imports: 1, unit: null, columns: 13 }]);
    expect(await s.importLayouts.layoutGoingWith(r.jobId)).toBe('strong_workouts');
    const job = await s.imports.job(r.jobId);
    expect(await s.imports.revert(r.jobId, job?.job.version ?? 0, 'undo-1')).toMatchObject({ ok: true, workouts: 4 });
    expect(await s.yourData.counts()).toMatchObject({ finishedWorkouts: 0 });
    expect((await s.imports.job(r.jobId))?.rows.length).toBe(job?.rows.length);
    expect((await s.importLayouts.listLayouts()).rows).toMatchObject([{ name: 'strong_workouts', state: 'not_in_use', imports: 0 }]);
    expect(await s.importLayouts.layoutGoingWith(r.jobId)).toBeNull();
    const next = await s.importLayouts.previewImport({ name: 'strong_workouts.csv', text: STRONG });
    expect(next.kind).toBe('new_table');
    expect(port.requests).toHaveLength(1);
  });

  it('dates that came in with a FitNotes import still in effect are skipped and listed (AI7, check 52)', async () => {
    const { s } = await launch();
    const fit = await s.imports.open({ name: 'FitNotes.csv', text: 'Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time\n2025-03-06,Lat Pulldown,Back,45.0,10,,,\n' });
    if (fit.kind !== 'preview') throw new Error(fit.kind);
    const d = await answerPreview(s, fit.draft);
    expect(await s.imports.commit(d.draftId, d.mappingVersion, 'op-fit')).toMatchObject({ ok: true, status: 'finished' });
    const { draft } = await readToPreview(s);
    expect(draft.analysis.alreadyImported.dates).toBe(1);
    expect(draft.analysis.counts.byResult.skipped_duplicate).toBe(3);
    expect(draft.analysis.counts.workouts).toBe(3);
  });

  it('a saved layout deleted after the preview refuses the commit (rule 5)', async () => {
    const { s } = await launch();
    const { draft } = await readToPreview(s);
    const r = await s.imports.commit(draft.draftId, draft.mappingVersion, 'op-commit');
    if (!r.ok) throw new Error(r.reason);
    const newer = `${STRONG.trimEnd()}\n"5";"2025-03-10 07:00:00";"Push";"3400";"Bench Press (Barbell)";"1";"85";"6";"";"";"";"";""\n`;
    const second = await s.importLayouts.previewImport({ name: 'strong_workouts_nov.csv', text: newer });
    if (second.kind !== 'saved_layout' || second.result.kind !== 'preview') throw new Error(second.kind);
    const d2 = await answerPreview(s, second.result.draft);
    const row = (await s.importLayouts.listLayouts()).rows[0];
    expect(await s.importLayouts.deleteLayout(row?.id ?? '', row?.version ?? 0)).toMatchObject({ ok: true });
    expect(await s.imports.commit(d2.draftId, d2.mappingVersion, 'op-commit-2')).toEqual({ ok: false, reason: 'layout_changed' });
  });
});

describe('values to check (AI13, check 51)', () => {
  it('a 100 → 225 jump blocks the import until answered; Skip leaves those sets out', async () => {
    const text = ['Date,Exercise,Weight (kg),Reps', '2025-06-01,Bench Press,100,5', '2025-06-03,Bench Press,225,5', '2025-06-03,Bench Press,225,4', '2025-06-05,Bench Press,102.5,5'].join('\n');
    const spec = {
      specVersion: 1,
      file: { delimiter: ',', headerLine: 1, decimal: '.' },
      layout: { kind: 'row_per_set', setOrder: null },
      workoutKey: [],
      date: { column: { header: 'Date', index: 0 }, format: 'YYYY-MM-DD' },
      exercise: { header: 'Exercise', index: 1 },
      load: { column: { header: 'Weight (kg)', index: 2 }, unit: { kind: 'header_token', column: { header: 'Weight (kg)', index: 2 }, token: 'kg' } },
      reps: { header: 'Reps', index: 3 },
      setType: null,
      rpe: null,
      notes: [],
      unmapped: [],
      selfCheck: [
        { line: 2, date: '2025-06-01', exercise: 'Bench Press', load: 100, reps: 5 },
        { line: 3, date: '2025-06-03', exercise: 'Bench Press', load: 225, reps: 5 },
        { line: 5, date: '2025-06-05', exercise: 'Bench Press', load: 102.5, reps: 5 },
      ],
      unsupported: null,
    };
    const { s } = await launch([answerWith(spec)]);
    const { r, sample } = await newTable(s, text, 'log.csv');
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample.hash, 'op-1')).toMatchObject({ status: 'proposed' });
    const v = await answerLayout(s, r.layoutId);
    const c = await s.importLayouts.confirmImportLayout(r.layoutId, v.layoutVersion);
    if (!c.ok || c.result.kind !== 'preview') throw new Error('preview');
    let d = c.result.draft;
    for (const n of d.analysis.names.filter((x) => x.needsAnswer)) {
      const a = await s.imports.answer(d.draftId, d.mappingVersion, { kind: 'name', key: n.key, answer: n.match.exerciseId ? { kind: 'exercise', exerciseId: n.match.exerciseId } : { kind: 'skip' } });
      if (a.ok) d = a.draft;
    }
    const t = await s.imports.answer(d.draftId, d.mappingVersion, { kind: 'total', answer: 'total' });
    if (t.ok) d = t.draft;
    expect(previewView(d, 'en-GB').questions.map((q) => q.line.text)).toContain('1 value to check');
    expect(previewView(d, 'en-GB').primary.enabled).toBe(false);
    const skip = await s.imports.answer(d.draftId, d.mappingVersion, { kind: 'value_check', key: d.analysis.valueChecks[0]?.key ?? '', answer: 'skip' });
    if (!skip.ok) throw new Error('answer');
    expect(skip.draft.analysis.ready).toBe(true);
    const done = await s.imports.commit(skip.draft.draftId, skip.draft.mappingVersion, 'op-commit');
    expect(done).toMatchObject({ ok: true, status: 'finished', written: 2 });
  });
});
