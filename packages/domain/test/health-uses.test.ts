import { describe, expect, it } from 'vitest';

import { ReviewFactSchema, type HealthSleepSample, type WeightEntry } from '@fizz/schemas';
import {
  activityGroupOf,
  activityGroupsLine,
  activityGroupTotals,
  appleHealthSourceLine,
  applyTrainingChange,
  bodyweightChart,
  bodyweightDaily,
  bodyweightEntries,
  bodyweightTrailingAverage,
  compactSleepText,
  median,
  newTrainingProfile,
  reviewFactLines,
  restingHrVsBaseline,
  sleepNightOf,
  sleepNights,
  thisWeekView,
  todayHealthLine,
  todayHealthLineFor,
  DEFAULT_TODAY_HEALTH_SHOWS,
  toMs,
  weekDataOfReview,
  weekHealthFacts,
  weekHealthLine,
  weeklyFacts,
  weeklyReviewFacts,
  weeklyReviewWorthwhile,
  type HealthDailyValue,
  type ReviewActivity,
  type WeeklyReviewInput,
} from '../src/index';

const TZ = 'Europe/London';
const plain = (t: string | null | undefined): string | null => (t == null ? null : t.replaceAll(' ', ' '));
const day = (date: string, value: number, source = 'Garmin'): HealthDailyValue => ({ date, value, source });

describe('sleep night attribution (Ben, 27 Oct)', () => {
  const ms = (iso: string) => toMs(iso);
  it('a night that crosses midnight is one night, dated the morning he woke', () => {
    // London is UTC+1 until 25 Oct 2026, UTC after. 22:30–23:59 on the 26th and 00:00–06:30 on the 27th.
    expect(sleepNightOf(ms('2026-10-26T22:30:00.000Z'), ms('2026-10-26T23:59:00.000Z'), TZ)).toBe('2026-10-27');
    expect(sleepNightOf(ms('2026-10-27T00:00:00.000Z'), ms('2026-10-27T06:30:00.000Z'), TZ)).toBe('2026-10-27');
    // Ending at 17:59 is still that day; at 18:00 it is the next night.
    expect(sleepNightOf(ms('2026-10-27T11:00:00.000Z'), ms('2026-10-27T17:59:00.000Z'), TZ)).toBe('2026-10-27');
    expect(sleepNightOf(ms('2026-10-27T17:30:00.000Z'), ms('2026-10-27T18:30:00.000Z'), TZ)).toBe('2026-10-28');
  });

  it('an afternoon nap (starting after noon, ending before 18:00) belongs to no night', () => {
    expect(sleepNightOf(ms('2026-10-27T13:00:00.000Z'), ms('2026-10-27T14:00:00.000Z'), TZ)).toBeNull();
  });

  it('sleepNights sums the segments either side of midnight into one night; naps left out', () => {
    const seg = (uuid: string, start: string, end: string, stage: HealthSleepSample['stage'] = 'core'): HealthSleepSample => ({ uuid, stage, startUtc: start, endUtc: end, tz: TZ, sourceName: 'Apple Watch', sourceBundleId: 'watch' });
    const out = sleepNights([
      seg('a0000000-0000-4000-8000-000000000001', '2026-10-26T22:30:00.000Z', '2026-10-26T23:59:00.000Z'),
      seg('a0000000-0000-4000-8000-000000000002', '2026-10-27T00:00:00.000Z', '2026-10-27T06:31:00.000Z', 'deep'),
      seg('a0000000-0000-4000-8000-000000000003', '2026-10-27T13:00:00.000Z', '2026-10-27T14:00:00.000Z'),
    ]);
    expect(out).toEqual([{ date: '2026-10-27', value: 89 + 391, source: 'Apple Watch' }]);
  });
});

describe('resting heart rate vs its 28-day median', () => {
  const today = '2026-10-27';
  const days28 = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 29 + i));
    return day(d.toISOString().slice(0, 10), 54 + (i % 3) - 1);
  });
  it('median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('delta against the median of the 28 days before today (today left out)', () => {
    const r = restingHrVsBaseline([...days28, day(today, 58)], today);
    expect(r).toMatchObject({ bpm: 58, baseline: 54, delta: 4 });
  });
  it('no baseline with fewer than 7 days before today; no value today: null', () => {
    expect(restingHrVsBaseline([day('2026-10-25', 50), day(today, 60)], today)).toMatchObject({ baseline: null, delta: null });
    expect(restingHrVsBaseline(days28, today)).toBeNull();
  });
  it('days older than 28 days never count', () => {
    const old = Array.from({ length: 10 }, (_, i) => day(`2026-09-${String(10 + i)}`, 90));
    expect(restingHrVsBaseline([...old, day(today, 60)], today)?.baseline).toBeNull();
  });
});

describe('Today’s line', () => {
  const today = '2026-10-27';
  const base = Array.from({ length: 28 }, (_, i) => day(new Date(Date.UTC(2026, 8, 29 + i)).toISOString().slice(0, 10), 54));
  it('Sleep 6h 10m · RHR 58 ↑4 with an arrow only from ±3', () => {
    const l = todayHealthLine({ sleep: [day(today, 370)], restingHeartRate: [...base, day(today, 58)] }, today);
    expect(plain(l?.text)).toBe('Sleep 6h 10m · RHR 58 ↑4');
    expect(l?.accessibilityLabel).toContain('4 above your 28-day median');
    expect(plain(todayHealthLine({ sleep: [], restingHeartRate: [...base, day(today, 56)] }, today)?.text)).toBe('RHR 56');
    expect(plain(todayHealthLine({ sleep: [], restingHeartRate: [...base, day(today, 51)] }, today)?.text)).toBe('RHR 51 ↓3');
  });
  it('hidden with nothing for last night or today (yesterday’s values never stand in)', () => {
    expect(todayHealthLine({ sleep: [day('2026-10-26', 400)], restingHeartRate: [day('2026-10-26', 55)] }, today)).toBeNull();
    expect(todayHealthLine({ sleep: [], restingHeartRate: [] }, today)).toBeNull();
  });
  it('sleep alone; compact words; the sheet’s source line', () => {
    expect(plain(todayHealthLine({ sleep: [day(today, 420, 'Apple Watch')], restingHeartRate: [] }, today)?.text)).toBe('Sleep 7h');
    expect(plain(compactSleepText(45))).toBe('45m');
    expect(appleHealthSourceLine(['Garmin', 'Garmin'])).toBe('Apple Health · Garmin');
  });
  it('(Redesign v3 §A2) Today shows only what Ben chose; bodyweight off by default, within 7 days when on', () => {
    const sig = { sleep: [day(today, 425)], restingHeartRate: [...base, day(today, 55)] };
    expect(plain(todayHealthLineFor(sig, today, DEFAULT_TODAY_HEALTH_SHOWS, { date: today, value: 82.4, unit: 'kg', source: null })?.text)).toBe('Sleep 7h 05m · RHR 55');
    expect(plain(todayHealthLineFor(sig, today, { sleep: false, rhr: true, bodyweight: false })?.text)).toBe('RHR 55');
    const all = todayHealthLineFor(sig, today, { sleep: true, rhr: true, bodyweight: true }, { date: '2026-10-25', value: 82.44, unit: 'kg', source: 'Withings' });
    expect(plain(all?.text)).toBe('Sleep 7h 05m · RHR 55 · Weight 82.4 kg');
    expect(all?.accessibilityLabel).toContain('Bodyweight 82.4 kilograms, 2 days ago');
    expect(all?.sources).toContain('Withings');
    // lb stays lb; an old weight isn't today's.
    expect(plain(todayHealthLineFor({ sleep: [], restingHeartRate: [] }, today, { sleep: true, rhr: true, bodyweight: true }, { date: today, value: 181.5, unit: 'lb', source: null })?.text)).toBe('Weight 181.5 lb');
    expect(todayHealthLineFor({ sleep: [], restingHeartRate: [] }, today, { sleep: true, rhr: true, bodyweight: true }, { date: '2026-10-01', value: 82, unit: 'kg', source: null })).toBeNull();
    expect(todayHealthLineFor(sig, today, { sleep: false, rhr: false, bodyweight: false })).toBeNull();
  });
});

describe('the week’s other activity, grouped (Ben, 27 Oct: "and other exercise too")', () => {
  it('groups by type: Health walks, rowing, watch strength; Ben’s own by kind', () => {
    expect(activityGroupOf({ kind: 'other', healthType: 52 })).toBe('walk');
    expect(activityGroupOf({ kind: 'other', healthType: 24 })).toBe('walk');
    expect(activityGroupOf({ kind: 'other', healthType: 35 })).toBe('cardio');
    expect(activityGroupOf({ kind: 'other', healthType: 50 })).toBe('strength');
    expect(activityGroupOf({ kind: 'sport', healthType: 48 })).toBe('sport');
    expect(activityGroupOf({ kind: 'ride', healthType: 74 })).toBe('ride');
    expect(activityGroupOf({ kind: 'other' })).toBe('other');
  });

  it('one compact line: distance where it applies, else minutes; +N more past three groups', () => {
    const totals = activityGroupTotals([
      { kind: 'run', durationS: 2400, distanceM: 6000 },
      { kind: 'run', durationS: 3000, distanceM: 8000, fromHealth: true },
      { kind: 'ride', durationS: 2700, distanceM: null },
      { kind: 'other', healthType: 52, durationS: 2400, distanceM: null, fromHealth: true },
      { kind: 'other', healthType: 52, durationS: 2400, distanceM: null, fromHealth: true },
      { kind: 'other', healthType: 52, durationS: 2400, distanceM: null, fromHealth: true },
      { kind: 'other', healthType: 35, durationS: 1200, distanceM: 4000, fromHealth: true },
      { kind: 'sport', durationS: null, distanceM: null },
    ]);
    const l = activityGroupsLine(totals);
    expect(plain(l?.line)).toBe('2 runs 14 km · 1 ride 45 min · 3 walks 2 h');
    expect(l?.more).toBe(2);
    expect(l?.all.map(plain)).toEqual(['2 runs 14 km', '1 ride 45 min', '3 walks 2 h', '1 cardio 20 min', '1 sport']);
    expect(l?.fromHealth).toBe(true);
    expect(activityGroupsLine([])).toBeNull();
  });

  it('a total only when every one gave it (never a partial sum)', () => {
    const [runs] = activityGroupTotals([
      { kind: 'run', durationS: 1800, distanceM: 5000 },
      { kind: 'run', durationS: 1800, distanceM: null },
    ]);
    expect(runs).toMatchObject({ count: 2, distanceM: null, durationS: 3600 });
  });
});

describe('the week’s sleep and resting heart rate', () => {
  const monday = '2026-10-19';
  it('average sleep over the nights recorded; resting HR first → last; nothing outside the week', () => {
    const f = weekHealthFacts({ sleep: [day('2026-10-18', 300), day('2026-10-19', 420), day('2026-10-20', 430)], restingHeartRate: [day('2026-10-18', 70), day('2026-10-19', 56), day('2026-10-22', 57), day('2026-10-25', 58)] }, monday);
    expect(f).toEqual({ sleep: { avgMin: 425, nights: 2 }, restingHr: { start: { date: '2026-10-19', bpm: 56 }, end: { date: '2026-10-25', bpm: 58 } }, sources: ['Garmin'] });
    expect(plain(weekHealthLine(f))).toBe('Sleep avg 7h 05m · RHR 56 → 58');
  });
  it('one resting HR day is no trend; nothing at all is null', () => {
    expect(weekHealthFacts({ sleep: [], restingHeartRate: [day('2026-10-20', 55)] }, monday)).toBeNull();
    expect(weekHealthLine(null)).toBeNull();
  });
});

describe('weekly review facts with Health (gym first)', () => {
  const MONDAY = '2026-10-12';
  const act = (n: number, date: string, more: Partial<ReviewActivity>): ReviewActivity => ({ id: `a${String(n)}`, date, kind: 'run', status: 'done', distanceM: null, ...more });
  const input = (more: Partial<WeeklyReviewInput> = {}): WeeklyReviewInput => ({ monday: MONDAY, nowMs: toMs('2026-10-19T09:00:00.000Z'), tz: TZ, sessions: [], plans: [], aim: 3, goal: null, info: () => null, lifts: [], liftTargets: [], activities: [], templates: [], painFlagged: new Set(), unit: 'kg', ...more });

  it('groups Ben’s and Health’s activities, stores them and the week’s sleep/RHR as valid facts, and reads them back', () => {
    const f = weeklyFacts(
      input({
        activities: [
          act(1, '2026-10-13', { distanceM: 6000, durationS: 1800 }),
          act(2, '2026-10-15', { distanceM: 8000, durationS: 2600, fromHealth: true, healthType: 37 }),
          act(3, '2026-10-16', { kind: 'other', healthType: 52, durationS: 3600, fromHealth: true }),
          act(4, '2026-10-20', { kind: 'ride', durationS: 3600 }),
          act(5, '2026-10-14', { kind: 'ride', status: 'planned', durationS: 3600 }),
        ],
        health: { sleep: [day('2026-10-13', 400), day('2026-10-14', 440)], restingHeartRate: [day('2026-10-12', 55), day('2026-10-18', 57)] },
      }),
    );
    expect(f.activities.map((a) => [a.group, a.count])).toEqual([
      ['run', 2],
      ['walk', 1],
    ]);
    expect(f.health?.sleep).toEqual({ avgMin: 420, nights: 2 });
    // A week with other activity only is worth reviewing once there is any workout history.
    expect(weeklyReviewWorthwhile({ ...f, hasHistory: true, week: { ...f.week, workouts: 0, planned: null } })).toBe(true);
    const facts = weeklyReviewFacts(f);
    for (const x of facts) expect(ReviewFactSchema.safeParse(x).success).toBe(true);
    expect(facts.filter((x) => x.kind === 'activity_group')).toHaveLength(2);
    const d = weekDataOfReview({ subject: { kind: 'weekly', weekMonday: MONDAY }, facts }, () => 'Exercise');
    expect(d?.activities).toEqual(f.activities);
    expect(d?.health).toEqual(f.health);
    const lines = (d === null ? [] : reviewFactLines(d)).map(plain);
    // The sessions line leads; runs move into the activity line, which comes after lifting.
    expect(lines[0]).toBe('0 of 3 sessions');
    expect(lines.at(-2)).toBe('2 runs 14 km · 1 walk 1 h');
    expect(lines.at(-1)).toBe('Sleep avg 7h · RHR 55 → 57');
  });

  it('with no Health data and no activity nothing is added', () => {
    const f = weeklyFacts(input());
    expect(f.activities).toEqual([]);
    expect(f.health).toBeNull();
    expect(weeklyReviewFacts(f).some((x) => x.kind === 'activity_group' || x.kind === 'health_week')).toBe(false);
  });

  it('Progress’s week card: the activity line and the health line', () => {
    const v = thisWeekView(input({ activities: [act(1, '2026-10-13', { distanceM: 5000 })], health: { sleep: [day('2026-10-13', 400)], restingHeartRate: [] } }), { today: '2026-10-19' });
    expect(plain(v.activities?.line)).toBe('1 run 5 km');
    expect(plain(v.health)).toBe('Sleep avg 6h 40m');
    const none = thisWeekView(input(), { today: '2026-10-19' });
    expect(none.activities).toBeNull();
    expect(none.health).toBeNull();
  });
});

describe('bodyweight: merge, daily points, 7-day average, kg/lb', () => {
  const mine = (id: string, date: string, value: number, unit: 'kg' | 'lb' = 'kg', at = `${date}T07:00:00.000Z`): WeightEntry => ({ id, date, value, unit, recordedAtUtc: at });
  const health = (uuid: string, atUtc: string, kg: number) => ({ uuid, kg, atUtc, tz: TZ, sourceName: 'Withings', sourceBundleId: 'w' });

  it('his entry wins on the same day; Health fills the others; shown in his unit', () => {
    const entries = bodyweightEntries([mine('m1', '2026-10-20', 180, 'lb')], [health('a0000000-0000-4000-8000-000000000001', '2026-10-20T06:00:00.000Z', 83), health('a0000000-0000-4000-8000-000000000002', '2026-10-21T06:00:00.000Z', 81.6)]);
    const kgPoints = bodyweightDaily(entries, 'kg');
    expect(kgPoints.map((p) => [p.date, p.value, p.from])).toEqual([
      ['2026-10-20', 81.6, 'you'],
      ['2026-10-21', 81.6, 'health'],
    ]);
    expect(bodyweightDaily(entries, 'lb').map((p) => p.value)).toEqual([180, 179.9]);
  });

  it('two of his on one day: the later one is the day’s', () => {
    const pts = bodyweightDaily(bodyweightEntries([mine('a', '2026-10-20', 82, 'kg', '2026-10-20T07:00:00.000Z'), mine('b', '2026-10-20', 81, 'kg', '2026-10-20T20:00:00.000Z')], []), 'kg');
    expect(pts.map((p) => p.id)).toEqual(['b']);
  });

  it('the trailing 7-day average uses the days within 7 days, not 7 points', () => {
    const avg = bodyweightTrailingAverage([
      { date: '2026-10-01', value: 80 },
      { date: '2026-10-05', value: 82 },
      { date: '2026-10-07', value: 84 },
      { date: '2026-10-08', value: 90 },
    ]);
    expect(avg).toEqual([80, 81, 82, 85.3]);
  });

  it('range, latest and change over the range; the average carries points from before the range', () => {
    const entries = bodyweightEntries([mine('1', '2026-06-01', 85), mine('2', '2026-09-26', 84), mine('3', '2026-10-01', 83), mine('4', '2026-10-26', 82.4)], []);
    const m = bodyweightChart(entries, { range: '1m', unit: 'kg', today: '2026-10-27' });
    expect(m.points.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-26']);
    expect(m.average).toEqual([83.5, 82.4]);
    expect(plain(m.latest)).toBe('82.4 kg · 26 Oct');
    expect(plain(m.change)).toBe('−0.6 kg');
    const all = bodyweightChart(entries, { range: 'all', unit: 'kg', today: '2026-10-27' });
    expect(all.from).toBe('2026-06-01');
    expect(plain(all.change)).toBe('−2.6 kg');
    expect(all.source).toBeNull();
    expect(bodyweightChart([], { range: '3m', unit: 'kg', today: '2026-10-27' }).empty).toBe(true);
  });

  it('Health points name their source', () => {
    const v = bodyweightChart(bodyweightEntries([], [health('a0000000-0000-4000-8000-000000000003', '2026-10-21T06:00:00.000Z', 81)]), { range: '3m', unit: 'kg', today: '2026-10-27' });
    expect(v.source).toBe('Withings · Apple Health');
    expect(v.change).toBeNull();
  });
});

describe('edit_weight (versioned, op IDs)', () => {
  const ctx = (opId: string, expectedVersion: number) => ({ opId, expectedVersion, atUtc: '2026-10-27T08:00:00.000Z', nowYear: 2026, today: '2026-10-27' });
  it('edits value, unit and date of his entry; a repeated op is a no-op; a stale version is refused; Undo is the edit back', () => {
    let p = newTrainingProfile({ id: '00000000-0000-4000-8000-000000000001', ownerId: '00000000-0000-4000-8000-000000000002', atUtc: '2026-10-01T00:00:00.000Z' });
    const add = applyTrainingChange(p, { kind: 'add_weight', entry: { id: 'w1', date: '2026-10-26', value: 82.4, unit: 'kg' } }, ctx('op1', 1));
    if (!add.ok) throw new Error('add');
    p = add.profile;
    const edit = applyTrainingChange(p, { kind: 'edit_weight', entryId: 'w1', value: 181, unit: 'lb', date: '2026-10-25' }, ctx('op2', p.version));
    if (!edit.ok) throw new Error('edit');
    expect(edit.profile.weights).toEqual([{ id: 'w1', date: '2026-10-25', value: 181, unit: 'lb', recordedAtUtc: '2026-10-27T08:00:00.000Z' }]);
    const again = applyTrainingChange(edit.profile, { kind: 'edit_weight', entryId: 'w1', value: 181, unit: 'lb', date: '2026-10-25' }, ctx('op2', p.version));
    expect(again.ok && again.replayed).toBe(true);
    expect(applyTrainingChange(edit.profile, { kind: 'edit_weight', entryId: 'w1', value: 80, unit: 'kg', date: '2026-10-25' }, ctx('op3', p.version))).toMatchObject({ ok: false, error: 'stale' });
    const undo = applyTrainingChange(edit.profile, { kind: 'edit_weight', entryId: 'w1', value: 82.4, unit: 'kg', date: '2026-10-26' }, ctx('op4', edit.profile.version));
    expect(undo.ok && undo.profile.weights[0]).toMatchObject({ value: 82.4, unit: 'kg', date: '2026-10-26' });
  });
  it('refuses a missing entry, a future date and an impossible weight', () => {
    const p = newTrainingProfile({ id: '00000000-0000-4000-8000-000000000001', ownerId: '00000000-0000-4000-8000-000000000002', atUtc: '2026-10-01T00:00:00.000Z' });
    expect(applyTrainingChange(p, { kind: 'edit_weight', entryId: 'nope', value: 80, unit: 'kg', date: '2026-10-26' }, ctx('x', 1))).toMatchObject({ ok: false, error: 'invalid' });
    const add = applyTrainingChange(p, { kind: 'add_weight', entry: { id: 'w1', date: '2026-10-26', value: 82, unit: 'kg' } }, ctx('a', 1));
    if (!add.ok) throw new Error('add');
    expect(applyTrainingChange(add.profile, { kind: 'edit_weight', entryId: 'w1', value: 80, unit: 'kg', date: '2026-10-28' }, ctx('b', 2))).toMatchObject({ ok: false });
    expect(applyTrainingChange(add.profile, { kind: 'edit_weight', entryId: 'w1', value: 900, unit: 'lb', date: '2026-10-26' }, ctx('c', 2))).toMatchObject({ ok: false });
  });
});
