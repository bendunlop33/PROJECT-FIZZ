import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reviewEdits, type ModelEvent, type ModelRequest } from '@fizz/coach';
import { slotsOf, workingCount } from '@fizz/domain';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import { builderReviewProvider, runReview, type BuilderReview } from '../src/builder/review';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Coach review judges the numbers and Ben's own edits (Ben, 23 Oct; workout-builder-v3 §2.9), on real SQLite with a
 * scripted model: Ben raises his main lift's top set and adds a set; a force-close; Coach review is given code's diff
 * of his edits and per-exercise facts from his history; the coach comments on his edits with an offer; Apply writes it
 * (version-fenced, rounded on this gym's bar), the drafted baseline takes the coach's change so it no longer reads as
 * his; Undo puts it back; an offer made before Ben edits that exercise again is refused as out of date.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-09-10T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${'message' in r ? String(r.message) : ''}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};
const mainOf = (snap: BuilderSnapshot) => {
  const m = slotsOf(snap.workout.blocks).find((x) => x.main);
  if (m === undefined) throw new Error('no main lift');
  return m;
};
const topOf = (snap: BuilderSnapshot | null) => (snap === null ? null : (mainOf(snap).rows.find((r) => r.type === 'top')?.load ?? null));

/** The `YOUR DATA` block of a request, parsed. */
function yourData(req: ModelRequest): { workout: { slots: { slotKey: string; exercise: string; main: boolean }[] }; yourEdits: { editId: string; change: string; by: string }[] | null; lifts: { slotKey: string; exercise: string; facts: string[] }[]; focus: string | null } {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as ReturnType<typeof yourData>;
}

/**
 * The scripted coach: on Ben's raised top set, a comment quoting code's percentage fact and an offer of one step
 * above what was drafted (`value` unrounded: code rounds it down); his added set is fine (no offer).
 */
const reviewStep = (offerKg: number) => (req: ModelRequest): ModelEvent[] => {
  const d = yourData(req);
  const main = d.workout.slots.find((x) => x.main);
  const load = d.yourEdits?.find((e) => / top [\d.]+ → [\d.]+ kg$/.test(e.change));
  const sets = d.yourEdits?.find((e) => / sets$/.test(e.change));
  const fact = d.lifts.find((l) => l.slotKey === main?.slotKey)?.facts.map((f) => /^([\d.]+ kg) today is (\d+)% above his best recent load for (\d+) reps$/.exec(f)).find((m) => m !== null);
  const comment = fact == null ? 'Heavy.' : `${main?.exercise ?? ''} at ${fact[1] ?? ''} is ${fact[2] ?? ''}% above his best recent load for ${fact[3] ?? ''} reps.`;
  return toolCall('review_workout', {
    verdict: 'Solid, top set heavy',
    editComments: [
      ...(load === undefined || main === undefined ? [] : [{ editId: load.editId, comment, ops: [{ op: 'load', slotKey: main.slotKey, direction: null, value: offerKg, unit: 'kg' }] }]),
      ...(sets === undefined ? [] : [{ editId: sets.editId, comment: 'Fine.', ops: [] }]),
    ],
    suggestions: [],
    nextNotes: [],
  });
};

/** Rows 100 × 6 @ 8 four days ago, then Pull with barbell row as the main lift. */
async function buildPull(s: AppServices, gymId: string): Promise<BuilderSnapshot> {
  await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] }]);
  h.clockMs += 4 * DAY;
  const base = await s.builder.initialSetup({ dayId: 'pull' });
  const row = (await s.builder.setupFacts(base)).mainLifts.find((m) => m.name === 'Barbell row');
  if (row === undefined) throw new Error('no barbell row');
  return ok(await s.builder.create({ ...base, mainLiftExerciseId: row.id }, 'build-pull')).snapshot;
}

async function editsNow(s: AppServices, draftId: string) {
  const w = await s.builder.coachWorld(draftId);
  if (w?.review === undefined) throw new Error('no world');
  return reviewEdits({ drafted: w.review.drafted, workout: w.snapshot.workout, minutes: w.snapshot.minutes, ctx: w.env.ctx, time: w.review.time }) ?? [];
}

describe('Coach review critiques Ben’s own edits (real SQLite, scripted coach)', () => {
  it('edit → force-close → review with his edits and history facts → offer → Apply → Undo; a stale offer is refused', async () => {
    const first = await h.launch();
    const gymId = await setUpGym(h, first.services);
    let snap = await buildPull(first.services, gymId);
    const main = mainOf(snap);
    const t0 = topOf(snap) ?? 0;
    expect(t0).toBeGreaterThan(0);
    const acc = slotsOf(snap.workout.blocks).find((x) => !x.main);
    if (acc === undefined) throw new Error('no accessory');
    const sets0 = workingCount(acc);

    // Ben's own edits: the top set 10 kg heavier (typed), one more set on an accessory.
    const ti = main.rows.findIndex((r) => r.type === 'top');
    snap = ok(await first.services.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: main.key, index: ti, patch: { kind: 'load', value: t0 + 10 } }, { opId: 'ben-heavier', basis: { version: snap.version } })).snapshot;
    snap = ok(await first.services.builder.edit(snap.draftId, { kind: 'add_set', slotKey: acc.key }, { opId: 'ben-add-set', basis: { version: snap.version } })).snapshot;
    const t1 = topOf(snap) ?? 0;
    expect(t1).toBe(t0 + 10);

    // A force-close: the drafted baseline is stored with the draft, so his edits are still known.
    const { services: s } = await h.launch();
    const edits = await editsNow(s, snap.draftId);
    expect(edits.map((e) => [e.kind, e.cause, e.text])).toEqual(
      expect.arrayContaining([
        ['load', 'ben', `Barbell row top ${String(t0)} → ${String(t1)} kg`],
        ['sets', 'ben', expect.stringMatching(new RegExp(` ${String(sets0)} → ${String(sets0 + 1)} sets$`))],
      ]),
    );

    // Coach review: the model is given his edits and code's per-exercise facts.
    model = new StepModel([reviewStep(t0 + 3)]);
    const provider = builderReviewProvider();
    if (provider === null) throw new Error('no provider');
    const shown: BuilderReview[] = [];
    const review = await runReview(snap, 'ok', provider, (r) => shown.push(r));
    expect(review.status).toBe('reviewed');
    const req = model.requests[0];
    if (req === undefined) throw new Error('no request');
    const data = yourData(req);
    expect(data.yourEdits).toEqual(expect.arrayContaining([{ editId: expect.any(String) as string, change: `Barbell row top ${String(t0)} → ${String(t1)} kg`, by: 'Ben' }]));
    const rowFacts = data.lifts.find((l) => l.slotKey === main.key)?.facts ?? [];
    expect(rowFacts[0]).toMatch(/^Last sessions, top set: 100 kg × 6 @ RPE 8 \(/);
    expect(rowFacts).toContain('Best recent load for 6 reps: 100 kg');
    const pct = Math.round(((t1 - 100) / 100) * 100);
    expect(rowFacts).toContain(`${String(t1)} kg today is ${String(pct)}% above his best recent load for 6 reps`);
    expect(rowFacts.some((f) => /^Est\. 1RM [\d.]+ kg \(estimate\)$/.test(f))).toBe(true);

    // The sheet: his edits with the coach's checked comments; the offer rounded down on this gym's bar (rule 4).
    const rowNote = review.edits.find((e) => e.edit.startsWith('Barbell row top'));
    expect(rowNote?.comment).toBe(`Barbell row at ${String(t1)} kg is ${String(pct)}% above his best recent load for 6 reps.`);
    const offered = t0 + 2.5;
    expect(rowNote?.action?.text).toBe(`Barbell row: ${String(t1)} → ${String(offered)} kg`);
    expect(review.edits.find((e) => / sets$/.test(e.edit))).toMatchObject({ comment: 'Fine.', action: null });
    if (rowNote?.action == null) throw new Error('no offer');

    // Apply: a new version at the offered load; the coach's change joins the baseline, his added set still reads as his.
    const applied = await provider.apply(snap.draftId, rowNote.action.id, 'apply-1');
    expect(applied).toMatchObject({ ok: true });
    if (!applied.ok || applied.undoOpId === null) throw new Error('not applied');
    expect(topOf(await s.builder.read(snap.draftId))).toBe(offered);
    const afterApply = await editsNow(s, snap.draftId);
    expect(afterApply.some((e) => e.kind === 'load')).toBe(false);
    expect(afterApply.some((e) => e.kind === 'sets' && e.cause === 'ben')).toBe(true);
    // A double tap writes once.
    const v1 = (await s.builder.read(snap.draftId))?.version;
    expect(await provider.apply(snap.draftId, rowNote.action.id, 'apply-1b')).toMatchObject({ ok: true });
    expect((await s.builder.read(snap.draftId))?.version).toBe(v1);

    // Undo: Ben's 10 kg heavier top is back, and reads as his edit again.
    ok(await s.builder.undo(snap.draftId, applied.undoOpId, 'undo-apply-1'));
    const undone = await s.builder.read(snap.draftId);
    expect(topOf(undone)).toBe(t1);
    expect((await editsNow(s, snap.draftId)).some((e) => e.kind === 'load' && e.after === t1)).toBe(true);

    // A fresh review's offer, then Ben edits that exercise again: Apply is refused as out of date, nothing written.
    if (undone === null) throw new Error('draft gone');
    model = new StepModel([reviewStep(t0 + 3)]);
    const again = await runReview(undone, 'ok', provider, () => undefined);
    const offer2 = again.edits.find((e) => e.edit.startsWith('Barbell row top'))?.action;
    if (offer2 == null) throw new Error('no second offer');
    const mainNow = mainOf(undone);
    const ti2 = mainNow.rows.findIndex((r) => r.type === 'top');
    const edited = ok(await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: main.key, index: ti2, patch: { kind: 'load', value: t0 + 5 } }, { opId: 'ben-again', basis: { version: undone.version } })).snapshot;
    const r = await provider.apply(snap.draftId, offer2.id, 'apply-2');
    expect(r).toEqual({ ok: false, message: 'Out of date. Ask again.' });
    expect((await s.builder.read(snap.draftId))?.version).toBe(edited.version);
    expect(topOf(await s.builder.read(snap.draftId))).toBe(t0 + 5);
  });

  it('not connected: counts still show; no verdict, no comments on his edits (rule 1)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    let snap = await buildPull(s, gymId);
    const main = mainOf(snap);
    const ti = main.rows.findIndex((r) => r.type === 'top');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: main.key, index: ti, patch: { kind: 'load', value: (topOf(snap) ?? 0) + 10 } }, { opId: 'ben-heavier', basis: { version: snap.version } })).snapshot;
    model = new StepModel([]);
    const provider = builderReviewProvider();
    // The connection fails for this call: the model port answers `unavailable` (not connected).
    const out = await runReview(snap, 'not_connected', provider, () => undefined);
    expect(out.status).toBe('not_connected');
    expect(out.verdict).toBeNull();
    expect(out.edits).toEqual([]);
    expect(out.counts.length).toBeGreaterThan(0);
  });
});
