import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createSettler, decideLaunch, LAUNCH_STABLE_MS, launchBreadcrumb, nativeOffAfter, parseLaunchBreadcrumb, parseNativeOff, safeStartView } from '../src/diagnostics/launch-guard';

/**
 * (Ben, 27 Oct, build 419 then 449: "flashes then closes" on every launch after a Start, no device logs) The
 * launch-crash guard: a run that closes before it settles leaves a breadcrumb; the next launch starts safe (no
 * auto-open of the workout, no Live Activity, no Apple Health) with the workout kept as stored.
 */

function fakeClock() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  return {
    setTimeout: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h: unknown) => {
      timers.delete(h as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

describe('launch guard: decide', () => {
  it('no breadcrumb: a normal launch', () => {
    expect(decideLaunch(null)).toEqual({ safe: false, previous: null });
    expect(decideLaunch(undefined)).toEqual({ safe: false, previous: null });
  });

  it('a breadcrumb left by the last run: safe start, with where it closed and how many times in a row', () => {
    const left = JSON.stringify(launchBreadcrumb('workout', '2026-10-27T18:00:00.000Z', '1.0 (419)', null));
    const d = decideLaunch(left);
    expect(d.safe).toBe(true);
    expect(d.previous).toEqual({ v: 1, phase: 'workout', atUtc: '2026-10-27T18:00:00.000Z', build: '1.0 (419)', failures: 1 });
    // This run's breadcrumb counts on.
    expect(launchBreadcrumb('launch', '2026-10-27T18:01:00.000Z', '1.0 (449)', d.previous).failures).toBe(2);
  });

  it('an unreadable or truncated breadcrumb still means the last run never settled', () => {
    for (const text of ['', '{', 'null', '{"v":2}', '{"v":1,"atUtc":"not a date"}']) {
      const d = decideLaunch(text);
      expect(d.safe).toBe(true);
      expect(d.previous).toBeNull();
    }
    expect(parseLaunchBreadcrumb('{"v":1,"atUtc":"2026-10-27T18:00:00.000Z","phase":"odd","failures":-3}')).toEqual({ v: 1, phase: 'launch', atUtc: '2026-10-27T18:00:00.000Z', build: null, failures: 1 });
  });
});

describe('launch guard: a native crash inside an optional feature', () => {
  const at = '2026-10-27T18:00:00.000Z';
  it('a run that closed inside ActivityKit: the Live Activity stays off on this build, every launch, until a new build', () => {
    const previous = parseLaunchBreadcrumb(JSON.stringify(launchBreadcrumb('live_activity', at, '1.0 (449)', null)));
    expect(previous?.phase).toBe('live_activity');
    const first = nativeOffAfter({ previous, stored: null, build: '1.0 (449)', nowUtc: at });
    expect([...first.off]).toEqual(['live_activity']);
    expect(first.record).toEqual({ v: 1, build: '1.0 (449)', features: ['live_activity'], atUtc: at });
    // Next launch of the same build (it settled, no breadcrumb): still off.
    const second = nativeOffAfter({ previous: null, stored: parseNativeOff(JSON.stringify(first.record)), build: '1.0 (449)', nowUtc: '2026-10-27T19:00:00.000Z' });
    expect([...second.off]).toEqual(['live_activity']);
    expect(second.record?.atUtc).toBe(at);
    // A new build tries it again; the record goes.
    expect(nativeOffAfter({ previous: null, stored: second.record, build: '1.0 (450)', nowUtc: at })).toEqual({ off: new Set(), record: null });
  });

  it('a crash in HealthKit adds Health; a launch or workout-screen crash turns nothing off; unreadable records are ignored', () => {
    const stored = { v: 1 as const, build: 'b', features: ['live_activity' as const], atUtc: at };
    const health = nativeOffAfter({ previous: { v: 1, phase: 'health', atUtc: at, build: 'b', failures: 1 }, stored, build: 'b', nowUtc: at });
    expect([...health.off].sort()).toEqual(['health', 'live_activity']);
    expect(nativeOffAfter({ previous: { v: 1, phase: 'workout', atUtc: at, build: 'b', failures: 1 }, stored: null, build: 'b', nowUtc: at }).off.size).toBe(0);
    for (const text of ['', '{', '{"v":1}', '{"v":2,"features":["health"]}']) expect(parseNativeOff(text)).toBeNull();
    expect(parseNativeOff('{"v":1,"build":"b","features":["health","nope","health"]}')?.features).toEqual(['health']);
  });

  it('the safe start names the feature and says it is off on this build', () => {
    const v = safeStartView({ workoutName: 'Push', workoutOpen: true, lastError: null, previous: { v: 1, phase: 'live_activity', atUtc: at, build: 'b', failures: 1 }, offForBuild: new Set(['live_activity'] as const) });
    expect(v.lines).toEqual(['GymSmarter closed while starting the Live Activity.', 'Push in progress · kept', 'Live Activity off on this build.', 'Apple Health off until next launch.']);
  });
});

describe('launch guard: settle', () => {
  it('settles after the screen stays up LAUNCH_STABLE_MS, not before; a crash before then leaves the breadcrumb', () => {
    const clock = fakeClock();
    let settled = 0;
    const s = createSettler(clock, () => (settled += 1));
    s.arm();
    clock.advance(LAUNCH_STABLE_MS - 1);
    expect(settled).toBe(0);
    clock.advance(1);
    expect(settled).toBe(1);
    expect(s.settled).toBe(true);
  });

  it('the workout screen re-arms it (a close while it opens is caught); background settles at once, once', () => {
    const clock = fakeClock();
    let settled = 0;
    const s = createSettler(clock, () => (settled += 1));
    s.arm();
    clock.advance(LAUNCH_STABLE_MS);
    expect(settled).toBe(1);
    s.arm();
    clock.advance(LAUNCH_STABLE_MS / 2);
    expect(settled).toBe(1);
    s.background();
    expect(settled).toBe(2);
    clock.advance(LAUNCH_STABLE_MS);
    expect(settled).toBe(2);
  });
});

describe('launch guard: the safe start’s words', () => {
  it('names what closed, the workout kept, what is off, and the last error when one was recorded', () => {
    const v = safeStartView({ workoutName: 'Push', workoutOpen: true, lastError: { name: 'TypeError', message: "Cannot read property 'x' of undefined", atUtc: '2026-10-27T18:00:01.000Z' }, previous: { v: 1, phase: 'workout', atUtc: '2026-10-27T18:00:00.000Z', build: null, failures: 1 } });
    expect(v).toEqual({
      title: 'Safe start',
      lines: ['GymSmarter closed while opening the workout.', 'Push in progress · kept', 'Live Activity and Apple Health off until next launch.', "Last error: TypeError: Cannot read property 'x' of undefined"],
      resume: true,
    });
    expect(safeStartView({ workoutName: null, workoutOpen: false, lastError: null, previous: null })).toEqual({
      title: 'Safe start',
      lines: ['GymSmarter closed during the last launch.', 'Live Activity and Apple Health off until next launch.'],
      resume: false,
    });
  });
});

describe('launch guard: wiring (source checks; React Native isn’t run in Node)', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it('the guard starts first thing, right after crash capture', () => {
    expect(src('index.ts').indexOf("import './src/diagnostics/install'")).toBeLessThan(src('index.ts').indexOf('registerRootComponent'));
    expect(src('src/diagnostics/install.ts')).toMatch(/installCrashCapture\(\);\s*\n(?:\/\/.*\n)?startLaunchGuard\(\);/);
  });

  it('a safe start: no auto-open, no Live Activity, no Health, no launch reconciles; a render error is contained', () => {
    const root = src('src/shell/Root.tsx');
    expect(root).toContain("available: () => nativeFeatureOn('live_activity') && lazyLiveActivityPort.available()");
    expect(root).toContain("start: (props, staleAtMs) => guardNativeCall('live_activity', () => lazyLiveActivityPort.start(props, staleAtMs))");
    expect(root).toContain("if (!nativeFeatureOn('health')) return null;");
    expect(root).toContain("setLaunchGuardBackground(s === 'background');");
    expect(root).toContain('createLiveActivityController(guardedLiveActivityPort');
    expect(root).toContain("...(launchSafeMode().safe ? {} : { restAlerts })");
    expect(root).toContain('health: { port: guardedHealthPort(), buildIncludesHealth: healthInBuild() }');
    expect(root).toContain('{safe.safe ? null : <ForegroundAlerts services={services} />}');
    expect(root).toContain('{safe.safe ? null : <HealthHost services={services} />}');
    expect(root).toContain("safe.safe ? safeChoice === 'resume' && inProgress !== null : recovery?.openInto === 'active_workout'");
    expect(root).toMatch(/<AppBoundary[\s\S]*<AppNavigator key=\{navKey\}/);
    expect(root).toContain('else launchSettler.arm();');
    expect(root).toMatch(/if \(AppState\.currentState === 'background'\) \{\s*setLaunchGuardBackground\(true\);\s*launchSettler\.background\(\);/);
    expect(root).toContain("if (s === 'background') launchSettler.background()");
  });

  it('the workout screen breadcrumbs its own opening', () => {
    expect(src('src/screens/workout/WorkoutScreen.tsx')).toContain("guardScreenOpen('workout')");
  });
});
