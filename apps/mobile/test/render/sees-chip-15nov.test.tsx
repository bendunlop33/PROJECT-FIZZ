import { act } from 'react';
import { createRoot, type TestInstance } from 'test-renderer';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { seesChipParts, seesLabel } from '../../src/coach/sheet-view';
import { SeesChip } from '../../src/screens/coach/SeesChip';
import { ThemeProvider } from '../../src/theme';

/**
 * (Ben, 15 Nov, build 568) `Sees: Push B · Dumbbell shoulder press (live)` wrapped to two lines and overlapped the reply
 * above it. The chip is one line: the label's middle is cut with an ellipsis, `(live)` stays whole, and the pill is
 * never wider than the footer.
 */

const noop = () => undefined;
const flat = (s: unknown): Record<string, unknown> => (Array.isArray(s) ? (Object.assign({}, ...(s as unknown[]).map(flat)) as Record<string, unknown>) : ((s ?? {}) as Record<string, unknown>));

async function chip(label: string): Promise<{ texts: TestInstance[]; pill: TestInstance | undefined; unmount: () => void }> {
  const root = createRoot({ textComponentTypes: ['Text', 'Animated.Text'] });
  await act(async () => {
    root.render(
      <ThemeProvider savedDirection={null} onChangeDirection={noop}>
        <SeesChip label={label} onPress={noop} />
      </ThemeProvider>,
    );
    await Promise.resolve();
  });
  const texts = root.container.queryAll((n) => n.type === 'Text');
  const pill = root.container.queryAll((n) => n.props.accessibilityLabel === 'What the coach can see' && n.props.accessibilityRole === 'button')[0];
  return { texts, pill, unmount: () => { root.unmount(); } };
}

const textOf = (n: TestInstance): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

describe('the Sees chip stays on one line (Ben, 15 Nov)', () => {
  const LONG = 'Sees: Push B · Dumbbell shoulder press (live)';

  it('splits off the (live) / (draft) tag; other labels stay whole', () => {
    expect(seesChipParts(LONG)).toEqual({ main: 'Sees: Push B · Dumbbell shoulder press', tag: '(live)' });
    expect(seesChipParts('Sees: Push A (draft)')).toEqual({ main: 'Sees: Push A', tag: '(draft)' });
    expect(seesChipParts('Sees: Today')).toEqual({ main: 'Sees: Today', tag: null });
    expect(seesLabel({ kind: 'workout', sessionId: 's' }, 'Push B · Dumbbell shoulder press', true)).toBe(LONG);
  });

  it('a long live label: one line, middle ellipsis on the name, (live) kept whole and not shrinking', async () => {
    const { texts, pill, unmount } = await chip(LONG);
    const main = texts.find((t) => textOf(t) === 'Sees: Push B · Dumbbell shoulder press');
    const tag = texts.find((t) => textOf(t) === '(live)');
    expect(main?.props.numberOfLines).toBe(1);
    expect(main?.props.ellipsizeMode).toBe('middle');
    expect(flat(main?.props.style).flexShrink).toBe(1);
    expect(tag?.props.numberOfLines).toBe(1);
    expect(flat(tag?.props.style).flexShrink).toBe(0);
    // The pill can't be wider than the footer, and nothing inside can draw outside it (no overlap with the transcript).
    const st = flat(pill?.props.style);
    expect(st.maxWidth).toBe('100%');
    expect(st.overflow).toBe('hidden');
    expect(st.flexDirection).toBe('row');
    // Every text on the chip is single-line.
    expect(texts.every((t) => t.props.numberOfLines === 1)).toBe(true);
    unmount();
  });

  it('the coach sheet uses the chip (no inline wrapping label left)', () => {
    const screen = readFileSync(join(__dirname, '..', '..', 'src', 'screens', 'coach', 'CoachSheetScreen.tsx'), 'utf8');
    expect(screen).toContain('<SeesChip');
    expect(screen).not.toMatch(/<AppText variant="label">\{seesLabel\(/);
  });
});
