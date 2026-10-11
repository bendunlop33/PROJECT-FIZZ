import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { loadCell, NBSP, type OverviewRow } from '@fizz/domain';
import type { TextCoachState } from '@fizz/providers';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { OverviewData } from '../src/services/workout-services';
import { startFromOverview } from '../src/workout/overview-start';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Today's edits on the Workout overview through the app services on real
 * SQLite (overview-today-edits.md §7): the saved pre-start draft survives a
 * relaunch and expires at local midnight, every write is versioned and
 * idempotent, Swap respects this gym's equipment and pain flags, what the
 * page shows is what Start creates, every edit has an Undo, and nothing here
 * calls the coach.
 */

class NeverModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  // eslint-disable-next-line require-yield
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    await Promise.resolve();
    throw new Error('the overview never calls the coach');
  }
}
const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };
const DAY = 86_400_000;
const plain = (s: string | null | undefined): string => (s ?? '').replaceAll(NBSP, ' ');

let h: Harness;
let model: NeverModel;
beforeEach(() => {
  model = new NeverModel();
  h = createHarness('2026-10-10T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

/** Dumbbell bench done once (32.5 kg each); then Push A: bench, lateral raise, pushdown. */
async function withPushA(s: AppServices): Promise<{ gymId: string; routineId: string }> {
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 8 }, { load: 32.5, reps: 8 }, { load: 32.5, reps: 8 }] }]);
  h.clockMs += 2 * DAY;
  const pushA = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }, { load: 10, reps: 12 }] },
    { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }, { load: 25, reps: 12 }] },
  ]);
  const saved = await s.routines.saveFromSession({ sessionId: pushA, name: 'Push A', opId: 'save-1' });
  if (!saved.ok) throw new Error(saved.message);
  h.clockMs += 2 * DAY;
  return { gymId, routineId: saved.routine.id };
}

async function load(s: AppServices, gymId: string): Promise<OverviewData> {
  const page = await s.overview.load({ target: { kind: 'next' }, gymId });
  if (!page) throw new Error('no overview');
  return page;
}

const rowNamed = (page: OverviewData, name: string): OverviewRow => {
  const r = page.view.rows.find((x) => x.name === name);
  if (!r) throw new Error(`no ${name}`);
  return r;
};

/** The page's rows against the session Start created: order, names, skipped sets, and every pending row's target (TE-A2). */
function sameAsStart(page: OverviewData, agg: SessionAggregate): void {
  const ordered = [...agg.exercises].sort((a, b) => a.order - b.order);
  expect(ordered.map((e) => e.exerciseName)).toEqual(page.view.rows.map((r) => r.name));
  for (const [i, row] of page.view.rows.entries()) {
    const ex = ordered[i];
    const working = agg.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup' && x.pairedWithSetId === null).sort((a, b) => a.index - b.index);
    expect(row.detail.startsWith(`${String(working.length)}${NBSP}×${NBSP}`)).toBe(true);
    if (row.edit?.kind === 'skipped') {
      expect(working.every((x) => x.status === 'skipped' && x.skippedBy === 'before_start')).toBe(true);
      continue;
    }
    expect(working[0]?.status).toBe('pending');
    expect(row.load.value).toBe(loadCell(working[0]?.planned.load ?? null, ex?.loadConvention ?? 'total', null, false).value);
  }
}

const ports = (s: AppServices, gymId: string) => ({
  start: (q: Parameters<AppServices['overview']['start']>[0]) => s.overview.start(q),
  reload: () => s.overview.load({ target: { kind: 'next' }, gymId }),
});

const base = (page: OverviewData, gymId: string, opId: string) => ({ target: { kind: 'next' as const }, gymId, expectedDraftVersion: page.draft?.version ?? null, opId });

describe('Skip today and Do first: saved, survive a relaunch, and Start creates exactly what the page shows', () => {
  it('TE-A1, TE-A3, TE-A8, TE-A14: nothing before Start; the draft survives a force-close; Start consumes it', async () => {
    let { services: s } = await h.launch();
    const { gymId } = await withPushA(s);
    const before = await s.yourData.counts();
    const page = await load(s, gymId);
    expect(page.draft).toBeNull();
    expect(page.view.editCount).toBe(0);
    const sets = page.view.workingSets;
    const pushdown = rowNamed(page, 'Triceps pushdown');

    // Skip today: 2 taps, applies at once.
    const skipped = await s.overview.edit({ ...base(page, gymId, 'skip-1'), edit: { kind: 'skip', slotKey: pushdown.slotKey } });
    expect(skipped).toMatchObject({ ok: true, duplicate: false });
    const p2 = await load(s, gymId);
    const row = rowNamed(p2, 'Triceps pushdown');
    expect(row.marker).toMatchObject({ kind: 'skipped', word: 'Skipped' });
    expect(row.load.value).toBe('—');
    expect(p2.view.workingSets).toBe(sets - 2);
    expect(p2.view.editCount).toBe(1);
    expect(p2.view.estimate?.seconds ?? 0).toBeLessThan(page.view.estimate?.seconds ?? 0);
    // Do first on the lateral raise.
    const moved = await s.overview.move({ ...base(p2, gymId, 'first-1'), slotKey: rowNamed(p2, 'Lateral raise').slotKey, how: 'first' });
    expect(moved.ok).toBe(true);
    const p3 = await load(s, gymId);
    expect(p3.view.rows.map((r) => r.name)).toEqual(['Lateral raise', 'Bench press', 'Triceps pushdown']);
    expect(p3.view.editCount).toBe(2);
    // Nothing was created; no session, no workout counted.
    expect(await s.sessions.active()).toBeNull();
    expect(await s.yourData.counts()).toEqual(before);

    // Force-close and relaunch: the edits are there, on the overview and on Today's Up next.
    await h.forceClose();
    ({ services: s } = await h.launch());
    const p4 = await load(s, gymId);
    expect(p4.draft).toEqual(p3.draft);
    expect(p4.view.rows.map((r) => [r.name, r.marker.kind === 'skipped'])).toEqual([
      ['Lateral raise', false],
      ['Bench press', false],
      ['Triceps pushdown', true],
    ]);
    const next = await s.next.preview(gymId);
    expect(next?.exercises.map((e) => e.exerciseName)).toEqual(['Lateral raise', 'Bench press', 'Triceps pushdown']);

    // Start: one transaction; Ready on the first pending set of the edited order.
    const r = await startFromOverview(ports(s, gymId), { page: p4, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'started') throw new Error(r.kind);
    const agg = r.outcome.aggregate;
    sameAsStart(p4, agg);
    const first = [...agg.exercises].sort((a, b) => a.order - b.order)[0];
    expect(agg.sets.find((x) => x.id === agg.session.activeSetId)?.sessionExerciseId).toBe(first?.id);
    expect(agg.session.todayEdits).toMatchObject({ draftId: p4.draft?.id, reordered: true, swapped: [] });
    // Add set brings the skipped exercise back.
    const pushRow = agg.exercises.find((e) => e.exerciseName === 'Triceps pushdown');
    const added = await s.workout.dispatch(agg.session.id, { type: 'add_set', at: h.now(), opId: 'add-back', sessionExerciseId: pushRow?.id ?? '', newSetId: h.ids(), setType: null });
    expect(added.ok && added.aggregate.sets.some((x) => x.sessionExerciseId === pushRow?.id && x.status === 'pending')).toBe(true);
    // Finish; the next overview has no edits (the draft was consumed).
    const loaded = await s.workout.load(agg.session.id);
    const fin = await s.workout.dispatch(agg.session.id, { type: 'discard', at: h.now(), opId: 'discard-1', expectedVersion: loaded?.aggregate.session.version ?? 0, confirmedLoggedSets: 0 });
    expect(fin.ok).toBe(true);
    const after = await load(s, gymId);
    expect(after.draft).toBeNull();
    expect(after.view.editCount).toBe(0);
    expect(model.requests).toHaveLength(0);
  });

  it('TE-A13 / rule 5: a repeated opId writes once; an old version is refused and the page re-reads; Undo of each edit', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withPushA(s);
    const page = await load(s, gymId);
    const raise = rowNamed(page, 'Lateral raise');
    const a = await s.overview.edit({ ...base(page, gymId, 'op-x'), edit: { kind: 'skip', slotKey: raise.slotKey } });
    const b = await s.overview.edit({ ...base(page, gymId, 'op-x'), edit: { kind: 'skip', slotKey: raise.slotKey } });
    expect(a).toMatchObject({ ok: true, duplicate: false });
    expect(b).toMatchObject({ ok: true, duplicate: true });
    const p2 = await load(s, gymId);
    expect(p2.draft?.version).toBe(1);
    expect(p2.view.editCount).toBe(1);
    // An edit against the page before (no draft) is stale: nothing written.
    const stale = await s.overview.edit({ ...base(page, gymId, 'op-y'), edit: { kind: 'skip', slotKey: rowNamed(page, 'Bench press').slotKey } });
    expect(stale).toMatchObject({ ok: false, reason: 'stale' });
    expect((await load(s, gymId)).draft?.version).toBe(1);

    // Undo the skip (toast Undo / Bring back): the row is back exactly.
    const editId = rowNamed(p2, 'Lateral raise').edit?.editId ?? '';
    expect((await s.overview.undoEdit({ ...base(p2, gymId, 'undo-1'), editId })).ok).toBe(true);
    const p3 = await load(s, gymId);
    expect(p3.view.rows).toEqual(page.view.rows);
    expect(p3.view.editCount).toBe(0);

    // Do first, then its Undo.
    const moved = await s.overview.move({ ...base(p3, gymId, 'mv-1'), slotKey: rowNamed(p3, 'Triceps pushdown').slotKey, how: 'first' });
    if (!moved.ok) throw new Error(moved.message);
    expect((await load(s, gymId)).view.rows[0]?.name).toBe('Triceps pushdown');
    const p4 = await load(s, gymId);
    expect((await s.overview.undoEdit({ ...base(p4, gymId, 'mv-undo'), editId: moved.added[0] ?? '' })).ok).toBe(true);
    expect((await load(s, gymId)).view.rows.map((r) => r.name)).toEqual(page.view.rows.map((r) => r.name));

    // Reset today's edits, and its Undo.
    const p5 = await load(s, gymId);
    await s.overview.edit({ ...base(p5, gymId, 'sk-2'), edit: { kind: 'skip', slotKey: raise.slotKey } });
    const p6 = await load(s, gymId);
    const reset = await s.overview.resetEdits(base(p6, gymId, 'reset-1'));
    if (!reset.ok) throw new Error(reset.message);
    expect((await load(s, gymId)).view.editCount).toBe(0);
    const p7 = await load(s, gymId);
    expect((await s.overview.restoreEdits({ ...base(p7, gymId, 'restore-1'), editIds: reset.removed })).ok).toBe(true);
    expect(rowNamed(await load(s, gymId), 'Lateral raise').marker.kind).toBe('skipped');
    // The last exercise left can't be skipped.
    const p8 = await load(s, gymId);
    await s.overview.edit({ ...base(p8, gymId, 'sk-3'), edit: { kind: 'skip', slotKey: rowNamed(p8, 'Bench press').slotKey } });
    const p9 = await load(s, gymId);
    expect(rowNamed(p9, 'Triceps pushdown').actions.skip).toBe(false);
    expect(await s.overview.edit({ ...base(p9, gymId, 'sk-4'), edit: { kind: 'skip', slotKey: rowNamed(p9, 'Triceps pushdown').slotKey } })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await s.sessions.active()).toBeNull();
  });
});

describe('Swap today (TE-A4 – TE-A7, TE-A11)', () => {
  it('the sheet lists what this gym can do with its own targets; the pick shows SWAPPED; Undo restores; Swap again lists the planned exercise first', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withPushA(s);
    const page = await load(s, gymId);
    const bench = rowNamed(page, 'Bench press');
    expect(bench.actions).toMatchObject({ swap: true, undoSwap: false, skip: true });
    const sheet = await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: bench.slotKey });
    if (!sheet) throw new Error('no sheet');
    expect(sheet).toMatchObject({ plannedName: 'Bench press', gymName: 'Main Gym' });
    const names = sheet.rows.map((r) => r.name);
    // The catalogue's substitutions first, in its order; never one already in today's plan; at most 8.
    expect(names[0]).toBe('Dumbbell bench press');
    expect(names).not.toContain('Bench press');
    expect(names).not.toContain('Lateral raise');
    expect(names.length).toBeLessThanOrEqual(8);
    const db = sheet.rows[0];
    // From its own history (32.5 kg each), never from bench's 60 kg.
    expect(plain(db?.targetText)).toMatch(/^3[25](\.5)? kg each × /);
    expect(plain(db?.lastText)).toMatch(/^last 32\.5 × 8 · /);
    const noHistory = sheet.rows.find((r) => r.noHistory);
    expect(noHistory?.lastText).toBe('No history');
    expect(plain(noHistory?.targetText)).toMatch(/^(— |BW )× 8/);

    const picked = await s.overview.edit({ ...base(page, gymId, 'swap-1'), edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: db?.exerciseId ?? '' } });
    expect(picked.ok).toBe(true);
    const p2 = await load(s, gymId);
    const swapped = p2.view.rows[0];
    expect(swapped).toMatchObject({ name: 'Dumbbell bench press', slotKey: bench.slotKey, edit: { kind: 'swapped', fromName: 'Bench press' } });
    expect(swapped?.marker.kind).toBe('swapped');
    expect(swapped?.panel[0]?.value).toBe('For Bench press · today');
    expect(swapped?.actions).toMatchObject({ undoSwap: true, changeRoutine: true });
    // The sheet's target is the row's (TE-A5).
    expect(plain(`${swapped?.load.value ?? ''} ${swapped?.load.unit ?? ''}`)).toBe(plain(db?.targetText.split(`${NBSP}×${NBSP}`)[0]));

    // Swap again: the planned exercise first, as `planned`.
    const again = await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: bench.slotKey });
    expect(again?.rows[0]).toMatchObject({ name: 'Bench press', planned: true });
    // The plan's own target for bench (what Undo restores): the row's load and reps before the swap.
    expect(plain(again?.rows[0]?.targetText)).toBe(`${bench.load.value} ${bench.load.unit ?? ''} × ${plain(bench.detail).split(' × ')[1] ?? ''}`);
    expect(again?.rows.map((r) => r.name)).not.toContain('Dumbbell bench press');

    // Undo swap restores bench exactly.
    expect((await s.overview.undoEdit({ ...base(p2, gymId, 'swap-undo'), editId: swapped?.edit?.editId ?? '' })).ok).toBe(true);
    expect((await load(s, gymId)).view.rows).toEqual(page.view.rows);

    // Swap and Start: the session is what the page showed; Why? says swapped first.
    const p3 = await load(s, gymId);
    await s.overview.edit({ ...base(p3, gymId, 'swap-2'), edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: db?.exerciseId ?? '' } });
    const p4 = await load(s, gymId);
    const why = await s.overview.explain({ target: { kind: 'next' }, gymId, sessionExerciseId: p4.view.rows[0]?.sessionExerciseId ?? '' });
    expect(why?.rows[0]).toMatchObject({ key: 'swapped', label: null, lines: ['Swapped before start · Bench press'] });
    const r = await startFromOverview(ports(s, gymId), { page: p4, opId: 'start-swap', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'started') throw new Error(r.kind);
    sameAsStart(p4, r.outcome.aggregate);
    expect(r.outcome.aggregate.session.todayEdits?.swapped[0]).toMatchObject({ fromExerciseName: 'Bench press' });
    expect(model.requests).toHaveLength(0);
  });

  it('at a dumbbell-only gym: nothing needing a barbell or a cable; the swap re-fits there, capped at the rack’s max', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withPushA(s);
    const page = await load(s, gymId);
    const bench = rowNamed(page, 'Bench press');
    const db = (await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: bench.slotKey }))?.rows[0];
    await s.overview.edit({ ...base(page, gymId, 'swap-1'), edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: db?.exerciseId ?? '' } });
    await s.overview.edit({ ...base(await load(s, gymId), gymId, 'skip-1'), edit: { kind: 'skip', slotKey: rowNamed(page, 'Lateral raise').slotKey } });

    const hotelId = h.ids();
    expect((await s.setup.saveGym({ gymId: hotelId, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);
    expect(await s.gyms.select(hotelId)).toMatchObject({ ok: true });
    const hotel = await load(s, hotelId);
    // The gym change keeps every edit (intent, not numbers).
    expect(hotel.view.editCount).toBe(2);
    expect(rowNamed(hotel, 'Dumbbell bench press').marker.kind).toBe('swapped');
    expect(rowNamed(hotel, 'Lateral raise').marker.kind).toBe('skipped');
    // The pushdown needs a cable: no load here.
    expect(rowNamed(hotel, 'Triceps pushdown').marker.kind).toBe('no_load');
    const sheet = await s.overview.swapCandidates({ target: { kind: 'next' }, gymId: hotelId, slotKey: rowNamed(hotel, 'Triceps pushdown').slotKey });
    for (const row of sheet?.rows ?? []) expect(['Dumbbells', 'Bodyweight']).toContain(row.equipmentWord);
    const r = await startFromOverview(ports(s, hotelId), { page: hotel, opId: 'start-hotel', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'started') throw new Error(r.kind);
    sameAsStart(hotel, r.outcome.aggregate);
  });

  it('TE-A7: a pain-flagged candidate is marked and listed last; the confirm is the domain’s words', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withPushA(s);
    const page = await load(s, gymId);
    const bench = rowNamed(page, 'Bench press');
    const before = await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: bench.slotKey });
    const db = before?.rows.find((r) => r.name === 'Dumbbell bench press');
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 2 });
    if (!ci.ok) throw new Error(ci.message);
    expect((await s.pain.flagFromCheckIn({ checkIn: ci.checkIn, exercises: [{ id: db?.exerciseId ?? '', name: 'Dumbbell bench press' }], area: 'shoulder', opId: 'pain-1' })).ok).toBe(true);
    const sheet = await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: bench.slotKey });
    expect(sheet?.rows.at(-1)).toMatchObject({ name: 'Dumbbell bench press', mayHurt: { confirm: { title: 'Dumbbell bench press may hurt', confirm: 'Add anyway', cancel: 'Choose another' } } });
    expect(sheet?.rows.slice(0, -1).every((r) => r.mayHurt === null)).toBe(true);
    // `Choose another` writes nothing.
    expect((await load(s, gymId)).draft).toBeNull();
  });
});

describe('expiry, stale plans and the template change', () => {
  it('TE-A15: Start after local midnight creates nothing, the page re-reads without edits once, and a second Start works', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withPushA(s);
    // 23:55 in London (BST): 22:55 UTC.
    h.clockMs = Date.parse('2026-10-14T22:55:00.000Z');
    const page = await load(s, gymId);
    await s.overview.edit({ ...base(page, gymId, 'late-skip'), edit: { kind: 'skip', slotKey: rowNamed(page, 'Lateral raise').slotKey } });
    const edited = await load(s, gymId);
    expect(edited.draft?.version).toBe(1);
    h.clockMs = Date.parse('2026-10-14T23:05:00.000Z');
    const stale = await s.overview.start({ startOf: edited.startOf, gymId, opId: 'start-late', checkIn: null, expectedPreviewKey: edited.view.previewKey, draft: { id: edited.draft?.id ?? '', expectedVersion: 1 } });
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale_preview' } });
    expect(await s.sessions.active()).toBeNull();
    const reread = await load(s, gymId);
    expect(reread.cleared).toBe(true);
    expect(reread.draft).toBeNull();
    expect(reread.view.editCount).toBe(0);
    // Once.
    expect((await load(s, gymId)).cleared).toBe(false);
    const ok = await s.overview.start({ startOf: reread.startOf, gymId, opId: 'start-late-2', checkIn: null, expectedPreviewKey: reread.view.previewKey, draft: null });
    expect(ok.ok).toBe(true);
  });

  it('TE-A12: a draft change between load and Start creates nothing; a swap the template now matches is dropped silently', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId);
    await s.overview.edit({ ...base(page, gymId, 'e1'), edit: { kind: 'skip', slotKey: rowNamed(page, 'Lateral raise').slotKey } });
    // Start against the page from before the edit: stale, nothing created.
    const r = await s.overview.start({ startOf: page.startOf, gymId, opId: 'old-page', checkIn: null, expectedPreviewKey: page.view.previewKey });
    expect(r).toMatchObject({ ok: false, error: { code: 'stale_preview' } });
    expect(await s.sessions.active()).toBeNull();
    // The same page, its draft named: also stale.
    const r2 = await s.overview.start({ startOf: page.startOf, gymId, opId: 'old-page-2', checkIn: null, expectedPreviewKey: page.view.previewKey, draft: null });
    expect(r2).toMatchObject({ ok: false, error: { code: 'stale_preview' } });

    // Swap bench today, then the routine is changed to match elsewhere: the swap is redundant, no SWAPPED, no toast.
    const p2 = await load(s, gymId);
    const bench = rowNamed(p2, 'Bench press');
    const db = (await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: bench.slotKey }))?.rows[0];
    await s.overview.edit({ ...base(p2, gymId, 'e2'), edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: db?.exerciseId ?? '' } });
    const routine = (await s.routines.list()).find((x) => x.id === routineId);
    if (!routine) throw new Error('no routine');
    expect((await s.routines.applyTemplateSwap({ routineId, expectedRoutineVersion: routine.version, slotKey: bench.slotKey, toExerciseId: db?.exerciseId ?? '', draft: null, opId: 'tpl-x' })).ok).toBe(true);
    const p3 = await load(s, gymId);
    expect(rowNamed(p3, 'Dumbbell bench press').edit).toBeNull();
    expect(p3.view.editCount).toBe(1);
    expect(p3.removedEdits).toBe(0);
  });

  it('TE-A9: Change Push A too › applies through the card: routine v+1, the row no longer SWAPPED, one ben record; Undo restores both; refused after another change', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId);
    const bench = rowNamed(page, 'Bench press');
    const db = (await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: bench.slotKey }))?.rows[0];
    await s.overview.edit({ ...base(page, gymId, 'swap-1'), edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: db?.exerciseId ?? '' } });
    const p2 = await load(s, gymId);
    const row = p2.view.rows[0];
    if (row?.edit?.kind !== 'swapped' || !p2.routine) throw new Error('not swapped');
    // Nothing changes until Apply.
    expect((await s.routines.list()).find((x) => x.id === routineId)?.version).toBe(p2.routine.version);
    const req = { routineId, expectedRoutineVersion: p2.routine.version, slotKey: row.slotKey, toExerciseId: row.exerciseId, draft: { id: p2.draft?.id ?? '', editId: row.edit.editId }, opId: 'apply-1' };
    const applied = await s.routines.applyTemplateSwap(req);
    if (!applied.ok) throw new Error(applied.message);
    expect(applied.action).toMatchObject({ author: 'ben', detail: { kind: 'update_routine', changes: [{ change: 'swap', text: 'Bench press → Dumbbell bench press' }] } });
    expect(applied.routine.version).toBe(p2.routine.version + 1);
    // Template loads go back to automatic; never converted from bench's.
    expect(applied.routine.exercises.find((e) => e.id === row.slotKey)?.setTemplates.every((t) => t.targetLoad === null)).toBe(true);
    expect(await s.routines.applyTemplateSwap(req)).toMatchObject({ ok: true, duplicate: true });
    const p3 = await load(s, gymId);
    expect(p3.view.rows[0]).toMatchObject({ name: 'Dumbbell bench press', edit: null });
    expect(p3.view.editCount).toBe(0);

    const undone = await s.routines.undoTemplateSwap({ actionId: applied.action.actionId, opId: 'undo-apply' });
    expect(undone.ok).toBe(true);
    const p4 = await load(s, gymId);
    expect(p4.view.rows[0]).toMatchObject({ name: 'Dumbbell bench press', edit: { kind: 'swapped', fromName: 'Bench press' } });
    expect((await s.routines.list()).find((x) => x.id === routineId)?.version).toBe(p2.routine.version + 2);

    // Apply again, then rename the routine elsewhere: Undo is refused, nothing changes.
    const again = await s.routines.applyTemplateSwap({ ...req, expectedRoutineVersion: p2.routine.version + 2, opId: 'apply-2', draft: { id: p4.draft?.id ?? '', editId: p4.view.rows[0]?.edit?.editId ?? '' } });
    if (!again.ok) throw new Error(again.message);
    expect((await s.routines.rename({ routineId, name: 'Push B', expectedVersion: again.routine.version, opId: 'rename-1' })).ok).toBe(true);
    expect(await s.routines.undoTemplateSwap({ actionId: again.action.actionId, opId: 'undo-2' })).toEqual({ ok: false, reason: 'changed_since', message: 'Can’t undo: Push A changed since.' });
    // A card shown before the routine moved is out of date.
    expect(await s.routines.applyTemplateSwap({ ...req, opId: 'apply-3' })).toMatchObject({ ok: false, reason: 'stale' });
    expect(model.requests).toHaveLength(0);
  });
});

describe('backup and restore with an open draft (TE-A17)', () => {
  it('a restored phone never starts from an old draft', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withPushA(s);
    const page = await load(s, gymId);
    await s.overview.edit({ ...base(page, gymId, 'skip-1'), edit: { kind: 'skip', slotKey: rowNamed(page, 'Lateral raise').slotKey } });
    expect((await load(s, gymId)).draft).not.toBeNull();
    const made = await s.backups.backUpOnPhone('manual');
    expect(made.ok).toBe(true);
    await h.settle(s);
    const name = [...h.backupFiles.keys()].sort().at(-1) ?? '';
    const text = h.backupFiles.get(name) ?? '';
    expect(JSON.parse(text)).toMatchObject({ tables: { pre_start_drafts: [{ status: 'open' }] } });
    // Something changes after the backup, so the restore replaces data.
    const p2 = await load(s, gymId);
    await s.overview.edit({ ...base(p2, gymId, 'skip-2'), edit: { kind: 'skip', slotKey: rowNamed(p2, 'Bench press').slotKey } });
    const prepared = await s.restore.prepare(text);
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(await s.restore.restore(text, prepared.preview.stamp)).toMatchObject({ ok: true, status: 'restored' });
    const after = await load(s, gymId);
    expect(after.draft).toBeNull();
    expect(after.view.editCount).toBe(0);
  });
});
