import { describe, expect, it } from 'vitest';
import { EMPTY_LAYOUT_ANSWERS } from '@fizz/schemas';
import { detectLayoutFile, readTable, requiredHeaders } from '../src';
import { fixture } from './import-fixtures';
import { layoutText, profileFor } from './layout-fixtures';

/** Detection on the phone (data-import-export §9.3.1; checks 55, 56). Nothing here sends anything. */
describe('detectLayoutFile', () => {
  it('a FitNotes export is still FitNotes (the built-in parser, offline)', () => {
    expect(detectLayoutFile(fixture('A1-kg.synthetic.csv'), []).kind).toBe('fitnotes');
  });

  it('a Strong export (semicolons, quoted) is a new table with its exact header', () => {
    const d = detectLayoutFile(layoutText('strong-new-kg.synthetic.csv'), []);
    expect(d.kind).toBe('new_table');
    if (d.kind !== 'new_table') return;
    expect(d.table.delimiter).toBe(';');
    expect(d.table.header).toHaveLength(13);
    expect(d.table.header[6]).toBe('Weight (kg)');
    expect(d.table.records).toHaveLength(15);
    expect(d.firstLine.startsWith('"Workout #";"Date"')).toBe(true);
  });

  it('Hevy dates with commas inside quotes keep the comma delimiter and 14 columns', () => {
    const t = readTable(layoutText('hevy-kg.synthetic.csv'));
    expect(t?.delimiter).toBe(',');
    expect(t?.header).toHaveLength(14);
    expect(t?.records[0]?.cells[1]).toBe('22 Dec 2025, 08:00');
  });

  it.each([
    ['', 'empty'],
    ['PK\u0003\u0004 zip bytes', 'spreadsheet_file'],
    ['%PDF-1.7 …', 'pdf_or_image'],
    ['\u0089PNG\r\n…', 'pdf_or_image'],
    ['SQLite format 3\u0000…', 'app_backup'],
    ['Bench press felt good\nSquat was heavy\n', 'no_numbers'],
    ['### WORKOUT SESSIONS ###\n_id,mydate,starttime\n1,2025-01-01,1735725600\n### EXERCISE LOGS ###\nbelongsession,ename,logs\n1,Bench,"100x5,100x5"\n', 'sections'],
    ['Mon 6 Oct\nBench 3x5 @ 100\nSquat 100x5, 105x5\n', 'not_a_table'],
  ])('%j is not readable as a table (%s)', (text, reason) => {
    const d = detectLayoutFile(text, []);
    expect(d).toMatchObject({ kind: 'not_readable', reason });
  });

  it('needs 2 columns, 2 data rows and the header’s cell count on 95% of rows', () => {
    expect(readTable('a,b\n1,2\n')).toBeNull();
    expect(readTable('a\n1\n2\n')).toBeNull();
    const ragged = ['a,b,c', ...Array.from({ length: 10 }, (_, i) => (i < 2 ? '1,2' : '1,2,3'))].join('\n');
    expect(readTable(ragged)).toBeNull();
    const nearly = ['a,b,c', ...Array.from({ length: 40 }, (_, i) => (i < 1 ? '1,2' : '1,2,3'))].join('\n');
    expect(readTable(nearly)?.header).toEqual(['a', 'b', 'c']);
  });
});

describe('saved layouts (AI12; checks 55, 56)', () => {
  const answers = { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done' as const };

  it('the same header cells, delimiter and sections use the saved layout, offline', () => {
    const p = profileFor('strong-new-kg', answers);
    const d = detectLayoutFile(layoutText('strong-new-kg.synthetic.csv'), [p]);
    expect(d).toMatchObject({ kind: 'saved_layout', profileId: p.id, version: 1 });
  });

  it('a deleted layout is never used', () => {
    const p = profileFor('strong-new-kg', answers, { deletedAt: { utc: '2026-10-12T10:00:00.000Z', tz: 'Europe/London' } });
    expect(detectLayoutFile(layoutText('strong-new-kg.synthetic.csv'), [p]).kind).toBe('new_table');
  });

  it('one extra column: changed columns, asking only about that column', () => {
    const p = profileFor('strong-new-kg', answers);
    const text = layoutText('strong-new-kg.synthetic.csv')
      .split('\n')
      .map((l, i) => (l === '' ? l : `${l};${i === 0 ? '"Rest Timer (sec)"' : '"90"'}`))
      .join('\n');
    const d = detectLayoutFile(text, [p]);
    expect(d).toMatchObject({ kind: 'saved_layout_changed', added: [13], missing: [] });
  });

  it('a removed optional column (RPE) is still the layout; a missing load column makes a new layout', () => {
    const p = profileFor('strong-new-kg', answers);
    const drop = (col: number) =>
      layoutText('strong-new-kg.synthetic.csv')
        .split('\n')
        .map((l) => (l === '' ? l : l.split(';').filter((_, i) => i !== col).join(';')))
        .join('\n');
    expect(detectLayoutFile(drop(8), [p])).toMatchObject({ kind: 'saved_layout_changed', added: [], missing: ['RPE'] });
    expect(detectLayoutFile(drop(6), [p]).kind).toBe('new_table');
    expect(requiredHeaders(p)).toEqual(['Date', 'Exercise Name', 'Weight (kg)', 'Reps']);
  });

  it('another delimiter is another layout', () => {
    const p = profileFor('strong-new-kg', answers);
    const commas = layoutText('strong-new-kg.synthetic.csv').replace(/;/g, ',');
    expect(detectLayoutFile(commas, [p]).kind).toBe('new_table');
  });
});
