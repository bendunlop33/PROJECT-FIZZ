import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toMs } from '@fizz/domain';

import { NATIVE_PAUSED_COPY, nativePauseOf, safeStartView } from '../src/diagnostics/launch-guard';
import { healthScreenView } from '../src/health/health-view';
import { createLiveActivityController, type LiveActivityPort } from '../src/live-activity/controller';
import { FakeHealth } from './fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 28 Oct) A feature the launch guard turned off (a safe start, or the native-off record after it closed the app
 * on this build) reads `Paused for this launch` / `Paused on this build`, never `Not available on this install`, which
 * stays for an install that really has no Health (no module, no entitlement).
 */

describe('which pause', () => {
  it('safe start: launch; off on this build: build (it wins); neither: null', () => {
    expect(nativePauseOf('health', { safe: true, offForBuild: new Set() })).toBe('launch');
    expect(nativePauseOf('health', { safe: false, offForBuild: new Set(['health']) })).toBe('build');
    expect(nativePauseOf('health', { safe: true, offForBuild: new Set(['health']) })).toBe('build');
    expect(nativePauseOf('live_activity', { safe: false, offForBuild: new Set(['health']) })).toBeNull();
    expect(NATIVE_PAUSED_COPY.launch.line).toBe('Paused for this launch');
    // The safe-start screen keeps its own lines (off until next launch / off on this build).
    expect(safeStartView({ workoutName: null, workoutOpen: false, lastError: null, previous: null, offForBuild: new Set(['health']) }).lines).toContain('Apple Health off on this build.');
  });
});

describe('Apple Health', () => {
  const base = { settings: { writeWorkouts: true, writeSinceUtc: null, readWeight: false, readActivities: false, readHeartRate: false, readRestingHeartRate: false, readSleep: false, readWindow: '8w' as const, lastReadUtc: null, lastReadFailedUtc: null, version: 1 }, shareStatus: null, notSaved: 0, readCounts: { workouts: 0, weights: 0 }, sources: [], reading: false, newOnLastRead: null, written: 0, nowMs: toMs('2026-10-28T08:00:00.000Z'), tz: 'Europe/London' };

  it('the view: paused for this launch / on this build, with its Why?; a missing entitlement still reads Not available', () => {
    expect(healthScreenView({ ...base, capability: 'not_on_this_install', paused: 'launch' })).toMatchObject({ available: false, line: 'Paused for this launch', why: 'Safe start. On again at the next launch.', save: [], read: [] });
    expect(healthScreenView({ ...base, capability: 'not_on_this_install', paused: 'build' })).toMatchObject({ available: false, line: 'Paused on this build' });
    expect(healthScreenView({ ...base, capability: 'not_on_this_install', paused: null })).toMatchObject({ line: 'Not available on this install' });
    expect(healthScreenView({ ...base, capability: 'not_on_this_install' })).toMatchObject({ line: 'Not available on this install' });
  });

  let h: Harness;
  beforeEach(() => {
    h = createHarness('2026-10-28T18:00:00.000Z');
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('a safe start (no port this run, build has Health): Profile reads Paused for this launch; a switch says the same; logging works; next launch it is back', async () => {
    const { services: s } = await h.launch({ health: { port: null, buildIncludesHealth: true, paused: () => 'launch' }, safe: true });
    const gymId = await setUpGym(h, s);
    const v = await s.health.screen(true);
    expect(v).toMatchObject({ available: false, line: 'Paused for this launch' });
    expect(await s.health.setSwitch('writeWorkouts', true)).toEqual({ ok: false, message: 'Paused for this launch' });
    expect(await s.health.removeAllOwn()).toEqual({ ok: false, message: 'Paused for this launch' });
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);

    const fake = new FakeHealth();
    const { services: next } = await h.launch({ health: { port: fake, buildIncludesHealth: true, paused: () => null } });
    expect((await next.health.screen(true)).line).toBe('Off');
  });

  it('a real install without Health is unchanged by the guard: Not available on this install', async () => {
    const { services: s } = await h.launch({ health: { port: null, buildIncludesHealth: false, paused: () => null } });
    await setUpGym(h, s);
    expect((await s.health.screen(true)).line).toBe('Not available on this install');
  });
});

describe('Live Activity', () => {
  const port = (available: boolean, paused: 'launch' | 'build' | null): LiveActivityPort => ({
    available: () => available,
    paused: () => paused,
    listIds: () => [],
    start: () => 'x',
    update: () => Promise.resolve(),
    end: () => Promise.resolve(),
  });
  it('off by the guard: `paused`; missing from the build: `not_in_build`', () => {
    expect(createLiveActivityController(port(false, 'launch'), { tz: () => 'Europe/London' }).status).toBe('paused');
    expect(createLiveActivityController(port(false, 'build'), { tz: () => 'Europe/London' }).status).toBe('paused');
    expect(createLiveActivityController(port(false, null), { tz: () => 'Europe/London' }).status).toBe('not_in_build');
    expect(createLiveActivityController(port(true, null), { tz: () => 'Europe/London' }).status).toBe('idle');
  });

  it('Root and the probe read the guard: paused only on a build that has the feature; the probe never calls ActivityKit then', () => {
    const src = (p: string) => readFileSync(join(import.meta.dirname, '../src', p), 'utf8');
    const root = src('shell/Root.tsx');
    expect(root).toContain("paused: () => (lazyLiveActivityPort.available() ? nativeFeaturePause('live_activity') : null)");
    expect(root).toContain("paused: () => (healthInBuild() ? nativeFeaturePause('health') : null)");
    const runners = src('probe/runners.ts');
    const probe = runners.slice(runners.indexOf('export async function runLiveActivityProbe'));
    expect(probe.indexOf("nativeFeaturePause('live_activity')")).toBeGreaterThan(0);
    expect(probe.indexOf("nativeFeaturePause('live_activity')")).toBeLessThan(probe.indexOf('restCountdownActivity()'));
  });
});
