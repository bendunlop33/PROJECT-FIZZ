import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';

import { CoachSheetScreen } from '../../src/screens/coach/CoachSheetScreen';
import { createHarness, setUpGym, type Harness } from '../harness';
import { ScriptedCoachModel } from '../../../../packages/coach/test/fake-model';
import { expectHealthy, renderScreen } from './render-screen';
import { MONDAY } from './seed';

/**
 * (Ben, 28 Oct: "it stops 'running' if I move away from the chat screen") The coach sheet opened on a thread whose
 * turn is still running (sent, then the sheet closed): it shows the turn in progress (Ben's message, what streamed
 * so far, Stop in place of Send) and the reply when the turn ends, with no reload by hand.
 */

const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };
const REPLY = 'Rest two minutes. Then go again.';
const ARGS = JSON.stringify({ message: REPLY, offer: null });

/** The scripted model: the first sentence streams, then the stream waits for `open()`. */
class HeldModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  private release: () => void = () => undefined;
  private readonly held = new Promise<void>((r) => {
    this.release = r;
  });
  private readonly inner = new ScriptedCoachModel([[{ type: 'tool_call', callId: 'c-reply', name: 'reply', arguments: ARGS }, { type: 'completed' }]]);
  open(): void {
    this.release();
  }
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    if (typeof request.toolChoice === 'object' && request.toolChoice.name === 'weekly_review') {
      yield { type: 'error', error: 'unavailable' };
      return;
    }
    this.requests.push(request);
    yield { type: 'tool_call_delta', name: 'reply', delta: ARGS.slice(0, ARGS.indexOf('Then')) };
    await this.held;
    yield* this.inner.stream(request);
  }
}

let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

describe('Coach sheet', () => {
  it('reopened on a running turn: in progress (Stop, the streamed sentence), then the reply when it ends', async () => {
    const model = new HeldModel();
    h = createHarness(MONDAY, { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
    const launched = await h.launch();
    const s = launched.services;
    await setUpGym(h, s);
    const turnId = h.ids();
    const sent = s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'How long should I rest?', spoken: false }, turnId });
    for (let i = 0; i < 300 && !(s.coach.running.get(turnId)?.progress.some((p) => p.kind === 'item') ?? false); i += 1) await new Promise((r) => setTimeout(r, 10));

    const r = await renderScreen(h, launched, CoachSheetScreen, { name: 'Coach', params: { entry: { kind: 'today' } } }, (t) => t.includes('Rest two minutes.'));
    expect(r.text()).toContain('How long should I rest?');
    expect(r.text()).not.toContain('Then go again.');
    // The thread's title, then Ben's message once (the live turn, not also a stored row).
    expect(r.text().split('|').filter((x) => x === 'How long should I rest?')).toHaveLength(2);
    expect(r.all((n) => n.props.accessibilityLabel === 'Stop the coach')).not.toHaveLength(0);
    expect(r.all((n) => n.props.accessibilityLabel === 'Send message')).toHaveLength(0);

    // The turn ends with the sheet open (the service's event, as on the phone).
    await act(async () => {
      model.open();
      await sent;
    });
    await r.waitFor((t) => t.includes('Then go again.'), 'the reply after the turn ended');
    expect(r.text().split('|').filter((x) => x === 'How long should I rest?')).toHaveLength(2);
    expect(r.all((n) => n.props.accessibilityLabel === 'Send message')).not.toHaveLength(0);
    expect(r.all((n) => n.props.accessibilityLabel === 'Stop the coach')).toHaveLength(0);
    expectHealthy(r);
    await r.unmount();
  });
});
