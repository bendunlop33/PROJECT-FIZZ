import { describe, expect, it } from 'vitest';
import type { TurnLedger } from '../src/claims';
import { collectFacts } from '../src/numbers';
import { createReplyFilter, type ReplyItem } from '../src/reply';
import { benchAdjust, ledger } from './records';

/** Ben, 24 Nov (Push B): the coach's explanations were hidden as "claims"; claims with no change behind them still are. */
const FACTS = collectFacts([
  { text: 'Dumbbell shoulder press, sets 4 to 6: 30 kg each × 8–10. Before it today: bench press 4 sets, incline press 3 sets.', setsDone: false },
  { text: 'Last session: 32.5 kg × 8, 32.5 kg × 8, 32.5 kg × 8', setsDone: true },
]);

function run(text: string, led: TurnLedger = { turnId: 't', entries: [], knownExerciseNames: ['Dumbbell shoulder press', 'Bench press'] }, benAsked = false) {
  const f = createReplyFilter({ ledger: () => led, surface: 'sheet', facts: () => FACTS, benAskedForChange: benAsked });
  const items: ReplyItem[] = [...f.push(text), ...f.end(true)];
  return { shown: items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : [])), hidden: f.hiddenLines, note: f.note() };
}

describe('explaining existing targets (part B)', () => {
  it('keeps explanations that match the context, with no note', () => {
    const r = run('Today’s shoulder press is 30 kg each × 8–10 because you had already done 4 bench sets and 3 incline sets before it. Your last session was 32.5 kg each × 8 on all three sets.');
    expect(r.hidden.map((h) => [h.sentence, h.reason, h.detail])).toEqual([]);
    expect(r.shown).toHaveLength(2);
    expect(r.hidden.map((h) => [h.sentence, h.reason, h.detail])).toEqual([]);
    expect(r.note).toBeNull();
  });

  it('keeps a plain-words explanation with no numbers', () => {
    const r = run('The history doesn’t show why the press target dropped, because your last session started with shoulder press and today it comes after bench.');
    expect(r.shown).toHaveLength(1);
    expect(r.note).toBeNull();
  });

  it('still hides a wrong number in an explanation', () => {
    const r = run('Today’s shoulder press is 27.5 kg each × 8–10 because your last session was lighter.');
    expect(r.shown).toEqual([]);
    expect(r.hidden).toHaveLength(1);
  });

  it('still hides change claims with no committed action, and says nothing changed', () => {
    for (const s of ['I’ve changed sets 4 to 6 to 30 kg each × 10 because that matches last time.', 'Done, sets 4 to 6 are now 30 kg each × 10.']) {
      const r = run(s);
      expect(r.shown, s).toEqual([]);
      expect(r.note?.text, s).toMatch(/^Nothing changed · 1 line hidden$/);
    }
  });

  it('a hidden line that claimed no change is only counted, never "Nothing changed"', () => {
    const r = run('Overhead press is on hold because of your shoulder.');
    expect(r.shown).toEqual([]);
    expect(r.note?.text).toBe('1 line hidden');
  });

  it('a real change this turn is unaffected', () => {
    const rec = benchAdjust();
    const led = ledger([rec]);
    const r = run(`[[${led.entries[0]?.ref ?? 'a1'}]] Keep it smooth rather than forcing the last reps, because your last session was 8 reps.`, led, true);
    expect(r.hidden.map((h) => [h.sentence, h.reason])).toEqual([]);
    expect(r.shown.join(' ')).toMatch(/Keep it smooth/);
  });
});
