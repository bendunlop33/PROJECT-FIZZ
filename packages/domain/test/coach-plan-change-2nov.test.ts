import { describe, expect, it } from 'vitest';

import { coachEditStepOpId, type RestSettings } from '@fizz/schemas';

import {
  applyTrainingChange,
  newTrainingProfile,
  pbBlockWeekOf,
  pbDeloadWeeks,
  pbIsDeload,
  pbPlanChange,
  pbProgWeeks,
  pbWithoutLighterWeeks,
  reduceSession,
  restSettingsChange,
  restSettingsOf,
  restTodayCommand,
  restTodaySteps,
  type BuilderInfoLookup,
} from '../src/index';
import { answers } from './plan-builder-fixture';
import { at } from './fixtures';
import { BENCH, apply, setsFor, startFixture } from './session-fixture';

/**
 * (Ben, 2 Nov) The coach's plan-level changes and rest settings, the pure parts: `pbPlanChange` (a lighter week, days a
 * week, length, Set/Any days as new builder answers), a lighter week drafting as a deload week (the approved shape),
 * `restSettingsChange` (Rest times' own limits, never rounded) and `Today too?` (`restTodayCommand`: only pending sets
 * on the old default move; a logged set never changes; Undo puts back the ones still pending).
 */

const TZ = 'Europe/London';
const block = (week: number, leadIn = false) => ({ week, leadIn });

describe('pbPlanChange', () => {
  const six = answers({ weeks: 6, effort: 'standard', sessions: 5 });

  it('"make next week a lighter week" in week 2 of 6: week 3 drafts as a deload week; (LW1) the deload 3 weeks later goes', () => {
    const r = pbPlanChange(six, { kind: 'lighter_week', week: 'next' }, block(2));
    if (r.kind !== 'ok') throw new Error(r.line);
    expect(r.answers.lighterWeeks).toEqual([3]);
    expect(r.answers.skippedDeloads).toEqual([6]);
    expect(r.lines).toEqual(['Week 3 of 6 → Lighter', 'Deload: week 6 → none', '−10 % load, 1 set fewer']);
    expect(pbDeloadWeeks(r.answers)).toEqual([3]);
    expect(pbIsDeload(r.answers, 3)).toBe(true);
    // A deload week isn't a progression week (as the effort's own).
    expect(pbProgWeeks(r.answers, 5)).toBe(pbProgWeeks(six, 5) - 1);
    // Nothing else in the answers changes.
    expect({ ...r.answers, lighterWeeks: undefined, skippedDeloads: undefined }).toEqual({ ...six, lighterWeeks: undefined, skippedDeloads: undefined });
  });

  it('this week; the lead-in can’t be lighter but next week (week 1) can; never past the end or on a deload week', () => {
    expect(pbPlanChange(six, { kind: 'lighter_week', week: 'this' }, block(4))).toMatchObject({ kind: 'ok', answers: { lighterWeeks: [4] } });
    expect(pbPlanChange(six, { kind: 'lighter_week', week: 'this' }, block(1, true))).toMatchObject({ kind: 'refused' });
    expect(pbPlanChange(six, { kind: 'lighter_week', week: 'next' }, block(1, true))).toMatchObject({ kind: 'ok', answers: { lighterWeeks: [1] } });
    expect(pbPlanChange(six, { kind: 'lighter_week', week: 'next' }, block(6))).toEqual({ kind: 'refused', line: 'The plan ends after week 6' });
    expect(pbPlanChange(six, { kind: 'lighter_week', week: 'next' }, block(5))).toEqual({ kind: 'refused', line: 'Week 6 is already a deload week' });
    const twice = pbPlanChange({ ...six, lighterWeeks: [3] }, { kind: 'lighter_week', week: 'this' }, block(3));
    expect(twice).toEqual({ kind: 'refused', line: 'Week 3 is already a deload week' });
  });

  it('the block week Today reads is a deload week once a lighter week is in the answers', () => {
    const appliedAtUtc = '2026-10-12T07:00:00.000Z';
    const workouts = [{ startedAtUtc: '2026-10-14T08:00:00Z', dayIndex: 0 }, { startedAtUtc: '2026-10-21T08:00:00Z', dayIndex: 0 }];
    const nowMs = Date.parse('2026-10-27T08:00:00Z');
    expect(pbBlockWeekOf({ answers: six, appliedAtUtc, workouts, nowMs, tz: TZ })).toMatchObject({ week: 3, deload: false });
    expect(pbBlockWeekOf({ answers: { ...six, lighterWeeks: [3] }, appliedAtUtc, workouts, nowMs, tz: TZ })).toMatchObject({ week: 3, deload: true });
  });

  it('"go to 4 days a week": the usual days for 4, the split follows; named weekdays make Set days', () => {
    const r = pbPlanChange(six, { kind: 'days_per_week', days: 4, weekdays: null }, block(2));
    if (r.kind !== 'ok') throw new Error(r.line);
    expect(r.answers).toMatchObject({ sessions: 4, schedule: 'any', split: six.split, weeks: 6 });
    expect(r.lines).toEqual(['5 → 4 days a week']);
    const set = pbPlanChange(six, { kind: 'days_per_week', days: 4, weekdays: [0, 1, 3, 4] }, block(2));
    expect(set).toMatchObject({ kind: 'ok', answers: { sessions: 4, schedule: 'set', days: [0, 1, 3, 4] }, lines: ['5 → 4 days a week', 'Set days: Mon, Tue, Thu, Fri'] });
    expect(pbPlanChange(six, { kind: 'days_per_week', days: 4, weekdays: [0, 1] }, block(2))).toMatchObject({ kind: 'refused' });
    expect(pbPlanChange(six, { kind: 'days_per_week', days: 5, weekdays: null }, block(2))).toEqual({ kind: 'refused', line: 'Already 5 days a week' });
    expect(pbPlanChange(six, { kind: 'days_per_week', days: 1, weekdays: null }, block(2))).toMatchObject({ kind: 'refused' });
  });

  it('"make the plan 8 weeks": the deload moves with the length; never shorter than the week it is in; 4/6/8/12 only', () => {
    const r = pbPlanChange({ ...six, lighterWeeks: [3] }, { kind: 'length', weeks: 8 }, block(2));
    expect(r).toMatchObject({ kind: 'ok', answers: { weeks: 8, lighterWeeks: [3] }, lines: ['6 → 8 weeks', 'Deload: week 3, 6 → week 3, 8'] });
    const shorter = pbPlanChange({ ...six, lighterWeeks: [5] }, { kind: 'length', weeks: 4 }, block(2));
    expect(shorter).toMatchObject({ kind: 'ok', answers: { weeks: 4 } });
    if (shorter.kind === 'ok') expect(shorter.answers.lighterWeeks).toBeUndefined();
    expect(pbPlanChange(six, { kind: 'length', weeks: 4 }, block(5))).toEqual({ kind: 'refused', line: 'Already in week 5' });
    expect(pbPlanChange(six, { kind: 'length', weeks: 10 }, block(2))).toEqual({ kind: 'refused', line: 'Plan lengths are 4, 6, 8 or 12 weeks' });
    expect(pbPlanChange(six, { kind: 'length', weeks: 6 }, block(2))).toEqual({ kind: 'refused', line: 'Already 6 weeks' });
  });

  it('Set days / Any days: the named weekdays set the sessions a week; Any days back to the usual days', () => {
    const set = pbPlanChange(six, { kind: 'schedule', schedule: 'set', weekdays: [0, 2, 4, 5] }, block(2));
    expect(set).toMatchObject({ kind: 'ok', answers: { schedule: 'set', days: [0, 2, 4, 5], sessions: 4 }, lines: ['Any days → Set days: Mon, Wed, Fri, Sat', '5 → 4 days a week'] });
    if (set.kind !== 'ok') return;
    expect(pbPlanChange(set.answers, { kind: 'schedule', schedule: 'any', weekdays: null }, block(2))).toMatchObject({ kind: 'ok', answers: { schedule: 'any', sessions: 4 }, lines: ['Set days: Mon, Wed, Fri, Sat → Any days'] });
    expect(pbPlanChange(six, { kind: 'schedule', schedule: 'set', weekdays: null }, block(2))).toMatchObject({ kind: 'refused' });
    expect(pbPlanChange(six, { kind: 'schedule', schedule: 'any', weekdays: null }, block(2))).toEqual({ kind: 'refused', line: 'Already Any days' });
  });

  it('a new block starts without the lighter weeks', () => {
    expect(pbWithoutLighterWeeks({ ...six, lighterWeeks: [3] })).toEqual(six);
    expect(pbWithoutLighterWeeks(six)).toBe(six);
  });
});

describe('restSettingsChange', () => {
  const none = restSettingsOf(null);

  it('"rest 2 minutes on accessories": compound stays at its standard (stored as standard), isolation 1:30 → 2:00', () => {
    const r = restSettingsChange(none, { rests: [{ setType: 'workingCompound', seconds: 120 }, { setType: 'workingIsolation', seconds: 120 }], whenShort: null, shortenMain: null });
    expect(r).toEqual({ kind: 'ok', after: { restDefaultsS: { workingIsolation: 120 }, fitRestLevel: null, fitShortenMain: false }, lines: ['Isolation 1:30 → 2:00'] });
  });

  it('"turn on shorten main lift"; "rest when short on time: medium"; back to standard; already', () => {
    expect(restSettingsChange(none, { rests: [], whenShort: null, shortenMain: true })).toMatchObject({ kind: 'ok', after: { fitShortenMain: true }, lines: ['Shorten main lift too: on'] });
    expect(restSettingsChange(none, { rests: [], whenShort: 'shorter', shortenMain: null })).toMatchObject({ kind: 'ok', after: { fitRestLevel: 'shorter' }, lines: ['When short on time: Medium rest'] });
    const own: RestSettings = { restDefaultsS: { workingIsolation: 120, top: 165 }, fitRestLevel: null, fitShortenMain: true };
    expect(restSettingsChange(own, { rests: [{ setType: 'workingIsolation', seconds: null }], whenShort: null, shortenMain: null })).toMatchObject({ kind: 'ok', after: { restDefaultsS: { top: 165 } }, lines: ['Isolation 2:00 → 1:30'] });
    expect(restSettingsChange(own, { rests: [{ setType: 'workingIsolation', seconds: 120 }], whenShort: null, shortenMain: null })).toEqual({ kind: 'already', line: 'Already 2:00' });
    expect(restSettingsChange(own, { rests: [], whenShort: null, shortenMain: true })).toEqual({ kind: 'already', line: 'Shorten main lift too is already on' });
  });

  it('keeps Rest times’ limits: outside 0:30–6:00 or off the 15 s steps is refused, never rounded', () => {
    for (const seconds of [20, 100, 400]) {
      expect(restSettingsChange(none, { rests: [{ setType: 'workingIsolation', seconds }], whenShort: null, shortenMain: null })).toEqual({ kind: 'invalid', line: 'Rest times go from 0:30 to 6:00 in 15 s steps' });
    }
  });

  it('the profile change writes the whole snapshot; its Undo (the before snapshot) puts it back exactly', () => {
    const p0 = newTrainingProfile({ id: '00000000-0000-4000-8000-000000000001', ownerId: '00000000-0000-4000-8000-000000000002', atUtc: '2026-11-02T08:00:00.000Z' });
    const w = (opId: string, v: number) => ({ opId, expectedVersion: v, atUtc: '2026-11-02T09:00:00.000Z', nowYear: 2026, today: '2026-11-02' });
    const before = restSettingsOf(p0);
    const c = restSettingsChange(before, { rests: [{ setType: 'workingIsolation', seconds: 120 }], whenShort: 'normal', shortenMain: true });
    if (c.kind !== 'ok') throw new Error('not ok');
    const r1 = applyTrainingChange(p0, { kind: 'rest_settings', settings: c.after }, w('rs-1', p0.version));
    if (!r1.ok) throw new Error(r1.error);
    expect(restSettingsOf(r1.profile)).toEqual(c.after);
    // A stale version changes nothing (rule 5); a replayed op is a no-op.
    expect(applyTrainingChange(r1.profile, { kind: 'rest_settings', settings: before }, w('rs-2', p0.version))).toMatchObject({ ok: false, error: 'stale' });
    expect(applyTrainingChange(r1.profile, { kind: 'rest_settings', settings: c.after }, w('rs-1', r1.profile.version))).toMatchObject({ ok: true, replayed: true });
    const r2 = applyTrainingChange(r1.profile, { kind: 'rest_settings', settings: before }, w('rs-undo', r1.profile.version));
    if (!r2.ok) throw new Error(r2.error);
    expect(restSettingsOf(r2.profile)).toEqual(before);
    expect(r2.profile.restDefaultsS).toBeUndefined();
    expect(r2.profile.fitShortenMain).toBeUndefined();
    // Out of Rest times' limits: refused as invalid.
    expect(applyTrainingChange(p0, { kind: 'rest_settings', settings: { restDefaultsS: { warmup: 100 }, fitRestLevel: null, fitShortenMain: false } }, w('rs-3', p0.version))).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('Today too? (restTodayCommand)', () => {
  const info: BuilderInfoLookup = (id) => (id === BENCH ? ({ role: 'compound' } as never) : ({ role: 'isolation' } as never));

  it('main lift 3:00 → 2:30: the bench’s pending working sets on the old default move; a logged set never changes; Undo puts back the pending ones', () => {
    const s0 = startFixture().state;
    const before = restSettingsOf(null);
    const after: RestSettings = { restDefaultsS: { workingMain: 150 }, fitRestLevel: null, fitShortenMain: false };
    const bench = setsFor(s0, BENCH);
    const work = bench.filter((x) => x.setType !== 'warmup');
    expect(work.map((x) => x.rest.seconds)).toEqual([180, 180]);
    const steps = restTodaySteps({ aggregate: s0, before, after, info });
    expect(steps.map((x) => [x.setId, x.restS])).toEqual(work.map((x) => [x.id, 150]));
    // Nothing moves when the change doesn't touch any of today's rests.
    expect(restTodaySteps({ aggregate: s0, before, after: { ...before, fitShortenMain: true }, info })).toEqual([]);

    const cmd = restTodayCommand({ aggregate: s0, before, after, info, opId: 'rest-today:a1', actionId: '00000000-0000-4000-8000-0000000000a1', at: at(1) });
    if (cmd === null) throw new Error('no command');
    expect(cmd.steps.map((x) => x.opId)).toEqual([coachEditStepOpId('rest-today:a1', 0), coachEditStepOpId('rest-today:a1', 1)]);
    const s1 = apply(s0, cmd);
    expect(setsFor(s1, BENCH).filter((x) => x.setType !== 'warmup').map((x) => x.rest.seconds)).toEqual([150, 150]);
    // The same op again is a duplicate, never a second change (rule 5); an older version is refused.
    expect(reduceSession(s1, cmd)).toMatchObject({ ok: true, duplicate: true });
    expect(reduceSession(s1, { ...cmd, opId: 'rest-today:a2', steps: cmd.steps.map((x, i) => ({ ...x, opId: coachEditStepOpId('rest-today:a2', i) })) })).toMatchObject({ ok: false, error: { code: 'stale_version' } });

    // Ben logs the first working set; Undo puts back only the one still pending (rule 2).
    const first = setsFor(s1, BENCH).filter((x) => x.setType !== 'warmup')[0];
    if (first === undefined) throw new Error('no set');
    const s2 = apply(s1, { type: 'log_set', at: at(2), opId: 'log-1', setId: first.id, values: { load: { value: 100, unit: 'kg', convention: 'total' }, reps: 5, durationS: null, rpe: 8, rir: null }, restTimerId: '00000000-0000-4000-8000-0000000000b1' });
    const s3 = apply(s2, { type: 'revert_coach_edit', at: at(3), opId: 'rest-today-undo:a1', targetOpId: 'rest-today:a1', actionId: '00000000-0000-4000-8000-0000000000a1' });
    const benchAfter = setsFor(s3, BENCH).filter((x) => x.setType !== 'warmup');
    expect(benchAfter.map((x) => [x.status, x.rest.seconds])).toEqual([
      ['completed', 150],
      ['pending', 180],
    ]);
    expect(setsFor(s3, BENCH).find((x) => x.id === first.id)?.actual).toEqual(setsFor(s2, BENCH).find((x) => x.id === first.id)?.actual);
  });
});
