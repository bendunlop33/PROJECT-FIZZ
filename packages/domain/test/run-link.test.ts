import { describe, expect, it } from 'vitest';

import { ActivitySchema, type Activity, type HealthWorkoutSample } from '@fizz/schemas';

import { activitiesWithHealth, activityRow, activityStatusOn, editActivity, legRunNear, linkActivityHealth, plannedLinkChoices, plannedWord, unlinkActivityHealth } from '../src';

/**
 * (Ben, 2 Nov: "should be able to link a planned run which then updates it to an actual run (on the same day) otherwise
 * its just missed") Ben's own Link of a planned run to a Health run: pure pieces. Made-up runs, never Ben's.
 */

const OWNER = '00000000-0000-4000-8000-000000000001';
const PLAN = '20000000-0000-4000-8000-000000000001';
const TZ = 'Europe/London';
const AM = 'a0000000-0000-4000-8000-000000000001';
const PM = 'a0000000-0000-4000-8000-000000000002';
const WATCH = 'a0000000-0000-4000-8000-000000000003';
const THU = '2026-10-29';
const at = { utc: '2026-11-02T09:00:00.000Z', tz: TZ };

const run = (uuid: string, startUtc: string, minutes: number, distanceM: number, p: Partial<HealthWorkoutSample> = {}): HealthWorkoutSample => ({
  uuid,
  activityType: 37,
  startUtc,
  endUtc: new Date(Date.parse(startUtc) + minutes * 60_000).toISOString(),
  tz: TZ,
  durationS: minutes * 60,
  distanceM,
  avgHeartRate: 150,
  maxHeartRate: 170,
  sourceName: 'Garmin Connect',
  sourceBundleId: 'com.garmin.connect.mobile',
  externalId: null,
  ...p,
});

const planned = (p: Partial<Activity> = {}): Activity =>
  ActivitySchema.parse({
    id: PLAN,
    ownerId: OWNER,
    version: 1,
    createdAtUtc: '2026-10-27T10:00:00.000Z',
    updatedAtUtc: '2026-10-27T10:00:00.000Z',
    fields: { kind: 'run', status: 'planned', date: THU, durationS: null, distanceM: 8000, effort: 'easy' },
    tz: TZ,
    source: 'ben',
    deletedAtUtc: null,
    lastChange: null,
    opIds: ['plan'],
    ...p,
  });

const am = run(AM, `${THU}T07:00:00.000Z`, 30, 5000);
const pm = run(PM, `${THU}T18:00:00.000Z`, 50, 10_000);
const show = (own: Activity[], samples: HealthWorkoutSample[]) => activitiesWithHealth({ ownerId: OWNER, samples, links: [], own, ownBundleId: null, writtenUuids: new Set(), appSessionIds: new Set() });
const linked = (uuid: string) => planned({ version: 2, healthLink: { healthUuid: uuid, linkedAtUtc: at.utc } });

describe('activitiesWithHealth with Ben’s Link', () => {
  it('two runs: nothing matches on its own; his Link makes the plan done with that run as recorded, the other shows apart', () => {
    expect(show([planned()], [am, pm]).map((a) => [a.id, a.fields.status])).toEqual([
      [PLAN, 'planned'],
      [AM, 'done'],
      [PM, 'done'],
    ]);
    const out = show([linked(PM)], [am, pm]);
    expect(out.map((a) => a.id)).toEqual([PLAN, AM]);
    // Health's time and distance (never the planned 8 km), his effort word, and where it came from (rule 6).
    expect(out[0]).toMatchObject({ source: 'ben', fields: { status: 'done', durationS: 3000, distanceM: 10_000, effort: 'easy' }, health: { uuid: PM, sourceName: 'Garmin', startUtc: pm.startUtc } });
  });

  it('a Link overrides the automatic match; another source’s recording of the linked run shows nowhere', () => {
    const watch = run(WATCH, `${THU}T18:01:00.000Z`, 49, 9900, { sourceName: 'Apple Watch', sourceBundleId: 'com.apple.health' });
    const out = show([linked(PM)], [pm, watch]);
    expect(out.map((a) => [a.id, a.health?.uuid])).toEqual([[PLAN, PM]]);
  });

  it('a link to a run that is gone, another day’s or another kind’s is set aside: the automatic match decides', () => {
    expect(show([linked(PM)], [am])[0]).toMatchObject({ id: PLAN, fields: { status: 'done' }, health: { uuid: AM } });
    expect(show([linked(PM)], [])[0]?.fields.status).toBe('planned');
    const fri = run(PM, '2026-10-30T07:00:00.000Z', 30, 5000);
    expect(show([linked(PM)], [fri]).map((a) => [a.id, a.fields.status])).toEqual([[PLAN, 'planned'], [PM, 'done']]);
    const ride = run(PM, `${THU}T07:00:00.000Z`, 30, 5000, { activityType: 13 });
    expect(show([linked(PM)], [ride]).map((a) => a.id)).toEqual([PLAN, PM]);
  });
});

describe('plannedLinkChoices', () => {
  it('open with the day’s runs on their own, earliest first; linked; matched; same day in the plan’s zone only', () => {
    const st = plannedLinkChoices(planned(), show([planned()], [pm, am]));
    expect(st).toMatchObject({ state: 'open', activityId: PLAN, version: 1 });
    expect(st.state === 'open' ? st.choices.map((c) => [c.healthUuid, c.label.replaceAll(' ', ' ')]) : []).toEqual([
      [AM, 'Garmin · 07:00 · 5 km · 30 min'],
      [PM, 'Garmin · 18:00 · 10 km · 50 min'],
    ]);
    expect(plannedLinkChoices(linked(PM), show([linked(PM)], [am, pm]))).toEqual({ state: 'linked', activityId: PLAN, version: 2, healthUuid: PM });
    expect(plannedLinkChoices(planned(), show([planned()], [am]))).toEqual({ state: 'matched' });
    // 23:30 UTC on Thursday is 00:30 Friday in Berlin: not that plan's day there.
    const late = run(PM, `${THU}T23:30:00.000Z`, 30, 5000);
    const berlin = planned({ tz: 'Europe/Berlin' });
    const shown = show([], [am, late]);
    expect(plannedLinkChoices(berlin, shown)).toMatchObject({ state: 'open', choices: [{ healthUuid: AM }] });
    expect(plannedLinkChoices(planned(), shown)).toMatchObject({ state: 'open', choices: [{ healthUuid: AM }, { healthUuid: PM }] });
    expect(plannedLinkChoices(planned({ deletedAtUtc: at.utc }), shown)).toEqual({ state: 'none' });
  });
});

describe('Link / Unlink writes (rule 5)', () => {
  it('versioned and idempotent; only a planned one links; Unlink only of the run it shows', () => {
    const c = linkActivityHealth(planned(), { expectedVersion: 1, healthUuid: PM.toUpperCase(), opId: 'l1', at });
    if (c.kind !== 'write') throw new Error(c.kind);
    expect(c.next).toMatchObject({ version: 2, healthLink: { healthUuid: PM }, fields: planned().fields, lastChange: null });
    expect(c.expectedVersion).toBe(1);
    expect(linkActivityHealth(c.next, { expectedVersion: 1, healthUuid: PM, opId: 'l1', at }).kind).toBe('duplicate');
    expect(linkActivityHealth(c.next, { expectedVersion: 1, healthUuid: AM, opId: 'l2', at }).kind).toBe('stale');
    expect(linkActivityHealth(planned({ fields: { ...planned().fields, status: 'done' } }), { expectedVersion: 1, healthUuid: PM, opId: 'l3', at }).kind).toBe('invalid');

    expect(unlinkActivityHealth(c.next, { expectedVersion: 2, healthUuid: AM, opId: 'u0', at }).kind).toBe('stale');
    const u = unlinkActivityHealth(c.next, { expectedVersion: 2, healthUuid: PM, opId: 'u1', at });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect(u.next.version).toBe(3);
    expect('healthLink' in u.next).toBe(false);
    expect(ActivitySchema.parse(u.next)).toEqual(u.next);
    // An edit keeps the link; an Undo of an edit from before the link is out of date.
    const e = editActivity(c.next, { expectedVersion: 2, opId: 'e1', at, fields: { ...c.next.fields, effort: 'hard' } });
    expect(e.kind === 'write' ? e.next.healthLink?.healthUuid : null).toBe(PM);
  });

  it('Missed once its day has passed with nothing linked or matched; Planned until then', () => {
    expect(plannedWord(THU, THU)).toBe('Planned');
    expect(plannedWord(THU, '2026-10-30')).toBe('Missed');
    expect(activityRow(planned(), '2026-11-02').detail.replaceAll(' ', ' ')).toBe('Missed · 8 km · easy');
    expect(activityRow(show([linked(PM)], [pm])[0] as Activity, '2026-11-02').detail.replaceAll(' ', ' ')).toBe('10 km · 50 min · easy · Garmin');
  });
});

describe('a missed run stops counting (Ben, 2 Nov)', () => {
  const FRI = '2026-10-30';
  const longPlan = (p: Partial<Activity> = {}) => planned({ fields: { kind: 'run', status: 'planned', date: THU, durationS: null, distanceM: 18_000, effort: 'long' }, ...p });

  it('the day after, an unlinked planned long run no longer holds back legs and the coach reads missed', () => {
    const out = show([longPlan()], []);
    expect(legRunNear(out, FRI, FRI)).toBeNull();
    expect(activityStatusOn(out[0] as Activity, FRI)).toBe('missed');
    // On its own date it is still planned and counts for the day after.
    expect(activityStatusOn(out[0] as Activity, THU)).toBe('planned');
    expect(legRunNear(out, FRI, THU)?.why).toBe('Long run yesterday');
  });

  it('linked later (or matched) it is done and counts again', () => {
    const out = show([longPlan({ version: 2, healthLink: { healthUuid: PM, linkedAtUtc: at.utc } })], [am, pm]);
    const mine = out.find((a) => a.id === PLAN) as Activity;
    expect(activityStatusOn(mine, FRI)).toBe('done');
    expect(legRunNear(out, FRI, FRI)?.why).toBe('Long run yesterday');
    // The only run that day matches on its own.
    expect(legRunNear(show([longPlan()], [pm]), FRI, FRI)?.why).toBe('Long run yesterday');
  });
});
