import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { daySheetRows, pairedDaySheetRows } from '../src/today/today-view';
import type { ImportDraft } from '../src/import/import-service';
import type { AppServices } from '../src/services/app-services';
import { FakeHealth } from './fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';
import { answerPreview } from './import-layout-helpers';

/**
 * (Ben, 31 Oct, build 490: "It's also still showing Garmin connection activities that are already linked to workouts
 * in calendars as separate little workouts. I don't know whether it's also counted them as separate workouts in my
 * total progress.") Real SQLite and a fake HealthKit. A Ben-like October: 15 workouts logged in the app, a FitNotes 2
 * import with real times (Tue 27) and a date-only FitNotes import (Mon 12): 17 gym sessions. Garmin Connect (named
 * `Connect` in Health) recorded a `Strength` on most of those days, a run on Thu 29.
 *
 * Totals never counted Health workouts (Sessions and `October workouts` come from gym sessions only); the extra rings
 * were Garmin workouts that had never been paired. The read now pairs every clear-cut day in the window.
 */

let h: Harness;
let fake: FakeHealth;
beforeEach(() => {
  h = createHarness('2026-10-01T16:00:00.000Z');
  fake = new FakeHealth();
});
afterEach(async () => {
  await h.cleanup();
});

const SAT = Date.parse('2026-10-31T09:00:00.000Z');
const APP_DAYS = [1, 3, 5, 6, 8, 10, 13, 15, 17, 19, 21, 23, 24, 26, 28];
const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;
const at = (d: number, hhmm: string) => Date.parse(`${day(d)}T${hhmm}:00.000Z`);
const sets = (n: number) => Array.from({ length: n }, () => ({ load: 60, reps: 8 }));
const MIN = 60_000;

async function launch(): Promise<AppServices> {
  return (await h.launch({ health: { port: fake, buildIncludesHealth: true } })).services;
}

async function commitImport(s: AppServices, name: string, text: string, unit: boolean): Promise<void> {
  const opened = await s.imports.open({ name, text });
  if (opened.kind !== 'preview') throw new Error(`expected a preview, got ${opened.kind}`);
  let draft: ImportDraft = opened.draft;
  if (unit) {
    const u = await s.imports.answer(draft.draftId, draft.mappingVersion, { kind: 'both_columns', answer: 'kg' });
    if (!u.ok) throw new Error(u.reason);
    draft = u.draft;
  }
  draft = await answerPreview(s, draft);
  const done = await s.imports.commit(draft.draftId, draft.mappingVersion, `commit:${name}`);
  if (!done.ok) throw new Error(done.reason);
}

const FITNOTES_12 = ['Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time', ...Array.from({ length: 6 }, () => '2026-10-12,Back Squat,Legs,100.0,5,,,')].join('\n');
const FITNOTES2_27 = [
  'Name,StartTime,EndTime,BodyWeight,Exercise,Equipment,Reps,Weight,Time,Distance,Status,IsWarmup,RPE,RIR,Categories,Note',
  ...Array.from({ length: 6 }, () => 'Pull,2026-10-27T17:30:00Z,2026-10-27T18:20:00Z,80.0,Lat Pulldown,Machine,10,55.0,,,Done,false,,,Back,'),
].join('\n');

/** Garmin Connect's `Strength` (type 50) from `startMs` for `minutes`. */
const strength = (startMs: number, minutes = 50) => fake.addGarmin({ activityType: 50, startMs, endMs: startMs + minutes * MIN, sourceName: 'Connect' });

async function october(s: AppServices) {
  const gymId = await setUpGym(h, s);
  const ids = new Map<number, string>();
  for (const d of APP_DAYS) {
    h.clockMs = at(d, '17:00');
    ids.set(d, await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: sets(4) }]));
  }
  h.clockMs = Date.parse('2026-10-30T12:00:00.000Z');
  await commitImport(s, 'FitNotes_Export.csv', FITNOTES_12, false);
  await commitImport(s, 'FitNotesWorkouts.csv', FITNOTES2_27, true);
  const feed = await s.history.pastWorkouts();
  const imported12 = feed.rows.find((r) => r.localDate === day(12));
  const imported27 = feed.rows.find((r) => r.startedAtUtc === '2026-10-27T17:30:00.000Z');
  if (imported12 === undefined || imported27 === undefined) throw new Error('imports missing');
  // Clear-cut: one Garmin Strength and one workout that day, close in time.
  const clear = { 8: strength(at(8, '16:57')), 23: strength(at(23, '16:58')), 26: strength(at(26, '16:55')), 28: strength(at(28, '16:56'), 50) };
  const pull27 = strength(at(27, '17:28'));
  // Not clear-cut: the date-only import (no time; Garmin at 18:00), two Garmin strength sessions on the 21st, one far
  // from the workout on the 24th.
  const noon12 = strength(at(12, '18:00'));
  const two21 = [strength(at(21, '06:30'), 40), strength(at(21, '16:58'))];
  const far24 = strength(at(24, '22:10'), 30);
  // Runs keep their rings.
  const run17 = fake.addGarmin({ activityType: 37, startMs: at(17, '07:00'), endMs: at(17, '07:40'), distanceM: 8000, sourceName: 'Connect' });
  const run29 = fake.addGarmin({ activityType: 37, startMs: at(29, '07:00'), endMs: at(29, '07:45'), distanceM: 9000, sourceName: 'Connect' });
  return { ids, imported12: imported12.sessionId, imported27: imported27.sessionId, clear, pull27, noon12, two21, far24, run17, run29 };
}

async function readHealth(s: AppServices): Promise<void> {
  await s.health.setSwitch('readActivities', true);
  await s.health.setSwitch('readHeartRate', true);
  await s.health.readNow();
}

/** Progress › Training › Month (October): each day's marks as `dot` / `ring`, the count and the totals. */
async function month(s: AppServices) {
  const t = await s.progress.training({ span: 'month', offset: 0 });
  const m = t?.view?.month;
  if (m === undefined || m === null || t?.view === null || t?.view === undefined) throw new Error('no month');
  const marks: Record<string, string[]> = {};
  for (const tile of m.weeks.flat()) if (tile !== null && tile.marks.length > 0) marks[tile.date] = tile.marks.map((x) => x.kind);
  return { marks, workouts: m.workouts, sessions: t.view.totals.find((x) => x.key === 'sessions')?.value, sets: t.view.totals.find((x) => x.key === 'sets')?.value, dayRows: t.view.dayRows };
}

/** Today's day sheet rows for a day this week (Mon 26 – Sun 1), with the pairing. */
async function dayRows(s: AppServices, date: string) {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  const tile = s.todaySession.week(d, null).find((x) => x.date === date);
  if (tile === undefined) throw new Error('no tile');
  return pairedDaySheetRows(daySheetRows(tile, d.week.feed, () => null), await s.health.dayPairs(date));
}

describe('Ben’s October (build 490): Garmin strength already a workout never shows apart; totals gym sessions only', () => {
  it('back-fills the clear-cut days; no rings for them; one row; Sessions and October workouts stay 17; ambiguous days stay apart', async () => {
    const s = await launch();
    const o = await october(s);
    h.clockMs = SAT;

    // Before reading Health: 17 gym sessions, no rings.
    const before = await month(s);
    expect(before.workouts.count).toBe(17);
    expect(before.sessions).toBe('17');
    expect(Object.values(before.marks).flat().filter((k) => k === 'ring')).toEqual([]);

    // The first read after the upgrade: every clear-cut day in the window pairs, automatically.
    await readHealth(s);
    for (const [d, uuid] of Object.entries(o.clear)) expect(await s.health.forWorkout(o.ids.get(Number(d)) ?? '')).toMatchObject({ kind: 'linked', healthUuid: uuid });
    // The FitNotes 2 import has real times: it pairs too.
    expect(await s.health.forWorkout(o.imported27)).toMatchObject({ kind: 'linked', healthUuid: o.pull27 });
    // The date-only import, the 21st (two strength sessions) and the 24th (hours apart): nothing automatic.
    expect((await s.health.forWorkout(o.imported12)).kind).not.toBe('linked');
    expect((await s.health.forWorkout(o.ids.get(21) ?? '')).kind).not.toBe('linked');
    expect((await s.health.forWorkout(o.ids.get(24) ?? '')).kind).not.toBe('linked');

    const after = await month(s);
    // Totals unchanged: Health workouts, paired or not, never count as gym sessions or sets.
    expect(after.workouts.count).toBe(17);
    expect(after.sessions).toBe('17');
    expect(after.sets).toBeDefined();
    expect(after.sets).toBe(before.sets);
    // Paired days: the dot only. Unpaired strength and runs: their rings.
    for (const d of [8, 23, 26, 27, 28]) expect(after.marks[day(d)]).toEqual(['dot']);
    expect(after.marks[day(12)]).toEqual(['dot', 'ring']);
    expect(after.marks[day(21)]).toEqual(['dot', 'ring', 'ring']);
    expect(after.marks[day(24)]).toEqual(['dot', 'ring']);
    expect(after.marks[day(17)]).toEqual(['dot', 'ring']);
    expect(after.marks[day(29)]).toEqual(['ring']);
    // The day list under the grid: one thing on the 28th, so no list of two; the 24th still lists both.
    expect(after.dayRows[day(28)] ?? []).toHaveLength(0);
    expect(after.dayRows[day(24)]?.map((r) => r.kind)).toEqual(['session', 'activity']);

    // Today's day sheet on Wed 28: one row, Garmin's facts on it, `Paired with Garmin` and Unpair.
    const wed = await dayRows(s, day(28));
    expect(wed).toHaveLength(1);
    expect(wed[0]).toMatchObject({ key: `w:${o.ids.get(28) ?? ''}`, note: 'Paired with Garmin', pair: null, unpair: { healthUuid: o.clear[28] } });
    expect(wed[0]?.detail).toContain('avg 128 bpm');

    // History: no paired Health workout as its own item; the unpaired ones still are.
    const feed = await s.history.feed();
    const activityIds = feed.items.flatMap((i) => (i.kind === 'activity' ? [i.activityId] : []));
    for (const uuid of [...Object.values(o.clear), o.pull27]) expect(activityIds).not.toContain(uuid);
    expect(activityIds).toEqual(expect.arrayContaining([o.far24, o.run29]));

    // Ambiguous: the 21st's strength workouts are offered for Pair on the day sheet's data, both with the day's workout.
    const pairs21 = await s.health.dayPairs(day(21));
    expect(Object.keys(pairs21.unpaired).sort()).toEqual([...o.two21].sort());
    for (const choices of Object.values(pairs21.unpaired)) expect(choices.map((c) => c.sessionId)).toEqual([o.ids.get(21)]);
    // The date-only import pairs by hand; then its ring goes and the count stays 17.
    expect((await s.health.link({ healthUuid: o.noon12, sessionId: o.imported12, opId: 'pair-12' })).ok).toBe(true);
    const paired = await month(s);
    expect(paired.marks[day(12)]).toEqual(['dot']);
    expect(paired.workouts.count).toBe(17);
  });

  it('idempotent across reads and a restart; an Unpair is never auto-linked again', async () => {
    let s = await launch();
    const o = await october(s);
    h.clockMs = SAT;
    await readHealth(s);
    const r = await s.health.forWorkout(o.ids.get(28) ?? '');
    if (r.kind !== 'linked') throw new Error(r.kind);
    const v = await s.health.dayPairs(day(28));
    const link28 = v.paired[o.ids.get(28) ?? ''];
    if (link28 === undefined) throw new Error('no pair');
    // Unpair the 28th (Ben's choice): it shows apart again and later reads leave it.
    expect((await s.health.unlink({ healthUuid: o.clear[28], expectedVersion: link28.linkVersion, opId: 'unpair-28' })).ok).toBe(true);
    await h.forceClose();
    s = await launch();
    h.clockMs = SAT + 3_600_000;
    await s.health.readNow();
    expect((await s.health.forWorkout(o.ids.get(28) ?? '')).kind).not.toBe('linked');
    const m = await month(s);
    expect(m.marks[day(28)]).toEqual(['dot', 'ring']);
    expect(m.workouts.count).toBe(17);
    // The others stay linked at the same version (no rewrite on a later read).
    const again = await s.health.dayPairs(day(26));
    expect(again.paired[o.ids.get(26) ?? '']).toMatchObject({ healthUuid: o.clear[26], linkVersion: 1 });
  });
});
