/**
 * `@react-navigation/*` for render smoke tests (ADR 0037): a screen is rendered on its own, with the route and a
 * recording navigation object from `NavStub`. `useFocusEffect` runs like an effect (the screen is focused), so a
 * screen's focus loads happen as on the phone.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';

export interface NavCall {
  method: string;
  args: unknown[];
}

export interface NavValue {
  route: { key: string; name: string; params?: unknown };
  navigation: Record<string, unknown>;
  calls: NavCall[];
}

/** A navigation object whose every method is recorded; listeners and parents behave like a focused screen. */
export function createNavigation(calls: NavCall[]): Record<string, unknown> {
  const fixed: Record<string, unknown> = {
    addListener: () => () => undefined,
    removeListener: () => undefined,
    isFocused: () => true,
    canGoBack: () => true,
    getId: () => undefined,
    getState: () => ({ key: 'stack', index: 0, routes: [], routeNames: [], type: 'stack', stale: false }),
  };
  const nav: Record<string, unknown> = new Proxy(fixed, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'getParent') return () => nav;
      if (prop in target) return target[prop];
      const fn = (...args: unknown[]) => {
        calls.push({ method: prop, args });
      };
      target[prop] = fn;
      return fn;
    },
  });
  return nav;
}

const NavContext = createContext<NavValue | null>(null);

export function NavStub({ value, children }: { value: NavValue; children: ReactNode }) {
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

function useNav(): NavValue {
  const v = useContext(NavContext);
  if (v === null) throw new Error('render test: screen rendered outside NavStub');
  return v;
}

export const useNavigation = () => useNav().navigation;
export const useRoute = () => useNav().route;
export const useIsFocused = () => true;
export function useFocusEffect(effect: () => undefined | (() => void)) {
  useEffect(() => effect() ?? undefined, [effect]);
}
export const useNavigationContainerRef = () => ({ current: null, isReady: () => false });
export function NavigationContainer({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const colors = { primary: '#007aff', background: '#fff', card: '#fff', text: '#000', border: '#ccc', notification: '#f00' };
const font = { fontFamily: 'System', fontWeight: '400' };
const fonts = { regular: font, medium: font, bold: font, heavy: font };
export const DefaultTheme = { dark: false, colors, fonts };
export const DarkTheme = { dark: true, colors, fonts };

function navigator() {
  return { Navigator: ({ children }: { children: ReactNode }) => <>{children}</>, Screen: () => null, Group: ({ children }: { children: ReactNode }) => <>{children}</> };
}
export const createNativeStackNavigator = navigator;
export const createBottomTabNavigator = navigator;
/** The tab bar's height inside a tab (a phone with a home indicator). */
export const BottomTabBarHeightContext = createContext<number | undefined>(83);
