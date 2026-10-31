import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FREQUENCY_COLUMNS, FREQUENCY_HEADERS, sectionLabelWidth } from '../src/progress/frequency-columns';

/** F16 (13 Oct screenshots): `SESSIONS` wrapped to `SESSION / S`; the Ask pill covered the table's end. */
describe('Muscles table layout (F16)', () => {
  it('every header fits its column on one line at the default size', () => {
    for (const k of ['sessions', 'sets', 'perWeek'] as const) {
      expect(sectionLabelWidth(FREQUENCY_HEADERS[k]), k).toBeLessThanOrEqual(FREQUENCY_COLUMNS[k]);
    }
  });

  it('headers never wrap, and rows use the same column widths', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'progress', 'components.tsx'), 'utf8');
    const header = src.slice(src.indexOf('export function FrequencyHeader'), src.indexOf('export function FrequencyRow'));
    expect(header).toContain('numberOfLines={1}');
    expect(header).not.toMatch(/width: \d+, textAlign/);
    expect(src).toContain('width: FREQUENCY_COLUMNS.sessions');
  });

  it('a screen with the floating Ask pill leaves room for all of it under the content', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'ui', 'layout.tsx'), 'utf8');
    expect(src).toContain('(showFloating ? FLOATING_PILL_ROOM : 0)');
    const pill = readFileSync(join(__dirname, '..', 'src', 'screens', 'coach', 'AskPill.tsx'), 'utf8');
    expect(pill).toContain('minHeight: 44');
    expect(pill).toContain("bottom: bottom ?? theme.space['4']");
    // 44 pt pill + 16 pt lift + a 16 pt gap.
    expect(src).toContain('FLOATING_PILL_ROOM = 44 + 16 + 16');
  });
});
