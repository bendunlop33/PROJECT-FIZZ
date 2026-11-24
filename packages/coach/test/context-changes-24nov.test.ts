import { describe, expect, it } from 'vitest';
import { buildCoachContext, contextInputItems } from '../src/context';
import { COACH_INSTRUCTIONS } from '../src/turn';

/** Ben, 24 Nov: the coach said it had made no change right after an Applied card in the same chat. */
describe('changes already made in this chat are in the next turn’s context', () => {
  const base = { turnKind: 'workout' as const, session: null, gymName: null, painFlags: [], checkIn: null, memories: [], thread: [], catalogue: [] };
  const line = 'Applied: Changed set 4 to 30 kg each × 10 and set 5 to 30 kg each × 10 (targets). · 18:41';

  it('lists them in YOUR DATA with their time', () => {
    const ctx = buildCoachContext({ ...base, changesThisChat: [line, 'Undone: Changed set 6 to 30 kg each × 8–10 (targets). · 18:44 · undone 18:45'] });
    expect(ctx.yourData.changesThisChat).toHaveLength(2);
    const sent = contextInputItems(ctx).map((i) => (i.type === 'message' ? i.content : '')).join('\n');
    expect(sent).toContain('Changed set 4 to 30 kg each');
    expect(sent).toContain('Undone:');
  });

  it('absent when there are none, and the instructions name the field and ban rule codes', () => {
    expect(buildCoachContext(base).yourData.changesThisChat).toBeUndefined();
    expect(COACH_INSTRUCTIONS).toMatch(/changesThisChat/);
    expect(COACH_INSTRUCTIONS).toMatch(/never quote rule codes/);
  });
});
