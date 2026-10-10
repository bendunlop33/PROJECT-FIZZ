import { describe, expect, it } from 'vitest';
import type { ActionRecord } from '@fizz/schemas';
import type { TurnLedger } from '../src/claims';
import { createReplyFilter, toHiddenLines, type ReplyItem } from '../src/reply';
import { splitSentences } from '../src/sentences';
import { resolveActionTokens } from '../src/tokens';
import { chunked, ScriptedCoachModel } from './fake-model';
import { benchAdjust, id, kg, ledger, record, tgt } from './records';

const nb = (s: string): string => s.replace(/\u00a0/g, ' ');

function texts(items: readonly ReplyItem[]): string[] {
  return items.map((i) => (i.kind === 'sentence' ? i.text : `[app] ${nb(i.rendered.text)}`));
}

/** Play a scripted model's text through the reply filter, committing `records` when the model calls a tool. */
async function play(model: ScriptedCoachModel, records: Record<string, ActionRecord>, surface: 'sheet' | 'slot' | 'summary' = 'sheet') {
  const entries: { ref: string; record: ActionRecord; origin: 'this_turn' }[] = [];
  const current = (): TurnLedger => ({ turnId: 'turn-1', entries, knownExerciseNames: ['Bench press', 'Overhead press', 'Cable fly', 'Pec deck'] });
  const filter = createReplyFilter({ ledger: current, surface });
  const shown: ReplyItem[] = [];
  let completed = false;
  for await (const e of model.stream({ model: 'gpt-6.1-sol', instructions: '', input: [], tools: [], parallelToolCalls: false })) {
    if (e.type === 'tool_call') {
      const r = records[e.callId];
      if (r) entries.push({ ref: e.callId, record: r, origin: 'this_turn' });
    } else if (e.type === 'text_delta') {
      shown.push(...filter.push(e.delta));
    } else if (e.type === 'completed') {
      completed = true;
    } else {
      break;
    }
  }
  shown.push(...filter.end(completed));
  return { shown, hidden: filter.hiddenLines, note: filter.note() };
}

describe('sentence splitting (CC8)', () => {
  it('splits on sentence ends, never inside decimals, abbreviations or tokens', () => {
    expect(splitSentences('Set 2 was RPE 10. I’d go 97.5 kg, e.g. for 8. [[a1]] Then rest.')).toEqual(['Set 2 was RPE 10.', 'I’d go 97.5 kg, e.g. for 8.', '[[a1]] Then rest.']);
    expect(splitSentences('Line one\nLine two')).toEqual(['Line one', 'Line two']);
  });

  it('holds back a sentence until it ends, even when the stream breaks mid-number', async () => {
    const model = new ScriptedCoachModel([[...chunked('Try 97.5 kg next time. Want me to', 3), { type: 'completed' }]]);
    const { shown } = await play(model, {});
    expect(texts(shown)).toEqual(['Try 97.5 kg next time.', 'Want me to']);
  });

  it('drops an unfinished sentence when the reply is cut off (check 8)', async () => {
    const model = new ScriptedCoachModel([[...chunked('Set 2 was RPE 10. I’ve lowered sets 3–4 to'), { type: 'error', error: 'network' }]]);
    const { shown, hidden } = await play(model, {});
    expect(texts(shown)).toEqual(['Set 2 was RPE 10.']);
    expect(hidden).toEqual([]);
  });
});

describe('tokens (CC2)', () => {
  it('renders known refs from the record and hides unknown ones', () => {
    const r = resolveActionTokens('Done: [[a1]] and [[zz]] [[broken', ledger([benchAdjust()]), 'sheet');
    expect(r.segments.map((s) => (s.kind === 'text' ? s.text.trim() : nb(s.rendered.text)))).toEqual(['Done:', 'Changed sets 3–4 to 95 kg × 8 (targets).', 'and']);
    expect(r.unknownRefs).toEqual(['zz']);
    expect(r.plainText).toBe('Done: and');
  });
});

describe('reply pipeline with a fake model (coach-contract checks 2–5)', () => {
  it('check 2: a phantom change is never shown; the note says nothing changed', async () => {
    const model = new ScriptedCoachModel([[...chunked('Done, I’ve lowered sets 3–4 to 95 kg. That should keep you at 8.'), { type: 'completed' }]]);
    const { shown, hidden, note } = await play(model, {});
    expect(texts(shown)).toEqual(['That should keep you at 8.']);
    expect(hidden).toEqual([{ sentence: 'Done, I’ve lowered sets 3–4 to 95 kg.', reason: 'no_action', detail: 'No change was saved in this reply.' }]);
    expect(note).toEqual({ text: 'Nothing was changed. One line said otherwise and is hidden.', spoken: 'Nothing was changed.' });
    const stored = toHiddenLines('turn-1', hidden, '2026-10-10T17:21:00.000Z');
    expect(stored[0]).toMatchObject({ turnId: 'turn-1', reason: 'no_action' });
  });

  it('check 3: the saved 97.5 kg replaces the model’s 98 kg; 98 appears only in Why?', async () => {
    const saved = benchAdjust({}, tgt(kg(97.5), 8));
    const model = new ScriptedCoachModel([
      [{ type: 'tool_call', callId: 'a1', name: 'adjust_pending_sets', arguments: '{}' }, ...chunked('Set 2 was RPE 10. I’ve lowered sets 3–4 to 98 kg.'), { type: 'completed' }],
    ]);
    const { shown, hidden, note } = await play(model, { a1: saved });
    expect(texts(shown)).toEqual(['Set 2 was RPE 10.', '[app] Changed sets 3–4 to 97.5 kg × 8 (targets).']);
    expect(texts(shown).join(' ')).not.toContain('98');
    expect(hidden[0]).toMatchObject({ reason: 'numbers_differ', detail: 'The saved load is 97.5 kg; the reply said 98 kg.' });
    expect(note).toBeNull();
  });

  it('check 4: a stale result with "Changed" shows only the outcome line', async () => {
    const stale = benchAdjust({ status: 'stale' });
    const model = new ScriptedCoachModel([[{ type: 'tool_call', callId: 'a1', name: 'adjust_pending_sets', arguments: '{}' }, ...chunked('Changed sets 3–4. [[a1]]'), { type: 'completed' }]]);
    const { shown, note } = await play(model, { a1: stale });
    expect(texts(shown)).toEqual(["[app] Couldn't change sets 3–4: your workout moved on. Nothing changed."]);
    expect(note?.text).toBe('Nothing was changed. One line said otherwise and is hidden.');
  });

  it('check 5: a proposal claimed as applied is hidden; the card says Not applied', async () => {
    const proposal = record(
      { kind: 'propose_next_workout_change', sourceSessionId: id(1), workoutLabel: 'Push A', changes: [{ change: 'swap', text: 'Cable fly → Pec deck' }], because: 'you asked for some variety.' },
      { status: 'proposed' },
    );
    const model = new ScriptedCoachModel([[{ type: 'tool_call', callId: 'p1', name: 'propose_next_workout_change', arguments: '{}' }, ...chunked('I’ve swapped cable fly for pec deck. [[p1]]'), { type: 'completed' }]]);
    const { shown, hidden } = await play(model, { p1: proposal });
    expect(texts(shown)).toEqual(['[app] Suggested for your next Push A: Cable fly → Pec deck. Not applied.']);
    expect(hidden[0]?.reason).toBe('not_committed');
  });

  it('a kept claim with a token shows the coach sentence and the app line', async () => {
    const saved = benchAdjust();
    const model = new ScriptedCoachModel([[{ type: 'tool_call', callId: 'a1', name: 'adjust_pending_sets', arguments: '{}' }, ...chunked('Set 2 was RPE 10. [[a1]] That should keep you at 8.'), { type: 'completed' }]]);
    const { shown, note } = await play(model, { a1: saved });
    expect(texts(shown)).toEqual(['Set 2 was RPE 10.', '[app] Changed sets 3–4 to 95 kg × 8 (targets).', 'That should keep you at 8.']);
    expect(note).toBeNull();
  });

  it('a partly true reply: the false part hides with the "only the changes shown" note; the slot names the sets', async () => {
    const saved = benchAdjust();
    const steps = [{ type: 'tool_call' as const, callId: 'a1', name: 'adjust_pending_sets', arguments: '{}' }, ...chunked('I’ve lowered sets 3–4 to 95 kg and dropped set 4.'), { type: 'completed' as const }];
    const sheet = await play(new ScriptedCoachModel([steps]), { a1: saved });
    expect(sheet.note?.text).toBe('Only the changes shown here were made. One line said otherwise and is hidden.');
    const slot = await play(new ScriptedCoachModel([steps]), { a1: saved }, 'slot');
    expect(slot.note?.text).toBe('Only sets 3–4 were changed.');
    const summary = await play(new ScriptedCoachModel([steps]), { a1: saved }, 'summary');
    expect(summary.note?.text).toBe('Only the changes shown under Next time were made. One line said otherwise and is hidden.');
  });

  it('the fake model records what each request offered', async () => {
    const model = new ScriptedCoachModel([[{ type: 'completed' }]]);
    for await (const e of model.stream({ model: 'm', instructions: '', input: [], tools: [{ type: 'function', name: 'get_active_session', description: '', strict: true, parameters: {} }], parallelToolCalls: false })) expect(e.type).toBe('completed');
    expect(model.offeredTools()).toEqual([['get_active_session']]);
  });
});

describe('earlier actions need their token (CC5, review r2 S2)', () => {
  it('free text about an earlier action is kept only when its token is cited in the sentence', () => {
    const earlier = benchAdjust({ turnId: 'turn-0' });
    const withEarlier: TurnLedger = { turnId: 'turn-1', entries: [{ ref: 'e1', record: earlier, origin: 'earlier' }], knownExerciseNames: ['Bench press'] };
    const cited = createReplyFilter({ ledger: () => withEarlier, surface: 'sheet' });
    const shown = [...cited.push('I lowered bench press earlier [[e1]] because set 2 was RPE 10. '), ...cited.end(true)];
    expect(shown.some((i) => i.kind === 'sentence' && i.text.startsWith('I lowered bench press earlier'))).toBe(true);
    expect(cited.hiddenLines).toEqual([]);

    const uncited = createReplyFilter({ ledger: () => withEarlier, surface: 'sheet' });
    const shown2 = [...uncited.push('I lowered bench press earlier because set 2 was RPE 10. '), ...uncited.end(true)];
    expect(shown2.filter((i) => i.kind === 'sentence')).toEqual([]);
    expect(uncited.hiddenLines).toMatchObject([{ reason: 'no_action' }]);
  });
});
