import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, LayoutAnimation, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { howLongSheet, overviewDoneBy, stepFitMinutes, setsStepFrom, statStripSpoken, type SetsStep, type StepTarget, type TargetExplanation, type TemplateLine } from '@fizz/domain';
import type { CheckIn, CheckInScore } from '@fizz/schemas';

import { useStartAlertsAsk } from '../../alerts/AlertsAskSheet';
import { nowMs as clockNow } from '../../clock';
import { haptic } from '../../device/haptics';
import { newUuid } from '../../device/runtime';
import { formatShortDate } from '../../format/dates';
import { bundledHowToSources, howToRouteFor } from '../../guide/how-to';
import { openStartedWorkout, popToTabs, popToToday, replaceWithWorkouts } from '../../navigation/actions';
import type { LibraryToastParam, RootStackParams } from '../../navigation/types';
import { STALE_PREVIEW, type AddSheet, type DraftWrite, type OverviewData, type OverviewTarget, type SessionList, type SessionPickerRow, type SwapSheet } from '../../services/workout-services';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, BottomCard, ChangeReviewCard, ChangeRoutineLink, CheckInScale, CoachFitStatusCard, EditLink, EditRow, FitCard, FitSuggestionCard, FitWhySheet, HowLongSheet, Icon, NumberAccessory, OverviewRow, PrimaryButton, StatStrip, SubstituteRowView, SupersetBracket, TextButton, Toast, UpdateCard } from '../../ui';
import { bringBackOf, coachFitCardOf, coachFitCardView, FIT_COPY, fitCardCollapsed, howLongOpen, timeTile, type CoachFitCard } from '../../workout/fit-view';
import { createAfterDismiss } from '../../workout/after-dismiss';
import {
  checkInRow,
  checkInRowLayout,
  coachPill,
  coachTapFailedText,
  coachTapOf,
  coachUndoneText,
  eyebrowText,
  gymToastText,
  OVERVIEW_COPY,
  overviewLayout,
  panelReducer,
  rowDetail,
  targetsChanged,
} from '../../workout/overview';
import { checkInAtStart, createGuard, saveScore, scoreStepOf, staleStartToast, startEmptyFromOverview, startFromOverview, undoGymSwitch, type ScoreStep } from '../../workout/overview-start';
import {
  changeCardState,
  createEditLane,
  createOpIds,
  nextDraftVersion,
  stepperCount,
  loadUnchanged,
  queuedWriteLive,
  wroteAfterRead,
  editMenuItems,
  editPills,
  editToast,
  listHeaderText,
  noSwapsText,
  pageToast,
  rowCustomActions,
  defaultChecked,
  EDIT_MODE_COPY,
  editModeToast,
  editMoves,
  editRowCustomActions,
  editTopBar,
  loadPayload,
  typedLoadText,
  updateCardState,
  updateLink,
  type EditRowAction,
  type EditRowPillKey,
  showsWhy,
  swapSubtitle,
  swapTap,
  TODAY_EDITS_COPY,
  type ChangeCard,
  type EditPillKey,
  type RowCustomAction,
} from '../../workout/overview-edits';
import { NameSheet } from '../routines/NameSheet';
import { useSaveToWorkouts } from '../routines/SaveWorkoutSheet';
import { LIBRARY_COPY_UI, LIBRARY_TOASTS } from '../../workout/library-view';
import { isShownRow, SESSION_PICKER_COPY, switchSession } from '../../workout/session-picker';
import { SessionPickerSheet } from './SessionPickerSheet';
import { AddExerciseSheet, LoadSheet, RepsSheet } from './OverviewEditSheets';
import { TargetWhyPanel } from './TargetWhyPanel';

/**
 * The Workout overview (workout-overview.md): what, where, how long and what
 * Ben will lift, before anything is created. One primary action, `Start
 * workout`. Opening it makes no AI call, needs no network and writes nothing;
 * the rows come from the same dry run Start uses (`services.overview.load`).
 * This screen formats and lays out only: every number comes from the domain.
 * Coach rows (§5) read the coach's stored next-session targets only; with
 * none, nothing coach-related renders.
 *
 * Today's edits (overview-today-edits.md): Swap today, Skip today, Do first
 * and Reorder write to the saved pre-start draft at once, each with Undo;
 * the page re-reads what Start will create. `Change Push A too ›` opens a
 * Ben-authored change-review card (Apply, Undo). Nothing here calls the coach.
 */

type Toasting = { text: string; action?: string; onAction?: () => void } | null;

const FADE_STEPS = 7;
/** The Add list searches once typing pauses this long (each search reads up to 40 histories). */
const ADD_SEARCH_PAUSE_MS = 250;

/**
 * Coach swap suggestions Ben tapped `Not now` on, by fit: kept for the app's
 * run so the card stays gone when the page remounts (review C N2). A
 * relaunch shows them again (not stored).
 */
const dismissedCoachSwaps = new Set<string>();
const swapKey = (actionId: string, sg: { slotKey: string; toExerciseId: string }) => `${actionId}:${sg.slotKey}:${sg.toExerciseId}`;

export function WorkoutOverviewScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { fontScale, width: windowWidth } = useWindowDimensions();
  const { stacked } = overviewLayout(fontScale);
  // The check-in row's measured width and its label's (OV14): estimated from the window until measured.
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const [labelWidth, setLabelWidth] = useState<number | null>(null);
  const checkInFit = checkInRowLayout({ available: rowWidth ?? windowWidth - 2 * theme.components.screenMargin, labelWidth, fontScale });
  const routeParams = useRoute<RouteProp<RootStackParams, 'WorkoutOverview'>>().params;
  const routeTarget = routeParams.target;
  // The session shown: the one opened, until Ben picks another from the title (session-picker §4.2, in place).
  const [target, setTarget] = useState<OverviewTarget>(routeTarget);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerList, setPickerList] = useState<SessionList | null | 'loading'>('loading');
  const [pickerAfter] = useState(() => createAfterDismiss());
  const scrollRef = useRef<ScrollView>(null);
  const alertsAsk = useStartAlertsAsk();

  // A score tapped on this page (saved at once, CI4); null until then.
  const [tapped, setTapped] = useState<CheckIn | null>(null);
  const tappedRef = useRef<CheckIn | null>(null);
  tappedRef.current = tapped;
  const [checkInId] = useState(newUuid);
  const [checkInOp] = useState(newUuid);
  // One opId from the first Start tap until success or the page closes: a double tap or a retry starts one workout (OV5).
  const startOp = useRef<string | null>(null);
  // `Empty workout` has its own, also one per page (S2).
  const emptyOp = useRef<string | null>(null);
  // Refs, not state: two taps in one frame both see the old state (S2, S7).
  const [startGuard] = useState(createGuard);
  const [scoreGuard] = useState(createGuard);
  // Coach-row taps: a double tap on Undo sends one (review merge N1).
  const [coachGuard] = useState(createGuard);
  // The latest score write; Start waits for it if it was still running at the tap (B1), and stops if it opened What's up? (r2 S1).
  const scoreWrite = useRef<Promise<ScoreStep | null>>(Promise.resolve(null));
  const [scoring, setScoring] = useState(false);
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
  // Today's edits: one draft write at a time, one opId per intent until it lands (§4.2, §3).
  // Stepper taps queue behind a running write; other taps during one are dropped (review S2).
  const [editGuard] = useState(createEditLane);
  // The draft the last write left: the next write builds on it before the page re-reads (review S2).
  // `seq`: the write count when it landed; a page read records the count it started at (review r2 N2).
  const wroteDraft = useRef<{ id: string; version: number; seq: number } | null>(null);
  const writeSeq = useRef(0);
  const readSeq = useRef(new WeakMap<object, number>());
  // Bumped each time a session switch shows a new page: a queued write tapped on the old one is dropped (review r2 N1).
  const shownPage = useRef(0);
  // Each row's working-set count as its last stepper write left it, with that write's draft version.
  const pendingSets = useRef(new Map<string, { count: number; version: number }>());
  const [ops] = useState(() => createOpIds(newUuid));
  // Edit mode (§11.3, TE11): every row's controls at once; `⋯ → Reorder` opens it too.
  const [editing, setEditing] = useState(false);
  const [repsSlot, setRepsSlot] = useState<string | null>(null);
  const [loadEdit, setLoadEdit] = useState<{ slotKey: string; value: number | null; down: StepTarget; up: StepTarget; note: string | null } | null>(null);
  const addSearch = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [adding, setAdding] = useState<{ query: string; showAll: boolean; sheet: AddSheet | null; loading: boolean } | null>(null);
  // `Update Push A` (§11.5): the lines as the card opened, Ben's ticks, and the record once applied.
  const [update, setUpdate] = useState<{ routineId: string; routineName: string; routineVersion: number; draftId: string; draftVersion: number; lines: TemplateLine[]; checked: Set<string>; applied: string | null } | null>(null);
  const [swap, setSwap] = useState<{ slotKey: string; sheet: SwapSheet | null; loading: boolean } | null>(null);
  const [card, setCard] = useState<ChangeCard | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  // Fit to time (fit-to-time.md): the `How long?` sheet's own state, and the card folded after the first scroll.
  const [howLong, setHowLong] = useState<{ chosen: number | null; other: boolean; info: boolean } | null>(null);
  const [fitFolded, setFitFolded] = useState(false);
  // `Ask coach` (fit-to-time §5): whether it can be tapped, the request running (Cancel, Start cancel it), its card, `Why?`, swaps Ben dismissed.
  const [coachAvailable, setCoachAvailable] = useState(false);
  const coachRun = useRef<AbortController | null>(null);
  const [coachCard, setCoachCard] = useState<CoachFitCard | null>(null);
  const [fitWhy, setFitWhy] = useState<{ reason: string | null; checks: string[]; notUsed: string[] } | null>(null);
  const [dismissedSwaps, setDismissedSwaps] = useState<ReadonlySet<string>>(() => new Set(dismissedCoachSwaps));
  const shownToasts = useRef(new Set<string>());

  const [data, reload] = useScreenData(async (s) => {
    const gym = await s.yourData.currentGym();
    const seq = writeSeq.current;
    const page = await s.overview.load({ target, gymId: gym?.id ?? null, checkInId: tappedRef.current?.id ?? null });
    if (page !== null) readSeq.current.set(page, seq);
    return page;
  });
  const page = data.state === 'ready' ? data.value : null;
  // `Save to Workouts` (routines.md WL6): what the page shows; nothing to save or an out-of-date page says so.
  const saveSheet = useSaveToWorkouts(
    (r) => {
      changed();
      showLibraryToast({ key: r.id, text: LIBRARY_COPY_UI.savedToWorkouts, undo: { kind: 'delete', routineId: r.id, version: r.version } });
    },
    () => {
      setToast({ text: LIBRARY_COPY_UI.nothingToSave });
    },
    () => {
      setToast({ text: STALE_PREVIEW });
      reload();
    },
  );
  // Back from the editor (`Saved Push A` [Undo]): the page re-reads the new version.
  const handedToast = routeParams.toast;
  useEffect(() => {
    if (!handedToast) return;
    reload();
    showLibraryToast(handedToast);
    navigation.setParams({ toast: undefined } as never);
  }, [handedToast?.key]);
  // True from a session switch's first read until its page is shown: row actions would name the new target with the old page (r2 N1).
  const switching = useRef(false);
  useEffect(() => {
    switching.current = false;
    if (data.state === 'ready' && data.value !== null) wroteDraft.current = wroteAfterRead(data.value.draft, wroteDraft.current, readSeq.current.get(data.value));
  }, [data]);

  // Leaving the page cancels a coach fit still running (nothing from it is applied).
  useEffect(
    () => () => {
      coachRun.current?.abort();
    },
    [],
  );
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
  // A reload keeps the open panel only if its row is still there (rows are keyed by slot, TE8).
  useEffect(() => {
    if (page) setOpen((o) => panelReducer(o, { kind: 'rows', rowIds: page.view.rows.map((r) => r.slotKey) }));
  }, [page]);
  // `Earlier edits cleared` / `Plan changed · 1 edit removed`, once.
  useEffect(() => {
    if (!page) return;
    const t = pageToast(page, shownToasts.current);
    if (t === null) return;
    shownToasts.current.add(t.key);
    setToast({ text: t.text });
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
              void undoGymSwitch((id) => services.gyms.select(id), previous).then((message) => {
                if (message !== null) setToast({ text: message });
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
    // Tiles are disabled while a score is written (S7); the guard also drops a second tap in the same frame.
    if (!page || busy || scoreGuard.running()) return;
    const write = scoreGuard.run(async (): Promise<ScoreStep> => {
      setScoring(true);
      try {
        haptic('step');
        const r = await saveScore(
          {
            record: (q) => services.checkIns.record(q),
            update: (id, patch, version, opId) => services.checkIns.update(id, patch, version, opId),
            newOpId: newUuid,
          },
          { current: checkInRow(page.checkIn, tappedRef.current).record, score: n, checkInId, opId: checkInOp },
        );
        if (r.kind === 'stale') {
          // Changed elsewhere: show the latest rather than guess (rule 5).
          reload();
          return 'not_saved';
        }
        if (r.kind === 'failed') {
          setToast({ text: r.message });
          return 'not_saved';
        }
        setTapped(r.checkIn);
        tappedRef.current = r.checkIn;
        changed();
        // At or below the What's up? setting: check-in Step 2 over this page; every exit comes back here.
        const step = scoreStepOf(r, n);
        if (step === 'reasons') navigation.navigate('CheckIn', { mode: 'overview', checkInId: r.checkIn.id });
        return step;
      } finally {
        setScoring(false);
      }
    });
    // Start waits for this write, so it sends the score Ben just tapped (B1).
    scoreWrite.current = write;
    await write;
  }

  async function start() {
    if (!page) return;
    // Start while the coach is fitting: the request is cancelled and nothing from it is applied (§3.4).
    cancelCoachFit();
    // Read at the tap: a score write still running now is the one Start waits for (and stops on if it opens What's up?).
    const pending = scoreGuard.running() ? scoreWrite.current : null;
    await startGuard.run(async () => {
      setBusy(true);
      setStartError(null);
      try {
        const decided = await checkInAtStart(
          { gate: () => services.checkIns.gate(), tapped: () => tappedRef.current },
          { rendered: page.checkIn, pending, nowUtc: () => services.now().utc },
        );
        // What's up? opened over the page (r2 S1), or anything else did: never reset the stack under it.
        if (decided.kind === 'reasons_open' || !navigation.isFocused()) return;
        // First Start ever: the one-time Rest alerts question; either answer continues the same Start.
        await alertsAsk.ensureAsked();
        startOp.current ??= newUuid();
        const checkIn = decided.checkIn;
        const r = await startFromOverview(
          {
            start: (q) => services.overview.start(q),
            reload: () => services.overview.load({ target, gymId: page.view.gym?.id ?? null, checkInId: checkIn?.kind === 'answered' ? checkIn.checkInId : null }),
          },
          { page, opId: startOp.current, checkIn },
        );
        if (r.kind === 'started') {
          changed();
          // Something opened over the page while Start ran (r3 S1): leave the session for Today's Resume, never reset under it.
          if (!navigation.isFocused()) return;
          navigation.dispatch(openStartedWorkout(r.outcome.notice ? { toast: { kind: 'info', text: r.outcome.notice } } : undefined));
        } else if (r.kind === 'stale') {
          // Nothing was created and the page changed: the rows re-render with what Start would make now (rule 5).
          // The re-read that closed a draft at midnight says so (TE5); the next read no longer can (review S2).
          setToast({ text: staleStartToast(r.page) });
          reload();
        } else if (r.kind === 'active') {
          changed();
          navigation.dispatch(popToToday());
        } else setStartError(OVERVIEW_COPY.startFailed);
      } catch {
        setStartError(OVERVIEW_COPY.startFailed);
      } finally {
        setBusy(false);
      }
    });
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
    // Shares Start's guard and keeps one opId per page: a double tap or a retry starts one workout (S2).
    await startGuard.run(async () => {
      setBusy(true);
      setStartError(null);
      try {
        await alertsAsk.ensureAsked();
        emptyOp.current ??= newUuid();
        const r = await startEmptyFromOverview(
          {
            ensureGym: async () => {
              const known = page?.view.gym?.id ?? (await services.yourData.currentGym())?.id ?? null;
              if (known !== null) return known;
              const made = await services.setup.useTypicalGym();
              return made.ok ? (made.gymId ?? null) : null;
            },
            gate: () => services.checkIns.gate(),
            start: (q) => services.workout.start(q),
          },
          emptyOp.current,
        );
        if (r.kind === 'started') {
          changed();
          // Something opened over the page while it ran (r3 S1, merge N4): leave the session for Today's Resume.
          if (!navigation.isFocused()) return;
          navigation.dispatch(openStartedWorkout());
        } else if (r.kind === 'ask') navigation.navigate('CheckIn', { mode: 'start', gymId: r.gymId });
        else if (r.kind === 'active') {
          changed();
          navigation.dispatch(popToToday());
        } else setStartError(OVERVIEW_COPY.startFailed);
      } finally {
        setBusy(false);
      }
    });
  }

  function deleteRoutine() {
    const routine = page?.routine;
    if (!routine) return;
    Alert.alert(`Delete ${routine.name}?`, undefined, [
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
            navigation.dispatch(popToTabs({ screen: 'Today', params: { toast: LIBRARY_TOASTS.deleted(r.routine.name), undoRoutine: { id: r.routine.id, version: r.routine.version } } }));
          });
        },
      },
    ]);
  }

  function menu() {
    const routine = page?.routine ?? null;
    const edits = page ? editMenuItems(page.view) : [];
    // `Save to Workouts` (routines.md WL6): exactly what the page shows, today's edits included.
    const library = routine ? [LIBRARY_COPY_UI.editWorkout, LIBRARY_COPY_UI.duplicate, routine.inRotation ? LIBRARY_COPY_UI.removeFromRotation : LIBRARY_COPY_UI.addToRotation] : [];
    const options = [...edits, ...library, ...(page !== null ? [LIBRARY_COPY_UI.saveToWorkouts] : []), OVERVIEW_COPY.emptyWorkout, ...(routine ? [OVERVIEW_COPY.rename, OVERVIEW_COPY.delete] : []), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1, ...(routine ? { destructiveButtonIndex: options.indexOf(OVERVIEW_COPY.delete) } : {}) }, (i) => {
      const picked = options[i];
      if (picked === TODAY_EDITS_COPY.reorder) {
        setOpen(null);
        setEditing(true);
      }
      if (picked === TODAY_EDITS_COPY.resetEdits) void resetEdits();
      if (picked === LIBRARY_COPY_UI.saveToWorkouts && page !== null) {
        void saveSheet.open({ kind: 'preview', target, gymId: page.view.gym?.id ?? null, checkInId: tappedRef.current?.id ?? null, previewKey: page.view.previewKey }, page.view.title);
      }
      if (picked === LIBRARY_COPY_UI.editWorkout && routine) navigation.navigate('WorkoutEditor', { routineId: routine.id, from: 'WorkoutOverview' });
      if (picked === LIBRARY_COPY_UI.duplicate && routine) void duplicateRoutine(routine.id);
      if ((picked === LIBRARY_COPY_UI.addToRotation || picked === LIBRARY_COPY_UI.removeFromRotation) && routine) void toggleRotation(routine);
      if (picked === OVERVIEW_COPY.emptyWorkout) void startEmpty();
      if (picked === OVERVIEW_COPY.rename) {
        setRenameOp(newUuid());
        setRenameVisible(true);
      }
      if (picked === OVERVIEW_COPY.delete) deleteRoutine();
    });
  }

  /** `Duplicate` (§4.4): the copy opens in the editor (name selected); the toast's Undo deletes it. */
  async function duplicateRoutine(routineId: string) {
    const r = await services.routines.duplicate({ routineId, opId: newUuid() });
    if (!r.ok) {
      setToast({ text: r.message });
      return;
    }
    changed();
    // The toast comes back with Cancel, so its Undo is reachable (review S1).
    const copyToast = { key: r.routine.id, text: LIBRARY_TOASTS.saved(r.routine.name), undo: { kind: 'delete' as const, routineId: r.routine.id, version: r.routine.version } };
    navigation.navigate('WorkoutEditor', { routineId: r.routine.id, from: 'WorkoutOverview', selectName: true, copyToast });
  }

  /** `Add to rotation` / `Remove from rotation` (RT9), with Undo back to the same place. */
  async function toggleRotation(routine: NonNullable<NonNullable<typeof page>['routine']>) {
    const on = !routine.inRotation;
    const r = await services.routines.setRotation({ routineId: routine.id, on, expectedVersion: routine.version, opId: newUuid() });
    if (!r.ok) {
      setToast({ text: r.message });
      reload();
      return;
    }
    changed();
    const done = r.routine;
    setToast({
      text: on ? LIBRARY_TOASTS.added(routine.name) : LIBRARY_TOASTS.removed(routine.name),
      action: LIBRARY_COPY_UI.undo,
      onAction: () => {
        setToast(null);
        void services.routines.setRotation({ routineId: done.id, on: !on, expectedVersion: done.version, opId: newUuid(), placeAtUtc: on ? null : routine.rotationAtUtc }).then((u) => {
          changed();
          if (!u.ok) setToast({ text: u.message });
        });
      },
    });
  }

  /** A library toast (`Saved Push A` [Undo]): Undo reverts an editor save or deletes a new workout. */
  function showLibraryToast(t: LibraryToastParam) {
    const undo = t.undo;
    setToast({
      text: t.text,
      ...(undo
        ? {
            action: LIBRARY_COPY_UI.undo,
            onAction: () => {
              setToast(null);
              const run = undo.kind === 'revert' ? services.routines.revert({ actionId: undo.actionId, opId: newUuid() }) : services.routines.remove({ routineId: undo.routineId, expectedVersion: undo.version, opId: newUuid() });
              void run.then((r) => {
                changed();
                reload();
                if (!r.ok) setToast({ text: r.message });
              });
            },
          }
        : {}),
    });
  }

  /** The title button (session-picker §2.3): the picker, with the shown session checked. Local read only. */
  function openPicker() {
    setPickerList('loading');
    setPickerVisible(true);
    void services.sessions
      .list(page?.view.gym?.id ?? null)
      .catch(() => null)
      .then(setPickerList);
  }

  /**
   * Show another session in place (§4.2): no write and no navigation; its own
   * today's edits come back with it (SP-D6). The new session is read first and
   * the page switches only when it loads (review r2 S1): a session that can't
   * be shown here leaves the current one up, with a short toast. Row actions
   * wait until the new page is shown (r2 N1). Keeps the tapped check-in and
   * the gym (SP11).
   */
  async function switchTo(next: OverviewTarget): Promise<boolean> {
    switching.current = true;
    const gymId = page?.view.gym?.id ?? (await services.yourData.currentGym().catch(() => null))?.id ?? null;
    const done = await switchSession(
      {
        load: (t) => services.overview.load({ target: t, gymId, checkInId: tappedRef.current?.id ?? null }),
        show: (t) => {
          // Reset what belongs to the old page (start op, panel, cards, swap, reorder); keep the tapped check-in and the gym.
          startOp.current = null;
          setOpen(null);
          setCard(null);
          setSwap(null);
          setEditing(false);
          setUpdate(null);
          setRepsSlot(null);
          setLoadEdit(null);
          closeAdd();
          // The fit belongs to the old page: a running coach request is cancelled, the sheet and cards close.
          cancelCoachFit();
          setHowLong(null);
          setFitWhy(null);
          setDismissedSwaps(new Set());
          wroteDraft.current = null;
          pendingSets.current.clear();
          shownPage.current += 1;
          setStartError(null);
          setTarget(t);
          scrollRef.current?.scrollTo({ y: 0, animated: false });
          reload();
        },
      },
      next,
    );
    if (done === 'failed') {
      switching.current = false;
      setToast({ text: SESSION_PICKER_COPY.switchFailed });
    }
    return done === 'switched';
  }

  function pickSession(row: SessionPickerRow) {
    setPickerVisible(false);
    if (page !== null && isShownRow(row, page.startOf)) return;
    void switchTo(row.target);
  }

  async function showWhy(sessionExerciseId: string, name: string) {
    if (switching.current) return;
    // The check-in the rows were planned with: tapped here, else the reused one (review S1).
    const explanation = await services.overview.explain({ target, gymId: page?.view.gym?.id ?? null, checkInId: tappedRef.current?.id ?? page?.planCheckIn?.id ?? null, sessionExerciseId }).catch(() => null);
    setWhy({ name, explanation });
    setWhyVisible(true);
  }

  /**
   * Undo on a coach row, or `Use coach target` / `Apply` to put it back (§5):
   * the same versioned tap as the Summary's `Next time` row. A stale version
   * is refused and the page re-reads (rule 5). One tap at a time (merge N1).
   */
  async function tapCoach(r: OverviewData['view']['rows'][number]) {
    if (!page || r.coach === null || switching.current) return;
    const coach = r.coach;
    const record = page.coachTargets[coach.rowId];
    if (!record) return;
    await coachGuard.run(async () => {
      const done = await services.coach.tapNextTarget(record, coachPill(coach).tap, newUuid()).catch(() => null);
      changed();
      if (done === null || done.status === 'not_possible') {
        setToast({ text: coachTapFailedText(done === null ? 'failed' : done.reason) });
        reload();
        return;
      }
      if (coach.state !== 'coach') return;
      const saved = done.row;
      setToast({
        text: coachUndoneText(r.name),
        action: 'Undo',
        onAction: () => {
          setToast(null);
          void coachGuard.run(async () => {
            const back = await services.coach.tapNextTarget(saved, coachTapOf('built_in', record.status), newUuid()).catch(() => null);
            if (back === null || back.status === 'not_possible') setToast({ text: coachTapFailedText(back === null ? 'failed' : back.reason) });
            changed();
          });
        },
      });
    });
  }

  /**
   * One write to today's draft (§4.2): versioned on the page's draft
   * version, idempotent on the intent's opId (a failed write's retry reuses
   * it). A stale version re-reads the page (rule 5).
   */
  async function writeEdit(
    intent: string | (() => string | null),
    call: (base: { target: typeof target; gymId: string | null; expectedDraftVersion: number | null; opId: string }) => Promise<DraftWrite>,
    version?: number | null,
    opts: { queue?: boolean } = {},
  ): Promise<Extract<DraftWrite, { ok: true }> | null> {
    if (!page || switching.current) return null;
    const tappedOn = shownPage.current;
    const result = await editGuard.run(async () => {
      if (!queuedWriteLive(tappedOn, shownPage.current, switching.current)) return null;
      // A queued tap names its intent when its turn comes (a stepper steps from the count the last write left).
      const named = typeof intent === 'string' ? intent : intent();
      if (named === null) return null;
      const base = { target, gymId: page.view.gym?.id ?? null, expectedDraftVersion: version === undefined ? nextDraftVersion(page.draft, wroteDraft.current) : version, opId: ops.of(named) };
      const w = await call(base).catch(() => null);
      if (w === null || (!w.ok && w.reason === 'failed')) {
        setToast({ text: TODAY_EDITS_COPY.editFailed });
        return null;
      }
      ops.done(named);
      // Before `changed()`: the re-read it starts counts as after this write.
      writeSeq.current += 1;
      changed();
      if (!w.ok) {
        // The service says which: the plan moved (`Targets updated`), or only the draft did (`Couldn't save that edit.`).
        if (w.reason === 'stale') {
          wroteDraft.current = null;
          pendingSets.current.clear();
        }
        setToast({ text: w.reason === 'stale' ? w.message : TODAY_EDITS_COPY.editFailed });
        return null;
      }
      // `Fits already` writes nothing (no draft): no haptic for it (review C N5).
      if (w.draft !== null) {
        wroteDraft.current = { id: w.draft.id, version: w.draft.version, seq: writeSeq.current };
        haptic('step');
      }
      return w;
    }, opts);
    return result ?? null;
  }

  /** The toast after an edit: its `Undo` sends the matching undo at the version this write left (§4.1). */
  function toastWithUndo(text: string, undo: (version: number | null) => Promise<unknown>, version: number | null) {
    setToast({
      text,
      action: TODAY_EDITS_COPY.undo,
      onAction: () => {
        setToast(null);
        void undo(version);
      },
    });
  }

  const undoEdit = (editId: string, version?: number | null) => writeEdit(`undo:${editId}`, (b) => services.overview.undoEdit({ ...b, editId }), version);
  const clearSwap = (slotKey: string) => writeEdit(`clear-swap:${slotKey}`, (b) => services.overview.clearSwap({ ...b, slotKey }));
  const restoreEdits = (editIds: readonly string[], version?: number | null) => writeEdit(`restore:${editIds.join(',')}`, (b) => services.overview.restoreEdits({ ...b, editIds }), version);

  async function skipRow(r: OverviewData['view']['rows'][number]) {
    const w = await writeEdit(`skip:${r.slotKey}`, (b) => services.overview.edit({ ...b, edit: { kind: 'skip', slotKey: r.slotKey } }));
    const added = w?.added[0];
    if (w && added !== undefined) toastWithUndo(editToast.skipped(r.name), (v) => undoEdit(added, v), w.draft?.version ?? null);
  }

  async function moveRow(r: OverviewData['view']['rows'][number], how: 'first' | 'up' | 'down') {
    const w = await writeEdit(`move:${how}:${r.slotKey}`, (b) => services.overview.move({ ...b, slotKey: r.slotKey, how }));
    const added = w?.added[0];
    if (how === 'first' && w && added !== undefined) toastWithUndo(editToast.first(r.name), (v) => undoEdit(added, v), w.draft?.version ?? null);
  }

  async function openSwap(slotKey: string) {
    if (!page || switching.current) return;
    setSwap({ slotKey, sheet: null, loading: true });
    const sheet = await services.overview.swapCandidates({ target, gymId: page.view.gym?.id ?? null, checkInId: tappedRef.current?.id ?? page.planCheckIn?.id ?? null, slotKey }).catch(() => null);
    setSwap((cur) => (cur?.slotKey === slotKey ? { slotKey, sheet, loading: false } : cur));
  }

  async function pickSwap(row: SwapSheet['rows'][number]) {
    if (!page || !swap) return;
    const slotKey = swap.slotKey;
    const current = page.view.rows.find((r) => r.slotKey === slotKey);
    const tap = swapTap(row);
    const go = async () => {
      setSwap(null);
      if (tap === 'undo') {
        // `<original> · planned` is the plan itself, however many swaps were chained on the slot (S1).
        await clearSwap(slotKey);
        return;
      }
      const from = current?.edit?.kind === 'swapped' ? current.edit.fromName : (current?.name ?? '');
      const w = await writeEdit(`swap:${slotKey}:${row.exerciseId}`, (b) => services.overview.edit({ ...b, edit: { kind: 'swap', slotKey, toExerciseId: row.exerciseId } }));
      const added = w?.added[0];
      if (w && added !== undefined) toastWithUndo(editToast.swapped(from, row.name), (v) => undoEdit(added, v), w.draft?.version ?? null);
    };
    if (tap === 'confirm' && row.mayHurt !== null) {
      // EL9: a flagged candidate asks first; `Choose another` keeps the sheet open and changes nothing.
      const c = row.mayHurt.confirm;
      Alert.alert(c.title, c.message, [
        { text: c.cancel, style: 'cancel' },
        { text: c.confirm, onPress: () => void go() },
      ]);
      return;
    }
    await go();
  }

  function editPill(r: OverviewData['view']['rows'][number], key: EditPillKey) {
    if (key === 'swap') void openSwap(r.slotKey);
    if (key === 'skip') void skipRow(r);
    if (key === 'do_first') void moveRow(r, 'first');
    if (key === 'undo_swap') void clearSwap(r.slotKey);
    if (key === 'bring_back') void bringBack(r);
  }

  function customAction(r: OverviewData['view']['rows'][number], name: RowCustomAction['name']) {
    if (name === 'swap') void openSwap(r.slotKey);
    if (name === 'skip') void skipRow(r);
    if (name === 'bring_back') void bringBack(r);
    if (name === 'do_first') void moveRow(r, 'first');
    if (name === 'move_up') void moveRow(r, 'up');
    if (name === 'move_down') void moveRow(r, 'down');
  }

  /** `Bring back` (§2.2): Undo of the skip; on a row the fit skipped, Ben's own sets edit, so the trim leaves it alone (fit-to-time FT5). */
  async function bringBack(r: OverviewData['view']['rows'][number]) {
    const b = bringBackOf(r);
    if (b === null) return;
    if (b.kind === 'undo') {
      await undoEdit(b.editId);
      return;
    }
    await writeEdit(`keep:${b.slotKey}`, (x) => services.overview.edit({ ...x, edit: { kind: 'sets', slotKey: b.slotKey, workingSets: b.workingSets } }));
  }

  // -------------------------------------------------------------------------
  // Fit to time (fit-to-time.md): `How long?` on the TIME tile, the built-in trim, the card's Undo and Change.

  function openHowLong() {
    if (!page || switching.current) return;
    setHowLong(howLongOpen(page.view.fit));
    // Settings only, no network: `Ask coach` is disabled with `Coach offline` when the coach can't be reached (FT-C9).
    void services.overview
      .coachFitAvailable()
      .catch(() => false)
      .then(setCoachAvailable);
  }

  /**
   * `Ask coach` (FT6): applied at once with the coach card and Undo when it
   * passes the checks (rule 3: Ben asked). The page stays usable while it
   * works; an edit or Start meanwhile discards the answer.
   */
  async function askCoach(minutes: number) {
    if (!page || switching.current || coachRun.current !== null) return;
    setHowLong(null);
    const run = new AbortController();
    coachRun.current = run;
    setCoachCard({ kind: 'pending', minutes });
    const intent = `coach-fit:${String(minutes)}:${page.view.previewKey}`;
    const r = await services.overview
      .requestCoachFit({
        target,
        gymId: page.view.gym?.id ?? null,
        checkInId: tappedRef.current?.id ?? page.planCheckIn?.id ?? null,
        expectedDraftVersion: nextDraftVersion(page.draft, wroteDraft.current),
        previewKey: page.view.previewKey,
        minutes,
        opId: ops.of(intent),
        signal: run.signal,
      })
      .catch(() => ({ kind: 'failed' as const }));
    // Cancelled (or Start) while it worked: nothing to show. The service refuses the write once cancelled; a fit whose write was
    // already under way when Cancel landed is taken back with its Undo, so nothing Ben cancelled stays (review C B1).
    if (coachRun.current !== run) {
      if (r.kind === 'applied' && !r.duplicate) void services.overview.undoCoachFit({ actionId: r.actionId, opId: `cancelled-coach-fit:${r.actionId}` }).catch(() => null);
      return;
    }
    coachRun.current = null;
    if (r.kind !== 'failed' && r.kind !== 'cancelled') ops.done(intent);
    // The coach couldn't be reached: the sheet shows `Ask coach` disabled with `Coach offline` next time (FT-C9; review C S5).
    if (r.kind === 'unavailable') setCoachAvailable(false);
    if (r.kind === 'applied') {
      setFitFolded(false);
      writeSeq.current += 1;
      changed();
    }
    setCoachCard(coachFitCardOf(r, minutes));
  }

  function cancelCoachFit() {
    coachRun.current?.abort();
    coachRun.current = null;
    setCoachCard(null);
  }

  /** The coach fit's Undo (§5.3): every edit it made, in one write; a trim it replaced comes back. */
  async function undoCoachFit(actionId: string) {
    const intent = `undo-coach-fit:${actionId}`;
    const r = await services.overview.undoCoachFit({ actionId, opId: ops.of(intent) }).catch(() => null);
    if (r === null) {
      setToast({ text: TODAY_EDITS_COPY.editFailed });
      return;
    }
    ops.done(intent);
    writeSeq.current += 1;
    changed();
    if (!r.ok) setToast({ text: TODAY_EDITS_COPY.editFailed });
  }

  /** A coach swap suggestion's `Apply` (FT-C12): Ben's own swap, today only, with Undo. */
  async function applySuggestion(sg: { slotKey: string; toExerciseId: string; text: string }) {
    const w = await writeEdit(`swap:${sg.slotKey}:${sg.toExerciseId}`, (b) => services.overview.edit({ ...b, edit: { kind: 'swap', slotKey: sg.slotKey, toExerciseId: sg.toExerciseId } }));
    const added = w?.added[0];
    if (w && added !== undefined) toastWithUndo(`${sg.text} · today`, (v) => undoEdit(added, v), w.draft?.version ?? null);
  }

  /** `Trim to 45 min`: the fit applies at once to the draft (offline, FT2); the toast's Undo takes it back. */
  async function trimTo(minutes: number) {
    setHowLong(null);
    const w = await writeEdit(`fit:${String(minutes)}`, (b) => services.overview.trimToFit({ ...b, minutes }));
    const added = w?.added[0];
    if (w && added !== undefined) {
      setFitFolded(false);
      toastWithUndo(FIT_COPY.toast(minutes), (v) => undoEdit(added, v), w.draft?.version ?? null);
    }
  }

  async function clearFit() {
    setHowLong(null);
    await writeEdit('clear-fit', (b) => services.overview.clearFit(b));
  }

  async function resetEdits() {
    const w = await writeEdit('reset', (b) => services.overview.resetEdits(b));
    if (w && w.removed.length > 0) toastWithUndo(editToast.editsReset, (v) => restoreEdits(w.removed, v), w.draft?.version ?? null);
  }

  // -------------------------------------------------------------------------
  // Edit mode (§11): sets, reps, today's load, add, remove. Each applies at once; steppers show no toast (TE14).

  type Row = OverviewData['view']['rows'][number];

  async function stepSets(r: Row, tapped: NonNullable<Row['editRow']['setsUp']>) {
    const delta = tapped.workingSets > r.editRow.workingSets ? 1 : -1;
    // Worked out when its turn comes, from the count the previous tap's write left (review S2).
    const chosen: { step: SetsStep } = { step: null };
    const intent = (): string | null => {
      const from = stepperCount(r.editRow.workingSets, page?.draft?.version ?? null, pendingSets.current.get(r.slotKey));
      const step = setsStepFrom(from, delta, r.editRow.clearsAt);
      chosen.step = step;
      if (step === null) return null;
      return step.clear ? `sets:${r.slotKey}` : `sets:${r.slotKey}:${String(step.workingSets)}`;
    };
    const w = await writeEdit(
      intent,
      (b) => {
        const s = chosen.step;
        if (s === null) return Promise.resolve<DraftWrite>({ ok: false, reason: 'invalid', message: TODAY_EDITS_COPY.editFailed });
        // Back at the plan's count clears the edit (`−` undoes `+` in place).
        return s.clear ? services.overview.clearEdit({ ...b, kind: 'sets', slotKey: r.slotKey }) : services.overview.edit({ ...b, edit: { kind: 'sets', slotKey: r.slotKey, workingSets: s.workingSets } });
      },
      undefined,
      { queue: true },
    );
    const done = chosen.step;
    if (w !== null && w.draft !== null && done !== null) pendingSets.current.set(r.slotKey, { count: done.workingSets, version: w.draft.version });
  }

  async function doneReps(r: Row, payload: { kind: 'clear' } | { kind: 'reps'; reps: { min: number; max: number } | null; durationS: number | null }) {
    setRepsSlot(null);
    if (payload.kind === 'clear') {
      if (r.editRow.repsEdited) await writeEdit(`reps-clear:${r.slotKey}`, (b) => services.overview.clearEdit({ ...b, kind: 'reps', slotKey: r.slotKey }));
      return;
    }
    await writeEdit(`reps:${r.slotKey}:${JSON.stringify(payload)}`, (b) => services.overview.edit({ ...b, edit: { kind: 'reps', slotKey: r.slotKey, reps: payload.reps, durationS: payload.durationS } }));
  }

  async function openLoad(r: Row) {
    const k = r.editRow.keypad;
    if (k === null || switching.current) return;
    const steps = await services.overview.loadKeypad({ equipmentId: k.equipmentId, unit: k.unit, convention: k.convention, value: k.value }).catch(() => null);
    setLoadEdit({ slotKey: r.slotKey, value: k.value, down: steps?.down ?? { enabled: false, reason: '' }, up: steps?.up ?? { enabled: false, reason: '' }, note: steps?.note ?? null });
  }

  async function typeLoad(r: Row, value: number | null) {
    const k = r.editRow.keypad;
    if (k === null) return;
    setLoadEdit((cur) => (cur?.slotKey === r.slotKey ? { ...cur, value } : cur));
    const steps = await services.overview.loadKeypad({ equipmentId: k.equipmentId, unit: k.unit, convention: k.convention, value }).catch(() => null);
    if (steps !== null) setLoadEdit((cur) => (cur?.slotKey === r.slotKey && cur.value === value ? { ...cur, ...steps } : cur));
  }

  async function setLoad(r: Row) {
    const k = r.editRow.keypad;
    const value = loadEdit?.value ?? null;
    setLoadEdit(null);
    if (k === null || value === null || loadUnchanged(r.editRow, value)) return;
    const load = loadPayload(value, k);
    if (load === null) return;
    const w = await writeEdit(`load:${r.slotKey}:${String(value)}`, (b) => services.overview.edit({ ...b, edit: { kind: 'load', slotKey: r.slotKey, load } }));
    const added = w?.added[0];
    if (w && added !== undefined) toastWithUndo(editModeToast.target(typedLoadText(load)), (v) => undoEdit(added, v), w.draft?.version ?? null);
  }

  async function usePlannedLoad(r: Row) {
    setLoadEdit(null);
    await writeEdit(`load-clear:${r.slotKey}`, (b) => services.overview.clearEdit({ ...b, kind: 'load', slotKey: r.slotKey }));
  }

  async function removeAdded(r: Row) {
    if (r.edit?.kind !== 'added') return;
    const w = await undoEdit(r.edit.editId);
    if (w && w.removed.length > 0) toastWithUndo(editModeToast.removed(r.name), (v) => restoreEdits(w.removed, v), w.draft?.version ?? null);
  }

  function closeAdd() {
    if (addSearch.current !== null) clearTimeout(addSearch.current);
    addSearch.current = null;
    setAdding(null);
  }

  /** Typing in the Add list: the field updates at once; the search runs once typing pauses (review N4). */
  function typeAdd(query: string) {
    const showAll = adding?.showAll ?? false;
    setAdding((cur) => (cur === null ? cur : { ...cur, query, loading: true }));
    if (addSearch.current !== null) clearTimeout(addSearch.current);
    addSearch.current = setTimeout(() => {
      addSearch.current = null;
      void loadAdd(query, showAll);
    }, ADD_SEARCH_PAUSE_MS);
  }

  async function loadAdd(query: string, showAll: boolean) {
    if (!page) return;
    setAdding((cur) => ({ query, showAll, sheet: cur?.sheet ?? null, loading: true }));
    const sheet = await services.overview.addCandidates({ target, gymId: page.view.gym?.id ?? null, checkInId: tappedRef.current?.id ?? page.planCheckIn?.id ?? null, query, showAll }).catch(() => null);
    // Only the latest search lands.
    setAdding((cur) => (cur !== null && cur.query === query && cur.showAll === showAll ? { query, showAll, sheet, loading: false } : cur));
  }

  async function pickAdd(row: AddSheet['rows'][number]) {
    const go = async () => {
      closeAdd();
      const w = await writeEdit(`add:${row.exerciseId}`, (b) => services.overview.edit({ ...b, edit: { kind: 'add', exerciseId: row.exerciseId } }));
      const added = w?.added[0];
      if (w && added !== undefined) toastWithUndo(editModeToast.added(row.name), (v) => undoEdit(added, v), w.draft?.version ?? null);
    };
    if (row.mayHurt !== null) {
      // EL9: a flagged exercise asks first; `Choose another` keeps the list open.
      const c = row.mayHurt.confirm;
      Alert.alert(c.title, c.message, [
        { text: c.cancel, style: 'cancel' },
        { text: c.confirm, onPress: () => void go() },
      ]);
      return;
    }
    await go();
  }

  function editRowPill(r: Row, key: EditRowPillKey) {
    if (key === 'swap') void openSwap(r.slotKey);
    if (key === 'skip') void skipRow(r);
    if (key === 'bring_back') void bringBack(r);
    if (key === 'remove') void removeAdded(r);
  }

  function editRowAction(r: Row, name: EditRowAction['name']) {
    if (name === 'add_set' && r.editRow.setsUp) void stepSets(r, r.editRow.setsUp);
    if (name === 'remove_set' && r.editRow.setsDown) void stepSets(r, r.editRow.setsDown);
    if (name === 'change_reps') setRepsSlot(r.slotKey);
    if (name === 'change_target') void openLoad(r);
    if (name === 'move_up') void moveRow(r, 'up');
    if (name === 'move_down') void moveRow(r, 'down');
    if (name === 'swap' || name === 'skip' || name === 'bring_back' || name === 'remove') editRowPill(r, name);
  }

  /** `Update Push A ›` → the card, with skips unticked (TE15). `Save to Workouts ›` on a next session. */
  function openUpdate() {
    if (!page) return;
    const link = updateLink(page);
    if (link?.kind === 'save') {
      void saveSheet.open({ kind: 'preview', target, gymId: page.view.gym?.id ?? null, checkInId: tappedRef.current?.id ?? null, previewKey: page.view.previewKey }, page.view.title);
      return;
    }
    const c = page.templateCard;
    if (c === null) return;
    setUpdate({ routineId: c.routineId, routineName: c.routineName, routineVersion: c.routineVersion, draftId: c.draftId, draftVersion: c.draftVersion, lines: c.lines, checked: defaultChecked(c.lines), applied: null });
  }

  /** Apply (§11.5): the checked lines, versioned on the workout and on the draft the card was built from (rule 5, review B3). */
  async function applyUpdate() {
    const u = update;
    if (!page || u === null) return;
    const draft = { id: u.draftId, version: u.draftVersion };
    await editGuard.run(async () => {
      setCardBusy(true);
      try {
        const intent = `update:${u.routineId}:${String(u.routineVersion)}`;
        const r = await services.routines
          .applyTodayEdits({ target, gymId: page.view.gym?.id ?? null, checkInId: tappedRef.current?.id ?? page.planCheckIn?.id ?? null, routineId: u.routineId, expectedRoutineVersion: u.routineVersion, draft: { id: draft.id, expectedVersion: draft.version }, lineKeys: [...u.checked], opId: ops.of(intent) })
          .catch(() => null);
        if (r === null) {
          setToast({ text: TODAY_EDITS_COPY.editFailed });
          return;
        }
        ops.done(intent);
        changed();
        if (!r.ok) {
          // Out of date: the card turns `Was suggested:` once the page re-reads; anything else says so.
          if (r.reason !== 'stale') setToast({ text: r.message });
          else if (page.routine?.version === u.routineVersion) setToast({ text: STALE_PREVIEW });
          return;
        }
        const actionId = r.action.actionId;
        setUpdate({ ...u, applied: actionId });
        haptic('step');
        setToast({
          text: editModeToast.updated(u.routineName),
          action: TODAY_EDITS_COPY.undo,
          onAction: () => {
            setToast(null);
            void undoUpdate(actionId, u.routineName);
          },
        });
      } finally {
        setCardBusy(false);
      }
    });
  }

  async function undoUpdate(actionId: string, routineName: string) {
    await editGuard.run(async () => {
      const r = await services.routines.revert({ actionId, opId: ops.of(`undo-update:${actionId}`) }).catch(() => null);
      if (r === null) {
        setToast({ text: TODAY_EDITS_COPY.editFailed });
        return;
      }
      ops.done(`undo-update:${actionId}`);
      changed();
      if (!r.ok) {
        setToast({ text: r.reason === 'changed_since' ? editToast.cantUndo(routineName) : r.message });
        return;
      }
      setUpdate(null);
    });
  }

  /** `Change Push A too ›` → Apply (TE4): the routine from now on, with its own Undo. Versioned on the routine the card was opened on. */
  async function applyCard(c: ChangeCard) {
    const routine = page?.routine;
    if (!page || !routine || c.state !== 'ready') return;
    await editGuard.run(async () => {
      setCardBusy(true);
      try {
        const opId = ops.of(`apply:${c.slotKey}:${String(c.routineVersion)}`);
        const r = await services.routines.applyTemplateSwap({ routineId: routine.id, expectedRoutineVersion: c.routineVersion, slotKey: c.slotKey, toExerciseId: c.toExerciseId, draft: page.draft === null ? null : { id: page.draft.id, editId: c.editId }, opId }).catch(() => null);
        if (r === null) {
          setToast({ text: TODAY_EDITS_COPY.editFailed });
          return;
        }
        ops.done(`apply:${c.slotKey}:${String(c.routineVersion)}`);
        changed();
        if (!r.ok) {
          // Out of date: the card turns `Was suggested:` once the page re-reads.
          if (r.reason !== 'stale') setToast({ text: r.message });
          return;
        }
        const actionId = r.action.actionId;
        setCard({ ...c, state: 'applied', actionId });
        haptic('step');
        setToast({
          text: editToast.routineChanged(routine.name),
          action: TODAY_EDITS_COPY.undo,
          onAction: () => {
            setToast(null);
            void undoCard(actionId, routine.name);
          },
        });
      } finally {
        setCardBusy(false);
      }
    });
  }

  async function undoCard(actionId: string, routineName: string) {
    await editGuard.run(async () => {
      const r = await services.routines.undoTemplateSwap({ actionId, opId: ops.of(`undo-apply:${actionId}`) }).catch(() => null);
      if (r === null) {
        setToast({ text: TODAY_EDITS_COPY.editFailed });
        return;
      }
      ops.done(`undo-apply:${actionId}`);
      changed();
      if (!r.ok) {
        setToast({ text: r.reason === 'changed_since' ? editToast.cantUndo(routineName) : r.message });
        return;
      }
      setCard(null);
    });
  }

  function toggle(rowId: string) {
    // The panel opens in place; with Reduce Motion it appears without the height animation (§8).
    if (!theme.a11y.reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(theme.timing.fast, 'easeOut', 'opacity'));
    setOpen((o) => panelReducer(o, { kind: 'toggle', rowId }));
  }

  // The gym chip grows with its text (minHeight, never a fixed height); at AX sizes it moves under the bar (OV14).
  const gymChip = page ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={page.view.gym ? `Gym: ${page.view.gym.name}. Change gym.` : OVERVIEW_COPY.addGym}
      onPress={chooseGym}
      style={{ minHeight: 44, justifyContent: 'center', flexShrink: 1 }}
    >
      <View style={{ minHeight: 34, paddingHorizontal: 14, paddingVertical: 4, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.control'], flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
        <AppText variant="label" style={{ flexShrink: 1 }}>
          {page.view.gym?.name ?? OVERVIEW_COPY.addGym}
        </AppText>
        {page.view.gym ? <Icon name="chevron.down" color="text.secondary" size={10} /> : null}
      </View>
    </Pressable>
  ) : null;

  // Edit mode's bar (§11.3): `Reset` (only with edits) and `Done`; Start stays live below.
  const editBar = (
    <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.components.screenMargin }}>
      {page !== null && editTopBar(page.view).reset ? <TextButton label={EDIT_MODE_COPY.reset} tone="secondary" accessibilityLabel={TODAY_EDITS_COPY.resetEdits} onPress={() => void resetEdits()} /> : <View />}
      <TextButton
        label={EDIT_MODE_COPY.done}
        onPress={() => {
          setEditing(false);
          // An unapplied card closes with Edit mode: reopened, it is built from the draft as it is then (review B3).
          setUpdate((u) => (u === null || u.applied === null ? null : u));
        }}
      />
    </View>
  );

  const topBar = editing && page ? (
    editBar
  ) : (
    <>
      <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: theme.space['2'], paddingRight: theme.space['3'] }}>
        <Pressable accessibilityRole="button" accessibilityLabel={OVERVIEW_COPY.close} onPress={close} hitSlop={4} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevron.down" color="text.primary" size={20} weight="semibold" />
        </Pressable>
        {page ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], flexShrink: 1 }}>
            {stacked ? null : gymChip}
            <TextButton
              label={EDIT_MODE_COPY.edit}
              accessibilityLabel="Edit today’s workout"
              onPress={() => {
                setOpen(null);
                setEditing(true);
              }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={menu} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="ellipsis" color="text.primary" size={20} />
            </Pressable>
          </View>
        ) : null}
      </View>
      {stacked && gymChip ? <View style={{ paddingHorizontal: theme.components.screenMargin, alignItems: 'flex-start' }}>{gymChip}</View> : null}
    </>
  );

  // The picker, also reachable when the page can't load (session-picker §5, r2 S1): no ✓ then.
  const pickerSheet = (
    <SessionPickerSheet
      visible={pickerVisible}
      list={pickerList}
      now={services.now()}
      shown={page?.startOf ?? null}
      onPick={pickSession}
      onClose={() => {
        setPickerVisible(false);
      }}
      onRetry={openPicker}
      onEmptyWorkout={() => {
        pickerAfter.arm(() => void startEmpty());
        setPickerVisible(false);
      }}
      onPastWorkouts={() => {
        pickerAfter.arm(() => {
          navigation.navigate('PastWorkouts');
        });
        setPickerVisible(false);
      }}
      onEditWorkouts={() => {
        pickerAfter.arm(() => {
          navigation.dispatch(replaceWithWorkouts());
        });
        setPickerVisible(false);
      }}
      onDismissed={pickerAfter.dismissed}
    />
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
          <TextButton label={SESSION_PICKER_COPY.changeSession} tone="secondary" onPress={openPicker} />
          <TextButton label={OVERVIEW_COPY.emptyWorkout} tone="secondary" onPress={() => void startEmpty()} />
        </View>
        {pickerSheet}
      </View>,
    );
  }

  const { view } = page;
  const done = view.estimate === null ? null : overviewDoneBy(now, view.estimate.seconds, services.now().tz);
  // The TIME tile is the `How long?` button (fit-to-time FT1), in normal and Edit mode.
  const tile = timeTile(view, OVERVIEW_COPY.time);
  const stats = [
    ...(view.estimate !== null && done !== null && tile !== null
      ? [
          { value: String(view.estimate.minutes), approx: true, suffix: 'min', label: tile.label, clock: tile.clock, button: { onPress: openHowLong, accessibilityLabel: tile.accessibilityLabel } },
          { value: done.text, approx: true, label: OVERVIEW_COPY.doneBy, spoken: `Done about ${done.text}` },
        ]
      : []),
    { value: String(view.workingSets), label: OVERVIEW_COPY.sets, spoken: `${String(view.workingSets)} working ${view.workingSets === 1 ? 'set' : 'sets'}` },
  ];
  const sheet =
    howLong === null
      ? null
      : howLongSheet({
          nowSeconds: view.estimate?.seconds ?? null,
          nowMinutes: view.estimate?.minutes ?? null,
          unfittedSeconds: view.fit?.beforeSeconds ?? view.estimate?.seconds ?? null,
          fitMinutes: view.fit?.minutes ?? null,
          chosen: howLong.chosen,
          coachAvailable,
          pace: page.pace,
        });
  const lastRowId = view.rows.at(-1)?.slotKey;
  const routineName = page.routine?.name ?? null;

  /** `Change Push A too ›`, or its change-review card, at the end of the swapped row's panel (§2.5). */
  const rowFooter = (r: (typeof view.rows)[number]) => {
    if (routineName === null) return null;
    if (card?.slotKey === r.slotKey) {
      return (
        <ChangeReviewCard
          state={changeCardState(card, page.routine?.version ?? null)}
          routineName={routineName}
          fromName={card.fromName}
          toName={card.toName}
          busy={cardBusy}
          onApply={() => void applyCard(card)}
          onNotNow={() => {
            setCard(null);
          }}
          onUndo={() => {
            if (card.state === 'applied') void undoCard(card.actionId, routineName);
          }}
          onDismiss={() => {
            setCard(null);
          }}
        />
      );
    }
    const edit = r.edit;
    if (!r.actions.changeRoutine || edit?.kind !== 'swapped' || !page.routine) return null;
    const version = page.routine.version;
    return (
      <ChangeRoutineLink
        routineName={routineName}
        onPress={() => {
          setCard({ slotKey: r.slotKey, routineVersion: version, fromName: edit.fromName, toName: r.name, toExerciseId: r.exerciseId, editId: edit.editId, state: 'ready' });
        }}
      />
    );
  };

  const renderRow = (r: (typeof view.rows)[number], firstInGroup: boolean) => {
    const howTo = howToRouteFor({ exerciseId: r.exerciseId, exerciseName: r.name }, bundledHowToSources());
    const flagId = r.painFlag?.id;
    const gymId = view.gym?.id;
    return (
      <OverviewRow
        key={r.slotKey}
        row={r}
        detail={rowDetail(r, stacked)}
        open={open === r.slotKey}
        stacked={stacked}
        first={firstInGroup}
        last={r.slotKey === lastRowId}
        editPills={editPills(r)}
        onEditPill={(key) => {
          editPill(r, key);
        }}
        showWhy={showsWhy(r)}
        customActions={rowCustomActions(r)}
        onCustomAction={(name) => {
          customAction(r, name);
        }}
        footer={rowFooter(r)}
        onToggle={() => {
          toggle(r.slotKey);
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
        onCoach={
          // A skipped row has no coach pill (§2.2: `Bring back` and `How to` only).
          r.coach !== null && showsWhy(r)
            ? () => {
                void tapCoach(r);
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

  const moves = editMoves(view.groups);
  const link = updateLink(page);
  const renderEditRow = (r: (typeof view.rows)[number]) => {
    const m = moves.get(r.slotKey) ?? null;
    return (
      <EditRow
        key={r.slotKey}
        row={r}
        moves={m}
        stacked={stacked}
        last={r.slotKey === lastRowId}
        customActions={editRowCustomActions(r, m)}
        onSets={(step) => void stepSets(r, step)}
        onReps={() => {
          setRepsSlot(r.slotKey);
        }}
        onLoad={() => void openLoad(r)}
        onPill={(key) => {
          editRowPill(r, key);
        }}
        onMove={(how) => void moveRow(r, how)}
        onCustomAction={(name) => {
          editRowAction(r, name);
        }}
      />
    );
  };
  const repsRow = repsSlot === null ? null : (view.rows.find((r) => r.slotKey === repsSlot) ?? null);
  const loadRow = loadEdit === null ? null : (view.rows.find((r) => r.slotKey === loadEdit.slotKey) ?? null);

  const body = (
    <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={100}
      onScroll={(e) => {
        const y = e.nativeEvent.contentOffset.y;
        if (view.fit !== null && !fitFolded && fitCardCollapsed(fitFolded, y)) setFitFolded(true);
      }}
      contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingBottom: theme.space['8'] }}
    >
      <AppText variant="sectionLabel" color="text.tertiary" style={{ marginTop: 10 }}>
        {eyebrowText(view.basis, (ms, tz) => formatShortDate(ms, tz))}
      </AppText>
      {/* The title is a button (session-picker §2.3): `Shoulders ▾` opens the picker; VoiceOver "Shoulders. Change session." */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${view.title}. ${SESSION_PICKER_COPY.changeSession}.`}
        onPress={openPicker}
        style={({ pressed }) => ({ minHeight: 44, marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', opacity: pressed ? 0.6 : 1 })}
      >
        <AppText variant="title1" accessibilityRole="header" style={{ fontSize: 40, lineHeight: 46, letterSpacing: -0.8 }}>
          {view.title}
          <AppText variant="title1" color="text.secondary" style={{ fontSize: 28, lineHeight: 46 }}>
            {' ▾'}
          </AppText>
        </AppText>
      </Pressable>
      <View style={{ marginTop: theme.space['4'] }}>
        <StatStrip items={stats} ax={stacked} accessibilityLabel={statStripSpoken(view.estimate?.minutes ?? null, done?.text ?? null, view.workingSets)} />
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
      {coachCard !== null ? (
        (() => {
          const c = coachCard;
          const trimWouldCut = howLongSheet({ nowSeconds: view.estimate?.seconds ?? null, nowMinutes: view.estimate?.minutes ?? null, unfittedSeconds: view.fit?.beforeSeconds ?? view.estimate?.seconds ?? null, fitMinutes: view.fit?.minutes ?? null, chosen: c.minutes, coachAvailable: false }).trim.enabled;
          const v = coachFitCardView(c, trimWouldCut);
          return (
            <CoachFitStatusCard
              text={v.text}
              offline={v.offline}
              actions={v.actions}
              onAction={(a) => {
                if (a === 'cancel') cancelCoachFit();
                if (a === 'dismiss') setCoachCard(null);
                if (a === 'why' && c.kind === 'rejected') setFitWhy({ reason: null, checks: [], notUsed: c.reasons });
                if (a === 'trim') {
                  setCoachCard(null);
                  void trimTo(c.minutes);
                }
                if (a === 'ask_again') {
                  setCoachCard(null);
                  void askCoach(c.minutes);
                }
              }}
            />
          );
        })()
      ) : null}
      {view.fit !== null ? (
        <FitCard
          fit={view.fit}
          collapsed={fitFolded}
          onExpand={() => {
            setFitFolded(false);
          }}
          onUndo={() => {
            const fit = view.fit;
            if (fit === null) return;
            if (fit.by === 'coach' && fit.actionId !== null) void undoCoachFit(fit.actionId);
            else void undoEdit(fit.editId);
          }}
          onChange={openHowLong}
          onWhy={
            view.fit.by === 'coach' && page.coachFit !== null
              ? () => {
                  const cf = page.coachFit;
                  if (cf !== null) setFitWhy({ reason: cf.reason, checks: cf.checks, notUsed: cf.rejected });
                }
              : undefined
          }
        />
      ) : null}
      {(page.coachFit?.suggestions ?? [])
        .filter((sg) => !dismissedSwaps.has(swapKey(page.coachFit?.actionId ?? '', sg)))
        .map((sg) => (
          <FitSuggestionCard
            key={`${sg.slotKey}:${sg.toExerciseId}`}
            text={sg.text}
            busy={false}
            onApply={() => void applySuggestion(sg)}
            onNotNow={() => {
              const k = swapKey(page.coachFit?.actionId ?? '', sg);
              dismissedCoachSwaps.add(k);
              setDismissedSwaps((d) => new Set([...d, k]));
            }}
          />
        ))}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, paddingBottom: theme.space['2'] }}>
        <AppText variant="sectionLabel" color="text.tertiary">
          {listHeaderText(view)}
        </AppText>
        <AppText variant="sectionLabel" color="text.tertiary">
          {OVERVIEW_COPY.target}
        </AppText>
      </View>
      {editing
        ? [
            ...view.groups.map((g) =>
              g.kind === 'single' ? (
                renderEditRow(g.row)
              ) : (
                <SupersetBracket key={g.rows.map((r) => r.slotKey).join('+')}>{g.rows.map((r) => renderEditRow(r))}</SupersetBracket>
              ),
            ),
            <EditLink key="add" text={EDIT_MODE_COPY.addExercise} icon="plus" onPress={() => void loadAdd('', false)} />,
            ...(link !== null && update === null ? [<EditLink key="update" text={link.text} onPress={openUpdate} />] : []),
            ...(update !== null
              ? [
                  (() => {
                    const st = updateCardState(update, { routineVersion: page.routine?.version ?? null, draftVersion: page.draft?.version ?? null }, update.checked);
                    return (
                      <UpdateCard
                        key="update-card"
                        state={st.state}
                        routineName={update.routineName}
                        lines={update.lines}
                        checked={update.checked}
                        applyEnabled={st.applyEnabled}
                        busy={cardBusy}
                        onToggle={(key) => {
                          setUpdate((u) => {
                            if (u === null) return u;
                            const next = new Set(u.checked);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return { ...u, checked: next };
                          });
                        }}
                        onApply={() => void applyUpdate()}
                        onNotNow={() => {
                          setUpdate(null);
                        }}
                        onUndo={() => {
                          if (update.applied !== null) void undoUpdate(update.applied, update.routineName);
                        }}
                        onDismiss={() => {
                          setUpdate(null);
                        }}
                      />
                    );
                  })(),
                ]
              : []),
          ]
        : view.groups.map((g) =>
            g.kind === 'single' ? (
              renderRow(g.row, false)
            ) : (
              <SupersetBracket key={g.rows.map((r) => r.slotKey).join('+')}>{g.rows.map((r, i) => renderRow(r, i === 0))}</SupersetBracket>
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
        <View
          style={{ paddingTop: theme.space['2'] }}
          onLayout={(e) => {
            setRowWidth(e.nativeEvent.layout.width);
          }}
        >
          {checkInFit === 'collapsed' ? (
            <TextButton
              label={row.selected === null ? `${OVERVIEW_COPY.checkIn} ›` : `${OVERVIEW_COPY.checkIn} · ${String(row.selected)} ›`}
              disabled={busy || scoring}
              onPress={() => {
                navigation.navigate('CheckIn', { mode: 'overview', checkInId: row.record?.id ?? null, atScore: true });
              }}
            />
          ) : (
            // Label beside the tiles when both fit the measured width, else above them (B2).
            <View style={{ flexDirection: checkInFit === 'inline' ? 'row' : 'column', alignItems: checkInFit === 'inline' ? 'center' : 'flex-start', justifyContent: 'space-between', rowGap: theme.space['2'] }}>
              <View
                onLayout={(e) => {
                  setLabelWidth(e.nativeEvent.layout.width);
                }}
              >
                <AppText variant="sectionLabel" color="text.tertiary">
                  {OVERVIEW_COPY.checkIn}
                </AppText>
              </View>
              <CheckInScale selected={row.selected} disabled={busy || scoring} onPick={(n) => void pickScore(n)} />
            </View>
          )}
        </View>
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
        visible={swap !== null}
        onClose={() => {
          setSwap(null);
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space['3'] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="title2" accessibilityRole="header">
              {swap?.sheet ? `Swap ${swap.sheet.plannedName}` : `Swap ${view.rows.find((r) => r.slotKey === swap?.slotKey)?.name ?? ''}`}
            </AppText>
            {swap?.sheet ? (
              <AppText variant="callout" color="text.secondary">
                {swapSubtitle(swap.sheet.gymName)}
              </AppText>
            ) : null}
          </View>
          <TextButton
            label={TODAY_EDITS_COPY.close}
            tone="secondary"
            onPress={() => {
              setSwap(null);
            }}
          />
        </View>
        {swap?.sheet && swap.sheet.rows.length > 0 ? (
          <ScrollView>
            <View style={{ alignItems: 'flex-end', paddingBottom: theme.space['1'] }}>
              <AppText variant="sectionLabel" color="text.tertiary">
                {OVERVIEW_COPY.target}
              </AppText>
            </View>
            {swap.sheet.rows.map((row) => (
              <SubstituteRowView key={`${row.exerciseId}:${String(row.planned)}`} row={row} stacked={stacked} onPress={() => void pickSwap(row)} />
            ))}
          </ScrollView>
        ) : swap?.sheet ? (
          <AppText variant="body" color="text.secondary">
            {noSwapsText(swap.sheet.gymName)}
          </AppText>
        ) : swap?.loading === false ? (
          <AppText variant="body" color="text.secondary">
            {OVERVIEW_COPY.loadFailed}
          </AppText>
        ) : null}
      </BottomCard>
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
      <RepsSheet
        row={repsRow}
        onDone={(payload) => {
          if (repsRow) void doneReps(repsRow, payload);
        }}
        onUsePlanned={() => {
          if (repsRow) void doneReps(repsRow, { kind: 'clear' });
        }}
        onClose={() => {
          setRepsSlot(null);
        }}
      />
      <LoadSheet
        row={loadRow}
        keypad={loadEdit}
        onValue={(v) => {
          if (loadRow) void typeLoad(loadRow, v);
        }}
        onSet={() => {
          if (loadRow) void setLoad(loadRow);
        }}
        onUsePlanned={() => {
          if (loadRow) void usePlannedLoad(loadRow);
        }}
        onClose={() => {
          setLoadEdit(null);
        }}
      />
      <AddExerciseSheet
        visible={adding !== null}
        sheet={adding?.sheet ?? null}
        loading={adding?.loading ?? false}
        query={adding?.query ?? ''}
        stacked={stacked}
        onQuery={typeAdd}
        onShowAll={() => void loadAdd(adding?.query ?? '', true)}
        onPick={(r) => void pickAdd(r)}
        onClose={() => {
          closeAdd();
        }}
      />
      <HowLongSheet
        visible={howLong !== null}
        sheet={sheet}
        otherOpen={howLong?.other ?? false}
        infoOpen={howLong?.info ?? false}
        busy={false}
        onChip={(m) => {
          setHowLong((h) => (h === null ? h : { ...h, chosen: m, other: false }));
        }}
        onOther={() => {
          setHowLong((h) => (h === null ? h : { ...h, other: true, chosen: h.chosen ?? sheet?.selected ?? null }));
        }}
        onStep={(d) => {
          setHowLong((h) => (h === null || sheet === null ? h : { ...h, chosen: stepFitMinutes(h.chosen ?? sheet.selected, d) }));
        }}
        onInfo={() => {
          setHowLong((h) => (h === null ? h : { ...h, info: !h.info }));
        }}
        onTrim={() => {
          if (sheet?.trim.enabled === true) void trimTo(sheet.trim.minutes);
        }}
        onAsk={() => {
          if (sheet?.ask.enabled === true) void askCoach(sheet.selected);
        }}
        onClear={() => void clearFit()}
        onClose={() => {
          setHowLong(null);
        }}
      />
      <FitWhySheet
        visible={fitWhy !== null}
        reason={fitWhy?.reason ?? null}
        checks={fitWhy?.checks ?? []}
        notUsed={fitWhy?.notUsed ?? []}
        onClose={() => {
          setFitWhy(null);
        }}
      />
      <NumberAccessory />
      {pickerSheet}
      {saveSheet.sheet}
      {page.routine ? (
        <NameSheet
          visible={renameVisible}
          title="Rename workout"
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
