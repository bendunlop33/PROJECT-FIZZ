import { Component, type ReactNode } from 'react';
import { ScrollView } from 'react-native';

import { lastErrorSinceLastLaunch, nativeFeaturesOffForBuild, recordContainedError } from '../diagnostics/crash-capture';
import { holdLaunch } from '../diagnostics/launch-settle';
import { safeStartView, type LaunchGuardDecision } from '../diagnostics/launch-guard';
import { SaveCopyToFiles } from '../screens/data/SaveCopyToFiles';
import { MessageScreen, PrimaryButton, SecondaryButton } from '../ui';

/**
 * The safe start (`launch-guard.ts`): the last run closed before it settled. The unfinished workout is kept as
 * stored and not opened by itself; Ben picks Resume, Today (Discard is there) or a backup copy first.
 *
 * (Hang fix, 27 Oct) It shows at once, before the data is opened (`ready: false`: what happened and the last error,
 * `Opening…` in place of the buttons), so nothing the services do at boot can leave the launch blank. The buttons and
 * the backup copy come once the data is open (they need it).
 */
export function SafeStartScreen({ decision, workout, ready, onResume, onToday }: { decision: LaunchGuardDecision; workout: { name: string | null } | null; ready: boolean; onResume: () => void; onToday: () => void }) {
  const last = lastErrorSinceLastLaunch();
  const view = safeStartView({ workoutName: workout?.name ?? null, workoutOpen: workout !== null, lastError: last === null ? null : { name: last.name, message: last.message, atUtc: last.atUtc }, previous: decision.previous, offForBuild: nativeFeaturesOffForBuild() });
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <MessageScreen title={view.title} lines={view.lines}>
        {!ready ? <PrimaryButton label="Opening…" busy onPress={() => undefined} /> : null}
        {ready && view.resume ? <PrimaryButton label="Resume workout" onPress={onResume} /> : null}
        {ready ? view.resume ? <SecondaryButton label="Today" onPress={onToday} /> : <PrimaryButton label="Continue" onPress={onToday} /> : null}
        {ready ? <SaveCopyToFiles variant="secondary" /> : null}
      </MessageScreen>
    </ScrollView>
  );
}

interface BoundaryProps {
  /** Shown instead of the app after a render error, with the error and a way back. */
  fallback: (error: unknown, reset: () => void) => ReactNode;
  /** Remount from scratch (e.g. at Today, not straight into the workout). */
  onReset: () => void;
  /** What the Last error says contained it (`app`, `workout`). */
  name?: string;
  children: ReactNode;
}

interface BoundaryState {
  error: unknown;
  failed: boolean;
}

/**
 * Around the whole navigator: a render error anywhere (the workout screen included) is recorded as Last error and
 * shown, instead of React Native closing the app (a release build treats an uncaught render error as fatal). Errors
 * in event handlers and timers don't reach a boundary; the launch breadcrumb covers those.
 */
export class AppBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error, failed: true };
  }

  override componentDidCatch(error: unknown): void {
    recordContainedError(error, this.props.name ?? 'app');
    // (Hang fix, 27 Oct) The run never settles after this: the next launch is a safe start that names the error.
    holdLaunch();
  }

  private reset = (): void => {
    this.setState({ error: null, failed: false });
    this.props.onReset();
  };

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}

/** The boundary's screen: what failed, Today, and a backup copy. */
export function AppErrorScreen({ error, onToday }: { error: unknown; onToday: () => void }) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <MessageScreen title="Something went wrong" lines={[text.length > 300 ? `${text.slice(0, 299)}…` : text, 'Your data is kept.']}>
        <PrimaryButton label="Today" onPress={onToday} />
        <SaveCopyToFiles variant="secondary" />
      </MessageScreen>
    </ScrollView>
  );
}
