import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, LayoutAnimation, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { asksReasons, DEFAULT_CHECK_IN_SETTINGS, overviewDoneBy, statStripSpoken, type TargetExplanation } from '@fizz/domain';
import type { CheckIn, CheckInScore } from '@fizz/schemas';

import { useStartAlertsAsk } from '../../alerts/AlertsAskSheet';
import { nowMs as clockNow } from '../../clock';
import { haptic } from '../../device/haptics';
import { newUuid } from '../../device/runtime';
import { formatShortDate } from '../../format/dates';
import { bundledHowToSources, howToRouteFor } from '../../guide/how-to';
import { openStartedWorkout, popToTabs, popToToday } from '../../navigation/actions';
import type { RootStackParams } from '../../navigation/types';
import type { OverviewData } from '../../services/workout-services';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, BottomCard, CheckInScale, Icon, OverviewRow, PrimaryButton, StatStrip, SupersetBracket, TextButton, Toast } from '../../ui';
import { createAfterDismiss } from '../../workout/after-dismiss';
import {
  checkInRow,
  eyebrowText,
  gymToastText,
  OVERVIEW_COPY,
  overviewLayout,
  panelReducer,
  rowDetail,
  startCheckIn,
  startFailure,
  targetsChanged,
} from '../../workout/overview';
import { NameSheet } from '../routines/NameSheet';
import { TargetWhyPanel } from './TargetWhyPanel';

/**
 * The Workout overview (workout-overview.md): what, where, how long and what
 * Ben will lift, before anything is created. One primary action, `Start
 * workout`. Opening it makes no AI call, needs no network and writes nothing;
 * the rows come from the same dry run Start uses (`services.overview.load`).
 * This screen formats and lays out only: every number comes from the domain.
 * The coach is hidden until coach v1 merges (§5): nothing coach-related renders.
 */

type Toasting = { text: string; action?: string; onAction?: () => void } | null;

const FADE_STEPS = 7;

export function WorkoutOverviewScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const { stacked } = overviewLayout(fontScale);
  const { target } = useRoute<RouteProp<RootStackParams, 'WorkoutOverview'>>().params;
  const alertsAsk = useStartAlertsAsk();

  // A score tapped on this page (saved at once, CI4); null until then.
  const [tapped, setTapped] = useState<CheckIn | null>(null);
  const tappedRef = useRef<CheckIn | null>(null);
  tappedRef.current = tapped;
  const [checkInId] = useState(newUuid);
  const [checkInOp] = useState(newUuid);
  // One opId from the first Start tap until success or the page closes: a double tap or a retry starts one workout (OV5).
  const startOp = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toasting>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(clockNow);
  const [placeholder, setPlaceholder] = useState(false);
  const [why, setWhy] = useState<{ name: string; explanation: TargetExplanation | null } | null>(null);
  const [whyVisible, setWhyVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameOp, setRenameOp] = useState(newUuid);
  const [renameAfter] = useState(() => createAfterDismiss());
  // After a gym switch: the rows before, to count what changed once the page reloads (OV12).
  const gymSwitch = useRef<{ name: string; before: OverviewData['view']['rows']; previousGymId: string | null } | null>(null);

  const [data, reload] = useScreenData(async (s) => {
    const gym = await s.yourData.currentGym();
    const page = await s.overview.load({ target, gymId: gym?.id ?? null, checkInId: tappedRef.current?.id ?? null });
    return page;
  });
  const page = data.state === 'ready' ? data.value : null;

  // `DONE BY` moves at most once a minute (timing.timeLeftRefresh, OV16).
  useEffect(() => {
    const t = setInterval(() => {
      setNow(clockNow());
    }, 60_000);
    return () => {
      clearInterval(t);
    };
  }, []);
  // Loading: nothing for 300 ms, then static blocks (no shimmer).
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
  // The check-in changed behind the page (What's up? saved reasons): keep the latest version for the next score change.
  useEffect(() => {
    const latest = page?.planCheckIn;
    if (latest && tappedRef.current?.id === latest.id && tappedRef.current.version !== latest.version) {
      tappedRef.current = latest;
      setTapped(latest);
    }
  }, [page]);
  // A reload keeps the open panel only if its row is still there.
  useEffect(() => {
    if (page) setOpen((o) => panelReducer(o, { kind: 'rows', rowIds: page.view.rows.map((r) => r.exerciseId) }));
  }, [page]);
  // The gym toast, once the page has re-read at the new gym.
  useEffect(() => {
    const sw = gymSwitch.current;
    if (!page || !sw || page.view.gym?.name !== sw.name) return;
    gymSwitch.current = null;
    const previous = sw.previousGymId;
    setToast({
      text: gymToastText(sw.name, targetsChanged(sw.before, page.view.rows)),
      ...(previous
        ? {
            action: 'Undo',
            onAction: () => {
              setToast(null);
              void services.gyms.select(previous).then(() => {
                changed();
              });
            },
          }
        : {}),
    });
  }, [page, services, changed]);

  const close = () => {
    navigation.goBack();
  };

  const row = page ? checkInRow(page.checkIn, tapped) : null;

  async function pickScore(n: CheckInScore) {
    if (!page || busy) return;
    haptic('step');
    const current = row?.record ?? null;
    let saved: CheckIn | null = current;
    if (current === null) {
      const r = await services.checkIns.record({ checkInId, opId: checkInOp, score: n });
      saved = r.ok ? r.checkIn : null;
    } else if (current.score !== n) {
      const r = await services.checkIns.update(current.id, { score: n }, current.version, newUuid());
      if (!r.ok) {
        // Changed elsewhere: show the latest rather than guess (rule 5).
        reload();
        return;
      }
      saved = r.checkIn;
    }
    if (saved === null) return;
    setTapped(saved);
    tappedRef.current = saved;
    changed();
    // At or below the What's up? setting: check-in Step 2 over this page; every exit comes back here.
    if (asksReasons(n, DEFAULT_CHECK_IN_SETTINGS)) navigation.navigate('CheckIn', { mode: 'overview', checkInId: saved.id });
  }

  async function start() {
    if (!page || busy) return;
    setBusy(true);
    setStartError(null);
    try {
      // First Start ever: the one-time Rest alerts question; either answer continues the same Start.
      await alertsAsk.ensureAsked();
      startOp.current ??= newUuid();
      const r = await services.overview.start({
        startOf: page.startOf,
        gymId: page.view.gym?.id ?? null,
        opId: startOp.current,
        checkIn: startCheckIn(page.checkIn, checkInRow(page.checkIn, tappedRef.current), services.now().utc),
        expectedPreviewKey: page.view.previewKey,
      });
      if (r.ok) {
        changed();
        navigation.dispatch(openStartedWorkout(r.notice ? { toast: { kind: 'info', text: r.notice } } : undefined));
        return;
      }
      const failure = startFailure(r.error.code);
      if (failure.kind === 'stale') {
        // Nothing was created; the rows re-render with what Start would make now (rule 5).
        setToast({ text: OVERVIEW_COPY.stale });
        reload();
      } else if (failure.kind === 'active') {
        changed();
        navigation.dispatch(popToToday());
      } else setStartError(OVERVIEW_COPY.startFailed);
    } catch {
      setStartError(OVERVIEW_COPY.startFailed);
    } finally {
      setBusy(false);
    }
  }

  function chooseGym() {
    if (!page) return;
    if (page.gyms.length === 0) {
      navigation.navigate('AddGym');
      return;
    }
    const names = page.gyms.map((g) => (g.id === page.view.gym?.id ? `${g.name} ✓` : g.name));
    ActionSheetIOS.showActionSheetWithOptions({ options: [...names, OVERVIEW_COPY.addGym, 'Cancel'], cancelButtonIndex: names.length + 1 }, (i) => {
      if (i === names.length) {
        navigation.navigate('AddGym');
        return;
      }
      const chosen = page.gyms[i];
      if (!chosen || chosen.id === page.view.gym?.id) return;
      gymSwitch.current = { name: chosen.name, before: page.view.rows, previousGymId: page.view.gym?.id ?? null };
      void services.gyms.select(chosen.id).then((r) => {
        if (!r.ok) {
          gymSwitch.current = null;
          setToast({ text: r.message });
        }
        changed();
      });
    });
  }

  async function startEmpty() {
    if (!page) return;
    let gymId: string | null = page.view.gym?.id ?? null;
    if (gymId === null) {
      const made = await services.setup.useTypicalGym();
      gymId = made.ok ? (made.gymId ?? null) : null;
    }
    if (gymId === null) {
      setStartError(OVERVIEW_COPY.startFailed);
      return;
    }
    await alertsAsk.ensureAsked();
    const gate = await services.checkIns.gate();
    if (gate.kind === 'ask') {
      navigation.navigate('CheckIn', { mode: 'start', gymId });
      return;
    }
    const checkIn = gate.kind === 'reuse' ? ({ kind: 'answered', checkInId: gate.checkInId } as const) : gate.reason === 'off' || gate.reason === 'not_a_check_in_day' ? ({ kind: 'not_asked', reason: gate.reason } as const) : null;
    const r = await services.workout.start({ gymId, opId: newUuid(), checkIn });
    if (!r.ok) {
      if (r.error.code === 'session_already_active') navigation.dispatch(popToToday());
      else setStartError(OVERVIEW_COPY.startFailed);
      return;
    }
    changed();
    navigation.dispatch(openStartedWorkout());
  }

  function deleteRoutine() {
    const routine = page?.routine;
    if (!routine) return;
    Alert.alert(`Delete ${routine.name}?`, 'Past workouts keep their name.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void services.routines.remove({ routineId: routine.id, expectedVersion: routine.version, opId: newUuid() }).then((r) => {
            if (!r.ok) {
              setToast({ text: r.message });
              reload();
              return;
            }
            changed();
            navigation.dispatch(popToTabs({ screen: 'Today', params: { toast: `Deleted ${r.routine.name}`, undoRoutine: { id: r.routine.id, version: r.routine.version } } }));
          });
        },
      },
    ]);
  }

  function menu() {
    const routine = page?.routine ?? null;
    const options = [OVERVIEW_COPY.otherRoutine, OVERVIEW_COPY.emptyWorkout, ...(routine ? [OVERVIEW_COPY.rename, OVERVIEW_COPY.delete] : []), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1, ...(routine ? { destructiveButtonIndex: 3 } : {}) }, (i) => {
      const picked = options[i];
      // `Other routine`: Today lists the routines (the Plan hub comes later).
      if (picked === OVERVIEW_COPY.otherRoutine) close();
      if (picked === OVERVIEW_COPY.emptyWorkout) void startEmpty();
      if (picked === OVERVIEW_COPY.rename) {
        setRenameOp(newUuid());
        setRenameVisible(true);
      }
      if (picked === OVERVIEW_COPY.delete) deleteRoutine();
    });
  }

  async function showWhy(sessionExerciseId: string, name: string) {
    const explanation = await services.overview.explain({ target, gymId: page?.view.gym?.id ?? null, checkInId: tappedRef.current?.id ?? null, sessionExerciseId }).catch(() => null);
    setWhy({ name, explanation });
    setWhyVisible(true);
  }

  function toggle(rowId: string) {
    // The panel opens in place; with Reduce Motion it appears without the height animation (§8).
    if (!theme.a11y.reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(theme.timing.fast, 'easeOut', 'opacity'));
    setOpen((o) => panelReducer(o, { kind: 'toggle', rowId }));
  }

  const topBar = (
    <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: theme.space['2'], paddingRight: theme.space['3'] }}>
      <Pressable accessibilityRole="button" accessibilityLabel={OVERVIEW_COPY.close} onPress={close} hitSlop={4} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="chevron.down" color="text.primary" size={20} weight="semibold" />
      </Pressable>
      {page ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={page.view.gym ? `Gym: ${page.view.gym.name}. Change gym.` : OVERVIEW_COPY.addGym}
            onPress={chooseGym}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <View style={{ height: 34, paddingHorizontal: 14, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.control'], flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AppText variant="label">{page.view.gym?.name ?? OVERVIEW_COPY.addGym}</AppText>
              {page.view.gym ? <Icon name="chevron.down" color="text.secondary" size={10} /> : null}
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={menu} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="ellipsis" color="text.primary" size={20} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const shell = (body: React.ReactNode, bar: React.ReactNode = null) => (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: insets.top }} accessibilityViewIsModal onAccessibilityEscape={close}>
      {topBar}
      {body}
      {bar}
      {alertsAsk.sheet}
    </View>
  );

  if (data.state === 'loading') {
    return shell(
      placeholder ? (
        <View style={{ paddingHorizontal: theme.components.screenMargin, gap: theme.space['4'], paddingTop: theme.space['3'] }} accessibilityElementsHidden>
          {[120, 220, 64, 64, 64, 64].map((h, i) => (
            <View key={String(i)} style={{ height: h === 120 ? 16 : h === 220 ? 46 : h, width: h === 120 ? 160 : '100%', borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'] }} />
          ))}
        </View>
      ) : null,
    );
  }

  if (!page) {
    return shell(
      <View style={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['6'], gap: theme.space['3'] }}>
        <AppText variant="title2" accessibilityRole="header">
          {OVERVIEW_COPY.loadFailed}
        </AppText>
        <View style={{ flexDirection: 'row', columnGap: theme.space['5'], flexWrap: 'wrap' }}>
          <TextButton label={OVERVIEW_COPY.tryAgain} onPress={reload} />
          <TextButton label={OVERVIEW_COPY.emptyWorkout} tone="secondary" onPress={() => void startEmpty()} />
        </View>
      </View>,
    );
  }

  const { view } = page;
  const done = view.estimate === null ? null : overviewDoneBy(now, view.estimate.seconds, services.now().tz);
  const stats = [
    ...(view.estimate !== null && done !== null
      ? [
          { value: String(view.estimate.minutes), approx: true, suffix: 'min', label: OVERVIEW_COPY.time },
          { value: done.text, approx: true, label: OVERVIEW_COPY.doneBy },
        ]
      : []),
    { value: String(view.workingSets), label: OVERVIEW_COPY.sets },
  ];
  const lastRowId = view.rows.at(-1)?.exerciseId;

  const renderRow = (r: (typeof view.rows)[number], firstInGroup: boolean) => {
    const howTo = howToRouteFor({ exerciseId: r.exerciseId, exerciseName: r.name }, bundledHowToSources());
    const flagId = r.painFlag?.id;
    const gymId = view.gym?.id;
    return (
      <OverviewRow
        key={r.exerciseId}
        row={r}
        detail={rowDetail(r, stacked)}
        open={open === r.exerciseId}
        stacked={stacked}
        first={firstInGroup}
        last={r.exerciseId === lastRowId}
        onToggle={() => {
          toggle(r.exerciseId);
        }}
        onWhy={() => void showWhy(r.sessionExerciseId, r.name)}
        onHowTo={
          howTo
            ? () => {
                navigation.navigate('HowTo', howTo);
              }
            : undefined
        }
        onStillHurts={
          flagId
            ? () => {
                navigation.navigate('PainFlag', { flagId });
              }
            : undefined
        }
        onEditGym={
          r.missingEquipment !== null && gymId
            ? () => {
                navigation.dispatch(popToTabs({ screen: 'Profile', params: { screen: 'GymDetail', params: { gymId }, initial: false } }));
              }
            : undefined
        }
      />
    );
  };

  const body = (
    <ScrollView contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingBottom: theme.space['8'] }}>
      <AppText variant="sectionLabel" color="text.tertiary" style={{ marginTop: 10 }}>
        {eyebrowText(view.basis, (ms, tz) => formatShortDate(ms, tz))}
      </AppText>
      <AppText variant="title1" accessibilityRole="header" style={{ fontSize: 40, lineHeight: 46, letterSpacing: -0.8, marginTop: 6 }}>
        {view.title}
      </AppText>
      <View style={{ marginTop: theme.space['4'] }}>
        <StatStrip items={stats} stacked={stacked} accessibilityLabel={statStripSpoken(view.estimate?.minutes ?? null, done?.text ?? null, view.workingSets)} />
      </View>
      {view.gym === null ? (
        <View accessible accessibilityLabel={OVERVIEW_COPY.noGym} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], marginTop: theme.space['3'] }}>
          <Icon name="exclamationmark.triangle" color="status.warning" size={14} />
          <AppText variant="callout" color="text.secondary">
            {OVERVIEW_COPY.noGym}
          </AppText>
        </View>
      ) : null}
      {view.muscles.length > 0 ? (
        <AppText variant="callout" color="text.secondary" style={{ marginTop: theme.space['3'] }}>
          <AppText variant="callout" style={{ fontWeight: '500' }}>
            {view.muscles[0]}
          </AppText>
          {view.muscles.slice(1).map((m) => ` · ${m}`).join('')}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, paddingBottom: theme.space['2'] }}>
        <AppText variant="sectionLabel" color="text.tertiary">{`${String(view.exerciseCount)} ${view.exerciseCount === 1 ? 'exercise' : 'exercises'}`}</AppText>
        <AppText variant="sectionLabel" color="text.tertiary">
          {OVERVIEW_COPY.target}
        </AppText>
      </View>
      {view.groups.map((g) =>
        g.kind === 'single' ? (
          renderRow(g.row, false)
        ) : (
          <SupersetBracket key={g.rows.map((r) => r.exerciseId).join('+')}>{g.rows.map((r, i) => renderRow(r, i === 0))}</SupersetBracket>
        ),
      )}
    </ScrollView>
  );

  const bar = (
    <View style={{ paddingHorizontal: theme.components.screenMargin, paddingBottom: insets.bottom + theme.space['2'], backgroundColor: theme.colors['bg.canvas'] }}>
      {/* A 14 pt fade over the list; no rule above the bar. */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, right: 0, top: -14, height: 14 }}>
        {Array.from({ length: FADE_STEPS }, (_, i) => (
          <View key={String(i)} style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], opacity: (i + 1) / (FADE_STEPS + 1) }} />
        ))}
      </View>
      {toast ? (
        <View style={{ marginHorizontal: -theme.space['4'] }}>
          <Toast icon="info.circle" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} />
        </View>
      ) : null}
      {row?.shown ? (
        stacked ? (
          <View style={{ paddingTop: theme.space['2'] }}>
            <TextButton
              label={row.selected === null ? `${OVERVIEW_COPY.checkIn} ›` : `${OVERVIEW_COPY.checkIn} · ${String(row.selected)} ›`}
              onPress={() => {
                navigation.navigate('CheckIn', { mode: 'overview', checkInId: row.record?.id ?? null, atScore: true });
              }}
            />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: theme.space['2'] }}>
            <AppText variant="sectionLabel" color="text.tertiary">
              {OVERVIEW_COPY.checkIn}
            </AppText>
            <CheckInScale selected={row.selected} disabled={busy} onPick={(n) => void pickScore(n)} />
          </View>
        )
      ) : null}
      {startError ? (
        <View accessible accessibilityLabel={startError} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], marginTop: theme.space['3'] }}>
          <Icon name="exclamationmark.triangle" color="status.warning" size={16} />
          <AppText variant="callout">{startError}</AppText>
        </View>
      ) : null}
      {/* ≥ 20 pt between the tiles and Start (OV13); Start is the only filled pill. */}
      <View style={{ marginTop: row?.shown ? theme.space['5'] : theme.space['3'] }}>
        <PrimaryButton label={OVERVIEW_COPY.start} busy={busy} onPress={() => void start()} />
      </View>
    </View>
  );

  return (
    <>
      {shell(<View style={{ flex: 1 }}>{body}</View>, bar)}
      <BottomCard
        visible={whyVisible}
        onClose={() => {
          setWhyVisible(false);
        }}
      >
        <AppText variant="title2" accessibilityRole="header">
          {why?.name ?? ''}
        </AppText>
        {why ? <TargetWhyPanel panel={why.explanation ? { setId: why.explanation.setId, status: 'ready', explanation: why.explanation } : { setId: '', status: 'failed' }} /> : null}
      </BottomCard>
      {page.routine ? (
        <NameSheet
          visible={renameVisible}
          title="Rename routine"
          buttonLabel="Save name"
          initialName={page.routine.name}
          check={(n) => services.routines.checkName(n, page.routine?.id ?? null)}
          onSubmit={async (n) => {
            const routine = page.routine;
            if (!routine) return null;
            const r = await services.routines.rename({ routineId: routine.id, name: n, expectedVersion: routine.version, opId: renameOp });
            if (!r.ok) {
              if (r.stale) reload();
              return r.message;
            }
            const before = routine.name;
            const saved = r.routine;
            renameAfter.arm(() => {
              setToast({
                text: `Renamed to ${saved.name}`,
                action: 'Undo',
                onAction: () => {
                  setToast(null);
                  void services.routines.rename({ routineId: saved.id, name: before, expectedVersion: saved.version, opId: newUuid() }).then(() => {
                    changed();
                  });
                },
              });
            });
            setRenameVisible(false);
            changed();
            return null;
          }}
          onClose={() => {
            setRenameVisible(false);
          }}
          onDismissed={renameAfter.dismissed}
        />
      ) : null}
    </>
  );
}
