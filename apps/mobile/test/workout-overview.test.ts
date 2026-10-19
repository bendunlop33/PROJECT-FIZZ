import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCell, NBSP, type OverviewRow } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * The Workout overview through the app services on real SQLite
 * (workout-overview.md §7, acceptance checks OV1, OV3–OV5, OV9, OV10, OV12,
 * OV17). The page reads the same dry run Start uses, creates nothing until
 * Start, and a Start against a page that went out of date creates nothing.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});
const DAY = 86_400_000;

async function withRoutine(s: AppServices): Promise<{ gymId: string; routineId: string; first: string }> {
  const gymId = await setUpGym(h, s);
  const first = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] },
    { exercise: 'Barbell row', sets: [{ load: 50, reps: 10 }, { load: 50, reps: 10 }] },
  ]);
  const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1' , addToRotation: true });
  if (!saved.ok) throw new Error(saved.message);
  h.clockMs += 2 * DAY;
  return { gymId, routineId: saved.routine.id, first };
}

/** What a row shows, against what Start created for the same exercise. */
function matchesSession(row: OverviewRow, agg: SessionAggregate): void {
  const ex = agg.exercises.find((e) => e.exerciseId === row.exerciseId);
  if (!ex) throw new Error(`no ${row.name}`);
  const working = agg.sets.filter((s) => s.sessionExerciseId === ex.id && s.setType !== 'warmup' && s.pairedWithSetId === null).sort((a, b) => a.index - b.index);
  const first = working[0];
  expect(first?.status).toBe('pending');
  expect(row.detail.startsWith(`${String(working.length)}${NBSP}×${NBSP}`)).toBe(true);
  expect(row.load.value).toBe(loadCell(first?.planned.load ?? null, ex.loadConvention, null, false).value);
  if (first?.planned.reps) expect(row.detail).toContain(first.planned.reps.min === first.planned.reps.max ? String(first.planned.reps.min) : `${String(first.planned.reps.min)}–${String(first.planned.reps.max)}`);
}

describe('Workout overview', () => {
  it('OV1/OV9: opening it creates nothing; the rows are what Start creates (OV3); a double Start creates one session (OV5)', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withRoutine(s);
    const before = await s.yourData.counts();

    const page = await s.overview.load({ target: { kind: 'next' }, gymId });
    if (!page) throw new Error('no overview');
    expect(page.startOf).toEqual({ routineOf: routineId });
    expect(page.view.title).toBe('Push A');
    expect(page.view.basis).toEqual({ kind: 'only' });
    expect(page.view.rows.map((r) => r.name)).toEqual(['Bench press', 'Barbell row']);
    expect(page.view.rows.map((r) => r.marker.kind)).toEqual(['up', 'up']);
    expect(page.view.workingSets).toBe(5);
    expect(page.view.estimate?.minutes).toBeGreaterThan(0);
    expect(page.checkIn.kind).toBe('ask');
    // Opening it twice reads the same page (stable IDs, same key) and writes nothing.
    const again = await s.overview.load({ target: { kind: 'next' }, gymId });
    expect(again?.view).toEqual(page.view);
    expect(await s.sessions.active()).toBeNull();
    expect(await s.yourData.counts()).toEqual(before);

    const req = { startOf: page.startOf, gymId, opId: 'overview-start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } as const, expectedPreviewKey: page.view.previewKey };
    const [a, b] = await Promise.all([s.overview.start(req), s.overview.start(req)]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.aggregate.session.id).toBe(b.aggregate.session.id);
    expect(a.aggregate.session).toMatchObject({ routineId, checkIn: { kind: 'skipped' } });
    for (const row of page.view.rows) matchesSession(row, a.aggregate);
    // A retry after success is a duplicate, never stale, even though the key's inputs changed (a session now exists).
    const retry = await s.overview.start(req);
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    expect((await s.yourData.counts()).unfinishedWorkouts).toBe(1);
  });

  it('OV4: a change after the page opened (routine renamed, pain flag) creates nothing, then a fresh page starts', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withRoutine(s);
    const page = await s.overview.load({ target: { kind: 'routine', routineId }, gymId });
    if (!page) throw new Error('no overview');
    expect(page.view.basis.kind).toBe('last_done');

    const renamed = await s.routines.rename({ routineId, name: 'Push B', expectedVersion: page.routine?.version ?? 0, opId: 'rename-1' });
    expect(renamed.ok).toBe(true);
    const stale = await s.overview.start({ startOf: page.startOf, gymId, opId: 'op-a', checkIn: null, expectedPreviewKey: page.view.previewKey });
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale_preview', message: 'Targets updated' } });
    expect(await s.sessions.active()).toBeNull();

    // A pain flag on Bench press: HELD, and the key changes again.
    const fresh = await s.overview.load({ target: { kind: 'routine', routineId }, gymId });
    if (!fresh) throw new Error('no overview');
    expect(fresh.view.title).toBe('Push B');
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 2 });
    if (!ci.ok) throw new Error(ci.message);
    const bench = fresh.view.rows[0];
    const flagged = await s.pain.flagFromCheckIn({ checkIn: ci.checkIn, exercises: [{ id: bench?.exerciseId ?? '', name: 'Bench press' }], area: 'shoulder', opId: 'pain-1' });
    expect(flagged.ok).toBe(true);
    expect(await s.overview.start({ startOf: fresh.startOf, gymId, opId: 'op-b', checkIn: null, expectedPreviewKey: fresh.view.previewKey })).toMatchObject({ ok: false, error: { code: 'stale_preview' } });

    const held = await s.overview.load({ target: { kind: 'routine', routineId }, gymId });
    if (!held) throw new Error('no overview');
    const heldRow = held.view.rows[0];
    expect(heldRow?.marker).toMatchObject({ kind: 'held', word: 'Held', glyph: 'warning' });
    // OV7: never above last time's working load (60 kg).
    expect(Number(heldRow?.load.value)).toBeLessThanOrEqual(60);
    expect(heldRow?.panel.find((l) => l.key === 'flag')?.value).toMatch(/^Shoulder · /);
    // The check-in from 2 min ago is reused on the page (pre-selected), so Start sends it, as the page does.
    expect(held.planCheckIn?.id).toBe(ci.checkIn.id);
    const started = await s.overview.start({ startOf: held.startOf, gymId, opId: 'op-c', checkIn: { kind: 'answered', checkInId: ci.checkIn.id }, expectedPreviewKey: held.view.previewKey });
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.aggregate.session.routineName).toBe('Push B');
      for (const row of held.view.rows) matchesSession(row, started.aggregate);
    }
  });

  it('OV10: a tapped score is saved at once, reused after a force-close, planned with, and linked by Start', async () => {
    let { services: s } = await h.launch();
    const { gymId } = await withRoutine(s);
    const CI = h.ids();
    const page = await s.overview.load({ target: { kind: 'next' }, gymId });
    expect(page?.checkIn.kind).toBe('ask');
    const ci = await s.checkIns.record({ checkInId: CI, opId: 'ci-op', score: 4 });
    if (!ci.ok) throw new Error(ci.message);

    await h.forceClose();
    s = (await h.launch()).services;
    h.clockMs += 30 * 60_000;
    const reopened = await s.overview.load({ target: { kind: 'next' }, gymId });
    if (!reopened) throw new Error('no overview');
    expect(reopened.checkIn).toMatchObject({ kind: 'reuse', checkIn: { id: CI, score: 4 } });
    expect(reopened.planCheckIn?.id).toBe(CI);
    const started = await s.overview.start({ startOf: reopened.startOf, gymId, opId: 'op-ci', checkIn: { kind: 'answered', checkInId: CI }, expectedPreviewKey: reopened.view.previewKey });
    expect(started.ok).toBe(true);
    if (started.ok) expect(started.aggregate.session.checkIn).toEqual({ kind: 'answered', checkInId: CI });
  });

  it('OV12: switching gym re-snaps every row and Undo restores the previous gym', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withRoutine(s);
    const hotelId = h.ids();
    expect((await s.setup.saveGym({ gymId: hotelId, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);
    const main = await s.overview.load({ target: { kind: 'next' }, gymId });
    expect(main?.gyms.map((g) => g.name)).toEqual(['Main Gym', 'Hotel gym']);

    const sel = await s.gyms.select(hotelId);
    expect(sel).toMatchObject({ ok: true, previousGymId: gymId, changed: true });
    expect((await s.yourData.currentGym())?.id).toBe(hotelId);
    // Selecting it again is a no-op (a double tap).
    expect(await s.gyms.select(hotelId)).toMatchObject({ ok: true, changed: false });
    const hotel = await s.overview.load({ target: { kind: 'next' }, gymId: hotelId });
    if (!hotel || !main) throw new Error('no overview');
    expect(hotel.view.gym?.name).toBe('Hotel gym');
    expect(hotel.view.previewKey).not.toBe(main.view.previewKey);
    // No barbell at the hotel: the bench keeps its reps and has no load target.
    const bench = hotel.view.rows[0];
    expect(bench?.load.value).toBe('—');
    expect(bench?.marker.kind).toBe('no_load');
    expect(bench?.missingEquipment).not.toBeNull();

    expect(await s.gyms.select(gymId)).toMatchObject({ ok: true, previousGymId: hotelId, changed: true });
    expect((await s.yourData.currentGym())?.id).toBe(gymId);
    expect(await s.gyms.select('nope')).toMatchObject({ ok: false });
  });

  it('OV17: a non-routine Up next starts the next session; a routine from the list starts with its routineId', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    h.clockMs += DAY;
    const page = await s.overview.load({ target: { kind: 'next' }, gymId });
    if (!page) throw new Error('no overview');
    expect(page.startOf).toEqual({ nextOf: first });
    expect(page.routine).toBeNull();
    expect(page.view.basis.kind).toBe('next_from');
    const why = await s.overview.explain({ target: { kind: 'next' }, gymId, sessionExerciseId: page.view.rows[0]?.sessionExerciseId ?? '' });
    expect(why?.rows.length).toBeGreaterThan(0);
    const started = await s.overview.start({ startOf: page.startOf, gymId, opId: 'op-next', checkIn: null, expectedPreviewKey: page.view.previewKey });
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.aggregate.session.routineId).toBeNull();
      for (const row of page.view.rows) matchesSession(row, started.aggregate);
    }
    // With a workout active, Start from another page reports it (Today shows Resume).
    const second = await s.overview.load({ target: { kind: 'next' }, gymId });
    if (!second) throw new Error('no overview');
    const blocked = await s.overview.start({ startOf: second.startOf, gymId, opId: 'op-other', checkIn: null, expectedPreviewKey: second.view.previewKey });
    expect(blocked).toMatchObject({ ok: false, error: { code: 'session_already_active' } });
  });

  it('S1: Why? plans with the reused check-in, as the page does, so it explains the paused target the row shows', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withRoutine(s);
    // Saved on Today 30 min ago, pain mentioned: reused on the page and pre-selected.
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 2 });
    if (!ci.ok) throw new Error(ci.message);
    const withPain = await s.checkIns.update(ci.checkIn.id, { reasons: ['pain'] }, ci.checkIn.version, h.ids());
    if (!withPain.ok) throw new Error('not updated');
    h.clockMs += 30 * 60_000;
    const page = await s.overview.load({ target: { kind: 'next' }, gymId });
    if (!page) throw new Error('no overview');
    expect(page.checkIn.kind).toBe('reuse');
    expect(page.planCheckIn?.id).toBe(ci.checkIn.id);
    const bench = page.view.rows[0];
    if (!bench) throw new Error('no row');
    // No check-in tapped on the page: Why? still plans with the reused one.
    const why = await s.overview.explain({ target: { kind: 'next' }, gymId, sessionExerciseId: bench.sessionExerciseId });
    const withId = await s.overview.explain({ target: { kind: 'next' }, gymId, checkInId: ci.checkIn.id, sessionExerciseId: bench.sessionExerciseId });
    expect(why).not.toBeNull();
    expect(why).toEqual(withId);
    // Pain mentioned: progression paused, as the row shows (no +2.5 kg explained).
    expect(why?.rows.find((r) => r.key === 'reason')?.lines[0]).toMatch(/is paused$/);
    expect(bench.marker.kind).not.toBe('up');
  });

  it('S3: a change that lands after the key check, before the write, creates nothing (checked inside the start transaction)', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withRoutine(s);
    const page = await s.overview.load({ target: { kind: 'next' }, gymId });
    if (!page) throw new Error('no overview');
    // A late write (as a coach result could, CA10) between the key check and the session write.
    const check = s.workout.previewCheck.bind(s.workout);
    s.workout.previewCheck = async (p, req) => {
      const r = await check(p, req);
      const routine = await s.routines.rename({ routineId, name: 'Push late', expectedVersion: page.routine?.version ?? 0, opId: 'late-rename' });
      expect(routine.ok).toBe(true);
      return r;
    };
    const stale = await s.overview.start({ startOf: page.startOf, gymId, opId: 'op-late', checkIn: null, expectedPreviewKey: page.view.previewKey });
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale_preview', message: 'Targets updated' } });
    expect(await s.sessions.active()).toBeNull();
    s.workout.previewCheck = check;
    // The page re-reads; the same opId then starts once.
    const fresh = await s.overview.load({ target: { kind: 'next' }, gymId });
    if (!fresh) throw new Error('no overview');
    const started = await s.overview.start({ startOf: fresh.startOf, gymId, opId: 'op-late', checkIn: null, expectedPreviewKey: fresh.view.previewKey });
    expect(started).toMatchObject({ ok: true, duplicate: false, aggregate: { session: { routineName: 'Push late' } } });
  });

  it('S5: when the rotation’s routine can’t start, Today’s card and the overview both fall back to the same next session', async () => {
    let { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const a = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const savedA = await s.routines.saveFromSession({ sessionId: a, name: 'Push A', opId: 'save-a' , addToRotation: true });
    h.clockMs += DAY;
    const b = await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 80, reps: 5 }] }]);
    const savedB = await s.routines.saveFromSession({ sessionId: b, name: 'Legs B', opId: 'save-b' , addToRotation: true });
    if (!savedA.ok || !savedB.ok) throw new Error('routines not saved');
    h.clockMs += DAY;
    // Rotation: Legs B was done last, so Push A is up next. Make it unstartable (its exercise is gone).
    const file = s.developer.databaseNames().current;
    await h.forceClose();
    const raw = new DatabaseSync(join(h.dir, file));
    const row = raw.prepare('SELECT data FROM routines WHERE id = ?').get(savedA.routine.id) as { data: string };
    const doc = JSON.parse(row.data) as { exercises: { exerciseId: string }[] };
    for (const ex of doc.exercises) ex.exerciseId = '00000000-0000-4000-8000-00000000dead';
    raw.prepare('UPDATE routines SET data = ? WHERE id = ?').run(JSON.stringify(doc), savedA.routine.id);
    raw.close();
    s = (await h.launch()).services;

    // Push is still the day due (PM decision 18 Oct): its routine can't start, so its workout's next session.
    const card = await s.next.preview(gymId);
    expect(card).toMatchObject({ routine: null, sourceSessionId: a, title: 'Push' });
    const page = await s.overview.load({ target: { kind: 'next' }, gymId });
    if (!page) throw new Error('the overview must match Today’s Up next card');
    expect(page.startOf).toEqual({ nextOf: a });
    expect(page.view.title).toBe('Push');
    expect(page.view.rows.map((r) => r.name)).toEqual(['Bench press']);
    const started = await s.overview.start({ startOf: page.startOf, gymId, opId: 'op-s5', checkIn: null, expectedPreviewKey: page.view.previewKey });
    expect(started.ok).toBe(true);
  });

  it('an unreadable or missing target reads as null, never throws', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    expect(await s.overview.load({ target: { kind: 'next' }, gymId })).toBeNull();
    expect(await s.overview.load({ target: { kind: 'routine', routineId: 'missing' }, gymId })).toBeNull();
  });
});
