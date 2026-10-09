import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toIso, toMs, type NextTimeRow, type WorkoutSummary } from '@fizz/domain';

import { nowMs as clockNow } from '../../clock';
import { newUuid } from '../../device/runtime';
import { formatDayMonth, formatShortDate, formatTime } from '../../format/dates';
import { popToTabs, popToToday } from '../../navigation/actions';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomBar, Card, Chip, ChipRow, Icon, LinkLine, PrimaryButton, SecondaryButton, SectionHeader, StatusLine, Tag, TextButton } from '../../ui';
import { stepTime } from '../../workout/finish';

/**
 * Workout summary (workout-summary.md). Shown only after `finishWorkout`
 * committed. Facts first; `Next time` from the built-in rule, tagged with
 * its source; the check-in exactly as Ben gave it; the on-phone backup line.
 * No AI in this build: the coach note says so honestly.
 */
export function SummaryScreen() {
  const theme = useTheme();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { sessionId } = useRoute<RouteProp<RootStackParams, 'Summary'>>().params;
  const [times, setTimes] = useState(false);
  const [data, reload] = useScreenData(async (s) => {
    const [summary, backup] = await Promise.all([s.workout.summary(sessionId), s.backups.getStatus()]);
    return { summary, backup };
  });

  const done = () => {
    navigation.dispatch(popToToday());
  };

  if (data.state !== 'ready' || data.value.summary === null) return <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} />;
  const { summary: sum, backup } = data.value;
  const tz = sum.tz;
  const range = `${formatTime(toMs(sum.startedAtUtc), tz)}–${sum.endedAtUtc ? formatTime(toMs(sum.endedAtUtc), tz) : ''}`;
  const edited = sum.timingEdited.end ? ' (end time edited)' : sum.timingEdited.start ? ' (start time edited)' : '';
  const line = backup.onPhone.line;
  const failed = backup.onPhone.state === 'failed';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + theme.space['4'], paddingHorizontal: theme.components.screenMargin, paddingBottom: theme.space['8'], gap: theme.space['5'] }}>
        <View style={{ backgroundColor: theme.colors['status.done.subtle'], borderRadius: theme.radius.md, padding: theme.space['3'], gap: theme.space['1'] }} accessibilityRole="summary">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <Icon name="checkmark.circle.fill" color="status.done" />
            <AppText variant="headline">Workout saved on this phone</AppText>
          </View>
          {failed ? (
            <LinkLine
              accessibilityLabel="Last backup on this phone didn’t save. Open Data and backup."
              onPress={() => {
                navigation.dispatch(popToTabs({ screen: 'Profile', params: { screen: 'DataBackup', initial: false } }));
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
                <Icon name="exclamationmark.triangle" color="status.warning" size={16} />
                <AppText variant="callout">Last backup on this phone didn’t save. Open Data & backup ›</AppText>
              </View>
            </LinkLine>
          ) : (
            <AppText variant="callout" color="text.secondary" numeric>
              {line.text}
            </AppText>
          )}
        </View>

        <View style={{ gap: theme.space['1'] }}>
          <AppText variant="title2" accessibilityRole="header">
            {sum.title}
          </AppText>
          <AppText variant="callout" color="text.secondary" numeric>
            {[formatShortDate(toMs(sum.startedAtUtc), tz), sum.gymName, `${range}${edited}`].filter(Boolean).join(' · ')}
          </AppText>
        </View>

        {sum.checkIn ? (
          <View style={{ gap: theme.space['1'] }}>
            <LinkLine
              accessibilityLabel={`How you said you felt before this workout: ${sum.checkIn.scoreText}. ${sum.checkIn.reasons ?? ''}${sum.checkIn.note ? ` Note: ${sum.checkIn.note}` : ''}`}
              onPress={() => {
                if (sum.checkIn) navigation.navigate('CheckIn', { mode: 'edit', checkInId: sum.checkIn.checkInId });
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
                <AppText variant="body" numeric style={{ flex: 1 }}>{`How you said you felt: ${sum.checkIn.scoreText}`}</AppText>
                <Icon name="chevron.right" size={14} color="text.tertiary" />
              </View>
            </LinkLine>
            {sum.checkIn.reasons ? (
              <AppText variant="callout" color="text.secondary">
                {sum.checkIn.reasons}
              </AppText>
            ) : null}
            {sum.checkIn.note ? (
              <AppText variant="callout" color="text.secondary" numberOfLines={2}>{`“${sum.checkIn.note}”`}</AppText>
            ) : null}
            {sum.checkIn.painNotFlagged ? (
              <StatusLine icon="exclamationmark.triangle" tone="warning" text="You mentioned pain before this workout. Flag the movements that hurt so loads don’t go up." detail="Choosing movements here comes with the pain flags screen; you can flag them from the next check-in." />
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: theme.space['2'] }}>
          <Fact label="Active time" value={sum.facts.activeText} />
          <Fact label="Exercises" value={`${String(sum.facts.exercisesDone)} of ${String(sum.facts.exercisesTotal)}`} />
          <Fact label="Working sets" value={`${String(sum.facts.workingSets)}${sum.facts.skippedSets > 0 ? ` (${String(sum.facts.skippedSets)} skipped)` : ''}`} />
          {sum.facts.warmupSets > 0 ? <Fact label="Warm-up sets" value={String(sum.facts.warmupSets)} /> : null}
        </View>

        {sum.comparison ? <Comparison c={sum.comparison} tz={tz} /> : null}

        {sum.exercises.length > 0 ? (
          <View style={{ gap: theme.space['2'] }}>
            <SectionHeader title="Exercises" />
            {sum.exercises.map((e) => (
              <View key={e.sessionExerciseId} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space['2'] }}>
                  <AppText variant="headline" style={{ flex: 1 }}>
                    {e.name}
                  </AppText>
                  <AppText variant="callout" color="text.secondary" numeric>
                    {e.setsText}
                  </AppText>
                </View>
                {e.results !== '' ? (
                  <AppText variant="callout" numeric>
                    {e.results}
                  </AppText>
                ) : null}
                {e.skipped > 0 ? <AppText variant="callout" color="text.secondary" numeric>{`${String(e.skipped)} skipped`}</AppText> : null}
                {e.sides ? (
                  <AppText variant="callout" color="text.secondary" numeric>
                    {e.sides}
                  </AppText>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {sum.nextTime ? (
          <View style={{ gap: theme.space['3'] }}>
            <SectionHeader title="Next time" />
            {sum.nextTime.emptyText ? (
              <AppText variant="callout" color="text.secondary">
                {sum.nextTime.emptyText}
              </AppText>
            ) : null}
            {sum.nextTime.rows.map((r) => (
              <NextRow key={r.exerciseId} row={r} tag={sum.nextTime?.sourceTag ?? ''} />
            ))}
          </View>
        ) : null}

        <View style={{ gap: theme.space['1'] }}>
          <SectionHeader title="Coach note" />
          <AppText variant="callout" color="text.secondary">
            Coach not connected. Your workout is saved; a note can be added later.
          </AppText>
        </View>

        {/* A 0-set workout was offered Discard in the finish sheet; discarding a finished one isn't in the domain yet. */}
      </ScrollView>
      <BottomBar>
        <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          <View style={{ flex: 1 }}>
            <SecondaryButton
              label="Edit times"
              onPress={() => {
                setTimes(true);
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton label="Done" onPress={done} />
          </View>
        </View>
      </BottomBar>
      <EditTimesSheet
        summary={sum}
        visible={times}
        onClose={() => {
          setTimes(false);
        }}
        onSaved={() => {
          setTimes(false);
          changed();
          reload();
        }}
      />
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space['3'], flexWrap: 'wrap' }} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="body" color="text.secondary">
        {label}
      </AppText>
      <AppText variant="body" numeric>
        {value}
      </AppText>
    </View>
  );
}

function Comparison({ c, tz }: { c: NonNullable<WorkoutSummary['comparison']>; tz: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['1'] }}>
      <SectionHeader title="Compared with last time" />
      {c.kind === 'compared' ? (
        <>
          <AppText variant="headline">{`${c.exerciseName} · top set`}</AppText>
          <Fact label="Today" value={c.todayText} />
          <Fact label={formatDayMonth(toMs(c.lastAtUtc), tz)} value={c.lastText} />
          <AppText variant="callout" color="text.secondary">
            {c.why}
          </AppText>
        </>
      ) : (
        <AppText variant="callout" color="text.secondary">
          {c.text}
        </AppText>
      )}
    </View>
  );
}

function NextRow({ row, tag }: { row: NextTimeRow; tag: string }) {
  const theme = useTheme();
  const [why, setWhy] = useState(false);
  return (
    <Card>
      <AppText variant="headline">{row.exerciseName}</AppText>
      <AppText variant="body" numeric>
        {row.target}
      </AppText>
      <AppText variant="callout" color="text.secondary">
        {row.summary}
      </AppText>
      <Tag text={tag} />
      <TextButton
        label={why ? `Rule: ${row.ruleName}` : 'Why?'}
        tone="secondary"
        onPress={() => {
          setWhy((w) => !w);
        }}
      />
      {why ? (
        <View style={{ gap: theme.space['1'] }}>
          {row.facts.map((f) => (
            <AppText key={f} variant="callout" color="text.secondary">
              {`· ${f}`}
            </AppText>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** Summary `Edit times` (workout-summary §4): start and end, audited; bounds from the domain. */
function EditTimesSheet({ summary, visible, onClose, onSaved }: { summary: WorkoutSummary; visible: boolean; onClose: () => void; onSaved: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const insets = useSafeAreaInsets();
  const tz = summary.tz;
  const [start, setStart] = useState(toMs(summary.startedAtUtc));
  const [end, setEnd] = useState(toMs(summary.endedAtUtc ?? summary.startedAtUtc));
  const [opId, setOpId] = useState(newUuid);
  const [error, setError] = useState<string | null>(null);
  const [lastShown, setLastShown] = useState(false);
  if (visible !== lastShown) {
    setLastShown(visible);
    if (visible) {
      setStart(toMs(summary.startedAtUtc));
      setEnd(toMs(summary.endedAtUtc ?? summary.startedAtUtc));
      setOpId(newUuid());
      setError(null);
    }
  }
  const startMax = Math.min(toMs(summary.timingBounds.startLatestUtc), end);
  const endMin = Math.max(toMs(summary.timingBounds.endEarliestUtc), start);
  const endMax = Math.min(toMs(summary.timingBounds.endLatestUtc), clockNow());

  async function save() {
    const startChanged = start !== toMs(summary.startedAtUtc);
    const endChanged = end !== toMs(summary.endedAtUtc ?? '');
    if (!startChanged && !endChanged) {
      onClose();
      return;
    }
    const at = services.now();
    const r = await services.workout.dispatch(summary.sessionId, {
      type: 'update_session_timing',
      at,
      opId,
      expectedVersion: summary.sessionVersion,
      startedAt: startChanged ? { utc: toIso(start), tz: at.tz } : null,
      endedAt: endChanged ? { utc: toIso(end), tz: at.tz } : null,
    });
    if (!r.ok) {
      setError(r.error.code === 'stale_version' ? 'The workout changed. Close and try again.' : r.error.message);
      return;
    }
    onSaved();
  }

  const row = (label: string, value: number, set: (v: number) => void, min: number, max: number) => (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="label" color="text.secondary">
        {label}
      </AppText>
      <AppText variant="title2" numeric>
        {formatTime(value, tz)}
      </AppText>
      <ChipRow>
        {[-5, -1, 1, 5].map((m) => (
          <Chip key={m} label={`${m < 0 ? '−' : '+'}${String(Math.abs(m))} min`} selected={false} onPress={() => { set(stepTime(value, m, min, max)); }} />
        ))}
      </ChipRow>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: theme.colors['bg.surface'] }} contentContainerStyle={{ padding: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom, gap: theme.space['4'] }}>
        <AppText variant="title2" accessibilityRole="header">
          Edit workout times
        </AppText>
        {row('Started at', start, setStart, toMs(summary.startedAtUtc) - 12 * 3600_000, startMax)}
        {row('Ended at', end, setEnd, endMin, endMax)}
        <AppText variant="callout" color="text.secondary">
          Active time counts from start to end, minus pauses inside that window. The original times are kept in the edit history.
        </AppText>
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        <PrimaryButton label="Save" onPress={() => void save()} />
        <TextButton label="Cancel" tone="secondary" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
