import { describe, expect, it } from 'vitest';
import { TrainingProfileSchema } from '@fizz/schemas';

import {
  applyTrainingChange,
  checkInDayToggle,
  checkInDaysPick,
  checkInScheduleLine,
  checkInSettingsFor,
  DEFAULT_CHECK_IN_SETTINGS,
  emptyWorkoutGate,
  newTrainingProfile,
  shouldAskCheckIn,
} from '../src';

/** (Ben, 26 Oct; app review finding 16) Profile › Training › Check-in, and Empty workout never asks. */
describe('check-in schedule setting (Ben, 26 Oct)', () => {
  const fresh = () => newTrainingProfile({ id: '00000000-0000-4000-8000-000000000001', ownerId: '00000000-0000-4000-8000-000000000002', atUtc: '2026-10-26T08:00:00.000Z' });
  const w = (opId: string, expectedVersion: number) => ({ opId, expectedVersion, atUtc: '2026-10-26T09:00:00.000Z', nowYear: 2026, today: '2026-10-26' });

  it('absent: Only when I choose (the 23 Oct default); saved: that schedule on the default thresholds', () => {
    expect(checkInSettingsFor(null)).toEqual(DEFAULT_CHECK_IN_SETTINGS);
    expect(checkInSettingsFor(fresh()).schedule).toEqual({ kind: 'when_i_choose' });
    expect(checkInSettingsFor({ checkInSchedule: { kind: 'every_workout' } })).toEqual({ ...DEFAULT_CHECK_IN_SETTINGS, schedule: { kind: 'every_workout' } });
  });

  it('one versioned, idempotent write; days in week order, each once; no empty day list; stale refused', () => {
    const p0 = fresh();
    const a = applyTrainingChange(p0, { kind: 'check_in_schedule', schedule: { kind: 'days', weekdays: ['fri', 'mon', 'fri'] } }, w('op-1', p0.version));
    if (!a.ok) throw new Error(a.error);
    expect(a.profile.checkInSchedule).toEqual({ kind: 'days', weekdays: ['mon', 'fri'] });
    expect(TrainingProfileSchema.safeParse(a.profile).success).toBe(true);
    expect(applyTrainingChange(a.profile, { kind: 'check_in_schedule', schedule: { kind: 'every_workout' } }, w('op-1', p0.version))).toMatchObject({ ok: true, replayed: true });
    expect(applyTrainingChange(a.profile, { kind: 'check_in_schedule', schedule: { kind: 'every_workout' } }, w('op-2', p0.version))).toMatchObject({ ok: false, error: 'stale' });
    expect(applyTrainingChange(a.profile, { kind: 'check_in_schedule', schedule: { kind: 'days', weekdays: [] } }, w('op-3', a.profile.version))).toMatchObject({ ok: false, error: 'invalid' });
    const b = applyTrainingChange(a.profile, { kind: 'check_in_schedule', schedule: { kind: 'when_i_choose' } }, w('op-4', a.profile.version));
    expect(b.ok && b.profile.checkInSchedule).toEqual({ kind: 'when_i_choose' });
  });

  it('the gate follows the saved schedule', () => {
    const at = (weekday: 'mon' | 'tue', schedule: Parameters<typeof checkInSettingsFor>[0]) => shouldAskCheckIn({ settings: checkInSettingsFor(schedule), nowMs: 0, weekday, entry: 'start', recent: [] });
    expect(at('mon', null)).toEqual({ kind: 'skip', reason: 'when_i_choose' });
    expect(at('tue', { checkInSchedule: { kind: 'every_workout' } })).toEqual({ kind: 'ask' });
    expect(at('mon', { checkInSchedule: { kind: 'days', weekdays: ['mon'] } })).toEqual({ kind: 'ask' });
    expect(at('tue', { checkInSchedule: { kind: 'days', weekdays: ['mon'] } })).toEqual({ kind: 'skip', reason: 'not_a_check_in_day' });
  });

  it('Empty workout never asks; a check-in already given still links; other skips are kept', () => {
    expect(emptyWorkoutGate({ kind: 'ask' })).toEqual({ kind: 'skip', reason: 'when_i_choose' });
    expect(emptyWorkoutGate({ kind: 'reuse', checkInId: 'c1' })).toEqual({ kind: 'reuse', checkInId: 'c1' });
    expect(emptyWorkoutGate({ kind: 'skip', reason: 'off' })).toEqual({ kind: 'skip', reason: 'off' });
  });

  it('the row’s value and the day chips', () => {
    expect(checkInScheduleLine({ kind: 'when_i_choose' })).toBe('Only when I choose');
    expect(checkInScheduleLine({ kind: 'every_workout' })).toBe('Every workout');
    expect(checkInScheduleLine({ kind: 'days', weekdays: ['fri', 'mon', 'wed'] })).toBe('Mon, Wed, Fri');
    expect(checkInDaysPick({ kind: 'every_workout' }, 'thu', null)).toEqual({ kind: 'days', weekdays: ['thu'] });
    expect(checkInDaysPick({ kind: 'when_i_choose' }, 'thu', ['sat', 'mon'])).toEqual({ kind: 'days', weekdays: ['mon', 'sat'] });
    expect(checkInDayToggle({ kind: 'days', weekdays: ['mon'] }, 'wed')).toEqual({ kind: 'days', weekdays: ['mon', 'wed'] });
    expect(checkInDayToggle({ kind: 'days', weekdays: ['mon', 'wed'] }, 'mon')).toEqual({ kind: 'days', weekdays: ['wed'] });
    expect(checkInDayToggle({ kind: 'days', weekdays: ['wed'] }, 'wed')).toBeNull();
  });
});
