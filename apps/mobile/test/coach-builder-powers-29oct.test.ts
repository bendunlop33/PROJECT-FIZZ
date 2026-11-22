import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRequest } from '@fizz/coach';
import { slotsOf, workingCount } from '@fizz/domain';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import { setTodaySetupDay, takePendingSetupFill } from '../src/builder/coach-ports';
import type { CoachEntry } from '../src/coach/coach-service';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * ADR 0039 (Ben, 29 Oct): the builder's powers in every chat. Your workout's bar opens the same thread sheet as
 * Today; a change to the draft before Start, asked from there or from Today, is the builder's own proposal with
 * Apply / Skip (rule 3), and Undo after Apply. Today's words fill Set up through the coach. Real SQLite; one scripted
 * model answers both the main coach and the builder's edit coach (the same port, as on the phone).
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-20T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
  setTodaySetupDay(null);
  takePendingSetupFill();
});

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};

async function pushDraft(s: AppServices): Promise<BuilderSnapshot> {
  await setUpGym(h, s);
  return ok(await s.builder.create({ ...(await s.builder.initialSetup({ dayId: 'push' })) }, 'create-1')).snapshot;
}

const say = (s: AppServices, text: string, entry: CoachEntry) => s.coach.send({ entry, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
const toolsOf = (req: ModelRequest | undefined) => (req?.tools ?? []).map((t) => t.name);
const working = (snap: BuilderSnapshot | null, slotKey: string) => {
  const slot = slotsOf(snap?.workout.blocks ?? []).find((x) => x.key === slotKey);
  return slot === undefined ? null : workingCount(slot);
};

describe('Your workout before Start, from any chat (ADR 0039)', () => {
  it('from Your workout’s bar: the main coach hands Ben’s words to the builder’s edit coach; a proposal with Apply / Skip; Apply, then Undo', async () => {
    const { services: s } = await h.launch();
    const snap = await pushDraft(s);
    const first = slotsOf(snap.workout.blocks)[0];
    if (first === undefined) throw new Error('no slot');
    const before = working(snap, first.key) ?? 0;
    model = new StepModel([
      // The main coach: the draft is in context and the tool is offered.
      (req) => {
        const data = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
        const draft = data?.type === 'message' ? (JSON.parse(data.content.slice(data.content.indexOf('\n') + 1)) as { builderDraft?: { exercises: string[] } }).builderDraft : undefined;
        expect(draft?.exercises.length).toBeGreaterThan(0);
        return toolCall('propose_workout_edit', { reason: 'Ben asked for one more set.' });
      },
      // The builder's edit coach, on Ben's words.
      () => toolCall('propose_workout_edit', { ops: [{ op: 'sets', slotKey: first.key, workingSets: before + 1 }], reply: 'One more set.' }),
      () => replyWith('There it is.'),
    ]);
    const r = await say(s, `add a set to the first exercise`, { kind: 'builder', draftId: snap.draftId, name: snap.name });
    expect(toolsOf(model.requests[0])).toContain('propose_workout_edit');
    expect(model.requests[0]?.instructions).toContain('call propose_workout_edit');
    const card = r.cards.find((c) => c.record.detail.kind === 'propose_workout_edit')?.record;
    expect(card?.status).toBe('proposed');
    // Nothing changed until Apply (rule 3).
    expect(working(await s.builder.read(snap.draftId), first.key)).toBe(before);
    expect(await s.coach.draftEditCard(card?.actionId ?? '')).toEqual({ kind: 'open' });
    expect(await s.coach.applyDraftEdit(card?.actionId ?? '')).toEqual({ ok: true });
    expect(working(await s.builder.read(snap.draftId), first.key)).toBe(before + 1);
    // A double tap writes once.
    expect(await s.coach.applyDraftEdit(card?.actionId ?? '')).toEqual({ ok: true });
    expect(working(await s.builder.read(snap.draftId), first.key)).toBe(before + 1);
    expect(await s.coach.draftEditCard(card?.actionId ?? '')).toEqual({ kind: 'applied' });
    expect(await s.coach.undoDraftEdit(card?.actionId ?? '', h.ids())).toBe(true);
    expect(working(await s.builder.read(snap.draftId), first.key)).toBe(before);
  });

  it('from Today’s chat, the same draft (today’s) gets the same tool, and it is still a proposal', async () => {
    const { services: s } = await h.launch();
    const snap = await pushDraft(s);
    const first = slotsOf(snap.workout.blocks)[0];
    if (first === undefined) throw new Error('no slot');
    const tools: string[][] = [];
    for (const entry of [{ kind: 'today' }, { kind: 'builder', draftId: snap.draftId, name: snap.name }, { kind: 'progress', period: '1m' }] as CoachEntry[]) {
      model = new StepModel([
        (req) => {
          tools.push(toolsOf(req).filter((n) => n !== 'think_harder').sort());
          return replyWith('ok');
        },
      ]);
      await say(s, 'how does today look?', entry);
    }
    expect(tools[0]).toContain('propose_workout_edit');
    expect(tools[1]).toEqual(tools[0]);
    expect(tools[2]).toEqual(tools[0]);
    model = new StepModel([() => toolCall('propose_workout_edit', { reason: 'Asked.' }), () => toolCall('propose_workout_edit', { ops: [{ op: 'sets', slotKey: first.key, workingSets: 5 }], reply: 'Five sets.' }), () => replyWith('Apply it if you like it.')]);
    const r = await say(s, 'make the first exercise 5 sets', { kind: 'today' });
    expect(r.cards.find((c) => c.record.detail.kind === 'propose_workout_edit')?.record.status).toBe('proposed');
  });

  it('the coach can’t run a draft change or a Set up fill without Ben’s words (an accepted chip, say): nothing runs', async () => {
    const { services: s } = await h.launch();
    await pushDraft(s);
    model = new StepModel([() => toolCall('fill_setup', { reason: 'x' }), () => replyWith('ok')]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'chip', chip: 'too_easy' }, turnId: h.ids() });
    expect(r.cards.filter((c) => c.record.detail.kind === 'fill_setup')).toEqual([]);
  });

  it('Today’s words naming a day and a length fill Set up through the coach (Set up opens filled)', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    setTodaySetupDay('push');
    model = new StepModel([() => toolCall('fill_setup', { reason: 'Ben named a day and a length.' }), () => toolCall('fill_setup', { dayId: 'legs', minutes: 45, mainLiftCatalogueId: null, supersets: null, groups: null, reply: null }), () => replyWith('Set up is ready.')]);
    const r = await say(s, 'legs, 45 min', { kind: 'today' });
    expect(toolsOf(model.requests[0])).toContain('fill_setup');
    const card = r.cards.find((c) => c.record.detail.kind === 'fill_setup')?.record;
    expect(card?.status).toBe('committed');
    expect(takePendingSetupFill()?.setup).toMatchObject({ dayId: 'legs', minutes: 45 });
  });
});
