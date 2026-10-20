/**
 * The Playbook screen's chat rules (coaching-playbook §2.1, §3.1, §4.1;
 * backlog §4.3). Pure. Coaching knowledge: general rules, never about Ben
 * (CM9, rule 10). Only approved rules are sent to the coach; rules to review
 * and rejected ones never are. Minimal copy: the rule's words, who said it
 * and its review state.
 */

import { chatRuleNumbers } from '@fizz/coach';
import type { PlaybookCandidate } from '@fizz/schemas';

export interface PlaybookRuleRow {
  id: string;
  version: number;
  /** `Chat rule 3`. */
  label: string;
  text: string;
  /** `From you · not graded`, `From the coach · not graded`. */
  line: string;
}

export interface PlaybookRuleList {
  toReview: PlaybookRuleRow[];
  approved: PlaybookRuleRow[];
  rejected: PlaybookRuleRow[];
}

export function playbookRuleList(candidates: readonly PlaybookCandidate[]): PlaybookRuleList {
  const live = candidates.filter((c) => c.status !== 'withdrawn');
  // The same numbers the coach is sent (`buildCoachingKnowledge`): withdrawn rules are never numbered.
  const numbers = chatRuleNumbers(candidates);
  const row = (c: PlaybookCandidate): PlaybookRuleRow => ({
    id: c.id,
    version: c.version,
    label: `Chat rule ${String(numbers.get(c.id) ?? 0)}`,
    text: c.text,
    line: `${c.statedBy === 'ben' ? 'From you' : 'From the coach'} · not graded`,
  });
  const byNumber = (a: PlaybookCandidate, b: PlaybookCandidate) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0);
  const of = (status: PlaybookCandidate['status']) => live.filter((c) => c.status === status).sort(byNumber).map(row);
  return { toReview: of('to_review'), approved: of('approved'), rejected: of('rejected') };
}

/** (Design pass 6.11) App status's Playbook line, matching the Playbook screen: `Playbook rules: 3 approved`, or `none yet`; null when it can't be read. */
export function playbookStatusLine(list: PlaybookRuleList | null): string | null {
  if (list === null) return null;
  const n = list.approved.length;
  return n === 0 ? 'Playbook rules: none yet' : `Playbook rules: ${String(n)} approved`;
}
