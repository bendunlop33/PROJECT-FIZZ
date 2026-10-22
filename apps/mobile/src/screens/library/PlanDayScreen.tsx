import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { newUuid } from '../../device/runtime';
import type { LibraryStackParams } from '../../navigation/types';
import { PLAN_COPY } from '../../services/plan-services';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, HeroHeader, PrimaryButton, StatusLine, TextButton, Toast } from '../../ui';

export const PLAN_DAY_COPY = {
  /** (22 Oct) It opens Your workout (nothing starts until Start there), so it says Open, not Start. */
  open: (name: string) => `Open ${name}`,
  edit: 'Edit',
  askCoach: 'Ask coach',
  coachDraft: (name: string) => `Change ${name} in my plan: `,
  /** (Ben, 20 Oct) Pin this day as Up next until it's done. */
  makeNext: 'Make next',
  unpin: 'Unpin',
  madeNext: (name: string) => `${name} is next`,
  unpinned: 'Unpinned',
  undo: 'Undo',
} as const;

/**
 * Your plan › a day (Ben, 19 Oct; mockup approved): the day's name, `Day 2
 * of 4 · Main gym · about 60 min`, each exercise's planned sets × reps ·
 * load at this gym with last time's sets and targets hit (or `est.`), then
 * `Open <day>` (Your workout for that day, where Start is; 22 Oct), `Edit`
 * (the saved workout) and `Ask coach` (the coach sheet with a draft; nothing
 * is sent). Every value comes from `services.plans.planDay`; nothing is
 * computed here. Local only (rule 1).
 */
export function PlanDayScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { routineId, name: shownName } = useRoute<RouteProp<LibraryStackParams, 'LibraryPlanDay'>>().params;
  const { prefs } = useDevicePrefs();
  const [data, reload] = useScreenData((s) => s.plans.planDay(routineId, { targetsHit: prefs.targetsHit }));
  const day = data.state === 'ready' ? data.value : null;
  const name = day?.name ?? shownName ?? '';
  const services = useServices();
  const changed = useDataChanged();
  const busy = useRef(false);
  const [toast, setToast] = useState<{ text: string; action?: string; onAction?: () => void } | null>(null);
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  /** `Make next` / `Unpin` (rule 5: the screen's read of the plan; a retried tap is the same write), then Undo. */
  async function pin(on: boolean) {
    if (day === null || busy.current) return;
    busy.current = true;
    const opId = newUuid();
    try {
      const r = await services.plans.makeNext({ planId: day.planId, routineId: on ? day.routineId : null, expectedVersion: day.planVersion, opId });
      changed();
      reload();
      if (!r.ok) {
        setToast({ text: r.message });
        return;
      }
      const after = r.plan;
      const undoOp = newUuid();
      setToast({
        text: on ? PLAN_DAY_COPY.madeNext(day.name) : PLAN_DAY_COPY.unpinned,
        action: PLAN_DAY_COPY.undo,
        onAction: () => {
          setToast(null);
          void services.plans.undoControl({ planId: after.id, targetOpId: opId, expectedVersion: after.version, opId: undoOp }).then((u) => {
            changed();
            reload();
            if (!u.ok) setToast({ text: u.message });
          });
        },
      });
    } finally {
      busy.current = false;
    }
  }

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['8'] + insets.bottom, gap: theme.space['5'] }}>
      {data.state === 'error' ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={PLAN_COPY.failed} action={<TextButton label="Try again" onPress={reload} />} /> : null}
      {data.state === 'ready' && day === null ? <StatusLine icon="info.circle" tone="info" text={PLAN_COPY.missing} /> : null}
      {day !== null ? (
        <>
          <HeroHeader size="screen" title={day.name} lines={[day.header]} />
          {day.status !== 'planned' ? <StatusLine icon="info.circle" tone="info" text={day.status === 'no_gym' ? PLAN_COPY.noGym : PLAN_COPY.notHere} /> : null}
          {day.rows.length > 0 ? (
            <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['1'] }}>
              {day.rows.map((r, i) => (
                <View key={r.key} accessible accessibilityLabel={r.accessibilityLabel} style={{ paddingVertical: theme.space['3'], gap: 2, borderTopWidth: i === 0 ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: theme.space['3'] }}>
                    <AppText variant="body" style={{ flexShrink: 1 }}>
                      {r.name}
                    </AppText>
                    <AppText variant="body" numeric>
                      {r.line}
                    </AppText>
                  </View>
                  {r.sub !== null ? (
                    <AppText variant="callout" color="text.secondary" numeric>
                      {r.sub}
                    </AppText>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
          <PrimaryButton
            label={PLAN_DAY_COPY.open(name)}
            onPress={() => {
              navigation.navigate('BuilderWorkout', { open: { kind: 'routine', routineId: day.routineId }, back: 'Library' });
            }}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['5'] }}>
            <TextButton
              label={PLAN_DAY_COPY.edit}
              onPress={() => {
                navigation.navigate('WorkoutEditor', { routineId: day.routineId, from: 'Library' });
              }}
            />
            <TextButton
              label={PLAN_DAY_COPY.askCoach}
              onPress={() => {
                navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true, draft: PLAN_DAY_COPY.coachDraft(name) });
              }}
            />
            {day.paused ? null : (
              <TextButton
                label={day.pinned ? PLAN_DAY_COPY.unpin : PLAN_DAY_COPY.makeNext}
                tone={day.pinned ? 'secondary' : 'accent'}
                onPress={() => {
                  void pin(!day.pinned);
                }}
              />
            )}
          </View>
        </>
      ) : null}
    </ScrollView>
    {toast !== null ? (
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + theme.space['2'] }}>
        <Toast icon="info.circle" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} />
      </View>
    ) : null}
    </View>
  );
}
