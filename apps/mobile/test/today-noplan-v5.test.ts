import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';

import type { BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySelection, TodaySessionData } from '../src/services/today-session';
import { todayActions, todaySegments } from '../src/today/today-view';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * V5 No-plan Today (workout-builder-v3 §2.0.4 rewritten 23 Oct; D7; Ben 23 Oct: "with no plan there is no way to
 * quickly change a workout before starting") on real SQLite, offline: the day row is Profile › Split with NEXT on the
 * Up next resolver's pick, `⋯` the other workouts (no chip row), and the Up next card is the plan card: the rows, Time
 * with the shared fit, Why?, one-tap Start and Edit opening Your workout on today's draft with Today's options there.
 */

const DAY = 86_400_000;
const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
let h: Harness;
beforeEach(() => {
  // Monday 12 Oct 2026, 08:00 in London; no coach connected (offline-first).
  h = createHarness('2026-10-12T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no data');
  return d;
}
const sel = (data: TodaySessionData, dayKey: string, over: Partial<TodaySelection['controls']> = {}): TodaySelection => {
  const c = data.initial[dayKey];
  if (c === undefined) throw new Error(`no controls for ${dayKey}`);
  return { dayKey, controls: { ...c, ...over } };
};
const keyOf = (data: TodaySessionData, name: string) => data.days.find((d) => d.name === name)?.key ?? data.others.find((d) => d.name === name)?.key ?? '';
const snapOf = (r: BuilderWriteResult) => {
  if (r.snapshot === null) throw new Error(`no snapshot: ${r.status}`);
  return r.snapshot;
};

/** Ben with the Chest / Legs / Shoulders / Back split and no plan: each day trained once, Chest first, Back last. */
async function benNoPlanWithSplit(split: 'clsb' | 'ppl' = 'clsb') {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const snap = await s.training.snapshot();
  if (!snap) throw new Error('snapshot');
  expect(await s.training.change({ kind: 'preset_split', split }, snap.profile.version, `split-${split}`)).toMatchObject({ ok: true });
  const days: [string, { load: number; reps: number }][] = [
    ['Bench press', { load: 100, reps: 6 }],
    ['Back squat', { load: 120, reps: 5 }],
    ['Overhead press', { load: 50, reps: 6 }],
    ['Barbell row', { load: 80, reps: 8 }],
  ];
  for (const [exercise, set] of days) {
    await logWorkout(h, s, gymId, [{ exercise, sets: [{ ...set, rpe: 8 }, { ...set, rpe: 8 }, { ...set, rpe: 8 }] }]);
    h.clockMs += DAY;
  }
  expect(await s.plans.overview()).toBeNull();
  return { s, gymId };
}

describe('V5: the day row from Profile › Split (no plan)', () => {
  it('the split’s days in order, NEXT on the app’s Up next pick (the day trained least recently), the other workouts under ⋯', async () => {
    const { s, gymId } = await benNoPlanWithSplit();
    const data = await loaded(s);
    expect(data.status).toBe('no_plan');
    expect(data.days.map((d) => [d.name, d.kind])).toEqual([
      ['Chest', 'split'],
      ['Legs', 'split'],
      ['Shoulders', 'split'],
      ['Back', 'split'],
    ]);
    // One resolver: Today's NEXT is the day the app's Up next plans (Chest, from his bench workout, which keeps its
    // own name `Push`).
    const up = await s.next.preview(gymId);
    expect(up?.sourceSessionId).not.toBeNull();
    expect(data.nextKey).toBe(keyOf(data, 'Chest'));
    expect(data.splitNextWhy).toBe('resolver');
    expect(data.others.map((d) => d.name)).toEqual(['Full body', 'Upper', 'Push']);
    // The row: four days with NEXT, then ⋯ (no chip row; D7). Build your own is secondary beside the card.
    const segs = todaySegments({ days: data.days, others: data.others, nextKey: data.nextKey, selectedKey: data.nextKey, paused: false });
    expect(segs.segments.map((x) => [x.label, x.next, x.more])).toEqual([
      ['Chest', true, false],
      ['Legs', false, false],
      ['Shoulders', false, false],
      ['Back', false, false],
      ['⋯', false, true],
    ]);
    expect(todayActions({ openWorkout: false, read: 'ready', noPlan: true, cardShown: true, upNext: data.upNext !== null && data.days.length === 0 })).toMatchObject({ upNext: false, buildYourOwn: 'secondary' });
  });

  it('PPL: Push is a split day, so ⋯ doesn’t offer it twice', async () => {
    const { s } = await benNoPlanWithSplit('ppl');
    const data = await loaded(s);
    expect(data.days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs']);
    expect(data.others.map((d) => d.name)).toEqual(['Full body', 'Upper']);
  });

  it('no split saved: no day row; the old Up next row stays (rotation / longest gap) and ⋯ keeps the other workouts', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }] }]);
    h.clockMs += DAY;
    const data = await loaded(s);
    expect(data.days).toEqual([]);
    expect(data.nextKey).toBeNull();
    expect(data.upNext).not.toBeNull();
    expect(todayActions({ openWorkout: false, read: 'ready', noPlan: true, cardShown: false, upNext: data.upNext !== null && data.days.length === 0 }).upNext).toBe(true);
    expect(data.others.map((d) => d.name)).toEqual(['Full body', 'Upper', 'Push']);
  });
});

describe('V5: the Up next card is the plan card', () => {
  it('rows (main lift first, his own loads at this gym), minutes, Time with the shared fit note and Undo to his usual length, Why?; nothing written by looking', async () => {
    const { s } = await benNoPlanWithSplit();
    const data = await loaded(s);
    const key = data.nextKey ?? '';
    const card = s.todaySession.card(data, sel(data, key));
    if (card === null) throw new Error('no card');
    expect(card.title).toBe('Chest');
    expect(card.summary).toMatch(/^\d+ exercises · ~\d+\u00a0min$/u);
    expect(card.rows[0]?.name).toBe('Bench press');
    // His own last bench (100 × 6 at RPE 8) drives the target; a real plate-loadable value (rule 4), never `—`.
    const top = Number((card.rows[0]?.top ?? '').replace(/[^\d.]/gu, ''));
    expect(top).toBeGreaterThanOrEqual(100);
    expect((top * 10) % 25).toBe(0);
    expect(card.startable).toBe(true);
    expect(card.edited).toBeNull();
    // Time: the plan card's control at his usual length (Profile), nothing to Undo back to.
    const usual = data.initial[key]?.minutes ?? 0;
    expect(usual).toBe((await s.training.snapshot())?.profile.sessionMinutes);
    expect(card.time).toMatchObject({ minutes: usual, undoMinutes: null });
    // A short Time: the shared fit (note, detail lines, Undo back to his usual length); the main lift is kept.
    const short = s.todaySession.card(data, sel(data, key, { minutes: 25 }));
    expect(short?.time?.note).not.toBeNull();
    expect(short?.time?.lines.length).toBeGreaterThan(0);
    expect(short?.time?.undoMinutes).toBe(usual);
    expect(short?.rows[0]?.name).toBe('Bench press');
    expect(short?.exerciseCount).toBeLessThanOrEqual(card.exerciseCount);
    // No plan day to carry cut sets to: no carry-over offer (honest; see report).
    expect(short?.carry).toBeNull();
    // Why?: up next by the split; his last Chest; offline, not reviewed.
    expect(card.why[0]).toBe('Chest: up next · longest since trained');
    expect(card.why.some((l) => l.startsWith('Last Chest, '))).toBe(true);
    expect(card.why.at(-1)).toMatch(/^Not reviewed/u);
    // Another day: picked by you, Chest stays next.
    const legs = s.todaySession.card(data, sel(data, keyOf(data, 'Legs')));
    expect(legs?.why[0]).toBe('Legs: picked by you; Chest stays next');
    expect(legs?.rows[0]?.name).toBe('Back squat');
    // Looking writes nothing (§2.0.8 check 8).
    expect((await s.todaySession.load())?.latestDraft).toEqual({});
  });

  it('a pain flag on the main lift holds it (rule 9): held on the card, named in Why?, never progressed', async () => {
    const { s } = await benNoPlanWithSplit();
    const data0 = await loaded(s);
    const bench = data0.days[0]?.templates[0]?.mainLiftExerciseId ?? '';
    expect((await s.pain.flagMovement({ exerciseId: bench, exerciseName: 'Bench press', opId: 'pain-1' })).ok).toBe(true);
    const data = await loaded(s);
    const card = s.todaySession.card(data, sel(data, keyOf(data, 'Chest')));
    const row = card?.rows.find((r) => r.exerciseId === bench);
    if (row !== undefined) {
      expect(row.held).toBe(true);
      expect(Number(row.top.replace(/[^\d.]/gu, ''))).toBeLessThanOrEqual(100);
      expect(card?.why.some((l) => l.includes('pain flag · held'))).toBe(true);
    } else {
      // Or left out of the pool for another Chest lift: never progressed either way.
      expect(card?.rows.some((r) => r.name === 'Bench press')).toBe(false);
    }
  });
});

describe('V5: Edit opens Your workout with today’s draft; Start is one tap', () => {
  it('Edit → Your workout has Today’s options (Main lift, Accessories, Abs, Supersets); Abs off is one write with Undo; back on Today the card shows it (`· edited`) and Start starts it', async () => {
    const { s, gymId } = await benNoPlanWithSplit();
    const data = await loaded(s);
    const key = data.nextKey ?? '';
    const c = await s.todaySession.commit(data, sel(data, key), 'edit-1');
    if (!c.ok) throw new Error(c.message);
    // Duplicate op ID: the same draft.
    expect(await s.todaySession.commit(data, sel(data, key), 'edit-1')).toEqual(c);
    const snap = await s.builder.read(c.draftId);
    if (snap === null) throw new Error('no draft');
    expect(snap.today).not.toBeNull();
    const o = await s.builder.todayOptions(c.draftId);
    expect(o?.mainLifts.map((m) => m.selected)).toEqual([true, ...(o?.mainLifts.slice(1).map(() => false) ?? [])]);
    expect(o?.mainLifts[0]?.label).toBe('Bench press');
    expect(o?.accessories).toBe('focused');
    expect(o?.abs).toBe(true);
    expect(o?.supersets).toBe(true);
    // Abs off on Your workout: Today's own draft for that choice, one versioned write with Undo.
    const off = await s.builder.setTodayOption(c.draftId, { kind: 'abs', on: false }, { opId: 'abs-off', expectedVersion: snap.version });
    expect(off.status).toBe('written');
    const offSnap = snapOf(off);
    expect(slotsOf(offSnap.workout.blocks).some((x) => offSnap.facts[x.exerciseId]?.group === 'Core')).toBe(false);
    expect(off.status === 'written' ? off.toast?.undoOpId : null).toBe('abs-off');
    // A stale write is refused (rule 5).
    const stale = await s.builder.setTodayOption(c.draftId, { kind: 'supersets', on: false }, { opId: 'ss-stale', expectedVersion: snap.version });
    expect(stale.status).not.toBe('written');
    // Back on Today: the edited card.
    const again = await loaded(s);
    const card = s.todaySession.card(again, sel(again, key));
    expect(card?.title).toBe('Chest · edited');
    expect(card?.edited?.draftId).toBe(c.draftId);
    expect(card?.rows.some((r) => r.name.toLowerCase().includes('crunch'))).toBe(false);
    expect(card?.time).not.toBeNull();
    // Force-close and relaunch: the edited card is still there (restart recovery).
    await h.forceClose();
    const s2 = (await h.launch()).services;
    const after = await loaded(s2);
    const kept = s2.todaySession.card(after, sel(after, key));
    expect(kept?.edited?.draftId).toBe(c.draftId);
    // Start: one tap, that draft, version-checked; the same op ID twice is one workout.
    const commit = await s2.todaySession.commit(after, sel(after, key), 'start-commit');
    if (!commit.ok) throw new Error(commit.message);
    expect(commit.draftId).toBe(c.draftId);
    const staleStart = await s2.todaySession.start({ draftId: commit.draftId, expectedVersion: commit.version - 1, gymId, opId: 'start-stale', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    expect(staleStart.ok).toBe(false);
    const started = await s2.todaySession.start({ draftId: commit.draftId, expectedVersion: commit.version, gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error('not started');
    const twice = await s2.todaySession.start({ draftId: commit.draftId, expectedVersion: commit.version, gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    expect(twice.ok && twice.aggregate.session.id).toBe(started.aggregate.session.id);
    // What started is what the card showed: no abs.
    const names = started.aggregate.exercises.map((e) => e.exerciseId);
    expect(names).toEqual(slotsOf(offSnap.workout.blocks).map((x) => x.exerciseId));
  });

  it('(D8) a change on Up next’s own Your workout draft (Ben’s, or a coach change he applied in chat) shows on the NEXT split card, and Start starts it', async () => {
    const { s } = await benNoPlanWithSplit();
    const opened = snapOf(await s.builder.openTarget({ kind: 'next' }, 'open-up-next'));
    const slot = slotsOf(opened.workout.blocks)[0];
    if (slot === undefined) throw new Error('empty');
    expect((await s.builder.edit(opened.draftId, { kind: 'add_set', slotKey: slot.key }, { opId: 'up-add-set', basis: { version: opened.version } })).status).toBe('written');
    const data = await loaded(s);
    expect(data.upNext?.edited?.draftId).toBe(opened.draftId);
    const card = s.todaySession.card(data, sel(data, data.nextKey ?? ''));
    expect(card?.edited?.draftId).toBe(opened.draftId);
    expect(card?.title).toBe('Chest · edited');
    const c = await s.todaySession.commit(data, sel(data, data.nextKey ?? ''), 'commit-d8');
    expect(c.ok && c.draftId).toBe(opened.draftId);
  });

  it('Main lift on Your workout moves the draft to the other lift (Today’s own draft for it); the card follows', async () => {
    const { s } = await benNoPlanWithSplit();
    const data = await loaded(s);
    const key = data.nextKey ?? '';
    const c = await s.todaySession.commit(data, sel(data, key), 'edit-main');
    if (!c.ok) throw new Error(c.message);
    const o = await s.builder.todayOptions(c.draftId);
    const other = o?.mainLifts.find((m) => !m.selected);
    if (other === undefined) throw new Error('one main lift');
    const snap = await s.builder.read(c.draftId);
    const r = await s.builder.setTodayOption(c.draftId, { kind: 'main_lift', exerciseId: other.exerciseId }, { opId: 'main-2', expectedVersion: snap?.version ?? 0 });
    expect(r.status).toBe('written');
    const moved = snapOf(r);
    expect(slotsOf(moved.workout.blocks)[0]?.exerciseId).toBe(other.exerciseId);
    const again = await loaded(s);
    expect(again.latestDraft[key]?.mainLiftExerciseId).toBe(other.exerciseId);
  });

  it('an Other session (⋯) is the same lean card, and Your workout offers its options too', async () => {
    const { s } = await benNoPlanWithSplit();
    const data = await loaded(s);
    const full = keyOf(data, 'Full body');
    const card = s.todaySession.card(data, sel(data, full));
    expect(card?.time).not.toBeNull();
    expect(card?.why[0]).toBe('Full body: picked by you; Chest stays next');
    const c = await s.todaySession.commit(data, sel(data, full), 'edit-full');
    if (!c.ok) throw new Error(c.message);
    expect((await s.builder.todayOptions(c.draftId))?.accessories).toBe('focused');
  });
});

describe('V5: the screen', () => {
  const screen = read('screens/TodayScreen.tsx');
  const parts = read('screens/today/TodaySession.tsx');
  it('no chip row (D7), one card for every day (no Main lift / Accessories / Abs / Supersets / breakdown / Mix it up controls on Today)', () => {
    expect(screen).not.toContain('OtherSessionChips');
    expect(parts).not.toContain('export function OtherSessionChips');
    const card = parts.slice(parts.indexOf('export function TodayCard('), parts.indexOf('/** A rest day on a Set days plan'));
    for (const gone of ['TODAY_V2_COPY.mainLift', 'TODAY_V2_COPY.accessories', 'TODAY_V2_COPY.abs', 'TODAY_V2_COPY.supersets', 'TODAY_V2_COPY.breakdown', 'TODAY_V2_COPY.mix', 'view.lean']) expect(card).not.toContain(gone);
    expect(card).toContain('<WorkoutList rows={view.list}');
    expect(card).toContain('<TextButton label={TODAY_V2_COPY.edit} onPress={onEdit} />');
  });
  it('no plan: `No plan` and `Set up a plan ›` on one row, then the card (redesign v3 option C: the days are in `Push ⌄`)', () => {
    const block = screen.slice(screen.indexOf('const cardBlock = '));
    expect(block.indexOf('TODAY_V2_COPY.noPlan')).toBeLessThan(block.indexOf('<TodayCard'));
    // (Ben, 29 Oct) With a plan, the week's days with weekday and status (`weekPickRows`); no plan, the split's.
    expect(screen).toContain('weekPickRows(week, { nextKey');
    expect(screen).toContain('todayDayRows({ days: session.days, nextKey,');
    // `Push ⌄` lists the days and the other workouts, then Build your own, Log a past workout and ＋ Activity.
    expect(screen).toContain('others={session === null ? [] : session.others.map(');
  });
});
