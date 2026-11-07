import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toIso } from '@fizz/domain';

import { dateAt, nowMs as clockNow } from '../../clock';
import { newUuid } from '../../device/runtime';
import { formatShortDate, formatTime } from '../../format/dates';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Eyebrow, Group, Icon, StatusLine, TextButton, TEXT_PRESSED_OPACITY } from '../../ui';
import { clampPastStart, PAST_LOG_COPY, withPickedDate, withPickedTime } from '../../workout/past-log-view';

type Choices = NonNullable<Awaited<ReturnType<ReturnType<typeof useServices>['workout']['pastLogChoices']>>>;

/**
 * `Log a past workout` (Ben, 25 Oct: "I should be able to freely edit times, e.g. if I want to import a
 * workout historically from the day before or beyond"). Date (yesterday first) and Start on the iOS
 * wheels, then what to start from: an empty workout, a plan day or a saved workout. The workout opens
 * with no clock (no rest timer, Live Activity or alerts); Finish asks the end. Reached from Today's `⋯`,
 * Library › Workouts and Past workouts. Nothing is written until a row is tapped; one opId per opening,
 * so a double tap or a retry is the same Start.
 *
 * Needs `@react-native-community/datetimepicker` in the native build (as the Finish sheet's wheels).
 */
export function LogPastWorkoutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [choices, setChoices] = useState<Choices | null>(null);
  const [startMs, setStartMs] = useState(0);
  const [open, setOpen] = useState<'date' | 'time' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opId = useRef(newUuid());
  const [lastShown, setLastShown] = useState(false);
  if (visible !== lastShown) {
    setLastShown(visible);
    if (visible) {
      opId.current = newUuid();
      setChoices(null);
      setOpen(null);
      setNote(null);
      setError(null);
      void services.workout.pastLogChoices().then((c) => {
        setChoices(c);
        if (c !== null) setStartMs(c.defaultStartMs);
      });
    }
  }
  const tz = choices?.tz ?? services.now().tz;

  function pick(which: 'date' | 'time', date: Date) {
    const picked = which === 'date' ? withPickedDate(startMs, date.getTime(), tz) : withPickedTime(startMs, date.getTime(), tz);
    const next = clampPastStart(picked, clockNow());
    setNote(next.note);
    setStartMs(next.startMs);
  }

  async function start(routineId: string | null) {
    if (busy || choices === null) return;
    setBusy(true);
    setError(null);
    try {
      const current = await services.yourData.currentGym().catch(() => null);
      let gymId = current?.id ?? null;
      if (gymId === null) {
        const made = await services.setup.useTypicalGym();
        gymId = made.ok ? (made.gymId ?? null) : null;
      }
      if (gymId === null) {
        setError(PAST_LOG_COPY.failed);
        return;
      }
      const r = await services.workout.start({ gymId, opId: opId.current, checkIn: null, pastStart: { utc: toIso(clampPastStart(startMs, clockNow()).startMs), tz }, ...(routineId === null ? {} : { routineOf: routineId }) });
      if (!r.ok) {
        setError(r.error.code === 'session_already_active' ? PAST_LOG_COPY.openWorkout : PAST_LOG_COPY.failed);
        return;
      }
      changed();
      onClose();
      navigation.navigate('Workout');
    } finally {
      setBusy(false);
    }
  }

  const row = (which: 'date' | 'time', label: string, text: string) => {
    const expanded = open === which;
    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} ${text}`}
          accessibilityState={{ expanded }}
          onPress={() => {
            setOpen(expanded ? null : which);
          }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', columnGap: theme.space['2'], minHeight: 52, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['3'], opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <AppText variant="body" style={{ flex: 1 }}>
            {label}
          </AppText>
          <AppText variant="body" numeric color={expanded ? 'accent' : 'text.primary'}>
            {text}
          </AppText>
          <Icon name={expanded ? 'chevron.up' : 'chevron.down'} color="text.tertiary" size={14} />
        </Pressable>
        {expanded ? (
          <DateTimePicker
            value={dateAt(startMs)}
            mode={which === 'date' ? 'date' : 'time'}
            display="spinner"
            timeZoneName={tz}
            maximumDate={dateAt(clockNow())}
            themeVariant={theme.scheme}
            onValueChange={(_e, date) => {
              pick(which, date);
            }}
          />
        ) : null}
      </View>
    );
  };

  const source = (key: string, title: string, routineId: string | null) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={busy}
      onPress={() => void start(routineId)}
      style={({ pressed }) => ({ minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space['4'], opacity: pressed || busy ? TEXT_PRESSED_OPACITY : 1 })}
    >
      <AppText variant="body">{title}</AppText>
      <Icon name="chevron.right" size={14} color="text.tertiary" />
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: theme.colors['bg.surface'] }} contentContainerStyle={{ padding: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom, gap: theme.space['4'] }}>
        <AppText variant="title2" accessibilityRole="header">
          {PAST_LOG_COPY.title}
        </AppText>
        {choices === null ? null : (
          <>
            <Group>
              {row('date', PAST_LOG_COPY.date, formatShortDate(startMs, tz))}
              {row('time', PAST_LOG_COPY.start, formatTime(startMs, tz))}
            </Group>
            {note !== null ? <StatusLine icon="info.circle" tone="info" text={note} /> : null}
            <View style={{ gap: theme.space['2'] }}>
              <Eyebrow>{PAST_LOG_COPY.from}</Eyebrow>
              <Group>{source('empty', PAST_LOG_COPY.empty, null)}</Group>
            </View>
            {choices.days.length > 0 ? (
              <View style={{ gap: theme.space['2'] }}>
                <Eyebrow>{PAST_LOG_COPY.planDays}</Eyebrow>
                <Group>{choices.days.map((d) => source(`day:${d.routineId}`, d.name, d.routineId))}</Group>
              </View>
            ) : null}
            {choices.workouts.length > 0 ? (
              <View style={{ gap: theme.space['2'] }}>
                <Eyebrow>{PAST_LOG_COPY.workouts}</Eyebrow>
                <Group>{choices.workouts.map((w) => source(`w:${w.routineId}`, w.name, w.routineId))}</Group>
              </View>
            ) : null}
          </>
        )}
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        <TextButton label={PAST_LOG_COPY.cancel} tone="secondary" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
