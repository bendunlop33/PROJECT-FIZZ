import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { loadCell, NBSP, type OverviewRow } from '@fizz/domain';
import type { TextCoachState } from '@fizz/providers';
import type { SessionAggregate, ZonedTimestamp } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { OverviewData, OverviewTarget, SessionList, SessionPickerRow } from '../src/services/workout-services';
import { startFromOverview } from '../src/workout/overview-start';
import { allRows, hasChoice, isShownRow, lastDoneText, pickerRowDetail, pickerRowLabel, pickerSections, SESSION_PICKER_COPY, switchSession, todaySessions } from '../src/workout/session-picker';
import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * The session picker through the app services on real SQLite
 * (session-picker.md §7, §8): Ben's session types in picker order, Up next
 * the same as Today's card, a picked session's overview equal to what its
 * Start creates (SP6), today's edits kept per session across a switch
 * (SP10), Save as routine (SP13), and no AI anywhere (SP14).
 */

class NeverModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  // eslint-disable-next-line require-yield
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    await Promise.resolve();
    throw new Error('the session picker never calls the coach');
  }
}
/** A coach that answers with scripted tool calls (SP7), or can't be reached once the script runs out. */
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
const call = (toolName: string, args: unknown): ModelEvent[] => [{ type: 'tool_call', callId: `c-${toolName}`, name: toolName, arguments: JSON.stringify(args) }, { type: 'completed' }];

/** What a row shows against what Start created for it (OV3): working-set count, first load (value and unit) and reps. */
function matchesSession(row: OverviewRow, agg: SessionAggregate): void {
  const ex = agg.exercises.find((e) => e.exerciseId === row.exerciseId);
  if (!ex) throw new Error(`no ${row.name}`);
  const working = agg.sets.filter((x) => x.sessionExerciseId === ex.id && x.setType !== 'warmup' && x.pairedWithSetId === null).sort((a, b) => a.index - b.index);
  const first = working[0];
  expect(first?.status).toBe('pending');
  expect(row.detail.startsWith(`${String(working.length)}${NBSP}×${NBSP}`)).toBe(true);
  const cell = loadCell(first?.planned.load ?? null, ex.loadConvention, null, false);
  expect({ value: row.load.value, unit: row.load.unit }).toEqual({ value: cell.value, unit: cell.unit });
  const reps = first?.planned.reps;
  if (reps) expect(row.detail).toContain(reps.min === reps.max ? String(reps.min) : `${String(reps.min)}–${String(reps.max)}`);
}

const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };
const plain = (s: string | null | undefined): string => (s ?? '').replaceAll(NBSP, ' ');
/** 18:00 BST on a date. */
const at = (date: string): number => Date.parse(`${date}T17:00:00.000Z`);

let h: Harness;
let model: CoachModelPort & { readonly requests: ModelRequest[] };
beforeEach(() => {
  model = new NeverModel();
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function name(s: AppServices, sessionId: string, label: string): Promise<void> {
  const loaded = await s.workout.load(sessionId);
  const r = await s.workout.dispatch(sessionId, { type: 'rename_session', at: h.now(), opId: h.ids(), name: label, expectedVersion: loaded?.aggregate.session.version ?? 0 });
  if (!r.ok) throw new Error(r.error.message);
}

/** §8, logged in the app: Legs Mon 5 Oct, Shoulders Wed 7, Back Thu 8, Chest Fri 9, plus one unnamed workout. Today is Sun 11 Oct. */
async function split(s: AppServices) {
  const gymId = await setUpGym(h, s);
  h.clockMs = at('2026-10-03');
  const unnamed = await logWorkout(h, s, gymId, [{ exercise: 'Push-up', sets: [{ load: null, reps: 15 }] }]);
  const plan: [string, string, { exercise: string; sets: { load: number; reps: number }[] }[]][] = [
    ['2026-10-05', 'Legs', [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }, { load: 100, reps: 5 }] }, { exercise: 'Leg press', sets: [{ load: 150, reps: 10 }, { load: 150, reps: 10 }] }]],
    ['2026-10-07', 'Shoulders', [{ exercise: 'Dumbbell shoulder press', sets: [{ load: 22.5, reps: 8 }, { load: 22.5, reps: 8 }] }, { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }, { load: 10, reps: 12 }] }]],
    ['2026-10-08', 'Back', [{ exercise: 'Lat pulldown', sets: [{ load: 60, reps: 10 }, { load: 60, reps: 10 }] }, { exercise: 'Barbell row', sets: [{ load: 70, reps: 8 }, { load: 70, reps: 8 }] }]],
    ['2026-10-09', 'Chest', [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }, { load: 80, reps: 8 }] }, { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }, { load: 25, reps: 12 }] }]],
  ];
  const ids: Record<string, string> = {};
  for (const [date, label, items] of plan) {
    h.clockMs = at(date);
    const id = await logWorkout(h, s, gymId, items);
    await name(s, id, label);
    ids[label] = id;
  }
  h.clockMs = Date.parse('2026-10-11T08:00:00.000Z');
  return { gymId, unnamed, ids: ids as Record<'Legs' | 'Shoulders' | 'Back' | 'Chest', string> };
}

async function list(s: AppServices, gymId: string | null): Promise<SessionList> {
  const l = await s.sessions.list(gymId);
  if (!l) throw new Error('no session list');
  return l;
}

const rowOf = (l: SessionList, label: string): SessionPickerRow => {
  const r = allRows(l).find((x) => x.label === label);
  if (!r) throw new Error(`no row ${label}`);
  return r;
};

async function load(s: AppServices, target: OverviewTarget, gymId: string): Promise<OverviewData> {
  const page = await s.overview.load({ target, gymId });
  if (!page) throw new Error('no overview');
  return page;
}

const ports = (s: AppServices, target: OverviewTarget, gymId: string) => ({
  start: (q: Parameters<AppServices['overview']['start']>[0]) => s.overview.start(q),
  reload: () => s.overview.load({ target, gymId }),
});

const NOW: ZonedTimestamp = { utc: '2026-10-11T08:00:00.000Z', tz: TZ };

describe('services.sessions.list (session-picker §3, §7)', () => {
  it('SP1, SP2: named sessions in picker order, Up next the same as Today’s card; an unnamed workout is not a row', async () => {
    const { services: s } = await h.launch();
    const { gymId, unnamed, ids } = await split(s);
    const l = await list(s, gymId);
    // Decision 2 (approved 11 Oct; review import-progress S1): no rotation applies, so Up next is the longest gap, Legs,
    // never Chest, the workout just done; then the longest gap first (SP1).
    expect(l.upNext?.label).toBe('Legs');
    expect(l.workouts).toEqual([]);
    expect(l.fromHistory.map((r) => r.label)).toEqual(['Shoulders', 'Back', 'Chest']);
    expect(allRows(l).map((r) => r.label)).toEqual(['Legs', 'Shoulders', 'Back', 'Chest']);
    expect(pickerSections(l).map((x) => [x.title, x.rows.length])).toEqual([
      [null, 1],
      ['From history', 3],
    ]);
    expect(l.older).toEqual([]);
    expect(l.recommendedKey).toBe('name:legs');
    expect(allRows(l).some((r) => r.sourceSessionId === unnamed)).toBe(false);
    const today = await s.next.preview(gymId);
    expect(today?.sourceSessionId).toBe(rowOf(l, 'Legs').sourceSessionId);
    expect(today?.title).toBe('Legs');
    // The Up next row opens Today's own page; the others open their own history.
    expect(rowOf(l, 'Legs')).toMatchObject({ recommended: true, target: { kind: 'next' }, sourceSessionId: ids.Legs });
    expect(rowOf(l, 'Shoulders')).toMatchObject({ recommended: false, kind: 'named', target: { kind: 'session', sourceSessionId: ids.Shoulders }, exerciseCount: 2, edited: false });
    expect(rowOf(l, 'Legs').lastDone?.utc).toBe(new Date(at('2026-10-05')).toISOString());
    // Today: Change and Sessions show (2 or more types), without Up next.
    expect(hasChoice(l)).toBe(true);
    expect(todaySessions(l, { includeUpNext: false })).toEqual({ rows: [rowOf(l, 'Shoulders'), rowOf(l, 'Back'), rowOf(l, 'Chest')], more: false });
    expect(todaySessions(l, { includeUpNext: true }).more).toBe(true);
    expect(lastDoneText(rowOf(l, 'Legs'), s.now())).toBe('6 days ago');
    expect(model.requests).toHaveLength(0);
  });

  it('a routine joins its saved workout’s type, and with one routine the rotation names it Up next', async () => {
    const { services: s } = await h.launch();
    const { gymId, ids } = await split(s);
    const saved = await s.routines.saveFromSession({ sessionId: ids.Chest, name: 'Chest', opId: 'save-chest' , addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    const l = await list(s, gymId);
    expect(allRows(l).map((r) => r.label)).toEqual(['Chest', 'Legs', 'Shoulders', 'Back']);
    expect(rowOf(l, 'Chest')).toMatchObject({ kind: 'routine', routineId: saved.routine.id, recommended: true, target: { kind: 'next' } });
    // The overview from the Up next row is the routine (✓ on that row).
    const page = await load(s, { kind: 'next' }, gymId);
    expect(page.startOf).toEqual({ routineOf: saved.routine.id });
    expect(isShownRow(rowOf(l, 'Chest'), page.startOf)).toBe(true);
    expect(isShownRow(rowOf(l, 'Legs'), page.startOf)).toBe(false);
  });

  it('with only one session type there is no choice to offer (no Change, no Sessions)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    await name(s, id, 'Push');
    const l = await list(s, gymId);
    expect(allRows(l).map((r) => r.label)).toEqual(['Push']);
    expect(hasChoice(l)).toBe(false);
    expect(todaySessions(l, { includeUpNext: false }).rows).toEqual([]);
  });

  it('before setup there is no list (Today shows First workout); after setup it is empty', async () => {
    const { services: s } = await h.launch();
    expect(await s.sessions.list(null)).toBeNull();
    const gymId = await setUpGym(h, s);
    expect(await list(s, gymId)).toEqual({ upNext: null, workouts: [], fromHistory: [], older: [], recommendedKey: null, fromCoach: [] });
    expect(await list(s, null)).toEqual({ upNext: null, workouts: [], fromHistory: [], older: [], recommendedKey: null, fromCoach: [] });
  });

  it('sessions not done in 42 days are listed under OLDER, with the year once they are 11 months back', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    h.clockMs = at('2025-08-14');
    await name(s, await logWorkout(h, s, gymId, [{ exercise: 'Deadlift', sets: [{ load: 140, reps: 5 }] }]), 'Pull');
    h.clockMs = at('2026-10-09');
    await name(s, await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]), 'Push');
    h.clockMs = Date.parse('2026-10-11T08:00:00.000Z');
    const l = await list(s, gymId);
    expect(allRows(l).map((r) => r.label)).toEqual(['Push', 'Pull']);
    expect(l.older.map((r) => r.label)).toEqual(['Pull']);
    expect(plain(pickerRowDetail(rowOf(l, 'Pull'), s.now()))).toBe('14 Aug 2025 · 1 exercise');
  });
});

describe('Picking a session (SP6, SP9, SP10, SP12, SP14)', () => {
  it('SP6, SP12: a picked session’s overview is what its Start creates, named after the session', async () => {
    const { services: s } = await h.launch();
    const { gymId, ids } = await split(s);
    const shoulders = rowOf(await list(s, gymId), 'Shoulders');
    const page = await load(s, shoulders.target, gymId);
    expect(page.view.title).toBe('Shoulders');
    expect(page.view.basis).toEqual({ kind: 'last_done', at: { utc: new Date(at('2026-10-07')).toISOString(), tz: TZ } });
    expect(page.startOf).toEqual({ nextOf: ids.Shoulders });
    expect(page.view.rows.map((r) => r.name)).toEqual(['Dumbbell shoulder press', 'Lateral raise']);
    // Preview = Start (OV3): the same exercises and pending working sets, and loads as shown.
    const r = await startFromOverview(ports(s, shoulders.target, gymId), { page, opId: 'start-shoulders', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'started') throw new Error(r.kind);
    const agg = r.outcome.aggregate;
    const ordered = [...agg.exercises].sort((a, b) => a.order - b.order);
    expect(ordered.map((e) => e.exerciseName)).toEqual(page.view.rows.map((x) => x.name));
    // Each row's load (value and unit) and reps are the started set's planned ones (r2 S2).
    for (const row of page.view.rows) matchesSession(row, agg);
    expect(page.view.rows.every((x) => x.load.value !== '—')).toBe(true);
    // SP-D8: the workout carries the session's name, so it groups with Shoulders next time.
    expect(agg.session.routineName).toBe('Shoulders');
    // A retry of the same Start is the same workout (rule 5).
    const again = await s.overview.start({ startOf: page.startOf, gymId, opId: 'start-shoulders', checkIn: { kind: 'skipped', atUtc: h.now().utc }, expectedPreviewKey: page.view.previewKey, draft: null });
    expect(again.ok && again.aggregate.session.id).toBe(agg.session.id);
    expect(model.requests).toHaveLength(0);
  });

  it('SP9, SP10: switching keeps each session’s today’s edits; the picker marks them Edited; any Start discards the rest', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await split(s);
    const before = await s.yourData.counts();
    const l0 = await list(s, gymId);
    const shouldersTarget = rowOf(l0, 'Shoulders').target;
    const backTarget = rowOf(l0, 'Back').target;
    const shoulders = await load(s, shouldersTarget, gymId);
    const raise = shoulders.view.rows.find((r) => r.name === 'Lateral raise');
    const skipped = await s.overview.edit({ target: shouldersTarget, gymId, expectedDraftVersion: null, opId: 'skip-raise', edit: { kind: 'skip', slotKey: raise?.slotKey ?? '' } });
    expect(skipped.ok).toBe(true);

    // Switch to Back (in place: nothing written), then back to Shoulders: the skip is still there.
    const back = await load(s, backTarget, gymId);
    expect(back.view.editCount).toBe(0);
    expect(back.draft).toBeNull();
    const again = await load(s, shouldersTarget, gymId);
    expect(again.view.editCount).toBe(1);
    expect(again.view.rows.find((r) => r.name === 'Lateral raise')?.marker.kind).toBe('skipped');
    const l1 = await list(s, gymId);
    expect(allRows(l1).filter((r) => r.edited).map((r) => r.label)).toEqual(['Shoulders']);
    expect(plain(pickerRowDetail(rowOf(l1, 'Shoulders'), s.now()))).toBe('4 days ago · 2 exercises · Edited');
    expect(pickerRowLabel(rowOf(l1, 'Shoulders'), s.now(), true)).toBe('Shoulders, last done 4 days ago, 2 exercises, edited today, selected');
    // Switching wrote nothing but the edit itself.
    expect(await s.sessions.active()).toBeNull();
    expect(await s.yourData.counts()).toEqual(before);

    // A force-close keeps the draft (ADR 0022).
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(rowOf(await list(s2, gymId), 'Shoulders').edited).toBe(true);

    // Starting Back discards the Shoulders draft (TE-A15).
    const backPage = await load(s2, backTarget, gymId);
    const started = await startFromOverview(ports(s2, backTarget, gymId), { page: backPage, opId: 'start-back', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    expect(started.kind).toBe('started');
    expect(allRows(await list(s2, gymId)).some((r) => r.edited)).toBe(false);
    expect(model.requests).toHaveLength(0);
  });

  it('SP15: the source workout corrected while the page is open: Start creates nothing and the page re-reads', async () => {
    const { services: s } = await h.launch();
    const { gymId, ids } = await split(s);
    const target = rowOf(await list(s, gymId), 'Legs').target;
    const page = await load(s, target, gymId);
    const src = await s.workout.load(ids.Legs);
    const set = src?.aggregate.sets.find((x) => x.status === 'completed');
    if (!src || !set) throw new Error('no source set');
    const fixed = await s.workout.dispatch(ids.Legs, { type: 'correct_set', at: h.now(), opId: 'fix-legs', setId: set.id, expectedSetVersion: set.version, patch: { reps: 3 } });
    expect(fixed.ok).toBe(true);
    const r = await s.overview.start({ startOf: page.startOf, gymId, opId: 'start-legs', checkIn: { kind: 'skipped', atUtc: h.now().utc }, expectedPreviewKey: page.view.previewKey, draft: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('stale_preview');
    expect(await s.sessions.active()).toBeNull();
  });

  it('SP13: Save as routine makes one routine from the source (a repeated opId gives one); the page reloads on it; Undo removes it', async () => {
    const { services: s } = await h.launch();
    const { gymId, ids } = await split(s);
    const a = await s.routines.saveFromSession({ sessionId: ids.Legs, name: 'Legs', opId: 'save-legs' , addToRotation: true });
    const b = await s.routines.saveFromSession({ sessionId: ids.Legs, name: 'Legs', opId: 'save-legs' , addToRotation: true });
    if (!a.ok || !b.ok) throw new Error('save failed');
    expect(b.routine.id).toBe(a.routine.id);
    expect((await s.routines.list()).map((r) => r.name)).toEqual(['Legs']);
    const l = await list(s, gymId);
    expect(allRows(l).filter((r) => r.label === 'Legs')).toHaveLength(1);
    const legs = rowOf(l, 'Legs');
    // PM decision 18 Oct: Legs is the split day trained least recently, and its routine is Up next.
    expect(legs).toMatchObject({ kind: 'routine', routineId: a.routine.id, recommended: true, target: { kind: 'next' } });
    const page = await load(s, legs.target, gymId);
    expect(page.view.rows.map((r) => r.name)).toEqual(['Back squat', 'Leg press']);
    const undo = await s.routines.remove({ routineId: a.routine.id, expectedVersion: a.routine.version, opId: 'undo-save' });
    expect(undo.ok).toBe(true);
    // Back to a history type: the longest gap again, so Up next (Decision 2).
    expect(rowOf(await list(s, gymId), 'Legs')).toMatchObject({ kind: 'named', recommended: true, target: { kind: 'next' }, sourceSessionId: ids.Legs });
  });

  it('SP14: the list, a switch and a pick make no provider call and need no network', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await split(s);
    const l = await list(s, gymId);
    for (const r of allRows(l)) await load(s, r.target, gymId);
    expect(model.requests).toHaveLength(0);
  });
});

describe('Up next only where the row opens it (review r2 B1)', () => {
  /** Routine Legs (Back squat, Triceps pushdown), then a newer Legs workout not started from it (Leg press, Lateral raise): D19 falls back to that workout. */
  async function joinedByName(s: AppServices) {
    const gymId = await setUpGym(h, s);
    h.clockMs = at('2026-10-05');
    const first = await logWorkout(h, s, gymId, [
      { exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }] },
      { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }] },
    ]);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Legs', opId: 'save-legs' , addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    h.clockMs = at('2026-10-08');
    const later = await logWorkout(h, s, gymId, [
      { exercise: 'Leg press', sets: [{ load: 150, reps: 10 }, { load: 150, reps: 10 }] },
      { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }] },
    ]);
    await name(s, later, 'Legs');
    h.clockMs = Date.parse('2026-10-11T08:00:00.000Z');
    return { gymId, routineId: saved.routine.id, later };
  }

  it('a workout that joined a routine by name: the routine row opens the routine, is not Up next, and stays reachable from Today', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId, later } = await joinedByName(s);
    // The fixture: Up next is the newest workout's next session, not the routine.
    const up = await load(s, { kind: 'next' }, gymId);
    expect(up.startOf).toEqual({ nextOf: later });
    expect(up.view.rows.map((r) => r.name)).toEqual(['Leg press', 'Lateral raise']);
    expect((await s.next.preview(gymId))?.sourceSessionId).toBe(later);

    const l = await list(s, gymId);
    expect(allRows(l).map((r) => r.label)).toEqual(['Legs']);
    const legs = rowOf(l, 'Legs');
    expect(legs).toMatchObject({ kind: 'routine', routineId, recommended: false, target: { kind: 'routine', routineId }, exerciseCount: 2, edited: false });
    expect(l.recommendedKey).toBeNull();
    // The row opens the routine (Back squat), and the overview it opens checks it; Up next's page doesn't.
    const routinePage = await load(s, legs.target, gymId);
    expect(routinePage.startOf).toEqual({ routineOf: routineId });
    expect(routinePage.view.rows.map((r) => r.name)).toEqual(['Back squat', 'Triceps pushdown']);
    expect(isShownRow(legs, routinePage.startOf)).toBe(true);
    expect(isShownRow(legs, up.startOf)).toBe(false);
    // Today's Sessions still lists the routine (with its long-press Rename/Delete), as Your routines did.
    expect(todaySessions(l, { includeUpNext: false }).rows).toEqual([legs]);

    // Edited reads the plan the row opens: an edit on Up next's page doesn't mark it ...
    const press = up.view.rows[0];
    expect((await s.overview.edit({ target: { kind: 'next' }, gymId, expectedDraftVersion: null, opId: 'skip-press', edit: { kind: 'skip', slotKey: press?.slotKey ?? '' } })).ok).toBe(true);
    expect(rowOf(await list(s, gymId), 'Legs').edited).toBe(false);
    // ... and one on the routine's page does.
    const squat = routinePage.view.rows[0];
    expect((await s.overview.edit({ target: legs.target, gymId, expectedDraftVersion: null, opId: 'skip-squat', edit: { kind: 'skip', slotKey: squat?.slotKey ?? '' } })).ok).toBe(true);
    expect(rowOf(await list(s, gymId), 'Legs').edited).toBe(true);
    expect(model.requests).toHaveLength(0);
  });

  it('a routine that is Up next keeps the Up next row, opening the routine (with ✓), and Edited reads the routine’s draft', async () => {
    const { services: s } = await h.launch();
    const { gymId, ids } = await split(s);
    const saved = await s.routines.saveFromSession({ sessionId: ids.Chest, name: 'Chest', opId: 'save-chest' , addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    const chest = rowOf(await list(s, gymId), 'Chest');
    expect(chest).toMatchObject({ recommended: true, target: { kind: 'next' } });
    const page = await load(s, chest.target, gymId);
    expect(isShownRow(chest, page.startOf)).toBe(true);
    const routinePage = await load(s, { kind: 'routine', routineId: saved.routine.id }, gymId);
    const first = routinePage.view.rows[0];
    expect((await s.overview.edit({ target: { kind: 'routine', routineId: saved.routine.id }, gymId, expectedDraftVersion: null, opId: 'skip-1', edit: { kind: 'skip', slotKey: first?.slotKey ?? '' } })).ok).toBe(true);
    expect(rowOf(await list(s, gymId), 'Chest').edited).toBe(true);
  });
});

describe('Done today and the in-place switch (§5, SP9, SP11, r2 S1)', () => {
  it('Done today lists Up next first, then picker order, with All sessions for the rest', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await split(s);
    const l = await list(s, gymId);
    const done = todaySessions(l, { includeUpNext: true });
    expect(done.rows.map((r) => r.label)).toEqual(['Legs', 'Shoulders', 'Back']);
    expect(done.rows[0]?.recommended).toBe(true);
    expect(done.more).toBe(true);
  });

  it('switching to a session that can’t be shown leaves the page as it was; a good one shows with the same check-in and gym', async () => {
    const { services: s } = await h.launch();
    const { gymId, ids } = await split(s);
    const saved = await s.routines.saveFromSession({ sessionId: ids.Legs, name: 'Legs', opId: 'save-legs' , addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    // The routine's own target (its row is Up next since 18 Oct, which would fall back to the Legs workout).
    expect(rowOf(await list(s, gymId), 'Legs').routineId).toBe(saved.routine.id);
    const legs = { target: { kind: 'routine', routineId: saved.routine.id } as OverviewTarget };
    // The routine is deleted while the picker is open.
    expect((await s.routines.remove({ routineId: saved.routine.id, expectedVersion: saved.routine.version, opId: 'rm-legs' })).ok).toBe(true);

    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 4 });
    if (!ci.ok) throw new Error(ci.message);
    const shown: OverviewTarget[] = [];
    const pages: OverviewData[] = [];
    const ports = {
      load: async (t: OverviewTarget) => {
        const p = await s.overview.load({ target: t, gymId, checkInId: ci.checkIn.id });
        if (p) pages.push(p);
        return p;
      },
      show: (t: OverviewTarget) => {
        shown.push(t);
      },
    };
    expect(await switchSession(ports, legs.target)).toBe('failed');
    expect(shown).toEqual([]);
    expect(SESSION_PICKER_COPY.switchFailed).toBe('Couldn’t load that session.');

    const back = rowOf(await list(s, gymId), 'Back');
    expect(await switchSession(ports, back.target)).toBe('switched');
    expect(shown).toEqual([back.target]);
    // SP11: the tapped score is what the new page plans with, at the same gym.
    expect(pages.at(-1)?.planCheckIn?.id).toBe(ci.checkIn.id);
    expect(pages.at(-1)?.view.gym?.id).toBe(gymId);
    expect(await s.sessions.active()).toBeNull();
    expect(model.requests).toHaveLength(0);
  });

  it('Today’s Change reads “Change session” to VoiceOver (§4.5, r2 N4)', () => {
    const today = readFileSync(join(__dirname, '..', 'src', 'screens', 'TodayScreen.tsx'), 'utf8');
    expect(today).toMatch(/label=\{SESSION_PICKER_COPY\.change\}\n\s*tone="secondary"\n\s*accessibilityLabel=\{SESSION_PICKER_COPY\.changeSession\}/);
  });
});

describe('SP7: coach targets on a picked session (D21, rule 3)', () => {
  it('a stored coach target on the picked source shows Coach and is what Start creates; opening it makes no model call', async () => {
    const { services: s } = await h.launch();
    const { gymId, ids } = await split(s);
    model = new StepModel([
      (req) => {
        const w = workoutOf(req);
        const press = w.exercises.find((e) => e.name === 'Dumbbell shoulder press');
        return call('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: press?.exerciseId, target: { load: { value: 20, unit: 'kg', convention: 'per_hand' }, reps: null }, sets: null, reason: 'Last reps were a grind.' }] });
      },
      () => call('reply', { message: 'Ok.', offer: null }),
    ]);
    await s.coach.runSummaryTurn(ids.Shoulders);
    const calls = model.requests.length;
    expect(calls).toBeGreaterThan(0);

    const shoulders = rowOf(await list(s, gymId), 'Shoulders');
    expect(shoulders.target).toEqual({ kind: 'session', sourceSessionId: ids.Shoulders });
    const page = await load(s, shoulders.target, gymId);
    const press = page.view.rows.find((r) => r.name === 'Dumbbell shoulder press');
    expect(press?.coach).toMatchObject({ state: 'coach', reason: 'Last reps were a grind.' });
    expect(press?.load).toMatchObject({ value: '20' });
    expect(page.view.rows.find((r) => r.name === 'Lateral raise')?.coach).toBeNull();
    const r = await startFromOverview(ports(s, shoulders.target, gymId), { page, opId: 'start-coach', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (r.kind !== 'started') throw new Error(r.kind);
    for (const row of page.view.rows) matchesSession(row, r.outcome.aggregate);
    expect(model.requests.length).toBe(calls);
  });

  it('with no stored target, or the coach unreachable when the workout ended, the picked session shows the built-in targets and no coach UI', async () => {
    const { services: s } = await h.launch();
    const { gymId, ids } = await split(s);
    const target = rowOf(await list(s, gymId), 'Shoulders').target;
    const none = await load(s, target, gymId);
    expect(none.view.rows.every((r) => r.coach === null)).toBe(true);
    expect(none.coachTargets).toEqual({});
    // The coach can't be reached: nothing is stored, and the page is the same.
    model = new StepModel([]);
    await s.coach.runSummaryTurn(ids.Shoulders);
    const offline = await load(s, target, gymId);
    expect(offline.view.rows.every((r) => r.coach === null)).toBe(true);
    expect(offline.coachTargets).toEqual({});
    expect(offline.view.rows.map((r) => r.load)).toEqual(none.view.rows.map((r) => r.load));
  });
});

describe('Picker view helpers', () => {
  const row = (o: Partial<SessionPickerRow>): SessionPickerRow => ({
    key: 'name:legs',
    label: 'Legs',
    kind: 'named',
    target: { kind: 'session', sourceSessionId: 's1' },
    routineId: null,
    sourceSessionId: 's1',
    lastDone: { utc: '2026-10-05T17:00:00.000Z', tz: TZ },
    exerciseCount: 5,
    recommended: false,
    edited: false,
    ...o,
  });

  it('reads New for a routine never done, and up next for the recommendation', () => {
    const arms = row({ key: 'routine:r', label: 'Arms', kind: 'routine', routineId: 'r', sourceSessionId: null, lastDone: null, exerciseCount: 4 });
    expect(pickerRowDetail(arms, NOW)).toBe('New · 4 exercises');
    expect(pickerRowLabel(row({ recommended: true }), NOW, false)).toBe('Legs, up next, last done 6 days ago, 5 exercises');
    expect(pickerRowLabel(arms, NOW, false)).toBe('Arms, new, not done yet, 4 exercises');
  });

  it('checks the row the overview shows: the same routine, or the same source workout', () => {
    expect(isShownRow(row({}), { nextOf: 's1' })).toBe(true);
    expect(isShownRow(row({}), { nextOf: 's2' })).toBe(false);
    expect(isShownRow(row({ routineId: 'r', sourceSessionId: 's1' }), { nextOf: 's1' })).toBe(false);
    expect(isShownRow(row({ routineId: 'r' }), { routineOf: 'r' })).toBe(true);
    expect(isShownRow(row({}), null)).toBe(false);
  });

  it('a single session that is not Up next is still listed on Today (a routine never done stays reachable)', () => {
    const arms = row({ key: 'routine:r', label: 'Arms', kind: 'routine', routineId: 'r', sourceSessionId: null, lastDone: null, target: { kind: 'routine', routineId: 'r' } });
    expect(todaySessions({ upNext: null, workouts: [arms], fromHistory: [], older: [], recommendedKey: null }, { includeUpNext: false })).toEqual({ rows: [arms], more: false });
    expect(todaySessions({ upNext: { ...arms, recommended: true }, workouts: [], fromHistory: [], older: [], recommendedKey: 'routine:r' }, { includeUpNext: true }).rows).toEqual([]);
    expect(hasChoice({ upNext: null, workouts: [arms], fromHistory: [], older: [], recommendedKey: null })).toBe(false);
  });

  it('no list (unreadable) means no Change and no Sessions', () => {
    expect(hasChoice(null)).toBe(false);
    expect(todaySessions(null, { includeUpNext: false })).toEqual({ rows: [], more: false });
  });
});

describe('Up next by split day (PM decision 18 Oct, pending Ben)', () => {
  it('Ben’s week: back trained yesterday in an unnamed workout → Up next is not Pull; Legs (least recent) from the Legs workout', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const back = [{ exercise: 'Lat pulldown', sets: [{ load: 60, reps: 10 }, { load: 60, reps: 10 }] }, { exercise: 'Barbell row', sets: [{ load: 70, reps: 8 }, { load: 70, reps: 8 }] }];
    const push = [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }, { load: 80, reps: 8 }] }];
    const legs = [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }] }, { exercise: 'Leg press', sets: [{ load: 150, reps: 10 }] }];
    h.clockMs = at('2026-10-04');
    await name(s, await logWorkout(h, s, gymId, back), 'Pull');
    h.clockMs = at('2026-10-07');
    const legsId = await logWorkout(h, s, gymId, legs);
    await name(s, legsId, 'Legs');
    h.clockMs = at('2026-10-08');
    await name(s, await logWorkout(h, s, gymId, push), 'Push');
    // Tue, Wed, Fri, Sat: unnamed (coach-built or empty) workouts.
    h.clockMs = at('2026-10-13');
    await logWorkout(h, s, gymId, push);
    h.clockMs = at('2026-10-14');
    await logWorkout(h, s, gymId, legs);
    h.clockMs = at('2026-10-16');
    await logWorkout(h, s, gymId, push);
    h.clockMs = at('2026-10-17');
    await logWorkout(h, s, gymId, back);
    h.clockMs = Date.parse('2026-10-18T08:00:00.000Z');
    const up = await s.next.preview(gymId);
    expect(up?.title).not.toBe('Pull');
    expect(up).toMatchObject({ title: 'Legs', routine: null, sourceSessionId: legsId });
    // The picker and the overview agree.
    expect(rowOf(await list(s, gymId), 'Legs')).toMatchObject({ recommended: true, target: { kind: 'next' } });
    expect((await load(s, { kind: 'next' }, gymId)).view.title).toBe('Legs');
    expect(model.requests).toHaveLength(0);
  });
});
