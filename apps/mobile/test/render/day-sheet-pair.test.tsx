import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TodayScreen } from '../../src/screens/TodayScreen';
import { FakeHealth } from '../fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from '../harness';
import { expectHealthy, renderScreen, type Rendered } from './render-screen';
import { withPlan } from './seed';

/**
 * (Ben, 29 Oct, build 484: "Why no option to pair workouts together") Today's day sheet over real SQLite and a fake
 * HealthKit: Monday's app workout (22 sets) and Garmin Connect's 59 min Strength show as two rows with `Pair` on the
 * Health one; one tap pairs them (toast with Undo); the sheet then shows one row with Health's facts, its source and
 * `Unpair`; Undo splits them again. No React warning on the way.
 */

let h: Harness;
let fake: FakeHealth;
beforeEach(() => {
  // Monday 19 Oct 2026, 18:00 in London.
  h = createHarness('2026-10-19T17:00:00.000Z');
  fake = new FakeHealth();
});
afterEach(async () => {
  await h.cleanup();
});

async function tapLabel(r: Rendered, label: RegExp): Promise<void> {
  const target = r.all((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && label.test(n.props.accessibilityLabel))[0];
  if (target === undefined) throw new Error(`nothing labelled ${String(label)}`);
  const onPress = target.props.onPress as (e: unknown) => unknown;
  await act(async () => {
    await onPress({ nativeEvent: {} });
  });
}

describe('the day sheet’s Pair', () => {
  it('Monday: two rows with Pair; one tap pairs (Undo); one row with the Health facts and Unpair; Undo splits them', async () => {
    const launched = await h.launch({ health: { port: fake, buildIncludesHealth: true } });
    const s = launched.services;
    const gymId = await setUpGym(h, s);
    const start = h.clockMs;
    const sets = (n: number) => Array.from({ length: n }, () => ({ load: 100, reps: 5 }));
    const id = await logWorkout(h, s, gymId, [
      { exercise: 'Back squat', sets: sets(8) },
      { exercise: 'Romanian deadlift', sets: sets(7) },
      { exercise: 'Leg press', sets: sets(7) },
    ]);
    const g = fake.addGarmin({ activityType: 50, startMs: start - 3 * 60_000, endMs: start + 56 * 60_000, sourceName: 'Connect' });
    await s.health.setSwitch('readActivities', true);
    // Not automatic this time (Ben once said `Not it`): Pair is the way.
    await s.health.notIt({ healthUuid: g, sessionId: id, opId: 'not-it' });
    await s.health.setSwitch('readHeartRate', true);
    await s.health.readNow();
    await withPlan(h, { launched, s, gymId }, { sessions: 4, schedule: 'set', days: [0, 2, 4, 5] });
    h.clockMs = Date.parse('2026-10-21T07:00:00.000Z');

    const r = await renderScreen(h, launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Up next'));
    await tapLabel(r, /^Monday 19: /);
    await r.waitFor((t) => t.includes('Strength') && t.includes('Pair'), 'the day sheet with Pair');
    expect(r.text()).toContain('22 sets');
    await r.press('Pair');
    await r.waitFor((t) => t.includes('Paired') && t.includes('Undo'), 'the Paired toast');
    await r.waitFor((t) => t.includes('Unpair') && t.includes('avg 128 bpm') && t.includes('Connect') && !t.includes('|Pair|'), 'one paired row');
    expect((await s.health.forWorkout(id)).kind).toBe('linked');
    await r.press('Undo');
    await r.waitFor((t) => t.includes('|Pair|') && !t.includes('Unpair'), 'two rows again');
    expect((await s.health.forWorkout(id)).kind).toBe('none');
    expectHealthy(r);
    await r.unmount();
  });
});
