import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { loadCell, NBSP, type OverviewRow } from '@fizz/domain';
import type { TextCoachState } from '@fizz/providers';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { OverviewData } from '../src/services/workout-services';
import { coachPill, coachTapOf, coachUndoneText, createGuard, startFromOverview, undoGymSwitch } from './overview-driver';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * The overview after the gym-switch and coach v1 merge, on real SQLite:
 * the preview is the shared fit Start uses (`snapPlanToGym` through
 * `planRoutineStart`), also after the gym chip changes gym; coach rows read
 * the coach's stored next-session targets only (opening the page makes no
 * model call), and Undo / `Use coach target` are the Summary's versioned taps.
 */

class StepModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: ((req: ModelRequest) => ModelEvent[])[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1];
    const events = step === undefined ? [{ type: 'error' as const, error: 'unavailable' as const }] : step(request);
    for (const e of events) {
      await Promise.resolve();
      yield e;
    }
  }
}

function workoutOf(req: ModelRequest): { sessionId: string; version: number; exercises: { exerciseId: string; name: string }[] } {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { workout: ReturnType<typeof workoutOf> }).workout;
}

const call = (name: string, args: unknown): ModelEvent[] => [{ type: 'tool_call', callId: `c-${name}`, name, arguments: JSON.stringify(args) }, { type: 'completed' }];
const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };
const DAY = 86_400_000;

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-10T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function load(s: AppServices, gymId: string): Promise<OverviewData> {
  const page = await s.overview.load({ target: { kind: 'next' }, gymId });
  if (!page) throw new Error('no overview');
  return page;
}

/** Every pending set Start made, against the row the page showed for it. */
function matchesSession(row: OverviewRow, agg: SessionAggregate): void {
  const ex = agg.exercises.find((e) => e.exerciseId === row.exerciseId);
  if (!ex) throw new Error(`no ${row.name}`);
  const working = agg.sets.filter((x) => x.sessionExerciseId === ex.id && x.setType !== 'warmup' && x.pairedWithSetId === null).sort((a, b) => a.index - b.index);
  expect(row.detail.startsWith(`${String(working.length)}${NBSP}×${NBSP}`)).toBe(true);
  expect(row.load.value).toBe(loadCell(working[0]?.planned.load ?? null, ex.loadConvention, null, false).value);
}

const ports = (s: AppServices, gymId: string) => ({
  start: (q: Parameters<AppServices['overview']['start']>[0]) => s.overview.start(q),
  reload: () => s.overview.load({ target: { kind: 'next' }, gymId }),
});

describe('preview == Start after a gym switch (shared fit)', () => {
  it('the gym chip switches gym: the rows re-fit by snapPlanToGym, and Start at that gym creates exactly them', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] },
      { exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 10 }, { load: 32.5, reps: 10 }] },
    ]);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1' , addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    h.clockMs += 2 * DAY;
    const hotelId = h.ids();
    expect((await s.setup.saveGym({ gymId: hotelId, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);

    const main = await load(s, gymId);
    const mainDb = main.view.rows.find((r) => r.name === 'Dumbbell bench press');
    expect(mainDb?.rounded).toBe(false);
    // No coach rows without stored coach targets.
    expect(main.view.rows.every((r) => r.coach === null)).toBe(true);
    expect(main.coachTargets).toEqual({});

    // What the chip does: select the gym, then the page re-reads at it.
    expect(await s.gyms.select(hotelId)).toMatchObject({ ok: true, changed: true });
    const hotel = await load(s, hotelId);
    expect(hotel.view.previewKey).not.toBe(main.view.previewKey);
    const db = hotel.view.rows.find((r) => r.name === 'Dumbbell bench press');
    const bench = hotel.view.rows.find((r) => r.name === 'Bench press');
    // The hotel rack stops at 25 kg: capped, never above its max (rule 4).
    expect(db?.load.value).toBe('25');
    expect(db?.rounded).toBe(true);
    expect(db?.panel.find((l) => l.key === 'rounded')?.value.replaceAll(NBSP, ' ')).toBe('Rack tops out at 25 kg each');
    // No barbell: reps kept, no load target, and the panel names what's missing.
    expect(bench?.load.value).toBe('—');
    expect(bench?.missingEquipment).not.toBeNull();

    const r = await startFromOverview(ports(s, hotelId), { page: hotel, opId: 'op-hotel', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'started') throw new Error(r.kind);
    const agg = r.outcome.aggregate;
    expect(agg.session.gymId).toBe(hotelId);
    for (const row of hotel.view.rows) matchesSession(row, agg);
    // The saved fit is the one the preview showed.
    const dbEx = agg.exercises.find((e) => e.exerciseName === 'Dumbbell bench press');
    const benchEx = agg.exercises.find((e) => e.exerciseName === 'Bench press');
    const dbSets = agg.sets.filter((x) => x.sessionExerciseId === dbEx?.id && x.setType !== 'warmup');
    const benchSets = agg.sets.filter((x) => x.sessionExerciseId === benchEx?.id && x.setType !== 'warmup');
    expect(dbSets.every((x) => x.planned.snap?.outcome === 'capped' && x.planned.snap.by === 'start' && x.planned.load?.value === 25)).toBe(true);
    expect(benchSets.every((x) => x.planned.load === null && x.planned.snap?.outcome === 'dropped' && x.planned.snap.reason === 'not_here')).toBe(true);
  });
});

describe('coach rows (§5): stored targets only, Undo / Use coach target', () => {
  /** A stored coach target for Bench press: 57.5 kg (small, saved) or 50 kg (bigger, proposed). From a routine, or the last workout (`nextOf`). */
  async function withCoachTarget(opts: { load?: number; routine?: boolean } = {}) {
    const { load: kgs = 57.5, routine = true } = opts;
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 7, rpe: 10 }, { load: 60, reps: 6, rpe: 10 }] },
      { exercise: 'Barbell row', sets: [{ load: 50, reps: 10 }, { load: 50, reps: 10 }] },
    ]);
    if (routine) {
      const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1' , addToRotation: true });
      if (!saved.ok) throw new Error(saved.message);
    }
    model = new StepModel([
      (req) => {
        const w = workoutOf(req);
        const bench = w.exercises.find((e) => e.name === 'Bench press');
        return call('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: bench?.exerciseId, target: { load: { value: kgs, unit: 'kg', convention: 'total' }, reps: null }, sets: null, reason: 'Every set was RPE 10.' }] });
      },
      () => call('reply', { message: 'Ok.', offer: null }),
    ]);
    await s.coach.runSummaryTurn(first);
    h.clockMs += 2 * DAY;
    return { s, gymId, first };
  }

  it('the row the coach set shows the Coach state and its stored reason; opening the page makes no model call', async () => {
    const { s, gymId } = await withCoachTarget();
    const calls = model.requests.length;
    const page = await load(s, gymId);
    expect(model.requests.length).toBe(calls);
    const bench = page.view.rows.find((r) => r.name === 'Bench press');
    const row = page.view.rows.find((r) => r.name === 'Barbell row');
    expect(bench?.coach).toMatchObject({ state: 'coach', reason: 'Every set was RPE 10.' });
    expect(bench?.panel.find((l) => l.key === 'coach')).toMatchObject({ label: 'Coach', value: '“Every set was RPE 10.”' });
    expect(bench?.load.value).toBe('57.5');
    expect(bench?.accessibilityLabel).toContain('coach target');
    expect(row?.coach).toBeNull();
    expect(row?.panel.some((l) => l.key === 'coach')).toBe(false);
    // Start creates the coach's target the page showed.
    const r = await startFromOverview(ports(s, gymId), { page, opId: 'op-coach', checkIn: null });
    if (r.kind !== 'started') throw new Error(r.kind);
    for (const x of page.view.rows) matchesSession(x, r.outcome.aggregate);
    expect(model.requests.length).toBe(calls);
  });

  it('Undo puts the built-in target back (key changes, the old page is stale); Use coach target restores it; a stale version is refused', async () => {
    const { s, gymId } = await withCoachTarget();
    const page = await load(s, gymId);
    const bench = page.view.rows.find((r) => r.name === 'Bench press');
    if (bench?.coach?.state !== 'coach') throw new Error('no coach row');
    const record = page.coachTargets[bench.coach.rowId];
    if (!record) throw new Error('no record');

    const undone = await s.coach.tapNextTarget(record, coachTapOf('coach', record.status), 'tap-undo');
    expect(undone).toMatchObject({ status: 'written', row: { status: 'undone' } });
    expect(coachUndoneText('Bench press')).toBe('Bench press · coach target undone');
    const after = await load(s, gymId);
    const benchAfter = after.view.rows.find((r) => r.name === 'Bench press');
    expect(benchAfter?.coach).toEqual({ state: 'built_in', rowId: record.id, putBack: 'use_coach', target: `57.5${NBSP}kg${NBSP}×${NBSP}3–6` });
    expect(benchAfter?.load.value).not.toBe('57.5');
    // No reason line now; the coach's target as a value, so `Use coach target` isn't blind (merge N2).
    expect(benchAfter?.panel.filter((l) => l.key === 'coach')).toEqual([{ key: 'coach', label: 'Coach', value: `57.5${NBSP}kg${NBSP}×${NBSP}3–6`, tone: 'normal' }]);
    expect(after.view.previewKey).not.toBe(page.view.previewKey);
    // Start against the page as it was before the Undo creates nothing (rule 5).
    expect(await s.overview.start({ startOf: page.startOf, gymId, opId: 'op-stale', checkIn: null, expectedPreviewKey: page.view.previewKey })).toMatchObject({ ok: false, error: { code: 'stale_preview' } });
    expect(await s.sessions.active()).toBeNull();

    // A tap with the version the old page had is refused, never applied to newer state.
    expect(await s.coach.tapNextTarget(record, 'undo', 'tap-stale')).toMatchObject({ status: 'not_possible', reason: 'changed_since' });

    const latest = after.coachTargets[record.id];
    if (!latest) throw new Error('no record');
    expect(await s.coach.tapNextTarget(latest, coachTapOf('built_in', record.status), 'tap-use')).toMatchObject({ status: 'written', row: { status: 'saved' } });
    const back = await load(s, gymId);
    expect(back.view.rows.find((r) => r.name === 'Bench press')?.coach).toMatchObject({ state: 'coach' });
    expect(back.view.rows.find((r) => r.name === 'Bench press')?.load.value).toBe('57.5');
  });

  it('a pain flag on the movement holds the coach’s target: no Coach row and no offer to put it back', async () => {
    const { s, gymId } = await withCoachTarget();
    const page = await load(s, gymId);
    const bench = page.view.rows.find((r) => r.name === 'Bench press');
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 2 });
    if (!ci.ok) throw new Error(ci.message);
    expect((await s.pain.flagFromCheckIn({ checkIn: ci.checkIn, exercises: [{ id: bench?.exerciseId ?? '', name: 'Bench press' }], area: 'shoulder', opId: 'pain-1' })).ok).toBe(true);
    const flagged = await load(s, gymId);
    expect(flagged.view.rows.find((r) => r.name === 'Bench press')?.coach).toBeNull();
  });

  it('a bigger change: Apply on the page; Undo, then a reload still offers Apply, which puts it back (merge S1)', async () => {
    const { s, gymId } = await withCoachTarget({ load: 50 });
    const page = await load(s, gymId);
    const bench = page.view.rows.find((r) => r.name === 'Bench press');
    if (bench?.coach?.state !== 'built_in') throw new Error('no proposed row');
    expect(bench.coach.putBack).toBe('apply');
    expect(coachPill(bench.coach)).toEqual({ label: 'Apply', tap: 'apply' });
    // The tap isn't blind: the panel shows the stored target (N2); Start still uses the built-in rule.
    expect(bench.panel.find((l) => l.key === 'coach')?.value).toBe(`50${NBSP}kg${NBSP}×${NBSP}3–6`);
    expect(bench.load.value).not.toBe('50');
    const proposed = page.coachTargets[bench.coach.rowId];
    if (!proposed) throw new Error('no record');
    expect(proposed.status).toBe('proposed');

    expect(await s.coach.tapNextTarget(proposed, coachPill(bench.coach).tap, 'tap-apply')).toMatchObject({ status: 'written', row: { status: 'applied' } });
    const applied = await load(s, gymId);
    const benchApplied = applied.view.rows.find((r) => r.name === 'Bench press');
    if (benchApplied?.coach?.state !== 'coach') throw new Error('not applied');
    expect(benchApplied.load.value).toBe('50');
    expect(coachPill(benchApplied.coach)).toEqual({ label: 'Undo', tap: 'undo' });
    const appliedRecord = applied.coachTargets[benchApplied.coach.rowId];
    if (!appliedRecord) throw new Error('no record');

    // Undo, and the toast's 8 seconds pass: the reloaded page still offers Apply.
    expect(await s.coach.tapNextTarget(appliedRecord, 'undo', 'tap-undo')).toMatchObject({ status: 'written', row: { status: 'proposed' } });
    const undone = await load(s, gymId);
    const benchUndone = undone.view.rows.find((r) => r.name === 'Bench press');
    if (benchUndone?.coach?.state !== 'built_in') throw new Error('no way back');
    expect(coachPill(benchUndone.coach)).toEqual({ label: 'Apply', tap: 'apply' });
    expect(benchUndone.load.value).not.toBe('50');
    const latest = undone.coachTargets[benchUndone.coach.rowId];
    if (!latest) throw new Error('no record');
    // A tap with the applied version is stale (rule 5).
    expect(await s.coach.tapNextTarget(appliedRecord, 'undo', 'tap-stale')).toMatchObject({ status: 'not_possible', reason: 'changed_since' });

    expect(await s.coach.tapNextTarget(latest, coachPill(benchUndone.coach).tap, 'tap-apply-again')).toMatchObject({ status: 'written', row: { status: 'applied' } });
    const again = await load(s, gymId);
    expect(again.view.rows.find((r) => r.name === 'Bench press')?.coach).toMatchObject({ state: 'coach' });
    const r = await startFromOverview(ports(s, gymId), { page: again, opId: 'op-applied', checkIn: null });
    if (r.kind !== 'started') throw new Error(r.kind);
    for (const x of again.view.rows) matchesSession(x, r.outcome.aggregate);
  });

  it('a double tap on Undo sends one tap: no refused second tap replacing the Undo toast (merge N1)', async () => {
    const { s, gymId } = await withCoachTarget();
    const page = await load(s, gymId);
    const bench = page.view.rows.find((r) => r.name === 'Bench press');
    if (bench?.coach?.state !== 'coach') throw new Error('no coach row');
    const record = page.coachTargets[bench.coach.rowId];
    if (!record) throw new Error('no record');
    const guard = createGuard();
    const tap = (opId: string) => guard.run(() => s.coach.tapNextTarget(record, coachPill(bench.coach as NonNullable<typeof bench.coach>).tap, opId));
    const [one, two] = await Promise.all([tap('tap-1'), tap('tap-2')]);
    expect(one).toMatchObject({ status: 'written', row: { status: 'undone' } });
    expect(two).toBeNull();
  });

  it('from the last workout (nextOf, no routine): the same Coach row, Undo and Use coach target (merge N5)', async () => {
    const { s, gymId, first } = await withCoachTarget({ routine: false });
    const page = await load(s, gymId);
    expect(page.startOf).toEqual({ nextOf: first });
    const bench = page.view.rows.find((r) => r.name === 'Bench press');
    if (bench?.coach?.state !== 'coach') throw new Error('no coach row');
    expect(bench.load.value).toBe('57.5');
    const record = page.coachTargets[bench.coach.rowId];
    if (!record) throw new Error('no record');
    expect(await s.coach.tapNextTarget(record, coachPill(bench.coach).tap, 'tap-undo')).toMatchObject({ status: 'written', row: { status: 'undone' } });
    const after = await load(s, gymId);
    const benchAfter = after.view.rows.find((r) => r.name === 'Bench press');
    if (benchAfter?.coach?.state !== 'built_in') throw new Error('no built-in row');
    expect(coachPill(benchAfter.coach)).toEqual({ label: 'Use coach target', tap: 'use_coach' });
    expect(benchAfter.panel.find((l) => l.key === 'coach')?.value).toBe(`57.5${NBSP}kg${NBSP}×${NBSP}3–6`);
    expect(after.view.previewKey).not.toBe(page.view.previewKey);
    const r = await startFromOverview(ports(s, gymId), { page: after, opId: 'op-next', checkIn: null });
    if (r.kind !== 'started') throw new Error(r.kind);
    for (const x of after.view.rows) matchesSession(x, r.outcome.aggregate);
  });
});

describe('gym toast Undo (merge N3)', () => {
  it('selects the previous gym again, and reports a failed select instead of ignoring it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const hotelId = h.ids();
    expect((await s.setup.saveGym({ gymId: hotelId, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);
    expect(await s.gyms.select(hotelId)).toMatchObject({ ok: true });
    expect(await undoGymSwitch((id) => s.gyms.select(id), gymId)).toBeNull();
    expect((await s.yourData.currentGym())?.id).toBe(gymId);
    expect(await undoGymSwitch((id) => s.gyms.select(id), 'gone-gym')).toBe('That gym wasn’t found.');
    expect(await undoGymSwitch(() => Promise.reject(new Error('boom')), gymId)).toBe('Couldn’t switch back.');
  });
});
