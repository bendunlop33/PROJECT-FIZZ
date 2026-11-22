import { describe, expect, it } from 'vitest';
import type { ImportAnswers } from '@fizz/schemas';
import { analyseImport, applyImportSpec, DEFAULT_ANSWERS, deriveId, importIds, nameKey, parseFitNotesCsv, planImportRows, type ImportContext } from '../src';
import { OWNER } from './fixtures';
import { CANDIDATES, fixture } from './import-fixtures';
import { OPTS, answerAll, specOf, tableOf } from './layout-fixtures';

/** Golden IDs (check 53; ADR 0026): FitNotes IDs are unchanged by `SourceSetRow`, and a layout gives the same IDs every time. */
const JOB = '00000000-0000-4000-8000-00000000a0b9';
const ctx: ImportContext = { ownerId: OWNER, candidates: CANDIDATES, aliases: new Map(), appDates: new Set(), importedDates: new Map(), defaultUnit: 'kg' };

describe('FitNotes IDs are unchanged', () => {
  it('session, session exercise, set and start operation IDs are derived exactly as before', () => {
    expect(importIds.set(JOB, 7)).toBe(deriveId(`fitnotes-import:${JOB}:row:7`));
    expect(importIds.set(JOB, 7, 0)).toBe(deriveId(`fitnotes-import:${JOB}:row:7`));
    expect(importIds.session(JOB, '2026-09-28')).toBe(deriveId(`fitnotes-import:${JOB}:session:2026-09-28`));
    expect(importIds.startOperation('op', '2026-09-28')).toBe('op:2026-09-28');
    // A literal value, computed with the base commit’s formula, so a change to `deriveId` or the seeds can’t pass unnoticed.
    expect(importIds.set('00000000-0000-4000-8000-000000000001', 2)).toBe('e939198c-705e-8da3-a15f-388f4bc6e7dc');
  });

  it('a FitNotes plan stores no layout fields and the old IDs', () => {
    const p = parseFitNotesCsv(fixture('A1-kg.synthetic.csv'), '2026-10-09');
    if (!p.ok) throw new Error('parse');
    const first = analyseImport(p, ctx, DEFAULT_ANSWERS);
    const names = Object.fromEntries(first.names.filter((n) => n.needsAnswer && n.match.exerciseId).map((n) => [n.key, { kind: 'exercise' as const, exerciseId: n.match.exerciseId ?? '' }]));
    const a = analyseImport(p, ctx, { ...DEFAULT_ANSWERS, names, perHandOverrides: { [nameKey('Incline DB Press')]: 'both' }, total: 'total' });
    expect(a.ready).toBe(true);
    const rows = planImportRows(p, a, { jobId: JOB, defaultUnit: 'kg' });
    for (const r of rows) {
      expect(r).not.toHaveProperty('part');
      expect(r).not.toHaveProperty('workoutKey');
      expect(r).not.toHaveProperty('startLocal');
      if (r.result !== 'imported') continue;
      expect(r.setId).toBe(deriveId(`fitnotes-import:${JOB}:row:${String(r.row)}`));
      expect(r.sessionId).toBe(deriveId(`fitnotes-import:${JOB}:session:${r.localDate ?? ''}`));
      expect(r.imported).not.toHaveProperty('setType');
    }
  });
});

describe('layout imports are deterministic', () => {
  const plan = (notation: 'sets_x_reps' | 'reps_x_sets') => {
    const { answers } = answerAll('spreadsheet-sets-x-reps', { unit: 'kg', notation: { '3': notation } });
    const rows = applyImportSpec(specOf('spreadsheet-sets-x-reps.spec.json'), answers, tableOf('spreadsheet-sets-x-reps.synthetic.csv'), OPTS).rows;
    const first = analyseImport({ variant: null, rows }, ctx, DEFAULT_ANSWERS);
    const names: ImportAnswers['names'] = Object.fromEntries(first.names.map((n) => [n.key, n.match.exerciseId ? { kind: 'exercise' as const, exerciseId: n.match.exerciseId } : { kind: 'skip' as const }]));
    const a = analyseImport({ variant: null, rows }, ctx, { ...DEFAULT_ANSWERS, names, total: 'total' });
    return planImportRows({ rows }, a, { jobId: JOB, defaultUnit: 'kg' });
  };

  it('the same file, layout and answers give the same rows and IDs', () => {
    expect(plan('sets_x_reps')).toEqual(plan('sets_x_reps'));
  });

  it('each set of a packed row has its own ID; part 0 keeps the row’s ID', () => {
    const rows = plan('sets_x_reps').filter((r) => r.row === 2);
    expect(rows.map((r) => r.part)).toEqual([0, 1, 2]);
    expect(new Set(rows.map((r) => r.setId)).size).toBe(3);
    expect(rows[0]?.setId).toBe(importIds.set(JOB, 2));
    expect(rows[1]?.setId).toBe(deriveId(`fitnotes-import:${JOB}:row:2:part:1`));
  });

  it('a different answer is a different plan (a commit against the old one is stale)', () => {
    expect(plan('reps_x_sets').length).not.toBe(plan('sets_x_reps').length);
  });
});
