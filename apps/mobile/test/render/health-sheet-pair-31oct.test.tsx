import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TodayScreen } from '../../src/screens/TodayScreen';
import { LibraryScreen } from '../../src/screens/library/LibraryScreen';
import { FakeHealth } from '../fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from '../harness';
import { expectHealthy, renderScreen, type Rendered } from './render-screen';
import { withPlan } from './seed';

/**
 * (Ben, 31 Oct: "make it easier to pair … from when you click on the activity and see it eg on Today") A Health
 * strength workout's sheet, opened from Today's Recent and Library › Plan's This week line, over real SQLite and a fake
 * HealthKit. Its one action at the top: `Pair with <workout> · <times>` (one workout that day), a short list (several),
 * `Same workout as <workout>` (the day's workout already paired), nothing (no workout that day). Each write's toast
 * has Undo. No React warning on the way.
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

const MIN = 60_000;
const sets = (n: number) => Array.from({ length: n }, () => ({ load: 100, reps: 5 }));

/** Tap the pressable whose accessibility label or own text matches. */
async function tap(r: Rendered, label: RegExp): Promise<void> {
  const textOf = (n: { children: unknown[] }): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c as { children: unknown[] }))).join('');
  const target = r.all((n) => typeof n.props.onPress === 'function' && ((typeof n.props.accessibilityLabel === 'string' && label.test(n.props.accessibilityLabel)) || label.test(textOf(n)))).at(-1);
  if (target === undefined) throw new Error(`nothing labelled ${String(label)}`);
  const onPress = target.props.onPress as (e: unknown) => unknown;
  await act(async () => {
    await onPress({ nativeEvent: {} });
  });
}

async function setUp(opts: { workouts: number; paired?: boolean; garminOffsetMin?: number }) {
  const launched = await h.launch({ health: { port: fake, buildIncludesHealth: true } });
  const s = launched.services;
  const gymId = await setUpGym(h, s);
  const ids: string[] = [];
  const start = h.clockMs;
  for (let i = 0; i < opts.workouts; i += 1) {
    h.clockMs = start + i * 150 * MIN;
    ids.push(await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: sets(4) }]));
  }
  const g0 = start + (opts.garminOffsetMin ?? -3) * MIN;
  const g = fake.addGarmin({ activityType: 50, startMs: g0, endMs: g0 + 50 * MIN, sourceName: 'Connect' });
  await s.health.setSwitch('readActivities', true);
  if (opts.paired !== true && ids[0] !== undefined) await s.health.notIt({ healthUuid: g, sessionId: ids[0], opId: 'not-it' });
  h.clockMs = start + 8 * 60 * MIN;
  await s.health.readNow();
  return { launched, s, gymId, ids, g };
}

describe('the Health activity sheet’s one action, from Today’s Recent', () => {
  it('one workout that day: Pair with … in one tap; Paired toast; Undo unpairs', async () => {
    const { launched, s, ids, g } = await setUp({ workouts: 1 });
    const r = await renderScreen(h, launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Recent') && t.includes('Strength'));
    await tap(r, /Strength.*from Apple Health/);
    await r.waitFor((t) => /\|Pair with Legs · [^|]+–[^|]+(\||$)/.test(t), 'Pair with Legs · <times>');
    await tap(r, /^Pair with /);
    await r.waitFor((t) => t.includes('Paired') && t.includes('Undo'), 'the Paired toast');
    expect(await s.health.forWorkout(ids[0] ?? '')).toMatchObject({ kind: 'linked', healthUuid: g });
    await r.press('Undo');
    await r.waitFor((t) => !t.includes('|Undo|'), 'the toast gone');
    expect((await s.health.forWorkout(ids[0] ?? '')).kind).not.toBe('linked');
    expectHealthy(r);
    await r.unmount();
  });

  it('several workouts that day: a short list, each with Pair', async () => {
    const { launched, s, ids, g } = await setUp({ workouts: 2 });
    const r = await renderScreen(h, launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Recent') && t.includes('Strength'));
    await tap(r, /Strength.*from Apple Health/);
    await r.waitFor((t) => (t.match(/\|Legs · [^|]+\|Pair(?=\||$)/g) ?? []).length === 2, 'two Pair rows');
    expect(r.text()).not.toContain('Pair with');
    await tap(r, /^Pair, /);
    await r.waitFor((t) => t.includes('Paired') && t.includes('Undo'), 'the Paired toast');
    const linked = await Promise.all(ids.map((id) => s.health.forWorkout(id)));
    expect(linked.filter((v) => v.kind === 'linked' && v.healthUuid === g)).toHaveLength(1);
    expect(r.errors).toEqual([]);
    await r.unmount();
  });

  it('the day’s workout already paired: Same workout as …; Undo puts it back', async () => {
    const { launched, s, ids } = await setUp({ workouts: 1, paired: true });
    expect((await s.health.forWorkout(ids[0] ?? '')).kind).toBe('linked');
    // A second Garmin strength that evening, apart from the paired one.
    const later = fake.addGarmin({ activityType: 50, startMs: h.clockMs - 4 * 60 * MIN, endMs: h.clockMs - 3 * 60 * MIN, sourceName: 'Connect' });
    await s.health.readNow();
    const shown = async () => (await s.activities.between('2026-10-19', '2026-10-20')).map((a) => a.id);
    expect(await shown()).toEqual([later]);
    const r = await renderScreen(h, launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Recent') && t.includes('Strength'));
    await tap(r, /Strength.*from Apple Health/);
    await r.waitFor((t) => t.includes('Same workout as '), 'Same workout as …');
    await tap(r, /^Same workout as /);
    await r.waitFor((t) => t.includes('Same workout') && t.includes('Undo'), 'the toast');
    expect(await shown()).toEqual([]);
    await r.press('Undo');
    await r.waitFor((t) => !t.includes('|Undo|'), 'the toast gone');
    expect(await shown()).toEqual([later]);
    expect(r.errors).toEqual([]);
    await r.unmount();
  });

  it('no workout that day: no pairing action (never across days)', async () => {
    const launched = await h.launch({ health: { port: fake, buildIncludesHealth: true } });
    const s = launched.services;
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: sets(4) }]);
    // Garmin strength the next day, no workout then.
    fake.addGarmin({ activityType: 50, startMs: h.clockMs + 20 * 60 * MIN, endMs: h.clockMs + 21 * 60 * MIN, sourceName: 'Connect' });
    h.clockMs += 26 * 60 * MIN;
    await s.health.setSwitch('readActivities', true);
    await s.health.readNow();
    const r = await renderScreen(h, launched, TodayScreen, { name: 'Today' }, (t) => t.includes('Recent') && t.includes('Strength'));
    await tap(r, /Strength.*from Apple Health/);
    await r.waitFor((t) => t.includes('Apple Health') && t.includes('Garmin'), 'the sheet');
    expect(r.text()).not.toMatch(/Pair|Same workout/);
    expect(r.errors).toEqual([]);
    await r.unmount();
  });
});

describe('the Health activity sheet from Library › Plan’s This week line', () => {
  it('the line opens the sheet; Pair with … pairs; Undo unpairs', async () => {
    const { launched, s, gymId, ids } = await setUp({ workouts: 1 });
    await withPlan(h, { launched, s, gymId }, { sessions: 4, schedule: 'set', days: [0, 2, 4, 5] });
    const r = await renderScreen(h, launched, LibraryScreen, { name: 'LibraryHome' }, (t) => t.includes('Strength'));
    await tap(r, /Strength/);
    await r.waitFor((t) => t.includes('Pair with '), 'Pair with …');
    await tap(r, /^Pair with /);
    await r.waitFor((t) => t.includes('Paired') && t.includes('Undo'), 'the Paired toast');
    expect((await s.health.forWorkout(ids[0] ?? '')).kind).toBe('linked');
    await r.press('Undo');
    await r.waitFor((t) => !t.includes('|Undo|'), 'the toast gone');
    expect((await s.health.forWorkout(ids[0] ?? '')).kind).not.toBe('linked');
    expect(r.errors).toEqual([]);
    await r.unmount();
  });
});
