import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

import { DEFAULT_A11Y, directionById, resolveTheme, schemeFor, type AccessibilityPrefs, type AvailableDirectionId, type ResolvedTheme } from './tokens';

interface ThemeContextValue {
  theme: ResolvedTheme;
  directionId: AvailableDirectionId;
  setDirection: (id: AvailableDirectionId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Live iOS accessibility settings that change tokens. Re-read when they change. */
function useAccessibilityPrefs(): AccessibilityPrefs {
  const [prefs, setPrefs] = useState<AccessibilityPrefs>(DEFAULT_A11Y);
  useEffect(() => {
    let alive = true;
    const set = (patch: Partial<AccessibilityPrefs>) => {
      if (alive) setPrefs((p) => ({ ...p, ...patch }));
    };
    void Promise.all([
      AccessibilityInfo.isBoldTextEnabled(),
      AccessibilityInfo.isDarkerSystemColorsEnabled(),
      AccessibilityInfo.isReduceMotionEnabled(),
    ]).then(([boldText, increaseContrast, reduceMotion]) => {
      set({ boldText, increaseContrast, reduceMotion });
    });
    const subs = [
      AccessibilityInfo.addEventListener('boldTextChanged', (v: boolean) => {
        set({ boldText: v });
      }),
      AccessibilityInfo.addEventListener('darkerSystemColorsChanged', (v: boolean) => {
        set({ increaseContrast: v });
      }),
      AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => {
        set({ reduceMotion: v });
      }),
    ];
    return () => {
      alive = false;
      subs.forEach((s) => {
        s.remove();
      });
    };
  }, []);
  return prefs;
}

interface Props {
  /** The saved look (device preference); null while it loads or when never set. */
  savedDirection: string | null;
  onChangeDirection: (id: AvailableDirectionId) => void;
  children: ReactNode;
}

/**
 * Follows the system light/dark setting (A only; D is always dark) and Dynamic Type (text scales through
 * React Native's font scaling, capped per token). The look (A or D) is a
 * device preference; D is the default.
 */
export function ThemeProvider({ savedDirection, onChangeDirection, children }: Props) {
  const system = useColorScheme();
  const a11y = useAccessibilityPrefs();
  const [override, setOverride] = useState<AvailableDirectionId | null>(null);
  const direction = directionById(override ?? savedDirection);
  const scheme = schemeFor(direction.id, system);
  const directionId = direction.id === 'A' ? 'A' : 'D';
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: resolveTheme(direction, scheme, a11y),
      directionId,
      setDirection: (id) => {
        setOverride(id);
        onChangeDirection(id);
      },
    }),
    [direction, directionId, scheme, a11y, onChangeDirection],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ResolvedTheme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx.theme;
}

export function useThemeDirection(): Pick<ThemeContextValue, 'directionId' | 'setDirection'> {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeDirection outside ThemeProvider');
  return { directionId: ctx.directionId, setDirection: ctx.setDirection };
}
