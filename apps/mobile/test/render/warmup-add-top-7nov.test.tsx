import { act } from 'react';
import type { TestInstance } from 'test-renderer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canAddWarmupNow } from '@fizz/domain';

import { WorkoutScreen } from '../../src/screens/workout/WorkoutScreen';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen, type Rendered } from './render-screen';
import { benWithHistory, harness, startPlanDay, withPlan } from './seed';

/**
 * (Ben, 7 Nov) "The add warm up button when in an exercise should also move to top, underneath the last warm-up."
 * Rendered on a real plan day over real SQLite: the current exercise's `＋ Warm-up` is a row in its set table
 * directly under its last warm-up (above set 1), not down by `＋ Set`; a tap adds the warm-up there, and the row is
 * under the new last warm-up.
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  await h.cleanup();
});

/** The set rows' and the add row's VoiceOver names, in screen order (each once; not the `Warm-up · …` suggestion line). */
function tableLabels(r: Rendered, name: string): string[] {
  const out: string[] = [];
  for (const n of r.all((x: TestInstance) => typeof x.props.accessibilityLabel === 'string')) {
    const label = String(n.props.accessibilityLabel);
    const row = /^(Warm-up|Set \d+),/.test(label) || label === `Add warm-up to ${name}` || label === `Add set to ${name}`;
    if (row && out.at(-1) !== label) out.push(label);
  }
  return out;
}

describe('＋ Warm-up in the set table (Ben, 7 Nov)', () => {
  it('sits under the last warm-up, above set 1; a tap adds one there', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben);
    const sessionId = await startPlanDay(h, ben);
    const loaded = await ben.s.workout.load(sessionId);
    const a = loaded?.aggregate;
    const active = a?.sets.find((x) => x.id === a.session.activeSetId);
    const ex = a?.exercises.find((e) => e.id === active?.sessionExerciseId);
    if (a === undefined || ex === undefined) throw new Error('no current exercise');
    expect(canAddWarmupNow(a, ex.id)).toBe(true);
    const name = ex.exerciseName;
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('PREVIOUS') && t.includes('＋ Warm-up'));
    const placed = (labels: string[]) => {
      const at = labels.indexOf(`Add warm-up to ${name}`);
      expect(at).toBeGreaterThanOrEqual(0);
      // Next: set 1; before it only warm-ups (or nothing: the top of the table).
      expect(labels[at + 1]).toMatch(/^Set 1[, ]/);
      expect(labels.slice(0, at).every((l) => l.startsWith('Warm-up'))).toBe(true);
      expect(labels.indexOf(`Add set to ${name}`)).toBeGreaterThan(at + 1);
      return labels.slice(0, at).length;
    };
    const warmBefore = placed(tableLabels(r, name));
    const add = r.all((x) => x.props.accessibilityLabel === `Add warm-up to ${name}` && typeof x.props.onPress === 'function')[0];
    if (add === undefined) throw new Error('no ＋ Warm-up');
    await act(async () => {
      await (add.props.onPress as (e: unknown) => unknown)({ nativeEvent: {} });
    });
    await r.waitFor(() => tableLabels(r, name).filter((l) => l.startsWith('Warm-up')).length === warmBefore + 1 || !tableLabels(r, name).includes(`Add warm-up to ${name}`), 'the new warm-up');
    const after = tableLabels(r, name);
    expect(after.filter((l) => l.startsWith('Warm-up')).length).toBe(warmBefore + 1);
    // Still directly under the last warm-up, when another one fits.
    if (after.includes(`Add warm-up to ${name}`)) placed(after);
    const stored = (await ben.s.workout.load(sessionId))?.aggregate;
    const own = (stored?.sets ?? []).filter((x) => x.sessionExerciseId === ex.id && x.status !== 'deleted').sort((x, y) => x.index - y.index);
    expect(own.findIndex((x) => x.setType !== 'warmup')).toBe(warmBefore + 1);
    expectHealthy(r);
    await r.unmount();
  });
});
