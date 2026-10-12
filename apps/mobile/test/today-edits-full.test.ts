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
 * Full edit before start through the app services on real SQLite
 * (overview-today-edits §11, slice B): sets, reps, today's load and an added
 * exercise as saved draft edits (versioned, idempotent, surviving a
 * force-close); Start creates exactly what the page shows; `Update Push A`
 * applies only the checked lines, with Undo; today's loads and added
 * exercises never reach the workout without Apply; nothing calls the coach.
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

/** Face pull done once (20 kg × 15); then Push A saved from a workout: bench, lateral raise, pushdown. */
async function withPushA(s: AppServices): Promise<{ gymId: string; routineId: string }> {
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 8 }, { load: 32.5, reps: 8 }, { load: 32.5, reps: 8 }] }]);
  h.clockMs += 2 * DAY;
  const pushA = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }, { load: 10, reps: 12 }] },
    { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }, { load: 25, reps: 12 }] },
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

/** The page's rows against the session Start created (TE-B2). */
function sameAsStart(page: OverviewData, agg: SessionAggregate): void {
  const ordered = [...agg.exercises].sort((a, b) => a.order - b.order);
  expect(ordered.map((e) => e.exerciseName)).toEqual(page.view.rows.map((r) => r.name));
  for (const [i, row] of page.view.rows.entries()) {
    const ex = ordered[i];
    const working = agg.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup' && x.pairedWithSetId === null).sort((a, b) => a.index - b.index);
    expect(row.editRow.workingSets).toBe(working.length);
    if (row.edit?.kind === 'skipped') continue;
    expect(row.load.value).toBe(loadCell(working[0]?.planned.load ?? null, ex?.loadConvention ?? 'total', null, false).value);
    expect(working[0]?.planned.reps ?? null).toEqual(row.editRow.reps);
  }
}

describe('Edit mode: sets, reps, load and add (TE-B1 to TE-B6, TE-B10, TE-B11)', () => {
  it('each edit applies at once to the saved draft; the page and Start agree; the draft survives a force-close; nothing calls the coach', async () => {
    let { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const before = await s.yourData.counts();
    const page = await load(s, gymId, routineId);
    const raise = rowNamed(page, 'Lateral raise');
    expect(raise.editRow).toMatchObject({ workingSets: 2, setsUp: { workingSets: 3, clear: false }, setsDown: { workingSets: 1, clear: false } });

    // [+]: one more set (2 taps from the overview).
    const up = raise.editRow.setsUp;
    if (up === null) throw new Error('no step');
    expect(await s.overview.edit({ ...base(page, gymId, routineId, 'sets-1'), edit: { kind: 'sets', slotKey: raise.slotKey, workingSets: up.workingSets } })).toMatchObject({ ok: true });
    // A retry of the same opId is the same write.
    expect(await s.overview.edit({ ...base(page, gymId, routineId, 'sets-1'), edit: { kind: 'sets', slotKey: raise.slotKey, workingSets: up.workingSets } })).toMatchObject({ ok: true, duplicate: true });
    const p2 = await load(s, gymId, routineId);
    expect(rowNamed(p2, 'Lateral raise')).toMatchObject({ marker: { kind: 'edited' }, editRow: { workingSets: 3, setsDown: { workingSets: 2, clear: true } } });
    expect(p2.view.workingSets).toBe(page.view.workingSets + 1);
    // An edit against the page before it (stale version): nothing written.
    expect(await s.overview.edit({ ...base(page, gymId, routineId, 'sets-old'), edit: { kind: 'sets', slotKey: raise.slotKey, workingSets: 5 } })).toMatchObject({ ok: false, reason: 'stale' });

    // Reps on the pushdown; Ben's load on bench (62.5 kg: makeable on the bar).
    const pushdown = rowNamed(p2, 'Triceps pushdown');
    expect((await s.overview.edit({ ...base(p2, gymId, routineId, 'reps-1'), edit: { kind: 'reps', slotKey: pushdown.slotKey, reps: { min: 8, max: 10 }, durationS: null } })).ok).toBe(true);
    const p3 = await load(s, gymId, routineId);
    const bench = rowNamed(p3, 'Bench press');
    expect(bench.editRow.keypad).toMatchObject({ unit: 'kg', convention: 'total' });
    const keypad = await s.overview.loadKeypad({ equipmentId: bench.editRow.keypad?.equipmentId ?? null, unit: 'kg', convention: 'total', value: 62.5 });
    expect(keypad.note).toBeNull();
    expect(keypad.up).toMatchObject({ enabled: true });
    expect((await s.overview.loadKeypad({ equipmentId: bench.editRow.keypad?.equipmentId ?? null, unit: 'kg', convention: 'total', value: 61 })).note).toMatch(/^Rounds to 60 kg here$/);
    expect((await s.overview.edit({ ...base(p3, gymId, routineId, 'load-1'), edit: { kind: 'load', slotKey: bench.slotKey, load: { value: 62.5, unit: 'kg', convention: 'total' } } })).ok).toBe(true);

    // Add an exercise: candidates are this gym's, not in today's plan; the pick goes at the end.
    const p4 = await load(s, gymId, routineId);
    const sheet = await s.overview.addCandidates({ target: targetOf(routineId), gymId, query: 'dumbbell bench', showAll: false });
    const pick = sheet?.rows.find((r) => r.name === 'Dumbbell bench press');
    expect(pick).toBeDefined();
    expect(sheet?.rows.map((r) => r.name)).not.toContain('Bench press');
    // Its own history (32.5 kg each), never bench's.
    expect(plain(pick?.targetText)).toMatch(/^3[25](\.5)? kg each × /);
    const added = await s.overview.edit({ ...base(p4, gymId, routineId, 'add-1'), edit: { kind: 'add', exerciseId: pick?.exerciseId ?? '' } });
    expect(added.ok).toBe(true);
    const p5 = await load(s, gymId, routineId);
    expect(p5.view.rows.map((r) => r.name)).toEqual(['Bench press', 'Lateral raise', 'Triceps pushdown', 'Dumbbell bench press']);
    expect(p5.view.rows[3]).toMatchObject({ marker: { kind: 'added' }, actions: { remove: true, skip: false, swap: false } });
    expect(rowNamed(p5, 'Bench press')).toMatchObject({ marker: { kind: 'edited' }, editRow: { benLoad: true } });
    expect(plain(rowNamed(p5, 'Bench press').editRow.loadText)).toBe('62.5 kg');
    expect(plain(rowNamed(p5, 'Triceps pushdown').editRow.repsText)).toBe('8–10 reps');
    expect(p5.view.editCount).toBe(4);
    // Nothing before Start; the workout itself unchanged (rule 2).
    expect(await s.sessions.active()).toBeNull();
    expect(await s.yourData.counts()).toEqual(before);
    expect((await s.routines.list()).find((r) => r.id === routineId)?.version).toBe(p5.routine?.version);

    // Force-close: all of it is there after relaunch.
    await h.forceClose();
    ({ services: s } = await h.launch());
    const p6 = await load(s, gymId, routineId);
    expect(p6.view.rows).toEqual(p5.view.rows);

    // Start: one transaction; the session is the page.
    const r = await startFromOverview({ start: (q) => s.overview.start(q), reload: () => s.overview.load({ target: targetOf(routineId), gymId }) }, { page: p6, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'started') throw new Error(r.kind);
    sameAsStart(p6, r.outcome.aggregate);
    expect(r.outcome.aggregate.session.todayEdits?.added).toHaveLength(1);
    expect(r.outcome.aggregate.session.todayEdits?.edited?.map((e) => e.kinds.join(',')).sort()).toEqual(['load', 'reps', 'sets']);
    expect(model.requests).toHaveLength(0);
  });

  it('Remove takes an added exercise out with its edits; the toast Undo brings both back; Use planned clears reps; a stepper back at the plan clears sets', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    const sheet = await s.overview.addCandidates({ target: targetOf(routineId), gymId, query: 'dumbbell bench', showAll: false });
    const pick = sheet?.rows[0];
    await s.overview.edit({ ...base(page, gymId, routineId, 'add-1'), edit: { kind: 'add', exerciseId: pick?.exerciseId ?? '' } });
    const p2 = await load(s, gymId, routineId);
    const addedRow = p2.view.rows.at(-1);
    if (addedRow?.edit?.kind !== 'added') throw new Error('not added');
    await s.overview.edit({ ...base(p2, gymId, routineId, 'sets-a'), edit: { kind: 'sets', slotKey: addedRow.slotKey, workingSets: 4 } });
    const p3 = await load(s, gymId, routineId);
    const removed = await s.overview.undoEdit({ ...base(p3, gymId, routineId, 'remove-1'), editId: addedRow.edit.editId });
    if (!removed.ok) throw new Error(removed.message);
    expect(removed.removed).toHaveLength(2);
    const p4 = await load(s, gymId, routineId);
    expect(p4.view.rows).toHaveLength(3);
    expect(p4.view.editCount).toBe(0);
    expect((await s.overview.restoreEdits({ ...base(p4, gymId, routineId, 'restore-1'), editIds: removed.removed })).ok).toBe(true);
    const p5 = await load(s, gymId, routineId);
    expect(p5.view.rows.at(-1)).toMatchObject({ marker: { kind: 'added' }, editRow: { workingSets: 4 } });

    // Reps, then Use planned.
    const raise = rowNamed(p5, 'Lateral raise');
    await s.overview.edit({ ...base(p5, gymId, routineId, 'reps-1'), edit: { kind: 'reps', slotKey: raise.slotKey, reps: { min: 15, max: 15 }, durationS: null } });
    const p6 = await load(s, gymId, routineId);
    expect(rowNamed(p6, 'Lateral raise').editRow.repsEdited).toBe(true);
    await s.overview.clearEdit({ ...base(p6, gymId, routineId, 'reps-clear'), kind: 'reps', slotKey: raise.slotKey });
    const p7 = await load(s, gymId, routineId);
    expect(rowNamed(p7, 'Lateral raise').editRow).toMatchObject({ repsEdited: false, reps: rowNamed(page, 'Lateral raise').editRow.reps });
    // Out of range: refused.
    expect(await s.overview.edit({ ...base(p7, gymId, routineId, 'sets-bad'), edit: { kind: 'sets', slotKey: raise.slotKey, workingSets: 11 } })).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('Update Push A (TE-B7 to TE-B9, TE-B13)', () => {
  it('lists the template-able edits (skip unchecked, loads never); Apply writes only the checked lines with one ben record; Undo restores the workout and the edits; refused once Push A moved', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    expect(page.templateCard).toBeNull();
    const raise = rowNamed(page, 'Lateral raise');
    await s.overview.edit({ ...base(page, gymId, routineId, 'e1'), edit: { kind: 'sets', slotKey: raise.slotKey, workingSets: 3 } });
    let p = await load(s, gymId, routineId);
    await s.overview.edit({ ...base(p, gymId, routineId, 'e2'), edit: { kind: 'skip', slotKey: rowNamed(p, 'Triceps pushdown').slotKey } });
    p = await load(s, gymId, routineId);
    await s.overview.edit({ ...base(p, gymId, routineId, 'e3'), edit: { kind: 'load', slotKey: rowNamed(p, 'Bench press').slotKey, load: { value: 62.5, unit: 'kg', convention: 'total' } } });
    p = await load(s, gymId, routineId);
    const card = p.templateCard;
    if (card === null) throw new Error('no card');
    expect(card.lines.map((l) => [l.label, plain(l.text), l.checked])).toEqual([
      ['Sets', 'Lateral raise 2 → 3', true],
      ['Removed', 'Triceps pushdown', false],
    ]);
    // Nothing changes until Apply (rule 2).
    const v0 = card.routineVersion;
    expect((await s.routines.list()).find((r) => r.id === routineId)?.version).toBe(v0);

    const req = { target: targetOf(routineId), gymId, routineId, expectedRoutineVersion: v0, draft: { id: p.draft?.id ?? '', expectedVersion: p.draft?.version ?? 0 }, lineKeys: card.lines.filter((l) => l.checked).map((l) => l.key), opId: 'upd-1' };
    const applied = await s.routines.applyTodayEdits(req);
    if (!applied.ok) throw new Error(applied.message);
    expect(applied.routine.version).toBe(v0 + 1);
    expect(applied.action).toMatchObject({ author: 'ben', detail: { kind: 'update_routine', changes: [{ change: 'edit' }] } });
    // The skip wasn't ticked: the pushdown stays; today's load isn't in the template.
    const slot = applied.routine.exercises.find((e) => e.id === raise.slotKey);
    expect(slot?.setTemplates.filter((t) => t.setType !== 'warmup')).toHaveLength(3);
    expect(applied.routine.exercises).toHaveLength(3);
    expect(applied.routine.exercises.flatMap((e) => e.setTemplates).some((t) => t.targetLoad?.value === 62.5)).toBe(false);
    expect(await s.routines.applyTodayEdits(req)).toMatchObject({ ok: true, duplicate: true });
    const after = await load(s, gymId, routineId);
    // The sets edit is now redundant: no marker; skip and load stay for today.
    expect(rowNamed(after, 'Lateral raise').marker.kind).not.toBe('edited');
    expect(rowNamed(after, 'Lateral raise').editRow.workingSets).toBe(3);
    expect(rowNamed(after, 'Triceps pushdown').marker.kind).toBe('skipped');
    expect(after.view.editCount).toBe(2);

    // Undo (revert): the workout and the sets edit come back.
    const undone = await s.routines.revert({ actionId: applied.action.actionId, opId: 'upd-undo' });
    expect(undone.ok).toBe(true);
    const back = await load(s, gymId, routineId);
    expect(rowNamed(back, 'Lateral raise').marker.kind).toBe('edited');
    expect(back.templateCard?.lines.map((l) => l.kind)).toEqual(['sets', 'remove']);

    // A card from before Push A moved: refused (rule 5), nothing written.
    const stale = await s.routines.applyTodayEdits({ ...req, opId: 'upd-2' });
    expect(stale).toMatchObject({ ok: false, reason: 'stale' });
    expect(model.requests).toHaveLength(0);
  });

  it('TE-B13: after a workout with an added exercise and an extra set (no Apply), the next Push A overview has the planned sets and no added exercise', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    const raise = rowNamed(page, 'Lateral raise');
    await s.overview.edit({ ...base(page, gymId, routineId, 'e1'), edit: { kind: 'sets', slotKey: raise.slotKey, workingSets: 3 } });
    let p = await load(s, gymId, routineId);
    const pick = (await s.overview.addCandidates({ target: targetOf(routineId), gymId, query: 'dumbbell bench', showAll: false }))?.rows[0];
    await s.overview.edit({ ...base(p, gymId, routineId, 'e2'), edit: { kind: 'add', exerciseId: pick?.exerciseId ?? '' } });
    p = await load(s, gymId, routineId);
    const r = await startFromOverview({ start: (q) => s.overview.start(q), reload: () => s.overview.load({ target: targetOf(routineId), gymId }) }, { page: p, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'started') throw new Error(r.kind);
    const loaded = await s.workout.load(r.outcome.aggregate.session.id);
    const fin = await s.workout.dispatch(r.outcome.aggregate.session.id, { type: 'discard', at: h.now(), opId: 'discard-1', expectedVersion: loaded?.aggregate.session.version ?? 0, confirmedLoggedSets: 0 });
    expect(fin.ok).toBe(true);
    const next = await load(s, gymId, routineId);
    expect(next.view.rows.map((x) => x.name)).toEqual(['Bench press', 'Lateral raise', 'Triceps pushdown']);
    expect(rowNamed(next, 'Lateral raise').editRow.workingSets).toBe(2);
    expect(next.draft).toBeNull();
  });
});
