import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildWeekTiles, todayRestDay } from '@fizz/domain';

import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { followUpNext, hasOwnDraftFor, movedOffToday, plannedOnOf, type TodayCardState } from '../src/today/today-view';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, type Harness } from './harness';

/**
 * (Ben, 29 Oct: "After I move an exercise it stays up on the calendar on today and also moves to new day") Real
 * SQLite, offline. The day sheet's Move…, Do today instead (a swap), Skip and the Undo of each: the day moved off today
 * is ringed on its new day only; today shows what is there now (nothing, or the day swapped in); the card, Up next,
 * Library › Plan's week and the count agree. Set days (with and without the lead-in) and Any days.
 *
 * Root cause: today's tile rang the card's day (`chosen`) whatever its date. After a this-week change the card kept the
 * day it showed (Ben's own draft or changed controls held it; a missed day kept today's tile from being a rest day), so
 * the moved day was ringed on today and on its new day.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-26T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const THU = Date.parse('2026-10-29T08:00:00.000Z');

async function setUpGym(s: AppServices): Promise<string> {
  await s.setup.saveUnits('kg');
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
  await s.setup.complete();
  const gym = await s.yourData.currentGym();
  if (!gym) throw new Error('no gym');
  return gym.id;
}

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

async function applyPlan(s: AppServices, schedule: 'set' | 'any'): Promise<void> {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const a = { ...session.answers, split: 'ppl' as const, sessions: 6, schedule, days: schedule === 'set' ? [0, 1, 2, 3, 4, 5] : [] };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
}

/** Ben's Mon (Legs), Tue (Pull), Wed (Up next from the plan); Thursday 08:00. `leadIn`: the plan applied Tue evening. */
async function bensWeek(s: AppServices, gymId: string, o: { schedule?: 'set' | 'any'; leadIn?: boolean } = {}): Promise<void> {
  const schedule = o.schedule ?? 'set';
  if (o.leadIn !== true) await applyPlan(s, schedule);
  h.clockMs = Date.parse('2026-10-26T18:00:00.000Z');
  await logWorkout(h, s, gymId, [
    { exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }] },
    { exercise: 'Romanian deadlift', sets: [{ load: 80, reps: 8 }] },
  ]);
  h.clockMs = Date.parse('2026-10-27T18:00:00.000Z');
  await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 70, reps: 8 }, { load: 70, reps: 8 }] }]);
  if (o.leadIn === true) {
    h.clockMs = Date.parse('2026-10-27T20:00:00.000Z');
    await applyPlan(s, schedule);
  }
  h.clockMs = Date.parse('2026-10-28T18:04:00.000Z');
  const d = await loaded(s);
  const key = d.nextKey;
  const controls = key === null ? undefined : d.initial[key];
  if (key === null || controls === undefined) throw new Error('no Up next');
  const c = await s.todaySession.commit(d, { dayKey: key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  h.clockMs += 60_000;
  await finishWorkout(h, s, r.aggregate.session.id);
  h.clockMs = THU;
}

const keyOf = (d: TodaySessionData, name: string): string => {
  const k = d.days.find((x) => x.name === name)?.key;
  if (k === undefined) throw new Error(`no ${name}`);
  return k;
};
const nameOf = (d: TodaySessionData, key: string | null): string | null => d.days.find((x) => x.key === key)?.name ?? null;
const indexOf = (d: TodaySessionData, name: string): number => {
  const i = d.days.find((x) => x.name === name)?.dayIndex;
  if (i == null) throw new Error(`no ${name}`);
  return i;
};

/** Today's screen, as TodayScreen runs it: the card follows (with Ben's own draft on it: the hardest case), the rest day, the tiles. */
class Screen {
  card: TodayCardState | null = null;
  pickedKey: string | null = null;
  followed: string | null = null;
  prev: TodaySessionData | null = null;
  constructor(
    private readonly s: AppServices,
    private readonly ownDraft = true,
  ) {}
  read(d: TodaySessionData): void {
    const before = this.prev;
    this.prev = d;
    const cur = this.card;
    if (cur === null || d.initial[cur.dayKey] === undefined) {
      const key = d.nextKey;
      const init = key === null ? undefined : d.initial[key];
      this.card = key === null || init === undefined ? null : { dayKey: key, controls: init, open: false, why: false };
      return;
    }
    const movedOff = movedOffToday(cur.dayKey, before === null ? null : { localDate: before.localDate, plannedOn: plannedOnOf(before), skippedOn: before.week.skippedOn }, { localDate: d.localDate, plannedOn: plannedOnOf(d), skippedOn: d.week.skippedOn });
    if (movedOff && this.pickedKey === cur.dayKey) this.pickedKey = null;
    const next = followUpNext(cur, {
      prevNextKey: before?.nextKey ?? null,
      nextKey: d.nextKey,
      picked: this.pickedKey === cur.dayKey,
      hasOwnDraft: (this.ownDraft || hasOwnDraftFor(cur.dayKey, d)) && this.followed !== cur.dayKey,
      initialWas: before?.initial[cur.dayKey] ?? null,
      initial: d.initial,
      movedOff,
    });
    if (next !== cur) this.followed = movedOff || this.followed === cur.dayKey ? next.dayKey : null;
    this.card = next;
  }
  pick(d: TodaySessionData, key: string): void {
    const init = d.initial[key];
    if (init === undefined) throw new Error('no controls');
    this.pickedKey = key;
    this.followed = null;
    this.card = { dayKey: key, controls: init, open: false, why: false };
  }
  tiles(d: TodaySessionData): string[] {
    const picked = this.pickedKey !== null && this.pickedKey === this.card?.dayKey;
    const rest = picked || d.status !== 'plan' ? null : todayRestDay({ setDays: d.week.setDays, doneToday: d.doneToday, today: d.localDate, days: d.days, plannedOn: plannedOnOf(d) });
    const chosen = rest !== null ? null : nameOf(d, this.card?.dayKey ?? null);
    return this.s.todaySession.week(d, chosen, picked).map((t) => `${t.date.slice(8)} ${t.today ? 'today ' : ''}${t.state}${t.marks.length === 0 ? '' : ` ${t.marks.map((m) => `${m.shape}:${m.colour}`).join(',')}`}`);
  }
}

async function change(s: AppServices, c: Parameters<AppServices['plans']['weekChange']>[0]['change']): Promise<void> {
  const o = await s.plans.overview();
  const planId = o?.block?.planId;
  if (planId === undefined) throw new Error('no plan');
  expect(await s.plans.weekChange({ planId, expectedVersion: o?.block?.planVersion ?? 0, opId: h.ids(), change: c })).toMatchObject({ ok: true });
}
async function undo(s: AppServices): Promise<void> {
  const o = await s.plans.overview();
  const planId = o?.block?.planId;
  if (planId === undefined) throw new Error('no plan');
  expect(await s.plans.undoWeekChange({ planId, expectedVersion: o?.block?.planVersion ?? 0, opId: h.ids() })).toMatchObject({ ok: true });
}
/** Library › Plan's this week: each plan day's weekday (Mon = 0) and the count. */
async function library(s: AppServices): Promise<{ weekdays: Record<string, number | null>; count: string | undefined }> {
  const o = await s.plans.overview();
  const b = o?.block;
  const view = b?.views[b.current - 1];
  return { weekdays: Object.fromEntries((view?.days ?? []).filter((x) => !x.done).map((x) => [x.name, x.weekday])), count: o?.daysThisWeek.text };
}
const rings = (tiles: readonly string[], colour: string): string[] => tiles.filter((t) => t.includes(`ring:${colour}`)).map((t) => t.slice(0, 2));
/** The service's tiles for a card still on `chosen` (its guard on its own), as `29 ring:push`. */
const serviceTiles = (s: AppServices, d: TodaySessionData, chosen: string): string[] => s.todaySession.week(d, chosen).map((t) => `${t.date.slice(8)} ${t.marks.map((m) => `${m.shape}:${m.colour}`).join(',')}`);

describe('Set days: a day moved off today is ringed on its new day only (Ben, 29 Oct)', () => {
  for (const leadIn of [false, true]) {
    it(`Move…: Push B (today) to Sunday, and Undo${leadIn ? ' (the lead-in)' : ''}`, async () => {
      const { services: s } = await h.launch();
      await bensWeek(s, await setUpGym(s), { leadIn });
      const screen = new Screen(s);
      let d = await loaded(s);
      screen.read(d);
      expect(nameOf(d, d.nextKey)).toBe('Push B');
      expect(screen.tiles(d).slice(3)).toEqual(['29 today planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain']);
      await change(s, { kind: 'move', dayIndex: indexOf(d, 'Push B'), weekday: 6 });
      d = await loaded(s);
      screen.read(d);
      // Push B on Sunday only; Thursday has nothing left (a rest day); the card left Push B for Up next.
      expect(rings(screen.tiles(d), 'push')).toEqual(['01']);
      expect(screen.tiles(d)[3]).toBe('29 today plain');
      expect(nameOf(d, d.nextKey)).toBe('Pull B');
      expect(nameOf(d, screen.card?.dayKey ?? null)).toBe('Pull B');
      // A card still on Push B (the service guard on its own): never ringed on today as well.
      expect(rings(serviceTiles(s, d, 'Push B'), 'push')).toEqual(['01']);
      // The day sheet and the picker agree; so does Library › Plan's week and its count.
      expect(s.todaySession.daySheet(d, { date: '2026-10-29' }, screen.card?.dayKey ?? null, (x) => x).statusText).toBe('Rest');
      expect(s.todaySession.daySheet(d, { date: '2026-11-01' }, screen.card?.dayKey ?? null, (x) => x).title).toBe('Sun · Push B');
      expect((await library(s)).weekdays).toMatchObject({ 'Push B': 6, 'Pull B': 4, 'Legs B': 5 });
      expect((await library(s)).count).toBe('3 of 6');
      await undo(s);
      d = await loaded(s);
      screen.read(d);
      expect(nameOf(d, d.nextKey)).toBe('Push B');
      expect(nameOf(d, screen.card?.dayKey ?? null)).toBe('Push B');
      expect(screen.tiles(d).slice(3)).toEqual(['29 today planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain']);
      expect((await library(s)).weekdays['Push B']).toBe(3);
    });
  }

  it('Do today instead (Legs B from Saturday): Legs B rings today, Push B Saturday, each once; Undo puts both back', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s, await setUpGym(s));
    const screen = new Screen(s);
    let d = await loaded(s);
    screen.read(d);
    await change(s, { kind: 'swap_days', dayIndex: indexOf(d, 'Legs B'), withDayIndex: indexOf(d, 'Push B') });
    d = await loaded(s);
    screen.read(d);
    expect(nameOf(d, screen.card?.dayKey ?? null)).toBe('Legs B');
    expect(screen.tiles(d).slice(3)).toEqual(['29 today planned ring:legs', '30 planned ring:pull', '31 planned ring:push', '01 plain']);
    expect(s.todaySession.week(d, 'Push B').map((t) => t.marks.length)).toEqual([1, 1, 1, 0, 1, 1, 0]);
    expect((await library(s)).weekdays).toMatchObject({ 'Push B': 5, 'Legs B': 3 });
    await undo(s);
    d = await loaded(s);
    screen.read(d);
    expect(nameOf(d, screen.card?.dayKey ?? null)).toBe('Push B');
    expect(screen.tiles(d).slice(3)).toEqual(['29 today planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain']);
  });

  it('Skip this week (Push B, today): no ring anywhere for it, the count drops; Unskip and Undo bring it back', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s, await setUpGym(s));
    const screen = new Screen(s);
    let d = await loaded(s);
    screen.read(d);
    await change(s, { kind: 'skip', dayIndex: indexOf(d, 'Push B') });
    d = await loaded(s);
    screen.read(d);
    expect(rings(screen.tiles(d), 'push')).toEqual([]);
    expect(rings(serviceTiles(s, d, 'Push B'), 'push')).toEqual([]);
    expect(screen.card?.dayKey).not.toBe(keyOf(d, 'Push B'));
    expect((await library(s)).count).toBe('3 of 5');
    await undo(s);
    d = await loaded(s);
    screen.read(d);
    expect(screen.tiles(d)[3]).toBe('29 today planned ring:push');
    expect((await library(s)).count).toBe('3 of 6');
    // Unskip (its own write) and its Undo.
    await change(s, { kind: 'skip', dayIndex: indexOf(d, 'Push B') });
    screen.read(await loaded(s));
    await change(s, { kind: 'unskip', dayIndex: indexOf(d, 'Push B') });
    d = await loaded(s);
    screen.read(d);
    expect(screen.tiles(d)[3]).toBe('29 today planned ring:push');
    await undo(s);
    d = await loaded(s);
    screen.read(d);
    expect(rings(screen.tiles(d), 'push')).toEqual([]);
  });

  it('Ben’s report: a day he picked for today, then moved on: ringed on its new day only, today shows today’s day', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s, await setUpGym(s));
    // Friday: Thursday's Push B was missed; Pull B is Friday's. Ben picks Push B for today on the card.
    h.clockMs = Date.parse('2026-10-30T08:00:00.000Z');
    const screen = new Screen(s);
    let d = await loaded(s);
    screen.read(d);
    screen.pick(d, keyOf(d, 'Push B'));
    expect(screen.tiles(d).slice(4)).toEqual(['30 today planned ring:push', '31 planned ring:legs', '01 plain']);
    // Then Move… Push B to Sunday from its sheet.
    await change(s, { kind: 'move', dayIndex: indexOf(d, 'Push B'), weekday: 6 });
    d = await loaded(s);
    screen.read(d);
    // Before the fix: `30 today planned ring:push` and `01 planned ring:push`.
    expect(screen.tiles(d).slice(4)).toEqual(['30 today planned ring:pull', '31 planned ring:legs', '01 planned ring:push']);
    expect(nameOf(d, screen.card?.dayKey ?? null)).toBe('Pull B');
  });
});

describe('Any days', () => {
  it('Skip Up next: never ringed (today included), Up next moves on; Undo; Do today instead (a pick) rings once', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s, await setUpGym(s), { schedule: 'any' });
    const screen = new Screen(s, false);
    let d = await loaded(s);
    screen.read(d);
    const first = nameOf(d, d.nextKey) ?? '';
    const colour = first.toLowerCase().split(' ')[0] ?? '';
    expect(screen.tiles(d)[3]).toBe(`29 today planned ring:${colour === 'legs' ? 'legs' : colour}`);
    await change(s, { kind: 'skip', dayIndex: indexOf(d, first) });
    d = await loaded(s);
    screen.read(d);
    expect(nameOf(d, screen.card?.dayKey ?? null)).toBe(nameOf(d, d.nextKey));
    expect(nameOf(d, d.nextKey)).not.toBe(first);
    // A card still on the skipped day: not ringed either.
    expect(s.todaySession.week(d, first).filter((x) => x.items.some((i) => i.text === first)).length).toBe(0);
    await undo(s);
    d = await loaded(s);
    screen.read(d);
    expect(screen.tiles(d)[3]).toBe(`29 today planned ring:${colour}`);
    // Do today instead on Any days: Ben's pick holds today; it's not also placed on a later day.
    const later = d.days.find((x) => x.key !== d.nextKey && d.week.ahead.some((a) => a.key === x.key));
    if (later === undefined) throw new Error('no later day');
    screen.pick(d, later.key);
    const names = screen.tiles(d).join(' ');
    expect(s.todaySession.week(d, later.name, true).filter((x) => x.items.some((i) => i.text === later.name)).map((x) => x.date)).toEqual(['2026-10-29']);
    expect(names).toContain('29 today planned');
  });
});

describe('the tile rule (pure)', () => {
  const base = { today: '2026-10-29', workouts: [], activities: [] } as const;
  it('a card day dated later this week is ringed there only; picked, it rings today and its later ring goes', () => {
    const planned = [{ localDate: '2026-11-01', name: 'Push B' }];
    const t = buildWeekTiles({ ...base, plannedDays: planned, chosen: 'Push B' });
    expect(t.map((x) => x.marks.length)).toEqual([0, 0, 0, 0, 0, 0, 1]);
    const p = buildWeekTiles({ ...base, plannedDays: planned, chosen: 'Push B', chosenPicked: true });
    expect(p.map((x) => x.marks.length)).toEqual([0, 0, 0, 1, 0, 0, 0]);
  });
  it('a missed day (dated earlier) or today’s own day still rings today; a skipped one doesn’t', () => {
    expect(buildWeekTiles({ ...base, plannedDays: [{ localDate: '2026-10-28', name: 'Push A' }], chosen: 'Push A' })[3]?.marks.length).toBe(1);
    expect(buildWeekTiles({ ...base, plannedDays: [{ localDate: '2026-10-29', name: 'Push B' }], chosen: 'Push B' })[3]?.marks.length).toBe(1);
    expect(buildWeekTiles({ ...base, chosen: 'Push B', skipped: ['Push B'] })[3]?.marks.length).toBe(0);
  });
});
