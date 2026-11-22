import { describe, expect, it } from 'vitest';

import { offsetHolding, periodBar, periodRange, PERIOD_SPANS } from '../src/index';

/** (Redesign v3 C2, Ben 27 Oct) The one period bar: Week | Month | 3M | 6M | 1Y, ‹ › steps a whole period. */

const TODAY = '2026-10-27'; // a Tuesday

describe('periodRange: calendar-aligned periods', () => {
  it('week is Monday–Sunday; month is the calendar month; 3M/6M/1Y end in the month stepped to', () => {
    expect(periodRange(TODAY, 'week', 0)).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(periodRange(TODAY, 'week', -1)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(periodRange(TODAY, 'month', 0)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange(TODAY, 'month', -1)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange(TODAY, 'month', -10)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange(TODAY, '3m', 0)).toEqual({ from: '2026-08-01', to: '2026-10-31' });
    expect(periodRange(TODAY, '3m', -1)).toEqual({ from: '2026-05-01', to: '2026-07-31' });
    expect(periodRange(TODAY, '6m', 0)).toEqual({ from: '2026-05-01', to: '2026-10-31' });
    expect(periodRange(TODAY, '1y', 0)).toEqual({ from: '2025-11-01', to: '2026-10-31' });
    expect(periodRange('2026-03-31', 'month', -1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('2028-03-15', 'month', -1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('periodBar', () => {
  it('Month now: counted to today, previous is the whole of September, `vs Sep`', () => {
    const b = periodBar({ today: TODAY, span: 'month', offset: 0, earliest: '2025-01-06' });
    expect(b.title).toBe('October 2026');
    expect(b.datesLine).toBeNull();
    expect(b.window.from).toBe('2026-10-01');
    expect(b.window.to).toBe(TODAY);
    expect(b.window.days).toBe(27);
    expect(b.window.previous).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(b.previousLabel).toBe('Sep');
    expect(b.phrase).toBe('in October');
    expect(b.canBack).toBe(true);
    expect(b.canForward).toBe(false);
  });

  it('a stepped-back month counts the whole month; January compares with December and says its year', () => {
    const b = periodBar({ today: TODAY, span: 'month', offset: -9, earliest: '2025-01-06' });
    expect(b.title).toBe('January 2026');
    expect(b.window).toMatchObject({ from: '2026-01-01', to: '2026-01-31', days: 31 });
    expect(b.previousLabel).toBe('Dec 2025');
    expect(b.canForward).toBe(true);
  });

  it('Week: dates title, `last week` for the current week', () => {
    const b = periodBar({ today: TODAY, span: 'week', offset: 0, earliest: '2025-01-06' });
    expect(b.full).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(b.window.to).toBe(TODAY);
    expect(b.previousLabel).toBe('last week');
    expect(b.phrase).toBe('this week');
    const prev = periodBar({ today: TODAY, span: 'week', offset: -1, earliest: '2025-01-06' });
    expect(prev.window).toMatchObject({ from: '2026-10-19', to: '2026-10-25', days: 7 });
    expect(prev.previousLabel).not.toBe('last week');
  });

  it('3M: month-span title and the counted dates under it', () => {
    const b = periodBar({ today: TODAY, span: '3m', offset: 0, earliest: '2025-01-06' });
    expect(b.title).toBe('Aug – Oct 2026');
    expect(b.datesLine).toBe('1 Aug – 27 Oct');
    expect(b.previousLabel).toBe('May – Jul');
    const y = periodBar({ today: TODAY, span: '1y', offset: 0, earliest: '2025-01-06' });
    expect(y.title).toBe('Nov 2025 – Oct 2026');
  });

  it('‹ stops at the period holding the first log; › never goes past now; positive offsets clamp to 0', () => {
    expect(periodBar({ today: TODAY, span: 'month', offset: 0, earliest: '2026-10-03' }).canBack).toBe(false);
    expect(periodBar({ today: TODAY, span: 'month', offset: 0 }).canBack).toBe(false);
    expect(periodBar({ today: TODAY, span: 'month', offset: 0, earliest: '2026-09-30' }).canBack).toBe(true);
    expect(periodBar({ today: TODAY, span: 'month', offset: 3, earliest: '2026-01-01' }).offset).toBe(0);
  });

  it('every span has a label and a preset for the coach', () => {
    expect(PERIOD_SPANS.map((p) => p.label)).toEqual(['Week', 'Month', '3M', '6M', '1Y']);
    for (const p of PERIOD_SPANS) expect(periodBar({ today: TODAY, span: p.key, offset: 0 }).preset).toMatch(/^(1m|3m|6m|1y)$/);
  });
});

describe('offsetHolding: a span change keeps the place', () => {
  it('finds the period holding a date', () => {
    expect(offsetHolding(TODAY, 'month', '2026-09-30')).toBe(-1);
    expect(offsetHolding(TODAY, 'month', TODAY)).toBe(0);
    expect(offsetHolding(TODAY, 'week', '2026-09-30')).toBe(-4);
    expect(offsetHolding(TODAY, 'week', '2026-10-26')).toBe(0);
    expect(offsetHolding(TODAY, '3m', '2026-08-01')).toBe(0);
    expect(offsetHolding(TODAY, '3m', '2026-07-31')).toBe(-1);
    expect(offsetHolding(TODAY, '1y', '2025-11-01')).toBe(0);
    expect(offsetHolding(TODAY, '1y', '2025-10-31')).toBe(-1);
    // A future date (the rest of this week) is today's period.
    expect(offsetHolding(TODAY, 'month', '2026-11-01')).toBe(0);
    for (const span of ['week', 'month', '3m', '6m', '1y'] as const) {
      for (const d of ['2025-02-14', '2025-12-31', '2026-01-01', '2026-06-15']) {
        const r = periodRange(TODAY, span, offsetHolding(TODAY, span, d));
        expect(d >= r.from && d <= r.to, `${span} ${d}`).toBe(true);
      }
    }
  });
});
