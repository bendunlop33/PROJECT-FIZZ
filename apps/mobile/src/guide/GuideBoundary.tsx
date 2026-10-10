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
 * (`howToLayout`). The player rethrows its UI-thread clock errors in render
 * so they land here; anything else on JS while How to's player is mounted is
 * caught by the crash-capture containment scope. Native crashes can't be
 * caught; Developer › Exercise guide animations off is the safe mode.
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
