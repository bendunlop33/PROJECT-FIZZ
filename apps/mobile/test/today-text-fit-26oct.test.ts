import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AX_FONT_SCALE } from '../src/workout/screen-rules';
import { DAY_LIST_FONT_SCALE, dayRowAsList, TODAY_TEXT_FIT, todayWeekStacked } from '../src/today/today-view';

/**
 * (Ben, 26 Oct; app review finding 14) Today's labels at large text and 320 pt: shrink to fit, never cut; the day
 * row becomes `Day  Chest ›` from xxxLarge; the week line goes under the day name when the header has no room.
 * iOS font scales (RN): Large 1.0, xLarge 1.118, xxLarge 1.235, xxxLarge 1.353, AX1 1.647.
 */
describe('Today text fit (Ben, 26 Oct)', () => {
  it('the day row is a list from xxxLarge, before AX1', () => {
    expect(DAY_LIST_FONT_SCALE).toBeLessThan(AX_FONT_SCALE);
    expect(dayRowAsList(1.0)).toBe(false);
    expect(dayRowAsList(1.235)).toBe(false);
    expect(dayRowAsList(1.353)).toBe(true);
    expect(dayRowAsList(1.647)).toBe(true);
  });

  it('segment labels shrink to fit on one line and stop growing where the list takes over', () => {
    expect(TODAY_TEXT_FIT.segmentLabel).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true });
    expect(TODAY_TEXT_FIT.segmentLabel.minimumFontScale).toBeLessThanOrEqual(0.75);
    expect(TODAY_TEXT_FIT.segmentLabel.maxFontSizeMultiplier).toBeLessThanOrEqual(DAY_LIST_FONT_SCALE);
  });

  it('the week line stacks under the name at 320 pt or from xLarge; beside it on a 375 pt phone at default sizes', () => {
    expect(todayWeekStacked(375, 1.0)).toBe(false);
    expect(todayWeekStacked(430, 1.0)).toBe(false);
    expect(todayWeekStacked(320, 1.0)).toBe(true);
    expect(todayWeekStacked(375, 1.118)).toBe(true);
    expect(todayWeekStacked(390, 1.353)).toBe(true);
  });

  const src = readFileSync(join(import.meta.dirname, '../src/screens/today/TodaySession.tsx'), 'utf8');
  it('the screen uses them (no bare numberOfLines={1} on the segment label)', () => {
    const day = src.slice(src.indexOf('export function DayControl('), src.indexOf('export function SessionListSheet('));
    expect(day).toContain('const asList = dayRowAsList(useWindowDimensions().fontScale);');
    expect(day).toContain('{...TODAY_TEXT_FIT.segmentLabel}');
    expect(day).not.toContain("numberOfLines={1} style={{ fontSize: 15 }}");
    const header = src.slice(src.indexOf('export function TodayHeader('), src.indexOf('// The 7-day strip'));
    expect(header).toContain('todayWeekStacked(width, fontScale)');
    expect(header).toContain('{stacked ? weekLink : null}');
  });
});
