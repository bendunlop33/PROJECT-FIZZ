import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { builderApplyOpId, makeBuilderProposal, NO_NUMBERS } from '@fizz/coach';
import { currentDraftVersion, slotsOf, workingCount } from '@fizz/domain';

import type { BuilderSnapshot, SetupInput } from '../src/builder/builder-service';
import { registerSetupPage, setTodaySetupDay, takePendingSetupFill } from '../src/builder/coach-ports';
import { builderReviewProvider, runReview, type BuilderReview } from '../src/builder/review';
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
    // The code-only facts showed first, then the provider's.
    expect(shown.length).toBe(2);
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

  it('nothing it can read: `Not understood`, nothing applied', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    setTodaySetupDay('push');
    expect(await s.builderCoach.askSetup({ words: 'hello there', opId: 'ask-x', from: 'today' })).toMatchObject({ kind: 'not_understood' });
    expect(takePendingSetupFill()).toBeNull();
  });
});
