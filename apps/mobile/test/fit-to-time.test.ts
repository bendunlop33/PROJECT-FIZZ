import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { howLongSheet, NBSP, type OverviewRow } from '@fizz/domain';
import type { TextCoachState } from '@fizz/providers';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { OverviewData } from '../src/services/workout-services';
import { startFromOverview } from './overview-driver';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Fit to time through the app services on real SQLite (fit-to-time.md,
 * slice C, built-in trim): `How long?` → `Trim to N min` writes the fit as
 * intent to the saved draft (versioned, idempotent, surviving a
 * force-close), the page shows the card, TRIMMED rows and the tile, Start
 * creates exactly what the page shows with Finish by, Undo and Clear fit
 * restore the plan, and nothing calls the coach (FT-C1, C4, C5, C8, C9, C17).
 */

class NeverModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  // eslint-disable-next-line require-yield
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    await Promise.resolve();
    throw new Error('the built-in trim never calls the coach');
  }
}
const OFFLINE: TextCoachState = { status: 'not_connected' } as TextCoachState;
const DAY = 86_400_000;
const plain = (s: string | null | undefined): string => (s ?? '').replaceAll(NBSP, ' ');

let h: Harness;
let model: NeverModel;
beforeEach(() => {
  model = new NeverModel();
  h = createHarness('2026-10-10T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(OFFLINE) } });
});
afterEach(async () => {
  await h.cleanup();
});

/** Push A saved from a workout: bench, lateral raise, triceps pushdown, face pull (`n` sets each). */
async function withPushA(s: AppServices, n = 3): Promise<{ gymId: string; routineId: string }> {
  const gymId = await setUpGym(h, s);
  const three = (load: number, reps: number) => Array.from({ length: n }, () => ({ load, reps }));
  const pushA = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: three(60, 8) },
    { exercise: 'Lateral raise', sets: three(10, 12) },
    { exercise: 'Triceps pushdown', sets: three(25, 12) },
    { exercise: 'Face pull', sets: three(20, 12) },
  ]);
  const saved = await s.routines.saveFromSession({ sessionId: pushA, name: 'Push A', opId: 'save-1', addToRotation: true });
  if (!saved.ok) throw new Error(saved.message);
  h.clockMs += 2 * DAY;
  return { gymId, routineId: saved.routine.id };
}

const targetOf = (routineId: string) => ({ kind: 'routine' as const, routineId });
async function load(s: AppServices, gymId: string, routineId: string): Promise<OverviewData> {
  const page = await s.overview.load({ target: targetOf(routineId), gymId });
  if (!page) throw new Error('no overview');
  return page;
}
const rowNamed = (page: OverviewData, name: string): OverviewRow => {
  const r = page.view.rows.find((x) => x.name === name);
  if (!r) throw new Error(`no ${name}`);
  return r;
};
const base = (page: OverviewData, gymId: string, routineId: string, opId: string) => ({ target: targetOf(routineId), gymId, expectedDraftVersion: page.draft?.version ?? null, opId });

/** The page's rows against the session Start created, skipped and trimmed sets included (FT-C5). */
function sameAsStart(page: OverviewData, agg: SessionAggregate): void {
  const ordered = [...agg.exercises].sort((a, b) => a.order - b.order);
  expect(ordered.map((e) => e.exerciseName)).toEqual(page.view.rows.map((r) => r.name));
  for (const [i, row] of page.view.rows.entries()) {
    const ex = ordered[i];
    const sets = agg.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup' && x.pairedWithSetId === null);
    if (row.edit?.kind === 'skipped') {
      expect(sets.every((x) => x.status === 'skipped' && x.skippedBy === 'before_start')).toBe(true);
      continue;
    }
    expect(sets.filter((x) => x.status === 'pending')).toHaveLength(row.editRow.workingSets);
  }
  const pendingWorking = agg.sets.filter((x) => x.status === 'pending' && x.setType !== 'warmup' && x.pairedWithSetId === null).length;
  expect(pendingWorking).toBe(page.view.workingSets);
}

describe('How long? → Trim (FT-C1, FT-C4, FT-C9)', () => {
  it('Now equals the tile; Trim writes the fit to the draft at once, offline; the page shows the card, TRIMMED rows and `Time · fit N`', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    expect(page.view.fit).toBeNull();
    const now = page.view.estimate;
    if (now === null) throw new Error('no estimate');
    const sheet = howLongSheet({ nowSeconds: now.seconds, nowMinutes: now.minutes, unfittedSeconds: now.seconds, fitMinutes: null, chosen: null, coachAvailable: false });
    expect(sheet.nowText).toBe(`Now ≈ ${String(now.minutes)} min`);
    expect(sheet.ask).toMatchObject({ enabled: false, caption: 'Coach offline' });
    // A length well under Now, so the trim has work.
    const minutes = Math.max(15, 5 * Math.floor((now.seconds / 60 - 8) / 5));
    const r = await s.overview.trimToFit({ ...base(page, gymId, routineId, 'fit-1'), minutes });
    expect(r).toMatchObject({ ok: true, duplicate: false });
    // A retry of the same opId is the same write; a stale version writes nothing.
    expect(await s.overview.trimToFit({ ...base(page, gymId, routineId, 'fit-1'), minutes })).toMatchObject({ ok: true, duplicate: true });
    expect(await s.overview.trimToFit({ ...base(page, gymId, routineId, 'fit-old'), minutes: 15 })).toMatchObject({ ok: false, reason: 'stale' });
    const fitted = await load(s, gymId, routineId);
    expect(fitted.view.fit).toMatchObject({ by: 'built_in', minutes, tileLabel: `Time · fit ${String(minutes)}` });
    expect(fitted.view.fit?.lines.length).toBeGreaterThan(0);
    expect(fitted.view.estimate?.seconds).toBeLessThan(now.seconds);
    expect(fitted.view.workingSets).toBeLessThan(page.view.workingSets);
    // Bench is the main lift: never skipped.
    expect(rowNamed(fitted, 'Bench press').edit).toBeNull();
    const cut = fitted.view.rows.filter((x) => x.marker.kind === 'trimmed' || x.marker.kind === 'skipped');
    expect(cut.length).toBeGreaterThan(0);
    expect(plain(fitted.view.fit?.beforeAfter)).toMatch(/^≈ \d+ → \d+ min$|^≈ \d+ min · \d+ over \d+$/);
    // The fit isn't one of Ben's edits on the list header.
    expect(fitted.view.editCount).toBe(0);
    expect(model.requests).toHaveLength(0);
  });

  it('a length the plan already fits writes nothing (`Fits already`)', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    const r = await s.overview.trimToFit({ ...base(page, gymId, routineId, 'fit-long'), minutes: 180 });
    expect(r).toMatchObject({ ok: true, draft: null });
    const again = await load(s, gymId, routineId);
    expect(again.draft).toBeNull();
    expect(again.view.fit).toBeNull();
  });
});

describe('Start, Undo, Clear, force-close (FT-C5, FT-C8, FT-C17)', () => {
  it('Start creates exactly the fitted page, with Finish by = start + minutes rounded up to 5 and `fitted` on the session', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    const minutes = Math.max(15, 5 * Math.floor(((page.view.estimate?.seconds ?? 0) / 60 - 8) / 5));
    expect((await s.overview.trimToFit({ ...base(page, gymId, routineId, 'fit-s'), minutes })).ok).toBe(true);
    const fitted = await load(s, gymId, routineId);
    h.clockMs += 37_000;
    const started = await startFromOverview({ start: (q) => s.overview.start(q), reload: () => s.overview.load({ target: targetOf(routineId), gymId }) }, { page: fitted, opId: 'start-fit', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (started.kind !== 'started') throw new Error(started.kind);
    const agg = started.outcome.aggregate;
    sameAsStart(fitted, agg);
    const startMs = Date.parse(agg.session.startedAt.utc);
    const expected = Math.ceil((startMs + minutes * 60_000) / 300_000) * 300_000;
    expect(agg.session.finishBy?.utc).toBe(new Date(expected).toISOString());
    expect(agg.session.todayEdits?.fitted).toMatchObject({ minutes, by: 'built_in' });
    // It was saved like that (a re-read after a force-close is the same).
    const { services: s2 } = await h.launch();
    const reread = await s2.workout.load(agg.session.id);
    expect(reread?.aggregate.session.finishBy).toEqual(agg.session.finishBy);
    expect(reread?.aggregate.sets.map((x) => x.status)).toEqual(agg.sets.map((x) => x.status));
  });

  it('Undo restores the plan exactly (rows, SETS, TIME); Clear fit and its Undo; the fit survives a force-close', async () => {
    let { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    const minutes = Math.max(15, 5 * Math.floor(((page.view.estimate?.seconds ?? 0) / 60 - 8) / 5));
    const w = await s.overview.trimToFit({ ...base(page, gymId, routineId, 'fit-u'), minutes });
    if (!w.ok) throw new Error('no write');
    // Force-close: the fit is in the saved draft.
    ({ services: s } = await h.launch());
    const fitted = await load(s, gymId, routineId);
    expect(fitted.view.fit?.minutes).toBe(minutes);
    const fitEdit = fitted.view.fit?.editId ?? '';
    expect((await s.overview.undoEdit({ ...base(fitted, gymId, routineId, 'undo-fit'), editId: fitEdit })).ok).toBe(true);
    const back = await load(s, gymId, routineId);
    expect(back.view.fit).toBeNull();
    expect(back.view.workingSets).toBe(page.view.workingSets);
    expect(back.view.estimate).toEqual(page.view.estimate);
    expect(back.view.rows.map((r) => [r.name, r.detail, r.marker.kind])).toEqual(page.view.rows.map((r) => [r.name, r.detail, r.marker.kind]));
    // Trim again, then Clear fit; the toast's Undo brings it back.
    expect((await s.overview.trimToFit({ ...base(back, gymId, routineId, 'fit-again'), minutes })).ok).toBe(true);
    const again = await load(s, gymId, routineId);
    const cleared = await s.overview.clearFit(base(again, gymId, routineId, 'clear-fit'));
    if (!cleared.ok) throw new Error('not cleared');
    expect((await load(s, gymId, routineId)).view.fit).toBeNull();
    const p4 = await load(s, gymId, routineId);
    expect((await s.overview.restoreEdits({ ...base(p4, gymId, routineId, 'restore-fit'), editIds: cleared.removed })).ok).toBe(true);
    expect((await load(s, gymId, routineId)).view.fit?.minutes).toBe(minutes);
    expect(model.requests).toHaveLength(0);
  });

  it('Bring back on a fit-skipped row is Ben’s sets edit; the trim never touches that row again (FT5, FT-C7)', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s, 5);
    const page = await load(s, gymId, routineId);
    expect((await s.overview.trimToFit({ ...base(page, gymId, routineId, 'fit-b'), minutes: 15 })).ok).toBe(true);
    const fitted = await load(s, gymId, routineId);
    const skipped = fitted.view.rows.find((r) => r.edit?.kind === 'skipped');
    if (skipped?.edit?.kind !== 'skipped' || skipped.edit.fitKeep === undefined) throw new Error('nothing fit-skipped');
    expect(skipped.actions.bringBack).toBe(true);
    expect((await s.overview.edit({ ...base(fitted, gymId, routineId, 'bring-back'), edit: { kind: 'sets', slotKey: skipped.slotKey, workingSets: skipped.edit.fitKeep } })).ok).toBe(true);
    const after = await load(s, gymId, routineId);
    const row = after.view.rows.find((r) => r.slotKey === skipped.slotKey);
    expect(row?.edit).toBeNull();
    expect(row?.editRow.workingSets).toBe(skipped.edit.fitKeep);
    expect(row?.marker.kind).toBe('edited');
    expect(after.view.fit?.lines.some((l) => l.startsWith(`${skipped.name} ·`))).toBe(false);
  });
});
