import { afterEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';

import { takeAsk, todayAskParams } from '../../src/coach/sheet-view';
import { CoachSheetScreen } from '../../src/screens/coach/CoachSheetScreen';
import { createDictation, type SpeechInputPort } from '../../src/voice/dictation';
import { createHarness, setUpGym, type Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';
import { MONDAY } from './seed';

/**
 * (Ben, 29 Oct: "The mic [on Today] listens but doesn't do anything") Words from Today's bar open the coach sheet
 * with them sent as his message at once: the turn runs in the sheet (no model call before it opens), the reply lands
 * there, and a failed call shows the sheet's failure line, never silence. Dictation hands over its words when iOS
 * ends recognition with partial results only (no `final`).
 */

const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };

class Scripted implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly events: ModelEvent[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    if (typeof request.toolChoice === 'object' && request.toolChoice.name === 'weekly_review') {
      yield { type: 'error', error: 'unavailable' };
      return;
    }
    this.requests.push(request);
    for (const e of this.events) {
      await Promise.resolve();
      yield e;
    }
  }
}
const reply = (message: string): ModelEvent[] => [{ type: 'tool_call', callId: 'c-reply', name: 'reply', arguments: JSON.stringify({ message, offer: null }) }, { type: 'completed' }];

let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

describe('Today’s bar → the coach sheet, sent at once', () => {
  it('the words are Ben’s message as the sheet opens; the turn runs and the reply shows; a remount never sends twice', async () => {
    const model = new Scripted(reply('Take today off and go easy on the run.'));
    h = createHarness(MONDAY, { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
    const launched = await h.launch();
    await setUpGym(h, launched.services);
    const params = todayAskParams('  make today a rest day  ', true, 'ask-ok');
    expect(params).toMatchObject({ entry: { kind: 'today' }, ask: { text: 'make today a rest day', spoken: true } });
    expect(todayAskParams('   ', true, 'x')).toBeNull();
    const r = await renderScreen(h, launched, CoachSheetScreen, { name: 'Coach', params }, (t) => t.includes('Take today off'));
    expect(r.text()).toContain('make today a rest day');
    expect(model.requests).toHaveLength(1);
    expectHealthy(r);
    await r.unmount();
    // The same ask on a remount (Back, then the sheet again): nothing is sent again.
    const again = await renderScreen(h, launched, CoachSheetScreen, { name: 'Coach', params }, (t) => t.includes('Take today off'));
    expect(model.requests).toHaveLength(1);
    await again.unmount();
  });

  it('a failing model call shows the sheet’s failure line with Try again, never silence', async () => {
    const model = new Scripted([{ type: 'error', error: 'unavailable' }]);
    h = createHarness(MONDAY, { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
    const launched = await h.launch();
    await setUpGym(h, launched.services);
    const params = todayAskParams('how is my week looking?', true, 'ask-fail');
    const r = await renderScreen(h, launched, CoachSheetScreen, { name: 'Coach', params }, (t) => t.includes('Coach unavailable.'));
    expect(r.text()).toContain('how is my week looking?');
    expect(r.text()).toContain('Coach unavailable. Nothing changed.');
    await r.unmount();
  });

  it('with no coach connected: the words stay in the field and the sheet says Not sent.', async () => {
    h = createHarness(MONDAY);
    const launched = await h.launch();
    await setUpGym(h, launched.services);
    const params = todayAskParams('skip legs this week', true, 'ask-offline');
    const r = await renderScreen(h, launched, CoachSheetScreen, { name: 'Coach', params }, (t) => t.includes('Not sent.'));
    const field = r.all((n) => n.props.value === 'skip legs this week');
    expect(field).not.toHaveLength(0);
    await r.unmount();
  });

  it('takeAsk: once per ID', () => {
    const sent = new Set<string>();
    expect(takeAsk(sent, { id: 'a', text: 'hi', spoken: true })).toEqual({ kind: 'words', text: 'hi', spoken: true });
    expect(takeAsk(sent, { id: 'a', text: 'hi', spoken: true })).toBeNull();
    expect(takeAsk(sent, undefined)).toBeNull();
  });
});

describe('dictation hands over its words however iOS ends recognition', () => {
  const portWith = (script: (h: { partial: (t: string) => void; final: (t: string) => void; error: (c: string) => void; end: () => void }) => void): SpeechInputPort => ({
    onDeviceAvailable: () => Promise.resolve(true),
    permission: () => Promise.resolve('granted'),
    start: (handlers) => {
      queueMicrotask(() => {
        script(handlers);
      });
      return { stop: () => undefined };
    },
  });
  const run = async (script: Parameters<typeof portWith>[0]): Promise<string[]> => {
    const done: string[] = [];
    const d = createDictation(portWith(script), { state: () => undefined, partial: () => undefined, done: (t) => done.push(t) });
    await d.tap();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    return done;
  };

  it('(iOS 26) partial results, then `end` with no `final`: the last partial is sent once', async () => {
    expect(
      await run((x) => {
        x.partial('make today');
        x.partial('make today a rest day');
        x.end();
      }),
    ).toEqual(['make today a rest day']);
  });
  it('partial results, then an error (no speech after them): sent once', async () => {
    expect(
      await run((x) => {
        x.partial('skip legs');
        x.error('no-speech');
        x.end();
      }),
    ).toEqual(['skip legs']);
  });
  it('a `final` then `end`: sent once; nothing heard: nothing sent', async () => {
    expect(
      await run((x) => {
        x.partial('pull');
        x.final('pull 50 minutes');
        x.end();
      }),
    ).toEqual(['pull 50 minutes']);
    expect(
      await run((x) => {
        x.end();
      }),
    ).toEqual([]);
  });
});
