import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';

import { SummaryScreen } from '../../src/screens/workout/SummaryScreen';
import { createHarness, logWorkout, setUpGym, type Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';

/**
 * (Ben, 30 Oct; redesign-27oct §E2) The Summary, rendered: what he just did (Exercises · done) before Next time; each
 * Next time change on one line (`Bench press · 60 → 57.5 kg · Why? · Undo`), the reason only behind Why?, Undo
 * per row and VoiceOver reading `Bench press, 60 to 57.5 kilograms`.
 */

class StepModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: ((req: ModelRequest) => ModelEvent[])[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1];
    const events = step === undefined ? [{ type: 'error' as const, error: 'unavailable' as const }] : step(request);
    for (const e of events) {
      await Promise.resolve();
      yield e;
    }
  }
}

function workoutOf(req: ModelRequest): { sessionId: string; version: number; exercises: { exerciseId: string; name: string }[] } {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { workout: ReturnType<typeof workoutOf> }).workout;
}

const call = (name: string, args: unknown): ModelEvent[] => [{ type: 'tool_call', callId: `c-${name}`, name, arguments: JSON.stringify(args) }, { type: 'completed' }];
const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-19T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

describe('Summary: one line per Next time change (Ben, 30 Oct; v2 22 Nov)', () => {
  it('order, one-line rows, Why? behind a tap on the row, Undo per row', async () => {
    const launched = await h.launch();
    const s = launched.services;
    const gymId = await setUpGym(h, s);
    const sessionId = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 7, rpe: 10 }, { load: 60, reps: 6, rpe: 10 }] },
      { exercise: 'Lat pulldown', sets: [{ load: 59, reps: 10, rpe: 8 }, { load: 59, reps: 10, rpe: 8 }] },
    ]);
    // The coach's one review after Finish saves a small bench change (as on the phone, run in the service).
    model = new StepModel([
      (req) => {
        const w = workoutOf(req);
        const bench = w.exercises.find((e) => e.name === 'Bench press');
        return call('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: bench?.exerciseId, target: { load: { value: 57.5, unit: 'kg', convention: 'total' }, reps: null }, sets: null, reason: 'Every set was RPE 10.' }] });
      },
      () => call('reply', { message: 'All three sets were RPE 10.', offer: null }),
    ]);
    expect((await s.coach.runSummaryTurn(sessionId))?.status).toBe('completed');

    const r = await renderScreen(h, launched, SummaryScreen, { name: 'Summary', params: { sessionId } }, (t) => t.includes('Next time') && t.includes('Bench press'));
    expectHealthy(r);
    const text = r.text();

    // 1. (Ben, 22 Nov; Summary v2) Order: the title, the three numbers, Next time, Ask about this workout.
    const at = (needle: string) => text.indexOf(needle);
    expect(at(' done|')).toBeGreaterThanOrEqual(0);
    expect(at('sets')).toBeLessThan(at('Next time'));
    expect(at('Next time')).toBeLessThan(at('Ask about this workout'));

    // 3. Exercises done sit behind a tap on the title: one line each, the sets said once.
    expect(text).not.toContain('Exercises · done');
    const title = r.all((n) => n.props.testID === 'summary-title' && typeof n.props.onPress === 'function')[0];
    await act(async () => {
      (title?.props.onPress as () => void)();
      await Promise.resolve();
    });
    expect(r.text()).toContain('Bench press|8, 7, 6 @ 60 kg');
    expect(r.text()).toContain('Lat pulldown|2×10 @ 59 kg');

    // 2. One line per change: name, from → the new value (bold), Undo; no tag, reason or Why? button on the line.
    const next = text.slice(at('Next time'));
    expect(next).toContain('Bench press|60 → |57.5 kg|Undo');
    expect(next).not.toContain('Every set was RPE 10');
    expect(next).not.toContain('Why?');
    expect(next).not.toContain('Coach|');
    expect(next).not.toContain('Target ');
    // VoiceOver: the name and the change (the row; a tap shows why), then each button.
    const line = r.all((n) => n.props.accessibilityLabel === 'Bench press, 60 to 57.5 kilograms' && typeof n.props.onPress === 'function');
    expect(line).toHaveLength(1);

    // A tap on the row shows the source, % and reason as one info line; tapped again it hides.
    const benchWhy = async () => {
      const press = r.all((n) => n.props.accessibilityLabel === 'Bench press, 60 to 57.5 kilograms' && typeof n.props.onPress === 'function')[0]?.props.onPress as (() => void) | undefined;
      if (press === undefined) throw new Error('no bench row');
      await act(async () => {
        press();
        await Promise.resolve();
      });
    };
    await benchWhy();
    expect(r.text()).toMatch(/Bench press\|60 → \|57\.5 kg\|Undo\|Coach · −4\.2% · “Every set was RPE 10\.”/);
    await benchWhy();
    expect(r.text()).not.toContain('Every set was RPE 10.”');

    const tapLabel = async (label: string) => {
      const press = r.all((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0]?.props.onPress as (() => void) | undefined;
      if (press === undefined) throw new Error(`nothing labelled ${label}`);
      await act(async () => {
        press();
        await Promise.resolve();
      });
    };

    // Undo on the coach's row: the rule's line comes back, with Redo.
    await tapLabel('Undo');
    await r.waitFor((t) => t.includes('Redo'), 'the undone row');
    expect(r.text()).not.toContain('60 → |57.5 kg');
    const rows = await s.coach.nextTargets(sessionId);
    expect(rows[0]?.status).toBe('undone');

    // (Ben, 22 Nov) The built-in rule's change has its own Undo too: next time keeps today's 59 kg, with Redo.
    expect(r.text()).toContain('Lat pulldown|59 → |60 kg|Undo');
    await tapLabel('Undo: keep Lat pulldown as it was');
    await r.waitFor((t) => t.includes('Lat pulldown|Same · 2×10 @ 59 kg') || /Lat pulldown\|Same · [^|]*59/.test(t), 'the held row');
    const holds = await s.coach.ruleHolds(sessionId);
    expect(holds).toHaveLength(1);
    expect(holds[0]?.status).toBe('applied');
    expect(holds[0]?.target.load?.value).toBe(59);
    expect(holds[0]?.builtIn?.load?.value).toBe(60);
    // The coach's own rows never include it.
    expect((await s.coach.nextTargets(sessionId)).some((x) => x.origin === 'hold')).toBe(false);
    // Redo puts the rule's change back.
    await tapLabel(r.all((n) => typeof n.props.accessibilityLabel === 'string' && (n.props.accessibilityLabel).startsWith('Redo: Lat pulldown'))[0]?.props.accessibilityLabel as string);
    await r.waitFor((t) => t.includes('Lat pulldown|59 → |60 kg|Undo'), 'the rule row again');
    expect((await s.coach.ruleHolds(sessionId))[0]?.status).toBe('proposed');
    expect(r.errors).toEqual([]);
    await r.unmount();
  });
});
