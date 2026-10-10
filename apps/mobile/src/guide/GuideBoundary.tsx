import { Component, type ReactNode } from 'react';

interface Props {
  /** Called once when anything below throws while rendering (or in an effect). */
  onError: (error: unknown) => void;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Contains a guide player failure (review S1): Skia or the bake throwing must
 * never take down How to, let alone the workout under it. Renders nothing once
 * failed; the screen shows the cues with an honest notice instead
 * (`howToLayout`). The player's worklets catch their own errors and hand them
 * to JS (`scheduleOnRN`), where the player rethrows them in render so they
 * land here (ADR 0018). An uncaught animation-thread error, or a native crash
 * in Skia or Reanimated, aborts the app in a release build and can't be
 * caught anywhere; Developer › Exercise guide animations off is the safe mode,
 * and How to's breadcrumb records the close at the next launch.
 */
export class GuideBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
