import { describe, expect, it } from 'vitest';

import { buildCoachingKnowledge } from '@fizz/coach';
import type { PlaybookCandidate } from '@fizz/schemas';

import { playbookRuleList } from '../src/coach/playbook-view';

/** Review coach-tools S2: the Playbook screen and the coach context number chat rules the same way. */
const rule = (n: number, status: PlaybookCandidate['status'], text: string): PlaybookCandidate => ({
  id: `00000000-0000-4000-8000-${String(700 + n).padStart(12, '0')}`,
  version: 2,
  createdAtUtc: `2026-10-0${String(n)}T07:00:00.000Z`,
  updatedAtUtc: `2026-10-0${String(n)}T08:00:00.000Z`,
  text,
  contentKey: `playbook_candidate:${String(n)}`,
  statedBy: 'ben',
  status,
  createdByActionId: `00000000-0000-4000-8000-${String(800 + n).padStart(12, '0')}`,
  ...(status === 'approved' ? { decidedAtUtc: `2026-10-0${String(n)}T08:00:00.000Z` } : {}),
});

describe('chat rule numbers', () => {
  it('a withdrawn rule ahead of an approved one: the screen and the coach both say Chat rule 1', () => {
    const candidates = [rule(1, 'withdrawn', 'Gone'), rule(2, 'approved', 'Never superset heavy compounds'), rule(3, 'to_review', 'Deload every 5th week')];
    const screen = playbookRuleList(candidates);
    expect(screen.approved.map((r) => r.label)).toEqual(['Chat rule 1']);
    expect(screen.toReview.map((r) => r.label)).toEqual(['Chat rule 2']);
    expect(buildCoachingKnowledge([], candidates).approvedChatRules?.map((r) => r.id)).toEqual(['Chat rule 1']);
  });
});
