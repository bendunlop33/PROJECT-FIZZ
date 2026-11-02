import { describe, expect, it } from 'vitest';

import { PB_EFFORTS, PB_FOCUSES, PB_GROUP_LIST, PB_WEEKDAYS, PB_WEEKS, expectTable, checkHeader } from '../src/plan-builder/plan-builder-view';
import { RECOMMENDED_MARK_WIDTH, chipColumnCandidates, chipGrid, chipLabelRoom, estimateLabelWidth, tableValueWidths } from '../src/ui/chip-fit';

/**
 * (Ben, 2 Nov, screenshot of Plan setup › Gym goals: "This page formatting is broken") `Strengt / h`, `Balance / d`,
 * `4 / weeks`: four chips across a 390 pt phone left ~60 pt for a label. The grid now drops columns until the widest
 * label (with its inline ✦) fits on one line, at 320 / 375 / 390 pt and with larger Dynamic Type.
 */

// The screen's content width: the phone less 2 × 20 pt margins (direction B).
const content = (phone: number) => phone - 40;
const PHONES = [320, 375, 390] as const;
const SCALES = [1, 1.235, 1.353, 1.5, 2, 3] as const;
// `✦ ` in a test label is the chip's inline mark (`recommended`), measured as the screen does.
const grid = (labels: readonly string[], phone: number, fontScale: number, columns = labels.length, tight = false) =>
  chipGrid({ labels: labels.map(bare), marked: labels.map((l) => l.startsWith('✦ ')), width: content(phone), columns, fontScale, gap: tight ? 4 : 8, inset: tight ? 5 : 13 });
const bare = (l: string) => l.replace(/^✦ /, '');
const est = (l: string, scale: number) => estimateLabelWidth(bare(l), 16, scale) + (l.startsWith('✦ ') ? RECOMMENDED_MARK_WIDTH * scale : 0);

const LENGTH = PB_WEEKS.map((w) => `${w === 6 ? '✦ ' : ''}${String(w)} weeks`);
const EFFORT = PB_EFFORTS.map((e) => `${e.key === 'standard' ? '✦ ' : ''}${e.label}`);
const FOCUS = PB_FOCUSES.map((f) => `${f.key === 'balanced' ? '✦ ' : ''}${f.label}`);
const GROUPS: { name: string; labels: string[]; columns?: number; tight?: boolean }[] = [
  { name: 'Plan length', labels: LENGTH },
  { name: 'Effort', labels: EFFORT },
  { name: 'Main focus', labels: FOCUS },
  { name: 'Priorities', labels: ['No', 'Yes'] },
  { name: 'Groups', labels: [...PB_GROUP_LIST], columns: 3 },
  { name: 'Weekdays', labels: [...PB_WEEKDAYS], tight: true },
  { name: 'A preference', labels: ['✦ Chest-supported', 'Barbell', 'Other…', 'No preference'], columns: 2 },
];

describe('chip label widths (SF Pro estimate)', () => {
  it('is at least the real width of the screenshot labels (16 pt, scale 1)', () => {
    // Measured from Ben's screenshot (3× px / 3): Standard ≈ 67 pt, Strength ≈ 66 pt, weeks ≈ 50 pt.
    expect(estimateLabelWidth('Standard', 16, 1)).toBeGreaterThanOrEqual(67);
    expect(estimateLabelWidth('Strength', 16, 1)).toBeGreaterThanOrEqual(66);
    expect(estimateLabelWidth('weeks', 16, 1)).toBeGreaterThanOrEqual(50);
    expect(estimateLabelWidth('Strength', 16, 2)).toBeCloseTo(2 * estimateLabelWidth('Strength', 16, 1));
  });
});

describe('chipGrid', () => {
  it('the screenshot case: four focus chips at 390 pt go 2 × 2 (Strength, ✦ Balanced on one line)', () => {
    const g = grid(FOCUS, 390, 1);
    expect(g).toEqual({ columns: 2, oneLine: true });
  });

  it('plan length: 4 weeks … 12 weeks fit as a 2 × 2 grid, not `4 wk`', () => {
    for (const phone of PHONES) expect(grid(LENGTH, phone, 1)).toEqual({ columns: 2, oneLine: true });
  });

  it('effort keeps three across at 390 pt and drops to one column, never 2 + 1', () => {
    expect(grid(EFFORT, 390, 1).columns).toBe(3);
    expect(chipColumnCandidates(3, 3)).toEqual([3, 1]);
    expect(chipColumnCandidates(7, 7)).toEqual([7, 4, 1]);
    expect(chipColumnCandidates(6, 3)).toEqual([3, 2, 1]);
    expect(chipColumnCandidates(4, 4)).toEqual([4, 2, 1]);
  });

  it('every Plan setup group, every width and Dynamic Type size: the widest label fits its chip, or wraps at word boundaries in a full-width chip', () => {
    for (const g of GROUPS)
      for (const phone of PHONES)
        for (const scale of SCALES) {
          const r = grid(g.labels, phone, scale, g.columns ?? g.labels.length, g.tight === true);
          const room = chipLabelRoom(content(phone), r.columns, g.tight === true ? 4 : 8, g.tight === true ? 5 : 13);
          const widest = Math.max(...g.labels.map((l) => est(l, Math.min(scale, 3))));
          if (r.oneLine) expect(widest, `${g.name} @${String(phone)} ×${String(scale)}`).toBeLessThanOrEqual(room);
          else {
            expect(r.columns).toBe(1);
            // No single word is wider than a full-width chip, so wrapping is between words only (iOS breaks after a hyphen).
            const words = g.labels.map(bare).flatMap((l) => l.split(/ |(?<=-)/));
            for (const w of words) expect(estimateLabelWidth(w, 16, Math.min(scale, 3)), `${g.name} "${w}" @${String(phone)} ×${String(scale)}`).toBeLessThanOrEqual(room);
          }
        }
  });

  it('weekdays stay seven across at 390 pt (default size) and go 4 + 3 when they would not fit', () => {
    expect(grid([...PB_WEEKDAYS], 390, 1, 7, true).columns).toBe(7);
    expect(grid([...PB_WEEKDAYS], 320, 1, 7, true).columns).toBe(4);
  });
});

describe('tableValueWidths: `Week 6 (est.)` on one line', () => {
  const t = expectTable({ reps: 6, rows: [{ key: 'bench', now: 80, end: 85, perHand: false }, { key: 'db', now: 24, end: 26, perHand: true }] }, 12, (k) => (k === 'bench' ? 'Barbell bench press' : 'Dumbbell incline press'), () => 'kg', 'kg');
  const cells = [t.head, ...t.rows.map((r) => r.cells)];
  it('the value columns are sized to their widest cell, the header included (Week 12, the longest), at 320–390 pt', () => {
    for (const phone of PHONES) {
      const w = tableValueWidths({ rows: cells, width: content(phone) - 32, fontScale: 1 });
      // Within a point (rounding); the cell's shrink-to-fit covers the rest.
      expect(w[1]).toBeGreaterThanOrEqual(Math.floor(estimateLabelWidth('Week 12 (est.)', 16, 1)));
      expect(w[0]).toBeGreaterThanOrEqual(Math.floor(estimateLabelWidth('24 each', 16, 1)));
    }
  });
  it('the screenshot case: Week 6 (est.) at 390 pt fits outright', () => {
    const six = expectTable({ reps: 6, rows: [{ key: 'bench', now: 80, end: 85, perHand: false }] }, 6, () => 'Bench', () => 'kg', 'kg');
    const w = tableValueWidths({ rows: [six.head, ...six.rows.map((r) => r.cells)], width: content(390) - 32, fontScale: 1 });
    expect(six.head[2]).toBe('Week 6 (est.)');
    expect(w[1]).toBeGreaterThanOrEqual(estimateLabelWidth('Week 6 (est.)', 16, 1));
  });
  it('at large Dynamic Type the values share at most 75% of the row, the name keeps the rest (cells then shrink to fit)', () => {
    const width = content(320) - 32;
    const w = tableValueWidths({ rows: [checkHeader('kg'), ['Bench', '100 kg', '120 kg']], width, fontScale: 3 });
    expect(w.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual((width - 16) * 0.75);
  });
});
