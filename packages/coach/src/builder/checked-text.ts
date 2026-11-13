import { collectFacts, numericClaims, verifySentence, type FactText, type NumberFacts } from '../numbers';
import { splitSentences } from '../sentences';

/**
 * The builder coach's words, checked (workout-builder-v3 §2.9 "a coach
 * sentence with a wrong number hidden", rule 6). Stricter than chat
 * replies: EVERY number in a sentence must be one code gave it (a count,
 * a load, minutes, a date), because the review's facts are exact counts.
 * Advice counts get no pass here, and kg ↔ lb only matches loads. A
 * sentence that fails is hidden whole (never rewritten) and kept for
 * `Why?` → `Not shown`.
 */

const LB_PER_KG = 2.20462;

function valueIn(n: number, facts: NumberFacts, load: boolean): boolean {
  for (const f of facts.values) {
    if (Math.abs(f - n) < 0.011) return true;
    if (load && f > 0 && (Math.abs(f * LB_PER_KG - n) <= f * LB_PER_KG * 0.01 || Math.abs(f / LB_PER_KG - n) <= (f / LB_PER_KG) * 0.01)) return true;
  }
  return false;
}

/** Whether every number in one sentence is in the facts (and an est. max is called an estimate). */
export function strictSentenceOk(sentence: string, facts: NumberFacts): boolean {
  const claims = numericClaims(sentence);
  if (claims.length === 0) return true;
  // Rule 6's estimate wording (and a set stated as done must be a logged set) still apply.
  if (!verifySentence(sentence, facts).ok) return false;
  return claims.every((c) => (c.kind === 'date' ? c.date !== undefined && facts.dates.has(c.date) : valueIn(c.value, facts, c.kind === 'load')));
}

export interface CheckedText {
  /** The sentences that passed, joined; null when none did (or there was nothing). */
  shown: string | null;
  /** Sentences hidden for a number not in the facts. */
  hidden: string[];
}

/** Check each sentence of the coach's text against the facts. */
export function checkCoachText(text: string | null | undefined, facts: NumberFacts): CheckedText {
  const t = (text ?? '').trim();
  if (t === '') return { shown: null, hidden: [] };
  const kept: string[] = [];
  const hidden: string[] = [];
  for (const s of splitSentences(t)) {
    const x = s.trim();
    if (x === '') continue;
    (strictSentenceOk(x, facts) ? kept : hidden).push(x);
  }
  return { shown: kept.length === 0 ? null : kept.join(' '), hidden };
}

/** Facts from code's texts (the context sent, code's lines) and Ben's words. Never the model's own words. */
export function builderFacts(texts: readonly FactText[]): NumberFacts {
  return collectFacts(texts);
}
