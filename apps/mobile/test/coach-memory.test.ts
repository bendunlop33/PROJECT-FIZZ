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
