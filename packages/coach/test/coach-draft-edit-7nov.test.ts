import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import { BUILDER_COACH_TOOL_ARGS, COACH_TOOL_ARGS } from '@fizz/schemas';
import { createDraftToolExecutors, type DraftEditOutcome } from '../src/draft-tools';
import { draftEditAsk } from '../src/builder/requests';
import { functionToolDefinition, strictJsonSchema } from '../src/function-tools';
import { COACH_TOOLS } from '../src/registry';
import { createReplyFilter, leansOnPrevious } from '../src/reply';
import { asksLiveChange } from '../src/request';
import { clipExplanation, parseToolCall } from '../src/tool-call';
import { INVALID_ARGS_FINAL_LINE, INVALID_ARGS_RETRY_LINE, runCoachTurn } from '../src/turn';
import type { BuilderProposal } from '../src/builder/proposal';
import { ScriptedCoachModel } from './fake-model';
import { modelShaped } from './model-shaped';
import { call, memoryStore, ports, reply, request, words } from './turn-fixtures';

/**
 * (Ben, 7 Nov, build 552, "Sees: Today") He asked for today's draft to change; the coach asked him to type the change
 * ("Send: …"), then said "The draft-edit tool couldn't read my request", then showed half an argument ("That gives back
 * more attention…" · 1 line hidden). Root causes: `propose_workout_edit` carried only `reason` (the change came from
 * Ben's words this turn alone, so "U shud send this" had none), and strict tools can't declare string lengths, so a
 * long `reason` failed the whole call with no issues sent back and no second try.
 */

const stores: Store[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});
async function store(): Promise<Store> {
  const s = await memoryStore();
  stores.push(s);
  return s;
}

const ALL = { tools: [...COACH_TOOLS], withheld: [] };
const issuesOf = (r: ReturnType<typeof parseToolCall>): string[] => (r.ok ? [] : 'issues' in r ? r.issues : [r.line]);
const CHANGE = 'Add lat pulldowns after rows, trim the raises, keep curls and hanging leg raises, and make it 60–65 minutes.';
const DRAFT = { draftId: 'draft-today', name: 'Pull' };

function proposal(over: Partial<BuilderProposal> = {}): BuilderProposal {
  return {
    id: 'p1',
    draftId: DRAFT.draftId,
    baseVersion: 3,
    ops: [{ op: 'add', exerciseId: 'lat-pulldown', afterSlotKey: 'rows', workingSets: 3, first: null, workSeconds: null }, { op: 'sets', slotKey: 'raises', workingSets: 2 }, { op: 'minutes', minutes: 65 }],
    lines: ['Added Lat pulldown after Barbell row · 3 sets', 'Lateral raise 4 → 2 sets', 'Length 75 → 65 min'],
    warnings: [],
    notes: [],
    preconditions: [{ slotKey: 'rows', rev: 1 }],
    estimate: 64,
    minutes: 65,
    reason: null,
    hidden: [],
    askedHeavier: false,
    ...over,
  };
}

describe('the declared schema and the app agree (every tool)', () => {
  it('arguments shaped by the strict declared schema (every property, nulls for every nullable) parse for every tool', () => {
    for (const t of COACH_TOOLS) {
      const args = modelShaped(functionToolDefinition(t).parameters);
      const r = parseToolCall('t', t.name, JSON.stringify(args), ALL);
      expect([t.name, r.ok ? 'ok' : issuesOf(r)]).toEqual([t.name, 'ok']);
    }
  });

  it('propose_workout_edit: the change is declared (nullable, required) and every shape a model writes is read', () => {
    expect(strictJsonSchema(COACH_TOOL_ARGS.propose_workout_edit)).toMatchObject({ required: ['change', 'reason'], additionalProperties: false });
    for (const args of [{ change: null, reason: 'Ben asked.' }, { change: CHANGE, reason: 'Back first, then arms.' }, { reason: 'An older call.' }, { change: CHANGE, reason: 'x', extra: 1 }]) {
      const r = parseToolCall('t', 'propose_workout_edit', JSON.stringify(args), ALL);
      expect(r.ok).toBe(true);
    }
  });

  it('a long reason (the declared schema can’t say 240) is clipped at a sentence, never a failed call', () => {
    const long = `${'Back work first because you missed Pull A and Upper B this week. '.repeat(4)}Then arms and core.`;
    const r = parseToolCall('t', 'propose_workout_edit', JSON.stringify({ change: CHANGE, reason: long }), ALL);
    if (!r.ok) throw new Error(issuesOf(r).join('; '));
    const reason = r.call.tool === 'propose_workout_edit' ? r.call.args.reason : '';
    expect(reason.length).toBeLessThanOrEqual(240);
    expect(reason.endsWith('.')).toBe(true);
    expect(clipExplanation('one two three four five six', 12)).toBe('one two…');
  });

  it('propose_workout (strict): a long basis or message is clipped too; nulls everywhere are fine', () => {
    const tool = COACH_TOOLS.find((t) => t.name === 'propose_workout');
    if (tool === undefined) throw new Error('no propose_workout');
    const args = modelShaped(functionToolDefinition(tool).parameters, (path) => {
      if (path === 'exercises') return [{ catalogueId: 'barbell-row', warmups: null, workingSets: 3, reps: { min: 6, max: 8 }, workSeconds: null, distanceMetres: null, targetRpe: 8, topSet: null, load: { value: 80, unit: 'kg', convention: 'total', basis: 'Your recent rows were moving well at this weight, a little up from last week', from: 'own_history', relatedCatalogueId: null }, restSeconds: null, superset: null }];
      if (path === 'message') return 'Back first. '.repeat(80);
      return undefined;
    });
    const r = parseToolCall('t', 'propose_workout', JSON.stringify(args), ALL);
    if (!r.ok) throw new Error(issuesOf(r).join('; '));
    expect(r.call.tool === 'propose_workout' ? r.call.args.exercises[0]?.load?.basis.length : 0).toBeLessThanOrEqual(60);
  });

  it('the builder’s own edit tool takes a whole reshape in one call (16 ops)', () => {
    const ops = Array.from({ length: 16 }, (_, i) => ({ op: 'remove', slotKey: `s${String(i)}` }));
    expect(BUILDER_COACH_TOOL_ARGS.propose_workout_edit.safeParse({ ops, reply: 'x' }).success).toBe(true);
  });

  it('a bad call says exactly what is wrong (path: message), and is fixable', () => {
    const r = parseToolCall('t', 'propose_workout_edit', JSON.stringify({ change: 65, reason: '' }), ALL);
    expect(r).toMatchObject({ ok: false, error: 'invalid_args', fixable: true });
    expect(issuesOf(r).map((i) => i.split(':')[0])).toEqual(['change', 'reason']);
    expect(parseToolCall('t', 'propose_workout_edit', '{oops', ALL)).toMatchObject({ ok: false, issues: ['(root): not JSON'] });
    // A rule's refusal is not "fixable": a retry must not reword past it.
    expect(parseToolCall('t', 'add_playbook_candidate', JSON.stringify({ text: 'My knee hates lunges', statedBy: 'ben' }), ALL)).toMatchObject({ ok: false });
  });
});

describe('the agreed change reaches the edit coach (draftEditAsk)', () => {
  it('his words first, then the change he agreed to in the coach’s words; nothing added when there is none', () => {
    expect(draftEditAsk('Make the change suggestion', CHANGE)).toBe(`Make the change suggestion\n\nThe change I’m agreeing to, as my coach put it: ${CHANGE}`);
    expect(draftEditAsk('add a set to rows', null)).toBe('add a set to rows');
    expect(draftEditAsk('add a set to rows', 'Add a set to rows')).toBe('add a set to rows');
  });
});

/** The turn with today's draft in context and the draft-edit tool wired to a fake edit coach. */
async function draftTurn(steps: ConstructorParameters<typeof ScriptedCoachModel>[0], text: string, edit: (req: { words: string; change: string | null }) => DraftEditOutcome) {
  const s = await store();
  const seen: { words: string; change: string | null }[] = [];
  const executors = createDraftToolExecutors({
    store: s.repos.coach,
    draft: DRAFT,
    edit: (req) => {
      seen.push({ words: req.words, change: req.change });
      return Promise.resolve(edit(req));
    },
  });
  const model = new ScriptedCoachModel(steps);
  const r = await runCoachTurn(request({ input: words(text), builderDraft: true }), ports(s, model, executors));
  return { r, model, seen };
}
const sentences = (r: { items: readonly { kind: string; text?: string }[] }) => r.items.filter((i) => i.kind === 'sentence').map((i) => i.text);
type Out = { status?: string; issues?: string[]; next?: string; line?: string };
const outputs = (req: { input: readonly { type: string; output?: string }[] } | undefined): Out[] => (req?.input ?? []).flatMap((i) => (i.type === 'function_call_output' && i.output !== undefined ? [JSON.parse(i.output) as Out] : []));

describe('Ben’s sequence (7 Nov): "Make the change suggestion" ends in one Apply / Skip card', () => {
  it('the coach passes the change it described; the edit coach gets his words and that change; a proposal card', async () => {
    const { r, model, seen } = await draftTurn([[call('propose_workout_edit', { change: CHANGE, reason: 'Back work first, then arms and core.' }), { type: 'completed' }], reply('Back first, then arms and core.')], 'Make the change suggestion', () => ({ kind: 'proposal', proposal: proposal() }));
    expect(model.requests[0]?.instructions).toContain('never ask him to type it');
    expect(seen).toEqual([{ words: 'Make the change suggestion', change: CHANGE }]);
    const card = r.cards.find((c) => c.record.detail.kind === 'propose_workout_edit')?.record;
    expect(card?.status).toBe('proposed');
    expect(card?.detail.kind === 'propose_workout_edit' ? card.detail.proposal.lines : []).toEqual(proposal().lines);
  });

  it('an unreadable first call gets its issues back and one more try in the same turn: the second call makes the card', async () => {
    const { r, model, seen } = await draftTurn(
      [[call('propose_workout_edit', { change: { add: 'lat pulldown' }, reason: 'x' }), { type: 'completed' }], [call('propose_workout_edit', { change: CHANGE, reason: 'Back first.' }), { type: 'completed' }], reply('Back first, then arms and core.')],
      'U shud send this',
      () => ({ kind: 'proposal', proposal: proposal() }),
    );
    const fed = outputs(model.requests.at(-1))[0];
    expect(fed).toMatchObject({ status: 'invalid_args', next: INVALID_ARGS_RETRY_LINE });
    expect(fed?.issues?.[0]).toMatch(/^change: /);
    expect(seen).toHaveLength(1);
    expect(r.cards.find((c) => c.record.detail.kind === 'propose_workout_edit')?.record.status).toBe('proposed');
  });

  it('a second unreadable call: no third try, and the reply is one honest line shown whole (no fragments)', async () => {
    const bad = (): ReturnType<typeof call>[] => [call('propose_workout_edit', { change: 65, reason: 'x' })];
    const { r, model, seen } = await draftTurn(
      [[...bad(), { type: 'completed' }], [...bad(), { type: 'completed' }], [...bad(), { type: 'completed' }], reply('Couldn’t make that change (the time range wasn’t accepted). Nothing changed.')],
      'Make the change suggestion',
      () => ({ kind: 'proposal', proposal: proposal() }),
    );
    expect(outputs(model.requests.at(-1))).toMatchObject([
      { status: 'invalid_args', next: INVALID_ARGS_RETRY_LINE },
      { status: 'invalid_args', next: INVALID_ARGS_FINAL_LINE },
      { status: 'not_allowed', line: INVALID_ARGS_FINAL_LINE },
    ]);
    expect(seen).toEqual([]);
    expect(r.cards).toEqual([]);
    expect(sentences(r)).toEqual(['Couldn’t make that change (the time range wasn’t accepted).', 'Nothing changed.']);
  });
});

describe('never half an argument (the "That gives back more attention…" fragment)', () => {
  it('a sentence leaning on a hidden one is hidden with it; a whole failure line is shown whole', () => {
    const ledger = () => ({ turnId: 't', entries: [], knownExerciseNames: ['Lat pulldown', 'Lateral raise'] });
    const f = createReplyFilter({ ledger, surface: 'sheet', failureBacked: () => true });
    const shown = [...f.push('The draft-edit request didn’t go through. I’ve added lat pulldowns after rows and cut the raises. That gives back more attention while keeping your arms-and-core focus.'), ...f.end(true)];
    expect(shown.map((x) => (x.kind === 'sentence' ? x.text : ''))).toEqual(['The draft-edit request didn’t go through.']);
    expect(f.hiddenLines).toHaveLength(2);
    const g = createReplyFilter({ ledger, surface: 'sheet', failureBacked: () => true });
    const whole = [...g.push('Couldn’t make that change (the time range wasn’t accepted). Nothing changed.'), ...g.end(true)];
    expect(whole.map((x) => (x.kind === 'sentence' ? x.text : ''))).toEqual(['Couldn’t make that change (the time range wasn’t accepted).', 'Nothing changed.']);
    expect(leansOnPrevious('That gives back more attention.')).toBe(true);
    expect(leansOnPrevious('Rows first today.')).toBe(false);
  });
});

describe('a problem Ben points out is the request (Ben, 8 Nov)', () => {
  it.each(["Ok but there's not much of a warm up", 'Yes as I asked, you should have spotted this', "Why haven't u added a 80 too", 'the warm-up is too light', 'this is too long'])('%s', (text) => {
    expect(asksLiveChange(text)).toBe(true);
  });
  it.each(['how was my warm up?', 'the warm-up felt good'])('not: %s', (text) => {
    expect(asksLiveChange(text)).toBe(false);
  });
});
