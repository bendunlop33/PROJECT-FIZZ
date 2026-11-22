import { describe, expect, it } from 'vitest';
import { ImportSampleV1Schema } from '@fizz/schemas';
import { buildImportSample, columnKind, readTable, sampleRowIndexes, SAMPLE_ROWS_MAX } from '../src';
import { layoutText, tableOf } from './layout-fixtures';

/** What a layout request sends (AI8, §9.6.1; checks 36, 37). */
describe('column kinds (§9.2.3)', () => {
  it('free text: a value over 40 characters, or more than half the values unique and with spaces', () => {
    expect(columnKind(['short', 'x'.repeat(41)])).toBe('notes');
    expect(columnKind(['felt good', 'knee ok today', 'tired', ''])).toBe('notes');
    expect(columnKind(['Bench Press', 'Bench Press', 'Squat', 'Squat'])).toBe('short_text');
    expect(columnKind(['100', '82.5', '', '-20'])).toBe('number');
    expect(columnKind(['2025-03-04 07:10:00', '2025-03-04 07:10:00'])).toBe('date');
    expect(columnKind(['', ''])).toBe('short_text');
  });
});

describe('buildImportSample', () => {
  it('is JSON of exactly the sample object, with the header and at most 30 rows chosen by code', () => {
    const big = ['Date,Exercise,Weight,Reps,Set Type', ...Array.from({ length: 200 }, (_, i) => `2025-01-${String((i % 28) + 1).padStart(2, '0')},Ex ${String(i % 7)},${String(50 + i)},${String(5 + (i % 3))},${i === 150 ? 'W' : '1'}`)].join('\n');
    const t = readTable(big);
    if (!t) throw new Error('table');
    const s = buildImportSample(t, { hidden: [] });
    expect(ImportSampleV1Schema.safeParse(JSON.parse(s.json)).success).toBe(true);
    expect(s.json).toBe(JSON.stringify(s.sample));
    expect(s.chars).toBe(s.json.length);
    expect(s.sample.rows.length).toBeLessThanOrEqual(SAMPLE_ROWS_MAX);
    expect(s.sample.header).toEqual(['Date', 'Exercise', 'Weight', 'Reps', 'Set Type']);
    const idx = sampleRowIndexes(t);
    // The first 10 and last 5 rows, and the one row with the rare marker `W`.
    for (const i of [0, 9, 195, 199, 150]) expect(idx).toContain(i);
    expect(s.sample.rows.map((r) => r.line)).toEqual([...s.sample.rows.map((r) => r.line)].sort((a, b) => a - b));
  });

  it('is the same text for the same file and hidden columns (check 36), and hiding a column changes it', () => {
    const t = tableOf('strong-new-kg.synthetic.csv');
    const a = buildImportSample(t, { hidden: [] });
    const b = buildImportSample(tableOf('strong-new-kg.synthetic.csv'), { hidden: [] });
    expect(a.json).toBe(b.json);
    const hidden = buildImportSample(t, { hidden: [2] });
    expect(hidden.json).not.toBe(a.json);
    expect(hidden.sample.rows.every((r) => r.cells[2] === '[hidden]')).toBe(true);
    expect(hidden.columns[2]).toMatchObject({ hidden: true, masked: true });
  });

  it('masks free-text columns as [text, n chars] whatever Ben switches, and never sends their text (check 37)', () => {
    const t = tableOf('injection-notes.synthetic.csv');
    const s = buildImportSample(t, { hidden: [] });
    expect(s.columns[4]).toMatchObject({ kind: 'notes', masked: true, hidden: false });
    for (const r of t.records) {
      const note = r.cells[4] ?? '';
      expect(s.json).not.toContain(note);
      expect(s.json).not.toContain(note.slice(0, 15));
    }
    expect(s.json).not.toContain('ZQX-MARKER');
    expect(s.json).not.toContain('ignore previous');
    expect(s.json).not.toContain('example.invalid');
    expect(s.sample.rows[0]?.cells[4]).toBe(`[text, ${String((t.records[0]?.cells[4] ?? '').length)} chars]`);
  });

  it('holds only the file sample: no file name, no app data, no instructions', () => {
    const s = buildImportSample(tableOf('strong-new-kg.synthetic.csv'), { hidden: [] });
    expect(Object.keys(JSON.parse(s.json) as object).sort()).toEqual(['delimiter', 'header', 'kind', 'rows', 'sections', 'v']);
    expect(s.json).not.toContain('.csv');
  });

  it('keeps every Strong workout note out of the request (notes columns are masked)', () => {
    const t = tableOf('strong-new-kg.synthetic.csv');
    const s = buildImportSample(t, { hidden: [] });
    expect(s.json).not.toContain('Paused first rep');
    expect(s.json).not.toContain('Early session');
    expect(s.json).toContain('Bench Press (Barbell)');
  });
});

describe('the sample is deterministic from the text alone', () => {
  it('two parses of the same text give the same JSON', () => {
    const text = layoutText('hevy-kg.synthetic.csv');
    const a = readTable(text);
    const b = readTable(text);
    if (!a || !b) throw new Error('table');
    expect(buildImportSample(a, { hidden: [3] }).json).toBe(buildImportSample(b, { hidden: [3] }).json);
  });
});
