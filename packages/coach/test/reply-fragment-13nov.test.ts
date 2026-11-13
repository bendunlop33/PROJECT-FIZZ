import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import type { ActionDetail, ActionRecord } from '@fizz/schemas';

import type { TurnLedger } from '../src/claims';
import { createStoreExecutors, type CoachExecutors } from '../src/executors';
import { createPlanAddExecutor, type PlanSwapPrepared } from '../src/plan-swap';
import { createReplyFilter, type ReplyItem } from '../src/reply';
import { resolveActionTokens, tokenDisplayText } from '../src/tokens';
import { runCoachTurn } from '../src/turn';
import { chunked, ScriptedCoachModel } from './fake-model';
import { benchAdjust, id, ledger, record } from './records';
import { call, memoryStore, ports, reply, request, words } from './turn-fixtures';

/**
 * (Ben, 13 Nov, build 568) "Change my plan: why don't we do any hip ab/adductor exercises" made a plan-add card, but
 * the reply under it read "…don't replace targeted work. gives them direct attention without piling extra work onto
 * the same leg day." The model opened its last sentence with the card's `[[ref]]`; the app line for a ref isn't shown
 * inside the reply (the card is), so the token's removal cut the sentence's subject off. A shown sentence is now always
 * whole: a token is worded ("This change") or dropped with its punctuation, never left as a hole; a sentence citing a
 * change that wasn't saved is hidden whole.
 */

const FIRST = 'Your plan has no direct hip abduction or adduction work, and no playbook rule explains that omission; squats and split squats involve those muscles, but don’t replace targeted work.';
const TAIL = 'gives them direct attention without piling extra work onto the same leg day.';

const PLAN_ADD: Extract<ActionDetail, { kind: 'propose_plan_swap' }> = {
  kind: 'propose_plan_swap',
  op: 'add',
  planId: id(500),
  planName: 'PPL',
  addId: 'hip-abduction-machine',
  addName: 'Hip abduction machine',
  afterId: null,
  afterName: null,
  sets: 3,
  reps: { min: 12, max: 15 },
  load: null,
  days: [{ routineId: id(501), routineName: 'Legs A', versionBefore: 3, edits: [{ kind: 'add', rowId: id(511), afterRowId: null, afterName: null, first: false }], before: ['Back squat'], after: ['Back squat', 'Hip abduction machine'] }],
  today: null,
};

const planCard = (): ActionRecord => record(PLAN_ADD, { status: 'proposed', reason: 'No direct hip abduction or adduction work.' });

function filterRun(text: string, l: TurnLedger): { shown: string[]; hidden: string[]; note: string | null } {
  const filter = createReplyFilter({ ledger: () => l, surface: 'sheet' });
  const items: ReplyItem[] = [];
  for (const c of chunked(text, 7)) if (c.type === 'text_delta') items.push(...filter.push(c.delta));
  items.push(...filter.end(true));
  return { shown: items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : [])), hidden: filter.hiddenLines.map((h) => h.sentence), note: filter.note()?.text ?? null };
}

/** Whole and grammatical as far as the app can tell: no token debris, no lowercase start, no space before punctuation. */
function expectWhole(sentences: readonly string[]): void {
  for (const s of sentences) {
    expect(s, s).not.toMatch(/\[|\]/);
    expect(s, s).not.toMatch(/^\W*\p{Ll}/u);
    expect(s, s).not.toMatch(/\s[.,;:!?]/);
    expect(s, s).not.toMatch(/\s{2}/);
  }
}

describe('tokenDisplayText: a token never leaves a hole (13 Nov)', () => {
  it('words a token that is the sentence’s subject', () => {
    expect(tokenDisplayText(`[[a1]] ${TAIL}`).text).toBe(`This change ${TAIL}`);
    expect(tokenDisplayText('[[a1]] and [[a2]] give them direct attention.').text).toBe('These changes give them direct attention.');
    expect(tokenDisplayText('Adding [[a1]] gives them direct attention.').text).toBe('Adding this change gives them direct attention.');
  });

  it('drops a token that only cites, with its punctuation', () => {
    expect(tokenDisplayText('Adding one to each leg day gives them direct attention [[a1]].').text).toBe('Adding one to each leg day gives them direct attention.');
    expect(tokenDisplayText('Adding one to each leg day gives them direct attention: [[a1]]').text).toBe('Adding one to each leg day gives them direct attention');
    expect(tokenDisplayText('Adding one to each leg day (see [[a1]]) gives them direct attention.').text).toBe('Adding one to each leg day gives them direct attention.');
    expect(tokenDisplayText('[[a1]] Then rest.').text).toBe('Then rest.');
    expect(tokenDisplayText('[[a1]]: one on each leg day.').text).toBe('One on each leg day.');
    expect(tokenDisplayText('See [[a1]].').text).toBe('');
    expect(tokenDisplayText('[[a1]] [[a2]]').text).toBe('');
    expect(tokenDisplayText('Done: [[a1]] and [[zz]] [[broken').text).toBe('Done');
  });

  it('leaves a sentence without tokens as it was', () => {
    expect(tokenDisplayText(`Adding one to each leg day ${TAIL}`).text).toBe(`Adding one to each leg day ${TAIL}`);
  });

  it('keeps the plain text for the claim check as before', () => {
    const r = resolveActionTokens(`[[a1]] ${TAIL}`, ledger([planCard()]), 'sheet');
    expect(r.plainText).toBe(TAIL);
    expect(r.displayText).toBe(`This change ${TAIL}`);
    expect(r.leadingActions).toBe(1);
  });
});

describe('the reply filter shows whole sentences only (13 Nov, build 568)', () => {
  it('Ben’s reply: the sentence describing the saved card stays, whole', () => {
    const { shown, hidden, note } = filterRun(`${FIRST} [[a1]] ${TAIL}`, ledger([planCard()]));
    expect(shown).toEqual([FIRST, `This change ${TAIL}`]);
    expect(hidden).toEqual([]);
    expect(note).toBeNull();
    expectWhole(shown);
  });

  it('the likely original openings: a describing sentence stays as written; a restatement of the change is hidden whole', () => {
    for (const opening of ['This change', 'The plan change', 'One on each leg day', 'Doing them at the end of each leg day']) {
      const { shown, hidden } = filterRun(`${FIRST} ${opening} ${TAIL}`, ledger([planCard()]));
      expect(shown, opening).toEqual([FIRST, `${opening} ${TAIL}`]);
      expect(hidden, opening).toEqual([]);
      expectWhole(shown);
    }
    // "Adding …" restates the change in the coach's words (the claim check, unchanged): hidden whole, with or without
    // its token, and counted. Never cut down to "gives them…".
    for (const opening of ['Adding one to each leg day', 'Adding one to each leg day [[a1]]', 'Adding [[a1]]']) {
      const { shown, hidden, note } = filterRun(`${FIRST} ${opening} ${TAIL}`, ledger([planCard()]));
      expect(shown, opening).toEqual([FIRST]);
      expect(hidden, opening).toHaveLength(1);
      expect(hidden[0], opening).toMatch(/^Adding /);
      expect(note, opening).toBe('1 line hidden');
    }
  });

  it('a citation at the end or in brackets is dropped, the words kept', () => {
    for (const [text, want] of [
      [`One on each leg day ${TAIL.replace('.', ' [[a1]].')}`, `One on each leg day ${TAIL}`],
      [`One on each leg day ${TAIL.replace('.', ': [[a1]]')}`, `One on each leg day ${TAIL.replace('.', '')}`],
      [`One on each leg day (see [[a1]]) ${TAIL}`, `One on each leg day ${TAIL}`],
      [`[[a1]]: one on each leg day ${TAIL}`, `One on each leg day ${TAIL}`],
    ] as const) {
      const { shown, hidden } = filterRun(text, ledger([planCard()]));
      expect(shown, text).toEqual([want]);
      expect(hidden, text).toEqual([]);
    }
  });

  it('a wrong ref beside a saved card still reads whole (the sentence is about the card)', () => {
    const { shown, hidden } = filterRun(`${FIRST} [[p1]] ${TAIL}`, ledger([planCard()]));
    expect(shown).toEqual([FIRST, `This change ${TAIL}`]);
    expect(hidden).toEqual([]);
  });

  it('with no card, a sentence citing a change is hidden whole and counted, never shown cut', () => {
    const { shown, hidden, note } = filterRun(`${FIRST} [[a1]] ${TAIL}`, ledger([]));
    expect(shown).toEqual([FIRST]);
    expect(hidden).toEqual([`[[a1]] ${TAIL}`]);
    expect(note).toBe('Nothing changed · 1 line hidden');
    expectWhole(shown);
  });

  it('with no card, a sentence claiming the change is hidden whole', () => {
    const { shown, hidden } = filterRun(`${FIRST} I’ve added hip abduction to Legs A, which ${TAIL}`, ledger([]));
    expect(shown).toEqual([FIRST]);
    expect(hidden).toEqual([`I’ve added hip abduction to Legs A, which ${TAIL}`]);
  });

  it('a cited saved set change keeps its app line, and the words around it stay whole', () => {
    const l = ledger([benchAdjust()]);
    const filter = createReplyFilter({ ledger: () => l, surface: 'sheet' });
    const items = [...filter.push('Set 2 was RPE 10. [[a1]] That should keep you at 8. [[a1]] keeps you in range.'), ...filter.end(true)];
    expect(filter.hiddenLines).toEqual([]);
    expect(items.map((i) => (i.kind === 'sentence' ? i.text : '[app]'))).toEqual(['Set 2 was RPE 10.', '[app]', 'That should keep you at 8.', '[app]', 'This change keeps you in range.']);
  });
});

describe('a plan-add turn end to end (13 Nov, build 568)', () => {
  let stores: Store[] = [];
  afterEach(async () => {
    for (const s of stores) await s.close();
    stores = [];
  });

  function executors(s: Store): CoachExecutors {
    return {
      ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: null }),
      ...createPlanAddExecutor({ store: s.repos.coach, prepare: (): Promise<PlanSwapPrepared> => Promise.resolve({ kind: 'ok', detail: PLAN_ADD }) }),
    };
  }

  const ctx = {
    session: null,
    gymName: 'Main Gym',
    painFlags: [],
    checkIn: null,
    memories: [],
    catalogue: [],
    plan: { today: '2026-11-13', inUse: { name: 'PPL', paused: null, days: [{ name: 'Legs A', exercises: [{ catalogueId: 'barbell-back-squat', name: 'Back squat' }] }] } },
  };
  const ARGS = { add: 'hip-abduction-machine', days: ['Legs A'], after: null, workingSets: 3, reps: { min: 12, max: 15 }, load: null, position: 'last', before: null, minutes: null, distanceM: null, warmup: false, also: null, notIncluded: null, reason: 'No direct hip abduction or adduction work.' };

  it('shows the card and both sentences whole', async () => {
    const s = await memoryStore();
    stores.push(s);
    const model = new ScriptedCoachModel([[call('propose_plan_add', ARGS), { type: 'completed' }], reply(`${FIRST} [[a1]] ${TAIL}`)]);
    const r = await runCoachTurn(request({ input: words('Change my plan: why don’t we do any hip ab/adductor exercises'), planInUse: true, context: ctx }), ports(s, model, executors(s)));
    expect(r.status).toBe('completed');
    expect(r.cards).toHaveLength(1);
    const shown = r.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : []));
    expect(shown).toEqual([FIRST, `This change ${TAIL}`]);
    expectWhole(shown);
    expect(r.hiddenLines).toEqual([]);
  });
});
