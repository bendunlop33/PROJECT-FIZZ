import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { ALL_WEEKDAYS, CHECK_IN_SETTINGS_COPY as C, checkInDayToggle, checkInDaysPick, checkInSettingsFor, toMs, weekdayLong, weekdayOf, weekdayShort } from '@fizz/domain';
import type { CheckInSchedule, TrainingProfile, Weekday } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { Chip, ChoiceCard, Screen, StatusLine, TextButton } from '../../ui';

/**
 * Profile › Training › Check-in (Ben, 26 Oct; check-in.md §2.8; app review finding 16): when Start asks
 * `How are you feeling?`. `Only when I choose` (default: never on Start; the workout offers it), `Every workout`,
 * or `On these days`. Each tap is one versioned write on the training profile (Your data, op ID, rule 5); a stale
 * write reloads. The thresholds keep their defaults (no screen yet). An Empty workout never asks, whatever this says.
 */
export function CheckInSettingsScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [profile, setProfile] = useState<TrainingProfile | null | 'error'>(null);
  const [failed, setFailed] = useState(false);
  // The days picked before switching away, so `On these days` comes back with them (this visit).
  const lastDays = useRef<readonly Weekday[] | null>(null);
  const busy = useRef(false);

  const load = () => {
    void services.training
      .snapshot()
      .then((s) => {
        setProfile(s?.profile ?? 'error');
        if (s?.profile.checkInSchedule?.kind === 'days') lastDays.current = s.profile.checkInSchedule.weekdays;
      })
      .catch(() => {
        setProfile('error');
      });
  };
  useEffect(load, [services]);

  if (profile === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open your settings." action={<TextButton label="Try again" onPress={load} />} />
      </Screen>
    );
  }
  if (profile === null) return <Screen>{null}</Screen>;

  const schedule = checkInSettingsFor(profile).schedule;

  async function save(next: CheckInSchedule) {
    if (profile === null || profile === 'error' || busy.current) return;
    busy.current = true;
    try {
      if (next.kind === 'days') lastDays.current = next.weekdays;
      const r = await services.training.change({ kind: 'check_in_schedule', schedule: next }, profile.version, newUuid());
      setFailed(!r.ok);
      if (r.ok) {
        setProfile(r.profile);
        changed();
      } else if (r.profile !== null) setProfile(r.profile);
    } finally {
      busy.current = false;
    }
  }

  const now = services.now();
  const today = weekdayOf(toMs(now.utc), now.tz);
  return (
    <Screen>
      <View style={{ gap: theme.space['2'] }} accessibilityRole="radiogroup">
        <ChoiceCard title={C.whenChoose} selected={schedule.kind === 'when_i_choose'} onPress={() => void save({ kind: 'when_i_choose' })} />
        <ChoiceCard title={C.every} selected={schedule.kind === 'every_workout'} onPress={() => void save({ kind: 'every_workout' })} />
        <ChoiceCard title={C.days} selected={schedule.kind === 'days'} onPress={() => void save(checkInDaysPick(schedule, today, lastDays.current))} />
      </View>
      {schedule.kind === 'days' ? (
        <View style={{ flexDirection: 'row', gap: theme.space['1'] }}>
          {ALL_WEEKDAYS.map((d) => (
            <Chip
              key={d}
              grow
              label={weekdayShort(d)}
              accessibilityLabel={weekdayLong(d)}
              selected={schedule.weekdays.includes(d)}
              onPress={() => {
                const next = checkInDayToggle(schedule, d);
                if (next !== null) void save(next);
              }}
            />
          ))}
        </View>
      ) : null}
      {failed ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Not saved. Try again." /> : null}
    </Screen>
  );
}
