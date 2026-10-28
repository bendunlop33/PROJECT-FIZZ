import type { WeightUnit } from '@fizz/schemas';
import type { BenLoad } from './adjust';

/**
 * ADR 0038 (Ben, 28 Oct): the weights Ben named in his own words ("build up to 95 kg on barbell row",
 * "use 30 for curls", "100kg top set", "225 lb"). A coach load equal to one of them is his, kept as
 * typed (no ceiling, no rounding to the rack; a machine's max and pain still apply). Pure.
 *
 * Read from Ben's words only, never the model's. Numbers that are clearly something else are left out:
 * reps and sets ("3 sets", "sets of 8", "x 8", "for 8 reps"), effort ("RPE 8", "2 RIR", "@8"), time
 * ("60 minutes", "90 s"), days, weeks and percentages. A bare number otherwise counts with no unit:
 * matching it to a load in any unit only means that load isn't rounded.
 */

const UNIT_WORD: Record<string, WeightUnit> = { kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb' };

const NUMBER = /(\d+(?:\.\d+)?)/g;
/** After the number: a unit, or something that says it isn't a weight. */
const AFTER_UNIT = /^\s?(kgs?|kilos?|kilograms?|lbs?|pounds?)\b/i;
const AFTER_NOT_WEIGHT = /^\s?(?:reps?|sets?|x(?=\s|\d|$)|×|rounds?|min(?:ute)?s?\b|m\b|secs?\b|seconds?\b|s\b|hours?|hrs?\b|days?|weeks?|wks?\b|%|percent|rir\b|rpe\b|in reserve|times|th\b|st\b|nd\b|rd\b|am\b|pm\b|:\d|-day|-week|-min)/i;
/** Before the number: an effort, a rep count or a set count. */
const BEFORE_NOT_WEIGHT = /(?:\brpe|\brir|@|(?:^|[\d\s])[x×]|\bsets? of|\breps? of|\bfor|\bset|\bday|\bweek)\s*$/i;

export function namedWeights(text: string | null | undefined): BenLoad[] {
  if (text === null || text === undefined || text.trim() === '') return [];
  const out: BenLoad[] = [];
  const seen = new Set<string>();
  const push = (b: BenLoad): void => {
    const key = `${String(b.value)}|${b.unit ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(b);
  };
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[1];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > 2000) continue;
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    // Part of a longer token: a time (6:30), a date (28/10) or a word ("3x8" reads its own parts below).
    if (/[\d:/]$/.test(before)) continue;
    const after = text.slice(m.index + raw.length, m.index + raw.length + 14);
    const unit = AFTER_UNIT.exec(after);
    if (unit?.[1] !== undefined) {
      const u = UNIT_WORD[unit[1].toLowerCase()];
      if (u !== undefined) push({ value, unit: u });
      continue;
    }
    if (/^[:/]\d/.test(after)) continue;
    // "a pair of 30s", "the 30s": dumbbells by the hand (not "90s rest").
    if (/^s\b/i.test(after) && !/^s\s+(?:rest|break|each|per|on|off)\b/i.test(after)) {
      push({ value, unit: null });
      continue;
    }
    if (AFTER_NOT_WEIGHT.test(after)) continue;
    if (BEFORE_NOT_WEIGHT.test(before)) continue;
    push({ value, unit: null });
  }
  return out;
}
