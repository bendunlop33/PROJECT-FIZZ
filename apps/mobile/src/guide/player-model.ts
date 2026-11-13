import { DETAIL_TIER_MIN_PT, effectiveDefinition, hasListedMuscles, type MuscleDefinition, type MuscleInput } from '@fizz/catalogue/figure';

/**
 * Guide player state (ADR 0013). Pure: the component dispatches actions and
 * asks `isRunning` whether the UI-thread clock should tick.
 *
 * - `animate`: the guide loops at its own tempo, autoplay stopping after
 *   `MAX_AUTOPLAY_PASSES` with `Replay`; `Pause` always available.
 * - `steps`: the still view: the key positions (start, middle, end…) one at a
 *   time with Previous/Next. The default with Reduce Motion on (research
 *   §5.7); Ben can still choose `Play animation`. A guide with no labelled
 *   key positions shows its first frame still (spec §8.9 P6): Reduce Motion
 *   never autoplays.
 * - Stills only (Profile › Developer › Exercise guide animations off): the
 *   `steps` view with no way into `animate`, so the UI-thread clock never
 *   runs. A safe mode in case the animation crashes on the phone.
 */
export type PlayerMode = 'animate' | 'steps';

export interface PlayerState {
  mode: PlayerMode;
  /** Ben paused the animation (survives going off-screen and back). */
  paused: boolean;
  /** Autoplay finished its passes; showing the first frame with Replay. */
  finished: boolean;
  /** Current key position in `steps` mode (0 when there are none). */
  step: number;
  stepCount: number;
  /** Bumped when the clock must restart from the first frame (Replay, Play animation). */
  run: number;
  /** Animations are off in Developer settings: `animate` is never entered. */
  stillsOnly: boolean;
}

export type PlayerAction =
  | { type: 'toggle_play' }
  | { type: 'finished' }
  | { type: 'step'; delta: 1 | -1 }
  | { type: 'show_steps' }
  | { type: 'show_animation' }
  | { type: 'reduce_motion'; on: boolean };

export function initialPlayerState(reduceMotion: boolean, stepCount: number, stillsOnly = false): PlayerState {
  return { mode: reduceMotion || stillsOnly ? 'steps' : 'animate', paused: false, finished: false, step: 0, stepCount, run: 0, stillsOnly };
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
      // The `Key positions` button only exists when there are some.
      return s.stepCount === 0 || s.mode === 'steps' ? s : { ...s, mode: 'steps', step: 0 };
    case 'show_animation':
      return s.mode === 'animate' || s.stillsOnly ? s : { ...s, mode: 'animate', paused: false, finished: false, run: s.run + 1 };
    case 'reduce_motion':
      // Turning Reduce Motion on stops the animation at once; turning it off never starts one by itself.
      return a.on && s.mode === 'animate' ? { ...s, mode: 'steps', step: 0 } : s;
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
  return !s.stillsOnly && s.mode === 'animate' && !s.paused && !s.finished && env.visible && env.appActive && env.framesReady;
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

/** The still view's VoiceOver label: `Key position 2 of 3, Bottom. Hips just below knees.` (spec §8.9 P2). */
export function stepAccessibilityLabel(s: PlayerState, stop: { label: string; caption?: string | null | undefined }): string {
  const head = `Key position ${String(s.step + 1)} of ${String(s.stepCount)}, ${stop.label}.`;
  return stop.caption ? `${head} ${stop.caption}` : head;
}

/**
 * What VoiceOver should announce after a button changed the key position
 * (review N6): focus stays on `Next`, so the new position isn't otherwise
 * read. Null when nothing visible changed (e.g. `Next` on the last one).
 */
export function stepAnnouncement(prev: PlayerState, next: PlayerState, stops: readonly { label: string; caption?: string | null | undefined }[]): string | null {
  if (next.mode !== 'steps') return null;
  if (prev.mode === 'steps' && prev.step === next.step) return null;
  const stop = stops[next.step];
  return stop ? stepAccessibilityLabel(next, stop) : null;
}

/**
 * Design-system `guide.musclePulse` (guides v2 §4.9, decision B2): during a
 * guide's loaded phase, strong muscles rise 0.80 → 1.0 and soft 0.36 → 0.50,
 * baked into the frames. On, as the spec recommends; Ben to confirm on device
 * (G13). Set to `false` for steady colour everywhere.
 */
export const MUSCLE_PULSE = true;

/**
 * Whether an animation bake carries the work-phase emphasis. Never under
 * Reduce Motion (including the opt-in `Play animation`), never under
 * Increase Contrast, never for a guide without a work phase, and never in
 * stills: those bakes are steady. A paused frame is held exactly as baked.
 */
export function musclePulseOn(opts: { setting: boolean; reduceMotion: boolean; increaseContrast: boolean; hasWorkPhase: boolean; hasMuscles: boolean }): boolean {
  return opts.setting && !opts.reduceMotion && !opts.increaseContrast && opts.hasWorkPhase && opts.hasMuscles;
}

/**
 * Design-system `guide.muscleDefinition` (guides v2 §4.11, decision B8): a
 * faint, steady shape for every muscle group the view can show. `neutral`
 * (a faint tone of the body), as the spec recommends, until Ben picks
 * `neutral`, `tint` or `off` on the review sheet and on device (G18). No
 * in-app setting, as with the pulse. Must equal the catalogue's
 * `DEFAULT_MUSCLE_DEFINITION` (what `guide:render` previews); a test checks.
 */
export const MUSCLE_DEFINITION: MuscleDefinition = 'neutral';

/**
 * The definition mode a canvas actually draws (`effectiveDefinition`): none
 * below the M/L tier, `tint` as `neutral` under Increase Contrast or
 * Differentiate Without Color, `tint` off without the entry's muscles. The
 * bake cache key and the legend both use it, so they always agree.
 */
export function guideDefinition(opts: {
  setting: MuscleDefinition;
  /** Canvas size in points. */
  pt: number;
  increaseContrast: boolean;
  differentiateWithoutColor: boolean;
  muscles: MuscleInput | null;
}): MuscleDefinition {
  return effectiveDefinition(opts.setting, {
    tier: opts.pt < DETAIL_TIER_MIN_PT ? 'compact' : 'full',
    increaseContrast: opts.increaseContrast,
    differentiateWithoutColor: opts.differentiateWithoutColor,
    hasMuscles: hasListedMuscles(opts.muscles),
  });
}
