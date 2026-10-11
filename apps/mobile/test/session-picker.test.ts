import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { NBSP } from '@fizz/domain';
import type { TextCoachState } from '@fizz/providers';
import type { ZonedTimestamp } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { OverviewData, OverviewTarget, SessionList, SessionPickerRow } from '../src/services/workout-services';
import { startFromOverview } from '../src/workout/overview-start';
import { allRows, hasChoice, isShownRow, lastDoneText, pickerRowDetail, pickerRowLabel, todaySessions } from '../src/workout/session-picker';
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
const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };
const plain = (s: string | null | undefined): string => (s ?? '').replaceAll(NBSP, ' ');
/** 18:00 BST on a date. */
const at = (date: string): number => Date.parse(`${date}T17:00:00.000Z`);

let h: Harness;
let model: NeverModel;
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
    // D19 (Decision 2 open): Up next is the last workout's next session, Chest; then the longest gap first.
    expect(l.current.map((r) => r.label)).toEqual(['Chest', 'Legs', 'Shoulders', 'Back']);
    expect(l.older).toEqual([]);
    expect(l.recommendedKey).toBe('name:chest');
    expect(allRows(l).some((r) => r.sourceSessionId === unnamed)).toBe(false);
    const today = await s.next.preview(gymId);
    expect(today?.sourceSessionId).toBe(rowOf(l, 'Chest').sourceSessionId);
    expect(today?.title).toBe('Chest');
    // The Up next row opens Today's own page; the others open their own history.
    expect(rowOf(l, 'Chest')).toMatchObject({ recommended: true, target: { kind: 'next' }, sourceSessionId: ids.Chest });
    expect(rowOf(l, 'Shoulders')).toMatchObject({ recommended: false, kind: 'named', target: { kind: 'session', sourceSessionId: ids.Shoulders }, exerciseCount: 2, edited: false });
    expect(rowOf(l, 'Legs').lastDone?.utc).toBe(new Date(at('2026-10-05')).toISOString());
    // Today: Change and Sessions show (2 or more types), without Up next.
    expect(hasChoice(l)).toBe(true);
    expect(todaySessions(l, { includeUpNext: false })).toEqual({ rows: [rowOf(l, 'Legs'), rowOf(l, 'Shoulders'), rowOf(l, 'Back')], more: false });
    expect(todaySessions(l, { includeUpNext: true }).more).toBe(true);
    expect(lastDoneText(rowOf(l, 'Legs'), s.now())).toBe('6 days ago');
    expect(model.requests).toHaveLength(0);
  });

  it('a routine joins its saved workout’s type, and with one routine the rotation names it Up next', async () => {
    const { services: s } = await h.launch();
    const { gymId, ids } = await split(s);
    const saved = await s.routines.saveFromSession({ sessionId: ids.Chest, name: 'Chest', opId: 'save-chest' });
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
    expect(await list(s, gymId)).toEqual({ current: [], older: [], recommendedKey: null });
    expect(await list(s, null)).toEqual({ current: [], older: [], recommendedKey: null });
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
    expect(l.current.map((r) => r.label)).toEqual(['Push']);
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
    for (const [i, row] of page.view.rows.entries()) {
      const working = agg.sets.filter((x) => x.sessionExerciseId === ordered[i]?.id && x.setType !== 'warmup' && x.pairedWithSetId === null);
      expect(plain(row.detail).startsWith(`${String(working.length)} × `)).toBe(true);
      expect(working[0]?.planned.load?.value).toBeDefined();
    }
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
    const a = await s.routines.saveFromSession({ sessionId: ids.Legs, name: 'Legs', opId: 'save-legs' });
    const b = await s.routines.saveFromSession({ sessionId: ids.Legs, name: 'Legs', opId: 'save-legs' });
    if (!a.ok || !b.ok) throw new Error('save failed');
    expect(b.routine.id).toBe(a.routine.id);
    expect((await s.routines.list()).map((r) => r.name)).toEqual(['Legs']);
    const l = await list(s, gymId);
    expect(allRows(l).filter((r) => r.label === 'Legs')).toHaveLength(1);
    const legs = rowOf(l, 'Legs');
    expect(legs).toMatchObject({ kind: 'routine', target: { kind: 'routine', routineId: a.routine.id } });
    const page = await load(s, legs.target, gymId);
    expect(page.view.rows.map((r) => r.name)).toEqual(['Back squat', 'Leg press']);
    const undo = await s.routines.remove({ routineId: a.routine.id, expectedVersion: a.routine.version, opId: 'undo-save' });
    expect(undo.ok).toBe(true);
    expect(rowOf(await list(s, gymId), 'Legs')).toMatchObject({ kind: 'named', target: { kind: 'session', sourceSessionId: ids.Legs } });
  });

  it('SP14: the list, a switch and a pick make no provider call and need no network', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await split(s);
    const l = await list(s, gymId);
    for (const r of allRows(l)) await load(s, r.target, gymId);
    expect(model.requests).toHaveLength(0);
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
    expect(todaySessions({ current: [arms], older: [], recommendedKey: null }, { includeUpNext: false })).toEqual({ rows: [arms], more: false });
    expect(todaySessions({ current: [{ ...arms, recommended: true }], older: [], recommendedKey: 'routine:r' }, { includeUpNext: true }).rows).toEqual([]);
    expect(hasChoice({ current: [arms], older: [], recommendedKey: null })).toBe(false);
  });

  it('no list (unreadable) means no Change and no Sessions', () => {
    expect(hasChoice(null)).toBe(false);
    expect(todaySessions(null, { includeUpNext: false })).toEqual({ rows: [], more: false });
  });
});
