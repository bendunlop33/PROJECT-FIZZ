import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, AppState, KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDuration, formatElapsed, toIso, toMs, type CommandOutcome, type DraftEdits, type FocusView, type RestView } from '@fizz/domain';
import type { SessionCommand, SetSide, SetValues } from '@fizz/schemas';

import { getAlertPermission, requestAlertPermission, type AlertPermission } from '../../alerts/notifier';
import { restEndCueKey, setWorkoutOnScreen } from '../../alerts/presentation';
import { nowMs as clockNow } from '../../clock';
import { haptic } from '../../device/haptics';
import { newUuid } from '../../device/runtime';
import { formatDayMonth, formatTime } from '../../format/dates';
import { popToToday, replaceWithSummary } from '../../navigation/actions';
import type { RootStackParams, WorkoutToastParam } from '../../navigation/types';
import type { ActiveWorkoutData } from '../../services/workout-services';
import { firstTime, useDataChanged, useLaunchInfo, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import {
  ActionBar,
  AppText,
  Banner,
  Card,
  Chip,
  ChipRow,
  Icon,
  LinkLine,
  NumberAccessory,
  NumberStepper,
  SecondaryButton,
  StatusLine,
  TextButton,
  Toast,
  type SymbolName,
} from '../../ui';
import { createAfterDismiss } from '../../workout/after-dismiss';
import { shouldCueRestEnd } from '../../workout/cues';
import { startTimeBounds, stepTime } from '../../workout/finish';
import { FinishSheet } from './FinishSheet';
import { painClearConfirm } from '../../workout/pain-clear';

/**
 * Active workout: focused set card, rest, summary hand-off
 * (active-workout.md, rest-state.md, flow-first-milestone.md).
 *
 * Every value shown comes from `buildActiveSetView` (domain); this screen
 * only holds Ben's unsaved edits, the 1 s commit guard, and toasts. Every
 * write is one service command with an operation ID; the core never waits
 * on alerts, haptics or anything optional. Overview (`All`) and the custom
 * keypad are later items; the system number pad with a Done bar is used.
 */

interface ToastState {
  id: number;
  icon?: SymbolName;
  text: string;
  action?: string;
  onAction?: () => void;
}

const EFFORT_RPE = [6, 7, 8, 9, 10] as const;
const EFFORT_RIR = [4, 3, 2, 1, 0] as const;

export function WorkoutScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParams, 'Workout'>>();
  const launch = useLaunchInfo();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<ActiveWorkoutData | null | 'loading'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(clockNow);
  const [edits, setEdits] = useState<DraftEdits | null>(null);
  const [guard, setGuard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [banners, setBanners] = useState<{ key: string; severity: 'info' | 'warning'; text: string }[]>([]);
  const [finishOpen, setFinishOpen] = useState(false);
  const [timesOpen, setTimesOpen] = useState(false);
  const [restEditor, setRestEditor] = useState(false);
  const [hiddenWarmUps, setHiddenWarmUps] = useState<string[]>([]);
  const [permission, setPermission] = useState<AlertPermission | 'unknown'>('unknown');
  const [askLater, setAskLater] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  const played = useRef(new Set<string>());
  const [afterDismiss] = useState(() => createAfterDismiss());
  const tickedFor = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await services.workout.load();
      setData(d);
      setLoadError(null);
      return d;
    } catch (e) {
      // Never a blank screen you can't leave (review S2).
      setLoadError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [services]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      // While this screen is focused its own cue is the rest-end alert (review S1).
      setWorkoutOnScreen(true);
      return () => {
        setWorkoutOnScreen(false);
      };
    }, [reload]),
  );

  // The countdown is worked out from the stored deadline; this only re-renders (invariant 4).
  useEffect(() => {
    const t = setInterval(() => {
      setNow(clockNow());
    }, 1000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        setNow(clockNow());
        void reload();
      }
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [reload]);

  useEffect(() => {
    void getAlertPermission()
      .then(setPermission)
      .catch(() => {
        setPermission('unknown');
      });
  }, []);

  const showToast = useCallback((t: Omit<ToastState, 'id'>) => {
    setToast({ ...t, id: clockNow() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast((cur) => (cur?.id === toast.id ? null : cur));
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  // One-off launch notices (flow §4.2) and the toast handed over by the check-in.
  useEffect(() => {
    if (data === 'loading' || data === null) return;
    const rec = launch.recovery;
    const sid = data.aggregate.session.id;
    if (rec && rec.state.session.id === sid && rec.openInto === 'active_workout' && firstTime(`recovered:${sid}`)) {
      const list: { key: string; severity: 'info' | 'warning'; text: string }[] = [{ key: 'restored', severity: 'info', text: 'Workout restored. Nothing was lost.' }];
      for (const n of rec.notices) {
        if (n.kind === 'rest_ended_while_closed') list.push({ key: 'rest-ended', severity: 'info', text: `Rest ended at ${formatTime(toMs(n.endedAtUtc), data.aggregate.session.startedAt.tz)}` });
        if (n.kind === 'unsaved_edit_restored') setRestoredDraft(n.setId);
      }
      setBanners(list);
      setTimeout(() => {
        setBanners((b) => b.filter((x) => x.key !== 'restored'));
      }, 4000);
    }
    const handed = route.params?.toast;
    if (handed && firstTime(`toast:${sid}:${handed.kind}:${handed.text}`)) showHanded(handed);
  }, [data === 'loading' || data === null ? null : data.aggregate.session.id]);

  function showHanded(t: WorkoutToastParam) {
    switch (t.kind) {
      case 'check_in':
        showToast({
          text: `✓ ${t.text}`,
          action: 'Change',
          onAction: () => {
            navigation.navigate('CheckIn', { mode: 'edit', checkInId: t.checkInId });
          },
        });
        break;
      case 'pain':
        showToast({
          icon: 'exclamationmark.triangle',
          text: t.text,
          action: 'Undo',
          onAction: () => {
            void services.pain.clear(t.flagIds).then(() => {
              changed();
              void reload();
              showToast({ icon: 'info.circle', text: 'Pain flag removed' });
            });
          },
        });
        break;
      case 'info':
        showToast({ icon: 'info.circle', text: t.text });
        break;
    }
  }

  const view = useMemo(() => (data === 'loading' || data === null ? null : services.workout.view(data, now, edits)), [services, data, now, edits]);

  // Edits belong to one set; when the active set changes, they are dropped (they were saved as a draft).
  useEffect(() => {
    if (edits && view?.focus?.setId !== edits.setId) setEdits(null);
  }, [view?.focus?.setId, edits]);

  // Debounced draft save (300 ms): unsaved edits survive a force-close without counting as results.
  useEffect(() => {
    if (!edits || data === 'loading' || data === null) return;
    const sessionId = data.aggregate.session.id;
    const t = setTimeout(() => {
      void services.workout.dispatch(sessionId, { type: 'save_draft', at: services.now(), setId: edits.setId, values: edits.values });
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [edits, data, services]);

  // Rest end in the foreground: persist the expiry (tick), one haptic, never late (rest-state §4.7).
  useEffect(() => {
    if (data === 'loading' || data === null) return;
    const timer = data.aggregate.restTimer;
    if (timer?.status !== 'running' || data.aggregate.session.pause !== null) return;
    const deadline = toMs(timer.deadlineUtc);
    if (now < deadline) return;
    const key = `${timer.id}:${String(timer.version)}`;
    if (shouldCueRestEnd(key, deadline, now, played.current)) haptic('restEnd');
    played.current.add(key);
    if (tickedFor.current === key) return;
    tickedFor.current = key;
    void services.workout.dispatch(data.aggregate.session.id, { type: 'tick', at: services.now() }).then((r) => {
      if (r.ok) setData((d) => (d === 'loading' || d === null ? d : { ...d, aggregate: r.aggregate }));
    });
  }, [now, data, services]);

  if (loadError !== null && (data === 'loading' || data === null)) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: insets.top + theme.space['4'], paddingHorizontal: theme.space['4'], gap: theme.space['4'] }}>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open this workout." detail={`Nothing was changed. ${loadError}`} />
        <SecondaryButton label="Try again" onPress={() => void reload()} />
        <TextButton label="Go to Today" onPress={close} />
      </View>
    );
  }
  if (data === 'loading') return <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} />;
  if (data === null || view === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: insets.top + theme.space['4'], paddingHorizontal: theme.space['4'], gap: theme.space['4'] }}>
        <StatusLine icon="checkmark.circle.fill" tone="done" text="No workout in progress" detail="Saved on this phone" />
        <SecondaryButton label="Go to Today" onPress={close} />
      </View>
    );
  }
  const loaded = data;
  const session = loaded.aggregate.session;
  const tz = session.startedAt.tz;
  const focus = view.focus;

  function close() {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(popToToday());
  }

  /** Run one command; adopt the committed state; never throw. */
  async function run(command: SessionCommand): Promise<CommandOutcome> {
    const r = await services.workout.dispatch(session.id, command);
    if (r.ok) {
      setData({ ...loaded, aggregate: r.aggregate });
      changed();
    } else if (r.error.code === 'stale_version' || r.error.code === 'write_conflict') {
      // Review N8: reload so the next try uses the latest version.
      void reload();
    }
    return r;
  }

  function setValues(values: SetValues, side?: SetSide) {
    if (!focus) return;
    const base: DraftEdits = edits?.setId === focus.setId ? edits : { setId: focus.setId, values: focus.draft };
    const next: DraftEdits = { setId: focus.setId, values };
    const s = side ?? base.side;
    if (s !== undefined) next.side = s;
    setEdits(next);
    setRestoredDraft(null);
  }

  function editLoad(f: FocusView, v: number | null) {
    const unit = loaded.aggregate.exercises.find((e) => e.id === f.sessionExerciseId)?.unit ?? 'kg';
    const convention = loaded.aggregate.exercises.find((e) => e.id === f.sessionExerciseId)?.loadConvention ?? 'total';
    setValues({ ...f.draft, load: v === null ? null : { value: v, unit, convention } });
  }

  async function log() {
    if (!focus || guard || busy || focus.logLabel === null) return;
    setBusy(true);
    const cmd: SessionCommand = {
      type: 'log_set',
      at: services.now(),
      opId: focus.opId,
      setId: focus.setId,
      values: focus.logValues,
      restTimerId: newUuid(),
      ...(focus.logSide !== undefined ? { side: focus.logSide } : {}),
    };
    const r = await run(cmd);
    setBusy(false);
    if (!r.ok) {
      setBanners((b) => [...b.filter((x) => x.key !== 'write'), { key: 'write', severity: 'warning', text: r.error.code === 'write_failed' ? 'Couldn’t save this set. Your entry is still here.' : r.error.message }]);
      return;
    }
    haptic('commit');
    setEdits(null);
    setRestoredDraft(null);
    setBanners((b) => b.filter((x) => x.key !== 'write' && x.key !== 'rest-ended'));
    setGuard(true);
    setTimeout(() => {
      setGuard(false);
    }, TIMING.commitGuard);
    const saved = r.aggregate.sets.find((s) => s.id === focus.setId);
    const label = focus.logLabel.replace(/^Log /, '');
    showToast({
      text: `✓ Set ${String(focus.setNumber)} saved · ${label}`,
      action: 'Undo',
      onAction: () => {
        if (saved) void undo(saved.id, `undo:${saved.id}:${String(saved.undoCount)}`, focus.setNumber);
      },
    });
  }

  async function undo(setId: string, opId: string, setNumber: number) {
    const fresh = await services.workout.load(session.id);
    const set = fresh?.aggregate.sets.find((s) => s.id === setId);
    if (!fresh || !set) return;
    const r = await services.workout.dispatch(session.id, { type: 'undo_log', at: services.now(), opId, setId, expectedSetVersion: set.version });
    if (!r.ok) {
      showToast({ icon: 'info.circle', text: `Can’t undo: set ${String(setNumber)} changed. Tap it to edit or delete.` });
      return;
    }
    haptic('undo');
    setData({ ...fresh, aggregate: r.aggregate });
    changed();
    setToast(null);
  }

  function exerciseMenu(f: FocusView) {
    const options = ['Add set', 'Add exercise', 'Delete this set', 'Skip exercise', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: f.exerciseName, options, destructiveButtonIndex: [2, 3], cancelButtonIndex: 4 }, (i) => {
      if (i === 0) void addSet(f.sessionExerciseId);
      if (i === 1) navigation.navigate('ExercisePicker', { sessionId: session.id });
      if (i === 2) {
        Alert.alert(`Delete set ${String(f.setNumber)}?`, 'It’s removed from this workout. The edit log keeps a record.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void run({ type: 'delete_set', at: services.now(), opId: newUuid(), setId: f.setId, expectedSetVersion: f.setVersion }).then((r) => {
                if (r.ok) showToast({ icon: 'info.circle', text: `Set ${String(f.setNumber)} deleted` });
              });
            },
          },
        ]);
      }
      if (i === 3) {
        const pending = view?.exercises.find((e) => e.sessionExerciseId === f.sessionExerciseId)?.pendingSets ?? 0;
        Alert.alert(`Skip the ${String(pending)} remaining ${pending === 1 ? 'set' : 'sets'} of ${f.exerciseName}?`, 'Logged sets are kept.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Skip',
            style: 'destructive',
            onPress: () => {
              void run({ type: 'skip_exercise', at: services.now(), opId: newUuid(), sessionExerciseId: f.sessionExerciseId }).then((r) => {
                if (r.ok) showToast({ icon: 'info.circle', text: `${f.exerciseName} skipped` });
              });
            },
          },
        ]);
      }
    });
  }

  async function addSet(sessionExerciseId: string) {
    const r = await run({ type: 'add_set', at: services.now(), opId: newUuid(), sessionExerciseId, newSetId: newUuid(), setType: null });
    if (r.ok) {
      const n = r.aggregate.sets.filter((s) => s.sessionExerciseId === sessionExerciseId && s.status !== 'deleted').length;
      showToast({ text: `Set ${String(n)} added` });
    }
  }

  function topMenu() {
    const options = ['Finish workout', 'Edit workout times', 'Discard workout', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: 2, cancelButtonIndex: 3 }, (i) => {
      if (i === 0) setFinishOpen(true);
      if (i === 1) setTimesOpen(true);
      if (i === 2) confirmDiscard();
    });
  }

  function confirmDiscard() {
    const logged = view?.progress.done ?? 0;
    const go = () => {
      void run({ type: 'discard', at: services.now(), opId: newUuid(), expectedVersion: loaded.aggregate.session.version }).then((r) => {
        if (!r.ok) {
          showToast({ icon: 'info.circle', text: r.error.code === 'stale_version' ? 'The workout changed. Check it and try again.' : `Couldn’t discard: ${r.error.message}` });
          return;
        }
        setFinishOpen(false);
        navigation.dispatch(popToToday('Workout discarded'));
      });
    };
    // Nothing logged: discard at once (today.md §4: no Undo, nothing was logged).
    if (logged === 0) {
      go();
      return;
    }
    Alert.alert(`Discard ${view?.title ?? 'this workout'}?`, `${String(logged)} logged ${logged === 1 ? 'set' : 'sets'} will be discarded. This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: go },
    ]);
  }

  async function effort(value: number) {
    const js = view?.justSaved;
    if (!js) return;
    const scale = loaded.effortScale;
    const current = scale === 'rir' ? js.rir : js.rpe;
    const next = current === value ? null : value;
    // Changing effort never touches rest (invariant 5).
    const r = await run({ type: 'correct_set', at: services.now(), opId: newUuid(), setId: js.setId, expectedSetVersion: js.setVersion, patch: scale === 'rir' ? { rir: next } : { rpe: next } });
    if (!r.ok) showToast({ icon: 'info.circle', text: 'That set changed. Tap it to edit.' });
  }

  async function pauseOrResume() {
    const n = String(session.pauses.length);
    if (session.pause === null) await run({ type: 'pause', at: services.now(), opId: `pause:${session.id}:${n}` });
    else await run({ type: 'resume', at: services.now(), opId: `resume:${session.id}:${n}` });
  }

  const primary = (() => {
    switch (view.primary.kind) {
      case 'log':
        return { label: view.primary.label, onPress: () => void log(), busy };
      case 'disabled':
        return { label: view.primary.label, onPress: () => undefined, disabled: true };
      case 'resume':
        return { label: 'Resume', onPress: () => void pauseOrResume() };
      case 'add_exercise':
        return {
          label: 'Add exercise',
          onPress: () => {
            navigation.navigate('ExercisePicker', { sessionId: session.id });
          },
        };
      case 'finish':
        return {
          label: 'Finish workout',
          onPress: () => {
            setFinishOpen(true);
          },
        };
      case 'none':
        return { label: 'Done', onPress: close };
    }
  })();

  const rest = view.rest;
  const draftCaption = (() => {
    if (!focus) return null;
    if (focus.draftSource === 'draft' && restoredDraft === focus.setId) return 'Unsaved edit restored';
    if (focus.draftSource === 'this_session') return 'From your last set';
    if (focus.draftSource === 'last_session' && focus.previous) return `From ${formatDayMonth(toMs(focus.previous.performedAtUtc), tz)}`;
    if (focus.draftSource === 'copied' && focus.previous) return `Copied from ${formatDayMonth(toMs(focus.previous.performedAtUtc), tz)}`;
    return null;
  })();
  const showRestCard = rest !== null && (view.phase === 'resting' || view.phase === 'ready' || view.phase === 'paused');

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <NumberAccessory />
      {/* Top bar */}
      <View style={{ paddingTop: insets.top, backgroundColor: theme.colors['bg.surface'], borderBottomWidth: theme.dividerWidth, borderBottomColor: theme.colors['border.divider'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: theme.space['2'], gap: theme.space['1'] }}>
          <IconButton icon="chevron.down" label="Minimise workout" onPress={close} />
          <AppText variant="headline" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
            {view.title}
          </AppText>
          <View accessible accessibilityLabel={`${view.paused ? 'Paused, ' : ''}active time ${formatElapsed(view.elapsedMs)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
            {view.paused ? <Icon name="pause.circle.fill" color="status.warning" size={16} /> : null}
            <AppText variant="headline" numeric color={view.paused ? 'status.warning' : 'text.primary'}>
              {formatElapsed(view.elapsedMs)}
            </AppText>
            {view.paused ? (
              <AppText variant="label" color="status.warning">
                Paused
              </AppText>
            ) : null}
          </View>
          <IconButton icon={view.paused ? 'play.fill' : 'pause'} label={view.paused ? 'Resume workout' : 'Pause workout'} onPress={() => void pauseOrResume()} />
          <IconButton icon="ellipsis" label="Workout menu" onPress={topMenu} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['4'], paddingBottom: theme.space['2'] }}>
          <Icon name="building.2" size={16} />
          <AppText variant="label" color="text.secondary">
            {loaded.gymName ?? 'No gym'}
          </AppText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.space['4'], gap: theme.space['4'], paddingBottom: theme.space['8'] }} keyboardShouldPersistTaps="handled">
        {view.paused ? <Banner severity="warning" text="Workout paused. Timers are stopped." /> : null}
        {banners.map((b) => (
          <Banner key={b.key} severity={b.severity} text={b.text} />
        ))}

        {view.phase === 'empty' ? (
          <Card>
            <AppText variant="title2">Add an exercise to start</AppText>
            <AppText variant="callout" color="text.secondary">
              Pick from your exercises. Sets, rest and targets come from your history.
            </AppText>
          </Card>
        ) : null}

        {focus === null && view.phase !== 'empty' ? (
          <Card>
            <AppText variant="title2">All planned sets done.</AppText>
            <View style={{ flexDirection: 'row', gap: theme.space['4'], flexWrap: 'wrap' }}>
              {view.exercises.at(-1) ? <TextButton label="Add set" onPress={() => void addSet(view.exercises.at(-1)?.sessionExerciseId ?? '')} /> : null}
              <TextButton
                label="Add exercise"
                onPress={() => {
                  navigation.navigate('ExercisePicker', { sessionId: session.id });
                }}
              />
            </View>
          </Card>
        ) : null}

        {focus ? (
          <View style={{ gap: theme.space['3'] }}>
            {/* Exercise header */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['2'] }}>
              <View style={{ flex: 1, gap: theme.space['1'] }}>
                <AppText variant="title1" numberOfLines={2}>
                  {focus.exerciseName}
                </AppText>
                <AppText variant="callout" color="text.secondary" numeric>
                  {`${focus.headerLine}${showRestCard && view.phase === 'resting' ? ' next' : ''}`}
                </AppText>
              </View>
              <IconButton
                icon="ellipsis.circle"
                label={`${focus.exerciseName} menu`}
                onPress={() => {
                  exerciseMenu(focus);
                }}
              />
            </View>

            {showRestCard ? (
              <RestCard
                rest={rest}
                tz={tz}
                onAdjust={(deltaS) => {
                  if (rest.kind !== 'running') return;
                  void run({ type: 'adjust_rest', at: services.now(), opId: newUuid(), timerId: rest.timerId, deltaS }).then((r) => {
                    // −30 s to zero ends the rest here: play the rest-end cue once (review S6).
                    const key = r.ok ? restEndCueKey(r.events) : null;
                    if (key !== null && !played.current.has(key)) {
                      played.current.add(key);
                      haptic('restEnd');
                    }
                  });
                }}
                onSkip={() => {
                  if (rest.kind === 'running') void run({ type: 'skip_rest', at: services.now(), opId: `skip:${rest.timerId}:${String(rest.timerVersion)}`, timerId: rest.timerId });
                }}
              />
            ) : null}

            {view.justSaved && showRestCard ? (
              <View style={{ gap: theme.space['2'] }}>
                <StatusLine icon="checkmark.circle.fill" tone="done" text={`Set ${String(view.justSaved.setNumber)} saved${view.justSaved.side === 'left' ? ' (left)' : view.justSaved.side === 'right' ? ' (right)' : ''}: ${view.justSaved.text}`} />
                {loaded.effortScale !== 'off' ? (
                  <View style={{ gap: theme.space['1'] }}>
                    <AppText variant="label" color="text.secondary">
                      {loaded.effortScale === 'rir' ? 'Reps in reserve (optional)' : 'Effort (optional)'}
                    </AppText>
                    <ChipRow>
                      {(loaded.effortScale === 'rir' ? EFFORT_RIR : EFFORT_RPE).map((n) => (
                        <Chip
                          key={n}
                          label={loaded.effortScale === 'rir' && n === 4 ? '4+' : String(n)}
                          accessibilityLabel={loaded.effortScale === 'rir' ? `${String(n)} reps in reserve` : `RPE ${String(n)}`}
                          selected={(loaded.effortScale === 'rir' ? view.justSaved?.rir : view.justSaved?.rpe) === n}
                          onPress={() => void effort(n)}
                        />
                      ))}
                    </ChipRow>
                  </View>
                ) : null}
                {permission === 'undetermined' && !askLater ? (
                  <Card>
                    <AppText variant="body">Get an alert when rest ends while your phone is locked?</AppText>
                    <View style={{ flexDirection: 'row', gap: theme.space['8'] }}>
                      <TextButton
                        label="Not now"
                        tone="secondary"
                        onPress={() => {
                          setAskLater(true);
                        }}
                      />
                      <TextButton
                        label="Allow"
                        onPress={() => {
                          void requestAlertPermission().then((p) => {
                            setPermission(p);
                            // Schedule this rest's alert now that it's allowed.
                            void launch.restAlerts?.reconcile(loaded.aggregate, clockNow());
                          });
                        }}
                      />
                    </View>
                  </Card>
                ) : null}
                {view.phase === 'resting' ? (
                  <AppText variant="label" color="text.secondary">{`Up next · Set ${String(focus.setNumber)}`}</AppText>
                ) : null}
              </View>
            ) : null}

            {focus.warmUp && !hiddenWarmUps.includes(focus.sessionExerciseId) ? (
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
                  <Icon name="flame" size={16} />
                  <AppText variant="label" color="text.secondary" style={{ flex: 1 }}>
                    Warm-up suggestion (built-in, not logged)
                  </AppText>
                  <TextButton
                    label="Hide"
                    tone="secondary"
                    onPress={() => {
                      setHiddenWarmUps((h) => [...h, focus.sessionExerciseId]);
                    }}
                  />
                </View>
                <AppText variant="body" numeric>
                  {focus.warmUp}
                </AppText>
              </Card>
            ) : null}

            {focus.previous ? (
              <LinkLine
                accessibilityLabel={`Last time, ${formatDayMonth(toMs(focus.previous.performedAtUtc), tz)}: ${focus.previous.text}. Tap to copy.`}
                onPress={() => {
                  const prev = focus.previous;
                  if (!prev) return;
                  setEdits({ setId: focus.setId, values: { ...prev.values, rpe: null, rir: null }, copied: true, ...(edits?.side !== undefined ? { side: edits.side } : {}) });
                }}
              >
                <AppText variant="callout" color="text.secondary" numeric>{`Last (${formatDayMonth(toMs(focus.previous.performedAtUtc), tz)}): ${focus.previous.text}`}</AppText>
              </LinkLine>
            ) : (
              <AppText variant="callout" color="text.secondary">
                No previous result
              </AppText>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }}>
              {focus.loadField ? (
                <NumberStepper
                  label={focus.loadField.label}
                  unit={focus.loadField.unitText}
                  value={focus.loadField.value}
                  decimals
                  down={focus.loadField.down}
                  up={focus.loadField.up}
                  warning={focus.offProfileWarning !== null}
                  hint={focus.loadField.assisted ? 'More assistance is easier' : null}
                  onChange={(v) => {
                    editLoad(focus, v);
                  }}
                />
              ) : null}
              {focus.reps ? (
                <NumberStepper
                  label="Reps"
                  unit={null}
                  value={focus.reps.value}
                  decimals={false}
                  down={focus.reps.down}
                  up={focus.reps.up}
                  onChange={(v) => {
                    setValues({ ...focus.draft, reps: v === null ? null : Math.round(v) });
                  }}
                />
              ) : null}
            </View>
            {focus.plateLine ? (
              <AppText variant="callout" color="text.secondary" numeric accessibilityLabel={`Plates: ${focus.plateLine}`}>
                {focus.plateLine}
              </AppText>
            ) : null}
            {draftCaption ? (
              <AppText variant="callout" color="text.secondary">
                {draftCaption}
              </AppText>
            ) : null}
            <AppText variant="callout" color={focus.target ? 'text.primary' : 'text.secondary'} numeric>
              {focus.target ?? 'No target for this set'}
            </AppText>
            {focus.offProfileWarning ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={focus.offProfileWarning} /> : null}
            {focus.painFlagged ? (
              <StatusLine
                icon="exclamationmark.triangle"
                tone="warning"
                text="Pain flag: no increases"
                action={
                  <TextButton
                    label="Clear"
                    onPress={() => {
                      // Only Ben clears a flag (rule 9); targets already planned stay as they are.
                      Alert.alert(painClearConfirm(focus.exerciseName).title, painClearConfirm(focus.exerciseName).message, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Clear',
                          onPress: () => {
                            void services.pain
                              .active()
                              .then((flags) => services.pain.clear(flags.filter((f) => f.exerciseId === focus.exerciseId).map((f) => f.id)))
                              .then(() => {
                                changed();
                                void reload();
                              });
                          },
                        },
                      ]);
                    }}
                  />
                }
              />
            ) : null}

            {focus.side ? (
              focus.side.kind === 'fixed' ? (
                <AppText variant="callout">{`Side: ${focus.side.value === 'left' ? 'Left' : 'Right'} side`}</AppText>
              ) : (
                <View style={{ gap: theme.space['1'] }}>
                  <AppText variant="label" color="text.secondary">
                    Side
                  </AppText>
                  <ChipRow>
                    {(['both', 'left', 'right'] as const).map((s) => (
                      <Chip
                        key={s}
                        label={s === 'both' ? 'Both sides' : s === 'left' ? 'Left' : 'Right'}
                        selected={focus.side?.kind === 'choice' && focus.side.value === s}
                        onPress={() => {
                          setValues(focus.draft, s);
                        }}
                      />
                    ))}
                  </ChipRow>
                </View>
              )
            ) : null}

            <LinkLine
              accessibilityLabel={`Rest after this set: ${formatDuration(focus.restAfterS)}. Tap to change.`}
              onPress={() => {
                setRestEditor(true);
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], minHeight: 44 }}>
                <AppText variant="callout" color="text.secondary" numeric>{`Rest after: ${formatDuration(focus.restAfterS)}`}</AppText>
                <Icon name="chevron.right" size={14} color="text.tertiary" />
              </View>
            </LinkLine>

            <View style={{ gap: theme.space['1'] }}>
              {focus.rows.map((r) => (
                <SetRowLine
                  key={r.setId}
                  status={r.status}
                  number={r.number}
                  badges={r.badges}
                  text={r.text}
                  edited={r.edited}
                  onPress={() => {
                    if (r.status === 'done') navigation.navigate('EditSet', { sessionId: session.id, setId: r.setId });
                    if (r.status === 'pending') void run({ type: 'set_active_set', at: services.now(), opId: newUuid(), setId: r.setId, expectedVersion: session.version });
                  }}
                />
              ))}
            </View>

            {focus.next?.kind === 'exercise' ? (
              <View>
                <AppText variant="callout">{`Next exercise: ${focus.next.name}`}</AppText>
                {focus.next.target ? (
                  <AppText variant="callout" color="text.secondary" numeric>
                    {focus.next.target}
                  </AppText>
                ) : null}
              </View>
            ) : focus.next?.kind === 'last_set' ? (
              <AppText variant="callout" color="text.secondary">
                Last set of the workout
              </AppText>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {toast ? <Toast {...(toast.icon ? { icon: toast.icon } : {})} text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} /> : null}
      {/* No Talk button until voice exists (critic T3): no dead control in the best thumb spot. */}
      <ActionBar primary={primary} guard={guard} />

      <FinishSheet
        aggregate={loaded.aggregate}
        visible={finishOpen}
        onClose={() => {
          setFinishOpen(false);
        }}
        onFinished={(id) => {
          afterDismiss.arm(() => {
            navigation.dispatch(replaceWithSummary(id));
          });
          setFinishOpen(false);
          changed();
        }}
        onDismissed={afterDismiss.dismissed}
        onDiscard={() => {
          confirmDiscard();
        }}
        onStale={() => void reload()}
      />
      {focus ? (
        <RestAfterSheet
          visible={restEditor}
          setNumber={focus.setNumber}
          exerciseName={focus.exerciseName}
          seconds={focus.restAfterS}
          sourceLabel={focus.restSourceLabel}
          onClose={() => {
            setRestEditor(false);
          }}
          onApply={(seconds, scope) => {
            setRestEditor(false);
            void services.workout
              .setRestAfter({ sessionId: session.id, setId: focus.setId, seconds, scope, opId: newUuid(), expectedVersion: session.version })
              .then((r) => {
                if (!r.ok) {
                  showToast({ icon: 'info.circle', text: r.error.code === 'stale_version' ? 'The workout changed. Try again.' : `Rest wasn’t changed: ${r.error.message}` });
                  void reload();
                  return;
                }
                setData({ ...loaded, aggregate: r.aggregate });
                changed();
                showToast({
                  text:
                    scope === 'set'
                      ? `Rest after set ${String(focus.setNumber)}: ${formatDuration(seconds)}`
                      : `${focus.exerciseName}: ${formatDuration(seconds)} rest${r.defaultSaved === false ? '' : ', also next time'}`,
                });
              });
          }}
        />
      ) : null}
      <StartTimeSheet
        visible={timesOpen}
        data={loaded}
        onClose={() => {
          setTimesOpen(false);
        }}
        onSaved={(d) => {
          setData(d);
          changed();
          setTimesOpen(false);
          showToast({ text: 'Start time changed' });
        }}
      />
    </KeyboardAvoidingView>
  );
}

function IconButton({ icon, label, onPress }: { icon: SymbolName; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: theme.target.min.width, height: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name={icon} color="text.primary" size={22} />
    </Pressable>
  );
}

const STATUS_ICON: Record<'done' | 'active' | 'pending' | 'skipped', { icon: SymbolName; word: string }> = {
  done: { icon: 'checkmark.circle.fill', word: 'Done' },
  active: { icon: 'arrowtriangle.right.fill', word: 'Now' },
  pending: { icon: 'circle', word: 'Target' },
  skipped: { icon: 'slash.circle', word: 'Skipped' },
};

/** `SetRow` (design-system §7): icon + words per status, never colour alone. */
function SetRowLine({ status, number, badges, text, edited, onPress }: { status: 'done' | 'active' | 'pending' | 'skipped'; number: number; badges: string[]; text: string; edited: boolean; onPress: () => void }) {
  const theme = useTheme();
  const s = STATUS_ICON[status];
  const tappable = status === 'done' || status === 'pending';
  return (
    <Pressable
      accessibilityRole={tappable ? 'button' : 'text'}
      accessibilityLabel={`Set ${String(number)}${badges.length ? ` ${badges.join(' ')}` : ''}, ${s.word}, ${text}${edited ? ', edited' : ''}`}
      accessibilityHint={status === 'done' ? 'Edit or delete this set' : status === 'pending' ? 'Make this the current set' : undefined}
      disabled={!tappable}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
        paddingHorizontal: theme.space['3'],
        borderRadius: theme.radius.md,
        borderLeftWidth: status === 'active' ? 4 : 0,
        borderLeftColor: theme.colors.accent,
        backgroundColor: status === 'active' ? theme.colors['accent.subtle'] : pressed ? theme.colors['bg.raised'] : theme.colors['bg.surface'],
      })}
    >
      <Icon name={s.icon} color={status === 'done' ? 'status.done' : status === 'active' ? 'accent' : 'text.tertiary'} />
      <AppText variant="headline" numeric style={{ minWidth: 28 }}>{`${String(number)}${badges.length ? ` ${badges.join('')}` : ''}`}</AppText>
      <AppText variant="callout" numeric color={status === 'done' || status === 'active' ? 'text.primary' : 'text.secondary'} style={{ flex: 1 }}>
        {text}
      </AppText>
      {edited ? <Icon name="pencil" size={16} /> : null}
    </Pressable>
  );
}

/** `RestTimer`, full version (design-system §9.6): from the deadline, never a JS counter. */
function RestCard({ rest, tz, onAdjust, onSkip }: { rest: RestView; tz: string; onAdjust: (deltaS: number) => void; onSkip: () => void }) {
  const theme = useTheme();
  const frame = { backgroundColor: theme.colors['bg.surface'], borderWidth: 1, borderColor: theme.colors['border.control'], borderRadius: theme.radius.md, padding: theme.space['4'], gap: theme.space['3'] } as const;
  if (rest.kind === 'ended') {
    return (
      <View style={frame} accessibilityLiveRegion="polite">
        <StatusLine icon="checkmark.circle.fill" tone="done" text={rest.skipped ? 'Ready' : 'Ready when you are'} detail={rest.skipped ? null : `Rested ${formatDuration(rest.restedMs / 1000)}${rest.endedAtUtc ? ` · ended ${formatTime(toMs(rest.endedAtUtc), tz)}` : ''}`} />
      </View>
    );
  }
  const paused = rest.kind === 'paused';
  const button = (label: string, a11y: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: paused }}
      disabled={paused}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: theme.target.workout.height,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: theme.colors['border.control'],
        backgroundColor: pressed ? theme.colors['accent.subtle'] : theme.colors['bg.raised'],
        alignItems: 'center',
        justifyContent: 'center',
        opacity: paused ? 0.4 : 1,
      })}
    >
      <AppText variant="headline" numeric>
        {label}
      </AppText>
    </Pressable>
  );
  return (
    <View style={frame}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <Icon name={paused ? 'pause.circle.fill' : 'timer'} color={paused ? 'status.warning' : 'accent'} />
        <AppText variant="label" color={paused ? 'status.warning' : 'text.secondary'}>
          {paused ? 'Paused' : 'Rest'}
        </AppText>
        {rest.kind === 'running' ? (
          <AppText variant="label" color="text.secondary" numeric>{`· until ${formatTime(toMs(rest.deadlineUtc), tz)}`}</AppText>
        ) : null}
      </View>
      <AppText variant="timerDisplay" align="center" accessibilityLabel={`Rest, ${formatDuration(rest.remainingMs / 1000)} left`}>
        {formatDuration(Math.ceil(rest.remainingMs / 1000))}
      </AppText>
      <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
        {button('−30 s', 'Rest 30 seconds shorter', () => {
          haptic('step');
          onAdjust(-30);
        })}
        {button('+30 s', 'Rest 30 seconds longer', () => {
          haptic('step');
          onAdjust(30);
        })}
        {button('Skip', 'Skip rest', onSkip)}
      </View>
    </View>
  );
}

const REST_CHOICES = [60, 90, 120, 150, 180, 240];

/**
 * `Rest after` editor (rest-state §2.4) for a set not done yet: this set
 * only, or every remaining set of the exercise and its default next time.
 * The rest that's running now is never changed (use −30 s / +30 s for that).
 */
function RestAfterSheet({
  visible,
  setNumber,
  exerciseName,
  seconds,
  sourceLabel,
  onClose,
  onApply,
}: {
  visible: boolean;
  setNumber: number;
  exerciseName: string;
  seconds: number;
  sourceLabel: string;
  onClose: () => void;
  onApply: (seconds: number, scope: 'set' | 'exercise') => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(seconds);
  const [shown, setShown] = useState(false);
  if (visible !== shown) {
    setShown(visible);
    if (visible) setValue(seconds);
  }
  const step = (d: number) => {
    haptic('step');
    setValue((v) => Math.max(0, Math.min(3600, v + d)));
  };
  return (
    <ModalSheet visible={visible} onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: theme.space['4'], paddingBottom: theme.space['4'] + insets.bottom, gap: theme.space['4'] }}>
        <AppText variant="title2" accessibilityRole="header">{`Rest after set ${String(setNumber)}`}</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space['4'] }}>
          <SecondaryButton label="−15 s" onPress={() => { step(-15); }} />
          <AppText variant="timerDisplay" accessibilityLabel={`Rest ${formatDuration(value)}`}>
            {formatDuration(value)}
          </AppText>
          <SecondaryButton label="+15 s" onPress={() => { step(15); }} />
        </View>
        <ChipRow>
          {REST_CHOICES.map((c) => (
            <Chip key={c} label={formatDuration(c)} selected={value === c} onPress={() => { setValue(c); }} />
          ))}
        </ChipRow>
        <AppText variant="callout" color="text.secondary">{`From: ${sourceLabel}`}</AppText>
        <AppText variant="callout" color="text.secondary">
          A rest that’s running now isn’t changed.
        </AppText>
        <SecondaryButton label="This set only" onPress={() => { onApply(value, 'set'); }} />
        <SecondaryButton label={`All ${exerciseName} sets, and next time`} onPress={() => { onApply(value, 'exercise'); }} />
        <TextButton label="Cancel" tone="secondary" onPress={onClose} />
      </ScrollView>
    </ModalSheet>
  );
}

/** `Edit workout times` before Finish: start only (active-workout §4.6). */
function StartTimeSheet({ visible, data, onClose, onSaved }: { visible: boolean; data: ActiveWorkoutData; onClose: () => void; onSaved: (d: ActiveWorkoutData) => void }) {
  const theme = useTheme();
  const services = useServices();
  const insets = useSafeAreaInsets();
  const tz = data.aggregate.session.startedAt.tz;
  const [startMs, setStartMs] = useState(toMs(data.aggregate.session.startedAt.utc));
  const [opId, setOpId] = useState(newUuid);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setStartMs(toMs(data.aggregate.session.startedAt.utc));
    setOpId(newUuid());
    setError(null);
  }, [visible, data]);
  const bounds = startTimeBounds(data.aggregate, clockNow());
  const step = (m: number) => {
    setStartMs((v) => stepTime(v, m, bounds.minMs, bounds.maxMs));
  };
  async function save() {
    const r = await services.workout.dispatch(data.aggregate.session.id, {
      type: 'update_session_timing',
      at: services.now(),
      opId,
      expectedVersion: data.aggregate.session.version,
      startedAt: { utc: toIso(startMs), tz },
      endedAt: null,
    });
    if (!r.ok) {
      setError(r.error.code === 'stale_version' ? 'The workout changed. Close and try again.' : r.error.message);
      return;
    }
    onSaved({ ...data, aggregate: r.aggregate });
  }
  return (
    <ModalSheet visible={visible} onClose={onClose}>
      <View style={{ padding: theme.space['4'], paddingBottom: theme.space['4'] + insets.bottom, gap: theme.space['4'] }}>
        <AppText variant="title2" accessibilityRole="header">
          Edit workout times
        </AppText>
        <AppText variant="label" color="text.secondary">
          Started at
        </AppText>
        <AppText variant="title2" numeric>
          {formatTime(startMs, tz)}
        </AppText>
        <ChipRow>
          {[-15, -5, -1, 1, 5].map((m) => (
            <Chip key={m} label={`${m < 0 ? '−' : '+'}${String(Math.abs(m))} min`} selected={false} onPress={() => { step(m); }} />
          ))}
        </ChipRow>
        <AppText variant="callout" color="text.secondary">
          The start can’t move after the first logged set or into the future. The end time can be changed after Finish.
        </AppText>
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        <SecondaryButton label="Save" onPress={() => void save()} />
        <TextButton label="Cancel" tone="secondary" onPress={onClose} />
      </View>
    </ModalSheet>
  );
}

function ModalSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }}>{children}</View>
    </Modal>
  );
}
