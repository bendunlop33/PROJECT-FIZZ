import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import { shownRationale } from '@fizz/domain';
import { checkedRationale } from '../src/build';
import { collectFacts, numericClaims, UNLABELLED_ESTIMATE_DETAIL, UNVERIFIED_NUMBER_DETAIL, verifySentence } from '../src/numbers';
import { createReplyFilter } from '../src/reply';
import { runCoachTurn } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { call, memoryStore, ports, reply, request, words } from './turn-fixtures';

/**
 * Coach v3, slice 4 (ADR 0027; Ben 18 Oct: "allow numbers in replies but checked"). Numbers the
 * coach states must come from what it was given; invented ones are hidden, never rewritten.
 */

let stores: Store[] = [];
async function store(): Promise<Store> {
  const s = await memoryStore();
  stores.push(s);
  return s;
}
afterEach(async () => {
  for (const s of stores) await s.close();
  stores = [];
});

const facts = collectFacts([
  JSON.stringify({ domain: 'Your data', heaviest: { date: '2026-10-12', load: { value: 100, unit: 'kg', convention: 'total' }, reps: 5 }, db: { value: 22.5, unit: 'kg', convention: 'per_hand' }, id: '00000000-0000-4000-8000-000000000777' }),
  'make it 40',
]);

describe('numericClaims', () => {
  it('reads loads, reps, sets, RPE, ranges and dates; set labels and ordinals are not claims', () => {
    const c = numericClaims('Set 2: 100 kg × 5 @ RPE 8, then 3 × 8–10 on 12 Oct; your 2nd set was fine.');
    expect(c.map((x) => [x.value, x.kind])).toEqual([
      [12, 'date'],
      [100, 'load'],
      [5, 'reps'],
      [8, 'rpe'],
      [3, 'sets'],
      [8, 'reps'],
      [10, 'reps'],
    ]);
    expect(numericClaims('12–15 kg dumbbells').map((x) => x.kind)).toEqual(['load', 'load']);
  });
});

describe('verifySentence', () => {
  it('a number from the facts passes; an invented load or a date not in the facts fails', () => {
    expect(verifySentence('Your best is 100 kg × 5 from 12 Oct.', facts)).toEqual({ ok: true });
    expect(verifySentence('You benched 120 kg last week.', facts)).toEqual({ ok: false, numbers: ['120'], detail: UNVERIFIED_NUMBER_DETAIL });
    expect(verifySentence('Your best was on 14 Oct.', facts)).toMatchObject({ ok: false });
  });

  it('per-hand dumbbells: 22.5 kg each checks; kg and lb convert both ways', () => {
    expect(verifySentence('The 22.5 kg each dumbbells are the ones to use.', facts)).toEqual({ ok: true });
    expect(verifySentence('That top set is about 220 lb.', facts)).toEqual({ ok: true });
    expect(verifySentence('That top set is about 250 lb.', facts).ok).toBe(false);
  });

  it('advice counts pass on their own; the same counts in a sentence about the past need a source', () => {
    const none = collectFacts([]);
    expect(verifySentence('Do 3 sets of 8–10 reps at RPE 8 with 90 s rest.', none)).toEqual({ ok: true });
    expect(verifySentence('Keep it to 45 minutes.', none)).toEqual({ ok: true });
    expect(verifySentence('Last time you did 12 reps.', none).ok).toBe(false);
    expect(verifySentence('Go 105 kg next set.', none).ok).toBe(false);
  });

  it('an estimated 1RM must be called an estimate (rule 6)', () => {
    expect(verifySentence('Your 1RM is 100 kg.', facts)).toEqual({ ok: false, numbers: ['100'], detail: UNLABELLED_ESTIMATE_DETAIL });
    expect(verifySentence('Your estimated 1RM is about 100 kg.', facts)).toEqual({ ok: true });
    expect(verifySentence('Your e1RM is ≈ 100 kg.', facts)).toEqual({ ok: true });
  });

  it('a set stated as done must be a logged set, load and reps together (not 105 and 8 found apart)', () => {
    const f = collectFacts([JSON.stringify({ sets: [{ load: { value: 100, unit: 'kg', convention: 'total' }, reps: 7 }], loads: '95, 100, 105 kg', reps: { min: 8, max: 10 } })]);
    expect(f.pairs.has('100|7')).toBe(true);
    expect(verifySentence('You did 100 kg × 7 last time.', f)).toEqual({ ok: true });
    expect(verifySentence('You did 105×8 last time.', f)).toMatchObject({ ok: false, numbers: ['105×8'] });
    // As advice, the same numbers are a suggestion, not a record.
    expect(verifySentence('Try 105 kg × 8.', f)).toEqual({ ok: true });
  });

  it('review S1: today’s target 105 kg × 8 is a plan, never a set done; the logged set in the same context is', () => {
    const load = (value: number) => ({ value, unit: 'kg', convention: 'total' });
    const workout = {
      domain: 'Your data',
      workout: {
        exercises: [
          {
            name: 'Bench press',
            sets: [
              { setId: 'a', status: 'completed', target: { load: load(100), reps: { min: 8, max: 8 }, rpe: 8 }, actual: { load: load(100), reps: { min: 7, max: 7 }, rpe: 9 } },
              { setId: 'b', status: 'pending', target: { load: load(105), reps: { min: 8, max: 8 }, rpe: 8 }, actual: null },
            ],
          },
        ],
        lastLogged: { exercise: 'Bench press', kind: 'working', load: load(100), reps: 7, rpe: 9 },
      },
      builtIn: { label: 'built-in rule (fallback), for comparison', sets: [{ type: 'working', target: '110 kg × 6', load: load(110), reps: { min: 6, max: 6 }, rpe: 8 }] },
    };
    const f = collectFacts([`YOUR DATA\n${JSON.stringify(workout)}`, { text: 'Bench press: 100 → 105 kg × 8', setsDone: false }]);
    expect([...f.pairs]).toEqual(['100|7']);
    expect(verifySentence('Last time you did 105 kg × 8.', f)).toMatchObject({ ok: false, numbers: ['105 kg × 8'] });
    expect(verifySentence('Last time you did 110 kg × 6.', f).ok).toBe(false);
    expect(verifySentence('You did 100 kg × 7 last set.', f)).toEqual({ ok: true });
    // Its numbers are still values: advice with 105 kg passes.
    expect(verifySentence('Next set: 105 kg × 8.', f)).toEqual({ ok: true });
    // Ben's own words state a set done.
    expect(collectFacts(['I did 105 x 8 on Monday']).pairs.has('105|8')).toBe(true);
  });

  it('IDs are not facts: digits inside a UUID never verify a number', () => {
    expect(verifySentence('Your best is 777 kg.', facts).ok).toBe(false);
  });
});

describe('the reply filter hides an unverified sentence and keeps the rest', () => {
  it('hidden as unverified_number; the note says only that a line was hidden', () => {
    const filter = createReplyFilter({ ledger: () => ({ turnId: 't', entries: [], knownExerciseNames: [] }), surface: 'sheet', facts: () => facts });
    const items = [...filter.push('Your best is 100 kg × 5. You also hit 130 kg last month. '), ...filter.end(true)];
    expect(items).toEqual([{ kind: 'sentence', text: 'Your best is 100 kg × 5.' }]);
    expect(filter.hiddenLines).toEqual([{ sentence: 'You also hit 130 kg last month.', reason: 'unverified_number', detail: UNVERIFIED_NUMBER_DETAIL }]);
    expect(filter.note()).toEqual({ text: '1 line hidden', spoken: null });
  });
});

describe('runCoachTurn: facts come from code and Ben, never from the model', () => {
  it('a number from a read is shown; the model’s own earlier reply never verifies a number', async () => {
    const s = await store();
    const records = { domain: 'Your data', records: [{ heaviest: { load: { value: 102.5, unit: 'kg', convention: 'total' }, reps: 6 } }] };
    const model = new ScriptedCoachModel([
      [call('get_exercise_records', { exerciseId: '00000000-0000-4000-8000-000000000200' }), { type: 'completed' }],
      reply('Your heaviest bench is 102.5 kg × 6. Your best squat is 140 kg.'),
    ]);
    const first = await runCoachTurn(request({ input: words('what are my bests?') }), ports(s, model, { get_exercise_records: () => Promise.resolve({ kind: 'read', data: records }) }));
    expect(first.items).toEqual([{ kind: 'sentence', text: 'Your heaviest bench is 102.5 kg × 6.' }]);
    expect(first.hiddenLines.map((h) => [h.sentence, h.reason])).toEqual([['Your best squat is 140 kg.', 'unverified_number']]);
    // Next turn: the 102.5 the coach said is history (assistant text), not a fact; the read isn't repeated.
    const m2 = new ScriptedCoachModel([reply('Your best bench is 102.5 kg × 6.')]);
    const second = await runCoachTurn(request({ input: words('remind me?'), threadId: first.threadId }), ports(s, m2));
    expect(second.items).toEqual([]);
    expect(second.hiddenLines[0]?.reason).toBe('unverified_number');
    // Ben's own number is a fact.
    const m3 = new ScriptedCoachModel([reply('Then 105 kg is the next step.')]);
    const third = await runCoachTurn(request({ input: words('I did 105 kg at home yesterday'), threadId: first.threadId }), ports(s, m3));
    expect(third.items).toEqual([{ kind: 'sentence', text: 'Then 105 kg is the next step.' }]);
  });
});

describe('the build message (draft rationale) may carry checked numbers', () => {
  const draftFacts = collectFacts([JSON.stringify({ slots: [{ setTemplates: [{ reps: { min: 8, max: 10 }, load: { value: 22.5 } }] }] }), '40', 'Shoulders, hotel gym, make it 40']);

  it('numbers in the plan or Ben’s words stay; an invented one drops its sentence; praise and max claims still drop', () => {
    expect(checkedRationale('40 minutes of shoulders on the dumbbells. Presses at 22.5 kg each for 8–10. You can do 30 kg.', draftFacts)).toBe('40 minutes of shoulders on the dumbbells. Presses at 22.5 kg each for 8–10.');
    expect(checkedRationale('A great session. Built around your max.', draftFacts)).toBeNull();
    // Without facts (older callers): words only, as before.
    expect(checkedRationale('40 minutes of shoulders. Presses first.')).toBe('Presses first.');
  });

  it('shown with numbers only when checked at build time; older drafts stay words only', () => {
    expect(shownRationale('40 minutes of shoulders. Presses first.', true)).toBe('40 minutes of shoulders. Presses first.');
    expect(shownRationale('40 minutes of shoulders. Presses first.', false)).toBe('Presses first.');
  });
});
