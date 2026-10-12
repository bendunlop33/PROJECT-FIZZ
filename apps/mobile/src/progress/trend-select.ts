import type { ChartPointView, ExerciseSelection } from '@fizz/domain';

/**
 * What the exercise `TrendChart` highlights, reads to VoiceOver and opens
 * (review progress-B r3 S1). Under weekly bests an opened workout that isn't
 * its week's best highlights the week's point, but the panel, the VoiceOver
 * value and double-tap all follow the opened workout. Pure, so the chart's
 * gesture and accessibility rules are unit-tested without rendering.
 */

export interface ChartFocus {
  /** The highlighted point. */
  index: number;
  /** The workout the panel shows: double-tap and `Open workout ›` open it. */
  sessionId: string;
  /** The chart's VoiceOver value (without the double-tap hint). */
  words: string;
}

export interface ChartSelection {
  focus: ChartFocus;
  /** What the selection panel shows. */
  panel: ChartPointView;
  /** `Week best ≈163.5 kg` when the panel's workout isn't the highlighted point's. */
  weekBest: string | null;
}

/** The selection for the selected workout id: the service's opened selection when it matches, else that workout's own point. */
export function chartSelection(points: readonly ChartPointView[], selection: ExerciseSelection | null, selectedId: string | null): ChartSelection | null {
  if (selectedId === null) return null;
  if (selection !== null && selection.point.sessionId === selectedId) {
    const p = selection.point;
    const words = selection.weekBest === null ? p.words : `${p.words} ${selection.weekBest.words}`;
    return { focus: { index: selection.index, sessionId: p.sessionId, words }, panel: p, weekBest: selection.weekBest?.text ?? null };
  }
  const index = points.findIndex((p) => p.sessionId === selectedId);
  const p = points[index];
  if (p === undefined) return null;
  return { focus: { index, sessionId: p.sessionId, words: p.words }, panel: p, weekBest: null };
}

export type ChartActionOutcome = { kind: 'select'; index: number } | { kind: 'open'; sessionId: string } | null;

/** The adjustable chart's VoiceOver actions: swipe up/down steps through points, double-tap opens the workout in the panel. */
export function chartAccessibilityAction(actionName: string, count: number, focus: ChartFocus | null): ChartActionOutcome {
  if (count === 0) return null;
  switch (actionName) {
    case 'increment':
      return { kind: 'select', index: focus === null ? 0 : Math.min(count - 1, focus.index + 1) };
    case 'decrement':
      return { kind: 'select', index: focus === null ? count - 1 : Math.max(0, focus.index - 1) };
    case 'activate':
      return focus === null ? null : { kind: 'open', sessionId: focus.sessionId };
    default:
      return null;
  }
}

/**
 * Whether point `i` is what's selected now: highlighted and its own workout
 * in the panel. Touching a point that isn't selects it; tapping the selected
 * point again clears it (§4.2). A week point highlighted for another workout
 * of that week isn't selected itself, so a tap shows the week's best.
 */
export function isPointSelected(i: number, points: readonly ChartPointView[], focus: ChartFocus | null): boolean {
  return focus !== null && i >= 0 && i === focus.index && points[i]?.sessionId === focus.sessionId;
}
