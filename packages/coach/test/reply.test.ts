import { describe, expect, it } from 'vitest';
import type { ActionRecord } from '@fizz/schemas';
import type { TurnLedger } from '../src/claims';
import { createReplyFilter, needsNoChangeLine, needsStructuralNoChangeLine, NO_CHANGE_SAVED_LINE, toHiddenLines, type ReplyItem } from '../src/reply';
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
    expect(note).toEqual({ text: 'Nothing changed · 1 line hidden', spoken: 'Nothing changed.' });
    const stored = toHiddenLines('turn-1', hidden, '2026-10-10T17:21:00.000Z');
    expect(stored[0]).toMatchObject({ turnId: 'turn-1', reason: 'no_action' });
  });

  it('check 3: a sentence with the model’s 98 kg is dropped whole (the card shows the saved 97.5 kg); 98 appears only in Why?', async () => {
    const saved = benchAdjust({}, tgt(kg(97.5), 8));
    const model = new ScriptedCoachModel([
      [{ type: 'tool_call', callId: 'a1', name: 'adjust_pending_sets', arguments: '{}' }, ...chunked('Set 2 was RPE 10. I’ve lowered sets 3–4 to 98 kg.'), { type: 'completed' }],
    ]);
    const { shown, hidden, note } = await play(model, { a1: saved });
    expect(texts(shown)).toEqual(['Set 2 was RPE 10.']);
    expect(texts(shown).join(' ')).not.toContain('98');
    expect(hidden[0]).toMatchObject({ reason: 'numbers_differ', detail: 'The saved load is 97.5 kg; the reply said 98 kg.' });
    expect(note?.text).toBe('Only the changes shown were made · 1 line hidden');
  });

  it('check 4: a stale result with "Changed" shows only the outcome line', async () => {
    const stale = benchAdjust({ status: 'stale' });
    const model = new ScriptedCoachModel([[{ type: 'tool_call', callId: 'a1', name: 'adjust_pending_sets', arguments: '{}' }, ...chunked('Changed sets 3–4. [[a1]]'), { type: 'completed' }]]);
    const { shown, note } = await play(model, { a1: stale });
    expect(texts(shown)).toEqual(["[app] Couldn't change sets 3–4: your workout moved on. Nothing changed."]);
    expect(note?.text).toBe('Nothing changed · 1 line hidden');
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

  it('a true claim in its own words, with no token, is dropped too: the card is the only change line', async () => {
    const model = new ScriptedCoachModel([[{ type: 'tool_call', callId: 'a1', name: 'adjust_pending_sets', arguments: '{}' }, ...chunked('I’ve lowered sets 3–4 to 95 kg. Set 2 was RPE 10.'), { type: 'completed' }]]);
    const { shown, hidden } = await play(model, { a1: benchAdjust() });
    expect(texts(shown)).toEqual(['Set 2 was RPE 10.']);
    expect(hidden).toEqual([{ sentence: 'I’ve lowered sets 3–4 to 95 kg.', reason: 'mismatch', detail: 'Changes show on their cards, not in the reply.' }]);
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
    expect(sheet.note?.text).toBe('Only the changes shown were made · 1 line hidden');
    const slot = await play(new ScriptedCoachModel([steps]), { a1: saved }, 'slot');
    expect(slot.note?.text).toBe('Only sets 3–4 were changed.');
    const summary = await play(new ScriptedCoachModel([steps]), { a1: saved }, 'summary');
    expect(summary.note?.text).toBe('Only the changes shown were made · 1 line hidden');
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

describe('the fixed no-change line: phrase-based `topic` mode (review r4 spec issue 1 option a, r5 B1c), kept for comparison', () => {
  const names = ['Bench press', 'Overhead press', 'Cable fly', 'Pec deck'];
  const empty = ledger([], names);

  it('needsNoChangeLine: a reply about a change with nothing saved', () => {
    // Phrasings the claim lists may not know still get the line.
    for (const t of ['Rolled back.', 'Pec deck next time.', 'Lighter for the last two.', 'OHP is sorted.', 'Gone from memory.', 'Your shoulder is on my list.', 'Cable fly gets a breather.']) {
      expect(needsNoChangeLine(t, empty), t).toBe(true);
    }
    for (const t of ['Nice work.', 'Rest up and breathe.', 'Good question, here is why.']) {
      expect(needsNoChangeLine(t, empty), t).toBe(false);
    }
    // A live change this turn: the claim check, not the fixed line, decides.
    expect(needsNoChangeLine('Lighter for the last two.', ledger([benchAdjust()], names))).toBe(false);
    // A stale or undone change doesn't count as saved.
    expect(needsNoChangeLine('Rolled back.', ledger([benchAdjust({ status: 'stale', failure: null })], names))).toBe(true);
  });

  it.each([
    'Back at 100.',
    'You’re back on 100.',
    '95 it is.',
    '95 from here.',
    'You’re on 95 for the rest.',
    'Next week: 102.5.',
    'Next session you’re at 102.5.',
    'Coming off 5 for the last two.',
    'Your card shows 95 now.',
    'I know you train before work now.',
    'Got that.',
    'Banked.',
    'In it goes.',
    'On the card now.',
    'Locked and loaded.',
    'In the bank.',
    'Same as before now.',
    'As you were.',
    'All done!',
    'Sure thing, 95.',
    'Yep.  Squat next.',
  ])('bare numbers and generic acknowledgements get the line (review r5 B1c): %s', (t) => {
    expect(needsNoChangeLine(t, empty)).toBe(true);
  });

  it('a reply that is only questions gets no line; a tag question is a statement', () => {
    expect(needsNoChangeLine('Want me to drop sets 3 and 4 to 95?', empty)).toBe(false);
    expect(needsNoChangeLine('Sore or pain?', empty)).toBe(false);
    expect(needsNoChangeLine('95 for the rest, yeah?', empty)).toBe(true);
    expect(needsNoChangeLine('Want me to adjust? It was RPE 10.', empty)).toBe(true);
  });

  it('when Ben asked for a change, any statement gets the line if nothing was saved', () => {
    expect(needsNoChangeLine('Sure thing.', empty)).toBe(false);
    expect(needsNoChangeLine('Sure thing.', empty, { benAskedForChange: true })).toBe(true);
    expect(needsNoChangeLine('Which sets?', empty, { benAskedForChange: true })).toBe(false);
  });

  it('the r4 failure scenario: a stale undo, then "Back at 100." — the sentence is hidden and the note says nothing changed', () => {
    const a = benchAdjust({ turnId: 'turn-0' });
    const undo = record(
      {
        kind: 'undo',
        undoneActionId: a.actionId,
        what: 'the change to sets 3–4',
        restored: [{ sessionExerciseId: id(10), exerciseName: 'Bench press', changes: [{ setId: id(13), setNumber: 3, before: tgt(kg(95), 8), after: tgt(kg(100), 6, 8) }] }],
        alreadyLogged: [],
      },
      { status: 'stale' },
    );
    const current = (): TurnLedger => ({ turnId: 'turn-1', entries: [{ ref: 'u1', record: undo, origin: 'this_turn' }], knownExerciseNames: names });
    const f = createReplyFilter({ ledger: current, surface: 'sheet' });
    const shown = [...f.push('Back at 100. '), ...f.end(true)];
    expect(shown.filter((i) => i.kind === 'sentence')).toEqual([]);
    expect(f.note()?.text).toBe('Nothing changed · 1 line hidden');
  });

  it('topic mode adds the line to training talk; off adds nothing', () => {
    const current = (): TurnLedger => ({ turnId: 'turn-1', entries: [], knownExerciseNames: names });
    const on = createReplyFilter({ ledger: current, surface: 'sheet', noChangeLine: 'topic' });
    on.push('Cable fly is a good finisher. ');
    on.end(true);
    expect(on.note()).toEqual({ text: NO_CHANGE_SAVED_LINE, spoken: null });
    const off = createReplyFilter({ ledger: current, surface: 'sheet', noChangeLine: 'off', benAskedForChange: true });
    off.push('Sure thing. ');
    off.end(true);
    expect(off.note()).toBeNull();
  });
});

describe('the structural no-change line (PM decision 10 Oct: default)', () => {
  const names = ['Bench press', 'Overhead press', 'Cable fly', 'Pec deck'];
  const empty = ledger([], names);

  it('shows only when Ben asked for a change and the turn has no card; reads no phrase list', () => {
    for (const t of ['Boom.', 'Voilà.', 'All yours.', 'Easy.', 'Nice one, that’s you.', '👍', '✅', 'Sure thing.', 'Lighter now, better?']) {
      expect(needsStructuralNoChangeLine(t, empty, true), t).toBe(t === 'Lighter now, better?' ? false : true);
    }
    expect(needsStructuralNoChangeLine('Which sets?', empty, true)).toBe(false);
    // Not asked: no line, whatever the words; the claim check is the backstop.
    expect(needsStructuralNoChangeLine('Cable fly is a good finisher.', empty, false)).toBe(false);
    // Any card this turn says what happened, even a stale one.
    expect(needsStructuralNoChangeLine('Sure thing.', ledger([benchAdjust()], names), true)).toBe(false);
    expect(needsStructuralNoChangeLine('Sure thing.', ledger([benchAdjust({ status: 'stale', failure: null })], names), true)).toBe(false);
  });

  it('is the filter default: training talk without a request gets no line; a request with no card does, emoji included', () => {
    const current = (): TurnLedger => ({ turnId: 'turn-1', entries: [], knownExerciseNames: names });
    const chat = createReplyFilter({ ledger: current, surface: 'sheet' });
    chat.push('Cable fly is a good finisher. ');
    chat.end(true);
    expect(chat.note()).toBeNull();
    const asked = createReplyFilter({ ledger: current, surface: 'sheet', benAskedForChange: true });
    asked.push('👍');
    asked.end(true);
    expect(asked.note()).toEqual({ text: 'No change made.', spoken: null });
  });

  it.each([
    'Sets 3 and 4 are 95, the knee flag stays.',
    'Done, and next Push A will start at 95.',
    'I dropped sets 3 and 4 to 95 and cut set 4.',
    'Sets 3 and 4 are 95 for 8, plus a back-off set.',
    'Sets 3 and 4 are 95 and AMRAP.',
    'Sets 3 and 4 are 95 with a 3 second pause.',
    'Your last three sets are 95.',
    'All four sets are 95.',
    'Sets 3 and 4 are 95 — and set 2 too.',
    'Raised sets 3 and 4 to 95.',
    'Bumped sets 3 and 4 up to 95.',
    'Sets 3 and 4 are heavier now.',
    'Sets 3 and 4 are 95, 10 lighter.',
    'Sets 3 and 4 are 95, down from 105.',
    'Sets 3 and 4 are 95, same reps.',
    'Undone, still 95 for set 4.',
    'Both sets back to 100.',
    'Undone, you’re back on 100 for 8.',
  ])('review r6 B1a/B1b: beside a real change, an uncited change sentence is dropped: %s', (t) => {
    const f = createReplyFilter({ ledger: () => ledger([benchAdjust()], names), surface: 'sheet' });
    const shown = [...f.push(`${t} `), ...f.end(true)];
    expect(shown).toEqual([]);
    expect(f.hiddenLines).toHaveLength(1);
  });
});
