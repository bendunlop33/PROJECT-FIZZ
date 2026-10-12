import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, AppState, Keyboard, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, useWindowDimensions, View, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { checkRoutineName, discardCommand, discardConfirmation, editFitsCurrentEquipment, formatDuration, formatElapsed, gymSwitchRefusal, saveDraftCommand, tableLogLabel, TIME_LEFT, toIso, toMs, type CommandOutcome, type DraftEdits, type FocusView, type RestView } from '@fizz/domain';
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
import { openGymFromWorkout, popToToday, replaceWithSummary } from '../../navigation/actions';
import type { RootStackParams, WorkoutToastParam } from '../../navigation/types';
import type { ActiveWorkoutData, GymChoice, RecordContext, SwapSheet } from '../../services/workout-services';
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
  Tag,
  TEXT_PRESSED_OPACITY,
  TextButton,
  TimerNumeral,
  Toast,
  type SymbolName,
} from '../../ui';
import { CoachSlot } from './CoachSlot';
import { MidSwapSheet } from './MidSwapSheet';
import { NoteSheet } from './NoteSheet';
import { AdjustButton, AdjustRow, CoachSlotContent, useWorkoutCoach } from './WorkoutCoach';
import { correctedSetToCheck } from '../../coach/offer-check';
import { createAfterDismiss } from '../../workout/after-dismiss';
import { exerciseMenu, targetRpeMenu, targetRpeScopeMenu } from '../../workout/exercise-menu';
import { shouldCueRestEnd, workTimerText } from '../../workout/cues';
import { startTimeBounds, stepTime } from '../../workout/finish';
import { newerWorkoutData, withCommandResult } from '../../workout/load-order';
import { logRefusal, reloadsAfterRefusal } from '../../workout/log-refusal';
import { FinishSheet } from './FinishSheet';
import { GymChip, GymPartDivider, GymReviewSheet, GymSwitchCard, GymSwitcherSheet, SnapNote } from './GymSwitch';
import { afterSwitchRefused, logBlockedBySwitch, reviewOpenAfterCheckAgain, logGuardAfterSwitch, onGymChosen, sheetClosesOn, switchCardView, switchedToast, undoneToast, type CardButton, type OpenSwitchCard } from '../../workout/gym-switch-card';
import { TargetWhyLink, TargetWhyPanel } from './TargetWhyPanel';
import { TimeLeftLine, TimeLeftSheet } from './TimeLeftSheet';
import { answerStillHurts, confirmClearFlag, type PainToast } from '../../workout/pain-actions';
import { editorSlot, enterAction, readyHoldUntil, type EntryField } from '../../workout/rest-fold';
import { UNDO_TOAST } from '../../workout/undo-op';
import { setRowCaption } from '../../workout/notes';
import { whyPanelReducer, type WhyEvent, type WhyPanel } from '../../workout/target-why';
import { AX_FONT_SCALE } from '../../workout/overview';
import { anchorReducer, selectRowFlow, workoutMenu, workoutViewOf, type AnchorEvent, type AnchorRequest, type ChipState } from '../../workout/table';
import { ChatButton, DoneChip, NowChip, OpenSetRow, RestBar, WorkoutTable, type WorkoutTableHandle } from './WorkoutTable';

/**
 * Active workout: the Table view (default, active-workout §2A) or the
 * focused set card (Focus, in `⋯`), rest, summary hand-off
 * (active-workout.md, rest-state.md, flow-first-milestone.md).
 *
 * Every value shown comes from `buildActiveSetView` (domain); this screen
 * only holds Ben's unsaved edits, the 1 s commit guard, and toasts. Every
 * write is one service command with an operation ID; the core never waits
 * on alerts, haptics or anything optional. Both views share one Log path
 * (`log` below). The custom keypad is a later item; the system number pad
 * with a Done bar is used.
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
  /** `Notes` on the focused exercise (§4.4). */
  const [noteFor, setNoteFor] = useState<{ sessionExerciseId: string; exerciseName: string; note: string | null } | null>(null);
  /** The mid-workout Swap sheet (EL4): the row it swaps and its candidates. */
  const [swap, setSwap] = useState<{ sessionExerciseId: string; exerciseName: string; sheet: SwapSheet | null; loading: boolean } | null>(null);
  const [hiddenWarmUps, setHiddenWarmUps] = useState<string[]>([]);
  const [permission, setPermission] = useState<AlertPermission | 'unknown'>('unknown');
  const { prefs, update: updatePrefs } = useDevicePrefs();
  /** Table (default) or Focus, remembered on this phone (active-workout §4.5). */
  const mode = workoutViewOf(prefs.workoutView);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const { fontScale } = useWindowDimensions();
  const ax = fontScale >= AX_FONT_SCALE;
  // Table anchoring (§2A.4): only these events move the list; Ben's own scrolling always wins.
  const [anchorRequest, setAnchorRequest] = useState<AnchorRequest | null>(null);
  const reduceMotionRef = useRef(false);
  reduceMotionRef.current = theme.a11y.reduceMotion;
  const anchorEvent = useCallback((e: AnchorEvent) => {
    setAnchorRequest((cur) => anchorReducer(cur, e, { reduceMotion: reduceMotionRef.current }));
  }, []);
  const [chips, setChips] = useState<ChipState>({ done: false, now: null });
  const tableRef = useRef<WorkoutTableHandle>(null);
  /** The full rest view over Table (tap on the rest bar's countdown, §2A.6). */
  const [restFull, setRestFull] = useState(false);
  /** The set the after-set block (effort, offer) belongs to: until the next Log or another row is selected. */
  const [afterSetFor, setAfterSetFor] = useState<string | null>(null);
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  /** Gym switch (gym-switch.md): the switcher sheet's rows, the open card, its review sheet. */
  const [gymSheet, setGymSheet] = useState<GymChoice[] | null | 'closed'>('closed');
  const [switchCard, setSwitchCard] = useState<OpenSwitchCard | null>(null);
  const [checkingGym, setCheckingGym] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  /** The heaviest-set line for the set just logged (premium-feel §5.1), shown under the saved line. */
  const [record, setRecord] = useState<{ setId: string; text: string } | null>(null);
  // `Why?` on the target line (active-workout §2.12): one panel at most, hidden while the keypad is open.
  const [why, setWhy] = useState<WhyPanel>(null);
  const [keypadOpen, setKeypadOpen] = useState(false);
  /** The keypad's height with its Done bar (`endCoordinates.height`); 0 while it's closed. */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // `Time left` (§2.15.1): its own clock moves on events (any new data) and once a minute, never every second.
  const [timeLeftNow, setTimeLeftNow] = useState(clockNow);
  const [timeLeftOpen, setTimeLeftOpen] = useState(false);
  const whyEvent = useCallback((e: WhyEvent) => {
    setWhy((cur) => whyPanelReducer(cur, e));
  }, []);
  // The workout as it is now, for action sheets that dispatch after Ben picks: their version is read
  // when the command is sent, not when the sheet opened (review target-rpe N4 / r2 N6).
  const latestData = useRef(data);
  useEffect(() => {
    latestData.current = data;
  }, [data]);
  const played = useRef(new Set<string>());
  const [afterDismiss] = useState(() => createAfterDismiss());
  const tickedFor = useRef<string | null>(null);
  const loadRef = useRef<TextInput>(null);
  const repsRef = useRef<TextInput>(null);
  const timeRef = useRef<TextInput>(null);
  const distanceRef = useRef<TextInput>(null);
  /** The open row's `Set 2 · NOW` header: VoiceOver focus lands here after a Log or on open (§2A.7). */
  const openHeaderRef = useRef<View>(null);
  /** During rest the next set is folded away (D-Rest); this opens it. Reset when the set changes. */
  const [showNextSet, setShowNextSet] = useState(false);
  /** A field to focus once the editor is drawn (`Enter load` during rest opens it first). A fresh object per tap. */
  const [focusRequest, setFocusRequest] = useState<{ field: EntryField } | null>(null);
  useEffect(() => {
    if (focusRequest === null) return;
    const id = requestAnimationFrame(() => {
      (focusRequest.field === 'load' ? loadRef : focusRequest.field === 'time' ? timeRef : focusRequest.field === 'distance' ? distanceRef : repsRef).current?.focus();
      setFocusRequest(null);
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [focusRequest, showNextSet]);

  /** Counts workout reads as they start, so a slow older read never brings back older pain flags or names. */
  const loadSeq = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const d = await services.workout.load();
      const startedLast = seq === loadSeq.current;
      // A read that started before a newer write never replaces it on screen.
      setData((cur) => newerWorkoutData(cur, d, { startedLast }));
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
    // The Table's keypad anchor is sent by the tile's own onFocus (`onTileFocus`), never guessed here: the
    // focus event and this one have no guaranteed order (review r2 B1). This only says how tall the keypad is.
    const shown = Keyboard.addListener('keyboardWillShow', (e) => {
      setKeypadOpen(true);
      setKeyboardHeight(e.endCoordinates.height);
      whyEvent({ kind: 'keypad_opened' });
    });
    const hidden = Keyboard.addListener('keyboardWillHide', () => {
      setKeypadOpen(false);
      setKeyboardHeight(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [whyEvent]);

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
      const list: { key: string; severity: 'info' | 'warning'; text: string }[] = [{ key: 'restored', severity: 'info', text: 'Workout restored' }];
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
    if (handed && handed.kind !== 'exclusion' && handed.kind !== 'undo_op' && firstTime(`toast:${sid}:${handed.kind}:${handed.text}`)) showHanded(handed);
  }, [data === 'loading' || data === null ? null : data.aggregate.session.id]);

  // The correction sheet hands its exclusion toast back on return (§2.13); each save shows once.
  const handedExclusion = route.params?.toast?.kind === 'exclusion' ? route.params.toast : null;
  useEffect(() => {
    if (handedExclusion && firstTime(`toast:exclusion:${handedExclusion.key}`)) showHanded(handedExclusion);
  }, [handedExclusion?.key]);
  // …and its `Set 2 deleted` / `Set 2 updated` [Undo] (copy D4), once per operation.
  const handedUndo = route.params?.toast?.kind === 'undo_op' ? route.params.toast : null;
  useEffect(() => {
    if (handedUndo && firstTime(`toast:undo_op:${handedUndo.targetOpId}`)) showHanded(handedUndo);
  }, [handedUndo?.targetOpId]);

  /**
   * A toast with `Undo` for an operation that applied at once (copy D4):
   * delete set, skip, a correction, remove or swap. Undo is `undo_op`,
   * refused when anything it touched changed since (rule 5).
   */
  function toastUndoOp(text: string, targetOpId: string, sessionId: string) {
    showToast({
      icon: 'info.circle',
      text,
      action: 'Undo',
      onAction: () => {
        setToast(null);
        void services.workout.undoOp({ sessionId, targetOpId }).then((r) => {
          changed();
          void reload();
          if (r.ok) haptic('undo');
          else showToast({ icon: 'info.circle', text: r.message });
        });
      },
    });
  }

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
            // A retraction, not a clear: as if the flag was never set (review B2). Versioned; a second tap is a no-op.
            void services.pain.retract(t.flags, newUuid()).then((r) => {
              changed();
              void reload();
              showToast({ icon: 'info.circle', text: !r.ok ? r.message : r.stale.length > 0 ? 'Pain flag kept: it changed since' : 'Pain flag removed' });
            });
          },
        });
        break;
      case 'info':
        showToast({ icon: 'info.circle', text: t.text });
        break;
      case 'undo_op':
        if (data !== 'loading' && data !== null) toastUndoOp(t.text, t.targetOpId, data.aggregate.session.id);
        break;
      case 'exclusion':
        showToast({
          icon: 'info.circle',
          text: t.text,
          action: 'Undo',
          onAction: () => {
            // One more versioned correction; a pain flag the same save set is retracted with it (review B2).
            void services.workout.undoMark({ ...t.undo, opId: `undo:${t.key}` }).then((r) => {
              changed();
              void reload();
              showToast({ icon: 'info.circle', text: r.message ?? (r.ok ? 'Undone' : 'Undo wasn’t saved. Try again.') });
            });
          },
        });
        break;
    }
  }

  // `[Use changes today]` from the gym's detail: the `Use updated …` card, once per tap (gym-editor §4.9).
  const checkGym = route.params?.checkGym;
  useEffect(() => {
    if (data === 'loading' || data === null || !checkGym || !firstTime(`checkGym:${checkGym.nonce}`)) return;
    const refusal = gymSwitchRefusal(data.aggregate.session);
    if (refusal !== null) {
      showToast({ icon: 'info.circle', text: `Couldn’t use the changes. ${refusal}` });
      return;
    }
    void services.gymSwitch
      .propose(data.aggregate.session.id, checkGym.gymId)
      .then((p) => {
        if (p) setSwitchCard({ proposal: p, opId: newUuid(), status: 'ready' });
      })
      .catch(() => {
        showToast({ icon: 'info.circle', text: 'Couldn’t check that gym.' });
      });
  }, [data === 'loading' || data === null ? null : data.aggregate.session.id, checkGym?.nonce]);

  const view = useMemo(() => (data === 'loading' || data === null ? null : services.workout.view(data, now, edits)), [services, data, now, edits]);
  /** False until the workout first draws: nothing animates on screen entry (premium-feel §4.3). */
  const drawn = useRef(false);
  const hasView = view !== null;
  useEffect(() => {
    if (!hasView || drawn.current) return;
    drawn.current = true;
    // Opened (Start, Resume, relaunch after a force-close): anchored on the stored active set, no animation (§2A.4).
    anchorEvent({ kind: 'opened' });
    // Restored mid-rest: the after-set block (effort chips) belongs to the set just saved.
    if (view.rest?.kind === 'running' && view.justSaved) setAfterSetFor(view.justSaved.setId);
  }, [hasView]);

  useEffect(() => {
    setTimeLeftNow(clockNow());
  }, [data]);
  useEffect(() => {
    const t = setInterval(() => {
      setTimeLeftNow(clockNow());
    }, TIME_LEFT.refreshMs);
    return () => {
      clearInterval(t);
    };
  }, []);
  const timeLeft = useMemo(() => (data === 'loading' || data === null ? null : services.workout.timeLeft(data, timeLeftNow)), [services, data, timeLeftNow]);
  // The Table's rows change on events (data, drafts) and its pain checks once a minute; never every second.
  const table = useMemo(() => (data === 'loading' || data === null || mode !== 'table' ? null : services.workout.tableView(data, timeLeftNow, edits)), [services, data, timeLeftNow, edits, mode]);

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

  // So does an open `Why?` panel: another active set closes it.
  useEffect(() => {
    whyEvent({ kind: 'active_set', setId: view?.focus?.setId ?? null });
  }, [view?.focus?.setId, whyEvent]);

  // Debounced draft save (300 ms): unsaved edits survive a force-close without counting as results.
  useEffect(() => {
    if (!edits || data === 'loading' || data === null) return;
    const sessionId = data.aggregate.session.id;
    const t = setTimeout(() => {
      void services.workout.dispatch(sessionId, saveDraftCommand(edits, services.now()));
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [edits, data, services]);

  // Work timer end in the foreground (§2.7): one haptic at 0, then a tick saves the planned time as the draft.
  useEffect(() => {
    if (data === 'loading' || data === null) return;
    const wi = data.aggregate.workInterval;
    if (wi?.status !== 'running' || data.aggregate.session.pause !== null) return;
    const deadline = toMs(wi.deadlineUtc);
    if (now < deadline) return;
    const key = `work:${wi.setId}:${wi.deadlineUtc}`;
    if (shouldCueRestEnd(key, deadline, now, played.current)) haptic('restEnd');
    played.current.add(key);
    if (tickedFor.current === key) return;
    tickedFor.current = key;
    void services.workout.dispatch(data.aggregate.session.id, { type: 'tick', at: services.now() }).then((r) => {
      if (r.ok) setData((cur) => (cur === 'loading' || cur === null ? cur : withCommandResult(cur, cur, r.aggregate)));
    });
  }, [now, data, services]);

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
      if (r.ok) setData((cur) => (cur === 'loading' || cur === null ? cur : withCommandResult(cur, cur, r.aggregate)));
    });
  }, [now, data, services]);

  // `valueChangeGuard` after a target changed under Ben's thumb; the timer is cleared on unmount (review N5).
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armGuard = useCallback(() => {
    setGuard(true);
    if (guardTimer.current !== null) clearTimeout(guardTimer.current);
    guardTimer.current = setTimeout(() => {
      guardTimer.current = null;
      setGuard(false);
    }, TIMING.valueChangeGuard);
  }, []);
  useEffect(
    () => () => {
      if (guardTimer.current !== null) clearTimeout(guardTimer.current);
    },
    [],
  );

  // The coach in the workout (ADR 0020 C7). An applied change reloads the targets and guards Log for
  // `timing.valueChangeGuard`, so a tap aimed at the old label never saves the new one (§4.3).
  const coachSessionId = data === 'loading' || data === null ? null : data.aggregate.session.id;
  const coach = useWorkoutCoach(
    coachSessionId,
    () => {
      void reload();
      changed();
      armGuard();
    },
    data === 'loading' || data === null ? null : data.aggregate,
  );
  // F4: back from correcting a logged set's reps or effort: the offer check runs on the saved correction.
  const corrected = route.params?.corrected;
  const afterLog = coach.afterLog;
  useEffect(() => {
    if (corrected === undefined || !firstTime(`corrected:${corrected.key}`)) return;
    void reload().then((d) => {
      const id = correctedSetToCheck(corrected, d?.aggregate);
      if (d && id !== null) afterLog(d.aggregate, id);
    });
  }, [corrected?.key]);
  // An unanswered offer goes when the rest ends (§3.2).
  const restRunning = data !== 'loading' && data !== null && data.aggregate.restTimer?.status === 'running';
  const clearOffer = coach.clearOffer;
  useEffect(() => {
    if (!restRunning) clearOffer();
  }, [restRunning, clearOffer]);

  if (loadError !== null && (data === 'loading' || data === null)) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: insets.top + theme.space['4'], paddingHorizontal: theme.space['4'], gap: theme.space['4'] }}>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open this workout." info={loadError} infoLabel="Error details" />
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

  /** A refused menu action: the shortest honest line (the screen reloads on a stale version). */
  function refusalText(code: string, message: string): string {
    return code === 'stale_version' || code === 'write_conflict' ? 'The workout changed. Try again.' : message;
  }

  /** Run one command; adopt the committed state; never throw. */
  async function run(command: SessionCommand): Promise<CommandOutcome> {
    const r = await services.workout.dispatch(session.id, command);
    if (r.ok) {
      setData((cur) => withCommandResult(cur, loaded, r.aggregate));
      changed();
    } else if (reloadsAfterRefusal(r.error.code)) {
      // Review N8: reload so the next try uses the latest version. A reused opId means the
      // screen is behind a write already saved; the reload shows it (fix-workout r2 S2).
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

  /** `Last …`: copies last time's values into the open row (its effort is never copied). */
  function copyLast(f: FocusView) {
    const prev = f.previous;
    if (!prev) return;
    setEdits({ setId: f.setId, values: { ...prev.values, rpe: null, rir: null }, copied: true, ...(edits?.side !== undefined ? { side: edits.side } : {}) });
  }

  function editLoad(f: FocusView, v: number | null) {
    const unit = loaded.aggregate.exercises.find((e) => e.id === f.sessionExerciseId)?.unit ?? 'kg';
    const convention = loaded.aggregate.exercises.find((e) => e.id === f.sessionExerciseId)?.loadConvention ?? 'total';
    setValues({ ...f.draft, load: v === null ? null : { value: v, unit, convention } });
  }

  async function log() {
    if (!focus || guard || busy || logBlockedBySwitch(switchCard) || focus.logLabel === null) return;
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
      const refusal = logRefusal(r.error);
      if (refusal.clearEdits) setEdits(null);
      setBanners((b) => [...b.filter((x) => x.key !== 'write'), { key: 'write', ...refusal.banner }]);
      return;
    }
    // Already saved by an earlier tap: the saved state is shown, without a second haptic, toast or coach check.
    if (r.duplicate) {
      setEdits(null);
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
    // Table: the saved row slides up and the next open row comes to the top (§2A.4 auto-advance).
    setAfterSetFor(loggedSetId);
    anchorEvent({ kind: 'logged' });
    setEdits(null);
    whyEvent({ kind: 'logged' });
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

  /** `Why?` / `Hide`: a local read through the service; nothing is computed or written here. */
  function toggleWhy(f: FocusView) {
    const opening = why?.setId !== f.setId;
    whyEvent({ kind: 'toggle', setId: f.setId });
    if (!opening) return;
    void services.workout
      .explainTarget(session.id, f.setId)
      .catch(() => null)
      .then((explanation) => {
        whyEvent({ kind: 'loaded', setId: f.setId, explanation });
      });
  }

  /** The pain flag sheet over the workout (§2.14.4); swiping down returns to the same set and draft. */
  function openPainFlag(flagId: string, sessionExerciseId?: string) {
    if (flagId === '') return;
    navigation.navigate('PainFlag', { flagId, sessionId: session.id, ...(sessionExerciseId ? { sessionExerciseId } : {}) });
  }

  /**
   * The off-profile line (audit A3) opens that gym's detail, where `Use
   * changes today` brings an equipment fix into this workout. The typed load
   * is saved as a draft first (the debounced save would be cancelled on
   * leaving), so it is back on return; if that save fails, stay here.
   */
  function openOffProfileEquipment(eq: FocusView['offProfileEquipment']) {
    if (eq === null) return;
    const draft = edits;
    const go = () => {
      navigation.dispatch(openGymFromWorkout(eq.gymId));
    };
    if (draft === null) {
      go();
      return;
    }
    void services.workout
      .dispatch(session.id, saveDraftCommand(draft, services.now()))
      .then((r) => r.ok)
      .catch(() => false)
      .then((ok) => {
        if (ok) go();
        else showToast({ icon: 'exclamationmark.triangle', text: 'Couldn’t save. Try again.' });
      });
  }

  /** Outcomes of `Still hurts` / `Clear flag` in the rest card, as the usual toast. */
  function painOutcome(t: PainToast) {
    changed();
    void reload();
    showToast({ icon: t.icon, text: t.detail ? `${t.text}. ${t.detail}` : t.text, ...(t.action && t.onAction ? { action: t.action, onAction: t.onAction } : {}) });
  }

  async function undo(setId: string, opId: string, setNumber: number) {
    const seq = ++loadSeq.current;
    const fresh = await services.workout.load(session.id);
    const set = fresh?.aggregate.sets.find((s) => s.id === setId);
    if (!fresh || !set) return;
    const r = await services.workout.dispatch(session.id, { type: 'undo_log', at: services.now(), opId, setId, expectedSetVersion: set.version });
    if (!r.ok) {
      showToast({ icon: 'info.circle', text: `Can’t undo: set ${String(setNumber)} changed` });
      return;
    }
    haptic('undo');
    const startedLast = seq === loadSeq.current;
    setData((cur) => newerWorkoutData(cur, { ...fresh, aggregate: r.aggregate }, { startedLast }));
    changed();
    setToast(null);
  }

  function openExerciseMenu(f: FocusView) {
    const howTo = howToRouteFor(f, bundledHowToSources());
    const menu = exerciseMenu(howTo !== null, f.coachActionId === null ? false : f.adjustedBy === 'rule' ? 'rule' : true, { canSwap: f.swappable, canUndoSwap: f.swappedFrom !== null, canRemove: f.removable, hasTargetRpe: f.targetRpe !== null });
    ActionSheetIOS.showActionSheetWithOptions({ title: f.exerciseName, options: menu.options, destructiveButtonIndex: menu.destructiveButtonIndex, cancelButtonIndex: menu.cancelButtonIndex }, (picked) => {
      const action = menu.actionAt(picked);
      if (action === 'how_to' && howTo !== null) navigation.navigate('HowTo', howTo);
      if (action === 'undo_coach' && f.coachActionId !== null) coach.undo(f.coachActionId);
      if (action === 'target_rpe') pickTargetRpe(f);
      if (action === 'add_set') void addSet(f.sessionExerciseId);
      if (action === 'swap') void openSwap(f);
      if (action === 'notes') setNoteFor({ sessionExerciseId: f.sessionExerciseId, exerciseName: f.exerciseName, note: f.note });
      if (action === 'undo_swap' && f.swappedFrom !== null) undoSwap(f.swappedFrom.opId);
      if (action === 'add_exercise') navigation.navigate('ExercisePicker', { sessionId: session.id });
      if (action === 'delete_set') {
        // No confirm (copy D4): it applies at once with Undo.
        const opId = newUuid();
        void run({ type: 'delete_set', at: services.now(), opId, setId: f.setId, expectedSetVersion: f.setVersion }).then((r) => {
          if (r.ok) toastUndoOp(UNDO_TOAST.deleted(f.setNumber), opId, session.id);
          else showToast({ icon: 'info.circle', text: refusalText(r.error.code, r.error.message) });
        });
      }
      if (action === 'remove_exercise') {
        // Added by mistake, nothing logged (exercise-library §4.6): no confirm, Undo on the toast.
        const opId = newUuid();
        void run({ type: 'remove_exercise', at: services.now(), opId, sessionExerciseId: f.sessionExerciseId, expectedVersion: session.version }).then((r) => {
          if (r.ok) toastUndoOp(UNDO_TOAST.removed(f.exerciseName), opId, session.id);
          else showToast({ icon: 'info.circle', text: refusalText(r.error.code, r.error.message) });
        });
      }
      if (action === 'skip_exercise') {
        const opId = newUuid();
        void run({ type: 'skip_exercise', at: services.now(), opId, sessionExerciseId: f.sessionExerciseId }).then((r) => {
          if (r.ok) toastUndoOp(UNDO_TOAST.skipped(f.exerciseName), opId, session.id);
          else showToast({ icon: 'info.circle', text: refusalText(r.error.code, r.error.message) });
        });
      }
    });
  }

  function undoSwap(targetOpId: string) {
    void services.workout.undoOp({ sessionId: session.id, targetOpId }).then((r) => {
      changed();
      void reload();
      if (r.ok) haptic('undo');
      else showToast({ icon: 'info.circle', text: r.message });
    });
  }

  /**
   * `⋯` on a Table card that isn't the current one (§2A.7): the same menu,
   * acting on that exercise; `Target RPE`, `Undo coach change` and `Delete
   * this set` act on its next pending set (review S4). The current card
   * uses `openExerciseMenu` (its open row's set).
   */
  function openCardMenu(sessionExerciseId: string) {
    if (focus !== null && sessionExerciseId === focus.sessionExerciseId) {
      openExerciseMenu(focus);
      return;
    }
    const facts = services.workout.cardFacts(loaded, sessionExerciseId);
    if (facts === null) return;
    const ex = { sessionExerciseId, exerciseId: facts.exerciseId, exerciseName: facts.exerciseName };
    const next = facts.nextSet;
    const howTo = howToRouteFor(ex, bundledHowToSources());
    const menu = exerciseMenu(howTo !== null, facts.coachActionId === null ? false : facts.adjustedBy === 'rule' ? 'rule' : true, { canSwap: facts.swappable, canUndoSwap: facts.swappedFrom !== null, canRemove: facts.removable, hasTargetRpe: next !== null && facts.targetRpe !== null });
    ActionSheetIOS.showActionSheetWithOptions({ title: facts.exerciseName, options: menu.options, destructiveButtonIndex: menu.destructiveButtonIndex, cancelButtonIndex: menu.cancelButtonIndex }, (picked) => {
      const action = menu.actionAt(picked);
      if (action === 'how_to' && howTo !== null) navigation.navigate('HowTo', howTo);
      if (action === 'undo_coach' && facts.coachActionId !== null) coach.undo(facts.coachActionId);
      if (action === 'undo_swap' && facts.swappedFrom !== null) undoSwap(facts.swappedFrom.opId);
      if (action === 'target_rpe' && next !== null) pickTargetRpe({ targetRpe: facts.targetRpe, setId: next.id, sessionExerciseId });
      if (action === 'add_set') void addSet(sessionExerciseId);
      if (action === 'swap') void openSwap(ex);
      if (action === 'notes') setNoteFor({ sessionExerciseId, exerciseName: facts.exerciseName, note: facts.note });
      if (action === 'add_exercise') navigation.navigate('ExercisePicker', { sessionId: session.id });
      if (action === 'delete_set') {
        if (next === null) {
          showToast({ icon: 'info.circle', text: 'No set left to delete' });
          return;
        }
        const opId = newUuid();
        void run({ type: 'delete_set', at: services.now(), opId, setId: next.id, expectedSetVersion: next.version }).then((r) => {
          if (r.ok) toastUndoOp(UNDO_TOAST.deleted(next.number), opId, session.id);
          else showToast({ icon: 'info.circle', text: refusalText(r.error.code, r.error.message) });
        });
      }
      if (action === 'remove_exercise') {
        const opId = newUuid();
        void run({ type: 'remove_exercise', at: services.now(), opId, sessionExerciseId, expectedVersion: session.version }).then((r) => {
          if (r.ok) toastUndoOp(UNDO_TOAST.removed(facts.exerciseName), opId, session.id);
          else showToast({ icon: 'info.circle', text: refusalText(r.error.code, r.error.message) });
        });
      }
      if (action === 'skip_exercise') {
        const opId = newUuid();
        void run({ type: 'skip_exercise', at: services.now(), opId, sessionExerciseId }).then((r) => {
          if (r.ok) toastUndoOp(UNDO_TOAST.skipped(facts.exerciseName), opId, session.id);
          else showToast({ icon: 'info.circle', text: refusalText(r.error.code, r.error.message) });
        });
      }
    });
  }

  /**
   * The exercise name `›` (§2A.7): How to, History, Plates (every load in
   * today's targets), Rest after (the open row's), Notes. At AX1+ the open
   * row's plate line and `Last` move here too (§2A.10, review S2).
   */
  function openExerciseSheet(card: { sessionExerciseId: string; exerciseId: string; name: string; isCurrent: boolean }) {
    const howTo = howToRouteFor({ exerciseId: card.exerciseId, exerciseName: card.name }, bundledHowToSources());
    const ex = loaded.aggregate.exercises.find((e) => e.id === card.sessionExerciseId);
    const facts = services.workout.cardFacts(loaded, card.sessionExerciseId);
    const open = card.isCurrent && focus !== null && focus.sessionExerciseId === card.sessionExerciseId ? focus : null;
    const plates = [...(open !== null && ax && open.plateLine !== null ? [`Now: ${open.plateLine}`] : []), ...(facts?.plates ?? [])].map((x) => x.replaceAll('\u00a0', ' '));
    const items: { label: string; run: () => void }[] = [
      ...(howTo !== null ? [{ label: 'How to', run: () => { navigation.navigate('HowTo', howTo); } }] : []),
      { label: 'History', run: () => { navigation.navigate('ExerciseProgress', { exerciseId: card.exerciseId, name: card.name, ...(ex?.equipmentId ? { equipmentId: ex.equipmentId } : {}) }); } },
      ...(open !== null && ax && open.previous !== null ? [{ label: `Last ${open.previous.text.replaceAll('\u00a0', ' ')}`, run: () => { copyLast(open); } }] : []),
      ...(plates.length > 0 ? [{ label: 'Plates', run: () => { Alert.alert('Plates', plates.join('\n')); } }] : []),
      ...(card.isCurrent && focus !== null ? [{ label: `Rest after ${formatDuration(focus.restAfterS)}`, run: () => { setRestEditor(true); } }] : []),
      { label: 'Notes', run: () => { setNoteFor({ sessionExerciseId: card.sessionExerciseId, exerciseName: card.name, note: ex?.note ?? null }); } },
    ];
    ActionSheetIOS.showActionSheetWithOptions({ title: card.name, options: [...items.map((x) => x.label), 'Cancel'], cancelButtonIndex: items.length }, (i) => {
      items[i]?.run();
    });
  }

  /** `⚠ Pain` on a Table header opens that movement's flag (§2.14.4). */
  function openPainBadge(exerciseId: string) {
    const flag = loaded.painFlags.find((f) => f.exerciseId === exerciseId && f.status === 'active');
    if (flag) openPainFlag(flag.id);
  }

  /** A non-current row (or its ring) only becomes the open row: `set_active_set`, never a log (Ben, decision 4). */
  async function selectRow(setId: string) {
    setAfterSetFor(null);
    // The open row keeps its unsaved edit: saved now, not left to the 300 ms debounce the select would cancel.
    const r = await selectRowFlow({
      setId,
      version: session.version,
      draft: edits !== null ? saveDraftCommand(edits, services.now()) : null,
      at: services.now(),
      opId: newUuid(),
      save: (cmd) => services.workout.dispatch(session.id, cmd),
      select: run,
    });
    if (!r.ok && !r.quiet) showToast({ icon: 'info.circle', text: refusalText(r.code, r.message) });
  }

  async function openSwap(f: Pick<FocusView, 'sessionExerciseId' | 'exerciseName'>) {
    setSwap({ sessionExerciseId: f.sessionExerciseId, exerciseName: f.exerciseName, sheet: null, loading: true });
    const sheet = await services.workout.swapCandidates(session.id, f.sessionExerciseId).catch(() => null);
    setSwap((cur) => (cur?.sessionExerciseId === f.sessionExerciseId ? { ...cur, sheet, loading: false } : cur));
  }

  /** A pick applies at once with Undo (B3); a flagged one asks first (EL9). */
  function pickSwap(row: SwapSheet['rows'][number]) {
    const target = swap;
    if (target === null) return;
    const go = async () => {
      setSwap(null);
      const opId = newUuid();
      const r = await services.workout.swapExercise({ sessionId: session.id, sessionExerciseId: target.sessionExerciseId, exerciseId: row.exerciseId, opId });
      if (!r.ok) {
        showToast({ icon: 'info.circle', text: r.error.code === 'stale_version' || r.error.code === 'write_conflict' ? 'The workout changed. Try again.' : `Not swapped: ${r.error.message}` });
        void reload();
        return;
      }
      setData((cur) => withCommandResult(cur, loaded, r.aggregate));
      changed();
      haptic('step');
      toastUndoOp(UNDO_TOAST.swapped(r.fromName ?? target.exerciseName, r.toName ?? row.name), opId, session.id);
      // `Last` lines are per exercise: read the new row's history.
      void reload();
    };
    if (row.mayHurt !== null) {
      const c = row.mayHurt.confirm;
      Alert.alert(c.title, c.message, [
        { text: c.cancel, style: 'cancel' },
        { text: c.confirm, onPress: () => void go() },
      ]);
      return;
    }
    void go();
  }

  /** Ben's own target RPE (CHANGELOG 2026-10-11): a value, then this set, this exercise or today. Saved on the workout (versioned). */
  function pickTargetRpe(f: Pick<FocusView, 'targetRpe' | 'setId' | 'sessionExerciseId'>) {
    const values = targetRpeMenu(f.targetRpe);
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Target RPE', options: values.options, cancelButtonIndex: values.cancelButtonIndex }, (i) => {
      const rpe = values.valueAt(i);
      if (rpe === undefined) return;
      const scopes = targetRpeScopeMenu(f.setId, f.sessionExerciseId);
      ActionSheetIOS.showActionSheetWithOptions({ options: scopes.options, cancelButtonIndex: scopes.cancelButtonIndex }, (j) => {
        const scope = scopes.scopeAt(j);
        if (scope === null) return;
        const current = latestData.current;
        const expectedVersion = current !== null && current !== 'loading' && current.aggregate.session.id === session.id ? current.aggregate.session.version : session.version;
        void run({ type: 'set_target_rpe', at: services.now(), opId: newUuid(), expectedVersion, scope, rpe }).then((r) => {
          if (!r.ok) showToast({ icon: 'info.circle', text: r.error.code === 'stale_version' ? 'The workout changed. Try again.' : r.error.message });
        });
      });
    });
  }

  async function addSet(sessionExerciseId: string) {
    // Through the service: after a gym switch the set goes on the current gym's equipment, fitted (gym-switch §4.3).
    const r = await services.workout.addSet({ sessionId: session.id, sessionExerciseId, opId: newUuid(), newSetId: newUuid() });
    if (!r.ok) {
      showToast({ icon: 'info.circle', text: r.error.code === 'stale_version' || r.error.code === 'write_conflict' ? 'The workout changed. Try again.' : `Set wasn’t added: ${r.error.message}` });
      void reload();
      return;
    }
    setData((cur) => withCommandResult(cur, loaded, r.aggregate));
    changed();
    const added = r.aggregate.sets.find((x) => !loaded.aggregate.sets.some((y) => y.id === x.id));
    const v = services.workout.view({ ...loaded, aggregate: r.aggregate }, clockNow(), null);
    const n = v.focus?.rows.find((row) => row.setId === added?.id)?.number ?? r.aggregate.sets.filter((x) => x.sessionExerciseId === sessionExerciseId && x.status !== 'deleted').length;
    showToast({ text: `Set ${String(n)} added` });
  }

  // ---- Gym switch (gym-switch.md §4) ----

  function openGymSheet() {
    setGymSheet(null);
    void services.gymSwitch
      .gyms(session.id)
      .then(setGymSheet)
      .catch(() => {
        setGymSheet([]);
      });
  }

  async function proposeGym(gymId: string, gymName: string, fromReviewSheet = false) {
    // The change cap is known before any card is built: say so instead of a card whose Switch can't work (review r2 M1).
    const refusal = gymSwitchRefusal(session);
    if (refusal !== null) {
      setReviewOpen(false);
      setSwitchCard(null);
      showToast({ icon: 'info.circle', text: `Couldn’t switch gym. ${refusal}` });
      return;
    }
    setCheckingGym(gymName);
    try {
      const p = await services.gymSwitch.propose(session.id, gymId);
      // A new card replaces an open one (§3.1 Replaced); a new opId per card. `Check again` on the
      // review sheet keeps it open when the new card still needs it (review r2 N3).
      setReviewOpen(reviewOpenAfterCheckAgain(fromReviewSheet, p));
      setSwitchCard(p ? { proposal: p, opId: newUuid(), status: 'ready' } : null);
      if (!p) showToast({ icon: 'info.circle', text: 'Couldn’t check that gym.' });
    } catch {
      showToast({ icon: 'info.circle', text: 'Couldn’t check that gym.' });
    } finally {
      setCheckingGym(null);
    }
  }

  function chooseGym(g: GymChoice) {
    setGymSheet('closed');
    if (onGymChosen(session.gymId, g.id) === 'dismiss') {
      setSwitchCard(null);
      return;
    }
    void proposeGym(g.id, g.name);
  }

  async function applySwitch(card: OpenSwitchCard) {
    if (card.status === 'applying') return;
    const labelBefore = view?.primary.label ?? '';
    setSwitchCard({ ...card, status: 'applying' });
    let r: CommandOutcome;
    try {
      r = await services.gymSwitch.apply(card.proposal, card.opId);
    } catch (e) {
      r = { ok: false, error: { code: 'write_failed', message: e instanceof Error ? e.message : String(e) } };
    }
    if (!r.ok) {
      // Write error: `Try again` (same opId). Out of date: the reload shows it. Anything else: closed, and said (review r2 M1).
      const next = afterSwitchRefused(card, r.error);
      setSwitchCard(next.card);
      if (next.card === null) setReviewOpen(false);
      if (next.toast !== null) showToast({ icon: 'info.circle', text: next.toast });
      void reload();
      return;
    }
    // GS12 (review M3): an unsaved edit the new equipment can't make is replaced by the new
    // target. Checked against the reducer's result, not the card, since the edit may be newer.
    const replaced = r.aggregate.session.gymChanges?.at(-1)?.draftsReplaced ?? [];
    if (edits !== null && (replaced.includes(edits.setId) || !editFitsCurrentEquipment(r.aggregate, edits.setId, edits.values))) setEdits(null);
    changed();
    // The card stays `applying` (Log blocked, review M2) until the reloaded workout is shown.
    const fresh = await reload();
    setSwitchCard(null);
    setReviewOpen(false);
    const after = fresh ? services.workout.view(fresh, clockNow(), null).primary.label : labelBefore;
    if (logGuardAfterSwitch(labelBefore, after)) armGuard();
    showToast({
      text: switchedToast(card.proposal),
      action: 'Undo',
      onAction: () => void undoSwitch(card.proposal.actionId),
    });
  }

  async function undoSwitch(actionId: string) {
    setToast(null);
    const r = await services.gymSwitch.undo(session.id, `undo-gym:${actionId}`);
    if (r.ok) {
      haptic('undo');
      changed();
      await reload();
      showToast({ icon: 'info.circle', text: undoneToast(r.gymName) });
      return;
    }
    showToast({ icon: 'info.circle', text: r.message });
    // Never a silent revert: a `Switch back to …` card instead (§4.5).
    if (r.back) setSwitchCard({ proposal: r.back, opId: newUuid(), status: 'ready' });
  }

  function onCardButton(id: CardButton) {
    const card = switchCard;
    if (!card) return;
    if (sheetClosesOn(id)) setReviewOpen(false);
    switch (id) {
      case 'not_now':
      case 'dismiss':
        setSwitchCard(null);
        return;
      case 'check_again':
        void proposeGym(card.proposal.toGymId, card.proposal.toGymName, reviewOpen);
        return;
      case 'review':
        setReviewOpen(true);
        return;
      case 'switch':
      case 'try_again':
        void applySwitch(card);
        return;
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
    // Undo takes back this tap's flag (a retraction, not a clear); an older flag isn't this tap's.
    showToast({ icon: 'exclamationmark.triangle', text: `Pain noted · ${f.exerciseName}`, ...(r.flags.length > 0 ? { action: 'Undo', onAction: () => void services.pain.retract(r.flags, newUuid()).then(() => void reload()) } : {}) });
    if (coach.availability?.status === 'ok') coach.ask({ kind: 'chip', chip: 'pain' });
  }

  /**
   * `⋯` (premium-feel §3.2, §10): Pause lives here, not in the header; paused, Resume is the one-tap primary.
   * `Rename workout` isn't offered on an open-ended workout in progress: it's named after Finish (its Summary).
   */
  function topMenu() {
    const run: Record<ReturnType<typeof workoutMenu>[number]['id'], () => void> = {
      view: () => {
        const next = mode === 'table' ? 'focus' : 'table';
        updatePrefs({ workoutView: next });
        // Back in Table: anchored on the open row again (check 10).
        if (next === 'table') anchorEvent({ kind: 'view_switched' });
      },
      pause: () => void pauseOrResume(),
      rename: () => {
        renameOp.current = newUuid();
        setRenameOpen(true);
      },
      gym: openGymSheet,
      coach: openCoach,
      finish: () => {
        setFinishOpen(true);
      },
      edit_times: () => {
        setTimesOpen(true);
      },
      discard: confirmDiscard,
    };
    const items = workoutMenu({ view: mode, paused: session.pause !== null, openEnded: view?.openEnded ?? false, ax, gymName: loaded.gymName }).map((m) => ({ label: m.label, run: run[m.id] }));
    const options = [...items.map((x) => x.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: items.length - 1, cancelButtonIndex: items.length }, (i) => {
      items[i]?.run();
    });
  }

  function openCoach() {
    navigation.navigate('Coach', { entry: { kind: 'workout', sessionId: session.id } });
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
      case 'start_work': {
        // A timed set (§2.7): the work timer runs; its end fills the time to log.
        const durationS = view.primary.durationS;
        return {
          label: view.primary.label,
          onPress: () => {
            if (!focus) return;
            haptic('step');
            void run({ type: 'start_work_interval', at: services.now(), opId: newUuid(), setId: focus.setId, durationS });
          },
        };
      }
      case 'stop_work':
        return {
          label: 'Stop',
          onPress: () => {
            if (!focus) return;
            void run({ type: 'stop_work_interval', at: services.now(), opId: newUuid(), setId: focus.setId });
          },
        };
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

  const effortChips = (
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
  );
  const effortBlock =
    view.justSaved && effortScale !== 'off' ? (
      <View style={{ gap: theme.space['3'] }}>
        <Eyebrow>{effortScale === 'rir' ? 'Reps in reserve' : 'Effort'}</Eyebrow>
        {effortChips}
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

  /** The coach slot's gym card (§2.1): under the rest timer, under the target lines, or under the all-done block. */
  const switchSlot =
    checkingGym !== null ? (
      <StatusLine icon="ellipsis" tone="progress" text={`Checking ${checkingGym}’s equipment…`} />
    ) : switchCard ? (
      <GymSwitchCard view={switchCardView(switchCard, loaded.aggregate)} onButton={onCardButton} />
    ) : null;

  function adjustRest(deltaS: number) {
    if (rest?.kind !== 'running') return;
    void run({ type: 'adjust_rest', at: services.now(), opId: newUuid(), timerId: rest.timerId, deltaS }).then((r) => {
      // −30 s to zero ends the rest here: play the rest-end cue once (review S6).
      const key = r.ok ? restEndCueKey(r.events) : null;
      if (key !== null && !played.current.has(key)) {
        played.current.add(key);
        haptic('restEnd');
      }
    });
  }

  function skipRest() {
    if (rest?.kind !== 'running') return;
    void run({ type: 'skip_rest', at: services.now(), opId: `skip:${rest.timerId}:${String(rest.timerVersion)}`, timerId: rest.timerId }).then((r) => {
      if (r.ok) haptic('undo');
    });
  }

  const restPanel =
    resting ? (
      <View style={{ gap: theme.space['5'] }}>
        <RestPanel
          rest={rest}
          ready={holding}
          upNext={view.upNext !== null ? `Next · ${view.upNext}` : focus === null ? (view.openEnded ? 'Next · add exercise' : null) : null}
          onAdjust={adjustRest}
          onSkip={skipRest}
        />
        {switchSlot}
        {view.justSaved ? (
          <RuledSection>
            {savedLine}
            {recordLine}
            {effortBlock}
            {view.painReview && view.painReview.afterSetId === view.justSaved.setId ? (
              <PainReviewLine
                question={view.painReview.question}
                fact={view.painReview.fact}
                onStillHurts={() => {
                  const r = view.painReview;
                  if (r) void answerStillHurts(services, r.flagId, r.flagVersion, painOutcome);
                }}
                onBetter={() => {
                  const r = view.painReview;
                  if (!r) return;
                  void services.pain.get(r.flagId).then((flag) => {
                    if (flag) confirmClearFlag(services, flag, painOutcome);
                  });
                }}
              />
            ) : null}
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

      <AdjustRow coach={coach} sessionId={session.id} sessionExerciseId={focus.sessionExerciseId} onPain={() => void painFromAdjust(focus)} />
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

      {focus.note !== null ? (
        // Ben's own note on this exercise today: shown as typed; tap to edit.
        <LinkLine
          accessibilityLabel={`Note: ${focus.note}. Tap to edit.`}
          onPress={() => {
            setNoteFor({ sessionExerciseId: focus.sessionExerciseId, exerciseName: focus.exerciseName, note: focus.note });
          }}
        >
          <AppText variant="callout" color="text.secondary" numberOfLines={3}>
            {focus.note}
          </AppText>
        </LinkLine>
      ) : null}

      {focus.warmUp && !hiddenWarmUps.includes(focus.sessionExerciseId) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <AppText variant="callout" color="text.secondary" numeric style={{ flex: 1 }}>
            {`Warm-up · ${focus.warmUp}`}
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
          {focus.workTimer && (focus.workTimer.state === 'running' || focus.workTimer.state === 'paused') ? (
            <View style={{ flex: 1, alignItems: 'flex-start', gap: theme.space['1'] }}>
              <Eyebrow>Work</Eyebrow>
              <TimerNumeral text={workTimerText(focus.workTimer.remainingMs)} accessibilityLabel={`Work time left ${workTimerText(focus.workTimer.remainingMs)}`} />
            </View>
          ) : focus.duration ? (
            <NumberStepper
              inputRef={timeRef}
              flex={1}
              label="Time"
              unit="s"
              value={focus.duration.value}
              decimals={false}
              down={focus.duration.down}
              up={focus.duration.up}
              onChange={(v) => {
                setValues({ ...focus.draft, durationS: v === null ? null : Math.max(0, Math.round(v)) });
              }}
            />
          ) : null}
          {focus.distance ? (
            <NumberStepper
              inputRef={distanceRef}
              flex={1}
              label="Distance"
              unit="m"
              value={focus.distance.value}
              decimals
              down={focus.distance.down}
              up={focus.distance.up}
              onChange={(v) => {
                setValues({ ...focus.draft, distanceM: v === null ? null : Math.max(0, v) });
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
        {/* A timed set before Start: the time in the field can be logged without the timer (review gaps S2). */}
        {view.primary.kind === 'start_work' && view.primary.logLabel !== null ? (
          <View style={{ alignItems: 'flex-start' }}>
            <TextButton label={view.primary.logLabel} onPress={() => void log()} />
          </View>
        ) : null}
        {/* `Target 100 kg · 6–8 reps · Rest after 3:00`: tap to change the rest after this set. `Why?` ends the line (§2.12). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <View style={{ flex: 1 }}>
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
          </View>
          {focus.hasExplanation && !keypadOpen ? (
            <TargetWhyLink
              open={why?.setId === focus.setId}
              onPress={() => {
                toggleWhy(focus);
              }}
            />
          ) : null}
        </View>
        {focus.planWas !== null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {focus.planWas}
          </AppText>
        ) : null}
        {focus.snapNote ? <SnapNote note={focus.snapNote} /> : null}
        {why !== null && why.setId === focus.setId && !keypadOpen ? (
          <TargetWhyPanel
            panel={why}
            onPainFlag={(flagId) => {
              openPainFlag(flagId, focus.sessionExerciseId);
            }}
          />
        ) : null}
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
        {focus.offProfileWarning && focus.offProfileEquipment ? (
          // Audit A3: Log still works; the line opens the equipment to fix the gym.
          <LinkLine
            accessibilityLabel={`${focus.offProfileWarning}. Opens this equipment.`}
            onPress={() => {
              openOffProfileEquipment(focus.offProfileEquipment);
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], minHeight: 44 }}>
              <Icon name="exclamationmark.triangle" color="status.warning" size={16} />
              <AppText variant="callout" color="text.secondary" style={{ flex: 1 }}>
                {focus.offProfileWarning}
              </AppText>
              <Icon name="chevron.right" size={14} color="text.tertiary" />
            </View>
          </LinkLine>
        ) : focus.offProfileWarning ? (
          <StatusLine icon="exclamationmark.triangle" tone="warning" text={focus.offProfileWarning} />
        ) : null}
        {focus.painFlag ? (
          // `PainFlagNote` (§2.14.4): opens the pain flag sheet; it never blocks or changes Log.
          <LinkLine
            accessibilityLabel={focus.painFlag.accessibilityLabel}
            onPress={() => {
              openPainFlag(focus.painFlag?.flagId ?? '', focus.sessionExerciseId);
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], minHeight: 44 }}>
              <Icon name="exclamationmark.triangle" color="status.warning" size={16} />
              <AppText variant="callout" color="text.secondary" style={{ flex: 1 }}>
                {focus.painFlag.text}
              </AppText>
              <Icon name="chevron.right" size={14} color="text.tertiary" />
            </View>
          </LinkLine>
        ) : null}
        {focus.side ? (
          focus.side.kind === 'fixed' ? (
            <AppText variant="callout">{`${focus.side.value === 'left' ? 'Left' : 'Right'} side`}</AppText>
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
        {resting ? null : switchSlot}
      </View>

      <View>
        <View style={{ marginBottom: theme.space['2'] }}>
          <Eyebrow>Sets</Eyebrow>
        </View>
        {focus.rows.map((r, i) => (
          <View key={r.setId}>
            {r.partStart !== null ? <GymPartDivider label={r.partStart} /> : null}
            <SetRowLine
              status={r.status}
              number={r.number}
              badges={r.badges}
              text={r.text}
              caption={setRowCaption(r.gymCaption, r.note)}
              edited={r.edited}
              last={i === focus.rows.length - 1}
              exclusionTag={r.exclusionTag}
              exclusionAccessibility={r.exclusionAccessibility}
              onPress={() => {
                if (r.status === 'done') navigation.navigate('EditSet', { sessionId: session.id, setId: r.setId });
                if (r.status === 'pending') void run({ type: 'set_active_set', at: services.now(), opId: newUuid(), setId: r.setId, expectedVersion: session.version });
              }}
            />
          </View>
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
        {/* The card's last line (AW11): an estimate, never in the top bar; hidden with the keypad. */}
        {timeLeft && !keypadOpen ? (
          <TimeLeftLine
            view={timeLeft.view}
            onPress={() => {
              setTimeLeftOpen(true);
            }}
          />
        ) : null}
      </View>
    </View>
  ) : null;

  // ---- Table view (active-workout §2A) ----
  const tableMode = mode === 'table' && table !== null && view.phase !== 'empty';
  const pill = tableMode ? tableLogLabel(view.primary, table.log, { offscreen: chips.now !== null }) : null;
  const barPrimary = pill === null ? primary : { ...primary, label: pill.label, lead: pill.lead };
  const afterSetSaved = view.justSaved !== null && view.justSaved.setId === afterSetFor ? view.justSaved : null;
  const painReviewNode =
    view.painReview && afterSetSaved && view.painReview.afterSetId === afterSetSaved.setId ? (
      <PainReviewLine
        question={view.painReview.question}
        fact={view.painReview.fact}
        onStillHurts={() => {
          const r = view.painReview;
          if (r) void answerStillHurts(services, r.flagId, r.flagVersion, painOutcome);
        }}
        onBetter={() => {
          const r = view.painReview;
          if (!r) return;
          void services.pain.get(r.flagId).then((flag) => {
            if (flag) confirmClearFlag(services, flag, painOutcome);
          });
        }}
      />
    ) : null;
  const effortHere = afterSetSaved !== null && effortScale !== 'off';
  const afterSetNode =
    tableMode && (effortHere || coach.slot !== null || switchSlot !== null || painReviewNode !== null || recordLine !== null) ? (
      <View style={{ gap: theme.space['3'], paddingVertical: theme.space['3'] }}>
        {switchSlot}
        {effortHere ? (
          <View style={{ gap: theme.space['2'] }}>
            <AppText variant="label" color="text.tertiary">
              {`${afterSetSaved.exerciseName !== focus?.exerciseName ? `${afterSetSaved.exerciseName.toUpperCase()} · ` : ''}SET ${String(afterSetSaved.setNumber)} ${effortScale === 'rir' ? 'REPS IN RESERVE' : 'EFFORT'}`}
            </AppText>
            {effortChips}
          </View>
        ) : null}
        {recordLine}
        {painReviewNode}
        <CoachSlot>{coach.slot !== null ? <CoachSlotContent coach={coach} /> : null}</CoachSlot>
      </View>
    ) : null;
  const afterSetKey = afterSetNode === null ? null : (afterSetSaved?.setId ?? 'slot');
  // The warm-up ramp suggestion in the current card's header (§2A.3), as in Focus, with `Hide`.
  const warmUpNode =
    focus?.warmUp && !hiddenWarmUps.includes(focus.sessionExerciseId) ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <AppText variant="callout" color="text.secondary" numeric style={{ flex: 1 }}>
          {`Warm-up · ${focus.warmUp}`}
        </AppText>
        <TextButton
          label="Hide"
          tone="secondary"
          onPress={() => {
            setHiddenWarmUps((h) => [...h, focus.sessionExerciseId]);
          }}
        />
      </View>
    ) : null;
  const openRowNode = focus ? (
    <OpenSetRow
      focus={focus}
      resting={view.phase === 'resting'}
      ax={ax}
      keypadOpen={keypadOpen}
      caption={restored ? 'Unsaved edit restored' : copied}
      timedLogLabel={view.primary.kind === 'start_work' ? view.primary.logLabel : null}
      whyOpen={why !== null && why.setId === focus.setId}
      whyPanel={
        why !== null && why.setId === focus.setId ? (
          <TargetWhyPanel
            panel={why}
            onPainFlag={(flagId) => {
              openPainFlag(flagId, focus.sessionExerciseId);
            }}
          />
        ) : null
      }
      loadRef={loadRef}
      repsRef={repsRef}
      timeRef={timeRef}
      distanceRef={distanceRef}
      headerRef={openHeaderRef}
      onCopyLast={() => {
        copyLast(focus);
      }}
      onLoad={(v) => {
        editLoad(focus, v);
      }}
      onReps={(v) => {
        setValues({ ...focus.draft, reps: v === null ? null : Math.round(v) });
      }}
      onTime={(v) => {
        setValues({ ...focus.draft, durationS: v === null ? null : Math.max(0, Math.round(v)) });
      }}
      onDistance={(v) => {
        setValues({ ...focus.draft, distanceM: v === null ? null : Math.max(0, v) });
      }}
      onSide={(side) => {
        setValues(focus.draft, side);
      }}
      onWhy={() => {
        toggleWhy(focus);
      }}
      onRestAfter={() => {
        setRestEditor(true);
      }}
      onPainFlag={() => {
        openPainFlag(focus.painFlag?.flagId ?? '', focus.sessionExerciseId);
      }}
      onOffProfile={() => {
        openOffProfileEquipment(focus.offProfileEquipment);
      }}
      onTimedLog={() => void log()}
      onTileFocus={(tile) => {
        if (modeRef.current === 'table') anchorEvent({ kind: 'keypad_opened', tile });
      }}
    />
  ) : null;
  const tableFooter = tableMode ? (
    <>
      {table.allDone ? (
        <View style={{ gap: theme.space['3'] }}>
          <AppText variant="title2" accessibilityRole="header">
            {view.openEnded ? 'Exercise done' : 'All planned sets done.'}
          </AppText>
          {table.anchor === null ? afterSetNode : null}
          {lastExercise ? (
            <View style={{ alignItems: 'flex-start' }}>
              <TextButton label="+ Add set" accessibilityLabel={`Add set to ${lastExercise.name}`} onPress={() => void addSet(lastExercise.sessionExerciseId)} />
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={{ alignItems: 'flex-start', minHeight: theme.target.workout.height, justifyContent: 'center' }}>
        <TextButton
          label="+ Add exercise"
          onPress={() => {
            navigation.navigate('ExercisePicker', { sessionId: session.id });
          }}
        />
      </View>
      {timeLeft && !keypadOpen && !table.allDone ? (
        <TimeLeftLine
          view={timeLeft.view}
          onPress={() => {
            setTimeLeftOpen(true);
          }}
        />
      ) : null}
    </>
  ) : null;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <NumberAccessory />
      {/* Top bar (D-ActiveSet): on the canvas, the workout's name in tracked caps, active time, pause. */}
      <View style={{ paddingTop: insets.top, backgroundColor: theme.colors['bg.canvas'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: theme.space['2'], gap: theme.space['1'] }}>
          <IconButton icon="chevron.down" label="Minimise workout" onPress={close} />
          {tableMode && chips.done ? (
            <View style={{ flex: 1, alignItems: 'flex-start' }}>
              <DoneChip
                count={table.doneCount}
                onPress={() => {
                  tableRef.current?.scrollToTop(!theme.a11y.reduceMotion);
                }}
              />
            </View>
          ) : (
            <AppText variant="sectionLabel" color="text.secondary" numberOfLines={1} style={{ flex: 1, fontSize: 13 }} accessibilityRole="header">
              {view.title}
            </AppText>
          )}
          {/* The gym chip sits in the top bar (§2); at AX1+ it moves into ⋯. */}
          {!ax ? <GymChip gymName={loaded.gymName} onPress={openGymSheet} /> : null}
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

      {tableMode ? (
        <View style={{ flex: 1 }}>
          {banners.length > 0 ? (
            <View style={{ paddingHorizontal: theme.space['4'], gap: theme.space['2'] }}>
              {banners
                .filter((b) => !resting || b.key === 'write')
                .map((b) => (
                  <Banner key={b.key} severity={b.severity} text={b.text} />
                ))}
            </View>
          ) : null}
          <WorkoutTable
            ref={tableRef}
            table={table}
            ax={ax}
            reduceMotion={theme.a11y.reduceMotion}
            openRow={openRowNode}
            afterSet={table.anchor !== null ? afterSetNode : null}
            afterSetKey={table.anchor !== null ? afterSetKey : null}
            adjust={<AdjustButton coach={coach} />}
            warmUp={warmUpNode}
            focusRef={openHeaderRef}
            adjustRow={focus ? <AdjustRow coach={coach} sessionId={session.id} sessionExerciseId={focus.sessionExerciseId} onPain={() => void painFromAdjust(focus)} /> : null}
            footer={tableFooter}
            anchorRequest={anchorRequest}
            keyboardHeight={keyboardHeight}
            onAnchorApplied={() => {
              anchorEvent({ kind: 'applied' });
            }}
            onUserScroll={() => {
              anchorEvent({ kind: 'user_scrolled' });
            }}
            onChips={setChips}
            onEditSet={(setId) => {
              navigation.navigate('EditSet', { sessionId: session.id, setId });
            }}
            onSelectSet={(id) => void selectRow(id)}
            onAddSet={(id) => void addSet(id)}
            onMenu={openCardMenu}
            onName={openExerciseSheet}
            onNote={(sessionExerciseId, exerciseName, note) => {
              setNoteFor({ sessionExerciseId, exerciseName, note });
            }}
            onPainBadge={openPainBadge}
          />
        </View>
      ) : (
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: theme.space['5'], paddingTop: theme.space['3'], gap: theme.space['5'], paddingBottom: theme.space['4'] }} keyboardShouldPersistTaps="handled">
        {/* Paused: the header pill and `REST · PAUSED` say it, no banner (§3.2). During rest only a failed write shows (§3.1). */}
        {banners
          .filter((b) => !resting || b.key === 'write')
          .map((b) => (
            <Banner key={b.key} severity={b.severity} text={b.text} />
          ))}

        {view.phase === 'empty' ? (
          <View style={{ paddingTop: theme.space['4'] }}>
            <HeroHeader size="screen" eyebrow="Empty workout" title="Add your first exercise" />
            {resting ? null : switchSlot}
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
            {resting ? null : switchSlot}
          </View>
        ) : null}
      </ScrollView>
      )}

      {tableMode && chips.now !== null ? (
        <NowChip
          direction={chips.now}
          onPress={() => {
            anchorEvent({ kind: 'now_chip' });
          }}
        />
      ) : null}
      {toast ? <Toast key={toast.id} {...(toast.icon ? { icon: toast.icon } : {})} text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} /> : null}
      {tableMode && rest !== null ? (
        <RestBar
          rest={rest}
          onAdjust={adjustRest}
          onSkip={skipRest}
          onOpen={() => {
            setRestFull(true);
          }}
        />
      ) : null}
      {/* `Chat` + Log (§2): the coach sheet shows its own honest status; Talk replaces Chat once voice ships. */}
      <ActionBar talk={<ChatButton ax={ax} onPress={openCoach} />} primary={barPrimary} guard={guard || logBlockedBySwitch(switchCard)} />

      <Modal
        visible={tableMode && restFull}
        animationType={theme.a11y.reduceMotion ? 'fade' : 'slide'}
        presentationStyle="fullScreen"
        onRequestClose={() => {
          setRestFull(false);
        }}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: insets.top }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: theme.space['2'] }}>
            <IconButton
              icon="chevron.down"
              label="Back to the workout"
              onPress={() => {
                setRestFull(false);
              }}
            />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: theme.space['5'], gap: theme.space['5'], paddingBottom: theme.space['4'] }}>
            {rest !== null ? <RestPanel rest={rest} ready upNext={view.upNext !== null ? `Next · ${view.upNext}` : null} onAdjust={adjustRest} onSkip={skipRest} /> : null}
            {view.justSaved ? (
              <RuledSection>
                {savedLine}
                {effortBlock}
              </RuledSection>
            ) : null}
            <CoachSlot>{coach.slot !== null ? <CoachSlotContent coach={coach} /> : null}</CoachSlot>
          </ScrollView>
          <ActionBar
            primary={{
              ...barPrimary,
              onPress: () => {
                // Log here saves the same set and returns to Table, anchored (WT25).
                setRestFull(false);
                barPrimary.onPress();
              },
            }}
            guard={guard || logBlockedBySwitch(switchCard)}
          />
        </View>
      </Modal>

      <NoteSheet
        visible={noteFor !== null}
        title={`Notes · ${noteFor?.exerciseName ?? ''}`}
        initial={noteFor?.note ?? null}
        onClose={() => {
          setNoteFor(null);
        }}
        onSave={async (note) => {
          if (noteFor === null) return null;
          const r = await services.workout.setNote({ sessionId: session.id, target: { kind: 'exercise', sessionExerciseId: noteFor.sessionExerciseId }, note, expectedVersion: session.version, opId: newUuid() });
          if (!r.ok) {
            void reload();
            return refusalText(r.error.code, r.error.message);
          }
          setData((cur) => withCommandResult(cur, loaded, r.aggregate));
          changed();
          setNoteFor(null);
          return null;
        }}
      />
      <MidSwapSheet
        visible={swap !== null}
        exerciseName={swap?.exerciseName ?? ''}
        sheet={swap?.sheet ?? null}
        loading={swap?.loading ?? false}
        onPick={pickSwap}
        onClose={() => {
          setSwap(null);
        }}
      />
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
                setData((cur) => withCommandResult(cur, loaded, r.aggregate));
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
      <GymSwitcherSheet
        visible={gymSheet !== 'closed'}
        gyms={gymSheet === 'closed' ? null : gymSheet}
        onChoose={chooseGym}
        onClose={() => {
          setGymSheet('closed');
        }}
      />
      <GymReviewSheet
        card={reviewOpen ? switchCard : null}
        aggregate={loaded.aggregate}
        onButton={onCardButton}
        onClose={() => {
          setReviewOpen(false);
        }}
      />
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
        onDismissed={renameAfter.dismissed}      />
      <TimeLeftSheet
        visible={timeLeftOpen}
        view={timeLeft?.view ?? null}
        sheet={timeLeft?.sheet ?? null}
        nowMs={timeLeftNow}
        tz={tz}
        onClose={() => {
          setTimeLeftOpen(false);
        }}
        onFinishBy={async (finishByUtc) => {
          const r = await services.workout.setFinishBy({ sessionId: session.id, finishByUtc, tz, expectedVersion: session.version, opId: newUuid() });
          if (!r.ok) {
            void reload();
            return r.error.code === 'stale_version' ? 'The workout changed. Try again.' : r.error.message;
          }
          setData((cur) => withCommandResult(cur, loaded, r.aggregate));
          changed();
          return null;
        }}
      />
      <StartTimeSheet
        visible={timesOpen}
        data={loaded}
        onClose={() => {
          setTimesOpen(false);
        }}
        onSaved={(d) => {
          setData((cur) => newerWorkoutData(cur, d));
          changed();
          setTimesOpen(false);
          showToast({ text: 'Start time changed' });
        }}
      />
    </KeyboardAvoidingView>
  );
}

/**
 * `PainReviewLine` (active-workout §2.14.2) in the rest card's coach slot:
 * quiet text buttons, ≥ 52 pt and `space.8` apart. Never spoken, never a
 * banner; it isn't the coach and uses no AI. No answer keeps the check due.
 */
function PainReviewLine({ question, fact, onStillHurts, onBetter }: { question: string; fact: string; onStillHurts: () => void; onBetter: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['1'] }}>
      <AppText variant="body">{question}</AppText>
      <AppText variant="callout" color="text.secondary" numeric>
        {fact}
      </AppText>
      <View style={{ flexDirection: 'row', gap: theme.space['8'], minHeight: theme.target.workout.height, alignItems: 'center' }}>
        <TextButton label="Still hurts" onPress={onStillHurts} />
        <TextButton label="Better…" onPress={onBetter} />
      </View>
    </View>
  );
}

function IconButton({ icon, label, onPress, tint = 'text.primary' }: { icon: SymbolName; label: string; onPress: () => void; tint?: 'text.primary' | 'text.secondary' }) {  const theme = useTheme();
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
  caption = null,
  edited,
  last,
  exclusionTag,
  exclusionAccessibility,
  onPress,
}: {
  status: 'done' | 'active' | 'pending' | 'skipped';
  number: number;
  badges: string[];
  text: string;
  /** A done set from another gym: that gym's name, right-aligned (gym-switch §2.5). */
  caption?: string | null;
  edited: boolean;
  last: boolean;
  /** `Spotted` (§2.13): a colourless `Tag`, never hidden. */
  exclusionTag: string | null;
  exclusionAccessibility: string | null;
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
      accessibilityLabel={`Set ${String(number)}${badges.length ? ` ${badges.join(' ')}` : ''}, ${STATUS_WORD[status]}, ${text}${caption !== null ? `, at ${caption}` : ''}${edited ? ', edited' : ''}${exclusionAccessibility ? `. ${exclusionAccessibility}` : ''}`}
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
      {caption !== null ? (
        <AppText variant="callout" color="text.secondary" numberOfLines={1}>
          {caption}
        </AppText>
      ) : null}
      {exclusionTag ? <Tag text={exclusionTag} /> : null}
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
