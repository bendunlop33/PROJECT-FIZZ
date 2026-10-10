import { MOTION, type HapticToken } from './tokens';

/**
 * Motion decisions (premium-feel.md §4, §5), pure so they're tested on
 * Linux. Components in `ui/motion.tsx` only play what these return. Under
 * Reduce Motion nothing scales, slides or staggers; fades stay where the
 * spec allows them (§4.5). No motion ever gates a write or a tap.
 */

export type PressKind = 'primary' | 'pill' | 'text' | 'row';

/** The pressed-down look for a pressable. Colour changes too (in the component), so feedback is never motion only. */
export function pressFeedback(kind: PressKind, reduceMotion: boolean): { scale: number; opacity: number } {
  switch (kind) {
    case 'primary':
      return { scale: reduceMotion ? 1 : MOTION['pressScale.primary'].scale, opacity: 1 };
    case 'pill':
      return { scale: reduceMotion ? 1 : MOTION['pressScale.pill'].scale, opacity: 1 };
    case 'text':
      return { scale: 1, opacity: MOTION['pressOpacity.text'].opacity };
    case 'row':
      // Rows highlight with `bg.surface`; no scale, no fade.
      return { scale: 1, opacity: 1 };
  }
}

export interface FadeRise {
  durationMs: number;
  delayMs: number;
  /** Start this many pt lower and rise to 0. */
  risePt: number;
}

/** Rest ↔ Ready swap inside Workout: a fade with an 8 pt rise; a shorter plain fade under Reduce Motion. */
export function swapMotion(reduceMotion: boolean): FadeRise {
  return reduceMotion ? { durationMs: MOTION.swap.reducedDurationMs, delayMs: 0, risePt: 0 } : { durationMs: MOTION.swap.durationMs, delayMs: 0, risePt: MOTION.swap.risePt };
}

/**
 * A row added after the first draw. The first `maxStaggered` rows stagger;
 * later ones appear with the last delay. Null: appear at once (Reduce Motion).
 */
export function listEnterMotion(index: number, reduceMotion: boolean): FadeRise | null {
  if (reduceMotion) return null;
  const i = Math.max(0, Math.min(index, MOTION.listEnter.maxStaggered - 1));
  return { durationMs: MOTION.listEnter.durationMs, delayMs: i * MOTION.listEnter.staggerMs, risePt: MOTION.listEnter.risePt };
}

/**
 * Which rows animate: only those not on screen at the first draw (§4.3).
 * `seen` is the set of keys drawn so far; the result is the new keys in order.
 */
export function rowsToAnimate(seen: ReadonlySet<string>, keys: readonly string[], firstDraw: boolean): string[] {
  if (firstDraw) return [];
  return keys.filter((k) => !seen.has(k));
}

export interface Glyph {
  char: string;
  /** This glyph differs from the one before at the same place: cross-fade it. */
  changed: boolean;
}

/**
 * The countdown's glyphs (`motion.digit`): only changed glyphs fade, so
 * `1:21 → 1:20` animates one digit. When the length changes (`10:00 →
 * 9:59`) or the jump is a ±30 s adjust, the whole numeral cross-fades once.
 * Under Reduce Motion nothing fades.
 */
export function timerGlyphs(prev: string | null, next: string, o: { reduceMotion: boolean; whole?: boolean }): Glyph[] {
  // Timer text is digits and a colon only, so plain code units are the glyphs.
  const chars = next.split("");
  if (o.reduceMotion || prev === null) return chars.map((char) => ({ char, changed: false }));
  const before = prev.split("");
  if (o.whole === true || before.length !== chars.length) return chars.map((char) => ({ char, changed: prev !== next }));
  return chars.map((char, i) => ({ char, changed: before[i] !== char }));
}

/** Finish moment (§6): the saved check draws, then the title fades in. Static under Reduce Motion. */
export function finishMotion(reduceMotion: boolean): { strokeMs: number; titleFadeMs: number; titleDelayMs: number } {
  return reduceMotion ? { strokeMs: 0, titleFadeMs: 0, titleDelayMs: 0 } : { ...MOTION.finish };
}

export type StackAnimation = 'default' | 'fade' | 'slide_from_bottom' | 'none';

/** Screen transitions (§4.2). Under Reduce Motion every slide becomes a fade. */
export function screenAnimation(route: 'Workout' | 'Summary', reduceMotion: boolean): { animation: StackAnimation; animationDuration?: number } {
  if (route === 'Summary') return { animation: 'fade', animationDuration: MOTION.screenFade.durationMs };
  return reduceMotion ? { animation: 'fade', animationDuration: MOTION.screenFade.durationMs } : { animation: 'default' };
}

/** A log that's also a record plays only the record haptic, never both (§5). */
export function logHaptic(record: boolean): Extract<HapticToken, 'commit' | 'record'> {
  return record ? 'record' : 'commit';
}

/**
 * `haptic.finish` once per finished workout, only after the Summary is shown
 * for a workout that really finished (never on discard, never on a later
 * visit to the same Summary from Today).
 */
export function shouldPlayFinish(o: { sessionStatus: 'active' | 'finished' | 'discarded' | 'reverted'; justFinished: boolean; played: ReadonlySet<string>; sessionId: string }): boolean {
  return o.sessionStatus === 'finished' && o.justFinished && !o.played.has(o.sessionId);
}
