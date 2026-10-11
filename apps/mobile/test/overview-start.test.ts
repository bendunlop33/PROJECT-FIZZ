import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formFromEquipment, loadCell, NBSP, type EquipmentForm, type OverviewRow } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { OverviewData, OverviewTarget } from '../src/services/workout-services';
import { checkInRow, startCheckIn } from '../src/workout/overview';
import { createGuard, samePage, saveScore, startEmptyFromOverview, startFromOverview, type OverviewStartPorts } from '../src/workout/overview-start';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * The overview screen's writes (review B1, S2, S6, S7) on real SQLite, through
 * the same functions the screen calls: a score then Start (the 4-tap flow), a
 * stale page then a retry with one opId, Empty workout's double tap, and the
 * no-gym Start.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});
const DAY = 86_400_000;
const NEXT: OverviewTarget = { kind: 'next' };

async function withRoutine(s: AppServices): Promise<{ gymId: string; routineId: string; first: string }> {
  const gymId = await setUpGym(h, s);
  const first = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] },
    { exercise: 'Barbell row', sets: [{ load: 50, reps: 10 }, { load: 50, reps: 10 }] },
  ]);
  const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1' });
  if (!saved.ok) throw new Error(saved.message);
  h.clockMs += 2 * DAY;
  return { gymId, routineId: saved.routine.id, first };
}

async function load(s: AppServices, gymId: string | null, checkInId: string | null = null): Promise<OverviewData> {
  const page = await s.overview.load({ target: NEXT, gymId, checkInId });
  if (!page) throw new Error('no overview');
  return page;
}

/** What the screen passes: Start, and a re-read with the check-in it sends. */
function ports(s: AppServices, gymId: string | null, checkInId: () => string | null): OverviewStartPorts & { starts: number; reloads: number } {
  const p = {
    starts: 0,
    reloads: 0,
    start: (q: Parameters<OverviewStartPorts['start']>[0]) => {
      p.starts += 1;
      return s.overview.start(q);
    },
    reload: () => {
      p.reloads += 1;
      return s.overview.load({ target: NEXT, gymId, checkInId: checkInId() });
    },
  };
  return p;
}

const scorePorts = (s: AppServices) => ({
  record: (q: { checkInId: string; opId: string; score: 1 | 2 | 3 | 4 | 5 }) => s.checkIns.record(q),
  update: (id: string, patch: { score: 1 | 2 | 3 | 4 | 5 }, v: number, op: string) => s.checkIns.update(id, patch, v, op),
  newOpId: h.ids,
});

function matchesSession(row: OverviewRow, agg: SessionAggregate): void {
  const ex = agg.exercises.find((e) => e.exerciseId === row.exerciseId);
  if (!ex) throw new Error(`no ${row.name}`);
  const working = agg.sets.filter((x) => x.sessionExerciseId === ex.id && x.setType !== 'warmup' && x.pairedWithSetId === null).sort((a, b) => a.index - b.index);
  expect(row.detail.startsWith(`${String(working.length)}${NBSP}×${NBSP}`)).toBe(true);
  expect(row.load.value).toBe(loadCell(working[0]?.planned.load ?? null, ex.loadConvention, null, false).value);
}

describe('B1: a score then Start (the 4-tap flow) starts at once, never a false Targets updated', () => {
  it('a score saved after the page loaded, Start with the page as rendered: one session, linked, no stale', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withRoutine(s);
    const page = await load(s, gymId);
    expect(page.checkIn.kind).toBe('ask');
    const CI = h.ids();
    const saved = await saveScore(scorePorts(s), { current: null, score: 4, checkInId: CI, opId: 'ci-op' });
    if (saved.kind !== 'saved') throw new Error(saved.kind);
    const checkIn = startCheckIn(page.checkIn, checkInRow(page.checkIn, saved.checkIn), h.now().utc);
    expect(checkIn).toEqual({ kind: 'answered', checkInId: CI });

    // The race the review reproduced: the page's key was read before the score.
    expect(await s.overview.start({ startOf: page.startOf, gymId, opId: 'probe', checkIn, expectedPreviewKey: page.view.previewKey })).toMatchObject({ ok: false, error: { code: 'stale_preview' } });
    expect(await s.sessions.active()).toBeNull();

    const p = ports(s, gymId, () => CI);
    const r = await startFromOverview(p, { page, opId: 'op-b1', checkIn });
    expect(r.kind).toBe('started');
    if (r.kind !== 'started') return;
    expect(r.outcome.aggregate.session.checkIn).toEqual({ kind: 'answered', checkInId: CI });
    expect(p.reloads).toBe(1);
    for (const row of page.view.rows) matchesSession(row, r.outcome.aggregate);
    expect((await s.yourData.counts()).unfinishedWorkouts).toBe(1);
  });

  it('Done in What’s up? (version bump, no pain) then Start: starts silently', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withRoutine(s);
    const CI = h.ids();
    const scored = await saveScore(scorePorts(s), { current: null, score: 2, checkInId: CI, opId: 'ci-op' });
    if (scored.kind !== 'saved') throw new Error(scored.kind);
    const page = await load(s, gymId, CI);
    const done = await s.checkIns.update(CI, { reasons: ['tired'], note: null }, scored.checkIn.version, 'ci-op:reasons');
    expect(done.ok).toBe(true);
    const r = await startFromOverview(ports(s, gymId, () => CI), { page, opId: 'op-done', checkIn: { kind: 'answered', checkInId: CI } });
    expect(r.kind).toBe('started');
  });

  it('a change Ben would see (a pain flag): nothing is created, the fresh page comes back; the retry reuses the opId', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withRoutine(s);
    const page = await load(s, gymId);
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 2 });
    if (!ci.ok) throw new Error(ci.message);
    const bench = page.view.rows[0];
    expect((await s.pain.flagFromCheckIn({ checkIn: ci.checkIn, exercises: [{ id: bench?.exerciseId ?? '', name: 'Bench press' }], area: 'shoulder', opId: 'pain-1' })).ok).toBe(true);

    const p = ports(s, gymId, () => null);
    const opId = 'op-one-per-page';
    const r = await startFromOverview(p, { page, opId, checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    expect(r.kind).toBe('stale');
    if (r.kind !== 'stale' || r.page === null) throw new Error('expected the fresh page');
    expect(samePage(page.view, r.page.view)).toBe(false);
    expect(r.page.view.rows[0]?.marker.kind).toBe('held');
    expect(await s.sessions.active()).toBeNull();
    // Ben taps Start again on the fresh page: the same opId starts once; a third tap is its duplicate.
    const again = await startFromOverview(p, { page: r.page, opId, checkIn: startCheckIn(r.page.checkIn, checkInRow(r.page.checkIn, null), h.now().utc) });
    expect(again.kind).toBe('started');
    const third = await startFromOverview(p, { page: r.page, opId, checkIn: null });
    expect(third).toMatchObject({ kind: 'started', outcome: { duplicate: true } });
    expect((await s.yourData.counts()).unfinishedWorkouts).toBe(1);
  });

  it('a routine deleted behind the page: Up next changes, so Start reads as stale and creates nothing', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withRoutine(s);
    const page = await load(s, gymId);
    const routine = page.routine;
    if (!routine) throw new Error('no routine');
    expect((await s.routines.remove({ routineId, expectedVersion: routine.version, opId: 'del' })).ok).toBe(true);
    const r = await startFromOverview(ports(s, gymId, () => null), { page, opId: 'op-gone', checkIn: null });
    expect(r.kind).toBe('stale');
    expect(await s.sessions.active()).toBeNull();
  });

  it('the screen guard: two Start taps in one frame make one call; a tap after it finishes runs', async () => {
    const guard = createGuard();
    let calls = 0;
    let release: () => void = () => undefined;
    const slow = () =>
      new Promise<string>((resolve) => {
        calls += 1;
        release = () => {
          resolve('done');
        };
      });
    const a = guard.run(slow);
    const b = guard.run(slow);
    expect(guard.running()).toBe(true);
    expect(await b).toBeNull();
    release();
    expect(await a).toBe('done');
    expect(guard.running()).toBe(false);
    const c = guard.run(() => Promise.resolve('again'));
    expect(await c).toBe('again');
    expect(calls).toBe(1);
    // A throwing write frees the guard.
    await expect(guard.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(guard.running()).toBe(false);
  });
});

describe('S7: the inline score', () => {
  it('first tap records the page’s check-in; another score updates it at its version; a stale one asks for a re-read', async () => {
    const { services: s } = await h.launch();
    await withRoutine(s);
    const CI = h.ids();
    const first = await saveScore(scorePorts(s), { current: null, score: 4, checkInId: CI, opId: 'ci-op' });
    if (first.kind !== 'saved') throw new Error(first.kind);
    // A retry of the first write (same ID and opId) is the same record, never a second one.
    expect(await saveScore(scorePorts(s), { current: null, score: 4, checkInId: CI, opId: 'ci-op' })).toMatchObject({ kind: 'saved', checkIn: { id: CI, version: first.checkIn.version } });
    const corrected = await saveScore(scorePorts(s), { current: first.checkIn, score: 2, checkInId: CI, opId: 'ci-op' });
    expect(corrected).toMatchObject({ kind: 'saved', checkIn: { id: CI, score: 2 } });
    // The same score again writes nothing.
    if (corrected.kind !== 'saved') return;
    expect(await saveScore(scorePorts(s), { current: corrected.checkIn, score: 2, checkInId: CI, opId: 'ci-op' })).toEqual({ kind: 'saved', checkIn: corrected.checkIn });
    // From an older read (version moved on): stale, nothing overwritten.
    expect(await saveScore(scorePorts(s), { current: first.checkIn, score: 5, checkInId: CI, opId: 'ci-op' })).toEqual({ kind: 'stale' });
    expect((await s.checkIns.get(CI))?.score).toBe(2);
  });

  it('a write that throws reads as failed with a message, never a silent no-op', async () => {
    const r = await saveScore({ record: () => Promise.reject(new Error('disk full')), update: () => Promise.reject(new Error('no')), newOpId: () => 'x' }, { current: null, score: 3, checkInId: 'c', opId: 'o' });
    expect(r).toEqual({ kind: 'failed', message: 'disk full' });
  });
});

describe('S2: Empty workout from the overview', () => {
  it('a double tap with the page’s one opId starts one workout; both taps read as started', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    // A check-in from a minute ago is reused (and linked); a due one would open the sheet.
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 4 });
    if (!ci.ok) throw new Error(ci.message);
    const port = { ensureGym: () => Promise.resolve(gymId), gate: () => s.checkIns.gate(), start: (q: Parameters<AppServices['workout']['start']>[0]) => s.workout.start(q) };
    const [a, b] = await Promise.all([startEmptyFromOverview(port, 'empty-op'), startEmptyFromOverview(port, 'empty-op')]);
    expect([a.kind, b.kind]).toEqual(['started', 'started']);
    expect((await s.yourData.counts()).unfinishedWorkouts).toBe(1);
    expect((await s.sessions.active())?.session.checkIn).toEqual({ kind: 'answered', checkInId: ci.checkIn.id });
    // Another page's opId with this workout active: Today's Resume.
    expect(await startEmptyFromOverview({ ...port, gate: () => Promise.resolve({ kind: 'skip', reason: 'off' }) }, 'other-op')).toEqual({ kind: 'active' });
  });

  it('a due check-in opens the sheet (nothing started); no gym and none can be made reads as failed', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    expect((await s.checkIns.gate()).kind).toBe('ask');
    const port = { ensureGym: () => Promise.resolve(gymId), gate: () => s.checkIns.gate(), start: (q: Parameters<AppServices['workout']['start']>[0]) => s.workout.start(q) };
    expect(await startEmptyFromOverview(port, 'e1')).toEqual({ kind: 'ask', gymId });
    expect(await startEmptyFromOverview({ ...port, ensureGym: () => Promise.resolve(null) }, 'e2')).toEqual({ kind: 'failed' });
    expect(await startEmptyFromOverview({ ...port, gate: () => Promise.reject(new Error('read failed')) }, 'e3')).toEqual({ kind: 'failed' });
    expect(await s.sessions.active()).toBeNull();
  });
});

describe('S6: the no-gym Start and OV4 inputs', () => {
  /** A routine and its workout, then the gym archived: Ben has history but no gym. */
  async function noGym(): Promise<{ s: AppServices; oldGymId: string }> {
    let { services: s } = await h.launch();
    const { gymId } = await withRoutine(s);
    const file = s.developer.databaseNames().current;
    await h.forceClose();
    const db = new DatabaseSync(join(h.dir, file));
    db.prepare("UPDATE gyms SET data = json_set(data, '$.archivedAtUtc', '2026-10-11T07:30:00.000Z') WHERE id = ?").run(gymId);
    db.close();
    s = (await h.launch()).services;
    expect(await s.yourData.currentGym()).toBeNull();
    return { s, oldGymId: gymId };
  }

  it('no gym: the rows are fitted to the typical gym, Start saves it and starts with the same rows; a retry reuses both', async () => {
    const { s, oldGymId } = await noGym();
    const page = await load(s, null);
    expect(page.view.gym).toBeNull();
    const req = { startOf: page.startOf, gymId: null, opId: 'op-nogym', checkIn: null, expectedPreviewKey: page.view.previewKey };

    // The first write fails after the typical gym was saved (the session write threw).
    const real = s.workout.start.bind(s.workout);
    let fail = true;
    s.workout.start = async (q) => {
      if (fail) {
        fail = false;
        return { ok: false, error: { code: 'write_failed', message: 'disk' } };
      }
      return real(q);
    };
    expect(await s.overview.start(req)).toMatchObject({ ok: false, error: { code: 'write_failed' } });
    const gyms = await s.yourData.gyms();
    expect(gyms).toHaveLength(1);
    expect(gyms[0]?.id).not.toBe(oldGymId);
    expect(await s.sessions.active()).toBeNull();

    // The retry (same opId, same page): the saved typical gym is reused, the key still matches, one session.
    const started = await s.overview.start(req);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.aggregate.session.gymId).toBe(gyms[0]?.id);
    for (const row of page.view.rows) matchesSession(row, started.aggregate);
    expect(await s.overview.start(req)).toMatchObject({ ok: true, duplicate: true });
    expect(await s.yourData.gyms()).toHaveLength(1);
    s.workout.start = real;
  });

  it('OV4: a gym equipment edit after the page opened creates nothing', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withRoutine(s);
    const page = await load(s, gymId);
    const bar = (await s.gyms.detail(gymId))?.equipment.find((e) => e.equipment.kind === 'barbell')?.equipment;
    if (!bar) throw new Error('no bar');
    const fewer = { ...formFromEquipment(bar), plates: [{ mass: 20, count: 2 }, { mass: 10, count: 2 }] } as EquipmentForm;
    expect((await s.gyms.save({ gymId, equipmentId: bar.id, expectedVersion: bar.version, form: fewer })).ok).toBe(true);
    expect(await s.overview.start({ startOf: page.startOf, gymId, opId: 'op-eq', checkIn: null, expectedPreviewKey: page.view.previewKey })).toMatchObject({ ok: false, error: { code: 'stale_preview' } });
    expect(await s.sessions.active()).toBeNull();
    expect((await load(s, gymId)).view.previewKey).not.toBe(page.view.previewKey);
  });

  it('OV4: a correction to the source workout (revision bump) creates nothing', async () => {
    const { services: s } = await h.launch();
    const { gymId, first } = await withRoutine(s);
    const page = await load(s, gymId);
    const set = (await s.workout.load(first))?.aggregate.sets.find((x) => x.status === 'completed');
    if (!set) throw new Error('no set');
    const corrected = await s.workout.correctSet({ sessionId: first, setId: set.id, expectedSetVersion: set.version, patch: { reps: 6 }, opId: 'fix-1' });
    expect(corrected.ok).toBe(true);
    expect(await s.overview.start({ startOf: page.startOf, gymId, opId: 'op-src', checkIn: null, expectedPreviewKey: page.view.previewKey })).toMatchObject({ ok: false, error: { code: 'stale_preview' } });
    expect(await s.sessions.active()).toBeNull();
  });

  it('OV4: a check-in score changed after the page opened (key input) creates nothing when Start sends it', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await withRoutine(s);
    const CI = h.ids();
    const ci = await s.checkIns.record({ checkInId: CI, opId: 'ci', score: 4 });
    if (!ci.ok) throw new Error(ci.message);
    const page = await load(s, gymId, CI);
    expect(page.planCheckIn?.id).toBe(CI);
    expect((await s.checkIns.update(CI, { score: 3 }, ci.checkIn.version, 'ci-2')).ok).toBe(true);
    expect(await s.overview.start({ startOf: page.startOf, gymId, opId: 'op-ci', checkIn: { kind: 'answered', checkInId: CI }, expectedPreviewKey: page.view.previewKey })).toMatchObject({ ok: false, error: { code: 'stale_preview' } });
    expect(await s.sessions.active()).toBeNull();
  });
});
