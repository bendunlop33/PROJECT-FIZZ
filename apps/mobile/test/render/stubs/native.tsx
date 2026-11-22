/**
 * Expo modules, safe areas, Skia, Reanimated and Worklets for render smoke tests (ADR 0037). Each is the module's
 * JS surface the app imports, inert, with no native code: no permission is granted, no file leaves memory, no
 * notification is scheduled, no network is reached. `setup.ts` maps each package to its object here.
 */
import { createElement, forwardRef, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';

const noop = () => undefined;
const sub = () => ({ remove: noop });
const resolved = <T,>(v: T) => () => Promise.resolve(v);

function host(name: string) {
  // A ref gets an empty handle: these never take imperative calls in the app.
  const C = forwardRef(function Host(props: Record<string, unknown> & { children?: ReactNode }, ref: Ref<unknown>) {
    useImperativeHandle(ref, () => ({}), []);
    return createElement(name, props, props.children);
  });
  C.displayName = name;
  return C;
}

export const expo = { requireOptionalNativeModule: () => null, requireNativeModule: () => null };
/** No network in a render test: a fetch fails as offline would. */
export const expoFetch = { fetch: () => Promise.reject(new TypeError('Network request failed (render test)')) };

export const application = { applicationId: 'com.fizz.test', applicationName: 'GymSmarter', nativeApplicationVersion: '0.1.0', nativeBuildVersion: 'test' };
export const constants = { default: { expoConfig: { name: 'GymSmarter', version: '0.1.0', extra: {} } } };
export const crypto = { CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: resolved(new ArrayBuffer(32)), getRandomBytes: (n: number) => new Uint8Array(n) };
export const haptics = {
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  impactAsync: resolved(undefined),
  notificationAsync: resolved(undefined),
  selectionAsync: resolved(undefined),
};
export const localization = {
  getLocales: () => [{ languageTag: 'en-GB', languageCode: 'en', regionCode: 'GB', measurementSystem: 'uk', textDirection: 'ltr', decimalSeparator: '.', digitGroupingSeparator: ',', currencyCode: 'GBP', temperatureUnit: 'celsius' }],
  getCalendars: () => [{ calendar: 'gregory', timeZone: 'Europe/London', uses24hourClock: true, firstWeekday: 2 }],
};

/** Notifications not yet asked: the honest state of a fresh install. */
const permission = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never', ios: { status: 0, allowsAlert: false, allowsSound: false, allowsBadge: false } };
export const notifications = {
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval', DAILY: 'daily', WEEKLY: 'weekly', CALENDAR: 'calendar' },
  getPermissionsAsync: resolved(permission),
  requestPermissionsAsync: resolved(permission),
  scheduleNotificationAsync: resolved('render-test'),
  cancelScheduledNotificationAsync: resolved(undefined),
  dismissNotificationAsync: resolved(undefined),
  getAllScheduledNotificationsAsync: resolved([]),
  getPresentedNotificationsAsync: resolved([]),
  setNotificationHandler: noop,
  addNotificationReceivedListener: sub,
  addNotificationResponseReceivedListener: sub,
  getLastNotificationResponseAsync: resolved(null),
};

const keychain = new Map<string, string>();
export const secureStore = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  isAvailableAsync: resolved(true),
  getItemAsync: (k: string) => Promise.resolve(keychain.get(k) ?? null),
  setItemAsync: (k: string, v: string) => {
    keychain.set(k, v);
    return Promise.resolve();
  },
  deleteItemAsync: (k: string) => {
    keychain.delete(k);
    return Promise.resolve();
  },
};
export const speech = { speak: noop, stop: resolved(undefined), isSpeakingAsync: resolved(false), getAvailableVoicesAsync: resolved([]) };
/** On-device speech is not available here (the honest state when the recogniser is missing). */
export const speechRecognition = {
  ExpoSpeechRecognitionModule: {
    addListener: sub,
    getSupportedLocales: resolved({ locales: [], installedLocales: [] }),
    isRecognitionAvailable: () => false,
    supportsOnDeviceRecognition: () => false,
    requestPermissionsAsync: resolved({ granted: false, status: 'denied', canAskAgain: false, expires: 'never' }),
    start: noop,
    stop: noop,
  },
};
export const sqlite = {
  defaultDatabaseDirectory: '/render-test/SQLite',
  openDatabaseAsync: () => Promise.reject(new Error('render test: services are opened by the harness')),
  deleteDatabaseAsync: resolved(undefined),
};
export const statusBar = { StatusBar: () => null };
export const symbols = { SymbolView: host('SymbolView') };
export const widgets = { createLiveActivity: () => null, addUserInteractionListener: sub, widgetsDirectory: '/render-test/widgets' };
export const datetimepicker = { default: host('DateTimePicker') };

/** Files in an in-memory container (the app's small JSON files: prefs, crash notes). */
const files = new Map<string, string>();
function pathOf(parent: unknown, name?: string): string {
  const base = typeof parent === 'string' ? parent : (parent as { uri: string }).uri;
  return name === undefined ? base : `${base.replace(/\/$/, '')}/${name}`;
}
class FsFile {
  readonly uri: string;
  constructor(parent: unknown, name?: string) {
    this.uri = pathOf(parent, name);
  }
  get name() {
    return this.uri.slice(this.uri.lastIndexOf('/') + 1);
  }
  get exists() {
    return files.has(this.uri);
  }
  get size() {
    return files.get(this.uri)?.length ?? 0;
  }
  text() {
    return Promise.resolve(files.get(this.uri) ?? '');
  }
  textSync() {
    return files.get(this.uri) ?? '';
  }
  write(t: string) {
    files.set(this.uri, t);
  }
  create() {
    files.set(this.uri, '');
  }
  delete() {
    files.delete(this.uri);
  }
  move(to: FsFile) {
    files.set(to.uri, files.get(this.uri) ?? '');
    files.delete(this.uri);
    return Promise.resolve();
  }
  copy(to: FsFile) {
    files.set(to.uri, files.get(this.uri) ?? '');
  }
}
class FsDirectory {
  readonly uri: string;
  constructor(parent: unknown, name?: string) {
    this.uri = pathOf(parent, name);
  }
  get exists() {
    return true;
  }
  create = noop;
  delete = noop;
  list() {
    const prefix = `${this.uri.replace(/\/$/, '')}/`;
    return [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map((k) => new FsFile(k));
  }
}
export const fileSystem = {
  File: FsFile,
  Directory: FsDirectory,
  Paths: { document: new FsDirectory('file:///render-test/Documents'), cache: new FsDirectory('file:///render-test/Caches'), temp: new FsDirectory('file:///render-test/tmp') },
};

export const INSETS = { top: 59, bottom: 34, left: 0, right: 0 };
export const safeArea = {
  SafeAreaProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SafeAreaView: host('SafeAreaView'),
  useSafeAreaInsets: () => INSETS,
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 393, height: 852 }),
  initialWindowMetrics: { insets: INSETS, frame: { x: 0, y: 0, width: 393, height: 852 } },
};

/** Skia draws nothing here: the canvas and its shapes are host elements; paths record nothing. */
const path = (): Record<string, unknown> =>
  new Proxy<Record<string | symbol, unknown>>({}, {
    get: (t, p) => (p === 'then' ? undefined : (t[p] ??= () => path())),
  });
export const skia = {
  Canvas: host('Canvas'),
  Circle: host('Circle'),
  DashPathEffect: host('DashPathEffect'),
  Fill: host('Fill'),
  Group: host('Group'),
  Line: host('Line'),
  Path: host('Path'),
  Picture: host('Picture'),
  Rect: host('Rect'),
  RoundedRect: host('RoundedRect'),
  PaintStyle: { Fill: 0, Stroke: 1 },
  StrokeCap: { Butt: 0, Round: 1, Square: 2 },
  StrokeJoin: { Miter: 0, Round: 1, Bevel: 2 },
  TileMode: { Clamp: 0, Repeat: 1, Mirror: 2, Decal: 3 },
  Skia: { Path: { Make: path }, Paint: path, PictureRecorder: path, Color: (c: unknown) => c },
  createPicture: () => ({}),
  rect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
  rrect: (r: unknown, rx: number, ry: number) => ({ rect: r, rx, ry }),
  vec: (x = 0, y = 0) => ({ x, y }),
};

export const reanimated = {
  useSharedValue<T>(v: T) {
    return useRef({ value: v }).current;
  },
  useDerivedValue<T>(fn: () => T) {
    return { value: fn() };
  },
  useFrameCallback: () => ({ setActive: noop, isActive: false }),
};
export const worklets = { scheduleOnRN: (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => fn(...args) };

/** The Live Activity widget's SwiftUI views (never rendered by a screen; present so its module loads). */
export const swiftUi = { Button: host('Button'), HStack: host('HStack'), Image: host('Image'), Spacer: host('Spacer'), Text: host('Text'), VStack: host('VStack') };
const modifier = () => ({});
export const swiftUiModifiers = {
  accessibilityElement: modifier,
  accessibilityLabel: modifier,
  activityBackgroundTint: modifier,
  buttonStyle: modifier,
  controlSize: modifier,
  font: modifier,
  foregroundStyle: modifier,
  frame: modifier,
  lineLimit: modifier,
  minimumScaleFactor: modifier,
  monospacedDigit: modifier,
  padding: modifier,
  tint: modifier,
};
