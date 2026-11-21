import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StyleSheet } from 'react-native';
import type { TestNode } from 'test-renderer';

import { SummaryScreen } from '../../src/screens/workout/SummaryScreen';
import { createHarness, logWorkout, setUpGym, type Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';
import { INSETS } from './stubs/native';

/**
 * (Ben, 21 Nov, build 576) The Summary's content scrolled under the status bar (its header over `18:13`). The top
 * inset sits outside the scroll view, so nothing scrolls into it.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-19T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const styleOf = (style: unknown) => StyleSheet.flatten(style as never) as { paddingTop?: number } | undefined;

describe('Summary respects the top safe area (Ben, 21 Nov)', () => {
  it('the root pads the status bar; the scroll content starts below it, not under it', async () => {
    const launched = await h.launch();
    const s = launched.services;
    const gymId = await setUpGym(h, s);
    const sessionId = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }] }]);
    const r = await renderScreen(h, launched, SummaryScreen, { name: 'Summary', params: { sessionId } }, (t) => t.includes('Exercises · done'));
    expectHealthy(r);
    const root = r.all((n) => n.props.testID === 'summary-root')[0];
    const scroll = r.all((n) => n.props.testID === 'summary-scroll')[0];
    expect(root).toBeDefined();
    expect(scroll).toBeDefined();
    expect(styleOf(root?.props.style)?.paddingTop).toBe(INSETS.top);
    // The scroll view is inside the padded root, and its own content isn't padded by the inset again.
    const inside = (n: TestNode): boolean => typeof n !== 'string' && (n.props.testID === 'summary-scroll' || n.children.some(inside));
    expect(root !== undefined && inside(root)).toBe(true);
    expect(styleOf(scroll?.props.contentContainerStyle)?.paddingTop ?? 0).toBeLessThan(INSETS.top);
    expect(scroll?.props.contentInsetAdjustmentBehavior).toBe('never');
  });
});
