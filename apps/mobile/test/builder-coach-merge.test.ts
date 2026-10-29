import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { builderApplyOpId, makeBuilderProposal, NO_NUMBERS, type BuilderProposal } from '@fizz/coach';
import { currentDraftVersion, slotsOf, workingCount } from '@fizz/domain';

import type { BuilderSnapshot, SetupInput } from '../src/builder/builder-service';
import { registerSetupPage, setTodaySetupDay, takePendingSetupFill } from '../src/builder/coach-ports';
import { builderReviewProvider, runReview, type BuilderReview } from '../src/builder/review';
import { ASK_BAR_ASKING, askBarView, EDIT_ASK_COPY, editAskView, proposalCardView, replyCardView } from '../src/coach/builder-coach-view';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * The builder coach wired to the builder at the merge (workout-builder-v3 §2.6, §2.9, §5): the review provider
 * registered at app start, coach applies written through the builder (origin `builder`, the codec, a new
 * version, `rev` bumped only on the slots it changed, Undo, one write per op ID, Out of date after Ben's edit),
 * and Set up words filling Set up (on the page, or from Today with Set up opening filled). No coach in this
 * build here: everything runs on code's paths (rule 1); the plan route itself is proven only on the iPhone.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-20T16:00:00.000Z');
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
const pushSetup = async (s: AppServices, over: Partial<SetupInput> = {}): Promise<SetupInput> => ({ ...(await s.builder.initialSetup({ dayId: 'push' })), ...over });

async function pushDraft(s: AppServices): Promise<BuilderSnapshot> {
  await setUpGym(h, s);
  return ok(await s.builder.create(await pushSetup(s), 'create-1')).snapshot;
}

describe('Coach review provider (registered at app start)', () => {
  it('with no coach: code’s counts per muscle focus and the honest status, no verdict, suggestions or notes', async () => {
    const { services: s } = await h.launch();
    const snap = await pushDraft(s);
    const provider = builderReviewProvider();
    expect(provider).not.toBeNull();
    const shown: BuilderReview[] = [];
    const out = await runReview(snap, 'not_connected', provider, (r) => shown.push(r));
    expect(out.status).toBe('not_connected');
    expect(out.verdict).toBeNull();
    expect(out.suggestions).toEqual([]);
    expect(out.nextNotes).toEqual([]);
    // Counts come from the coach service's code facts, per focus heading (§2.9 `Upper chest 3`; SP3: main muscle
    // full credit, others half), so no one count exceeds the workout's working sets.
    expect(out.counts.length).toBeGreaterThan(0);
    expect(out.counts.every((c) => c.trained === c.sets > 0)).toBe(true);
    const total = slotsOf(snap.workout.blocks).reduce((n, x) => n + workingCount(x), 0);
    expect(out.counts.every((c) => c.sets <= total)).toBe(true);
    // The status first with no numbers, then the provider's: one counting rule, never changing under Ben (wiring S2).
    expect(shown.length).toBe(2);
    expect(shown[0]?.counts).toEqual([]);
    expect(shown[1]?.counts).toEqual(out.counts);
  });
});

describe('Coach applies through the builder', () => {
  it('a new builder version, codec and revs; one write per op ID; Undo restores; Out of date after Ben edits that slot', async () => {
    const { services: s } = await h.launch();
    const snap = await pushDraft(s);
    const world = await s.builder.coachWorld(snap.draftId);
    if (world === null) throw new Error('no world');
    const acc = slotsOf(world.snapshot.workout.blocks).find((x) => !x.main);
    if (acc === undefined) throw new Error('no accessory');
    const env = { ...world.env, askedHeavier: false };
    const made = makeBuilderProposal({ id: 'prop-1', snapshot: world.snapshot, ops: [{ op: 'sets', slotKey: acc.key, workingSets: workingCount(acc) + 1 }], words: null, check: NO_NUMBERS, env });
    if (made.proposal === null) throw new Error(made.reason ?? 'no proposal');
    const before = await s.coachDrafts.get(snap.draftId);
    expect(await s.builderCoach.apply(made.proposal)).toMatchObject({ kind: 'applied' });
    const after = await s.coachDrafts.get(snap.draftId);
    if (before === null || after === null) throw new Error('draft gone');
    const v = currentDraftVersion(after);
    expect(v.request.origin).toBe('builder');
    expect(after.currentVersion).toBe(before.currentVersion + 1);
    const revBefore = new Map(currentDraftVersion(before).plan.slots.map((x) => [x.slotKey, x.rev ?? 1]));
    for (const x of v.plan.slots) {
      expect(x.builder).toBeDefined();
      expect(x.rev ?? 1).toBe(x.slotKey === acc.key ? (revBefore.get(x.slotKey) ?? 1) + 1 : (revBefore.get(x.slotKey) ?? 1));
    }
    const read = await s.builder.read(snap.draftId);
    expect(workingCount(slotsOf(read?.workout.blocks ?? []).find((x) => x.key === acc.key) ?? acc)).toBe(workingCount(acc) + 1);
    // A double tap: already written, nothing more.
    expect(await s.builderCoach.apply(made.proposal)).toMatchObject({ kind: 'applied' });
    expect((await s.coachDrafts.get(snap.draftId))?.version).toBe(after.version);
    // `Applied · Undo` (the builder's own Undo under the apply's op ID).
    const u = await s.builder.undo(snap.draftId, builderApplyOpId('prop-1'), 'undo-prop-1');
    expect(u.status).toBe('written');
    expect(workingCount(slotsOf(u.snapshot?.workout.blocks ?? []).find((x) => x.key === acc.key) ?? acc)).toBe(workingCount(acc));

    // Ben edits that slot; a proposal made before it reads Out of date and changes nothing.
    const w2 = await s.builder.coachWorld(snap.draftId);
    if (w2 === null) throw new Error('no world');
    const p2 = makeBuilderProposal({ id: 'prop-2', snapshot: w2.snapshot, ops: [{ op: 'sets', slotKey: acc.key, workingSets: workingCount(acc) + 1 }], words: null, check: NO_NUMBERS, env: { ...w2.env, askedHeavier: false } }).proposal;
    if (p2 === null) throw new Error('no proposal');
    const cur = await s.builder.read(snap.draftId);
    ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: acc.key }, { opId: 'ben-add', basis: { version: cur?.version ?? 0 } }));
    const kept = await s.coachDrafts.get(snap.draftId);
    expect(await s.builderCoach.apply(p2)).toMatchObject({ kind: 'out_of_date' });
    expect((await s.coachDrafts.get(snap.draftId))?.version).toBe(kept?.version);
  });
});

describe('Set up words (offline: code reads them, no coach bubble)', () => {
  it('on Set up: the open page’s rows fill at once, with what Undo puts back', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    let rows: SetupInput | null = await pushSetup(s);
    const applied: { next: SetupInput; toast: string; undo: SetupInput }[] = [];
    const off = registerSetupPage({
      current: () => rows,
      apply: (next, toast, undo) => {
        applied.push({ next, toast, undo });
        rows = next;
      },
    });
    try {
      const r = await s.builderCoach.askSetup({ words: 'pull, 50 minutes, no supersets', opId: 'ask-1', from: 'setup' });
      expect(r).toMatchObject({ kind: 'filled', by: 'code' });
      expect(applied).toHaveLength(1);
      expect(applied[0]?.next).toMatchObject({ dayId: 'pull', minutes: 50, supersets: false });
      expect(applied[0]?.undo.dayId).toBe('push');
      // The same ask again: written once.
      await s.builderCoach.askSetup({ words: 'pull, 50 minutes, no supersets', opId: 'ask-1', from: 'setup' });
      expect(applied).toHaveLength(1);
    } finally {
      off();
    }
  });

  it('from Today: Set up opens filled (the fill waits for it once); nothing is written to the plan or drafts', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    setTodaySetupDay('push');
    const drafts = await s.coachDrafts.list();
    const r = await s.builderCoach.askSetup({ words: 'legs, 45 min', opId: 'ask-today', from: 'today' });
    expect(r).toMatchObject({ kind: 'filled', by: 'code' });
    const pending = takePendingSetupFill();
    expect(pending?.setup).toMatchObject({ dayId: 'legs', minutes: 45 });
    expect(pending?.undo.dayId).toBe('push');
    expect(takePendingSetupFill()).toBeNull();
    expect(await s.coachDrafts.list()).toEqual(drafts);
  });

  it('from Today on an Other session: the words keep Full body (a custom day with its groups), never the split’s first day (wiring B1)', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    setTodaySetupDay('full_body');
    const r = await s.builderCoach.askSetup({ words: 'make it 45 min', opId: 'ask-fb', from: 'today' });
    expect(r).toMatchObject({ kind: 'filled' });
    const pending = takePendingSetupFill();
    expect(pending?.setup).toMatchObject({ dayName: 'Full body', minutes: 45 });
    expect(pending?.setup.groups.map((g) => g.group)).toEqual(['Legs', 'Back', 'Chest', 'Core']);
  });

  it('nothing it can read: `Not understood`, nothing applied', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    setTodaySetupDay('push');
    expect(await s.builderCoach.askSetup({ words: 'hello there', opId: 'ask-x', from: 'today' })).toMatchObject({ kind: 'not_understood' });
    expect(takePendingSetupFill()).toBeNull();
  });
});

describe('Today’s bar: where the words go (Ben, 29 Oct: the coach sheet, at once)', () => {
  it('(Ben, 29 Oct: "The mic listens but doesn\'t do anything") the screen: words open the coach sheet at once, sent as his message; no model call before it, no promise dropped silently', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'screens', 'TodayScreen.tsx'), 'utf8');
    const ask = src.slice(src.indexOf('function askToday'), src.indexOf('async function onOffer'));
    expect(ask).toContain('todayAskParams(words, spoken, newUuid())');
    expect(ask).not.toContain('askSetup(');
    expect(ask).not.toContain('await ');
    expect(ask).not.toContain('setToast');
    expect(src).not.toContain('void askToday(');
  });
});

describe('Your workout’s bar (§2.6): words to the coach, a proposal with Apply / Skip', () => {
  it('with no coach: unavailable, the bar shows the word, nothing is written', async () => {
    const { services: s } = await h.launch();
    const snap = await pushDraft(s);
    const before = await s.coachDrafts.get(snap.draftId);
    const r = await s.builderCoach.askEdit({ draftId: snap.draftId, words: 'swap the fly for incline press', opId: 'ask-1' });
    expect(r.kind).toBe('unavailable');
    const v = editAskView(r);
    expect(v.kind).toBe('reach');
    expect((await s.coachDrafts.get(snap.draftId))?.version).toBe(before?.version);
  });

  it('editAskView: proposal → sheet; the coach’s words or code’s note → the sheet with no actions (never a timed toast); failed → No answer; gone → reload', () => {
    const proposal = { id: 'p', draftId: 'd', baseVersion: 1, ops: [], lines: ['Cable fly → Incline barbell press'], warnings: [], notes: [], preconditions: [], estimate: 50, reason: null } as unknown as BuilderProposal;
    expect(editAskView({ kind: 'proposal', proposal, status: 'ok' })).toEqual({ kind: 'proposal', proposal });
    expect(editAskView({ kind: 'reply', text: 'Bench is already first.', notes: [], status: 'ok' })).toEqual({ kind: 'reply', text: 'Bench is already first.' });
    expect(editAskView({ kind: 'reply', text: null, notes: ['Not more: shoulder'], status: 'ok' })).toEqual({ kind: 'reply', text: 'Not more: shoulder' });
    expect(replyCardView('Bench is already first.')).toMatchObject({ lines: [], reason: 'Bench is already first.', actions: null, undo: false });
    expect(editAskView({ kind: 'reply', text: null, notes: [], status: 'ok' })).toEqual({ kind: 'none' });
    expect(editAskView({ kind: 'unavailable', status: 'offline' })).toEqual({ kind: 'reach', reach: 'offline' });
    expect(editAskView({ kind: 'unavailable', status: 'not_connected' })).toEqual({ kind: 'reach', reach: 'not_connected' });
    expect(editAskView({ kind: 'unavailable', status: 'failed' })).toEqual({ kind: 'toast', text: EDIT_ASK_COPY.noAnswer });
    expect(editAskView({ kind: 'gone' })).toEqual({ kind: 'gone' });
    // The sheet: Apply / Skip while open; Out of date has no Apply (rule 5).
    expect(proposalCardView(proposal, 'open').actions).toEqual({ apply: 'Apply', skip: 'Skip' });
    expect(proposalCardView(proposal, 'out_of_date')).toMatchObject({ actions: null, state: 'Out of date. Ask again.' });
  });

  it('askBarView while asking: `Asking…` and disabled, on every page (one request at a time; wiring S3)', () => {
    for (const page of ['workout', 'setup', 'today'] as const) {
      expect(askBarView(page, 'ok', 'idle', { asking: true })).toMatchObject({ status: ASK_BAR_ASKING, disabled: true });
      expect(askBarView(page, 'ok', 'idle').status).toBeNull();
    }
  });

  it('the screen: shared CoachAskBar on Your workout; askEdit, Apply through the builder coach, Undo under the apply op ID', () => {
    const ws = readFileSync(join(__dirname, '..', 'src', 'screens', 'builder', 'BuilderWorkoutScreen.tsx'), 'utf8');
    expect(ws).toContain('<CoachAskBar');
    expect(ws).toContain('page="workout"');
    expect(ws).toContain('services.builderCoach.askEdit(');
    expect(ws).toContain('services.builderCoach.apply(p.proposal)');
    expect(ws).toContain('undoOpId: builderApplyOpId(p.proposal.id)');
    expect(ws).toContain('<ProposalSheet');
    // The bar never opens the general coach thread: typing opens the sheet's `builder` entry (Ben, 26 Oct, option a).
    expect(ws).not.toContain("entry: { kind: 'today' }");
    expect(ws).toContain("navigate('Coach', { entry: { kind: 'builder'");
    // One request at a time with `Asking…` on the bar; a reply stays in the sheet (wiring S3).
    expect(ws).toContain('askingRef.current) return;');
    expect(ws).toContain('asking={asking}');
    expect(ws).toContain('replyCardView(reply)');
    // The review sheet's status is the bar's reach (one source; wiring S2).
    expect(ws).toContain('runReview(snap, reach,');
    expect(ws).not.toContain('services.coach.availability()');
  });
});
