import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { ProgressGrouping, ProgressWindowDays } from '@fizz/schemas';

import type { ProgressStackParams } from '../../navigation/types';
import { FrequencyHeader, FrequencyRow, Segmented, WindowPicker } from '../../progress/components';
import { useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Screen, StatusLine, TextButton } from '../../ui';
import { AskPill } from '../coach/AskPill';
import { HowCountedSheet } from './sheets';

/**
 * Muscles (progress.md §2.4): the same window and grouping as the home (one
 * shared, saved setting), every group expandable to what counted, a
 * `PER WEEK` column from 14 days, `Not counted`, and `How this is counted`.
 */
export function MusclesScreen() {
  const theme = useTheme();
  const services = useServices();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<ProgressStackParams, 'ProgressMuscles'>>();
  // No local window or grouping: the service holds the one shared choice (check 15).
  const [data, reload] = useScreenData((s) => s.progress.home());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(route.params.group ? [route.params.group] : []));
  const [howOpen, setHowOpen] = useState(false);

  const change = (patch: { days?: ProgressWindowDays; grouping?: ProgressGrouping }) => {
    const saved = services.progress.saveSettings(patch);
    reload();
    void saved.then(reload);
  };

  if (data.state === 'error') {
    return (
      <Screen>
        <StatusLine
          icon="exclamationmark.triangle"
          tone="warning"
          text="Couldn’t open your training data."
          info={data.message}
          infoLabel="Error details"
          action={
            <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
              <TextButton label="Try again" onPress={reload} />
              <TextButton
                label="Restore from backup"
                onPress={() => {
                  navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'Restore', params: { mode: 'restore' }, initial: false } });
                }}
              />
            </View>
          }
        />
      </Screen>
    );
  }
  const home = data.state === 'ready' ? data.value : null;
  if (home === null) {
    // Loading: nothing yet. Read with no profile (not reachable from home, review r2 N4): never a blank page.
    return <Screen>{data.state === 'loading' ? null : <AppText variant="headline">Nothing to show yet</AppText>}</Screen>;
  }
  // Ask on every Progress screen, with this screen's window (spec §2.1, review r2 S3).
  const days = home.days;
  const ask = (
    <AskPill
      onPress={() => {
        navigation.navigate('Coach', { entry: { kind: 'progress', days } });
      }}
    />
  );
  if (home.view.dataState !== 'normal') {
    // Never a blank page (review N3).
    return (
      <Screen floating={ask}>
        <AppText variant="headline">Nothing to show yet</AppText>
      </Screen>
    );
  }
  const view = home.view;
  const m = view.muscles;
  const perWeek = view.window.days >= 14;

  return (
    <Screen floating={ask}>
      <WindowPicker
        days={home.days}
        datesLine={view.datesLine}
        datesWords={view.datesWords}
        onChange={(days) => {
          change({ days });
        }}
      />
      <Segmented
        options={[
          { key: 'body_part' as const, label: 'Body parts' },
          { key: 'ppl' as const, label: 'Push/Pull/Legs' },
        ]}
        selected={home.grouping}
        onSelect={(grouping) => {
          setOpen(new Set());
          change({ grouping });
        }}
        label="Muscles"
      />
      <View>
        <FrequencyHeader perWeek={perWeek} />
        {m.rows.map((r) => {
          const expanded = open.has(r.key);
          return (
            <View key={r.key}>
              <FrequencyRow
                row={r}
                perWeek={perWeek}
                expanded={expanded}
                onPress={() => {
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.key)) next.delete(r.key);
                    else next.add(r.key);
                    return next;
                  });
                }}
              />
              {/* A group at 0 shows when it was last trained under the row, expanded or not (§2.4, §3.2). */}
              {r.zero && !expanded ? (
                <AppText variant="callout" color="text.tertiary" numeric style={{ paddingLeft: theme.space['3'], paddingBottom: theme.space['2'] }}>
                  {r.lastTrained}
                </AppText>
              ) : null}
              {expanded ? (
                <View style={{ paddingLeft: theme.space['3'], paddingBottom: theme.space['3'], gap: theme.space['1'] }}>
                  <AppText variant="callout" color="text.secondary" numeric>
                    {r.lastTrained}
                  </AppText>
                  {r.contributors.map((c) => (
                    <AppText key={c.exerciseId} variant="callout" color="text.secondary" numeric>
                      {c.text}
                    </AppText>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {m.notCounted.summary !== null || m.notCounted.noMuscles.length > 0 || m.notCounted.marked !== null ? (
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            NOT COUNTED
          </AppText>
          {m.notCounted.summary !== null ? (
            <AppText variant="callout" color="text.secondary" numeric>
              {m.notCounted.summary}
            </AppText>
          ) : null}
          {m.notCounted.noMuscles.map((n) => (
            <AppText key={n.exerciseId} variant="callout" color="text.secondary" numeric>
              {n.text}
            </AppText>
          ))}
          {m.notCounted.marked !== null ? (
            <AppText variant="callout" color="text.secondary" numeric>
              {m.notCounted.marked}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="How this is counted"
        onPress={() => {
          setHowOpen(true);
        }}
        style={{ minHeight: theme.target.min.height, justifyContent: 'center' }}
      >
        <AppText variant="callout" color="accent">
          How this is counted ›
        </AppText>
      </Pressable>
      <HowCountedSheet
        visible={howOpen}
        onClose={() => {
          setHowOpen(false);
        }}
      />
    </Screen>
  );
}
