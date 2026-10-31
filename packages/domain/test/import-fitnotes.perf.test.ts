import { describe, expect, it } from 'vitest';
import { parseFitNotesCsv } from '../src/import';

/** Timing budget for the FitNotes CSV parser. Perf lane only: `npm run test:perf`. */
const TODAY = '2026-10-09';

describe('FitNotes CSV parser speed', () => {
  it('parses a 10,000-row file quickly', () => {
    const lines = ['Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time'];
    for (let i = 0; i < 10_000; i += 1) lines.push(`2024-0${String((i % 9) + 1)}-1${String(i % 9)},Exercise ${String(i % 40)},Chest,${String(20 + (i % 50))}.0,${String(5 + (i % 8))},,,`);
    const t0 = performance.now();
    const p = parseFitNotesCsv(lines.join('\n'), TODAY);
    const ms = performance.now() - t0;
    expect(p.ok && p.rows.length).toBe(10_000);
    expect(ms).toBeLessThan(1500);
  });
});
