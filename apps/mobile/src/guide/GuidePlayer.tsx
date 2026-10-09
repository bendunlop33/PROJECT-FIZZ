import { Canvas, Fill, Group, Picture, rect, rrect, type SkPicture } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { LoadedGuide } from '@fizz/catalogue';
import { GUIDE_CORNER_FRACTION, GUIDE_TOKEN_NAMES, guideStyleFromTokens, type GuideStyle, type GuideTokens, type KeyFrameStop } from '@fizz/catalogue/figure';

import { useTheme } from '../theme';
import { AppText, SecondaryButton, Tag, TextButton } from '../ui';
import { bakeKey, bakeTasks, cachedBake, storeBake, type BakeKind } from './bake';
import { advanceClock, frameIndexAt } from './clock';
import type { HowToGuide } from './how-to';
import { initialPlayerState, isRunning, playControlLabel, playerReducer, stepPosition } from './player-model';
import { runSliced } from './sliced';

/** Longest stretch of baking before the JS thread yields (one 120 Hz frame is ~8 ms). */
const BAKE_BUDGET_MS = 8;

interface Baked {
  key: string;
  pictures: SkPicture[];
  done: boolean;
}

/** A bake that threw (review S1); the player rethrows it in render so `GuideBoundary` takes over. */
interface BakeFailure {
  key: string;
  error: unknown;
}

/**
 * Pictures for one guide and kind, baked in slices on the JS thread. The
 * animation shows its first frame at once (poster) and plays once every frame
 * is ready. `kind: null` bakes nothing (the other view is showing). Every
 * Skia call happens inside a task, so a throw is reported, never fatal.
 */
function useBakedPictures(loaded: LoadedGuide, kind: BakeKind | null, stops: readonly KeyFrameStop[], style: GuideStyle): { baked: Baked | null; failure: BakeFailure | null } {
  const key = kind === null ? null : bakeKey(loaded.key, kind, style);
  const [baked, setBaked] = useState<Baked | null>(null);
  const [failure, setFailure] = useState<BakeFailure | null>(null);
  useEffect(() => {
    if (key === null || kind === null) return;
    const hit = cachedBake(key);
    if (hit) {
      setBaked({ key, pictures: hit, done: true });
      return;
    }
    const out: SkPicture[] = [];
    const fail = (error: unknown) => {
      setFailure({ key, error });
    };
    let plan: ReturnType<typeof bakeTasks>;
    try {
      plan = bakeTasks(loaded, kind, stops, style, out);
    } catch (error) {
      fail(error);
      return;
    }
    const { tasks, firstFrame } = plan;
    const run = runSliced(tasks, {
      budgetMs: BAKE_BUDGET_MS,
      // Animation: draw the first frame before yielding, so the canvas is never empty (poster).
      firstSync: kind === 'animation' ? firstFrame + 1 : 0,
      now: () => performance.now(),
      schedule: (fn) => {
        const handle = setTimeout(fn, 0);
        return () => {
          clearTimeout(handle);
        };
      },
      onDone: () => {
        storeBake(key, out);
        setBaked({ key, pictures: out, done: true });
      },
      onError: fail,
    });
    if (out.length > 0 && out.length < tasks.length) setBaked({ key, pictures: out.slice(), done: false });
    return run.cancel;
  }, [key, kind, loaded, stops, style]);
  return {
    baked: baked !== null && baked.key === key ? baked : null,
    failure: failure !== null && failure.key === key ? failure : null,
  };
}

/** The picture for the clock's current frame, swapped on the UI thread (no React render per frame). */
function AnimatedArt({ frames, first, frame }: { frames: readonly SkPicture[]; first: SkPicture; frame: SharedValue<number> }) {
  const picture = useDerivedValue(() => frames[frame.value] ?? first, [frames, first]);
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
  /** Canvas width and height in points (legible from about 240). */
  size: number;
  /** The player is on screen: its screen is focused and it isn't scrolled away. */
  visible: boolean;
}

/**
 * `ExerciseGuide` (ADR 0013, research §5.4 and §5.7): an original figure
 * animation drawn with Skia from the shared draw ops, animated on the UI
 * thread. Neutral tokens only (never the accent) and no text in the art.
 * Under Reduce Motion it shows the key frames, one at a time.
 */
export function GuidePlayer({ guide, size, visible }: Props) {
  const theme = useTheme();
  const { loaded, stops } = guide;
  const reduceMotion = theme.a11y.reduceMotion;
  const [state, dispatch] = useReducer(playerReducer, undefined, () => initialPlayerState(reduceMotion, stops.length));
  useEffect(() => {
    dispatch({ type: 'reduce_motion', on: reduceMotion });
  }, [reduceMotion]);
  const appActive = useAppActive();

  const style = useMemo<GuideStyle>(() => {
    const tokens = {} as GuideTokens;
    for (const name of GUIDE_TOKEN_NAMES) tokens[name] = theme.colors[name];
    return guideStyleFromTokens(tokens);
  }, [theme.colors]);

  const { baked: anim, failure: animFailure } = useBakedPictures(loaded, state.mode === 'animate' ? 'animation' : null, stops, style);
  const { baked: still, failure: stillFailure } = useBakedPictures(loaded, state.mode === 'steps' ? 'steps' : null, stops, style);
  const frames = anim?.done === true ? anim.pictures : null;

  // UI-thread clock: elapsed time → frame index → picture.
  const elapsed = useSharedValue(0);
  const frame = useSharedValue(0);
  const done = useSharedValue(false);
  const { durationMs, loop } = loaded.guide;
  const count = frames?.length ?? 0;
  const onFinished = useCallback(() => {
    dispatch({ type: 'finished' });
  }, []);
  const tick = useCallback(
    (info: FrameInfo) => {
      'worklet';
      if (done.value) return;
      const step = advanceClock(elapsed.value, info.timeSincePreviousFrame, durationMs, loop);
      elapsed.value = step.elapsedMs;
      frame.value = frameIndexAt(step.elapsedMs, durationMs, count, loop);
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
  const stillPicture = still?.done === true ? (still.pictures[state.step] ?? null) : null;
  const corner = size * GUIDE_CORNER_FRACTION;

  let art: ReactNode = null;
  if (state.mode === 'steps') art = stillPicture ? <Picture picture={stillPicture} /> : null;
  else if (frames && poster) art = <AnimatedArt frames={frames} first={poster} frame={frame} />;
  else if (poster) art = <Picture picture={poster} />;

  return (
    <View style={{ gap: theme.space['3'] }}>
      {guide.draftLabel ? <Tag text={guide.draftLabel} /> : null}
      <View accessible accessibilityRole="image" accessibilityLabel={guide.accessibilityLabel} style={{ width: size, height: size, alignSelf: 'center' }}>
        <Canvas style={{ width: size, height: size }}>
          <Group clip={rrect(rect(0, 0, size, size), corner, corner)}>
            <Fill color={style.background} />
            {art ? <Group transform={[{ scale: size }]}>{art}</Group> : null}
          </Group>
        </Canvas>
      </View>

      {stop ? (
        <View accessible accessibilityLabel={`Key frame ${String(state.step + 1)} of ${String(state.stepCount)}, ${stop.label}. ${stop.caption ?? ''}`} style={{ gap: theme.space['1'] }}>
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
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }}>
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
                label="Key frames"
                icon="rectangle.split.3x1"
                accessibilityHint="Shows the key positions one at a time, without animation."
                onPress={() => {
                  dispatch({ type: 'show_steps' });
                }}
              />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: theme.space['2'] }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }}>
            <View style={{ flexGrow: 1, flexBasis: 140 }}>
              <SecondaryButton
                label="Previous"
                icon="chevron.left"
                disabled={state.step === 0}
                onPress={() => {
                  dispatch({ type: 'step', delta: -1 });
                }}
              />
            </View>
            <View style={{ flexGrow: 1, flexBasis: 140 }}>
              <SecondaryButton
                label="Next"
                icon="chevron.right"
                disabled={state.step >= state.stepCount - 1}
                onPress={() => {
                  dispatch({ type: 'step', delta: 1 });
                }}
              />
            </View>
          </View>
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
    </View>
  );
}
