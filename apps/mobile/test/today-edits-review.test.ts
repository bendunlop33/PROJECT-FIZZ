import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCell, NBSP, type OverviewRow } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { OverviewData } from '../src/services/workout-services';
import { OVERVIEW_COPY } from '../src/workout/overview';
import { pageToast, TODAY_EDITS_COPY } from '../src/workout/overview-edits';
import { staleStartToast, startFromOverview } from '../src/workout/overview-start';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Today's edits, the review's should-fix items through the app services on
 * real SQLite (docs/reviews/today-edits.md S1–S6): `· planned` after chained
 * swaps, `Earlier edits cleared` through the screen's Start path, the
 * substitute's own "last used here" item in the dry run and Start, a swap
 * that can't take another slot's exercise, and every swap/skip/order
 * combination compared with what Start creates, for both bases and for the
 * lb and assisted conventions.
 */

const DAY = 86_400_000;
const plain = (s: string | null | undefined): string => (s ?? '').replaceAll(NBSP, ' ');

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

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

const ports = (s: AppServices, gymId: string) => ({
  start: (q: Parameters<AppServices['overview']['start']>[0]) => s.overview.start(q),
  reload: () => s.overview.load({ target: { kind: 'next' }, gymId }),
});

const base = (page: OverviewData, gymId: string, opId: string) => ({ target: { kind: 'next' as const }, gymId, expectedDraftVersion: page.draft?.version ?? null, opId });

/** The page's rows against the session Start created: order, names, skipped sets, every pending row's load (value and unit) and reps. */
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
    const cell = loadCell(working[0]?.planned.load ?? null, ex?.loadConvention ?? 'total', null, false);
    expect(row.load).toEqual(cell);
  }
}

async function discard(s: AppServices, agg: SessionAggregate, opId: string): Promise<void> {
  const loaded = await s.workout.load(agg.session.id);
  const r = await s.workout.dispatch(agg.session.id, { type: 'discard', at: h.now(), opId, expectedVersion: loaded?.aggregate.session.version ?? 0, confirmedLoggedSets: 0 });
  if (!r.ok) throw new Error(r.error.message);
}

/** Dumbbell bench done once; then a push workout: bench, lateral raise, pushdown. Saved as Push A for the routine basis. */
async function withPush(s: AppServices, asRoutine: boolean): Promise<{ gymId: string }> {
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 8 }, { load: 32.5, reps: 8 }, { load: 32.5, reps: 8 }] }]);
  h.clockMs += 2 * DAY;
  const push = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }, { load: 10, reps: 12 }] },
    { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }, { load: 25, reps: 12 }] },
  ]);
  if (asRoutine) {
    const saved = await s.routines.saveFromSession({ sessionId: push, name: 'Push A', opId: 'save-1' });
    if (!saved.ok) throw new Error(saved.message);
  }
  h.clockMs += 2 * DAY;
  return { gymId };
}

async function swapTo(s: AppServices, gymId: string, slotName: string, toName: string | null, opId: string): Promise<void> {
  const page = await load(s, gymId);
  const slot = rowNamed(page, slotName);
  const sheet = await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: slot.slotKey });
  const pick = toName === null ? sheet?.rows.find((r) => !r.planned) : sheet?.rows.find((r) => r.name === toName);
  if (!pick) throw new Error(`no ${toName ?? 'candidate'} in the sheet`);
  const w = await s.overview.edit({ ...base(page, gymId, opId), edit: { kind: 'swap', slotKey: slot.slotKey, toExerciseId: pick.exerciseId } });
  if (!w.ok) throw new Error(w.message);
}

describe('S1: `· planned` in Swap again is the plan, however many swaps were chained', () => {
  it('bench → DB bench → machine, then `Bench press · planned`: bench, exactly as planned; the toast Undo still steps back one', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withPush(s, true);
    const page = await load(s, gymId);
    const bench = rowNamed(page, 'Bench press');
    await swapTo(s, gymId, 'Bench press', 'Dumbbell bench press', 'swap-1');
    // The dumbbells are taken too: Swap again to another candidate.
    const p2 = await load(s, gymId);
    const again = await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: bench.slotKey });
    const second = again?.rows.find((r) => !r.planned && r.name !== 'Dumbbell bench press');
    if (!second) throw new Error('no second candidate');
    const w2 = await s.overview.edit({ ...base(p2, gymId, 'swap-2'), edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: second.exerciseId } });
    if (!w2.ok) throw new Error(w2.message);
    const p3 = await load(s, gymId);
    expect(p3.view.rows[0]).toMatchObject({ name: second.name, edit: { kind: 'swapped', fromName: 'Bench press' } });

    // The toast's Undo on the second swap steps back to DB bench (one step)…
    const stepped = await s.overview.undoEdit({ ...base(p3, gymId, 'toast-undo'), editId: w2.added[0] ?? '' });
    expect(stepped.ok).toBe(true);
    expect((await load(s, gymId)).view.rows[0]?.name).toBe('Dumbbell bench press');
    const p4 = await load(s, gymId);
    const w3 = await s.overview.edit({ ...base(p4, gymId, 'swap-3'), edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: second.exerciseId } });
    expect(w3.ok).toBe(true);

    // …and `Bench press · planned` (the sheet's first row) clears the whole chain.
    const p5 = await load(s, gymId);
    const sheet = await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: bench.slotKey });
    expect(sheet?.rows[0]).toMatchObject({ name: 'Bench press', planned: true });
    const cleared = await s.overview.clearSwap({ ...base(p5, gymId, 'planned'), slotKey: bench.slotKey });
    expect(cleared).toMatchObject({ ok: true, added: [] });
    const p6 = await load(s, gymId);
    expect(p6.view.rows).toEqual(page.view.rows);
    expect(p6.view.editCount).toBe(0);
    // A retry of the same tap is a no-op; another tap with nothing to clear changes nothing.
    expect(await s.overview.clearSwap({ ...base(p5, gymId, 'planned'), slotKey: bench.slotKey })).toMatchObject({ ok: true, duplicate: true });
    expect(await s.overview.clearSwap({ ...base(p6, gymId, 'planned-2'), slotKey: bench.slotKey })).toMatchObject({ ok: true, duplicate: false, removed: [] });
    expect((await load(s, gymId)).draft?.version).toBe(p6.draft?.version);
  });
});

describe('S2: Start after midnight through the screen’s Start path', () => {
  it('TE-A15: the re-read that closed the draft is the page returned, and the toast is `Earlier edits cleared`; a second Start works', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withPush(s, true);
    // 23:55 in London (BST): 22:55 UTC.
    h.clockMs = Date.parse('2026-10-14T22:55:00.000Z');
    const page = await load(s, gymId);
    await s.overview.edit({ ...base(page, gymId, 'late-skip'), edit: { kind: 'skip', slotKey: rowNamed(page, 'Lateral raise').slotKey } });
    const edited = await load(s, gymId);
    expect(edited.view.editCount).toBe(1);
    // 00:05 the next day in London.
    h.clockMs = Date.parse('2026-10-14T23:05:00.000Z');
    const r = await startFromOverview(ports(s, gymId), { page: edited, opId: 'start-late', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'stale') throw new Error(r.kind);
    expect(await s.sessions.active()).toBeNull();
    expect(r.page).toMatchObject({ cleared: true, draft: null, view: { editCount: 0 } });
    expect(staleStartToast(r.page, { stale: OVERVIEW_COPY.stale, cleared: TODAY_EDITS_COPY.earlierCleared })).toBe('Earlier edits cleared');
    // Any other stale Start still says `Targets updated`.
    expect(staleStartToast({ cleared: false }, { stale: OVERVIEW_COPY.stale, cleared: TODAY_EDITS_COPY.earlierCleared })).toBe('Targets updated');
    expect(staleStartToast(null, { stale: OVERVIEW_COPY.stale, cleared: TODAY_EDITS_COPY.earlierCleared })).toBe('Targets updated');
    // The screen's own sequence (review r2 N1): `staleStartToast(r.page)` with the screen's copy, then its
    // `reload()` re-reads, and `pageToast` on that page must not overwrite the toast.
    const shown = new Set<string>();
    let toast = staleStartToast(r.page);
    expect(toast).toBe(TODAY_EDITS_COPY.earlierCleared);
    const reloaded = await load(s, gymId);
    expect(reloaded.cleared).toBe(false);
    const after = pageToast(reloaded, shown);
    if (after !== null) toast = after.text;
    expect(after).toBeNull();
    expect(toast).toBe('Earlier edits cleared');
    // Without the fix (toasting the stale page as an ordinary stale Start), Ben would read `Targets updated`.
    expect(staleStartToast({ cleared: false })).toBe(OVERVIEW_COPY.stale);
    // Ben taps Start again on the re-read page: it starts, with no edits.
    const fresh = r.page;
    if (fresh === null) throw new Error('no page');
    const again = await startFromOverview(ports(s, gymId), { page: fresh, opId: 'start-late', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (again.kind !== 'started') throw new Error(again.kind);
    sameAsStart(fresh, again.outcome.aggregate);
    expect(again.outcome.aggregate.session.todayEdits).toBeUndefined();
  });
});

describe('S3: the substitute’s “last used here” item in the dry run, the Swap sheet and Start (GS3 step 2)', () => {
  it('two dumbbell racks at Main gym, the newest DB bench at Hotel gym: the sheet, the row and Start all use the usual rack', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    // Main gym: a 2 kg-step rack listed first, then the usual 2.5 kg-step rack.
    const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
    const usual = draft.items.find((i) => i.key === 'dumbbells');
    if (!usual || usual.equipment.kind !== 'dumbbells') throw new Error('no dumbbells');
    const odd = { ...usual, key: 'dumbbells-2', label: 'Rack A', equipment: { ...usual.equipment, name: 'Rack A', loads: Array.from({ length: 20 }, (_, i) => (i + 1) * 2) } };
    const at = draft.items.indexOf(usual);
    const items = [...draft.items.slice(0, at), odd, ...draft.items.slice(at)];
    expect((await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items } })).ok).toBe(true);
    await s.setup.complete();
    const gymId = (await s.yourData.currentGym())?.id ?? '';
    const racks = (await s.yourData.equipment(gymId)).filter((e) => e.kind === 'dumbbells').map((e) => e.name);
    expect(racks).toEqual(['Rack A', 'Dumbbells']);

    // DB bench on the usual rack at Main, then (newest) at Hotel gym.
    await logWorkout(h, s, gymId, [{ exercise: 'Dumbbell bench press', equipment: 'Dumbbells', sets: [{ load: 27.5, reps: 8 }, { load: 27.5, reps: 8 }, { load: 27.5, reps: 8 }] }]);
    h.clockMs += DAY;
    const hotelId = h.ids();
    expect((await s.setup.saveGym({ gymId: hotelId, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);
    expect(await s.gyms.select(hotelId)).toMatchObject({ ok: true });
    await logWorkout(h, s, hotelId, [{ exercise: 'Dumbbell bench press', sets: [{ load: 22.5, reps: 8 }, { load: 22.5, reps: 8 }, { load: 22.5, reps: 8 }] }]);
    expect(await s.gyms.select(gymId)).toMatchObject({ ok: true });
    h.clockMs += DAY;
    const push = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] },
      { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }, { load: 25, reps: 12 }] },
    ]);
    const saved = await s.routines.saveFromSession({ sessionId: push, name: 'Push A', opId: 'save-1' });
    if (!saved.ok) throw new Error(saved.message);
    h.clockMs += 2 * DAY;

    const page = await load(s, gymId);
    const bench = rowNamed(page, 'Bench press');
    const sheet = await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: bench.slotKey });
    const db = sheet?.rows.find((r) => r.name === 'Dumbbell bench press');
    if (!db) throw new Error('no DB bench');
    await s.overview.edit({ ...base(page, gymId, 'swap-1'), edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: db.exerciseId } });
    const p2 = await load(s, gymId);
    const row = rowNamed(p2, 'Dumbbell bench press');
    // The sheet's target is the row's (TE-A5), on a load only the usual rack has (2.5 kg steps; Rack A has even numbers only).
    expect(plain(`${row.load.value} ${row.load.unit ?? ''}`)).toBe(plain(db.targetText.split(`${NBSP}×${NBSP}`)[0]));
    expect(Number(row.load.value) % 2).not.toBe(0);
    const r = await startFromOverview(ports(s, gymId), { page: p2, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'started') throw new Error(r.kind);
    sameAsStart(p2, r.outcome.aggregate);
    const started = r.outcome.aggregate.exercises.find((e) => e.exerciseName === 'Dumbbell bench press');
    const usualId = (await s.yourData.equipment(gymId)).find((e) => e.name === 'Dumbbells')?.id;
    expect(started?.equipmentId).toBe(usualId);
  });
});

describe('S5: a swap can’t take an exercise already in today’s plan, or one this gym can’t do', () => {
  it('the server refuses what the Swap sheet never offers', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withPush(s, true);
    const page = await load(s, gymId);
    const bench = rowNamed(page, 'Bench press');
    const raise = rowNamed(page, 'Lateral raise');
    // Another slot's exercise.
    expect(await s.overview.edit({ ...base(page, gymId, 'in-plan'), edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: raise.exerciseId } })).toMatchObject({ ok: false, reason: 'invalid' });
    // An exercise that doesn't exist.
    expect(await s.overview.edit({ ...base(page, gymId, 'unknown'), edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: h.ids() } })).toMatchObject({ ok: false, reason: 'invalid' });
    // At a dumbbell-only gym, a barbell or cable exercise isn't doable.
    const hotelId = h.ids();
    expect((await s.setup.saveGym({ gymId: hotelId, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);
    const hotel = await s.overview.load({ target: { kind: 'next' }, gymId: hotelId });
    if (!hotel) throw new Error('no page');
    // A candidate Main gym's sheet offers for bench that needs a machine or a barbell.
    const mainSheet = await s.overview.swapCandidates({ target: { kind: 'next' }, gymId, slotKey: bench.slotKey });
    const machine = mainSheet?.rows.find((r) => !r.planned && !['Dumbbells', 'Bodyweight'].includes(r.equipmentWord));
    if (!machine) throw new Error('no machine candidate');
    const hotelSheet = await s.overview.swapCandidates({ target: { kind: 'next' }, gymId: hotelId, slotKey: rowNamed(hotel, 'Bench press').slotKey });
    expect(hotelSheet?.rows.map((r) => r.exerciseId)).not.toContain(machine.exerciseId);
    expect(await s.overview.edit({ target: { kind: 'next' }, gymId: hotelId, expectedDraftVersion: null, opId: 'not-here', edit: { kind: 'swap', slotKey: rowNamed(hotel, 'Bench press').slotKey, toExerciseId: machine.exerciseId } })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    // The same pick at Main gym is fine.
    expect((await s.overview.edit({ ...base(page, gymId, 'here'), edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: machine.exerciseId } })).ok).toBe(true);
  });
});

describe('S6: every combination of swap, skip and order, the dry run against Start, for both bases', () => {
  for (const asRoutine of [true, false]) {
    it(`${asRoutine ? 'routine' : 'next session'} basis: the page shows exactly what Start creates`, async () => {
      const { services: s } = await h.launch();
      const { gymId } = await withPush(s, asRoutine);
      const plan = await load(s, gymId);
      expect(plan.startOf).toEqual(asRoutine ? { routineOf: expect.any(String) as string } : { nextOf: expect.any(String) as string });
      for (let n = 0; n < 8; n += 1) {
        const c = { swap: (n & 1) !== 0, skip: (n & 2) !== 0, order: (n & 4) !== 0 };
        if (c.swap) await swapTo(s, gymId, 'Bench press', 'Dumbbell bench press', `swap-${String(n)}`);
        if (c.skip) {
          const p = await load(s, gymId);
          expect((await s.overview.edit({ ...base(p, gymId, `skip-${String(n)}`), edit: { kind: 'skip', slotKey: rowNamed(p, 'Triceps pushdown').slotKey } })).ok).toBe(true);
        }
        if (c.order) {
          const p = await load(s, gymId);
          expect((await s.overview.move({ ...base(p, gymId, `first-${String(n)}`), slotKey: rowNamed(p, 'Lateral raise').slotKey, how: 'first' })).ok).toBe(true);
        }
        const page = await load(s, gymId);
        expect(page.view.editCount).toBe(Number(c.swap) + Number(c.skip) + Number(c.order));
        expect(page.view.rows[0]?.name).toBe(c.order ? 'Lateral raise' : c.swap ? 'Dumbbell bench press' : 'Bench press');
        const r = await startFromOverview(ports(s, gymId), { page, opId: `start-${String(n)}`, checkIn: { kind: 'skipped', atUtc: h.now().utc } });
        if (r.kind !== 'started') throw new Error(`${String(n)}: ${r.kind}`);
        sameAsStart(page, r.outcome.aggregate);
        expect(r.outcome.aggregate.session.todayEdits === undefined).toBe(n === 0);
        await discard(s, r.outcome.aggregate, `discard-${String(n)}`);
        h.clockMs += 60_000;
        // The draft was consumed: the next combination starts from the plan.
        expect((await load(s, gymId)).view.rows.map((x) => x.name)).toEqual(plan.view.rows.map((x) => x.name));
      }
    });
  }

  it('lb gym with an assisted machine: a swap to the assisted substitute, a skip and an order, page against Start', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('lb');
    const draft = s.coachingKnowledge.buildGymDraft('commercial', 'lb');
    expect((await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } })).ok).toBe(true);
    await s.setup.complete();
    const gymId = (await s.yourData.currentGym())?.id ?? '';
    await logWorkout(h, s, gymId, [{ exercise: 'Assisted pull-up', sets: [{ load: 50, reps: 8 }, { load: 50, reps: 8 }, { load: 50, reps: 8 }] }]);
    h.clockMs += 2 * DAY;
    await logWorkout(h, s, gymId, [
      { exercise: 'Lat pulldown', sets: [{ load: 120, reps: 10 }, { load: 120, reps: 10 }, { load: 120, reps: 10 }] },
      { exercise: 'Bench press', sets: [{ load: 135, reps: 8 }, { load: 135, reps: 8 }] },
      { exercise: 'Lateral raise', sets: [{ load: 20, reps: 12 }, { load: 20, reps: 12 }] },
    ]);
    h.clockMs += 2 * DAY;
    await swapTo(s, gymId, 'Lat pulldown', 'Assisted pull-up', 'swap-a');
    const p1 = await load(s, gymId);
    expect((await s.overview.edit({ ...base(p1, gymId, 'skip-a'), edit: { kind: 'skip', slotKey: rowNamed(p1, 'Lateral raise').slotKey } })).ok).toBe(true);
    const p2 = await load(s, gymId);
    expect((await s.overview.move({ ...base(p2, gymId, 'first-a'), slotKey: rowNamed(p2, 'Bench press').slotKey, how: 'first' })).ok).toBe(true);
    const page = await load(s, gymId);
    expect(page.view.rows.map((r) => r.name)).toEqual(['Bench press', 'Assisted pull-up', 'Lateral raise']);
    const assistedRow = rowNamed(page, 'Assisted pull-up');
    expect(assistedRow.marker.kind).toBe('swapped');
    expect(assistedRow.load.unit).toMatch(/lb/);
    expect(rowNamed(page, 'Bench press').load.unit).toMatch(/lb/);
    const r = await startFromOverview(ports(s, gymId), { page, opId: 'start-a', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'started') throw new Error(r.kind);
    sameAsStart(page, r.outcome.aggregate);
    const ex = r.outcome.aggregate.exercises.find((e) => e.exerciseName === 'Assisted pull-up');
    expect(ex).toMatchObject({ unit: 'lb', loadConvention: 'assistance' });
    const first = r.outcome.aggregate.sets.find((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup');
    // From its own history (50 lb of assistance), never converted from the pulldown's stack load.
    expect(first?.planned.load).toMatchObject({ unit: 'lb', convention: 'assistance' });
    expect(first?.planned.load?.value ?? 0).toBeGreaterThanOrEqual(40);
    expect(first?.planned.load?.value ?? 0).toBeLessThanOrEqual(60);
  });
});
