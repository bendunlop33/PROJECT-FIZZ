import type { PlanBuilderAnswers, PlanGroup, PlanOtherTraining } from '@fizz/schemas';
import { PB_PREF_DAYS, PB_SPORT_DEFAULT_DAY } from './tables';

/**
 * The plan builder's starting answers (D7, Ben 22–23 Oct): the ✦ answers start selected (6 weeks, Standard,
 * Balanced, the ✦ priority when there is one), so `Build plan` works from the first page. Sessions and length start
 * from Profile when set. Pure.
 */
export function pbDefaultAnswers(input: { sessions?: number | null; minutes?: number | null; supersets?: boolean | null; suggestedPriority?: PlanGroup | null }): PlanBuilderAnswers {
  const sessions = Math.min(7, Math.max(2, Math.round(input.sessions ?? 4)));
  return {
    weeks: 6,
    effort: 'standard',
    focus: 'balanced',
    priorities: input.suggestedPriority == null ? [] : [input.suggestedPriority],
    specific: [],
    sessions,
    split: null,
    schedule: 'any',
    days: [...(PB_PREF_DAYS[sessions] ?? [])],
    minutes: Math.min(180, Math.max(15, Math.round((input.minutes ?? 60) / 5) * 5)),
    supersets: input.supersets ?? false,
    abs: null,
    other: [],
    lifts: {},
    extraLifts: [],
    prefs: {},
    likes: [],
    never: [],
  };
}

/** Sessions a week changed: the usual days for the new count (Set days start from them), the split follows (✦). */
export function pbWithSessions(a: PlanBuilderAnswers, n: number): PlanBuilderAnswers {
  const sessions = Math.min(7, Math.max(2, n));
  return { ...a, sessions, days: [...(PB_PREF_DAYS[sessions] ?? [])] };
}

/** Set days: tap a day on or off; past the session count, the oldest pick drops. */
export function pbToggleDay(a: PlanBuilderAnswers, d: number): PlanBuilderAnswers {
  if (a.days.includes(d)) return { ...a, days: a.days.filter((x) => x !== d) };
  const days = a.days.length < a.sessions ? [...a.days, d] : [...a.days.slice(1), d];
  return { ...a, days };
}

/** Whether Build can go ahead: Set days needs as many days as sessions (Any days always can). */
export function pbDaysReady(a: Pick<PlanBuilderAnswers, 'schedule' | 'days' | 'sessions'>): boolean {
  return a.schedule !== 'set' || a.days.length === a.sessions;
}

/** Other training chips (D7): tap to add, again for ★, again to remove. */
export function pbTapSport(a: PlanBuilderAnswers, sport: string): PlanBuilderAnswers {
  const at = a.other.find((o) => o.sport === sport);
  if (at === undefined) {
    const day = PB_SPORT_DEFAULT_DAY[sport] ?? 3;
    const added: PlanOtherTraining = sport === 'Running' ? { sport, days: [2, 6], star: false, longRunDay: 6 } : { sport, days: [day], star: false };
    return { ...a, other: [...a.other, added] };
  }
  if (!at.star) return { ...a, other: a.other.map((o) => (o.sport === sport ? { ...o, star: true } : o)) };
  return { ...a, other: a.other.filter((o) => o.sport !== sport) };
}

/** A sport's day on or off; Running's long run moves to its last day when its day is taken off. */
export function pbToggleSportDay(a: PlanBuilderAnswers, sport: string, d: number): PlanBuilderAnswers {
  return {
    ...a,
    other: a.other.map((o) => {
      if (o.sport !== sport) return o;
      const days = o.days.includes(d) ? o.days.filter((x) => x !== d) : [...o.days, d].sort((x, y) => x - y);
      if (o.sport !== 'Running') return { ...o, days };
      const longRunDay = o.longRunDay != null && days.includes(o.longRunDay) ? o.longRunDay : (days.at(-1) ?? null);
      return { ...o, days, longRunDay };
    }),
  };
}

/** Priority groups: up to 2; tapping a picked one removes it. Null: refused (already 2). */
export function pbTogglePriority(a: PlanBuilderAnswers, g: PlanGroup): PlanBuilderAnswers | null {
  if (a.priorities.includes(g)) return { ...a, priorities: a.priorities.filter((x) => x !== g) };
  if (a.priorities.length >= 2) return null;
  return { ...a, priorities: [...a.priorities, g] };
}
