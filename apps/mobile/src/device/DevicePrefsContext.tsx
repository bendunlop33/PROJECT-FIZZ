import { createContext, useContext, type ReactNode } from 'react';

import { DEFAULT_PREFS, type DevicePrefs } from './prefs';

interface DevicePrefsValue {
  prefs: DevicePrefs;
  update: (change: Partial<DevicePrefs>) => void;
  /** Back to defaults in memory, without writing the file (Delete my data removed it). */
  clear: () => void;
}

const Ctx = createContext<DevicePrefsValue>({ prefs: DEFAULT_PREFS, update: () => undefined, clear: () => undefined });

/** This phone's preferences (`prefs.ts`), owned and saved by `Root`. */
export function DevicePrefsProvider({ value, children }: { value: DevicePrefsValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDevicePrefs(): DevicePrefsValue {
  return useContext(Ctx);
}
