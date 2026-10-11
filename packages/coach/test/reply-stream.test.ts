import { describe, expect, it } from 'vitest';
import { partialReplyMessage, ReplyMessageStream } from '../src/reply-stream';

describe('partialReplyMessage (C6: a structured reply streams sentence by sentence)', () => {
  it('reads the message prefix at every cut, with escapes and either key order', () => {
    const message = 'Set 2 was "RPE 10".\nGo 95 × 8 — easy\\hard? ✓';
    for (const raw of [JSON.stringify({ message, offer: null }), JSON.stringify({ offer: 'adjust_today', message }), JSON.stringify({ offer: { nested: ['"x"', 1] }, message })]) {
      let last = '';
      for (let cut = 0; cut <= raw.length; cut += 1) {
        const m = partialReplyMessage(raw.slice(0, cut));
        const text = m?.text ?? '';
        // Never goes backwards and is always a prefix of the real message.
        expect(message.startsWith(text)).toBe(true);
        expect(text.length).toBeGreaterThanOrEqual(last.length);
        last = text;
      }
      expect(partialReplyMessage(raw)).toEqual({ text: message, complete: true });
    }
  });

  it('holds back an unfinished \\u escape and returns null before the message starts', () => {
    expect(partialReplyMessage('{"message":"a\\u00')).toEqual({ text: 'a', complete: false });
    expect(partialReplyMessage('{"offer":nu')).toBeNull();
    expect(partialReplyMessage('not json')).toBeNull();
  });

  it('ReplyMessageStream hands out only new text, once', () => {
    const s = new ReplyMessageStream();
    const raw = JSON.stringify({ message: 'Rest 3 min. Then go again.', offer: null });
    let out = '';
    for (let i = 0; i < raw.length; i += 4) out += s.push(raw.slice(i, i + 4));
    expect(out).toBe('Rest 3 min. Then go again.');
    expect(s.streamed).toBe(out);
  });
});
