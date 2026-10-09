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
 * (`howToLayout`). Errors on the UI thread or in native code can't be caught
 * here; those stay a device-test risk (ADR 0013).
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
