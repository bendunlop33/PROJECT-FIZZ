import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRequest } from '@fizz/coach';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Backlog §4.3 item 5 (coaching-playbook §2.1, §3.1, §4.1; B8): general
 * rules from chat wait in the Playbook's `To review`; Ben approves or rejects
 * them there (with Undo). Only approved rules reach the coach, as Coaching
 * knowledge, never as a memory (CM9, rule 10). Local; no AI for the review.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

function block(req: ModelRequest | undefined, label: string): string {
  const b = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith(label));
  return b?.type === 'message' ? b.content : '';
}

async function ready(): Promise<AppServices> {
  const { services: s } = await h.launch();
  await setUpGym(h, s);
  return s;
}

const ask = (s: AppServices, text: string) => s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

async function hello(s: AppServices): Promise<ModelRequest | undefined> {
  model = new StepModel([() => replyWith('Hi.')]);
  await ask(s, 'Hello');
  return model.requests[0];
}

describe('Playbook: chat rules to review', () => {
  it('a rule from chat waits; Approve sends it to the coach as Coaching knowledge (not graded); Undo takes it back to review', async () => {
    const s = await ready();
    model = new StepModel([() => toolCall('add_playbook_candidate', { text: 'Deload every fifth week', statedBy: 'ben', quote: 'Add a rule: deload every fifth week' }), () => replyWith('Added for review.')]);
    const r = await ask(s, 'Add a rule: deload every fifth week');
    expect(r.cards[0]?.record).toMatchObject({ status: 'committed', detail: { kind: 'add_playbook_candidate' } });
    let list = await s.coach.playbookRules();
    expect(list.toReview).toMatchObject([{ label: 'Chat rule 1', text: 'Deload every fifth week', line: 'From you · not graded', version: 1 }]);
    // To review: never sent.
    expect(block(await hello(s), 'COACHING KNOWLEDGE')).not.toContain('Deload every fifth week');

    const row = list.toReview[0];
    if (!row) throw new Error('no rule');
    const approved = await s.coach.decidePlaybookRule(row.id, row.version, 'approve');
    expect(approved).toMatchObject({ status: 'written', candidate: { status: 'approved', version: 2 } });
    // A double tap is one write; a stale version is refused (rule 5).
    expect(await s.coach.decidePlaybookRule(row.id, row.version, 'approve')).toMatchObject({ status: 'written', candidate: { version: 2 } });
    expect(await s.coach.decidePlaybookRule(row.id, row.version, 'reject')).toMatchObject({ status: 'stale' });
    list = await s.coach.playbookRules();
    expect(list.approved.map((x) => x.text)).toEqual(['Deload every fifth week']);

    const req = await hello(s);
    expect(block(req, 'COACHING KNOWLEDGE')).toContain('"approvedChatRules":[{"id":"Chat rule 1","rule":"Deload every fifth week","from":"Ben","grade":"not evidence-graded"');
    expect(block(req, 'YOUR DATA')).not.toContain('Deload');
    expect((await s.coach.memories()).saved).toEqual([]);
    expect((await s.coach.describe({ kind: 'today' }, null)).coachingKnowledge.map((d) => d.label)).toContain('Rules you approved');

    // The toast's Undo (and Remove) put it back to review: not sent any more.
    expect(await s.coach.decidePlaybookRule(row.id, 2, 'reopen')).toMatchObject({ status: 'written', candidate: { status: 'to_review', version: 3 } });
    expect(block(await hello(s), 'COACHING KNOWLEDGE')).not.toContain('Deload every fifth week');
  });

  it('a rejected rule is never sent and isn’t offered again in the same words; Review again brings it back', async () => {
    const s = await ready();
    model = new StepModel([() => toolCall('add_playbook_candidate', { text: 'Always train to failure', statedBy: 'ben', quote: 'Add a rule: always train to failure' }), () => replyWith('Added.')]);
    await ask(s, 'Add a rule: always train to failure');
    const row = (await s.coach.playbookRules()).toReview[0];
    if (!row) throw new Error('no rule');
    expect(await s.coach.decidePlaybookRule(row.id, row.version, 'reject')).toMatchObject({ status: 'written', candidate: { status: 'rejected' } });
    expect(block(await hello(s), 'COACHING KNOWLEDGE')).not.toContain('failure');

    model = new StepModel([() => toolCall('add_playbook_candidate', { text: 'always train to failure.', statedBy: 'ben', quote: 'Add a rule: always train to failure' }), () => replyWith('Ok.')]);
    const again = await ask(s, 'Add a rule: always train to failure');
    expect(again.cards[0]?.record).toMatchObject({ status: 'rejected', failure: 'it was already reviewed' });
    expect((await s.coach.playbookRules()).rejected).toHaveLength(1);

    expect(await s.coach.decidePlaybookRule(row.id, row.version + 1, 'reopen')).toMatchObject({ status: 'written', candidate: { status: 'to_review' } });
    expect((await s.coach.playbookRules()).toReview.map((x) => x.text)).toEqual(['Always train to failure']);
  });

  it('a personal fact is never a playbook rule; a memory request opens no playbook tool (CM9, rule 10)', async () => {
    const s = await ready();
    model = new StepModel([() => replyWith('Ok.')]);
    await ask(s, 'remember that my left knee is dodgy on lunges');
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('add_playbook_candidate');
    expect((await s.coach.playbookRules()).toReview).toEqual([]);
  });
});
