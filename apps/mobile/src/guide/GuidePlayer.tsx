import { Canvas, Fill, Group, Picture, rect, rrect, type SkPicture } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, View } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { LoadedGuide } from '@fizz/catalogue';
import { GUIDE_CORNER_FRACTION, GUIDE_TOKEN_NAMES, guideStyleFromTokens, playbackTimes, type GuideStyle, type GuideTokens, type KeyFrameStop } from '@fizz/catalogue/figure';

import { useTheme } from '../theme';
import { AppText, SecondaryButton, Tag, TextButton } from '../ui';
import { bakeKey, bakeTasks, cachedBake, storeBake, type BakeConfig, type BakeKind } from './bake';
import { advanceClock, frameIndexAt } from './clock';
import type { HowToGuide } from './how-to';
import {
  guideDefinition,
  initialPlayerState,
  isRunning,
  MUSCLE_DEFINITION,
  MUSCLE_PULSE,
  musclePulseOn,
  playControlLabel,
  playerReducer,
  stepAccessibilityLabel,
  stepAnnouncement,
  stepPosition,
  type PlayerAction,
} from './player-model';
import { canPlayPrefix, runSliced } from './sliced';

/** Longest stretch of baking before the JS thread yields (one 120 Hz frame is ~8 ms). */
const BAKE_BUDGET_MS = 8;
/** While a playable animation is still baking, hand the player its longer prefix at most this often (each hand-over re-renders). */
const PREFIX_PUBLISH_MS = 200;

interface Baked {
  key: string;
  pictures: SkPicture[];
  done: boolean;
  /** Index of the steady Finished poster (animation with emphasis), else null. */
  steadyPoster: number | null;
  /** Frames the finished bake will have. */
  total: number;
  /** Still baking, but `pictures` is a prefix playback can start on (`canPlayPrefix`). */
  playable: boolean;
}

/** A bake that threw (review S1); the player rethrows it in render so `GuideBoundary` takes over. */
interface BakeFailure {
  key: string;
  error: unknown;
}

/**
 * Pictures for one guide and kind, baked in slices on the JS thread. Both
 * kinds show their first frame at once (poster); the animation plays once
 * every frame is ready. `kind: null` bakes nothing (the other view is showing). Every
 * Skia call happens inside a task, so a throw is reported, never fatal.
 */
function useBakedPictures(
  loaded: LoadedGuide,
  kind: BakeKind | null,
  stops: readonly KeyFrameStop[],
  style: GuideStyle,
  config: BakeConfig,
): { baked: Baked | null; failure: BakeFailure | null } {
  const key = kind === null ? null : bakeKey(loaded.key, kind, style, config);
  const [baked, setBaked] = useState<Baked | null>(null);
  const [failure, setFailure] = useState<BakeFailure | null>(null);
  useEffect(() => {
    if (key === null || kind === null) return;
    const hit = cachedBake(key);
    if (hit) {
      setBaked({ key, pictures: hit.pictures, done: true, steadyPoster: hit.steadyPoster, total: hit.steadyPoster ?? hit.pictures.length, playable: true });
      return;
    }
    const out: SkPicture[] = [];
    const fail = (error: unknown) => {
      setFailure({ key, error });
    };
    let plan: ReturnType<typeof bakeTasks>;
    try {
      plan = bakeTasks(loaded, kind, stops, style, out, config);
    } catch (error) {
      fail(error);
      return;
    }
    const progress = { finished: false };
    const total = plan.frameCount;
    const started = performance.now();
    let published = -Infinity;
    // The animation's first pass plays frames in order, so it can start on a baked prefix when the bake will keep ahead
    // (guides review B2). One frame interval of playback: a cycle shows n frames per duration, a ping-pong n − 1 each way.
    const intervals = loaded.guide.loop === 'pingpong' ? playbackTimes(loaded.guide).length - 1 : playbackTimes(loaded.guide).length;
    const frameIntervalMs = loaded.guide.durationMs / Math.max(1, intervals);
    const run = runSliced(plan.tasks, {
      budgetMs: BAKE_BUDGET_MS,
      // Draw the first frame before yielding, so the canvas is never empty (poster; review N1).
      firstSync: plan.firstSync,
      now: () => performance.now(),
      schedule: (fn) => {
        const handle = setTimeout(fn, 0);
        return () => {
          clearTimeout(handle);
        };
      },
      onDone: () => {
        progress.finished = true;
        storeBake(key, { pictures: out, steadyPoster: plan.steadyPoster });
        setBaked({ key, pictures: out, done: true, steadyPoster: plan.steadyPoster, total, playable: true });
      },
      onProgress: (run) => {
        if (kind !== 'animation') return;
        const now = performance.now();
        if (now - published < PREFIX_PUBLISH_MS) return;
        const ready = plan.framesDone(run);
        const msPerFrame = (now - started) / Math.max(1, run);
        if (!canPlayPrefix({ ready, total, msPerFrame, frameIntervalMs })) return;
        published = now;
        setBaked({ key, pictures: out.slice(0, ready), done: false, steadyPoster: null, total, playable: true });
      },
      onError: fail,
    });
    // Show the poster while the rest bakes (unless it all finished synchronously; review N2).
    if (!progress.finished && out.length > 0) setBaked({ key, pictures: out.slice(), done: false, steadyPoster: null, total, playable: false });
    return run.cancel;
  }, [key, kind, loaded, stops, style, config]);
  return {
    baked: baked !== null && baked.key === key ? baked : null,
    failure: failure !== null && failure.key === key ? failure : null,
  };
}

/**
 * The picture for the clock's current frame, swapped on the UI thread (no React render per frame). While the bake is
 * still extending `frames` (a playable prefix), a clock that gets ahead holds the last baked frame, never a gap.
 */
function AnimatedArt({ frames, first, frame }: { frames: readonly SkPicture[]; first: SkPicture; frame: SharedValue<number> }) {
  const picture = useDerivedValue(() => frames[Math.min(frame.value, frames.length - 1)] ?? first, [frames, first]);
  return <Picture picture={picture} />;
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setActive(s === 'active');
    });
    return () => {
      sub.remove();
    };
  }, []);
  return active;
}

interface Props {
  guide: HowToGuide;
  /** Canvas width and height in points (legible from about 240). The canvas has no side padding. */
  size: number;
  /** The player is on screen: its screen is focused and it isn't scrolled away. */
  visible: boolean;
  /** Below the controls, with the same side padding (the muscle legend, guides v2 §5.3). */
  footer?: ReactNode;
}

/**
 * `ExerciseGuide` (ADR 0013, research §5.4 and §5.7): an original figure
 * animation drawn with Skia from the shared draw ops, animated on the UI
 * thread. Neutral tokens only (never the accent) and no text in the art.
 * Under Reduce Motion it shows the key positions, one at a time (or the first
 * frame still, if the guide labels none), and never autoplays.
 */
export function GuidePlayer({ guide, size, visible, footer }: Props) {
  const theme = useTheme();
  const { loaded, stops } = guide;
  const reduceMotion = theme.a11y.reduceMotion;
  const [state, dispatch] = useReducer(playerReducer, undefined, () => initialPlayerState(reduceMotion, stops.length));
  useEffect(() => {
    dispatch({ type: 'reduce_motion', on: reduceMotion });
  }, [reduceMotion]);
  const appActive = useAppActive();
  /** A button press; VoiceOver hears the new key position, since focus stays on the button (review N6). */
  const press = (action: PlayerAction) => {
    const announcement = stepAnnouncement(state, playerReducer(state, action), stops);
    dispatch(action);
    if (announcement !== null) AccessibilityInfo.announceForAccessibility(announcement);
  };

  const style = useMemo<GuideStyle>(() => {
    const tokens = {} as GuideTokens;
    for (const name of GUIDE_TOKEN_NAMES) tokens[name] = theme.colors[name];
    return guideStyleFromTokens(tokens, theme.scheme);
  }, [theme.colors, theme.scheme]);

  // Guides v2: muscle colour from the entry, sized for this canvas; the emphasis only in animation (never Reduce Motion or Increase Contrast).
  const increaseContrast = theme.a11y.increaseContrast;
  const pulse = musclePulseOn({ setting: MUSCLE_PULSE, reduceMotion, increaseContrast, hasWorkPhase: guide.hasWorkPhase, hasMuscles: guide.muscles !== null });
  // Muscle definition (guides v2 §4.11): steady faint groups. React Native doesn't expose Differentiate Without Color, so it reads false.
  const definition = guideDefinition({ setting: MUSCLE_DEFINITION, pt: size, increaseContrast, differentiateWithoutColor: false, muscles: guide.muscles });
  const animConfig = useMemo<BakeConfig>(() => ({ pt: size, muscles: guide.muscles, pulse, increaseContrast, definition }), [size, guide.muscles, pulse, increaseContrast, definition]);
  const stillConfig = useMemo<BakeConfig>(() => ({ ...animConfig, pulse: false }), [animConfig]);

  const { baked: anim, failure: animFailure } = useBakedPictures(loaded, state.mode === 'animate' ? 'animation' : null, stops, style, animConfig);
  const { baked: still, failure: stillFailure } = useBakedPictures(loaded, state.mode === 'steps' ? 'steps' : null, stops, style, stillConfig);
  // The steady poster (if any) sits after the frames; it is shown only when the passes are finished. Playback starts on
  // a baked prefix when the bake will stay ahead of it (`canPlayPrefix`), else once every frame is ready.
  const frames = useMemo(
    () => (anim === null || !anim.playable ? null : anim.done && anim.steadyPoster !== null ? anim.pictures.slice(0, anim.steadyPoster) : anim.pictures),
    [anim],
  );
  const steadyPoster = anim?.done === true && anim.steadyPoster !== null ? (anim.pictures[anim.steadyPoster] ?? null) : null;

  // UI-thread clock: elapsed time → frame index → picture.
  const elapsed = useSharedValue(0);
  const frame = useSharedValue(0);
  const done = useSharedValue(false);
  const { durationMs, loop } = loaded.guide;
  // The clock runs over the whole cycle even while the tail is still baking.
  const count = frames === null ? 0 : (anim?.total ?? frames.length);
  const onFinished = useCallback(() => {
    dispatch({ type: 'finished' });
  }, []);
  const tick = useCallback(
    (info: FrameInfo) => {
      'worklet';
      if (done.value) return;
      const step = advanceClock(elapsed.value, info.timeSincePreviousFrame, durationMs, loop);
      elapsed.value = step.elapsedMs;
      // Assign only when the index changes: Reanimated's setter has no equality check, so every assignment
      // re-runs the derived picture and redraws the canvas at display rate (guides v2 review S2).
      const next = frameIndexAt(step.elapsedMs, durationMs, count, loop, info.timeSincePreviousFrame ?? 0);
      if (next !== frame.value) frame.value = next;
      if (step.finished) {
        done.value = true;
        scheduleOnRN(onFinished);
      }
    },
    [done, elapsed, frame, durationMs, loop, count, onFinished],
  );
  const clock = useFrameCallback(tick, false);
  const running = isRunning(state, { visible, appActive, framesReady: frames !== null });
  useEffect(() => {
    clock.setActive(running);
  }, [clock, running, tick]);
  useEffect(() => {
    // Replay / Play animation start from the first frame; a finished autoplay holds it.
    elapsed.value = 0;
    frame.value = 0;
    done.value = false;
  }, [state.run, state.finished, elapsed, frame, done]);

  // After every hook: hand a bake failure to GuideBoundary (cues-only fallback).
  const failure = animFailure ?? stillFailure;
  if (failure) throw failure.error;

  const poster = anim?.pictures[0] ?? null;

  const stop = state.mode === 'steps' ? stops[state.step] : undefined;
  // Position 1 shows as soon as its poster exists; later positions once baked.
  const stillPicture = still?.pictures[state.step] ?? null;
  const corner = size * GUIDE_CORNER_FRACTION;

  let art: ReactNode = null;
  if (state.mode === 'steps') art = stillPicture ? <Picture picture={stillPicture} /> : null;
  else if (state.finished && steadyPoster) art = <Picture picture={steadyPoster} />;
  else if (frames && poster) art = <AnimatedArt frames={frames} first={poster} frame={frame} />;
  else if (poster) art = <Picture picture={poster} />;

  const pad = { paddingHorizontal: theme.space['4'] };
  return (
    <View style={{ gap: theme.space['3'] }}>
      {guide.draftLabel ? (
        <View style={pad}>
          <Tag text={guide.draftLabel} />
        </View>
      ) : null}
      <View accessible accessibilityRole="image" accessibilityLabel={guide.accessibilityLabel} style={{ width: size, height: size, alignSelf: 'center' }}>
        <Canvas style={{ width: size, height: size }}>
          <Group clip={rrect(rect(0, 0, size, size), corner, corner)}>
            <Fill color={style.background} />
            {art ? <Group transform={[{ scale: size }]}>{art}</Group> : null}
          </Group>
        </Canvas>
      </View>

      {stop ? (
        <View accessible accessibilityLabel={stepAccessibilityLabel(state, stop)} style={[pad, { gap: theme.space['1'] }]}>
          <AppText variant="headline" numeric>
            {stepPosition(state, stop.label)}
          </AppText>
          {stop.caption ? (
            <AppText variant="callout" color="text.secondary">
              {stop.caption}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {state.mode === 'animate' ? (
        <View style={[pad, { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }]}>
          <View style={{ flexGrow: 1, flexBasis: 140 }}>
            <SecondaryButton
              label={playControlLabel(state)}
              icon={state.finished ? 'arrow.counterclockwise' : state.paused ? 'play.fill' : 'pause.fill'}
              onPress={() => {
                dispatch({ type: 'toggle_play' });
              }}
            />
          </View>
          {stops.length > 0 ? (
            <View style={{ flexGrow: 1, flexBasis: 140 }}>
              <SecondaryButton
                label="Key positions"
                icon="rectangle.split.3x1"
                accessibilityHint="Shows the key positions one at a time, without animation."
                onPress={() => {
                  press({ type: 'show_steps' });
                }}
              />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={[pad, { gap: theme.space['2'] }]}>
          {/* No labelled key positions (P6): just the still first frame and Play animation. */}
          {state.stepCount > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }}>
              <View style={{ flexGrow: 1, flexBasis: 140 }}>
                <SecondaryButton
                  label="Previous"
                  icon="chevron.left"
                  disabled={state.step === 0}
                  onPress={() => {
                    press({ type: 'step', delta: -1 });
                  }}
                />
              </View>
              <View style={{ flexGrow: 1, flexBasis: 140 }}>
                <SecondaryButton
                  label="Next"
                  icon="chevron.right"
                  disabled={state.step >= state.stepCount - 1}
                  onPress={() => {
                    press({ type: 'step', delta: 1 });
                  }}
                />
              </View>
            </View>
          ) : null}
          <TextButton
            label="Play animation"
            icon="play"
            tone="secondary"
            onPress={() => {
              dispatch({ type: 'show_animation' });
            }}
          />
        </View>
      )}
      {footer ? <View style={pad}>{footer}</View> : null}
    </View>
  );
}
