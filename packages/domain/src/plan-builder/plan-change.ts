import { PlanWeeksSchema, type PlanBuilderAnswers } from '@fizz/schemas';
import { pbWithSessions } from './answers';
import { pbWeekdayName } from './edit';
import { pbDeloadWeeks, pbIsDeload } from './weeks';
import { PB_PREF_DAYS } from './tables';

/**
 * (Ben, 2 Nov) The coach's plan-level changes to the plan in use (`propose_plan_change`), as new plan-builder answers.
 * Pure. The app rebuilds and applies them through the plan's own `Apply changes` (the plan builder's engine, the same
 * block: its start, lead-in, week numbers and this week's done days stay; done weeks never change), always as a
 * proposal Ben applies (rule 3).
 *
 * - `lighter_week`: this or next block week drafts as a deload week (the approved shape, training-blocks Q3: −10 %
 *   load, one set fewer, RPE ≤ 7), on top of the effort's own deload weeks. Not in the lead-in (it isn't a block week),
 *   not past the plan's end, not a week that is a deload already.
 * - `days_per_week`: the Week page's `Sessions a week` (`pbWithSessions`: the usual days for the count, the split
 *   follows unless Ben chose one); named weekdays make it Set days on them.
 * - `length`: Gym goals' plan length (4, 6, 8 or 12 weeks), never shorter than the week the plan is in; lighter weeks
 *   past the new end go.
 * - `schedule`: Any days, or Set days on the named weekdays (their count is the sessions a week).
 */

export type PbPlanChangeRequest =
  | { kind: 'lighter_week'; week: 'this' | 'next' }
  | { kind: 'days_per_week'; days: number; weekdays: readonly number[] | null }
  | { kind: 'length'; weeks: number }
  | { kind: 'schedule'; schedule: 'any' | 'set'; weekdays: readonly number[] | null };

/** Where the block is now: its week (1-based; 1 in the lead-in) and whether this is the lead-in week. */
export interface PbPlanChangeBlock {
  week: number;
  leadIn: boolean;
}

export type PbPlanChangeResult =
  | {
      kind: 'ok';
      answers: PlanBuilderAnswers;
      /** The card's before → after lines (app text). */
      lines: string[];
      /** The first block week the change reaches (`Apply changes`' scope: from this week). */
      fromWeek: number;
    }
  | { kind: 'refused'; line: string };

const days = (ds: readonly number[]): string => [...ds].sort((a, b) => a - b).map(pbWeekdayName).join(', ');
const unique = (ds: readonly number[]): number[] => [...new Set(ds)].sort((a, b) => a - b);
const scheduleLine = (a: Pick<PlanBuilderAnswers, 'schedule' | 'days'>): string => (a.schedule === 'any' ? 'Any days' : `Set days: ${days(a.days)}`);

export function pbPlanChange(a: PlanBuilderAnswers, req: PbPlanChangeRequest, block: PbPlanChangeBlock): PbPlanChangeResult {
  const fromWeek = block.week;
  switch (req.kind) {
    case 'lighter_week': {
      if (req.week === 'this' && block.leadIn) return { kind: 'refused', line: 'This week is the plan’s lead-in; next week (week 1) can be lighter' };
      const w = req.week === 'this' ? block.week : block.leadIn ? 1 : block.week + 1;
      if (w > a.weeks) return { kind: 'refused', line: `The plan ends after week ${String(a.weeks)}` };
      if (pbIsDeload(a, w)) return { kind: 'refused', line: `Week ${String(w)} is already a deload week` };
      const answers: PlanBuilderAnswers = { ...a, lighterWeeks: unique([...(a.lighterWeeks ?? []), w]) };
      return { kind: 'ok', answers, lines: [`Week ${String(w)} of ${String(a.weeks)} → Deload`, '−10 % load, 1 set fewer'], fromWeek: w };
    }
    case 'days_per_week': {
      if (!Number.isInteger(req.days) || req.days < 2 || req.days > 7) return { kind: 'refused', line: 'Plans have 2 to 7 days a week' };
      const named = req.weekdays === null ? null : unique(req.weekdays);
      if (named !== null && named.length !== req.days) return { kind: 'refused', line: `Name ${String(req.days)} weekdays, or none for Any days` };
      let answers = pbWithSessions(a, req.days);
      if (named !== null) answers = { ...answers, schedule: 'set', days: named };
      if (answers.sessions === a.sessions && answers.schedule === a.schedule && (answers.schedule === 'any' || unique(answers.days).join() === unique(a.days).join())) {
        return { kind: 'refused', line: `Already ${String(a.sessions)} days a week` };
      }
      const lines = [`${String(a.sessions)} → ${String(answers.sessions)} days a week`];
      if (answers.schedule === 'set' || a.schedule === 'set') lines.push(scheduleLine(answers));
      return { kind: 'ok', answers, lines, fromWeek };
    }
    case 'length': {
      const ok = PlanWeeksSchema.safeParse(req.weeks);
      if (!ok.success) return { kind: 'refused', line: 'Plan lengths are 4, 6, 8 or 12 weeks' };
      if (req.weeks === a.weeks) return { kind: 'refused', line: `Already ${String(a.weeks)} weeks` };
      if (req.weeks < block.week) return { kind: 'refused', line: `Already in week ${String(block.week)}` };
      const lighter = (a.lighterWeeks ?? []).filter((w) => w <= ok.data);
      const answers: PlanBuilderAnswers = { ...a, weeks: ok.data };
      if (lighter.length > 0) answers.lighterWeeks = lighter;
      else delete answers.lighterWeeks;
      const lines = [`${String(a.weeks)} → ${String(ok.data)} weeks`];
      const was = pbDeloadWeeks(a);
      const now = pbDeloadWeeks(answers);
      if (was.join() !== now.join()) lines.push(`Deload: ${was.length === 0 ? 'none' : `week ${was.join(', ')}`} → ${now.length === 0 ? 'none' : `week ${now.join(', ')}`}`);
      return { kind: 'ok', answers, lines, fromWeek };
    }
    case 'schedule': {
      if (req.schedule === 'any') {
        if (a.schedule === 'any') return { kind: 'refused', line: 'Already Any days' };
        const answers: PlanBuilderAnswers = { ...a, schedule: 'any', days: [...(PB_PREF_DAYS[a.sessions] ?? a.days)] };
        return { kind: 'ok', answers, lines: [`${scheduleLine(a)} → Any days`], fromWeek };
      }
      const named = req.weekdays === null ? [] : unique(req.weekdays);
      if (named.length === 0) return { kind: 'refused', line: 'Which weekdays? Name them for Set days' };
      if (named.length < 2) return { kind: 'refused', line: 'Plans have 2 to 7 days a week' };
      if (a.schedule === 'set' && named.join() === unique(a.days).join()) return { kind: 'refused', line: `Already ${scheduleLine(a)}` };
      const answers: PlanBuilderAnswers = { ...pbWithSessions(a, named.length), schedule: 'set', days: named };
      const lines = [`${scheduleLine(a)} → ${scheduleLine(answers)}`];
      if (answers.sessions !== a.sessions) lines.push(`${String(a.sessions)} → ${String(answers.sessions)} days a week`);
      return { kind: 'ok', answers, lines, fromWeek };
    }
  }
}

/** `mon` … `sun` as the builder's weekdays (Monday = 0). */
export const PB_WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export function pbWeekdayOf(key: (typeof PB_WEEKDAY_KEYS)[number]): number {
  return PB_WEEKDAY_KEYS.indexOf(key);
}

/** A new block (`Start next block`, Set up a plan with none in use): Ben's lighter weeks were for the block that ended. */
export function pbWithoutLighterWeeks(a: PlanBuilderAnswers): PlanBuilderAnswers {
  if (a.lighterWeeks === undefined) return a;
  const out = { ...a };
  delete out.lighterWeeks;
  return out;
}
