import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, AppState, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, View, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { checkRoutineName, discardCommand, discardConfirmation, formatDuration, formatElapsed, toIso, toMs, type CommandOutcome, type DraftEdits, type FocusView, type RestView } from '@fizz/domain';
import type { SessionCommand, SetSide, SetValues } from '@fizz/schemas';

import { alertsOff, alertsOffAction, alertsOffLabel } from '../../alerts/ask';
import { getAlertPermission, requestAlertPermission, type AlertPermission } from '../../alerts/notifier';
import { restEndCueKey, setWorkoutOnScreen } from '../../alerts/presentation';
import { nowMs as clockNow } from '../../clock';
import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { haptic } from '../../device/haptics';
import { newUuid } from '../../device/runtime';
import { formatDayMonth, formatTime } from '../../format/dates';
import { bundledHowToSources, howToRouteFor } from '../../guide/how-to';
import { popToToday, replaceWithSummary } from '../../navigation/actions';
import type { RootStackParams, WorkoutToastParam } from '../../navigation/types';
import type { ActiveWorkoutData, RecordContext } from '../../services/workout-services';
import { NameSheet } from '../routines/NameSheet';
import { firstTime, useDataChanged, useLaunchInfo, useServices } from '../../shell/context';
import { logHaptic, swapMotion, TIMING, useTheme } from '../../theme';
import {
  ActionBar,
  AppText,
  Banner,
  Chip,
  ChipRow,
  Eyebrow,
  HeroHeader,
  Icon,
  LinkLine,
  NumberAccessory,
  NumberStepper,
  PulseOnce,
  RuledSection,
  SecondaryButton,
  FadeIn,
  StatusLine,
  TEXT_PRESSED_OPACITY,
  TextButton,
  TimerNumeral,
  Toast,
  type SymbolName,
} from '../../ui';
import { CoachSlot } from './CoachSlot';
import { AdjustButton, AdjustRow, CoachSlotContent, useWorkoutCoach } from './WorkoutCoach';
import { createAfterDismiss } from '../../workout/after-dismiss';
import { exerciseMenu } from '../../workout/exercise-menu';
import { shouldCueRestEnd } from '../../workout/cues';
import { startTimeBounds, stepTime } from '../../workout/finish';
import { FinishSheet } from './FinishSheet';
import { painClearConfirm } from '../../workout/pain-clear';
import { editorSlot, enterAction, readyHoldUntil, type EntryField } from '../../workout/rest-fold';

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
  const [renameOpen, setRenameOpen] = useState(false);
  const renameOp = useRef(newUuid());
  const [renameAfter] = useState(() => createAfterDismiss());
  const [restEditor, setRestEditor] = useState(false);
  const [hiddenWarmUps, setHiddenWarmUps] = useState<string[]>([]);
  const [permission, setPermission] = useState<AlertPermission | 'unknown'>('unknown');
  const { prefs } = useDevicePrefs();
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  /** The heaviest-set line for the set just logged (premium-feel §5.1), shown under the saved line. */
  const [record, setRecord] = useState<{ setId: string; text: string } | null>(null);
  const played = useRef(new Set<string>());
  const [afterDismiss] = useState(() => createAfterDismiss());
  const tickedFor = useRef<string | null>(null);
  const loadRef = useRef<TextInput>(null);
  const repsRef = useRef<TextInput>(null);
  /** During rest the next set is folded away (D-Rest); this opens it. Reset when the set changes. */
  const [showNextSet, setShowNextSet] = useState(false);
  /** A field to focus once the editor is drawn (`Enter load` during rest opens it first). A fresh object per tap. */
  const [focusRequest, setFocusRequest] = useState<{ field: EntryField } | null>(null);
  useEffect(() => {
    if (focusRequest === null) return;
    const id = requestAnimationFrame(() => {
      (focusRequest.field === 'load' ? loadRef : repsRef).current?.focus();
      setFocusRequest(null);
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [focusRequest, showNextSet]);

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
  /** False until the workout first draws: nothing animates on screen entry (premium-feel §4.3). */
  const drawn = useRef(false);
  const hasView = view !== null;
  useEffect(() => {
    if (hasView) drawn.current = true;
  }, [hasView]);

  // Edits belong to one set; when the active set changes, they are dropped (they were saved as a draft).
  useEffect(() => {
    if (edits && view?.focus?.setId !== edits.setId) setEdits(null);
  }, [view?.focus?.setId, edits]);
  useEffect(() => {
    setShowNextSet(false);
  }, [view?.focus?.setId]);

  // Rest end → Ready: `READY` holds briefly at the deadline before the editor swaps in (premium-feel §4.3, review S2).
  const [readyHold, setReadyHold] = useState<{ timerId: string; untilMs: number } | null>(null);
  const prevRest = useRef<RestView | null>(null);
  const viewRest = view?.rest ?? null;
  useEffect(() => {
    const until = readyHoldUntil(prevRest.current, viewRest, clockNow());
    prevRest.current = viewRest;
    if (until !== null && viewRest?.kind === 'ended') setReadyHold({ timerId: viewRest.timerId, untilMs: until });
  }, [viewRest]);
  useEffect(() => {
    if (readyHold === null) return;
    const t = setTimeout(() => {
      setReadyHold(null);
    }, Math.max(0, readyHold.untilMs - clockNow()));
    return () => {
      clearTimeout(t);
    };
  }, [readyHold]);

  // The record check's history is read when a set is focused, so the log haptic fires right after the write (review S1).
  const recordContext = useRef<RecordContext | null>(null);
  const focusSetId = view?.focus?.setId ?? null;
  const viewSessionId = data === 'loading' || data === null ? null : data.aggregate.session.id;
  const focusEquipment = view?.focus ? (data !== 'loading' && data !== null ? (data.aggregate.exercises.find((e) => e.id === view.focus?.sessionExerciseId)?.equipmentId ?? null) : null) : null;
  useEffect(() => {
    if (focusSetId === null || viewSessionId === null) return;
    let live = true;
    void services.workout.recordContext(viewSessionId, focusSetId).then((c) => {
      if (live) recordContext.current = c;
    });
    return () => {
      live = false;
    };
  }, [services, viewSessionId, focusSetId, focusEquipment]);

  // A new empty workout opens the exercise picker straight away (audit: Start leads to a usable workout).
  const emptySessionId = view?.phase === 'empty' && view.sessionId ? view.sessionId : null;
  useEffect(() => {
    if (emptySessionId === null || !firstTime(`auto-picker:${emptySessionId}`)) return;
    const t = setTimeout(() => {
      navigation.navigate('ExercisePicker', { sessionId: emptySessionId });
    }, 450);
    return () => {
      clearTimeout(t);
    };
  }, [emptySessionId, navigation]);

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

  // The coach in the workout (ADR 0019 C7). An applied change reloads the targets and guards Log for
  // `timing.valueChangeGuard`, so a tap aimed at the old label never saves the new one (§4.3).
  const coachSessionId = data === 'loading' || data === null ? null : data.aggregate.session.id;
  const coach = useWorkoutCoach(coachSessionId, () => {
    void reload();
    changed();
    setGuard(true);
    setTimeout(() => {
      setGuard(false);
    }, TIMING.valueChangeGuard);
  });
  // An unanswered offer goes when the rest ends (§3.2).
  const restRunning = data !== 'loading' && data !== null && data.aggregate.restTimer?.status === 'running';
  const clearOffer = coach.clearOffer;
  useEffect(() => {
    if (!restRunning) clearOffer();
  }, [restRunning, clearOffer]);

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
    // After the write, never on press-in. A heaviest-set record plays `record` instead of `commit` (premium-feel §5.1).
    const loggedSetId = focus.setId;
    const showRecord = (rec: { text: string } | null) => {
      haptic(logHaptic(rec !== null));
      setRecord(rec === null ? null : { setId: loggedSetId, text: rec.text });
    };
    const ready = recordContext.current;
    const quick = ready === null ? undefined : services.workout.recordOf(ready, r.aggregate, loggedSetId);
    if (quick !== undefined) showRecord(quick);
    else
      void services.workout
        .setRecord(session.id, loggedSetId)
        .catch(() => null)
        .then(showRecord);
    // Path B: a pure check on the logged set, no AI call (coach-adjustments §4.2).
    coach.afterLog(r.aggregate, loggedSetId);
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

  function openExerciseMenu(f: FocusView) {
    const howTo = howToRouteFor(f, bundledHowToSources());
    const menu = exerciseMenu(howTo !== null);
    ActionSheetIOS.showActionSheetWithOptions({ title: f.exerciseName, options: menu.options, destructiveButtonIndex: menu.destructiveButtonIndex, cancelButtonIndex: menu.cancelButtonIndex }, (picked) => {
      const action = menu.actionAt(picked);
      if (action === 'how_to' && howTo !== null) navigation.navigate('HowTo', howTo);
      if (action === 'add_set') void addSet(f.sessionExerciseId);
      if (action === 'add_exercise') navigation.navigate('ExercisePicker', { sessionId: session.id });
      if (action === 'delete_set') {
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
      if (action === 'skip_exercise') {
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

  /**
   * `Adjust` → `Pain` (coach-adjustments §4.5): the flag is deterministic and
   * works offline; then, if the coach can answer, it is asked to adjust with
   * increases blocked. It never diagnoses.
   */
  async function painFromAdjust(f: FocusView) {
    const r = await services.pain.flagMovement({ exerciseId: f.exerciseId, exerciseName: f.exerciseName, opId: newUuid() });
    if (!r.ok) {
      showToast({ icon: 'info.circle', text: r.message });
      return;
    }
    haptic('step');
    changed();
    void reload();
    showToast({ icon: 'exclamationmark.triangle', text: `Pain noted · ${f.exerciseName}`, ...(r.flagIds.length > 0 ? { action: 'Undo', onAction: () => void services.pain.clear(r.flagIds).then(() => void reload()) } : {}) });
    if (coach.availability?.status === 'ok') coach.ask({ kind: 'chip', chip: 'pain' });
  }

  /**
   * `⋯` (premium-feel §3.2, §10): Pause lives here, not in the header; paused, Resume is the one-tap primary.
   * `Rename workout` isn't offered on an open-ended workout in progress: it's named after Finish (its Summary).
   */
  function topMenu() {
    const items: { label: string; run: () => void }[] = [
      { label: session.pause === null ? 'Pause workout' : 'Resume workout', run: () => void pauseOrResume() },
      ...(view?.openEnded ? [] : [{ label: 'Rename workout', run: () => { renameOp.current = newUuid(); setRenameOpen(true); } }]),
      { label: 'Ask the coach', run: () => { navigation.navigate('Coach', { entry: { kind: 'workout', sessionId: session.id } }); } },
      { label: 'Finish workout', run: () => { setFinishOpen(true); } },
      { label: 'Edit workout times', run: () => { setTimesOpen(true); } },
      { label: 'Discard workout', run: confirmDiscard },
    ];
    const options = [...items.map((x) => x.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: items.length - 1, cancelButtonIndex: items.length }, (i) => {
      items[i]?.run();
    });
  }

  /** `Rename workout` (premium-feel §2.6): versioned; Undo renames back. The routine keeps its name. */
  async function renameWorkout(name: string): Promise<string | null> {
    const before = loaded.aggregate.session.routineName;
    const r = await run({ type: 'rename_session', at: services.now(), opId: renameOp.current, name, expectedVersion: loaded.aggregate.session.version });
    if (!r.ok) return r.error.code === 'stale_version' ? 'The workout changed. Check it and try again.' : r.error.message;
    const version = r.aggregate.session.version;
    renameAfter.arm(() => {
      showToast({
        text: `Renamed to ${name}`,
        action: 'Undo',
        onAction: () => {
          setToast(null);
          void run({ type: 'rename_session', at: services.now(), opId: newUuid(), name: before, expectedVersion: version }).then((u) => {
            if (!u.ok) showToast({ icon: 'info.circle', text: `Couldn’t undo: ${u.error.message}` });
          });
        },
      });
    });
    setRenameOpen(false);
    return null;
  }

  /** `bell.slash` in the header: iOS Settings once denied, otherwise ask iOS now. */
  function openAlertSettings() {
    const action = alertsOffAction(permission);
    if (action === 'open_settings') void Linking.openSettings();
    if (action === 'request') {
      void requestAlertPermission()
        .then((p) => {
          setPermission(p);
          // Schedule this rest's alert now that it's allowed.
          if (p === 'granted') void launch.restAlerts?.reconcile(loaded.aggregate, clockNow());
        })
        .catch(() => undefined);
    }
  }

  function confirmDiscard() {
    // One tested rule for every Discard (competitor-failure pack (e)): confirm whenever a set is logged.
    const ask = discardConfirmation(loaded.aggregate);
    const go = () => {
      void run(discardCommand(ask, { opId: newUuid(), at: services.now() })).then((r) => {
        if (!r.ok) {
          showToast({ icon: 'info.circle', text: r.error.code === 'stale_version' || r.error.code === 'discard_unconfirmed' ? 'The workout changed. Check it and try again.' : `Couldn’t discard: ${r.error.message}` });
          return;
        }
        // From inside the Finish sheet: leave only once it has closed (review S8, audit F9).
        if (finishOpen) {
          afterDismiss.arm(() => {
            navigation.dispatch(popToToday('Workout discarded'));
          });
          setFinishOpen(false);
          return;
        }
        navigation.dispatch(popToToday('Workout discarded'));
      });
    };
    // Nothing logged: discard at once (today.md §4: no Undo, nothing was logged).
    if (!ask.required) {
      go();
      return;
    }
    Alert.alert(`Discard ${view?.title ?? 'this workout'}?`, ask.message, [
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
    haptic('step');
    // Changing effort never touches rest (invariant 5).
    const r = await run({ type: 'correct_set', at: services.now(), opId: newUuid(), setId: js.setId, expectedSetVersion: js.setVersion, patch: scale === 'rir' ? { rir: next } : { rpe: next } });
    if (!r.ok) showToast({ icon: 'info.circle', text: 'That set changed. Tap it to edit.' });
    else coach.afterLog(r.aggregate, js.setId);
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
      case 'enter': {
        // Audit F2: never a dead button. It opens the keypad on the missing field.
        const field = view.primary.field;
        return {
          label: view.primary.label,
          onPress: () => {
            // During rest the editor is folded away: open it, then focus once it's drawn (review B1).
            const a = enterAction(field, { resting: restOnScreen, hasFocus: view.focus !== null, showNextSet });
            if (a.unfold) setShowNextSet(true);
            setFocusRequest({ field: a.focus });
          },
        };
      }
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
  const timerRunning = rest !== null && (rest.kind === 'running' || rest.kind === 'paused');
  const holding = readyHold !== null && rest?.kind === 'ended' && rest.timerId === readyHold.timerId;
  /** The rest block is on screen: the timer runs or is paused, or `READY` holds at its end. */
  const restOnScreen = timerRunning || holding;
  const resting = restOnScreen;
  const slot = editorSlot({ resting, hasFocus: focus !== null, showNextSet, setId: focus?.setId ?? null, drawn: drawn.current });
  const restored = focus !== null && focus.draftSource === 'draft' && restoredDraft === focus.setId;
  const copied = focus !== null && focus.draftSource === 'copied' && focus.previous ? `Copied from ${formatDayMonth(toMs(focus.previous.performedAtUtc), tz)}` : null;
  const lastExercise = view.exercises.at(-1) ?? null;
  const effortScale = loaded.effortScale;

  const effortBlock =
    view.justSaved && effortScale !== 'off' ? (
      <View style={{ gap: theme.space['3'] }}>
        <Eyebrow>{effortScale === 'rir' ? 'Reps in reserve' : 'Effort'}</Eyebrow>
        <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          {(effortScale === 'rir' ? EFFORT_RIR : EFFORT_RPE).map((n) => (
            <Chip
              key={n}
              grow
              label={effortScale === 'rir' && n === 4 ? '4+' : String(n)}
              accessibilityLabel={effortScale === 'rir' ? `${String(n)} reps in reserve` : `RPE ${String(n)}`}
              selected={(effortScale === 'rir' ? view.justSaved?.rir : view.justSaved?.rpe) === n}
              onPress={() => void effort(n)}
            />
          ))}
        </View>
      </View>
    ) : null;

  const recordLine =
    record !== null && view.justSaved?.setId === record.setId ? (
      <View accessible accessibilityLabel={record.text} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <PulseOnce key={record.setId}>
          <Icon name="star" color="text.secondary" size={16} />
        </PulseOnce>
        <AppText variant="callout" style={{ flex: 1 }}>
          {record.text}
        </AppText>
      </View>
    ) : null;

  const savedLine = view.justSaved ? (
    <AppText variant="callout" color="text.secondary" numeric>
      {`${view.justSaved.exerciseName === focus?.exerciseName || focus === null ? '' : `${view.justSaved.exerciseName} · `}Set ${String(view.justSaved.setNumber)}${view.justSaved.side === 'left' ? ' (left)' : view.justSaved.side === 'right' ? ' (right)' : ''} saved · `}
      <AppText variant="callout" numeric>
        {view.justSaved.text}
      </AppText>
    </AppText>
  ) : null;

  const restPanel =
    resting ? (
      <View style={{ gap: theme.space['5'] }}>
        <RestPanel
          rest={rest}
          ready={holding}
          upNext={view.upNext !== null ? `Next · ${view.upNext}` : focus === null ? (view.openEnded ? 'Then add a set or your next exercise' : null) : null}
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
            if (rest.kind !== 'running') return;
            void run({ type: 'skip_rest', at: services.now(), opId: `skip:${rest.timerId}:${String(rest.timerVersion)}`, timerId: rest.timerId }).then((r) => {
              if (r.ok) haptic('undo');
            });
          }}
        />
        {view.justSaved ? (
          <RuledSection>
            {savedLine}
            {recordLine}
            {effortBlock}
          </RuledSection>
        ) : null}
        {/* The coach card's place (premium-feel §3.4); takes no space while empty. */}
        <CoachSlot>{coach.slot !== null ? <CoachSlotContent coach={coach} /> : null}</CoachSlot>
      </View>
    ) : null;

  const setEditor = focus ? (
    <View style={{ gap: theme.space['5'], flexGrow: 1 }}>
      {/* Exercise header: name, then `Barbell · Set 2 of 4 · Last 1 Oct: 100 kg × 8` (tap Last to copy it). */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['2'] }}>
        <View style={{ flex: 1, gap: theme.space['1'] }}>
          <AppText variant="title1" numberOfLines={2} accessibilityRole="header">
            {focus.exerciseName}
          </AppText>
          {focus.previous ? (
            <LinkLine
              accessibilityLabel={`${focus.headerLine}. Last time, ${formatDayMonth(toMs(focus.previous.performedAtUtc), tz)}: ${focus.previous.text}. Tap to copy.`}
              onPress={() => {
                const prev = focus.previous;
                if (!prev) return;
                setEdits({ setId: focus.setId, values: { ...prev.values, rpe: null, rir: null }, copied: true, ...(edits?.side !== undefined ? { side: edits.side } : {}) });
              }}
            >
              <AppText variant="callout" color="text.secondary" numeric>
                {`${focus.headerLine} · Last ${formatDayMonth(toMs(focus.previous.performedAtUtc), tz)}: `}
                <AppText variant="callout" numeric>
                  {focus.previous.text}
                </AppText>
              </AppText>
            </LinkLine>
          ) : (
            <AppText variant="callout" color="text.secondary" numeric>
              {focus.headerLine}
            </AppText>
          )}
        </View>
        {/* Visible How to next to the name when there's a guide (Ben found it only in the ⋯ menu or on the rest screen). */}
        {howToRouteFor(focus, bundledHowToSources()) !== null ? (
          <TextButton
            label="How to"
            tone="secondary"
            accessibilityHint={`Shows how to do ${focus.exerciseName}.`}
            onPress={() => {
              const howTo = howToRouteFor(focus, bundledHowToSources());
              if (howTo !== null) navigation.navigate('HowTo', howTo);
            }}
          />
        ) : null}
        <AdjustButton coach={coach} />
        <IconButton
          icon="ellipsis"
          label={`${focus.exerciseName} menu`}
          onPress={() => {
            openExerciseMenu(focus);
          }}
        />
      </View>

      <AdjustRow coach={coach} sessionId={session.id} onPain={() => void painFromAdjust(focus)} />
      {/* In Ready the slot sits under the header; offers only ever show during rest (§2.3). */}
      {!resting && coach.slot !== null && coach.slot.kind !== 'offer' ? <CoachSlot>{<CoachSlotContent coach={coach} />}</CoachSlot> : null}

      {rest?.kind === 'ended' && !resting ? (
        <StatusLine
          icon="checkmark.circle.fill"
          tone="done"
          text={rest.skipped ? 'Ready' : `Rest over · rested ${formatDuration(rest.restedMs / 1000)}`}
          detail={rest.skipped || rest.endedAtUtc === null ? null : `Ended ${formatTime(toMs(rest.endedAtUtc), tz)}`}
        />
      ) : null}

      {focus.warmUp && !hiddenWarmUps.includes(focus.sessionExerciseId) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <AppText variant="callout" color="text.secondary" numeric style={{ flex: 1 }}>
            {`Warm-up (built-in, not logged): ${focus.warmUp}`}
          </AppText>
          <TextButton
            label="Hide"
            tone="secondary"
            onPress={() => {
              setHiddenWarmUps((h) => [...h, focus.sessionExerciseId]);
            }}
          />
        </View>
      ) : null}

      <View style={{ gap: theme.space['3'] }}>
        <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
          {focus.loadField ? (
            <NumberStepper
              inputRef={loadRef}
              flex={1.4}
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
              inputRef={repsRef}
              flex={1}
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
        {/* `Target 100 kg · 6–8 reps · Rest after 3:00`: tap to change the rest after this set. */}
        <LinkLine
          accessibilityLabel={`${focus.target ?? 'No target for this set'}. Rest after this set: ${formatDuration(focus.restAfterS)}. Tap to change the rest.`}
          onPress={() => {
            setRestEditor(true);
          }}
        >
          <AppText variant="callout" color="text.secondary" numeric>
            {`${focus.target ?? 'No target'} · Rest after `}
            <AppText variant="callout" numeric style={{ textDecorationLine: 'underline', textDecorationColor: theme.colors['border.control'] }}>
              {formatDuration(focus.restAfterS)}
            </AppText>
          </AppText>
        </LinkLine>
        {focus.plateLine ? (
          <AppText variant="callout" color="text.tertiary" numeric accessibilityLabel={`Plates: ${focus.plateLine}`}>
            {focus.plateLine}
          </AppText>
        ) : null}
        {restored ? (
          <AppText variant="callout" color="text.secondary">
            Unsaved edit restored
          </AppText>
        ) : copied ? (
          <AppText variant="callout" color="text.secondary">
            {copied}
          </AppText>
        ) : null}
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
          )
        ) : null}
      </View>

      <View>
        <View style={{ marginBottom: theme.space['2'] }}>
          <Eyebrow>Sets</Eyebrow>
        </View>
        {focus.rows.map((r, i) => (
          <SetRowLine
            key={r.setId}
            status={r.status}
            number={r.number}
            badges={r.badges}
            text={r.text}
            edited={r.edited}
            last={i === focus.rows.length - 1}
            onPress={() => {
              if (r.status === 'done') navigation.navigate('EditSet', { sessionId: session.id, setId: r.setId });
              if (r.status === 'pending') void run({ type: 'set_active_set', at: services.now(), opId: newUuid(), setId: r.setId, expectedVersion: session.version });
            }}
          />
        ))}
      </View>

      {/* `Next Incline dumbbell press ›` pinned to the bottom of the content, or `Add exercise ›` when this is the last one (audit F3). */}
      <View style={{ marginTop: 'auto' }}>
        {focus.next?.kind === 'exercise' ? (
          <NextRow
            label="Next"
            text={focus.next.name}
            onPress={() => {
              const next = focus.next;
              if (next?.kind === 'exercise') void run({ type: 'set_active_set', at: services.now(), opId: newUuid(), setId: next.setId, expectedVersion: session.version });
            }}
          />
        ) : (
          <NextRow
            label={focus.next?.kind === 'last_set' && !view.openEnded ? 'Last set ·' : 'Then'}
            text="Add exercise"
            onPress={() => {
              navigation.navigate('ExercisePicker', { sessionId: session.id });
            }}
          />
        )}
      </View>
    </View>
  ) : null;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <NumberAccessory />
      {/* Top bar (D-ActiveSet): on the canvas, the workout's name in tracked caps, active time, pause. */}
      <View style={{ paddingTop: insets.top, backgroundColor: theme.colors['bg.canvas'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: theme.space['2'], gap: theme.space['1'] }}>
          <IconButton icon="chevron.down" label="Minimise workout" onPress={close} />
          <AppText variant="sectionLabel" color="text.secondary" numberOfLines={1} style={{ flex: 1, fontSize: 13 }} accessibilityRole="header">
            {view.title}
          </AppText>
          <View accessible accessibilityLabel={`${view.paused ? 'Paused, ' : ''}active time ${formatElapsed(view.elapsedMs)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
            {view.paused ? <Icon name="pause.circle.fill" color="status.warning" size={16} /> : null}
            <AppText variant="callout" numeric color={view.paused ? 'status.warning' : 'text.secondary'}>
              {view.paused ? `Paused · ${formatElapsed(view.elapsedMs)}` : formatElapsed(view.elapsedMs)}
            </AppText>
          </View>
          {alertsOff(permission, prefs.alertsAsk) ? <IconButton icon="bell.slash" tint="text.secondary" label={alertsOffLabel(permission)} onPress={openAlertSettings} /> : null}
          <IconButton icon="ellipsis.circle" label="Workout menu" onPress={topMenu} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: theme.space['5'], paddingTop: theme.space['3'], gap: theme.space['5'], paddingBottom: theme.space['4'] }} keyboardShouldPersistTaps="handled">
        {/* Paused: the header pill and `REST · PAUSED` say it, no banner (§3.2). During rest only a failed write shows (§3.1). */}
        {banners
          .filter((b) => !resting || b.key === 'write')
          .map((b) => (
            <Banner key={b.key} severity={b.severity} text={b.text} />
          ))}

        {view.phase === 'empty' ? (
          <View style={{ paddingTop: theme.space['4'] }}>
            <HeroHeader size="screen" eyebrow="Empty workout" title="Add your first exercise" lines={['Common lifts are at the top. Each one starts with 3 sets; add or remove sets as you go.']} />
          </View>
        ) : null}

        {restPanel ? (
          <SwapIn swapKey="rest" animate={drawn.current} style={{ gap: theme.space['5'] }}>
            {restPanel}
          </SwapIn>
        ) : null}

        {/* During rest the next set waits below its own toggle (D-Rest is rest-first, audit F8). One wrapper keyed
            by the set either side of the rest end, so an editor opened during rest stays mounted (review B1). */}
        {slot.kind === 'link' ? (
          // One fixed secondary link (premium-feel §3.3, D8). How to is in the next set's header and its ⋯ menu.
          <View style={{ marginTop: 'auto' }}>
            <TextButton
              label="Edit next set"
              tone="secondary"
              onPress={() => {
                setShowNextSet(true);
              }}
            />
          </View>
        ) : slot.kind === 'editor' && setEditor ? (
          // Rest → Ready: the editor fades in (motion.swap) only when the rest end brings it on screen.
          <SwapIn swapKey={slot.key} animate={slot.animateOnMount} style={{ flexGrow: 1 }}>
            {setEditor}
          </SwapIn>
        ) : null}

        {focus === null && view.phase !== 'empty' ? (
          <View style={{ gap: theme.space['4'] }}>
            {!resting ? (
              <>
                <AppText variant="title1" accessibilityRole="header">
                  {view.openEnded ? 'Exercise done' : 'All planned sets done'}
                </AppText>
                {view.justSaved ? (
                  <View style={{ gap: theme.space['3'] }}>
                    {savedLine}
                    {effortBlock}
                  </View>
                ) : null}
              </>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }}>
              {lastExercise ? <SecondaryButton label={`Add set · ${lastExercise.name}`} onPress={() => void addSet(lastExercise.sessionExerciseId)} /> : null}
              {view.primary.kind === 'add_exercise' ? (
                <SecondaryButton
                  label="Finish workout"
                  onPress={() => {
                    setFinishOpen(true);
                  }}
                />
              ) : (
                <SecondaryButton
                  label="Add exercise"
                  onPress={() => {
                    navigation.navigate('ExercisePicker', { sessionId: session.id });
                  }}
                />
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {toast ? <Toast key={toast.id} {...(toast.icon ? { icon: toast.icon } : {})} text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} /> : null}
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
      <NameSheet
        visible={renameOpen}
        title="Rename workout"
        buttonLabel="Save name"
        initialName={view.title}
        check={(n) => Promise.resolve(checkRoutineName(n, []))}
        onSubmit={renameWorkout}
        onClose={() => {
          setRenameOpen(false);
        }}
        onDismissed={renameAfter.dismissed}
      />
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

function IconButton({ icon, label, onPress, tint = 'text.primary' }: { icon: SymbolName; label: string; onPress: () => void; tint?: 'text.primary' | 'text.secondary' }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: theme.target.min.width, height: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
    >
      <Icon name={icon} color={tint} size={20} />
    </Pressable>
  );
}

/**
 * Rest ↔ Ready (`motion.swap`): content fades in with a small rise when it
 * replaces the other state. Nothing animates on the screen's first draw, and
 * the swap never waits on or delays a write.
 */
function SwapIn({ swapKey, animate, style, children }: { swapKey: string; animate: boolean; style?: { gap?: number; flexGrow?: number }; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <FadeIn key={swapKey} motion={animate ? swapMotion(theme.a11y.reduceMotion) : null} easing="inOut" style={style}>
      {children}
    </FadeIn>
  );
}

const STATUS_WORD: Record<'done' | 'active' | 'pending' | 'skipped', string> = { done: 'Done', active: 'Now', pending: 'Target', skipped: 'Skipped' };

/**
 * `SetRow` (design-system §7, D-ActiveSet): 48pt rows between hairlines; a
 * check for done, a filled dot for now, an outline for pending, a slash for
 * skipped. Status is shape and words, never colour alone.
 */
function SetRowLine({
  status,
  number,
  badges,
  text,
  edited,
  last,
  onPress,
}: {
  status: 'done' | 'active' | 'pending' | 'skipped';
  number: number;
  badges: string[];
  text: string;
  edited: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const tappable = status === 'done' || status === 'pending';
  // `100 kg × 8   RPE 8`: effort goes to the right.
  const [main, effort] = status === 'done' ? text.split(/\s{3}/) : [status === 'active' ? 'Now' : text, undefined];
  const marker =
    status === 'done' ? (
      <Icon name="checkmark.circle" color="status.done" size={18} />
    ) : status === 'skipped' ? (
      <Icon name="slash.circle" color="text.tertiary" size={18} />
    ) : (
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: status === 'active' ? theme.colors.accent : 'transparent',
          borderWidth: status === 'active' ? 0 : 1.5,
          borderColor: theme.colors['border.control'],
        }}
      />
    );
  return (
    <Pressable
      accessibilityRole={tappable ? 'button' : 'text'}
      accessibilityLabel={`Set ${String(number)}${badges.length ? ` ${badges.join(' ')}` : ''}, ${STATUS_WORD[status]}, ${text}${edited ? ', edited' : ''}`}
      accessibilityHint={status === 'done' ? 'Edit or delete this set' : status === 'pending' ? 'Make this the current set' : undefined}
      disabled={!tappable}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
        borderTopWidth: theme.dividerWidth,
        borderBottomWidth: last ? theme.dividerWidth : 0,
        borderColor: theme.colors['border.divider'],
        backgroundColor: pressed ? theme.colors['bg.surface'] : 'transparent',
      })}
    >
      {marker}
      <AppText variant="callout" numeric color={status === 'active' ? 'text.primary' : 'text.tertiary'} style={{ minWidth: 22, fontWeight: status === 'active' ? '600' : '400' }}>
        {`${String(number)}${badges.length ? badges.join('') : ''}`}
      </AppText>
      <AppText
        variant="callout"
        numeric
        color={status === 'done' || status === 'active' ? 'text.primary' : 'text.secondary'}
        style={{ flex: 1, fontWeight: status === 'active' ? '600' : '400' }}
      >
        {main}
      </AppText>
      {effort ? (
        <AppText variant="callout" numeric color="text.tertiary">
          {effort.trim()}
        </AppText>
      ) : null}
      {edited ? <Icon name="pencil" size={14} color="text.tertiary" /> : null}
    </Pressable>
  );
}

/** `Next Incline dumbbell press ›` (D-ActiveSet): the whole line is the target. */
function NextRow({ label, text, onPress }: { label: string; text: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${text}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
    >
      <AppText variant="callout" numberOfLines={1} style={{ flex: 1 }}>
        <AppText variant="callout" color="text.tertiary">{`${label} `}</AppText>
        {text}
      </AppText>
      <Icon name="chevron.right" size={14} color="text.secondary" />
    </Pressable>
  );
}

/**
 * The Rest state (D-Rest, design-system §9.6): `REST`, the time left from the
 * stored deadline (never a JS counter), `Next · Set 3 · 100 kg × 6–8`, and
 * −30 s / +30 s / Skip outline pills.
 */
function RestPanel({ rest, ready, upNext, onAdjust, onSkip }: { rest: RestView; ready: boolean; upNext: string | null; onAdjust: (deltaS: number) => void; onSkip: () => void }) {
  const theme = useTheme();
  const shownS = rest.kind === 'ended' ? 0 : Math.ceil(rest.remainingMs / 1000);
  const prevS = useRef(shownS);
  // A jump of more than a second is ±30 s (or a return to the app): the whole numeral cross-fades once.
  const whole = Math.abs(prevS.current - shownS) > 1;
  useEffect(() => {
    prevS.current = shownS;
  }, [shownS]);
  if (rest.kind === 'ended' && !ready) return null;
  const paused = rest.kind === 'paused';
  const ended = rest.kind === 'ended';
  // `Next · Set 2 · 60 kg × 3–6`: the target values in text.primary (premium-feel §8).
  const nextParts = upNext === null ? null : upNext.split(' · ');
  const nextLead = nextParts && nextParts.length > 2 ? `${nextParts.slice(0, -1).join(' · ')} · ` : null;
  const nextValue = nextParts && nextParts.length > 2 ? (nextParts.at(-1) ?? '') : null;
  const pill = (label: string, a11y: string, onPress: () => void) => <SecondaryButton grow label={label} accessibilityLabel={a11y} disabled={paused || ended} onPress={onPress} />;
  return (
    <View style={{ gap: theme.space['5'] }}>
      {/* 26 pt above `REST` with the scroll padding (D-Rest). */}
      <View style={{ alignItems: 'center', gap: theme.space['1'], paddingTop: theme.space['3'] + 2 }}>
        <AppText variant="sectionLabel" color={paused ? 'status.warning' : 'text.tertiary'}>
          {ended ? 'Ready' : paused ? 'Rest · paused' : 'Rest'}
        </AppText>
        <TimerNumeral
          text={formatDuration(shownS)}
          whole={whole}
          color={paused ? 'text.tertiary' : 'text.primary'}
          accessibilityLabel={rest.kind === 'ended' ? 'Rest over' : `Rest${paused ? ', paused' : ''}, ${formatDuration(rest.remainingMs / 1000)} left`}
        />
        {upNext ? (
          <AppText variant="callout" color="text.secondary" numeric align="center" accessibilityLabel={`Next set target: ${upNext.replace(/^Next · /, "")}`}>
            {nextLead !== null && nextValue !== null ? (
              <>
                {nextLead}
                <AppText variant="callout" numeric>
                  {nextValue}
                </AppText>
              </>
            ) : (
              upNext
            )}
          </AppText>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
        {pill('−30 s', 'Rest 30 seconds shorter', () => {
          haptic('step');
          onAdjust(-30);
        })}
        {pill('+30 s', 'Rest 30 seconds longer', () => {
          haptic('step');
          onAdjust(30);
        })}
        {pill('Skip', 'Skip rest', onSkip)}
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['5'], paddingBottom: theme.space['4'] + insets.bottom, gap: theme.space['4'] }}>
        <View style={{ gap: theme.space['2'] }}>
          <Eyebrow>{exerciseName}</Eyebrow>
          <AppText variant="title2" accessibilityRole="header">{`Rest after set ${String(setNumber)}`}</AppText>
        </View>
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
