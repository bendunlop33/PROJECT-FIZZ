import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { clampWorkoutTimes, localDateOf, moveWorkoutTimes, shiftTimeBounds, TIME_NOTE, timesNeedDate, wheelNeedsDate, workoutDurationText, type TimeNote, type WorkoutTimeBounds, type WorkoutTimeline } from '@fizz/domain';

import { dateAt } from '../../clock';
import { formatShortDate, formatTime } from '../../format/dates';
import { useTheme } from '../../theme';
import { AppText, Group, Icon, StatusLine, TEXT_PRESSED_OPACITY } from '../../ui';
import { AX_FONT_SCALE } from '../../workout/screen-rules';

/**
 * Started / Ended (Ben, 19 Oct: "Option to change start and end by scrolling when finish
 * workout"): two rows; a tap opens the iOS wheel for that row in place (the date too when the
 * workout crosses midnight). The live duration sits under them. A value outside the bounds
 * (`workoutTimeBounds`) is clamped with a short note. Used by the Finish sheet and a past
 * workout's `Edit times`, and the start alone (`startOnly`) in `Edit workout times` before Finish;
 * nothing is written here. A wheel has a date column whenever its range spans two dates (review S4).
 *
 * (Ben, 25 Oct: "freely edit times") With `shift`, moving Started moves the whole workout: the start
 * wheel has the date (any past day), Ended moves with it until Ben sets it on its own, and the bounds
 * come from the workout's recorded timeline (`moveWorkoutTimes`). The rows show the date whenever the
 * workout isn't today. The caller writes with `shift: true` when the start moved.
 *
 * Needs `@react-native-community/datetimepicker` in the native build (Expo SDK 57's 9.1.0).
 */
export interface WorkoutTimes {
  startMs: number;
  endMs: number;
}

export function WorkoutTimesRows({
  times,
  bounds: fixedBounds,
  shift,
  tz,
  onChange,
  endNow = null,
  endEstimate = null,
  startOnly = false,
}: {
  times: WorkoutTimes;
  tz: string;
  onChange: (t: WorkoutTimes) => void;
  /** Ends within a minute of this read `(now)`. */
  endNow?: number | null;
  /** A forgotten Finish's default end (last set + 3 min) reads `(estimated)` until Ben moves it. */
  endEstimate?: number | null;
  /** Before Finish: only `Started`, no duration (the workout is still going). */
  startOnly?: boolean;
} & ({ bounds: WorkoutTimeBounds; shift?: undefined } | { shift: { timeline: WorkoutTimeline; nowMs: number }; bounds?: undefined })) {
  const theme = useTheme();
  const ax = useWindowDimensions().fontScale >= AX_FONT_SCALE;
  const [open, setOpen] = useState<'start' | 'end' | null>(null);
  const [note, setNote] = useState<TimeNote | null>(null);
  const bounds = shift === undefined ? fixedBounds : shiftTimeBounds(shift.timeline, times.startMs, shift.nowMs);
  const withDate = timesNeedDate(times, tz) || (shift !== undefined && localDateOf(times.startMs, tz) !== localDateOf(shift.nowMs, tz));
  const text = (ms: number): string => (withDate ? `${formatShortDate(ms, tz)}, ${formatTime(ms, tz)}` : formatTime(ms, tz));
  const isNow = (ms: number): boolean => endNow !== null && Math.abs(ms - endNow) < 60_000;

  function pick(which: 'start' | 'end', date: Date) {
    // Whole minutes: the wheel has no seconds.
    const ms = Math.floor(date.getTime() / 60_000) * 60_000;
    const next =
      shift !== undefined
        ? moveWorkoutTimes(which, ms, times, shift.timeline, shift.nowMs)
        : clampWorkoutTimes(which === 'start' ? { startMs: ms, endMs: times.endMs } : { startMs: times.startMs, endMs: ms }, bounds);
    setNote(next.note);
    onChange({ startMs: next.startMs, endMs: next.endMs });
  }

  const row = (which: 'start' | 'end', label: string, ms: number) => {
    const expanded = open === which;
    const minMs = which === 'start' ? bounds.startMinMs : Math.max(bounds.endMinMs, times.startMs + 60_000);
    const maxMs = which === 'start' ? bounds.startMaxMs : bounds.endMaxMs;
    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} ${text(ms)}`}
          accessibilityState={{ expanded }}
          onPress={() => {
            setOpen(expanded ? null : which);
          }}
          // At AX sizes the label sits above its value; otherwise the value gives way, never the label (design pass nit).
          style={({ pressed }) => ({ flexDirection: ax ? 'column' : 'row', alignItems: ax ? 'flex-start' : 'center', columnGap: theme.space['2'], minHeight: 52, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['3'], opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <AppText variant="body" style={ax ? undefined : { flex: 1, minWidth: 72 }}>
            {label}
          </AppText>
          <AppText variant="body" numeric color={expanded ? 'accent' : 'text.primary'} style={ax ? undefined : { flexShrink: 1, textAlign: 'right' }}>
            {`${text(ms)}${which === 'end' && isNow(ms) ? ' (now)' : which === 'end' && endEstimate === ms ? ' (estimated)' : ''}`}
          </AppText>
          <Icon name={expanded ? 'chevron.up' : 'chevron.down'} color="text.tertiary" size={14} />
        </Pressable>
        {expanded ? (
          <DateTimePicker
            value={dateAt(ms)}
            mode={withDate || (shift !== undefined && which === 'start') || wheelNeedsDate(minMs, maxMs, tz) ? 'datetime' : 'time'}
            display="spinner"
            timeZoneName={tz}
            minimumDate={dateAt(minMs)}
            maximumDate={dateAt(maxMs)}
            themeVariant={theme.scheme}
            onValueChange={(_e, date) => {
              pick(which, date);
            }}
          />
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ gap: theme.space['2'] }}>
      <Group>
        {row('start', 'Started', times.startMs)}
        {startOnly ? null : row('end', 'Ended', times.endMs)}
      </Group>
      {startOnly ? null : (
        <AppText variant="callout" color="text.secondary" numeric accessibilityLiveRegion="polite">
          {workoutDurationText(times.startMs, times.endMs)}
        </AppText>
      )}
      {note !== null ? <StatusLine icon="info.circle" tone="info" text={TIME_NOTE[note]} /> : null}
    </View>
  );
}
