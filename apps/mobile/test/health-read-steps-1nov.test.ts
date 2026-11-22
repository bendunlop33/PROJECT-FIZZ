import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Domain from '@fizz/domain';

import { FakeHealth } from './fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 1 Nov) A Health read's pairing steps are optional: release, relink and recording twins failing (a bug in one,
 * a bad record) never stop the read's samples being stored and shown, nor the reads after them (resting heart rate,
 * sleep). Each failure is noted (Last error) and the read carries on.
 */
const boom = vi.hoisted(() => ({ on: false }));
vi.mock('@fizz/domain', async (importOriginal) => {
  const real = await importOriginal<typeof Domain>();
  const failing =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): R => {
      if (boom.on) throw new Error('step failed');
      return fn(...a);
    };
  return { ...real, linksToRelink: failing(real.linksToRelink), autoLinkPairs: failing(real.autoLinkPairs), twinsToRecord: failing(real.twinsToRecord) };
});

let h: Harness;
let fake: FakeHealth;
beforeEach(() => {
  h = createHarness('2026-10-28T17:00:00.000Z');
  fake = new FakeHealth();
  boom.on = false;
});
afterEach(async () => {
  await h.cleanup();
});

describe('a failing pairing step never stops a Health read (Ben, 1 Nov)', () => {
  it('the run and the strength workout are stored and shown, resting HR still read, each failure logged', async () => {
    const logged: string[] = [];
    const s = (await h.launch({ health: { port: fake, buildIncludesHealth: true, logError: (_e, where) => logged.push(where) } })).services;
    const gymId = await setUpGym(h, s);
    for (const k of ['readActivities', 'readRestingHeartRate'] as const) await s.health.setSwitch(k, true);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const run = fake.addGarmin({ activityType: 37, startMs: Date.parse('2026-10-29T07:00:00.000Z'), endMs: Date.parse('2026-10-29T07:35:00.000Z'), distanceM: 6000, sourceName: 'Connect' });
    const strength = fake.addGarmin({ activityType: 50, startMs: Date.parse('2026-10-28T16:57:00.000Z'), endMs: Date.parse('2026-10-28T17:30:00.000Z'), sourceName: 'Connect' });
    fake.resting.push({ uuid: 'B1000000-0000-4000-8000-000000000001', bpm: 45, atMs: Date.parse('2026-10-30T07:00:00.000Z'), sourceName: 'Connect', sourceBundleId: 'com.garmin.connect.mobile' });
    h.clockMs = Date.parse('2026-10-30T09:00:00.000Z');
    boom.on = true;
    await s.health.onAppActive();
    const shown = (await s.activities.between('2026-10-26', '2026-11-02')).filter((a) => a.source === 'health').map((a) => a.id);
    // Unpaired (pairing failed), but shown: never lost.
    expect(shown.sort()).toEqual([run, strength].sort());
    expect((await s.health.signals()).restingHeartRate.length).toBe(1);
    expect(logged.sort()).toEqual(['health-autolink', 'health-release', 'health-twins']);
    // Fixed on the next read: it pairs.
    boom.on = false;
    await s.health.readNow();
    expect((await s.activities.between('2026-10-26', '2026-11-02')).filter((a) => a.source === 'health').map((a) => a.id)).toEqual([run]);
  });
});
