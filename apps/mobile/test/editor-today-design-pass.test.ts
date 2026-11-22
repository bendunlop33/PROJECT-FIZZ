import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Design pass batch 5 (Ben approved 20 Oct): Today rows. The workout editor
 * and its set sheet (5.1–5.3) were retired with the old editor (Ben, 23 Oct:
 * one editor, on Your workout's page; one-editor.test.ts).
 */

const SRC = join(__dirname, '..', 'src');
const flat = (s: string) => s.replace(/\s+/g, ' ');
const today = flat(readFileSync(join(SRC, 'screens', 'TodayScreen.tsx'), 'utf8'));
const rowText = flat(readFileSync(join(SRC, 'ui', 'row-text.tsx'), 'utf8'));

describe('5.4 Today rows stack at AX; the detail shrinks right-aligned below it', () => {
  it('RowText', () => {
    expect(rowText).toContain('fontScale >= AX_FONT_SCALE');
    expect(rowText).toContain("style={{ flexShrink: 1, textAlign: 'right' }}");
    // Today (v2), workout-builder-v3 §2.0.9: Recent and the routine rows are superseded (the strip and the day
    // control); the Resume detail rows keep RowText.
    expect(today.match(/<RowText /g)?.length).toBe(1);
    expect(today).not.toMatch(/<AppText variant="body" numberOfLines=\{1\} style=\{\{ flex: 1 \}\}>\s*\{row\.title\}/);
  });

  it('the stale card’s end time is a hero line; Finish is one word', () => {
    expect(today).toContain('`Ended about ${formatTime(toMs(main.endedAboutUtc), zoned.tz)}`');
    // Review S5: no second, near-identical time beside it.
    expect(today).toContain('main.lastSetAtUtc && !main.endedAboutUtc ? `Last set logged at');
    expect(today).not.toContain('Finish (ended about');
  });
});
