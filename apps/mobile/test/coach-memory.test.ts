import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRequest } from '@fizz/coach';

import { memoryScreenView } from '../src/coach/memory-view';
import { threadRows } from '../src/coach/sheet-view';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Backlog §4.3 item 4 (coach-memory §2.1–2.4): the Memory screen lists saved
 * memories and the coach's suggestions waiting for Save; edit, forget (Undo)
 * and add. A suggestion is never sent to the coach until Ben saves it (CM1),
 * and drops off after 14 days (CM3). Memory is Your data (rule 10).
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

function yourData(req: ModelRequest | undefined): { memories: { text: string }[] } {
  const block = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { memories: { text: string }[] };
}
function knowledge(req: ModelRequest | undefined): string {
  const block = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('COACHING KNOWLEDGE'));
  return block?.type === 'message' ? block.content : '';
}

async function ready(): Promise<AppServices> {
  const { services: s } = await h.launch();
  await setUpGym(h, s);
  return s;
}

const ask = (s: AppServices, text: string) => s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

describe('memory suggestions (CM1–CM3)', () => {
  it('the coach suggests; the card offers Save; nothing reaches the coach until Ben saves it', async () => {
    const s = await ready();
    model = new StepModel([() => toolCall('suggest_memory', { text: 'Trains before work', quote: 'I train before work' }), () => replyWith('Noted the timing.')]);
    const r = await ask(s, 'I train before work, so keep it short');
    const record = r.cards[0]?.record;
    expect(record).toMatchObject({ status: 'proposed', detail: { kind: 'suggest_memory', text: 'Trains before work' } });
    const data = await s.coach.loadThread(r.threadId);
    const card = threadRows(data ?? (null as never)).find((x) => x.kind === 'card');
    expect(card?.kind === 'card' ? card.card : null).toMatchObject({ status: { word: 'Suggested' }, text: 'Save to memory? “Trains before work”', memoryChoice: { version: 1 } });
    // Waiting, and not in the next request's context (CM1).
    expect((await s.coach.memories()).waiting.map((m) => m.text)).toEqual(['Trains before work']);
    model = new StepModel([() => replyWith('Hi.')]);
    await ask(s, 'Hello');
    expect(yourData(model.requests[0]).memories).toEqual([]);

    // Save (a double tap is one write) → saved, and sent next time as Your data, never as coaching knowledge.
    const memoryId = record?.detail.kind === 'suggest_memory' ? record.detail.memoryId : '';
    expect(await s.coach.decideMemory(memoryId, 1, 'save')).toMatchObject({ status: 'written', memory: { status: 'active', version: 2 } });
    expect(await s.coach.decideMemory(memoryId, 1, 'save')).toMatchObject({ status: 'written', memory: { version: 2 } });
    model = new StepModel([() => replyWith('Hi.')]);
    await ask(s, 'Hello again');
    expect(yourData(model.requests[0]).memories.map((m) => m.text)).toEqual(['Trains before work']);
    expect(knowledge(model.requests[0])).not.toContain('Trains before work');
    const after = threadRows((await s.coach.loadThread(r.threadId)) ?? (null as never)).find((x) => x.kind === 'card');
    expect(after?.kind === 'card' ? after.card.status.word : null).toBe('Saved');
  });

  it('Not now keeps it out; the same words aren’t suggested twice while waiting; after 14 days it can’t be saved', async () => {
    const s = await ready();
    model = new StepModel([() => toolCall('suggest_memory', { text: 'Dislikes lunges', quote: 'lunges are the worst' }), () => replyWith('Ok.')]);
    const first = await ask(s, 'lunges are the worst');
    const id1 = first.cards[0]?.record.detail.kind === 'suggest_memory' ? first.cards[0].record.detail.memoryId : '';
    model = new StepModel([() => toolCall('suggest_memory', { text: 'dislikes  lunges.', quote: 'still hate lunges' }), () => replyWith('Ok.')]);
    const again = await ask(s, 'still hate lunges');
    expect(again.cards[0]?.record).toMatchObject({ status: 'rejected', failure: 'it is already saved or waiting' });

    h.clockMs += 14 * DAY;
    expect((await s.coach.memories()).waiting).toEqual([]);
    expect(await s.coach.decideMemory(id1, 1, 'save')).toMatchObject({ status: 'stale' });
    const card = threadRows((await s.coach.loadThread(first.threadId)) ?? (null as never)).find((x) => x.kind === 'card');
    expect(card?.kind === 'card' ? card.card.status.word : null).toBe('Not saved');
    // Dropped off after 14 days: the same words may be suggested again, and wait for Save (review S6).
    model = new StepModel([() => toolCall('suggest_memory', { text: 'Dislikes lunges', quote: 'lunges again' }), () => replyWith('Ok.')]);
    const later = await ask(s, 'lunges again, ugh');
    expect(later.cards[0]?.record).toMatchObject({ status: 'proposed', detail: { kind: 'suggest_memory', text: 'Dislikes lunges' } });
    expect((await s.coach.memories()).waiting.map((m) => m.text)).toEqual(['Dislikes lunges']);

    model = new StepModel([() => toolCall('suggest_memory', { text: 'Uses straps on rows', quote: 'straps' }), () => replyWith('Ok.')]);
    const third = await ask(s, 'I use straps on rows');
    const id3 = third.cards[0]?.record.detail.kind === 'suggest_memory' ? third.cards[0].record.detail.memoryId : '';
    expect(await s.coach.decideMemory(id3, 1, 'not_now')).toMatchObject({ status: 'written', memory: { status: 'not_saved' } });
    expect(await s.coach.decideMemory(id3, 2, 'save')).toMatchObject({ status: 'stale' });
    expect((await s.coach.memories()).saved).toEqual([]);
  });
});

describe('general rules vs memories (CM9, review coach-tools r2 S1, S2)', () => {
  it('"remember to always deload every 5th week" is never a memory: it waits in the playbook, from Ben, unused', async () => {
    const s = await ready();
    model = new StepModel([() => toolCall('save_memory', { text: 'Always deload every 5th week', quote: 'remember to always deload every 5th week' }), () => replyWith('Put that in your playbook.')]);
    // CM9's own sentence opens the memory tool (review coach-tools r3 S2).
    const r = await ask(s, 'Remember to always deload every 5th week');
    expect(r.cards[0]?.record).toMatchObject({ status: 'committed', detail: { kind: 'add_playbook_candidate', text: 'Always deload every 5th week' } });
    expect(await s.coach.memories()).toMatchObject({ saved: [], waiting: [] });
    expect((await s.coach.playbookRules()).toReview).toMatchObject([{ text: 'Always deload every 5th week', line: 'From you · not graded' }]);
    model = new StepModel([() => replyWith('Hi.')]);
    await ask(s, 'Hello');
    expect(yourData(model.requests[0]).memories).toEqual([]);
    expect(knowledge(model.requests[0])).not.toContain('deload every 5th week');
  });

  it('a schedule constraint is an ordinary suggestion: Save, no rule line (r2 S2)', async () => {
    const s = await ready();
    model = new StepModel([() => toolCall('suggest_memory', { text: 'Keep sessions under 45 minutes on weekdays', quote: 'weekdays I only have 45 minutes' }), () => replyWith('Ok.')]);
    const r = await ask(s, 'Weekdays I only have 45 minutes');
    expect(r.cards[0]?.record).toMatchObject({ status: 'proposed', detail: { kind: 'suggest_memory' } });
    const card = threadRows((await s.coach.loadThread(r.threadId)) ?? (null as never)).find((x) => x.kind === 'card');
    expect(card?.kind === 'card' ? card.card : null).toMatchObject({ text: 'Save to memory? “Keep sessions under 45 minutes on weekdays”', memoryChoice: { split: false } });
  });

  it('unclear words offer both; Add to playbook closes the suggestion and adds a candidate (double tap is one write)', async () => {
    const s = await ready();
    model = new StepModel([() => toolCall('suggest_memory', { text: 'Use straps for deadlifts', quote: 'straps help my grip' }), () => replyWith('Ok.')]);
    const r = await ask(s, 'Straps help my grip on deadlifts');
    const memoryId = r.cards[0]?.record.detail.kind === 'suggest_memory' ? r.cards[0].record.detail.memoryId : '';
    const cardOf = async () => {
      const row = threadRows((await s.coach.loadThread(r.threadId)) ?? (null as never)).find((x) => x.kind === 'card');
      return row?.kind === 'card' ? row.card : null;
    };
    expect(await cardOf()).toMatchObject({ status: { word: 'Suggested' }, text: 'Memory or playbook? “Use straps for deadlifts”', memoryChoice: { memoryId, version: 1, split: true } });

    const first = await s.coach.memoryToPlaybook(memoryId, 1, h.ids());
    expect(first).toMatchObject({ ok: true, record: { author: 'ben', detail: { kind: 'add_playbook_candidate' } } });
    expect(await s.coach.memoryToPlaybook(memoryId, 1, h.ids())).toMatchObject({ ok: true, record: null });
    expect((await s.coach.playbookRules()).toReview).toMatchObject([{ text: 'Use straps for deadlifts', line: 'From the coach · not graded' }]);
    expect(await s.coach.memories()).toMatchObject({ saved: [], waiting: [] });
    expect(await cardOf()).toMatchObject({ status: { word: 'Saved' }, text: 'Playbook, to review: “Use straps for deadlifts”' });
    // A stale card can't save it as a memory afterwards (rule 5).
    expect(await s.coach.decideMemory(memoryId, 1, 'save')).toMatchObject({ status: 'stale' });
  });

  it('unclear words from Ben\'s "remember …" wait for his choice; Save as a memory about me wins', async () => {
    const s = await ready();
    model = new StepModel([() => toolCall('save_memory', { text: 'Avoid lunges', quote: 'remember to avoid lunges' }), () => replyWith('Ok.')]);
    const r = await ask(s, 'Remember: avoid lunges');
    expect(r.cards[0]?.record).toMatchObject({ status: 'proposed', detail: { kind: 'suggest_memory', text: 'Avoid lunges' } });
    const memoryId = r.cards[0]?.record.detail.kind === 'suggest_memory' ? r.cards[0].record.detail.memoryId : '';
    expect(await s.coach.decideMemory(memoryId, 1, 'save')).toMatchObject({ status: 'written', memory: { status: 'active' } });
    expect((await s.coach.memories()).saved.map((m) => m.text)).toEqual(['Avoid lunges']);
    expect((await s.coach.playbookRules()).toReview).toEqual([]);
    // Chosen Add to playbook instead, the candidate would be Ben's own words.
    model = new StepModel([() => toolCall('save_memory', { text: 'Use straps for deadlifts', quote: 'remember to use straps for deadlifts' }), () => replyWith('Ok.')]);
    const r2 = await ask(s, 'Remember: use straps for deadlifts');
    const id2 = r2.cards[0]?.record.detail.kind === 'suggest_memory' ? r2.cards[0].record.detail.memoryId : '';
    expect(await s.coach.memoryToPlaybook(id2, 1, h.ids())).toMatchObject({ ok: true });
    expect((await s.coach.playbookRules()).toReview).toMatchObject([{ text: 'Use straps for deadlifts', line: 'From you · not graded' }]);
  });
});

describe('Add to playbook: where the card says the words went (review coach-tools r3 N1–N5)', () => {
  const suggest = async (s: AppServices, text: string) => {
    model = new StepModel([() => toolCall('suggest_memory', { text, quote: text }), () => replyWith('Ok.')]);
    const r = await ask(s, text);
    const memoryId = r.cards[0]?.record.detail.kind === 'suggest_memory' ? r.cards[0].record.detail.memoryId : '';
    const cardOf = async () => {
      const row = threadRows((await s.coach.loadThread(r.threadId)) ?? (null as never)).find((x) => x.kind === 'card');
      return row?.kind === 'card' ? row.card : null;
    };
    return { memoryId, cardOf };
  };

  it('Not now reads Not saved even when the same words are in the playbook from elsewhere; approved reads Playbook (N1)', async () => {
    const s = await ready();
    const a = await suggest(s, 'Use straps for deadlifts');
    expect(await s.coach.memoryToPlaybook(a.memoryId, 1, h.ids())).toMatchObject({ ok: true, rejectedBefore: false });
    const b = await suggest(s, 'Use straps for deadlifts');
    expect(await s.coach.decideMemory(b.memoryId, 1, 'not_now')).toMatchObject({ status: 'written' });
    expect(await b.cardOf()).toMatchObject({ status: { word: 'Not saved' }, text: '“Use straps for deadlifts”' });
    expect(await a.cardOf()).toMatchObject({ status: { word: 'Saved' }, text: 'Playbook, to review: “Use straps for deadlifts”' });
    const [rule] = (await s.coach.playbookRules()).toReview;
    if (rule === undefined) throw new Error('no rule');
    expect(await s.coach.decidePlaybookRule(rule.id, rule.version, 'approve')).toMatchObject({ status: 'written' });
    expect(await a.cardOf()).toMatchObject({ status: { word: 'Saved' }, text: 'Playbook: “Use straps for deadlifts”' });
  });

  it('words Ben rejected before: closed, and the card says Rejected before (N2)', async () => {
    const s = await ready();
    const a = await suggest(s, 'Use straps for deadlifts');
    await s.coach.memoryToPlaybook(a.memoryId, 1, h.ids());
    const [rule] = (await s.coach.playbookRules()).toReview;
    if (rule === undefined) throw new Error('no rule');
    await s.coach.decidePlaybookRule(rule.id, rule.version, 'reject');
    const b = await suggest(s, 'Use straps for deadlifts');
    expect(await s.coach.memoryToPlaybook(b.memoryId, 1, h.ids())).toMatchObject({ ok: true, record: null, rejectedBefore: true });
    expect(await b.cardOf()).toMatchObject({ status: { word: 'Not saved' }, text: 'Rejected before. “Use straps for deadlifts”' });
  });

  it('a second tap that lost the race reads ok, not Out of date (N4)', async () => {
    const s = await ready();
    const a = await suggest(s, 'Use straps for deadlifts');
    const [one, two] = await Promise.all([s.coach.memoryToPlaybook(a.memoryId, 1, h.ids()), s.coach.memoryToPlaybook(a.memoryId, 1, h.ids())]);
    expect(one).toMatchObject({ ok: true });
    expect(two).toMatchObject({ ok: true });
    expect((await s.coach.playbookRules()).toReview).toHaveLength(1);
  });

  it('force-closed between the candidate and the close: Save finishes the playbook choice instead of a second home (N3)', async () => {
    const s = await ready();
    const a = await suggest(s, 'Use straps for deadlifts');
    await s.coach.memoryToPlaybook(a.memoryId, 1, h.ids());
    await h.forceClose();
    // The close never reached the disk: put the memory back as it was before it.
    const file = readdirSync(h.dir).find((n) => /^training-\d+\.db$/.test(n)) ?? '';
    const raw = new DatabaseSync(join(h.dir, file));
    const row = raw.prepare('SELECT data FROM memories WHERE id = ?').get(a.memoryId) as { data: string };
    const before: Record<string, unknown> = { ...(JSON.parse(row.data) as Record<string, unknown>), status: 'suggested', version: 1 };
    delete before.closedAs;
    raw.prepare("UPDATE memories SET status = 'suggested', version = 1, data = ? WHERE id = ?").run(JSON.stringify(before), a.memoryId);
    raw.close();
    const { services: again } = await h.launch();
    expect(await again.coach.decideMemory(a.memoryId, 1, 'save')).toMatchObject({ status: 'stale', memory: { status: 'not_saved', closedAs: 'playbook' } });
    expect(await again.coach.memories()).toMatchObject({ saved: [], waiting: [] });
    expect((await again.coach.playbookRules()).toReview).toHaveLength(1);
  });

  it('the Memory screen offers the same split as the chat card for words that could be a rule (N5)', async () => {
    const s = await ready();
    await suggest(s, 'Use straps for deadlifts');
    await suggest(s, 'Trains before work');
    const view = memoryScreenView(await s.coach.memories(), 'Europe/London');
    expect(view.waiting.map((m) => [m.text, m.split])).toEqual(
      expect.arrayContaining([
        ['Use straps for deadlifts', true],
        ['Trains before work', false],
      ]),
    );
  });
});

describe('Memory screen: add, edit, forget with Undo', () => {
  it('add saves at once (the same words are one memory); edit keeps the earlier words; forget has Undo', async () => {
    const s = await ready();
    const added = await s.coach.addMemory('  Home dumbbells stop at 24 kg  ', 'add-1');
    if (!added.ok) throw new Error('not added');
    expect(added.record).toMatchObject({ author: 'ben', turnId: null, detail: { kind: 'save_memory', text: 'Home dumbbells stop at 24 kg' } });
    expect(await s.coach.addMemory('home dumbbells stop at 24 kg', 'add-2')).toMatchObject({ ok: true, duplicate: true });
    expect(await s.coach.addMemory('   ', 'add-3')).toEqual({ ok: false });
    let view = memoryScreenView(await s.coach.memories(), 'Europe/London');
    expect(view.saved).toMatchObject([{ text: 'Home dumbbells stop at 24 kg', line: 'You · Thu 1 Oct', version: 1 }]);

    const row = view.saved[0];
    if (!row) throw new Error('no row');
    expect(await s.coach.editMemory(row.id, row.version, 'Home dumbbells stop at 26 kg')).toMatchObject({ status: 'written', memory: { text: 'Home dumbbells stop at 26 kg', edits: [{ before: 'Home dumbbells stop at 24 kg' }] } });
    // A stale edit (the version Ben saw is old) is refused (rule 5).
    expect(await s.coach.editMemory(row.id, row.version, 'Something else')).toMatchObject({ status: 'stale' });
    view = memoryScreenView(await s.coach.memories(), 'Europe/London');
    expect(view.saved[0]?.line).toBe('You · Thu 1 Oct · edited');

    const saved = view.saved[0];
    if (!saved) throw new Error('no row');
    const forgot = await s.coach.forgetMemory(saved.id, saved.version, 'forget-1');
    if (!forgot.ok) throw new Error('not forgotten');
    expect((await s.coach.memories()).saved).toEqual([]);
    expect((await s.coach.undo(forgot.record.actionId, `undo:${forgot.record.actionId}`)).result.status).toBe('written');
    expect((await s.coach.memories()).saved.map((m) => m.text)).toEqual(['Home dumbbells stop at 26 kg']);
  });
});
