import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { weekdayOf } from '@fizz/domain';

import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 26 Oct; app review finding 16) Profile › Training › Check-in: `Only when I choose` (default) / `Every
 * workout` / `On these days`, saved on the training profile (Your data, versioned, idempotent) and read by Start's
 * gate. An Empty workout never asks. Real SQLite through the whole app (harness), across a relaunch.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('check-in schedule (Ben, 26 Oct)', () => {
  it('default never asks; Every workout asks; Empty workout never asks; On these days follows the weekday; kept across a relaunch', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    expect(await s.checkIns.gate()).toEqual({ kind: 'skip', reason: 'when_i_choose' });

    const snap = await s.training.snapshot();
    if (snap === null) throw new Error('no profile');
    expect(snap.profile.checkInSchedule).toBeUndefined();
    const every = await s.training.change({ kind: 'check_in_schedule', schedule: { kind: 'every_workout' } }, snap.profile.version, 'ci-every');
    expect(every.ok).toBe(true);
    if (!every.ok) return;
    // The same tap again: written once (rule 5); an old version: refused.
    expect(await s.training.change({ kind: 'check_in_schedule', schedule: { kind: 'every_workout' } }, snap.profile.version, 'ci-every')).toMatchObject({ ok: true, profile: { version: every.profile.version } });
    expect(await s.training.change({ kind: 'check_in_schedule', schedule: { kind: 'when_i_choose' } }, snap.profile.version, 'ci-stale')).toMatchObject({ ok: false, reason: 'stale' });

    expect(await s.checkIns.gate()).toEqual({ kind: 'ask' });
    // Empty workout: never asked, whatever the schedule.
    expect(await s.checkIns.gate({ empty: true })).toEqual({ kind: 'skip', reason: 'when_i_choose' });

    const now = h.now();
    const today = weekdayOf(Date.parse(now.utc), now.tz);
    const other = today === 'mon' ? 'tue' : 'mon';
    const days = await s.training.change({ kind: 'check_in_schedule', schedule: { kind: 'days', weekdays: [other] } }, every.profile.version, 'ci-days');
    if (!days.ok) throw new Error('days');
    expect(await s.checkIns.gate()).toEqual({ kind: 'skip', reason: 'not_a_check_in_day' });
    const both = await s.training.change({ kind: 'check_in_schedule', schedule: { kind: 'days', weekdays: [other, today] } }, days.profile.version, 'ci-days-2');
    if (!both.ok) throw new Error('both');

    // Force-close and relaunch: the saved schedule is still the one Start reads.
    const { services: again } = await h.launch();
    expect(await again.checkIns.gate()).toEqual({ kind: 'ask' });
    expect((await again.training.snapshot())?.profile.checkInSchedule).toEqual({ kind: 'days', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter((d) => d === other || d === today) });
  });
});

describe('screens', () => {
  const src = (p: string) => readFileSync(join(import.meta.dirname, '../src', p), 'utf8');
  it('Today’s Empty workout start passes `empty` to the gate; plan starts don’t', () => {
    const today = src('screens/TodayScreen.tsx');
    expect(today).toContain("const gate = await gateCheckIn(intent.kind === 'empty');");
    expect(today).toContain('const gate = await services.checkIns.gate({ empty });');
    expect(today.match(/gateCheckIn\(false\)/g)?.length).toBe(2);
  });

  it('Profile › Training has a Check-in row that opens the settings screen', () => {
    const profile = src('screens/profile/ProfileScreen.tsx');
    const training = profile.slice(profile.indexOf('<SectionHeader title="Training" />'), profile.indexOf('<SectionHeader', profile.indexOf('<SectionHeader title="Training" />') + 1));
    expect(training).toContain("navigation.navigate('CheckInSettings')");
    expect(src('navigation/AppNavigator.tsx')).toContain('name="CheckInSettings" component={CheckInSettingsScreen}');
  });
});
