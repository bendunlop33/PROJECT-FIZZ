import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PbLiftStart } from '@fizz/domain';

import { checkHeader, checkRows, expectTable, pbTableUnit } from '../src/plan-builder/plan-builder-view';

/** (Ben, 26 Oct; app review findings 12, 17, 20) The plan builder names kg/lb everywhere and never shows a blank page. */
describe('plan builder units (Ben, 26 Oct)', () => {
  const lift = (key: string, six: number | null, oneRm: number | null): PbLiftStart => ({ key, six, oneRm, estimate: false, open: false }) as unknown as PbLiftStart;
  const name = (k: string) => ({ bench: 'Bench press', row: 'Barbell row', db: 'DB press' })[k] ?? k;

  it('the header names the unit the rows share, else Ben’s own', () => {
    expect(pbTableUnit(['lb', 'lb'], 'kg')).toBe('lb');
    expect(pbTableUnit(['kg', null], 'lb')).toBe('kg');
    expect(pbTableUnit(['kg', 'lb'], 'lb')).toBe('lb');
    expect(pbTableUnit([], 'kg')).toBe('kg');
    expect(checkHeader('lb')).toEqual(['Lift', '6 reps (lb)', '1RM est. (lb)']);
  });

  it('Check your lifts: values under a kg header stay bare; a lb item at a kg gym carries its unit; per hand says each', () => {
    const rows = checkRows([lift('bench', 100, 116), lift('db', 24, 28), lift('row', 135, 155)], name, (k) => k === 'db', (k) => (k === 'row' ? 'lb' : 'kg'), 'kg');
    expect(rows.map((r) => [r.six, r.oneRm])).toEqual([
      ['100', '116'],
      ['24 each', '28 each'],
      ['135 lb', '155 lb'],
    ]);
  });

  it('What to expect: `lb × 6`, not a hard-coded `kg × 6`', () => {
    const t = expectTable({ reps: 6, rows: [{ key: 'bench', now: 225, end: 240, perHand: false }] }, 6, name, () => 'lb', 'kg');
    expect(t.head).toEqual(['lb × 6', 'Now', 'Week 6 (est.)']);
    expect(t.rows[0]?.cells).toEqual(['Bench press', '225', '240']);
    const kg = expectTable({ reps: 8, rows: [{ key: 'db', now: 24, end: null, perHand: true }] }, 4, name, () => 'kg', 'lb');
    expect(kg.head[0]).toBe('kg × 8');
    expect(kg.rows[0]?.cells).toEqual(['DB press', '24 each', '—']);
  });

  const screen = readFileSync(join(import.meta.dirname, '../src/screens/plan/PlanSetupScreen.tsx'), 'utf8');
  it('the screen has no hard-coded kg header and uses the session’s unit', () => {
    expect(screen).not.toContain('`kg × ${');
    expect(screen).toContain('expectTable(expect, answers.weeks, s.nameOf, unitOf, s.unit)');
    expect(screen).toContain('<TableRow cells={checkHeader(headUnit)} head />');
  });

  it('loading shows the frame with Close at once and a light skeleton after a beat, never a blank page', () => {
    expect(screen).not.toContain('return <Screen>{null}</Screen>');
    expect(screen).toContain('return <PlanSetupLoading placeholder={placeholder} onClose={() => { navigation.goBack(); }} />;');
    const loading = screen.slice(screen.indexOf('function PlanSetupLoading('));
    expect(loading).toContain('<TextButton label={C.close}');
    expect(loading).toContain('{placeholder ? (');
    expect(screen).toContain('theme.timing.placeholderDelay');
  });
});
