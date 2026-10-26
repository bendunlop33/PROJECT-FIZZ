import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PLAN_OVERVIEW_COPY } from '@fizz/domain';
import type { PlanApplyMode } from '@fizz/schemas';

import { PLAN_COPY as CARD_COPY } from '../../coach/plan-view';
import { newUuid } from '../../device/runtime';
import { PLAN_TAB_COPY, planSetupRoute, type PlanSetupRoute } from '../../library/plan-tab-view';
import { openPlanSetup } from '../../navigation/actions';
import { PLAN_COPY, type PreviousPlanRow } from '../../services/plan-services';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Eyebrow, Icon, SecondaryButton, StatusLine, TextButton, Toast, ToastHost, toastBottom } from '../../ui';
import { LiftTargetsBlock } from './LiftTargetsBlock';
import { YourPlanBlock, type PlanToast } from './YourPlanBlock';

/**
 * Library › Plan (Ben, 22 Oct; prototype `renderLibrary`; review gaps V1):
 * Your plan (the block: days, goal, Pause, End) or, with no plan, `Set up a
 * plan ›`; then `Previous` plans, each with `Start again` (`Replace my
 * workouts` / `Add alongside`, then `Plan applied` with Undo). Every value
 * from `services.plans`; nothing here computes a plan. Local only except
 * the coach hand-off, which is said honestly when the coach can't answer.
 */
export function PlanTab({ scrollTopKey }: { scrollTopKey?: string | undefined }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<PlanToast | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [placeholder, setPlaceholder] = useState(false);
  const busy = useRef(false);
  // One op ID per choice, so a retried tap is the same Start again (rule 5).
  const startOp = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [data, reload] = useScreenData(async (s) => {
    // Review planview S5: a failed read is said, never shown as no plan.
    // (Ben, 26 Oct) A new block week takes its version first (idempotent), so the overview and Today agree.
    await s.plans.syncWeek().catch(() => false);
    const [planRead, previous, coach] = await Promise.all([
      s.plans.overview().then(
        (v) => ({ plan: v, planFailed: false }),
        () => ({ plan: null, planFailed: true }),
      ),
      s.plans.previous().catch(() => null),
      s.coach.availability().catch(() => null),
    ]);
    // (Plan builder, 23 Oct) `Set up a plan` opens the offline builder; the coach only if it were missing.
    return { ...planRead, previous, setup: planSetupRoute(coach, 'planBuilder' in s) };
  });

  useEffect(() => {
    if (scrollTopKey !== undefined) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [scrollTopKey]);
  useEffect(() => {
    const t = setTimeout(() => {
      setPlaceholder(true);
    }, TIMING.placeholderDelay);
    return () => {
      clearTimeout(t);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  /** `Set up a plan ›`: the one hook (`planSetupRoute`): the plan builder; the coach only as the fallback. */
  function setUpPlan(route: PlanSetupRoute) {
    if (route.kind === 'builder') navigation.dispatch(openPlanSetup());
    else if (route.kind === 'coach') navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true, draft: route.draft });
    else navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'CoachConnection', initial: false } });
  }

  async function startAgain(row: PreviousPlanRow, mode: PlanApplyMode) {
    if (busy.current) return;
    busy.current = true;
    startOp.current ??= newUuid();
    try {
      const r = await services.plans.startAgain({ planId: row.planId, expectedVersion: row.planVersion, mode, opId: startOp.current });
      setChoosing(null);
      startOp.current = null;
      changed();
      if (!r.ok) {
        setToast({ text: r.message });
        return;
      }
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      const made = r.plan;
      // One op ID per toast (review planview N1): a double tap on Undo is the same write, replayed.
      const undoOp = newUuid();
      setToast({
        text: PLAN_TAB_COPY.applied,
        action: PLAN_TAB_COPY.undo,
        onAction: () => {
          setToast(null);
          void services.plans.undo({ planId: made.id, expectedVersion: made.version, opId: undoOp }).then((u) => {
            changed();
            setToast({ text: u.ok ? PLAN_TAB_COPY.undone : u.message });
          });
        },
      });
    } finally {
      busy.current = false;
    }
  }

  const body = (() => {
    if (data.state === 'loading') {
      return placeholder ? (
        <View accessibilityElementsHidden style={{ gap: theme.space['3'] }}>
          {[0, 1].map((i) => (
            <View key={String(i)} style={{ height: 64, borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'] }} />
          ))}
        </View>
      ) : null;
    }
    if (data.state === 'error') return <StatusLine icon="exclamationmark.triangle" tone="warning" text={PLAN_TAB_COPY.loadFailed} action={<TextButton label={PLAN_TAB_COPY.tryAgain} onPress={reload} />} />;
    const { plan, planFailed, previous, setup } = data.value;
    return (
      <View style={{ gap: theme.space['5'] }}>
        {planFailed ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={PLAN_COPY.loadFailed} action={<TextButton label={PLAN_TAB_COPY.tryAgain} onPress={reload} />} /> : null}
        {plan !== null ? <YourPlanBlock plan={plan} onToast={setToast} /> : null}
        {plan === null && !planFailed ? (
          <SetUpRow
            route={setup}
            onPress={() => {
              setUpPlan(setup);
            }}
          />
        ) : null}
        {/* Review lift-targets S2: with no plan in use, the targets still have a home (nothing while the setting is off). */}
        {plan === null && !planFailed ? <LiftTargetsBlock onToast={setToast} /> : null}
        {previous === null ? (
          <StatusLine icon="exclamationmark.triangle" tone="warning" text={PLAN_TAB_COPY.loadFailed} action={<TextButton label={PLAN_TAB_COPY.tryAgain} onPress={reload} />} />
        ) : previous.length > 0 ? (
          <View>
            <View style={{ minHeight: 44, justifyContent: 'center' }} accessibilityRole="header">
              <Eyebrow>{PLAN_TAB_COPY.previous}</Eyebrow>
            </View>
            {previous.map((row, i) => (
              <PreviousRow
                key={row.planId}
                row={row}
                first={i === 0}
                choosing={choosing === row.planId}
                onStartAgain={() => {
                  startOp.current = null;
                  setChoosing(row.planId);
                }}
                onPick={(mode) => void startAgain(row, mode)}
                onCancel={() => {
                  startOp.current = null;
                  setChoosing(null);
                }}
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  })();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView ref={scrollRef} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom }}>
        {body}
      </ScrollView>
      <ToastHost bottom={toastBottom({ footerHeight: null, insetBottom: insets.bottom, space2: theme.space['2'], tab: true })}>
        {toast ? (
          <Toast
            icon="info.circle"
            text={toast.text}
            {...(toast.action ? { action: toast.action } : {})}
            {...(toast.onAction ? { onAction: toast.onAction } : {})}
            {...(toast.why !== undefined
              ? {
                  secondary: PLAN_OVERVIEW_COPY.why,
                  onSecondary: () => {
                    const { why, ...rest } = toast;
                    setToast({ ...rest, text: why ?? rest.text });
                  },
                }
              : {})}
          />
        ) : null}
      </ToastHost>
    </View>
  );
}

/** `Set up a plan ›` (≥ 52pt). When the coach can't answer, its state in one line under the title (rule 1). */
function SetUpRow({ route, onPress }: { route: PlanSetupRoute; onPress: () => void }) {
  const theme = useTheme();
  const state = route.kind === 'connect' ? route.state : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={state === null ? PLAN_TAB_COPY.setUp : `${PLAN_TAB_COPY.setUp}, ${state}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['3'], opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="headline">{PLAN_TAB_COPY.setUp}</AppText>
        {state !== null ? (
          <AppText variant="callout" color="text.secondary">
            {state}
          </AppText>
        ) : null}
      </View>
      <Icon name="chevron.right" color="text.tertiary" size={14} />
    </Pressable>
  );
}

/** A previous plan: name, `Push / Pull / Legs · ended 20 Sep`, `Start again`; then the Apply choice in place. */
function PreviousRow({ row, first, choosing, onStartAgain, onPick, onCancel }: { row: PreviousPlanRow; first: boolean; choosing: boolean; onStartAgain: () => void; onPick: (mode: PlanApplyMode) => void; onCancel: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['2'], paddingVertical: theme.space['2'], borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space['2'] }}>
        <View accessible accessibilityLabel={`${row.name}, ${row.line}`} style={{ flex: 1, minWidth: 160, gap: 2 }}>
          <AppText variant="headline">{row.name}</AppText>
          <AppText variant="callout" color="text.secondary" numeric>
            {row.line}
          </AppText>
        </View>
        {choosing ? null : <TextButton label={PLAN_TAB_COPY.startAgain} accessibilityLabel={`${PLAN_TAB_COPY.startAgain}, ${row.name}`} onPress={onStartAgain} />}
      </View>
      {choosing ? (
        <View style={{ gap: theme.space['2'] }}>
          <SecondaryButton
            label={CARD_COPY.replace}
            onPress={() => {
              onPick('replace');
            }}
          />
          <SecondaryButton
            label={CARD_COPY.add}
            onPress={() => {
              onPick('add');
            }}
          />
          <View style={{ alignItems: 'flex-end' }}>
            <TextButton label={CARD_COPY.cancel} tone="secondary" onPress={onCancel} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
