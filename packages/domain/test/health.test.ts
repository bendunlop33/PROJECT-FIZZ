import { describe, expect, it } from 'vitest';

import { ActivitySchema, HealthLinkSchema, HealthWorkoutWriteSchema, type Activity, type HealthLink, type HealthWeightSample, type HealthWorkoutSample, type HealthWorkoutWrite, type WeightEntry } from '@fizz/schemas';

import {
  activityRow,
  autoLinkPairs,
  bodyweightEntries,
  classifyHealthWorkout,
  deleteActivity,
  editActivity,
  activitiesWithHealth,
  dedupeHealthSources,
  dismissHealthLink,
  linkQuestions,
  healthActivityLine,
  healthActivityOf,
  healthLinkId,
  healthSourceText,
  healthWorkoutOf,
  healthWriteRecordAfter,
  healthWriteRemoved,
  healthCandidateOf,
  isLongActivity,
  latestBodyweight,
  legRunNear,
  linkHealthActivity,
  linkSuggestion,
  nearbyWorkouts,
  overlapShare,
  planHealthWrites,
  unlinkHealthActivity,
  type HealthWriteCandidate,
  type LinkableWorkout,
} from '../src';
import { richFinishedSession } from './testing';

const OWNER = '00000000-0000-4000-8000-000000000001';
const S1 = '10000000-0000-4000-8000-000000000001';
const S2 = '10000000-0000-4000-8000-000000000002';
const TZ = 'Europe/London';
const U1 = 'a0000000-0000-4000-8000-000000000001';
const U2 = 'a0000000-0000-4000-8000-000000000002';
const U3 = 'a0000000-0000-4000-8000-000000000003';
const BUNDLE = 'com.projectfizz.fizz';

function candidate(p: Partial<HealthWriteCandidate> = {}): HealthWriteCandidate {
  return {
    sessionId: S1,
    inHistory: true,
    source: 'manual',
    startedAtUtc: '2026-10-27T17:00:00.000Z',
    endedAtUtc: '2026-10-27T18:00:00.000Z',
    pauses: [],
    recordedAtUtc: '2026-10-27T18:00:00.000Z',
    anyExternalLoad: true,
    anyDoneSet: true,
    ...p,
  };
}

const ON = { writeWorkouts: true, writeSinceUtc: '2026-10-27T09:00:00.000Z' };

function written(p: Partial<HealthWorkoutWrite> = {}): HealthWorkoutWrite {
  const w = healthWorkoutOf(candidate());
  if (w === null) throw new Error('no workout');
  return HealthWorkoutWriteSchema.parse({ sessionId: S1, ownerId: OWNER, status: 'written', healthUuid: U1, type: w.type, fingerprint: w.fingerprint, syncVersion: 1, version: 1, updatedAtUtc: '2026-10-27T18:00:01.000Z', opIds: [`health-save:${S1}:1`], ...p });
}

function sample(p: Partial<HealthWorkoutSample> = {}): HealthWorkoutSample {
  return { uuid: U1, activityType: 37, startUtc: '2026-10-25T08:00:00.000Z', endUtc: '2026-10-25T09:40:00.000Z', tz: TZ, durationS: 6000, distanceM: 18_000, avgHeartRate: 148.4, maxHeartRate: 171, sourceName: 'Garmin Connect', sourceBundleId: 'com.garmin.connect.mobile', externalId: null, ...p };
}

function workout(p: Partial<LinkableWorkout> = {}): LinkableWorkout {
  return { sessionId: S1, startUtc: '2026-10-27T17:00:00.000Z', endUtc: '2026-10-27T18:00:00.000Z', tz: TZ, title: 'Push', ...p };
}

function link(p: Partial<HealthLink> = {}): HealthLink {
  return HealthLinkSchema.parse({ id: healthLinkId(U1), ownerId: OWNER, version: 1, createdAtUtc: '2026-10-27T18:00:00.000Z', updatedAtUtc: '2026-10-27T18:00:00.000Z', healthUuid: U1, sessionId: S1, status: 'linked', by: 'auto', opIds: ['op-a'], ...p });
}

describe('Health workout to write', () => {
  it('writes the workout’s own start and end as traditional strength', () => {
    const w = healthWorkoutOf(candidate());
    expect(w).toMatchObject({ type: 'traditional_strength', startUtc: '2026-10-27T17:00:00.000Z', endUtc: '2026-10-27T18:00:00.000Z', pauses: [] });
  });

  it('is functional strength when every done set was bodyweight', () => {
    expect(healthWorkoutOf(candidate({ anyExternalLoad: false }))?.type).toBe('functional_strength');
    // No done sets at all: still the default.
    expect(healthWorkoutOf(candidate({ anyExternalLoad: false, anyDoneSet: false }))?.type).toBe('traditional_strength');
  });

  it('clips and merges pauses inside the workout; an open pause runs to the end', () => {
    const w = healthWorkoutOf(
      candidate({
        pauses: [
          { startUtc: '2026-10-27T16:50:00.000Z', endUtc: '2026-10-27T17:05:00.000Z' },
          { startUtc: '2026-10-27T17:30:00.000Z', endUtc: '2026-10-27T17:40:00.000Z' },
          { startUtc: '2026-10-27T17:35:00.000Z', endUtc: '2026-10-27T17:45:00.000Z' },
          { startUtc: '2026-10-27T17:55:00.000Z', endUtc: null },
        ],
      }),
    );
    expect(w?.pauses).toEqual([
      { startUtc: '2026-10-27T17:00:00.000Z', endUtc: '2026-10-27T17:05:00.000Z' },
      { startUtc: '2026-10-27T17:30:00.000Z', endUtc: '2026-10-27T17:45:00.000Z' },
      { startUtc: '2026-10-27T17:55:00.000Z', endUtc: '2026-10-27T18:00:00.000Z' },
    ]);
  });

  it('reads a finished workout: its times, pauses and loads; a past log is recorded when it was entered', () => {
    const a = richFinishedSession();
    const c = healthCandidateOf(a);
    expect(c).toMatchObject({ sessionId: a.session.id, inHistory: true, source: a.session.source, startedAtUtc: a.session.startedAt.utc, endedAtUtc: a.session.endedAt?.utc ?? null });
    expect(c.anyDoneSet).toBe(true);
    const past = healthCandidateOf({ ...a, session: { ...a.session, pastLog: { enteredAt: { utc: '2026-12-01T10:00:00.000Z', tz: TZ } } } });
    expect(past.recordedAtUtc).toBe('2026-12-01T10:00:00.000Z');
    expect(healthCandidateOf({ ...a, session: { ...a.session, status: 'deleted' } }).inHistory).toBe(false);
  });

  it('writes nothing for an unfinished, timeless or over-long workout', () => {
    expect(healthWorkoutOf(candidate({ inHistory: false, endedAtUtc: null }))).toBeNull();
    expect(healthWorkoutOf(candidate({ endedAtUtc: '2026-10-27T17:00:00.000Z' }))).toBeNull();
    expect(healthWorkoutOf(candidate({ endedAtUtc: '2026-10-29T17:00:00.000Z' }))).toBeNull();
  });

  it('a moved workout has a new fingerprint; the same times keep it', () => {
    const a = healthWorkoutOf(candidate());
    const b = healthWorkoutOf(candidate());
    const moved = healthWorkoutOf(candidate({ startedAtUtc: '2026-10-26T17:00:00.000Z', endedAtUtc: '2026-10-26T18:00:00.000Z' }));
    expect(a?.fingerprint).toBe(b?.fingerprint);
    expect(moved?.fingerprint).not.toBe(a?.fingerprint);
  });
});

describe('planHealthWrites', () => {
  it('does nothing while writing is off, even for deleted workouts', () => {
    expect(planHealthWrites({ settings: { writeWorkouts: false, writeSinceUtc: null }, candidates: [candidate({ inHistory: false })], records: [written()] })).toEqual([]);
  });

  it('saves a new workout recorded since writing was turned on, once, with a deterministic op ID', () => {
    const ops = planHealthWrites({ settings: ON, candidates: [candidate()], records: [] });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'save', opId: `health-save:${S1}:1`, syncVersion: 1, replacesUuid: null });
    // A retry (nothing recorded yet, e.g. after a force-close) plans the same op ID.
    expect(planHealthWrites({ settings: ON, candidates: [candidate()], records: [] })[0]?.opId).toBe(ops[0]?.opId);
  });

  it('leaves out imported workouts and history from before writing was turned on', () => {
    expect(planHealthWrites({ settings: ON, candidates: [candidate({ source: 'import' })], records: [] })).toEqual([]);
    expect(planHealthWrites({ settings: ON, candidates: [candidate({ recordedAtUtc: '2026-10-20T18:00:00.000Z' })], records: [] })).toEqual([]);
  });

  it('a past-logged workout is written at its own date (recorded now, dated earlier)', () => {
    const ops = planHealthWrites({ settings: ON, candidates: [candidate({ startedAtUtc: '2026-10-20T07:00:00.000Z', endedAtUtc: '2026-10-20T08:10:00.000Z', recordedAtUtc: '2026-10-27T12:00:00.000Z' })], records: [] });
    expect(ops[0]).toMatchObject({ kind: 'save', workout: { startUtc: '2026-10-20T07:00:00.000Z', endUtc: '2026-10-20T08:10:00.000Z' } });
  });

  it('nothing to do when the written workout is unchanged', () => {
    expect(planHealthWrites({ settings: ON, candidates: [candidate()], records: [written()] })).toEqual([]);
  });

  it('a moved workout is saved again, replacing the old Health sample, with the next sync version', () => {
    const ops = planHealthWrites({ settings: ON, candidates: [candidate({ startedAtUtc: '2026-10-27T16:00:00.000Z' })], records: [written()] });
    expect(ops).toEqual([expect.objectContaining({ kind: 'save', syncVersion: 2, replacesUuid: U1, opId: `health-save:${S1}:2` })]);
  });

  it('a deleted (or discarded) or purged workout deletes its Health sample', () => {
    for (const cands of [[candidate({ inHistory: false })], []]) {
      const ops = planHealthWrites({ settings: ON, candidates: cands, records: [written()] });
      expect(ops).toEqual([{ kind: 'delete', sessionId: S1, opId: `health-delete:${S1}:2`, syncVersion: 2, healthUuid: U1 }]);
    }
  });

  it('a restored workout is written again; a deleted record with no workout does nothing', () => {
    const del = written({ status: 'deleted', syncVersion: 2, version: 2 });
    expect(planHealthWrites({ settings: ON, candidates: [candidate()], records: [del] })).toEqual([expect.objectContaining({ kind: 'save', syncVersion: 3, replacesUuid: null })]);
    expect(planHealthWrites({ settings: ON, candidates: [], records: [del] })).toEqual([]);
  });

  it('a workout Ben removed from Health is never written again', () => {
    const removed = healthWriteRemoved(written(), 'remove-all-1', '2026-10-27T20:00:00.000Z');
    expect(removed).toMatchObject({ status: 'removed', version: 2 });
    if (removed === null) throw new Error('none');
    expect(healthWriteRemoved(removed, 'remove-all-1', '2026-10-27T20:00:00.000Z')).toBeNull();
    expect(planHealthWrites({ settings: ON, candidates: [candidate()], records: [removed] })).toEqual([]);
    expect(planHealthWrites({ settings: ON, candidates: [candidate({ startedAtUtc: '2026-10-27T16:00:00.000Z' })], records: [removed] })).toEqual([]);
  });

  it('records each op once: a replayed op changes nothing', () => {
    const [op] = planHealthWrites({ settings: ON, candidates: [candidate()], records: [] });
    if (op === undefined) throw new Error('no op');
    const rec = healthWriteRecordAfter(null, op, { kind: 'saved', healthUuid: U1.toUpperCase() }, OWNER, '2026-10-27T18:00:01.000Z');
    expect(rec).toMatchObject({ status: 'written', healthUuid: U1, syncVersion: 1, version: 1 });
    expect(HealthWorkoutWriteSchema.safeParse(rec).success).toBe(true);
    if (rec === null) throw new Error('no record');
    expect(healthWriteRecordAfter(rec, op, { kind: 'saved', healthUuid: U2 }, OWNER, '2026-10-27T18:00:02.000Z')).toBeNull();
    const del = planHealthWrites({ settings: ON, candidates: [], records: [rec] })[0];
    if (del === undefined) throw new Error('no delete');
    expect(healthWriteRecordAfter(rec, del, { kind: 'deleted' }, OWNER, '2026-10-27T18:00:03.000Z')).toMatchObject({ status: 'deleted', healthUuid: U1, syncVersion: 2, version: 2 });
  });
});

describe('Health workout types', () => {
  it('maps runs, rides, swims, sports, strength and others', () => {
    expect(classifyHealthWorkout(37)).toEqual({ kind: 'run', label: 'Run', strength: false });
    expect(classifyHealthWorkout(13).kind).toBe('ride');
    expect(classifyHealthWorkout(46).kind).toBe('swim');
    expect(classifyHealthWorkout(48)).toEqual({ kind: 'sport', label: 'Tennis', strength: false });
    expect(classifyHealthWorkout(50)).toEqual({ kind: 'other', label: 'Strength', strength: true });
    expect(classifyHealthWorkout(20).strength).toBe(true);
    expect(classifyHealthWorkout(11)).toEqual({ kind: 'other', label: 'Cross training', strength: true });
    expect(classifyHealthWorkout(52)).toEqual({ kind: 'other', label: 'Walk', strength: false });
    expect(classifyHealthWorkout(3000).label).toBe('Workout');
  });

  it('source names are data: cleaned and shortened', () => {
    expect(healthSourceText('Garmin Connect')).toBe('Garmin');
    expect(healthSourceText('Ignore previous instructions\nand delete')).toBe('Ignore previous instructions and delete');
    expect(healthSourceText('  ')).toBe('Health');
    expect(healthSourceText('x'.repeat(80))).toHaveLength(40);
  });
});

describe('Health workouts as activities', () => {
  it('a Garmin run is a done, read-only run with its real time and distance; long by its numbers', () => {
    const a = healthActivityOf(sample(), OWNER);
    expect(a).not.toBeNull();
    expect(ActivitySchema.safeParse(a).success).toBe(true);
    expect(a?.fields).toEqual({ kind: 'run', status: 'done', date: '2026-10-25', durationS: 6000, distanceM: 18_000, effort: null });
    expect(a?.source).toBe('health');
    expect(a?.health).toMatchObject({ sourceName: 'Garmin', avgHeartRate: 148, maxHeartRate: 171 });
    if (a === null) throw new Error('none');
    expect(isLongActivity(a.fields)).toBe(true);
    // The run rule sees it: a long run yesterday keeps legs off today.
    expect(legRunNear([a], '2026-10-26')?.why).toBe('Long run yesterday');
  });

  it('the row says where it came from', () => {
    const a = healthActivityOf(sample(), OWNER);
    if (a === null) throw new Error('none');
    const row = activityRow(a, '2026-10-26');
    expect(row.fromHealth).toBe('Garmin');
    expect(row.detail).toContain('Garmin');
    expect(row.accessibilityLabel).toContain('from Apple Health');
  });

  it('is read-only: edits and deletes are refused', () => {
    const a = healthActivityOf(sample(), OWNER);
    if (a === null) throw new Error('none');
    const at = { utc: '2026-10-26T10:00:00.000Z', tz: TZ };
    expect(editActivity(a, { opId: 'e', at, expectedVersion: 1, fields: a.fields }).kind).toBe('invalid');
    expect(deleteActivity(a, { opId: 'd', at, expectedVersion: 1 }).kind).toBe('invalid');
  });

  it('a 6 km Health run is never hard (no effort word from Health)', () => {
    const a = healthActivityOf(sample({ distanceM: 6000, durationS: 1800, endUtc: '2026-10-25T08:30:00.000Z', avgHeartRate: 185 }), OWNER);
    expect(a?.fields.effort).toBeNull();
    if (a === null) throw new Error('none');
    expect(legRunNear([a], '2026-10-26')).toBeNull();
  });

  it('a workout under a minute with no distance is not an activity', () => {
    expect(healthActivityOf(sample({ durationS: 30, endUtc: '2026-10-25T08:00:30.000Z', distanceM: null }), OWNER)).toBeNull();
  });

  const own = (p: Partial<Activity['fields']> = {}, extra: Partial<Activity> = {}): Activity =>
    ActivitySchema.parse({
      id: '20000000-0000-4000-8000-000000000001',
      ownerId: OWNER,
      version: 1,
      createdAtUtc: '2026-10-25T10:00:00.000Z',
      updatedAtUtc: '2026-10-25T10:00:00.000Z',
      fields: { kind: 'run', status: 'done', date: '2026-10-25', durationS: null, distanceM: null, effort: 'long', ...p },
      tz: TZ,
      source: 'ben',
      deletedAtUtc: null,
      lastChange: null,
      opIds: ['x'],
      ...extra,
    });

  const base = { ownerId: OWNER, links: [] as HealthLink[], own: [] as Activity[], ownBundleId: BUNDLE, writtenUuids: new Set<string>(), appSessionIds: new Set<string>([S1]) };

  it('never lists the app’s own writes (by source, by written UUID, or by external ID)', () => {
    expect(activitiesWithHealth({ ...base, samples: [sample({ activityType: 50, sourceBundleId: BUNDLE })] })).toEqual([]);
    expect(activitiesWithHealth({ ...base, samples: [sample({ activityType: 50, sourceBundleId: 'com.other' })], writtenUuids: new Set([U1]) })).toEqual([]);
    // A reinstall under another team: the source differs but the external ID is one of the app's workouts.
    expect(activitiesWithHealth({ ...base, samples: [sample({ activityType: 50, sourceBundleId: 'com.other', externalId: S1.toUpperCase() })] })).toEqual([]);
  });

  it('Ben’s planned run and the one Health run that day are one item, done, with Health’s numbers and his effort', () => {
    const out = activitiesWithHealth({ ...base, samples: [sample()], own: [own({ status: 'planned', distanceM: 16_000 })] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'ben', fields: { status: 'done', distanceM: 18_000, durationS: 6000, effort: 'long' }, health: { sourceName: 'Garmin' } });
    expect(activityRow(out[0] as Activity, '2026-10-26').detail).toContain('Garmin');
  });

  it('Ben’s done run merges only when the numbers agree; otherwise both show', () => {
    expect(activitiesWithHealth({ ...base, samples: [sample()], own: [own({ distanceM: 17_500 })] })).toHaveLength(1);
    expect(activitiesWithHealth({ ...base, samples: [sample()], own: [own({ distanceM: 10_000 })] })).toHaveLength(2);
    // He gave no numbers: they agree.
    expect(activitiesWithHealth({ ...base, samples: [sample()], own: [own()] })).toHaveLength(1);
  });

  it('two Health runs that day: nothing pairs; a deleted or other-kind activity of his never pairs', () => {
    const two = [sample(), sample({ uuid: U2, startUtc: '2026-10-25T17:00:00.000Z', endUtc: '2026-10-25T17:30:00.000Z', durationS: 1800, distanceM: 5000 })];
    expect(activitiesWithHealth({ ...base, samples: two, own: [own()] })).toHaveLength(3);
    expect(activitiesWithHealth({ ...base, samples: [sample()], own: [own({}, { deletedAtUtc: '2026-10-25T11:00:00.000Z' })] })).toHaveLength(1);
    expect(activitiesWithHealth({ ...base, samples: [sample()], own: [own({ kind: 'ride' })] })).toHaveLength(2);
  });

  it('a linked Health workout isn’t listed; once unlinked it is again', () => {
    const s = sample({ activityType: 50 });
    expect(activitiesWithHealth({ ...base, samples: [s], links: [link()] })).toEqual([]);
    expect(activitiesWithHealth({ ...base, samples: [s], links: [link({ status: 'unlinked', version: 2 })] })).toHaveLength(1);
  });

  it('Garmin and Apple Watch recording the same run are one; the one with distance and heart rate stays', () => {
    const watch = sample({ uuid: U2, sourceName: 'Apple Watch', sourceBundleId: 'com.apple.health', distanceM: null, avgHeartRate: null, startUtc: '2026-10-25T08:01:00.000Z' });
    const r = dedupeHealthSources([watch, sample()]);
    expect(r.kept.map((x) => x.uuid)).toEqual([U1]);
    expect(r.alsoRecordedBy.get(U1)).toEqual(['Apple Watch']);
    expect(activitiesWithHealth({ ...base, samples: [watch, sample()] })).toHaveLength(1);
  });

  it('the linked line shows only recorded facts, with the source', () => {
    const a = healthActivityOf(sample({ activityType: 50, durationS: 3240, endUtc: '2026-10-25T08:54:00.000Z', distanceM: null, maxHeartRate: null }), OWNER);
    if (a?.health === undefined) throw new Error('none');
    expect(healthActivityLine(a.health).replaceAll(' ', ' ')).toBe('Garmin · Strength · 54 min · avg 148 bpm');
  });
});

describe('Links', () => {
  const garminStrength = sample({ activityType: 50, startUtc: '2026-10-27T16:55:00.000Z', endUtc: '2026-10-27T17:50:00.000Z', distanceM: null });

  it('overlap is a share of the shorter one', () => {
    expect(overlapShare({ startUtc: '2026-10-27T17:00:00.000Z', endUtc: '2026-10-27T18:00:00.000Z' }, { startUtc: '2026-10-27T17:30:00.000Z', endUtc: '2026-10-27T17:45:00.000Z' })).toBe(1);
    expect(overlapShare({ startUtc: '2026-10-27T17:00:00.000Z', endUtc: '2026-10-27T18:00:00.000Z' }, { startUtc: '2026-10-27T18:00:00.000Z', endUtc: '2026-10-27T19:00:00.000Z' })).toBe(0);
  });

  it('auto-links a strength workout that clearly overlaps an app workout', () => {
    expect(autoLinkPairs({ samples: [garminStrength], workouts: [workout()], links: [] })).toEqual([{ healthUuid: U1, sessionId: S1 }]);
  });

  it('doesn’t auto-link a run, a weak overlap, an unlinked one, or a workout already linked', () => {
    expect(autoLinkPairs({ samples: [{ ...garminStrength, activityType: 37 }], workouts: [workout()], links: [] })).toEqual([]);
    expect(autoLinkPairs({ samples: [{ ...garminStrength, activityType: 3000 }], workouts: [workout()], links: [] })).toEqual([]);
    const weak = { ...garminStrength, startUtc: '2026-10-27T17:45:00.000Z', endUtc: '2026-10-27T18:45:00.000Z' };
    expect(autoLinkPairs({ samples: [weak], workouts: [workout()], links: [] })).toEqual([]);
    expect(autoLinkPairs({ samples: [garminStrength], workouts: [workout()], links: [link({ status: 'unlinked', version: 2 })] })).toEqual([]);
    expect(autoLinkPairs({ samples: [garminStrength], workouts: [workout()], links: [link({ healthUuid: U3, id: healthLinkId(U3) })] })).toEqual([]);
  });

  it('two candidates on one app workout: nothing auto-links; the Summary asks with a list', () => {
    const second = { ...garminStrength, uuid: U2, startUtc: '2026-10-27T17:20:00.000Z', endUtc: '2026-10-27T18:30:00.000Z' };
    expect(autoLinkPairs({ samples: [second, garminStrength], workouts: [workout()], links: [] })).toEqual([]);
    expect(linkQuestions(workout(), [second, garminStrength], []).map((x) => x.uuid)).toEqual([U1, U2]);
  });

  it('asks about a weak overlap, an `other` workout, or one within an hour; never a run; `Not it` is remembered', () => {
    const weak = { ...garminStrength, startUtc: '2026-10-27T17:45:00.000Z', endUtc: '2026-10-27T18:45:00.000Z' };
    expect(linkQuestions(workout(), [weak], []).map((x) => x.uuid)).toEqual([U1]);
    expect(linkSuggestion(weak, [workout()], [])?.sessionId).toBe(S1);
    expect(linkQuestions(workout(), [{ ...weak, activityType: 3000 }], [])).toHaveLength(1);
    const after = { ...garminStrength, startUtc: '2026-10-27T18:40:00.000Z', endUtc: '2026-10-27T19:10:00.000Z' };
    expect(linkQuestions(workout(), [after], [])).toHaveLength(1);
    expect(linkQuestions(workout(), [{ ...weak, activityType: 37 }], [])).toEqual([]);
    expect(linkSuggestion({ ...weak, startUtc: '2026-10-28T17:45:00.000Z', endUtc: '2026-10-28T18:45:00.000Z' }, [workout()], [])).toBeNull();
    const notIt = dismissHealthLink(null, { ownerId: OWNER, healthUuid: U1, sessionId: S1, opId: 'n1', atUtc: '2026-10-27T19:00:00.000Z' });
    if (notIt.kind !== 'write') throw new Error('no write');
    expect(notIt.next.status).toBe('unlinked');
    expect(linkQuestions(workout(), [weak], [notIt.next])).toEqual([]);
    expect(autoLinkPairs({ samples: [garminStrength], workouts: [workout()], links: [notIt.next] })).toEqual([]);
    expect(dismissHealthLink(notIt.next, { ownerId: OWNER, healthUuid: U1, sessionId: S1, opId: 'n1', atUtc: '2026-10-27T19:00:00.000Z' }).kind).toBe('duplicate');
  });

  it('the picker lists nearby workouts, nearest first, not ones linked to another activity', () => {
    const w2 = workout({ sessionId: S2, startUtc: '2026-10-26T17:00:00.000Z', endUtc: '2026-10-26T18:00:00.000Z' });
    expect(nearbyWorkouts(garminStrength, [w2, workout()], []).map((w) => w.sessionId)).toEqual([S1, S2]);
    expect(nearbyWorkouts(garminStrength, [w2, workout()], [link({ healthUuid: U3, id: healthLinkId(U3) })]).map((w) => w.sessionId)).toEqual([S2]);
  });

  it('link and unlink are versioned and idempotent', () => {
    const at = '2026-10-27T19:00:00.000Z';
    const first = linkHealthActivity(null, { ownerId: OWNER, healthUuid: U1.toUpperCase(), sessionId: S1, by: 'ben', opId: 'op-1', atUtc: at, expectedVersion: null, sessionLinkedElsewhere: false });
    expect(first.kind).toBe('write');
    if (first.kind !== 'write') throw new Error('no write');
    expect(HealthLinkSchema.safeParse(first.next).success).toBe(true);
    expect(first.next).toMatchObject({ id: healthLinkId(U1), healthUuid: U1, status: 'linked', version: 1 });
    // The same tap again: a replay.
    expect(linkHealthActivity(first.next, { ownerId: OWNER, healthUuid: U1, sessionId: S1, by: 'ben', opId: 'op-1', atUtc: at, expectedVersion: null, sessionLinkedElsewhere: false }).kind).toBe('duplicate');
    // A stale version is refused.
    expect(unlinkHealthActivity(first.next, { opId: 'op-2', atUtc: at, expectedVersion: 7 }).kind).toBe('stale');
    const un = unlinkHealthActivity(first.next, { opId: 'op-2', atUtc: at, expectedVersion: 1 });
    expect(un).toMatchObject({ kind: 'write', next: { status: 'unlinked', version: 2 }, expectedVersion: 1 });
    if (un.kind !== 'write') throw new Error('no write');
    expect(unlinkHealthActivity(un.next, { opId: 'op-2', atUtc: at, expectedVersion: 2 }).kind).toBe('duplicate');
    // Relink after an unlink, on its version.
    expect(linkHealthActivity(un.next, { ownerId: OWNER, healthUuid: U1, sessionId: S2, by: 'ben', opId: 'op-3', atUtc: at, expectedVersion: 2, sessionLinkedElsewhere: false })).toMatchObject({ kind: 'write', next: { status: 'linked', sessionId: S2, version: 3 } });
    // A workout that already has a linked activity is refused.
    expect(linkHealthActivity(null, { ownerId: OWNER, healthUuid: U2, sessionId: S1, by: 'ben', opId: 'op-4', atUtc: at, expectedVersion: null, sessionLinkedElsewhere: true }).kind).toBe('invalid');
  });
});

describe('Bodyweight from Health', () => {
  const mine: WeightEntry[] = [{ id: 'w1', date: '2026-10-20', value: 180, unit: 'lb', recordedAtUtc: '2026-10-20T07:00:00.000Z' }];
  const h = (uuid: string, atUtc: string, kg: number): HealthWeightSample => ({ uuid, kg, atUtc, tz: TZ, sourceName: 'Withings', sourceBundleId: 'com.withings' });

  it('merges, labels Health’s, and Ben’s entry wins on his days', () => {
    const out = bodyweightEntries(mine, [h(U1, '2026-10-20T06:00:00.000Z', 81.2), h(U2, '2026-10-26T06:00:00.000Z', 81.6), h(U3, '2026-10-26T20:00:00.000Z', 82.04)]);
    expect(out.map((e) => [e.date, e.from, e.value, e.unit])).toEqual([
      ['2026-10-20', 'you', 180, 'lb'],
      ['2026-10-26', 'health', 82.04, 'kg'],
    ]);
    expect(latestBodyweight(out)).toMatchObject({ from: 'health', sourceName: 'Withings' });
  });

  it('with no Health samples it is Ben’s entries as they are', () => {
    expect(bodyweightEntries(mine, []).map((e) => e.from)).toEqual(['you']);
    expect(latestBodyweight([])).toBeNull();
  });
});
