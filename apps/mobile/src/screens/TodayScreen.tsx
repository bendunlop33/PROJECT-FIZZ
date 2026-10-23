import { useFocusEffect, useNavigation, useRoute, type NavigationProp, type ParamListBase, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deriveId, discardCommand, discardConfirmation, doneTodayDurationLine, formatDuration, reasonsText, scoreText, stepTimeMinutes, TODAY_V2_COPY, toMs, type ResumeRow, type StripCell, type TodayMain } from '@fizz/domain';
import type { Activity, SessionAggregate, SessionCheckIn } from '@fizz/schemas';
import { activitySavedToast } from '../activity/activity-toast';
import { ActivitySheet, type ActivitySaved } from './activity/ActivitySheet';

import { useStartAlertsAsk } from '../alerts/AlertsAskSheet';
import { nowMs as clockNow } from '../clock';
import { newUuid } from '../device/runtime';
import { formatShortDate, formatTime } from '../format/dates';
import { openYourPlan } from '../navigation/actions';
import type { TabParams } from '../navigation/types';
import { DeleteToastView } from '../history/DeleteToastView';
import { useDeleteToast } from '../history/useDeleteToast';
import { TODAY_SESSION_COPY, type TodaySelection, type TodaySessionData } from '../services/today-session';
import { firstTime, useDataChanged, useDataVersion, useLaunchInfo, useScreenData, useServices } from '../shell/context';
import { loadBanners } from '../shell/system-banners';
import { useInstallStatus } from '../shell/useInstallStatus';
import { listEnterMotion, TIMING, useTheme } from '../theme';
import { followLatestDraft, todayActions, todayCardReducer, todaySegments, todayTitle, TODAY_SCREEN_COPY, type TodayCardState } from '../today/today-view';
import { AppText, Eyebrow, FadeIn, HeroHeader, Icon, LinkLine, PrimaryButton, RowText, SecondaryButton, StatusLine, TextButton, Toast, type SymbolName } from '../ui';
import { BannerList } from './BannerList';
import { createAfterDismiss } from '../workout/after-dismiss';
import { FinishSheet } from './workout/FinishSheet';
import { GymChip } from './workout/GymSwitch';
import { DayControl, DaySheet, SessionCard, SessionListSheet, TodayHeader, WeekStrip } from './today/TodaySession';
import { builderApplyOpId, type BuilderCoachReach } from '@fizz/coach';
import { setTodaySetupDay } from '../builder/coach-ports';
import type { NudgeResult } from '../coach/builder-coach-service';
import { nudgeCardView, todayAskFirst, todayAskRoute } from '../coach/builder-coach-view';
import { CoachAskBar } from '../ui/coach-ask-bar';
import { TimeDetailSheet } from '../ui/time-stepper';
import { createOnDeviceSpeech } from '../voice/on-device-speech';

/**
 * Today (v2) (workout-builder-v3 §2.0 with Ben's 20 Oct additions; prototypes/today-v2.html): `Tuesday`
 * with the gym and a compact `✦ Coach` + mic, the 7-day strip (3 back, 3 ahead: only what Ben did,
 * logged or told the coach), the rare lines (banners, check-in, pain check), then Today's session: the
 * day control (the plan's days, or with no plan Profile › Split's; `NEXT`, `⋯` other workouts), the lean
 * session card (rows, Time with its fit note, Why?, one-tap Start and Edit; D3, V5); `Build your own` and
 * `＋ Activity` below. Resume and the stale card replace the session while a workout is open (today.md,
 * unchanged).
 *
 * The card's workout comes from `todaySession` (the builder rules); this screen only lays it out and
 * keeps the selection. Picking a day, chip or control writes nothing; Start commits the card as
 * today's builder draft and starts it (check-in sheet when due). Supersedes today.md's Up next card,
 * alternatives, Recent and Ask pill (§2.0.9, §7).
 */

/** An empty workout, or (No plan) the app's Up next: its routine or the last workout's next session (review today-fix-21oct B1). */
type StartIntent = { kind: 'empty' } | { kind: 'routine'; routineId: string } | { kind: 'next'; sourceSessionId: string };
type Nav = NavigationProp<ParamListBase>;

/** Today's `Reviews ›` taps this run: each lands Progress on Reviews again (review b3-wave3-ux S9). */
let reviewsTaps = 0;

export function TodayScreen() {
  const theme = useTheme();
  // Today is a bare tab screen (no native stack, so no navigation controller): `contentInsetAdjustmentBehavior`
  // never insets it for the status bar, and the header ran under the clock (Ben, 21 Oct). It pads itself, as
  // Library does.
  const insets = useSafeAreaInsets();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<TabParams, 'Today'>>();
  const install = useInstallStatus();
  const launch = useLaunchInfo();
  const [interrupted, setInterrupted] = useState(() => launch.restoreInterrupted && firstTime('restore-interrupted'));
  // One opId per Start intent, kept until it succeeds: a double tap or retry starts one workout.
  const startOps = useRef(new Map<string, string>());
  const timeBusy = useRef(false);
  const timeWritten = useRef<{ draftId: string; version: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; action?: string; onAction?: () => void } | null>(null);
  const deleted = useDeleteToast();
  const [now, setNow] = useState(clockNow);
  const [finishFor, setFinishFor] = useState<SessionAggregate | null>(null);
  const [finishVisible, setFinishVisible] = useState(false);
  const [afterDismiss] = useState(() => createAfterDismiss());
  const alertsAsk = useStartAlertsAsk();
  const [data, reloadScreen] = useScreenData(async (s) => {
    const [gym, view, banners, active, unlinked] = await Promise.all([s.yourData.currentGym(), s.today.view(), loadBanners(s, install), s.sessions.active(), s.checkIns.unlinked()]);
    return { gym, view, banners, active, unlinked };
  });
  // Today's session loads on its own (review S1): Resume, stale and the banners never wait for it, and it isn't read
  // at all while a workout is open (the card is hidden then).
  const workoutOpen = data.state === 'ready' && data.value.active !== null;
  const [session, reloadSession, sessionFailed] = useTodaySessionData(data.state === 'ready' && !workoutOpen);
  const reload = useCallback(() => {
    reloadScreen();
    reloadSession();
  }, [reloadScreen, reloadSession]);
  const [activitySheet, setActivitySheet] = useState<{ activity: Activity | null } | null>(null);
  const [daySheet, setDaySheet] = useState<StripCell | null>(null);
  const [listSheet, setListSheet] = useState<'other' | 'all' | null>(null);
  // The Time note's detail (fit-to-time 22 Oct revision): what the fit changed, and Undo back to the plan's length.
  const [timeDetail, setTimeDetail] = useState(false);
  const [listAfter] = useState(() => createAfterDismiss());

  const [selection, setSelection] = useState<TodayCardState | null>(null);
  // The builder coach (§2.0.5, §6.1): its reach for the bar, the card's pre-session nudge, Mix it up picks.
  const [reach, setReach] = useState<BuilderCoachReach>('not_connected');
  const [speech] = useState(createOnDeviceSpeech);
  const [nudge, setNudge] = useState<{ key: string; result: NudgeResult } | null>(null);
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const nudgeAsked = useRef<string | null>(null);

  // The card's selection: the plan's next day on open (or as Ben left it while the data reloads). Once today's
  // workout is done, no day is selected until Ben picks one for a second session (§2.0.4 Done today).
  const wasDone = useRef<boolean | null>(null);
  // (D3) When each day's latest draft was last seen: a newer one from Your workout (its Main lift) moves the card to it.
  const seenDraft = useRef<Readonly<Record<string, string>>>({});
  useEffect(() => {
    if (session === null) return;
    const justDone = wasDone.current === false && session.doneToday;
    wasDone.current = session.doneToday;
    const seen = seenDraft.current;
    seenDraft.current = Object.fromEntries(Object.entries(session.latestDraft).map(([k, v]) => [k, v.atUtc]));
    setSelection((cur) => {
      if (justDone) return null;
      if (cur !== null && session.initial[cur.dayKey] !== undefined) return followLatestDraft(cur, session.latestDraft[cur.dayKey], seen[cur.dayKey], session.initial[cur.dayKey]?.mainLiftExerciseId);
      const key = session.doneToday ? null : (session.nextKey ?? (session.status === 'no_plan' ? null : (session.days[0]?.key ?? null)));
      const initial = key === null ? undefined : session.initial[key];
      return key === null || initial === undefined ? null : { dayKey: key, controls: initial, open: false, why: false };
    });
  }, [session]);

  const act = (a: Parameters<typeof todayCardReducer>[1]) => {
    setSelection((cur) => (cur === null ? cur : todayCardReducer(cur, a)));
  };
  const pickDay = (key: string) => {
    const initial = session?.initial[key];
    if (initial === undefined) return;
    setSelection((cur) => todayCardReducer(cur ?? { dayKey: key, controls: initial, open: false, why: false }, { kind: 'day', dayKey: key, initial }));
  };

  const cardKey = selection === null ? null : `${selection.dayKey}|${selection.controls.mainLiftExerciseId ?? '-'}`;
  // The nudge is for the card as Ben has set it (wiring S1, integrity S2): its offer is dropped once a control moves.
  const nudgeKey = selection === null || cardKey === null ? null : `${cardKey}|${JSON.stringify(selection.controls)}`;
  const coachIn = useMemo(() => ({ nudge: nudge !== null && nudge.key === nudgeKey ? nudge.result : null }), [nudge, nudgeKey]);
  const view = useMemo(() => (session === null || selection === null ? null : services.todaySession.card(session, { dayKey: selection.dayKey, controls: selection.controls }, coachIn)), [services, session, selection, coachIn]);

  // The bar's status word, and Set up words asked here start from the card's day.
  useEffect(() => {
    void services.builderCoach
      .status()
      .catch((): BuilderCoachReach => 'not_connected')
      .then(setReach);
  }, [services, session]);
  const cardDayId = view === null || session === null ? null : ([...session.days, ...session.others].find((d) => d.key === view.dayKey)?.splitDayId ?? null);
  useEffect(() => {
    setTodaySetupDay(cardDayId);
  }, [cardDayId]);

  // The pre-session nudge (§6.1): once per day and plan day, on the plan's next day as it opens. Silent unless a clear
  // real signal; never applied without Apply (rule 3). The card's draft is saved first (the coach reviews that draft).
  useEffect(() => {
    // Only with the coach reachable: offline the card already says `Not reviewed · Offline`, and nothing is written.
    if (reach !== 'ok' || session === null || selection === null || session.doneToday || session.nextKey === null || selection.dayKey !== session.nextKey || nudgeKey === null) return;
    const key = `${session.localDate}|${nudgeKey}|${session.gymId ?? '-'}`;
    if (nudgeAsked.current === key) return;
    nudgeAsked.current = key;
    let alive = true;
    // The controls on the card now: the offer is made on (and Apply writes) the workout Ben sees. The day's coach
    // line is stored once, so a control change asks code for a fresh offer, not the model again.
    void services.todaySession.review(session, { dayKey: selection.dayKey, controls: selection.controls }, `nudge:${deriveId(key)}`).then((r) => {
      if (alive && r !== null) setNudge({ key: nudgeKey, result: r });
    });
    return () => {
      alive = false;
    };
  }, [services, session, selection, nudgeKey, reach]);

  /**
   * Words from Today's bar: pain words go straight to the coach (rule 9); a set-up request opens Set up filled
   * (`fill_setup`, Undo there); anything else opens the coach with the words, never a toast.
   */
  async function askToday(words: string) {
    const route = todayAskFirst(words) ?? todayAskRoute(words, await services.builderCoach.askSetup({ words, opId: newUuid(), from: 'today' }));
    if (route.kind === 'setup') {
      navigation.navigate('BuilderSetup', cardDayId === null ? undefined : { dayId: cardDayId });
      return;
    }
    navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true, draft: route.draft });
  }

  /** The nudge's offer: Apply writes it to the card's draft (Undo puts it back); Skip leaves it. Both quiet the card today. */
  async function onOffer(apply: boolean) {
    const n = nudge;
    if (n === null || session === null || n.result.kind !== 'line' || n.result.offer === null || nudgeBusy) return;
    const offer = n.result.offer;
    setNudgeBusy(true);
    try {
      if (!apply) {
        await services.builderCoach.skipNudge({ localDate: session.localDate, opId: newUuid() });
        setNudge({ key: n.key, result: { kind: 'settled', line: n.result.line, outcome: 'skipped' } });
        return;
      }
      const r = await services.builderCoach.applyNudge({ offer, localDate: session.localDate, opId: newUuid() });
      if (r.kind !== 'applied') {
        setToast({ text: r.kind === 'out_of_date' ? r.line : TODAY_SCREEN_COPY.offerFailed });
        return;
      }
      setNudge({ key: n.key, result: { kind: 'settled', line: n.result.line, outcome: 'applied' } });
      changed();
      reloadSession();
      const draftId = offer.proposal.draftId;
      setToast({
        text: TODAY_V2_COPY.applied,
        action: TODAY_V2_COPY.undo,
        onAction: () => {
          setToast(null);
          void services.builder.undo(draftId, builderApplyOpId(offer.proposal.id), newUuid()).then(() => {
            changed();
            reloadSession();
          });
        },
      });
    } finally {
      setNudgeBusy(false);
    }
  }
  const offerCard = nudge !== null && nudge.key === nudgeKey ? nudgeCardView(nudge.result) : null;

  // `Chest moves to next session` when another day is picked (a prediction; nothing is written until Start).
  const [moved, setMoved] = useState<string | null>(null);
  const movedKey = selection === null ? null : `${selection.dayKey}|${selection.controls.mainLiftExerciseId ?? '-'}`;
  useEffect(() => {
    if (session === null || selection === null) {
      setMoved(null);
      return;
    }
    let alive = true;
    void services.todaySession.movedLine(session, { dayKey: selection.dayKey, controls: selection.controls }).then((m) => {
      if (alive) setMoved(m);
    });
    return () => {
      alive = false;
    };
    // Only the day and main lift move the plan.
  }, [services, session, movedKey]);

  function activitySaved(saved: ActivitySaved) {
    setActivitySheet(null);
    changed();
    setToast(activitySavedToast(saved, { undo: services.activities.undo, newOpId: newUuid, changed, show: setToast }));
  }

  async function openActivity(activityId: string) {
    const a = await services.activities.get(activityId);
    if (a !== null) setActivitySheet({ activity: a });
  }

  useEffect(() => {
    reload();
  }, [install, reload]);

  useEffect(() => {
    const t = setInterval(() => {
      setNow(clockNow());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, []);

  const handed = route.params?.toast;
  useEffect(() => {
    if (!handed) return;
    setToast({ text: handed });
    navigation.setParams({ toast: undefined });
  }, [handed, navigation]);

  const startEmpty = route.params?.startEmpty;
  const startedEmpty = useRef<string | null>(null);
  useEffect(() => {
    if (startEmpty === undefined || data.state !== 'ready' || startedEmpty.current === startEmpty) return;
    startedEmpty.current = startEmpty;
    navigation.setParams({ startEmpty: undefined });
    void start({ kind: 'empty' });
  }, [startEmpty, data.state]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  /** No gym yet: a typical one (not checked), so a first Start always works (audit B4). */
  async function ensureGym(): Promise<{ gymId: string; created: boolean } | null> {
    const gymId = data.state === 'ready' ? (data.value.gym?.id ?? null) : null;
    if (gymId !== null) return { gymId, created: false };
    const made = await services.setup.useTypicalGym();
    if (!made.ok || made.gymId === undefined) {
      setError(made.ok ? 'Couldn’t set up a gym. Try again.' : made.message);
      return null;
    }
    changed();
    return { gymId: made.gymId, created: true };
  }

  /** The check-in gate's answer as the start records it. */
  async function gateCheckIn(): Promise<{ ask: true } | { ask: false; checkIn: SessionCheckIn | null; reuseId: string | null }> {
    const gate = await services.checkIns.gate();
    if (gate.kind === 'ask') return { ask: true };
    if (gate.kind === 'reuse') return { ask: false, checkIn: { kind: 'answered', checkInId: gate.checkInId }, reuseId: gate.checkInId };
    return { ask: false, checkIn: gate.reason === 'off' || gate.reason === 'not_a_check_in_day' ? { kind: 'not_asked', reason: gate.reason } : null, reuseId: null };
  }

  /** After a start: the workout, with the reused check-in's toast (check-in.md §2.6) or the start's notice. */
  async function openStarted(notice: string | null, reuseId: string | null) {
    changed();
    if (reuseId !== null) {
      const ci = await services.checkIns.get(reuseId);
      if (ci) {
        const text = `Check-in ${formatTime(toMs(ci.recordedAt.utc), ci.recordedAt.tz)} · ${scoreText(ci.score)}`;
        navigation.navigate('Workout', { toast: { kind: 'check_in', text: notice === null ? text : `${text}. ${notice}`, checkInId: ci.id } });
        return;
      }
    }
    navigation.navigate('Workout', notice === null ? undefined : { toast: { kind: 'info', text: notice } });
  }

  function guard(): boolean {
    if (starting) return false;
    setStarting(true);
    setError(null);
    setTimeout(() => {
      setStarting(false);
    }, TIMING.commitGuard);
    return true;
  }

  /** An empty workout (`Empty workout`, Library's start). Never leaves a dead button (audit F9). */
  async function start(intent: StartIntent) {
    if (!guard()) return;
    try {
      const g = await ensureGym();
      if (g === null) return;
      await alertsAsk.ensureAsked();
      const gate = await gateCheckIn();
      const of = intent.kind === 'routine' ? { routineOf: intent.routineId } : intent.kind === 'next' ? { nextOf: intent.sourceSessionId } : {};
      if (gate.ask) {
        navigation.navigate('CheckIn', { mode: 'start', gymId: g.gymId, ...of });
        return;
      }
      const key = intent.kind === 'routine' ? `routine:${intent.routineId}` : intent.kind === 'next' ? `next:${intent.sourceSessionId}` : intent.kind;
      const opId = startOps.current.get(key) ?? newUuid();
      startOps.current.set(key, opId);
      const r = await services.workout.start({ gymId: g.gymId, opId, checkIn: gate.checkIn, ...of });
      if (!r.ok) {
        setError(r.error.code === 'session_already_active' ? TODAY_SCREEN_COPY.started : r.error.message);
        reload();
        return;
      }
      startOps.current.delete(key);
      await openStarted(r.notice ?? null, gate.reuseId);
    } catch (e) {
      setError(TODAY_SCREEN_COPY.notStarted(e instanceof Error ? e.message : String(e)));
      reload();
    }
  }

  /**
   * (Ben, 23 Oct, D8) Up next's Your workout draft, changed there (by Ben, or a coach change he applied in chat):
   * Start starts that one, today only, in one tap (the check-in sheet when due).
   */
  async function startUpNextDraft(e: { draftId: string; version: number }) {
    if (!guard()) return;
    try {
      const g = await ensureGym();
      if (g === null) return;
      await alertsAsk.ensureAsked();
      const gate = await gateCheckIn();
      if (gate.ask) {
        navigation.navigate('CheckIn', { mode: 'start', gymId: g.gymId, coachDraftOf: e.draftId, coachDraftVersion: e.version });
        return;
      }
      const key = `draft:${e.draftId}:${String(e.version)}`;
      const opId = startOps.current.get(key) ?? newUuid();
      startOps.current.set(key, opId);
      const r = await services.builder.start(e.draftId, { opId, expectedVersion: e.version, gymId: g.gymId, checkIn: gate.checkIn });
      if (!r.ok) {
        startOps.current.delete(key);
        setError(r.reason === 'active' ? TODAY_SCREEN_COPY.started : r.message);
        reload();
        return;
      }
      startOps.current.delete(key);
      await openStarted(null, gate.reuseId);
    } catch (err) {
      setError(TODAY_SCREEN_COPY.notStarted(err instanceof Error ? err.message : String(err)));
      reload();
    }
  }

  /** The card's workout, saved as today's builder draft (Start and Edit use the same one, §2.0.2). */
  async function commitCard(sel: TodaySelection, data2: TodaySessionData, opKey: string) {
    const opId = startOps.current.get(opKey) ?? newUuid();
    startOps.current.set(opKey, opId);
    return services.todaySession.commit(data2, sel, opId);
  }

  /** `Start`: one tap (the check-in sheet when due). No builder, no overview (§2.0.5). */
  async function startCard() {
    if (session === null || selection === null || !guard()) return;
    try {
      const g = await ensureGym();
      if (g === null) return;
      // A gym just made: plan on it (its items), not the typical preview.
      const fresh = g.created ? await services.todaySession.load() : session;
      if (fresh === null) return;
      const sel: TodaySelection = { dayKey: selection.dayKey, controls: selection.controls };
      const commitKey = `commit:${sel.dayKey}:${JSON.stringify(sel.controls)}:${fresh.gymId ?? '-'}:${fresh.equipmentVersion}`;
      const c = await commitCard(sel, fresh, commitKey);
      if (!c.ok) {
        setError(c.message);
        return;
      }
      await alertsAsk.ensureAsked();
      const gate = await gateCheckIn();
      if (gate.ask) {
        navigation.navigate('CheckIn', { mode: 'start', gymId: g.gymId, coachDraftOf: c.draftId, coachDraftVersion: c.version });
        return;
      }
      const startKey = `start:${c.draftId}:${String(c.version)}`;
      const opId = startOps.current.get(startKey) ?? newUuid();
      startOps.current.set(startKey, opId);
      const r = await services.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId: g.gymId, opId, checkIn: gate.checkIn });
      if (!r.ok) {
        setError(r.error.code === 'session_already_active' ? TODAY_SCREEN_COPY.started : r.error.message);
        reload();
        return;
      }
      startOps.current.delete(commitKey);
      startOps.current.delete(startKey);
      await openStarted(r.notice ?? null, gate.reuseId);
    } catch (e) {
      setError(TODAY_SCREEN_COPY.notStarted(e instanceof Error ? e.message : String(e)));
      reload();
    }
  }

  /** `Edit`: the builder on Your workout with this draft (the builder stream's screen). */
  async function editCard() {
    if (session === null || selection === null) return;
    const sel: TodaySelection = { dayKey: selection.dayKey, controls: selection.controls };
    // Keyed on what the card was built from too (gym, items), and cleared once saved (review S6): a later Edit with the
    // same controls never gets back an older draft.
    const editKey = `edit:${sel.dayKey}:${JSON.stringify(sel.controls)}:${session.gymId ?? '-'}:${session.equipmentVersion}`;
    const c = await commitCard(sel, session, editKey);
    if (!c.ok) {
      setError(c.message);
      return;
    }
    startOps.current.delete(editKey);
    navigation.navigate('BuilderWorkout', { draftId: c.draftId, back: 'Today' });
  }

  /** `Build your own`: the builder on Set up, Day = the card's day. */
  function buildYourOwn() {
    const day = selection === null || session === null ? null : ([...session.days, ...session.others].find((d) => d.key === selection.dayKey) ?? null);
    navigation.navigate('BuilderSetup', day === null ? undefined : { dayId: day.splitDayId });
  }

  /**
   * (Review todaylean S4) Time on an edited card: Your workout's Time on that draft (the same fit, Ben's edits never
   * cut; versioned, one op ID), then Today reads it back. Offline, no coach call.
   */
  async function editedTime(minutes: number) {
    const e = view?.edited;
    // (Review todaylean N1) One Time write at a time, each from the version the last one wrote (the card reloads after).
    if (!e || timeBusy.current) return;
    timeBusy.current = true;
    try {
      const last = timeWritten.current;
      const expectedVersion = last !== null && last.draftId === e.draftId ? Math.max(e.version, last.version) : e.version;
      const r = await services.builder.setTime(e.draftId, minutes, { opId: newUuid(), expectedVersion });
      if (r.status !== 'written' && r.status !== 'replayed') setError(r.message);
      else timeWritten.current = { draftId: e.draftId, version: r.snapshot.version };
    } finally {
      timeBusy.current = false;
    }
    changed();
    reload();
  }

  /**
   * (Ben, 23 Oct; fit-to-time SP3) The carry-over behind the Time note: `Carry over` (toast `Carried over · Undo`), `✕`,
   * or `Undo`. Today's own card writes it with Today's draft; an edited card on its Your workout draft. Versioned, one op
   * ID per tap; a stale answer is refused with a word.
   */
  async function carryOver(choice: 'carried' | 'skipped' | 'clear') {
    const c = view?.carry;
    if (!c || session === null || selection === null) return;
    const sel: TodaySelection = { dayKey: selection.dayKey, controls: selection.controls };
    const opId = newUuid();
    let ok: boolean;
    let undo: (() => Promise<unknown>) | null = null;
    if (c.via.kind === 'builder') {
      const r = await services.builder.carryOver(c.via.draftId, choice, { opId, expectedVersion: c.via.version });
      ok = r.status === 'written' || r.status === 'replayed';
      if (!ok) setError('message' in r ? r.message : TODAY_SESSION_COPY.stale);
      if (ok && choice === 'carried' && 'snapshot' in r && r.snapshot !== null) {
        const draftId = r.snapshot.draftId;
        const version = r.snapshot.version;
        undo = () => services.builder.carryOver(draftId, 'clear', { opId: newUuid(), expectedVersion: version });
      }
    } else {
      const r = await services.todaySession.carryOver(session, sel, choice, { opId, basis: c.basis });
      ok = r.status === 'written';
      if (r.status !== 'written') setError(r.message);
      if (ok && choice === 'carried') {
        undo = async () => {
          const fresh = await services.todaySession.load();
          const now = fresh === null ? null : services.todaySession.card(fresh, sel);
          if (fresh === null || now?.carry == null) return;
          await services.todaySession.carryOver(fresh, sel, 'clear', { opId: newUuid(), basis: now.carry.basis });
        };
      }
    }
    changed();
    reloadSession();
    if (ok && undo !== null) {
      const run = undo;
      setToast({
        text: TODAY_SESSION_COPY.carried,
        action: TODAY_V2_COPY.undo,
        onAction: () => {
          setToast(null);
          void run().then(() => {
            changed();
            reloadSession();
          });
        },
      });
    }
  }

  /** `Back to plan day` on an edited card: the edited draft is discarded (versioned), with Undo. */
  async function backToPlan() {
    const e = view?.edited;
    if (!e) return;
    const r = await services.coachDrafts.discard({ draftId: e.draftId, expectedVersion: e.version, opId: newUuid() });
    if (!r.ok) {
      setError('Changed since. Try again.');
      reload();
      return;
    }
    const gone = r.draft;
    changed();
    setToast({
      text: 'Edits discarded',
      action: 'Undo',
      onAction: () => {
        void services.coachDrafts.restore({ draftId: gone.id, expectedVersion: gone.version, opId: newUuid() }).then(() => {
          changed();
          setToast(null);
        });
      },
    });
  }

  async function resumeOn(row: ResumeRow) {
    const current = data.state === 'ready' ? data.value.active : null;
    if (row.firstPendingSetId !== null && current && row.status !== 'now') {
      const go = (version: number) => services.workout.dispatch(current.session.id, { type: 'set_active_set', at: services.now(), opId: newUuid(), setId: row.firstPendingSetId ?? '', expectedVersion: version });
      let r = await go(current.session.version);
      if (!r.ok && r.error.code === 'stale_version') {
        const fresh = await services.workout.load(current.session.id).catch(() => null);
        if (fresh && fresh.aggregate.sets.some((x) => x.id === row.firstPendingSetId && x.status === 'pending')) r = await go(fresh.aggregate.session.version);
      }
      if (r.ok) changed();
    }
    navigation.navigate('Workout');
  }

  async function discardEmpty(main: Extract<TodayMain, { kind: 'stale' }>) {
    const ask = { required: false, loggedSets: 0, expectedVersion: main.sessionVersion } as const;
    const r = await services.workout.dispatch(main.sessionId, discardCommand(ask, { opId: newUuid(), at: services.now() }));
    if (!r.ok) {
      setError(r.error.code === 'stale_version' || r.error.code === 'discard_unconfirmed' ? 'The workout changed. Check it and try again.' : `Couldn’t discard: ${r.error.message}`);
      reload();
      return;
    }
    changed();
    setToast({ text: 'Workout discarded' });
  }

  if (data.state === 'loading') return <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} />;
  if (data.state === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], padding: theme.components.screenMargin, paddingTop: insets.top + theme.space['3'] }}>
        <View style={{ gap: theme.space['3'] }}>
          <StatusLine icon="exclamationmark.triangle" tone="warning" text={launch.recoveryError ? 'Your unfinished workout couldn’t be read.' : 'Couldn’t open your training data.'} detail="Data unchanged" info={data.message} infoLabel="Error details" />
          <SecondaryButton label="Try again" onPress={reload} />
          <TextButton
            label="Restore from a backup"
            onPress={() => {
              navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'DataBackup', initial: false } });
            }}
          />
        </View>
      </View>
    );
  }
  const { gym, view: todayView, banners, active, unlinked } = data.value;
  const zoned = services.now();
  const checkInLine = (c: NonNullable<typeof unlinked>) => `Check-in ${formatTime(toMs(c.recordedAt.utc), zoned.tz)} · ${scoreText(c.score)}${c.reasons.length ? ` · ${reasonsText(c.reasons)}` : ''}`;
  const main = todayView?.main ?? { kind: 'no_plan' as const };
  const openWorkout = main.kind === 'resume' || main.kind === 'stale';
  const chosenName = view === null ? null : (session?.days.find((d) => d.key === view.dayKey)?.name ?? session?.others.find((d) => d.key === view.dayKey)?.name ?? null);
  const strip = session === null ? [] : services.todaySession.strip(session, main.kind === 'done_today' ? null : chosenName);
  // The day row: the plan's days, or (V5, no plan; D7) Profile › Split's, NEXT on the Up next pick; `⋯` is the other
  // workouts (Full body, Upper, Push, Empty workout, Build your own). No plan and no split: `⋯` alone.
  const segs = session === null ? null : todaySegments({ days: session.days, others: session.others, nextKey: session.nextKey, selectedKey: selection?.dayKey ?? null, paused: session.status === 'paused' });

  const openHero = (() => {
    switch (main.kind) {
      case 'resume': {
        const status =
          main.status.kind === 'resting'
            ? toMs(main.status.deadlineUtc) <= now
              ? 'Rest over'
              : `Rest ${formatDuration(Math.ceil((toMs(main.status.deadlineUtc) - now) / 1000))} left`
            : main.status.kind === 'paused'
              ? 'Paused'
              : main.status.kind === 'all_done'
                ? 'All planned sets done'
                : main.status.kind === 'empty'
                  ? 'Add an exercise to start'
                  : 'Ready for next set';
        return (
          <Hero label={`In progress · started ${formatTime(toMs(main.startedAtUtc), zoned.tz)}`} title={main.title} lines={[main.now, `${String(main.done)} of ${String(main.total)} sets done · ${status}`, main.timeLeft]}>
            <PrimaryButton
              label="Resume"
              onPress={() => {
                navigation.navigate('Workout');
              }}
            />
            <DetailList
              rows={main.rows.map((r) => ({
                key: r.sessionExerciseId,
                title: r.name,
                detail: r.text,
                status: r.status,
                onPress: () => {
                  void resumeOn(r);
                },
              }))}
            />
          </Hero>
        );
      }
      case 'stale':
        return (
          <Hero
            label={`Unfinished · ${formatShortDate(toMs(main.startedAtUtc), zoned.tz)}`}
            title={main.title}
            lines={[
              main.done === 0 ? 'Nothing logged' : `${String(main.done)} of ${String(main.total)} sets done`,
              main.lastSetAtUtc && !main.endedAboutUtc ? `Last set logged at ${formatTime(toMs(main.lastSetAtUtc), zoned.tz)}` : null,
              main.endedAboutUtc ? `Ended about ${formatTime(toMs(main.endedAboutUtc), zoned.tz)}` : null,
            ]}
          >
            {main.endedAboutUtc ? (
              <PrimaryButton
                label="Finish"
                onPress={() => {
                  if (active) {
                    setFinishFor(active);
                    setFinishVisible(true);
                  }
                }}
              />
            ) : (
              <PrimaryButton label="Discard (nothing logged)" onPress={() => void discardEmpty(main)} />
            )}
            <TextButton
              label="Resume instead"
              onPress={() => {
                navigation.navigate('Workout');
              }}
            />
          </Hero>
        );
      case 'done_today':
      case 'no_plan':
        return null;
    }
  })();

  const doneLine =
    main.kind === 'done_today' ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${main.title}, done today${doneTodayDurationLine(main.title, main.activeMs) ? `, ${doneTodayDurationLine(main.title, main.activeMs) ?? ''}` : ''}. Opens its summary.`}
        onPress={() => {
          navigation.navigate('Summary', { sessionId: main.sessionId });
        }}
        style={({ pressed }) => ({ minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['4'], borderRadius: theme.radius.lg, backgroundColor: theme.colors['status.done.subtle'], opacity: pressed ? 0.7 : 1 })}
      >
        <Icon name="checkmark.circle.fill" color="status.done" size={18} />
        <AppText variant="headline" style={{ flex: 1 }}>
          {[main.title, doneTodayDurationLine(main.title, main.activeMs)].filter(Boolean).join(' · ')}
        </AppText>
        <Icon name="chevron.right" size={14} color="text.tertiary" />
      </Pressable>
    ) : null;

  const actions = todayActions({ openWorkout, read: session !== null ? 'ready' : sessionFailed ? 'failed' : 'loading', noPlan: session?.status === 'no_plan', cardShown: view !== null, upNext: session?.upNext != null && session.days.length === 0 });
  // The gym sits on the session's row (its loads are this gym's), so the header stays one line at 375 pt. It shows
  // while the session loads and after a failed read too (review today-fix-21oct S3).
  const gymRow = actions.gymRow ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
      <Eyebrow>{TODAY_V2_COPY.session}</Eyebrow>
      <GymChip
        gymName={gym?.name ?? null}
        onPress={() => {
          if (!gym) navigation.navigate('AddGym');
          else navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'GymDetail', params: { gymId: gym.id }, initial: false } });
        }}
      />
    </View>
  ) : null;
  const sessionBlock = (() => {
    if (openWorkout) return null;
    if (session === null) {
      // A failed read keeps every way to start (review S2): Build your own below, Empty workout here.
      return (
        <View style={{ gap: theme.space['2'] }}>
          {gymRow}
          {actions.failed ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={TODAY_SCREEN_COPY.sessionFailed} action={<TextButton label="Try again" tone="secondary" onPress={reload} />} /> : null}
          {actions.emptyWorkout ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <TextButton label={TODAY_V2_COPY.emptyWorkout} tone="secondary" onPress={() => void start({ kind: 'empty' })} />
            </View>
          ) : null}
        </View>
      );
    }
    const noPlan = session.status === 'no_plan';
    const upNext = actions.upNext ? session.upNext : null;
    const upNextTitle = upNext === null ? '' : upNext.edited != null ? `${upNext.title} · ${TODAY_V2_COPY.edited}` : upNext.title;
    return (
      <View style={{ gap: theme.space['2'] }}>
        {gymRow}
        {noPlan ? (
          // (§2.0.4 No plan, V5) `No plan` with `Set up a plan ›` on one row; the day row and the card below read as with a plan.
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], flexWrap: 'wrap' }}>
            <AppText variant="title2" accessibilityRole="header">
              {TODAY_V2_COPY.noPlan}
            </AppText>
            <TextButton
              label={`${TODAY_V2_COPY.setUpPlan} ›`}
              tone="secondary"
              onPress={() => {
                navigation.dispatch(openYourPlan(newUuid()));
              }}
            />
          </View>
        ) : null}
        {segs !== null ? (
          <DayControl
            segments={segs.segments}
            paused={session.status === 'paused'}
            onDay={pickDay}
            onMore={() => {
              setListSheet('other');
            }}
            onAxList={() => {
              setListSheet('all');
            }}
            axLabel={chosenName ?? TODAY_V2_COPY.other}
          />
        ) : null}
        {upNext !== null ? (
          // No plan and no Profile split: the old Today's Up next (routines in rotation, the longest gap), Start in one tap.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={TODAY_SCREEN_COPY.upNextLabel(upNextTitle)}
            disabled={starting}
            onPress={() => {
              // (D8) Changed on Your workout (by Ben, or a coach change he applied): that draft starts.
              if (upNext.edited != null) void startUpNextDraft(upNext.edited);
              else if (upNext.routineId !== null) void start({ kind: 'routine', routineId: upNext.routineId });
              else if (upNext.sourceSessionId !== null) void start({ kind: 'next', sourceSessionId: upNext.sourceSessionId });
            }}
            style={({ pressed }) => ({ minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], paddingLeft: theme.space['4'], paddingRight: theme.space['2'], borderRadius: theme.radius.lg, backgroundColor: theme.colors['bg.surface'], opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ flex: 1 }}>
              <AppText variant="sectionLabel" color="text.secondary" accessible={false}>
                {TODAY_SCREEN_COPY.upNext}
              </AppText>
              <AppText variant="headline" numberOfLines={1} accessible={false}>
                {upNextTitle}
              </AppText>
            </View>
            <View pointerEvents="none" style={{ minHeight: theme.target.min.height, justifyContent: 'center', paddingHorizontal: theme.space['4'], borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent }}>
              <AppText variant="headline" color="on.accent" accessible={false}>
                {TODAY_V2_COPY.start}
              </AppText>
            </View>
          </Pressable>
        ) : null}
        {view !== null && selection !== null ? (
          <SessionCard
            view={view}
            why={selection.why}
            moved={moved}
            busy={starting}
            dispatch={act}
            offer={
              offerCard === null
                ? null
                : {
                    line: offerCard.line,
                    lines: offerCard.offer?.lines ?? [],
                    busy: nudgeBusy,
                    onApply: () => void onOffer(true),
                    onSkip: () => void onOffer(false),
                    // (§6.2) Today only ever shows this one line; the reviews live in Progress.
                    onReviews: () => {
                      navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressHome', params: { focus: 'reviews', n: (reviewsTaps += 1) } } });
                    },
                  }
            }
            onStart={() => void startCard()}
            onEdit={() => void editCard()}
            onBackToPlan={() => void backToPlan()}
            onTimeNote={() => {
              setTimeDetail(true);
            }}
            onEditedTime={(dir) => {
              const t = view.time;
              if (t !== null) void editedTime(stepTimeMinutes(t.minutes, dir));
            }}
          />
        ) : null}
      </View>
    );
  })();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        // Re-renders keep the scroll position (Mix it up, a control): the ScrollView stays mounted (§2.0.2).
        contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: insets.top + theme.space['3'], paddingBottom: theme.space['6'], gap: theme.space['3'] }}
      >
        <TodayHeader
          title={todayTitle(zoned.utc, zoned.tz)}
          coach={
            <CoachAskBar
              page="today"
              compact
              reach={reach}
              speech={speech}
              onOpen={(heard) => {
                if (heard !== undefined && heard.trim() !== '') {
                  void askToday(heard.trim());
                  return;
                }
                navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true });
              }}
            />
          }
        />
        {strip.length > 0 ? <WeekStrip cells={strip} onDay={setDaySheet} /> : null}

        <BannerList banners={banners} />
        {interrupted ? (
          <StatusLine
            icon="info.circle"
            tone="info"
            text="Restore didn’t finish · data unchanged"
            action={
              <TextButton
                label="OK"
                tone="secondary"
                onPress={() => {
                  setInterrupted(false);
                }}
              />
            }
          />
        ) : null}

        {openHero}
        {doneLine}

        {unlinked && !openWorkout ? (
          <LinkLine
            accessibilityLabel={`${checkInLine(unlinked)}. Edits your saved check-in.`}
            onPress={() => {
              navigation.navigate('CheckIn', { mode: 'edit', checkInId: unlinked.id });
            }}
          >
            <AppText variant="callout" color="text.secondary" numeric>
              {`${checkInLine(unlinked)} ›`}
            </AppText>
          </LinkLine>
        ) : null}

        {todayView?.painCheck ? (
          <LinkLine
            accessibilityLabel={todayView.painCheck.accessibilityLabel}
            onPress={() => {
              const pc = todayView.painCheck;
              if (pc?.kind === 'one') navigation.navigate('PainFlag', { flagId: pc.flagId });
              else navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'PainFlags', initial: false } });
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], minHeight: theme.target.min.height }}>
              <Icon name="exclamationmark.triangle" color="status.warning" size={16} />
              <AppText variant="callout" style={{ flex: 1 }}>
                {todayView.painCheck.text}
              </AppText>
              <Icon name="chevron.right" size={14} color="text.tertiary" />
            </View>
          </LinkLine>
        ) : null}

        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}

        {sessionBlock}

        {!openWorkout ? (
          <View style={{ flexDirection: 'row', gap: theme.space['2'], alignItems: 'center' }}>
            {actions.buildYourOwn === 'primary' ? (
              <View style={{ flex: 1 }}>
                <PrimaryButton label={TODAY_V2_COPY.buildYourOwn} onPress={buildYourOwn} />
              </View>
            ) : actions.buildYourOwn === 'secondary' ? (
              <SecondaryButton label={TODAY_V2_COPY.buildYourOwn} onPress={buildYourOwn} grow />
            ) : null}
            <SecondaryButton
              label={TODAY_SCREEN_COPY.addActivity}
              accessibilityLabel={TODAY_SCREEN_COPY.activity}
              onPress={() => {
                setActivitySheet({ activity: null });
              }}
              grow
            />
          </View>
        ) : null}
      </ScrollView>
      <ActivitySheet
        visible={activitySheet !== null}
        activity={activitySheet?.activity ?? null}
        onClose={() => {
          setActivitySheet(null);
        }}
        onSaved={activitySaved}
      />
      <DaySheet
        cell={daySheet}
        onClose={() => {
          setDaySheet(null);
        }}
        onWorkout={(id) => {
          setDaySheet(null);
          navigation.navigate('Summary', { sessionId: id, back: true });
        }}
        onActivity={(id) => {
          setDaySheet(null);
          void openActivity(id);
        }}
      />
      <SessionListSheet
        visible={listSheet !== null}
        title={listSheet === 'all' ? 'Day' : TODAY_V2_COPY.otherLabel}
        days={session === null ? [] : listSheet === 'all' ? [...session.days, ...session.others] : [...(segs?.overflow ?? []), ...session.others]}
        selectedKey={selection?.dayKey ?? null}
        nextKey={session?.nextKey ?? null}
        onPick={(key) => {
          setListSheet(null);
          pickDay(key);
        }}
        onEmpty={() => {
          listAfter.arm(() => void start({ kind: 'empty' }));
          setListSheet(null);
        }}
        onBuild={() => {
          listAfter.arm(buildYourOwn);
          setListSheet(null);
        }}
        onClose={() => {
          setListSheet(null);
        }}
      />
      <TimeDetailSheet
        visible={timeDetail && view?.time?.note != null}
        minutes={view?.time?.minutes ?? 0}
        lines={view?.time?.lines ?? []}
        undoMinutes={view?.time?.undoMinutes ?? null}
        onUndo={(minutes) => {
          if (view?.edited != null) void editedTime(minutes);
          else act({ kind: 'minutes_to', minutes });
        }}
        onClose={() => {
          setTimeDetail(false);
        }}
        carry={view?.carry == null ? null : { state: view.carry.state, lines: view.carry.lines }}
        onCarry={(choice) => void carryOver(choice)}
      />
      {alertsAsk.sheet}
      {deleted.toast ? (
        <DeleteToastView state={deleted} />
      ) : toast ? (
        <Toast icon="info.circle" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} />
      ) : null}
      {finishFor ? (
        <FinishSheet
          aggregate={finishFor}
          visible={finishVisible}
          onClose={() => {
            setFinishVisible(false);
          }}
          onFinished={(id) => {
            afterDismiss.arm(() => {
              setFinishFor(null);
              navigation.navigate('Summary', { sessionId: id });
            });
            setFinishVisible(false);
            changed();
          }}
          onDismissed={afterDismiss.dismissed}
          onDiscard={() => {
            const target = finishFor;
            const ask = discardConfirmation(target);
            const go = () => {
              void services.workout.dispatch(target.session.id, discardCommand(ask, { opId: newUuid(), at: services.now() })).then((r) => {
                if (!r.ok) {
                  setFinishFor(null);
                  setError(r.error.code === 'stale_version' || r.error.code === 'discard_unconfirmed' ? 'The workout changed. Check it and try again.' : `Couldn’t discard: ${r.error.message}`);
                  reload();
                  return;
                }
                afterDismiss.arm(() => {
                  setFinishFor(null);
                  setToast({ text: 'Workout discarded' });
                });
                setFinishVisible(false);
                changed();
              });
            };
            if (!ask.required) {
              go();
              return;
            }
            Alert.alert('Discard this workout?', ask.message, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Discard', style: 'destructive', onPress: go },
            ]);
          }}
          onStale={reload}
        />
      ) : null}
    </View>
  );
}

/** Resume / stale hero: tracked label, title, quiet lines, then the actions (today.md, unchanged). */
function Hero({ label, title, lines, children }: { label: string; title: string; lines: readonly (string | null)[]; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['6'] }}>
      <HeroHeader eyebrow={label} title={title} lines={lines} link={null} />
      <View style={{ gap: theme.space['4'] }}>{children}</View>
    </View>
  );
}

const ROW_ICON: Record<ResumeRow['status'], { icon: SymbolName; color: 'status.done' | 'accent' | 'text.tertiary' }> = {
  done: { icon: 'checkmark.circle.fill', color: 'status.done' },
  now: { icon: 'arrowtriangle.right.fill', color: 'accent' },
  pending: { icon: 'circle', color: 'text.tertiary' },
  skipped: { icon: 'slash.circle', color: 'text.tertiary' },
};
const ROW_WORD: Record<ResumeRow['status'], string> = { done: 'Done', now: 'Now', pending: 'Not started', skipped: 'Skipped' };
const DETAIL_CAP = 5;

interface DetailRow {
  key: string;
  title: string;
  detail: string;
  status: ResumeRow['status'];
  onPress: () => void;
}

/** Resume progress (premium-feel §2.3): one row per exercise with a status icon and words, ≥ 52 pt; `+2 more`. */
function DetailList({ rows }: { rows: readonly DetailRow[] }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, DETAIL_CAP);
  const hidden = rows.length - shown.length;
  return (
    <View>
      {shown.map((r, i) => (
        <FadeIn key={r.key} motion={i >= DETAIL_CAP ? listEnterMotion(i - DETAIL_CAP, theme.a11y.reduceMotion) : null}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${r.title}, ${ROW_WORD[r.status]}, ${r.detail}`}
            accessibilityHint="Resumes the workout on this exercise"
            onPress={r.onPress}
            style={({ pressed }) => ({ minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], backgroundColor: pressed ? theme.colors['bg.surface'] : 'transparent' })}
          >
            <Icon name={ROW_ICON[r.status].icon} color={ROW_ICON[r.status].color} size={16} />
            <RowText title={r.title} detail={r.detail} titleColor={r.status === 'pending' || r.status === 'skipped' ? 'text.secondary' : 'text.primary'} titleWeight={r.status === 'now' ? '600' : '400'} />
          </Pressable>
        </FadeIn>
      ))}
      {hidden > 0 ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <TextButton
            label={`+${String(hidden)} more`}
            tone="secondary"
            onPress={() => {
              setExpanded(true);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Today's session data (`todaySession.load()`), apart from the rest of the screen (review S1). Read on focus when
 * `enabled`, cached by the data version, the reload tick and the hour (so a new day re-reads), never while a workout
 * is open. An unreadable plan only hides the card (null), it never blocks Today or Start.
 */
function useTodaySessionData(enabled: boolean): [TodaySessionData | null, () => void, boolean] {
  const services = useServices();
  const version = useDataVersion();
  const [tick, setTick] = useState(0);
  const [value, setValue] = useState<TodaySessionData | null>(null);
  // A failed read says so (Couldn't load · Try again), never `No plan` (review planview S5, as Library).
  const [failed, setFailed] = useState(false);
  const cache = useRef<{ key: string; value: TodaySessionData | null; failed: boolean } | null>(null);
  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const key = `${String(version)}|${String(tick)}|${services.now().utc.slice(0, 13)}`;
      if (cache.current?.key === key) {
        setValue(cache.current.value);
        setFailed(cache.current.failed);
        return;
      }
      let alive = true;
      void services.todaySession
        .load()
        .then(
          (v) => ({ v, bad: false }),
          () => ({ v: null, bad: true }),
        )
        .then(({ v, bad }) => {
          cache.current = { key, value: v, failed: bad };
          if (alive) {
            setValue(v);
            setFailed(bad);
          }
        });
      return () => {
        alive = false;
      };
    }, [services, version, tick, enabled]),
  );
  return [value, reload, failed];
}
