import { vi } from 'vitest';

/**
 * Render smoke tests (ADR 0037): every native package the app imports is replaced by its JS stand-in (stubs/), so
 * screens render under Node with React's real reconciler, real hooks and the real services on real SQLite.
 */
// React's act() environment, and React Native's `__DEV__` (a development build, as the warnings need).
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, __DEV__: true });
// React Native's frame globals (Hermes has them; Node doesn't).
if (typeof globalThis.requestAnimationFrame !== 'function') {
  Object.assign(globalThis, {
    requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => {
      cb(performance.now());
    }, 16),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => {
      clearTimeout(id);
    },
  });
}

vi.mock('react-native', () => import('./stubs/react-native'));
vi.mock('@react-navigation/native', () => import('./stubs/navigation'));
vi.mock('@react-navigation/native-stack', () => import('./stubs/navigation'));
vi.mock('@react-navigation/bottom-tabs', () => import('./stubs/navigation'));
vi.mock('react-native-safe-area-context', async () => (await import('./stubs/native')).safeArea);
vi.mock('expo', async () => (await import('./stubs/native')).expo);
vi.mock('expo/fetch', async () => (await import('./stubs/native')).expoFetch);
vi.mock('expo-application', async () => (await import('./stubs/native')).application);
vi.mock('expo-constants', async () => (await import('./stubs/native')).constants);
vi.mock('expo-crypto', async () => (await import('./stubs/native')).crypto);
vi.mock('expo-file-system', async () => (await import('./stubs/native')).fileSystem);
vi.mock('expo-haptics', async () => (await import('./stubs/native')).haptics);
vi.mock('expo-localization', async () => (await import('./stubs/native')).localization);
vi.mock('expo-notifications', async () => (await import('./stubs/native')).notifications);
vi.mock('expo-secure-store', async () => (await import('./stubs/native')).secureStore);
vi.mock('expo-speech', async () => (await import('./stubs/native')).speech);
vi.mock('expo-speech-recognition', async () => (await import('./stubs/native')).speechRecognition);
vi.mock('expo-sqlite', async () => (await import('./stubs/native')).sqlite);
vi.mock('expo-status-bar', async () => (await import('./stubs/native')).statusBar);
vi.mock('expo-symbols', async () => (await import('./stubs/native')).symbols);
vi.mock('expo-widgets', async () => (await import('./stubs/native')).widgets);
vi.mock('@react-native-community/datetimepicker', async () => (await import('./stubs/native')).datetimepicker);
vi.mock('@shopify/react-native-skia', async () => (await import('./stubs/native')).skia);
vi.mock('react-native-reanimated', async () => (await import('./stubs/native')).reanimated);
vi.mock('react-native-worklets', async () => (await import('./stubs/native')).worklets);
vi.mock('@expo/ui/swift-ui', async () => (await import('./stubs/native')).swiftUi);
vi.mock('@expo/ui/swift-ui/modifiers', async () => (await import('./stubs/native')).swiftUiModifiers);

// Progress's chart canvas is required lazily on the phone (`load-charts.ts`, a guarded `require`); Node's ESM test
// runner has no `require` for a .tsx module, so the loader hands over the same module, imported (Skia stubbed above).
// Without this the charts would render their no-Skia fallback and the canvas code would never run here.
vi.mock('../../src/progress/load-charts', async () => {
  const { TrendCanvas } = await import('../../src/progress/TrendCanvas');
  return { loadTrendCanvas: () => ({ ok: true, value: TrendCanvas }) };
});
