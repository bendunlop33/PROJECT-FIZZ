import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PainFlagSheetView } from '@fizz/domain';

import { nowMs as clockNow } from '../../clock';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Icon, SecondaryButton, StatusLine, TextButton, Toast } from '../../ui';
import { answerStillHurts, confirmClearFlag, type PainToast } from '../../workout/pain-actions';

/**
 * Pain flag sheet (active-workout.md §2.14.4). Opened from the set card's
 * `PainFlagNote`, `Why?`'s `Check due ›`, Today's check row and Profile ›
 * Pain flags. Medium detent; a workout keeps running underneath. Every line
 * comes from `pain.sheet` (`buildPainFlagSheet`): local reads only, no AI.
 * `Still hurts?` is asked only when the check is due, and never clears the
 * flag; only `Clear flag` in the confirmation does (rule 9, CM4).
 */
export function PainFlagSheet() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { flagId, sessionId, sessionExerciseId } = useRoute<RouteProp<RootStackParams, 'PainFlag'>>().params;
  const [sheet, setSheet] = useState<PainFlagSheetView | null | 'loading'>('loading');
  const [toast, setToast] = useState<(PainToast & { id: number }) | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setSheet(await services.pain.sheet({ flagId, sessionId: sessionId ?? null, sessionExerciseId: sessionExerciseId ?? null }));
  }, [services, flagId, sessionId, sessionExerciseId]);
  useEffect(() => {
    void load();
  }, [load]);

  // The outcome line keeps its Undo for the usual 8 s, then goes.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast((cur) => (cur?.id === toast.id ? null : cur));
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  const report = useCallback(
    (t: PainToast) => {
      setToast({ ...t, id: clockNow() });
      changed();
      void load();
    },
    [changed, load],
  );

  const close = () => {
    navigation.goBack();
  };

  if (sheet === 'loading') return <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }} />;
  if (sheet === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'], padding: theme.space['4'], gap: theme.space['3'] }}>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read this pain flag." />
        <TextButton label="Done" onPress={close} />
      </View>
    );
  }
  const view = sheet;

  async function clear() {
    const flag = await services.pain.get(view.flagId);
    if (!flag) return;
    confirmClearFlag(services, flag, report);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space['4'], paddingTop: theme.space['4'] }}>
        <AppText variant="title2" accessibilityRole="header">
          Pain flag
        </AppText>
        <TextButton label="Done" onPress={close} />
      </View>
      <ScrollView contentContainerStyle={{ padding: theme.space['4'], gap: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom }}>
        <View style={{ gap: theme.space['1'] }}>
          <View accessible accessibilityLabel={`Pain flag: ${view.heading}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <Icon name="exclamationmark.triangle" color={view.active ? 'status.warning' : 'text.secondary'} />
            <AppText variant="headline">{view.heading}</AppText>
          </View>
          <AppText variant="callout" color="text.secondary" numeric>
            {view.since}
          </AppText>
          <AppText variant="body">{view.effect}</AppText>
        </View>

        {view.active && view.checkDue ? (
          <View style={{ gap: theme.space['2'] }}>
            <AppText variant="headline">Still hurts?</AppText>
            <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
              <View style={{ flex: 1 }}>
                <SecondaryButton
                  label="Still hurts"
                  disabled={busy}
                  onPress={() => {
                    setBusy(true);
                    void answerStillHurts(services, view.flagId, view.flagVersion, report).finally(() => {
                      setBusy(false);
                    });
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <SecondaryButton label="Better: clear…" disabled={busy} onPress={() => void clear()} />
              </View>
            </View>
          </View>
        ) : null}

        {toast ? (
          <View style={{ gap: theme.space['1'] }}>
            <Toast icon={toast.icon} text={toast.text} {...(toast.action && toast.onAction ? { action: toast.action, onAction: toast.onAction } : {})} />
            {toast.detail ? (
              <AppText variant="callout" color="text.secondary">
                {toast.detail}
              </AppText>
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: theme.space['1'] }}>
          <AppText variant="label" color="text.secondary">
            Before the flag
          </AppText>
          <AppText variant="body" numeric>
            {view.before ?? 'No earlier sets of this exercise.'}
          </AppText>
          <AppText variant="label" color="text.secondary">
            Since the flag
          </AppText>
          <AppText variant="body" numeric>
            {view.sinceFlag ?? 'Not done since the flag.'}
          </AppText>
        </View>

        <AppText variant="callout" color="text.secondary">
          {view.professional}
        </AppText>

        {view.active && !view.checkDue ? <TextButton label="Clear flag…" onPress={() => void clear()} /> : null}
        {/* From a workout the list would close the workout under it, so it's offered only outside one. */}
        {sessionId ? null : (
          <TextButton
            label="All pain flags"
            onPress={() => {
              navigation.goBack();
              navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'PainFlags' } });
            }}
          />
        )}
      </ScrollView>
    </View>
  );
}
