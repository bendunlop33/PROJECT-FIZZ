import type { EquipmentInstance, SessionExercise, SetValues } from '@fizz/schemas';

import { localDateOf } from '../calendar';
import { formatDuration, formatNumber, NBSP } from '../display';
import { massWords } from '../progress/text';
import { longDate, shortDate } from '../progress/exercise-view';
import { trailingAverage, type ExerciseTabView } from '../progress/exercise-tab';
import { toMs } from '../time';
import type { HistorySession } from '../progression';
import { lastComparableSessions, type PreviousSession } from './active-view';
import { setLastText } from './last-time';
import { resultsSummary } from './table-view';

/**
 * (Ben, 26 Oct; competitor pass 4 #4) The exercise pop-up's read-only `History` during a workout: the last 3
 * comparable sessions (`lastComparableSessions`: same item, unit and convention; FitNotes on unit and convention)
 * as `12 Oct · 100 × 8, 8, 7`, and a small top-set chart over the last few of them, in the Progress chart's shape
 * (`ExerciseTabView['chart']`) so the same component draws it. Every value is a logged result (rule 6: no estimate,
 * no invented point). Pure.
 */

export const HISTORY_GLANCE = { rows: 3, chartSessions: 10 } as const;

export interface HistoryGlanceRow {
  sessionId: string;
  /** `12 Oct` (`12 Oct 2025` in another year). */
  date: string;
  /** `100 × 8, 8, 7` (working sets, as the `Last` line reads them). */
  text: string;
  accessibilityLabel: string;
}

export interface HistoryGlanceView {
  /** Newest first, at most `HISTORY_GLANCE.rows`. */
  rows: HistoryGlanceRow[];
  /** Oldest to newest; null when there's nothing to draw (no history, cardio or distance). */
  chart: ExerciseTabView['chart'] | null;
  /** `No history yet`; null when there are rows. */
  empty: string | null;
}

type Ex = Pick<SessionExercise, 'measurement' | 'loadConvention' | 'laterality' | 'unit'>;

/** The session's top set: the heaviest load (least assistance) for reps; bodyweight the most reps; timed the longest. */
function topOf(sets: readonly SetValues[], ex: Ex): { value: SetValues; n: number } | null {
  let best: { value: SetValues; n: number } | null = null;
  for (const v of sets) {
    let n: number | null = null;
    if (ex.measurement === 'duration') n = v.durationS;
    else if (ex.measurement !== 'reps') n = null;
    else if (ex.loadConvention === 'bodyweight' || v.load === null || v.load.convention === 'bodyweight') n = ex.loadConvention === 'bodyweight' ? v.reps : null;
    else if (v.reps !== null && v.reps > 0) n = v.load.value;
    if (n === null) continue;
    const lower = ex.loadConvention === 'assistance' && ex.measurement === 'reps';
    if (best === null || (lower ? n < best.n : n > best.n) || (n === best.n && (v.reps ?? 0) > (best.value.reps ?? 0))) best = { value: v, n };
  }
  return best;
}

function unitOf(ex: Ex): string {
  if (ex.measurement === 'duration') return 'min:s';
  if (ex.loadConvention === 'bodyweight') return 'reps';
  switch (ex.loadConvention) {
    case 'per_hand':
      return `${ex.unit} each`;
    case 'stack':
      return `${ex.unit} stack`;
    case 'assistance':
      return `${ex.unit} assist`;
    case 'added':
      return `+${ex.unit}`;
    case 'total':
      return ex.unit;
  }
}

export function exerciseHistoryGlance(input: { sessions: readonly PreviousSession[]; ex: Ex; eq: Pick<EquipmentInstance, 'kind'> | null; tz: string; today: string }): HistoryGlanceView {
  const { ex, eq, tz, today } = input;
  const dated = input.sessions.map((s) => ({ s, date: localDateOf(toMs(s.performedAtUtc), tz) }));
  const rows = dated.slice(0, HISTORY_GLANCE.rows).map(({ s, date }) => {
    const text = resultsSummary(
      s.sets.map((c) => c.values),
      ex,
      eq,
    );
    return { sessionId: s.sessionId, date: shortDate(date, today), text, accessibilityLabel: `${longDate(date, today)}, ${text.replaceAll(NBSP, ' ').replaceAll(' × ', ' for ')}` };
  });
  const charted = ex.measurement === 'reps' || ex.measurement === 'duration';
  const points = charted
    ? dated
        .slice(0, HISTORY_GLANCE.chartSessions)
        .reverse()
        .flatMap(({ s, date }) => {
          const top = topOf(
            s.sets.map((c) => c.values),
            ex,
          );
          if (top === null) return [];
          const set = setLastText(top.value, ex, eq).replaceAll(NBSP, ' ');
          const spoken = ex.measurement === 'duration' ? formatDuration(top.n) : ex.loadConvention === 'bodyweight' ? `${formatNumber(top.n)} reps` : `${top.value.load === null ? '' : massWords(top.value.load, eq?.kind ?? null)} for ${String(top.value.reps ?? 0)} reps`;
          return [{ sessionId: s.sessionId, date, value: top.n, readout: `${shortDate(date, today)} · ${set}`.replaceAll(NBSP, ' '), words: `${longDate(date, today)}, top set ${spoken}` }];
        })
    : [];
  const avg = trailingAverage(
    points.map((p) => p.value),
    3,
  );
  const first = points[0];
  const last = points.at(-1);
  const chart =
    first === undefined || last === undefined
      ? null
      : {
          from: first.date,
          to: last.date,
          unit: unitOf(ex),
          format: ex.measurement === 'duration' ? ('duration' as const) : ('number' as const),
          points: points.map((p, i) => ({ ...p, average: avg[i] ?? p.value })),
          words: `Top set, last ${String(points.length)} ${points.length === 1 ? 'session' : 'sessions'}: ${points.map((p) => p.words).join('; ')}`,
        };
  return { rows, chart, empty: rows.length === 0 ? 'No history yet' : null };
}

export interface ExerciseRecap {
  /** `Last · 12 Oct`. */
  lastLabel: string;
  /** `80 × 8, 8, 7, 6` (that session's working sets). */
  lastText: string;
  /** `82.5 × 6`: the heaviest top set (least assistance; most reps on bodyweight; longest hold) of the comparable sessions; null: none to say. */
  bestText: string | null;
  accessibilityLabel: string;
}

/**
 * (Redesign 27 Oct, D6; Ben: the expanded card shows what the old pop-up did) An editor card's `Last · 12 Oct` with
 * that session's sets and `Best` (its heaviest top set), from logged results only (rule 6), on the newest workout's
 * item, unit and convention (`lastComparableSessions`: kg and lb, per dumbbell and total never mixed). Null: no
 * history. Pure.
 */
export function exerciseRecap(input: { history: readonly HistorySession[]; measurement: SessionExercise['measurement']; laterality: SessionExercise['laterality']; tz: string; today: string }): ExerciseRecap | null {
  const sorted = [...input.history].filter((h) => h.copy !== true).sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc));
  for (const newest of sorted) {
    const working = newest.sets.filter((s) => s.setType !== 'warmup');
    if (working.length === 0) continue;
    const loaded = working.find((s) => s.load !== null && s.load.convention !== 'bodyweight')?.load ?? null;
    const loadConvention = loaded?.convention ?? working.find((s) => s.load !== null)?.load?.convention ?? 'bodyweight';
    const unit = loaded?.unit ?? 'kg';
    const ex = { measurement: input.measurement, laterality: input.laterality, loadConvention, unit } as const;
    const sessions = lastComparableSessions(input.history, { equipmentId: newest.equipmentId, unit, loadConvention }, 1000);
    const last = sessions[0];
    if (last === undefined) continue;
    const date = localDateOf(toMs(last.performedAtUtc), input.tz);
    const lastText = resultsSummary(
      last.sets.map((c) => c.values),
      ex,
      null,
    );
    let best: { value: SetValues; n: number } | null = null;
    for (const s of sessions) {
      const top = topOf(
        s.sets.map((c) => c.values),
        ex,
      );
      if (top === null) continue;
      const lower = ex.loadConvention === 'assistance' && ex.measurement === 'reps';
      if (best === null || (lower ? top.n < best.n : top.n > best.n) || (top.n === best.n && (top.value.reps ?? 0) > (best.value.reps ?? 0))) best = top;
    }
    // Per dumbbell is said on every load (`24 ea × 10`; VoiceOver: each), never read as a total.
    const ea = (t: string): string => (loadConvention === 'per_hand' ? t.replace(/(\d+(?:\.\d+)?)(\s?×)/g, `$1${NBSP}ea$2`) : t);
    const bestRaw = best === null ? null : setLastText(best.value, ex, null);
    const bestText = bestRaw === null ? null : ea(bestRaw);
    const lastLabel = `Last · ${shortDate(date, input.today)}`;
    const said = (t: string) => t.replaceAll(NBSP, ' ').replaceAll(' ea ', ' each ');
    return { lastLabel, lastText: ea(lastText), bestText, accessibilityLabel: said([`Last time ${longDate(date, input.today)}, ${ea(lastText)}`, ...(bestText === null ? [] : [`best ${bestText}`])].join(', ')) };
  }
  return null;
}
