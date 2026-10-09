/**
 * Guide player state (ADR 0013). Pure: the component dispatches actions and
 * asks `isRunning` whether the UI-thread clock should tick.
 *
 * - `animate`: the guide loops at its own tempo, autoplay stopping after
 *   `MAX_AUTOPLAY_PASSES` with `Replay`; `Pause` always available.
 * - `steps`: the static key frames (start, middle, end…) one at a time with
 *   Previous/Next. The default with Reduce Motion on (research §5.7); Ben can
 *   still choose `Play animation`.
 */
export type PlayerMode = 'animate' | 'steps';

export interface PlayerState {
  mode: PlayerMode;
  /** Ben paused the animation (survives going off-screen and back). */
  paused: boolean;
  /** Autoplay finished its passes; showing the first frame with Replay. */
  finished: boolean;
  /** Current key frame in `steps` mode. */
  step: number;
  stepCount: number;
  /** Bumped when the clock must restart from the first frame (Replay, Play animation). */
  run: number;
}

export type PlayerAction =
  | { type: 'toggle_play' }
  | { type: 'finished' }
  | { type: 'step'; delta: 1 | -1 }
  | { type: 'show_steps' }
  | { type: 'show_animation' }
  | { type: 'reduce_motion'; on: boolean };

export function initialPlayerState(reduceMotion: boolean, stepCount: number): PlayerState {
  return { mode: reduceMotion && stepCount > 0 ? 'steps' : 'animate', paused: false, finished: false, step: 0, stepCount, run: 0 };
}

export function playerReducer(s: PlayerState, a: PlayerAction): PlayerState {
  switch (a.type) {
    case 'toggle_play':
      if (s.mode !== 'animate') return s;
      // Replay after the autoplay passes, otherwise pause/resume where it was.
      if (s.finished) return { ...s, finished: false, paused: false, run: s.run + 1 };
      return { ...s, paused: !s.paused };
    case 'finished':
      return s.mode === 'animate' ? { ...s, finished: true, paused: false } : s;
    case 'step': {
      if (s.mode !== 'steps' || s.stepCount === 0) return s;
      const step = Math.min(s.stepCount - 1, Math.max(0, s.step + a.delta));
      return step === s.step ? s : { ...s, step };
    }
    case 'show_steps':
      return s.stepCount === 0 || s.mode === 'steps' ? s : { ...s, mode: 'steps', step: 0 };
    case 'show_animation':
      return s.mode === 'animate' ? s : { ...s, mode: 'animate', paused: false, finished: false, run: s.run + 1 };
    case 'reduce_motion':
      // Turning Reduce Motion on stops the animation at once; turning it off never starts one by itself.
      return a.on && s.mode === 'animate' && s.stepCount > 0 ? { ...s, mode: 'steps', step: 0 } : s;
  }
}

export interface RunEnvironment {
  /** The player is on screen (its screen is focused and it isn't scrolled away). */
  visible: boolean;
  /** The app is in the foreground. */
  appActive: boolean;
  /** Every frame of the animation is baked. */
  framesReady: boolean;
}

/** Whether the clock ticks. Anything off-screen or in the background stops it (battery during rest). */
export function isRunning(s: PlayerState, env: RunEnvironment): boolean {
  return s.mode === 'animate' && !s.paused && !s.finished && env.visible && env.appActive && env.framesReady;
}

/** The play control's label (and VoiceOver name): what a tap will do. */
export function playControlLabel(s: PlayerState): 'Pause' | 'Play' | 'Replay' {
  if (s.finished) return 'Replay';
  return s.paused ? 'Play' : 'Pause';
}

/** `2 of 3 · Bottom` for the steps view. */
export function stepPosition(s: PlayerState, label: string): string {
  return `${String(s.step + 1)} of ${String(s.stepCount)} · ${label}`;
}
