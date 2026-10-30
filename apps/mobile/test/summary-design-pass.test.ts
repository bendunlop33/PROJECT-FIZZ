import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { summaryPlanLine, summaryResultsLine, VERDICT_ICON } from '../src/workout/summary-view';

/**
 * Design pass batch 3 (Ben approved 20 Oct): the Summary. Each exercise is at
 * most 3 lines (name + verdict Tag; the sets logged with their unit note; one
 * plan line), a lighter load that set `Short` names the planned load, and the
 * stat strip replaces the tile grid. Layout on the phone goes on Ben's checklist.
 */

const flat = (s: string) => s.replace(/\s+/g, ' ');
const src = flat(readFileSync(join(__dirname, '..', 'src', 'screens', 'workout', 'SummaryScreen.tsx'), 'utf8'));

describe('summaryPlanLine', () => {
  const ex = { setsText: '3 sets (kg each)', unitNote: '(kg each)', skipped: 0, sides: null };

  it('with a plan: the short line, the verdict spoken (replaceAll, not the first dot only)', () => {
    const r = summaryPlanLine(ex, { short: '3/3 · of 8 · 100 kg planned', verdict: 'short' });
    expect(r.text).toBe('3/3 · of 8 · 100 kg planned');
    expect(r.spoken).toBe('Plan: 3/3, of 8, 100 kg planned. Short.');
  });

  it('with a plan and uneven sides: the sides join the same line', () => {
    expect(summaryPlanLine({ ...ex, sides: 'L 8 reps · R 7 reps' }, { short: '3/3 · of 8', verdict: 'hit' }).text).toBe('3/3 · of 8 · L 8 reps · R 7 reps');
  });

  it('no plan: the count without its unit note, and skipped sets', () => {
    expect(summaryPlanLine({ ...ex, skipped: 1 }, null).text).toBe('3 sets · 1 skipped');
    expect(summaryPlanLine({ setsText: '1 set', unitNote: '', skipped: 0, sides: null }, null).text).toBe('1 set');
  });

  it('the unit note moves onto the results line', () => {
    expect(summaryResultsLine({ results: '22.5×8 · 22.5×8', unitNote: '(kg each)' })).toBe('22.5×8 · 22.5×8 (kg each)');
    expect(summaryResultsLine({ results: '100×8', unitNote: '' })).toBe('100×8');
    expect(summaryResultsLine({ results: '', unitNote: '(kg each)' })).toBe('');
  });

  it('every verdict has an icon beside its word', () => {
    expect(Object.keys(VERDICT_ICON).sort()).toEqual(['hit', 'over', 'short']);
  });
});

describe('SummaryScreen layout (source checks)', () => {
  it('uses the shared StatStrip, not the tile grid, and caps the hero title at 2 lines', () => {
    expect(src).toContain('<StatStrip');
    expect(src).not.toContain('<StatGrid');
    expect(src).toContain('titleLines={2}');
  });

  it('(Ben, 30 Oct) exercise row: one line, the name truncates first, then its sets said once; no plan-header lines', () => {
    expect(src).toContain('<AppText variant="body" numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1, flexShrink: 1 }}> {e.name}');
    expect(src).toContain('{e.line}');
    expect(src).not.toContain('skipped`}</AppText>');
    expect(src).not.toContain('planVsDone.header');
  });

  it('(Ben, 30 Oct) a Next time row is one line: the name truncates, the value never shrinks; no orphan Coach note label', () => {
    expect(src).toContain('<AppText variant="callout" numeric numberOfLines={1} style={{ flexShrink: 0 }}> {text}');
    expect(src).not.toMatch(/flexWrap: 'wrap', justifyContent: 'space-between'/);
    expect(src).toContain('{coachNote !== null ? <SectionHeader title="Coach note" /> : null}');
  });
});
