import { requireOptionalNativeModule, type NativeModule } from 'expo';

/** How the system sign-in sheet ended. */
export type NativeAuthOutcome =
  | { outcome: 'callback'; url: string }
  | { outcome: 'cancelled' }
  | { outcome: 'timeout' }
  | { outcome: 'error'; message: string };

export interface NativeListenerLogEntry {
  atMs: number;
  kind: string;
  detail: string;
}

declare class LoopbackAuthNativeModule extends NativeModule {
  /** Listens on 127.0.0.1 (preferred port, else any free port). Restarts if already listening. */
  startListener(path: string, preferredPort: number): Promise<{ port: number }>;
  /**
   * Opens ASWebAuthenticationSession. Resolves when the listener gets GET
   * <path> (the sheet is then closed), on Cancel, on timeout, or on error.
   */
  openAuthSession(url: string, timeoutMs: number, ephemeral: boolean): Promise<NativeAuthOutcome>;
  cancelAuthSession(): Promise<void>;
  stopListener(): Promise<void>;
  /** Diagnostics since the last startListener. Never includes the callback query. */
  getLog(): Promise<NativeListenerLogEntry[]>;
}

/** null when this build predates the module: callers show "unavailable". */
const LoopbackAuth: LoopbackAuthNativeModule | null = requireOptionalNativeModule<LoopbackAuthNativeModule>('LoopbackAuth');

export default LoopbackAuth;
