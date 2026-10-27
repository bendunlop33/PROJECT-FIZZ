import { Component, type ReactNode } from 'react';
import { ScrollView } from 'react-native';

import { lastErrorSinceLastLaunch, nativeFeaturesOffForBuild, recordContainedError } from '../diagnostics/crash-capture';
import { safeStartView, type LaunchGuardDecision } from '../diagnostics/launch-guard';
import { SaveCopyToFiles } from '../screens/data/SaveCopyToFiles';
import { MessageScreen, PrimaryButton, SecondaryButton } from '../ui';

/**
 * The safe start (`launch-guard.ts`): the last run closed before it settled. The unfinished workout is kept as
 * stored and not opened by itself; Ben picks Resume, Today (Discard is there) or a backup copy first.
 */
export function SafeStartScreen({ decision, workout, onResume, onToday }: { decision: LaunchGuardDecision; workout: { name: string | null } | null; onResume: () => void; onToday: () => void }) {
  const last = lastErrorSinceLastLaunch();
  const view = safeStartView({ workoutName: workout?.name ?? null, workoutOpen: workout !== null, lastError: last === null ? null : { name: last.name, message: last.message, atUtc: last.atUtc }, previous: decision.previous, offForBuild: nativeFeaturesOffForBuild() });
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <MessageScreen title={view.title} lines={view.lines}>
        {view.resume ? <PrimaryButton label="Resume workout" onPress={onResume} /> : null}
        {view.resume ? <SecondaryButton label="Today" onPress={onToday} /> : <PrimaryButton label="Continue" onPress={onToday} />}
        <SaveCopyToFiles variant="secondary" />
      </MessageScreen>
    </ScrollView>
  );
}

interface BoundaryProps {
  /** Shown instead of the app after a render error, with the error and a way back. */
  fallback: (error: unknown, reset: () => void) => ReactNode;
  /** Remount from scratch (e.g. at Today, not straight into the workout). */
  onReset: () => void;
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
    recordContainedError(error, 'app');
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
