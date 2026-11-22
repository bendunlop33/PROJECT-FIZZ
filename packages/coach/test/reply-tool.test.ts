import { describe, expect, it } from 'vitest';
import { COACH_REPLY_TOOL_NAME } from '@fizz/schemas';
import { assertRegistrySafe, COACH_TOOLS, UnsafeRegistryError } from '../src/registry';
import { parseReply, replyToolDefinition } from '../src/reply-tool';

describe('the structured reply function (PM decision 10 Oct)', () => {
  it('is a strict function whose schema has exactly message and offer, both required, closed', () => {
    const def = replyToolDefinition();
    expect(def).toMatchObject({ type: 'function', name: 'reply', strict: true });
    expect(def.parameters).toMatchObject({ type: 'object', additionalProperties: false, required: ['message', 'offer'] });
    expect(JSON.stringify(def.parameters)).not.toMatch(/maxLength|minLength|oneOf|\$schema/);
  });

  it('parses a reply; an offer survives only in a workout turn', () => {
    expect(parseReply('{"message":"Set 2 was RPE 10. Want me to adjust?","offer":"adjust_today"}', 'workout')).toEqual({
      ok: true,
      reply: { message: 'Set 2 was RPE 10. Want me to adjust?', offer: 'adjust_today' },
      dropped: [],
    });
    expect(parseReply('{"message":"Hi","offer":"adjust_today"}', 'general')).toEqual({ ok: true, reply: { message: 'Hi', offer: null }, dropped: ['offer'] });
  });

  it('refuses anything that is not exactly the reply shape', () => {
    expect(parseReply('not json', 'general')).toMatchObject({ ok: false });
    expect(parseReply('{"message":"Done","offer":null,"changes":[{"set":3}]}', 'workout')).toMatchObject({ ok: false });
    expect(parseReply('{"message":"Done"}', 'workout')).toMatchObject({ ok: false });
    expect(parseReply('{"message":"x","offer":"apply_now"}', 'workout')).toMatchObject({ ok: false });
  });

  it('no registry tool can take the reply function’s name', () => {
    expect(COACH_TOOLS.some((t) => (t.name as string) === COACH_REPLY_TOOL_NAME)).toBe(false);
    const fake = { ...COACH_TOOLS[0], name: COACH_REPLY_TOOL_NAME } as unknown as (typeof COACH_TOOLS)[number];
    expect(() => { assertRegistrySafe([fake]); }).toThrow(UnsafeRegistryError);
  });
});
