import { act, Profiler, type ComponentType } from 'react';
import { createRoot, type Root, type TestInstance, type TestNode } from 'test-renderer';
import { expect, onTestFinished, vi } from 'vitest';

import { DevicePrefsProvider } from '../../src/device/DevicePrefsContext';
import { DEFAULT_PREFS, type DevicePrefs } from '../../src/device/prefs';
import type { StartupOutcome } from '../../src/services/startup';
import { AppProvider, type LaunchInfo } from '../../src/shell/context';
import { ThemeProvider } from '../../src/theme';
import type { Harness } from '../harness';
import { createNavigation, NavStub, type NavCall } from './stubs/navigation';

/**
 * Render one screen as the app does (ADR 0037): Theme, device prefs and the app context around it, the real services
 * from a harness launch (real SQLite), and a route, on a concurrent React root (test-renderer, React's own reconciler).
 * The screen is mounted and its first (loading) frame read, then the test waits until the loaded frame shows. A render
 * error (e.g. a hook after an early return, the 27 Oct crash) fails the render; any React warning logged on the way
 * is collected for `expectHealthy`. As on iOS, a string outside a `<Text>` throws.
 */

export type Launched = Extract<StartupOutcome, { kind: 'ready' }>;

export interface Rendered {
  root: Root;
  /** Every string on screen, in order, joined by `|`. */
  text: () => string;
  /** The first frame's text (mounted, effects run, before any local read finished). */
  firstText: string;
  /** Commits of the screen's tree: `mount` then each `update`. */
  commits: string[];
  /** Navigation calls the screen made. */
  nav: NavCall[];
  /** Everything logged through `console.error` while the screen was up (React warnings, contained errors). */
  errors: string[];
  /** Turn the event loop until `until` holds for the text on screen (throws, with the screen's text, if it never does). */
  waitFor: (until: (text: string) => boolean, what: string) => Promise<void>;
  /** Call every `onLayout` on screen with a phone-width frame (done once after loading). */
  layout: () => Promise<void>;
  /** Tap the innermost pressable element whose text is exactly `label`, then let what it starts settle. */
  press: (label: string) => Promise<void>;
  /** Host elements matching `match`. */
  all: (match: (n: TestInstance) => boolean) => TestInstance[];
  unmount: () => Promise<void>;
}

function strings(node: TestNode, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else for (const c of node.children) strings(c, out);
  return out;
}

const tick = () =>
  act(async () => {
    await new Promise((res) => setTimeout(res, 10));
  });

/** Text may only be rendered inside these host components (React Native throws otherwise). */
const TEXT_TYPES = ['Text', 'Animated.Text'];

export async function renderScreen(
  h: Harness,
  launched: Launched,
  Screen: ComponentType,
  route: { name: string; params?: unknown },
  ready: (text: string) => boolean,
  opts: { prefs?: Partial<DevicePrefs>; launch?: Partial<LaunchInfo> } = {},
): Promise<Rendered> {
  // Screens read the device clock (`clock.ts`); the services read the harness clock. Same instant for both.
  vi.useFakeTimers({ toFake: ['Date'], now: h.clockMs });
  const errors: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
  const uncaught: unknown[] = [];
  const nav: NavCall[] = [];
  const commits: string[] = [];
  const { services } = launched;
  const launch: LaunchInfo = {
    migration: launched.migration,
    sqliteVersion: launched.sqliteVersion,
    recovery: launched.recovery,
    recoveryError: launched.recoveryError,
    restAlerts: h.restAlerts,
    restoreInterrupted: services.restore.interruptedRestore,
    signOutNotConfirmed: launched.signOutNotConfirmed,
    ...opts.launch,
  };
  const prefs = { prefs: { ...DEFAULT_PREFS, ...opts.prefs }, update: () => undefined, clear: () => undefined };
  const value = { route: { key: `${route.name}-render-test`, ...route }, navigation: createNavigation(nav), calls: nav };
  const tree = (
    <ThemeProvider savedDirection={null} onChangeDirection={() => undefined}>
      <DevicePrefsProvider value={prefs}>
        <AppProvider services={services} launch={launch} relaunch={() => undefined}>
          <NavStub value={value}>
            <Profiler
              id={route.name}
              onRender={(_id, phase) => {
                commits.push(phase);
              }}
            >
              <Screen />
            </Profiler>
          </NavStub>
        </AppProvider>
      </DevicePrefsProvider>
    </ThemeProvider>
  );

  const root = createRoot({
    textComponentTypes: TEXT_TYPES,
    onUncaughtError: (error) => {
      uncaught.push(error);
    },
  });
  /** A render error React reported as uncaught (it unmounts the tree, as the app would close): fail with it. */
  const rethrow = () => {
    const e = uncaught.shift();
    if (e !== undefined) throw e instanceof Error ? e : new Error(JSON.stringify(e));
  };
  let unmounted = false;
  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    try {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  };
  onTestFinished(unmount);

  // The first frame: mounted and its effects run, before any SQLite read resolves (a synchronous act flushes both).
  act(() => {
    root.render(tree);
  });
  rethrow();
  const text = () => strings(root.container).join('|');
  const firstText = text();

  const waitFor = async (until: (t: string) => boolean, what: string) => {
    // Up to 3,000 turns (30 s or more): a loaded screen returns at once; the bound only ends a screen that never loads.
    for (let i = 0; i < 3000 && !until(text()); i += 1) {
      await tick();
      rethrow();
    }
    // A few more turns so effects that follow the loaded render (toasts, follow-up reads) run too.
    for (let i = 0; i < 5; i += 1) await tick();
    rethrow();
    if (!until(text())) throw new Error(`${route.name}: never showed ${what}. On screen: ${text().slice(0, 3000)}\nLogged: ${errors.join('\n')}`);
  };
  const all = (match: (n: TestInstance) => boolean) => root.container.queryAll(match);
  /**
   * A layout pass: the renderer has no layout engine, so every `onLayout` on screen is called with a phone-width
   * frame (393 pt), as iOS would after the first draw. Code that waits for a measured width (charts) then renders.
   */
  const layout = async () => {
    for (let pass = 0; pass < 2; pass += 1) {
      const handlers = all((n) => typeof n.props.onLayout === 'function').map((n) => n.props.onLayout as (e: unknown) => void);
      await act(async () => {
        for (const onLayout of handlers) onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 200 } } });
        await Promise.resolve();
      });
      await tick();
      rethrow();
    }
  };
  const press = async (label: string) => {
    const target = root.container.queryAll((n) => typeof n.props.onPress === 'function' && strings(n).join('') === label, { matchDeepestOnly: true })[0];
    if (target === undefined) throw new Error(`${route.name}: nothing to tap labelled ${label}`);
    const onPress = target.props.onPress as (e: unknown) => unknown;
    await act(async () => {
      await onPress({ nativeEvent: {} });
    });
    await tick();
    rethrow();
  };

  // Then the loaded frame(s): local reads resolve and the screen renders again; then laid out.
  await waitFor(ready, 'its loaded state');
  await layout();
  await waitFor(ready, 'its loaded state after layout');

  return { root, text, firstText, commits, nav, errors, waitFor, layout, press, all, unmount };
}

/** The smoke assertion every screen shares: mounted, rendered again with its data, nothing logged by React. */
export function expectHealthy(r: Rendered) {
  expect(r.commits[0]).toBe('mount');
  expect(r.commits.filter((c) => c !== 'mount').length).toBeGreaterThanOrEqual(1);
  expect(r.firstText).not.toBe(r.text());
  expect(r.errors).toEqual([]);
}
