import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toMs, type WorkoutSummary } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { formatCalendarDate, formatShortDate } from '../../format/dates';
import { DELETE_COPY, deletedBannerText, restoredToastText } from '../../history/delete-view';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomBar, HeroHeader, Icon, PrimaryButton, RuledSection, StatusLine, TextButton, Toast } from '../../ui';

/**
 * A deleted workout opened from Recently deleted or an old link
 * (delete-workouts §2.5, §3.2): read-only, with the `Deleted · gone on`
 * banner and `Restore`. No Edit, rename, coach or Repeat. After the purge
 * (or past its 30 days) only `This workout was deleted.` is shown.
 */
export function DeletedWorkoutView({ summary, goneOn, version, onDone }: { summary: WorkoutSummary | null; goneOn: string | null; version: number | null; onDone: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const services = useServices();
  const changed = useDataChanged();
  const [line, setLine] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [opId] = useState(() => newUuid());
  const pad = { paddingTop: insets.top + theme.space['4'], paddingHorizontal: theme.components.screenMargin, gap: theme.space['5'] };

  if (summary === null || goneOn === null || version === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], ...pad }}>
        <AppText variant="body">{DELETE_COPY.gone}</AppText>
        <TextButton label="Done" onPress={onDone} />
      </View>
    );
  }
  const tz = services.now().tz;
  const date = summary.dateOnly !== null ? formatCalendarDate(summary.dateOnly) : formatShortDate(toMs(summary.startedAtUtc), summary.tz);
  const row = { title: summary.title, startedAtUtc: summary.startedAtUtc, tz: summary.tz, localDate: summary.dateOnly, source: summary.source, sessionId: summary.sessionId, version, gymName: summary.gymName ?? '', sets: summary.facts.workingSets };

  async function restore() {
    const r = await services.history.restoreWorkouts([{ sessionId: row.sessionId, expectedVersion: version ?? 0 }], opId);
    if (!r.ok) {
      setLine(r.message);
      return;
    }
    setRestored(restoredToastText([row], tz));
    changed();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView contentContainerStyle={{ ...pad, paddingBottom: theme.space['8'] }}>
        {restored === null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <Icon name="trash" color="text.secondary" size={18} />
            <AppText variant="callout" color="text.secondary" numeric>
              {deletedBannerText(goneOn)}
            </AppText>
          </View>
        ) : null}
        {line ? <StatusLine icon="info.circle" tone="info" text={line} /> : null}
        <HeroHeader title={summary.title} lines={[[date, summary.gymName].filter(Boolean).join(' · ')]} />
        <RuledSection title="Exercises" gap="2">
          {summary.exercises.map((e) => (
            <View key={e.sessionExerciseId} style={{ gap: 2 }}>
              <AppText variant="body">{e.name}</AppText>
              <AppText variant="callout" color="text.secondary" numeric>
                {e.results || e.setsText}
              </AppText>
            </View>
          ))}
        </RuledSection>
      </ScrollView>
      {restored !== null ? <Toast text={restored} /> : null}
      <BottomBar>{restored === null ? <PrimaryButton label={DELETE_COPY.restore} onPress={() => void restore()} /> : <PrimaryButton label="Done" onPress={onDone} />}</BottomBar>
    </View>
  );
}
