import { useFocusEffect } from '@react-navigation/native';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { RecoveryResult } from '@fizz/domain';
import type { MigrationReport } from '@fizz/persistence';

import type { RestAlertController } from '../alerts/rest-alerts';

import type { AppServices } from '../services/app-services';

export interface LaunchInfo {
  migration: MigrationReport;
  sqliteVersion: string;
  /** Cold-start recovery of an unfinished workout (flow §4.2); its notices are shown once. */
  recovery: RecoveryResult | null;
  restAlerts: RestAlertController | null;
}

const consumed = new Set<string>();
/** True the first time `key` is asked for in this app run (one-off launch banners). */
export function firstTime(key: string): boolean {
  if (consumed.has(key)) return false;
  consumed.add(key);
  return true;
}

interface AppContextValue {
  services: AppServices;
  launch: LaunchInfo;
  /** Bumped after any write a screen makes, so other screens reload. */
  version: number;
  changed: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ services, launch, children }: { services: AppServices; launch: LaunchInfo; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);
  // A backup starting or finishing changes status lines everywhere.
  useEffect(() => services.backups.subscribe(changed), [services, changed]);
  return <AppContext.Provider value={{ services, launch, version, changed }}>{children}</AppContext.Provider>;
}

function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside AppProvider');
  return ctx;
}

export function useServices(): AppServices {
  return useApp().services;
}

export function useLaunchInfo(): LaunchInfo {
  return useApp().launch;
}

/** Call after a write so screens that show the data reload. */
export function useDataChanged(): () => void {
  return useApp().changed;
}

export type Loaded<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; message: string };

/**
 * Load local data for a screen: on focus, and again whenever any screen
 * reports a change. Reads are local, so there's no spinner (design-system:
 * static placeholders only after 300 ms; screens render nothing until then).
 */
export function useScreenData<T>(load: (services: AppServices) => Promise<T>): [Loaded<T>, () => void] {
  const { services, version } = useApp();
  const [data, setData] = useState<Loaded<T>>({ state: 'loading' });
  const loadRef = useRef(load);
  loadRef.current = load;
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadRef.current(services).then(
        (value) => {
          if (alive) setData({ state: 'ready', value });
        },
        (e: unknown) => {
          if (alive) setData({ state: 'error', message: e instanceof Error ? e.message : String(e) });
        },
      );
      return () => {
        alive = false;
      };
    }, [services, version, tick]),
  );
  return [data, reload];
}
