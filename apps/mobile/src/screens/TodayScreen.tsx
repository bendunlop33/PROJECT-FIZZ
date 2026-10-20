import { useNavigation, useRoute, type NavigationProp, type ParamListBase, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { discardCommand, discardConfirmation, doneTodayDurationLine, formatDuration, reasonsText, scoreText, TODAY_V2_COPY, toMs, type ResumeRow, type StripCell, type TodayMain } from '@fizz/domain';
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
import type { TodaySelection, TodaySessionData } from '../services/today-session';
import { firstTime, useDataChanged, useLaunchInfo, useScreenData, useServices } from '../shell/context';
import { loadBanners } from '../shell/system-banners';
import { useInstallStatus } from '../shell/useInstallStatus';
import { listEnterMotion, TIMING, useTheme } from '../theme';
import { routeAvailable, todayCardReducer, todaySegments, todayTitle, TODAY_SCREEN_COPY, type TodayCardState } from '../today/today-view';
import { AppText, Eyebrow, FadeIn, HeroHeader, Icon, LinkLine, PrimaryButton, RowText, SecondaryButton, StatusLine, TextButton, Toast, type SymbolName } from '../ui';
import { BannerList } from './BannerList';
import { createAfterDismiss } from '../workout/after-dismiss';
import { FinishSheet } from './workout/FinishSheet';
import { GymChip } from './workout/GymSwitch';
import { DayControl, DaySheet, SessionCard, SessionListSheet, TodayHeader, WeekStrip } from './today/TodaySession';

/**
 * Today (v2) (workout-builder-v3 §2.0 with Ben's 20 Oct additions; prototypes/today-v2.html): `Tuesday`
 * with the gym and a compact `✦ Coach` + mic, the 7-day strip (3 back, 3 ahead: only what Ben did,
 * logged or told the coach), the rare lines (banners, check-in, pain check), then Today's session: the
 * day control (`NEXT`, `⋯` Other sessions), the session card with the five controls, a collapsed
 * Session breakdown (table, Why?, ↻ Mix it up), one-tap Start and Edit; `Build your own` and
 * `＋ Activity` below. Resume and the stale card replace the session while a workout is open (today.md,
 * unchanged).
 *
 * The card's workout comes from `todaySession` (the builder rules); this screen only lays it out and
 * keeps the selection. Picking a day, chip or control writes nothing; Start commits the card as
 * today's builder draft and starts it (check-in sheet when due). Supersedes today.md's Up next card,
 * alternatives, Recent and Ask pill (§2.0.9, §7).
 */

type StartIntent = { kind: 'empty' };
type Nav = NavigationProp<ParamListBase>;

/** The navigator states from this screen up (the builder's routes arrive with the builder stream). */
function navStates(navigation: Nav): { routeNames?: readonly string[] }[] {
  const out: { routeNames?: readonly string[] }[] = [];
  let n: Nav | undefined = navigation;
  while (n !== undefined) {
    out.push(n.getState());
    n = n.getParent();
  }
  return out;
}

export function TodayScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<TabParams, 'Today'>>();
  const install = useInstallStatus();
  const launch = useLaunchInfo();
  const [interrupted, setInterrupted] = useState(() => launch.restoreInterrupted && firstTime('restore-interrupted'));
  // One opId per Start intent, kept until it succeeds: a double tap or retry starts one workout.
  const startOps = useRef(new Map<string, string>());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; action?: string; onAction?: () => void } | null>(null);
  const deleted = useDeleteToast();
  const [now, setNow] = useState(clockNow);
  const [finishFor, setFinishFor] = useState<SessionAggregate | null>(null);
  const [finishVisible, setFinishVisible] = useState(false);
  const [afterDismiss] = useState(() => createAfterDismiss());
  const alertsAsk = useStartAlertsAsk();
  const [data, reload] = useScreenData(async (s) => {
    const [gym, view, banners, active, unlinked, session] = await Promise.all([
      s.yourData.currentGym(),
      s.today.view(),
      loadBanners(s, install),
      s.sessions.active(),
      s.checkIns.unlinked(),
      // Never blocks Today or Start: an unreadable plan only hides the card.
      s.todaySession.load().catch(() => null),
    ]);
    return { gym, view, banners, active, unlinked, session };
  });
  const [activitySheet, setActivitySheet] = useState<{ activity: Activity | null } | null>(null);
  const [daySheet, setDaySheet] = useState<StripCell | null>(null);
  const [listSheet, setListSheet] = useState<'other' | 'all' | null>(null);
  const [listAfter] = useState(() => createAfterDismiss());

  const session = data.state === 'ready' ? data.value.session : null;
  const [selection, setSelection] = useState<TodayCardState | null>(null);

  // The card's selection: the plan's next day on open (or as Ben left it while the data reloads). Once today's
  // workout is done, no day is selected until Ben picks one for a second session (§2.0.4 Done today).
  const wasDone = useRef<boolean | null>(null);
  useEffect(() => {
    if (session === null) return;
    const justDone = wasDone.current === false && session.doneToday;
    wasDone.current = session.doneToday;
    setSelection((cur) => {
      if (justDone) return null;
      if (cur !== null && session.initial[cur.dayKey] !== undefined) return cur;
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

  const view = useMemo(() => (session === null || selection === null ? null : services.todaySession.card(session, { dayKey: selection.dayKey, controls: selection.controls })), [services, session, selection]);

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
  const undoRoutine = route.params?.undoRoutine;
  const undoDraft = route.params?.undoDraft;
  useEffect(() => {
    if (!handed) return;
    setToast({
      text: handed,
      ...(undoDraft
        ? {
            action: 'Undo',
            onAction: () => {
              void services.coachDrafts.restore({ draftId: undoDraft.id, expectedVersion: undoDraft.version, opId: `restore:${undoDraft.id}:${String(undoDraft.version)}` }).then(() => {
                changed();
                setToast(null);
              });
            },
          }
        : undoRoutine
          ? {
              action: 'Undo',
              onAction: () => {
                void services.routines.restore({ routineId: undoRoutine.id, expectedVersion: undoRoutine.version, opId: newUuid() }).then((u) => {
                  if (!u.ok) setError(u.message);
                  changed();
                  setToast(null);
                });
              },
            }
          : {}),
    });
    navigation.setParams({ toast: undefined, undoRoutine: undefined, undoDraft: undefined });
  }, [handed, undoRoutine, undoDraft, navigation, services, changed]);

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
      if (gate.ask) {
        navigation.navigate('CheckIn', { mode: 'start', gymId: g.gymId });
        return;
      }
      const key = intent.kind;
      const opId = startOps.current.get(key) ?? newUuid();
      startOps.current.set(key, opId);
      const r = await services.workout.start({ gymId: g.gymId, opId, checkIn: gate.checkIn });
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
      const commitKey = `commit:${sel.dayKey}:${JSON.stringify(sel.controls)}`;
      const c = await commitCard(sel, fresh, commitKey);
      if (!c.ok) {
        setError(c.message);
        return;
      }
      await alertsAsk.ensureAsked();
      const gate = await gateCheckIn();
      if (gate.ask) {
        navigation.navigate('CheckIn', { mode: 'start', gymId: g.gymId, coachDraftOf: c.draftId });
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
    if (!routeAvailable(navStates(navigation), 'BuilderWorkout')) {
      setToast({ text: TODAY_SCREEN_COPY.builderUnavailable });
      return;
    }
    const sel: TodaySelection = { dayKey: selection.dayKey, controls: selection.controls };
    const c = await commitCard(sel, session, `edit:${sel.dayKey}:${JSON.stringify(sel.controls)}`);
    if (!c.ok) {
      setError(c.message);
      return;
    }
    navigation.navigate('BuilderWorkout', { draftId: c.draftId });
  }

  /** `Build your own`: the builder on Set up, Day = the card's day. */
  function buildYourOwn() {
    if (!routeAvailable(navStates(navigation), 'BuilderSetup')) {
      setToast({ text: TODAY_SCREEN_COPY.builderUnavailable });
      return;
    }
    const day = selection === null || session === null ? null : ([...session.days, ...session.others].find((d) => d.key === selection.dayKey) ?? null);
    navigation.navigate('BuilderSetup', day === null ? undefined : { dayId: day.splitDayId });
  }

  /** `Back to plan day` on an edited card: the edited draft is discarded (versioned), with Undo. */
  async function backToPlan() {
    const e = view?.edited;
    if (!e) return;
    const r = await services.coachDrafts.discard({ draftId: e.draftId, expectedVersion: e.version, opId: newUuid() });
    if (!r.ok) {
      setError(TODAY_SCREEN_COPY.notStarted('it changed since'));
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
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], padding: theme.components.screenMargin, paddingTop: theme.space['8'] }}>
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

  const sessionBlock = (() => {
    if (openWorkout || session === null) return null;
    const noPlan = session.status === 'no_plan';
    return (
      <View style={{ gap: theme.space['2'] }}>
        <Eyebrow>{TODAY_V2_COPY.session}</Eyebrow>
        {noPlan ? (
          view === null ? (
            <View style={{ gap: theme.space['3'] }}>
              <AppText variant="title2">{TODAY_V2_COPY.noPlan}</AppText>
              <PrimaryButton label={TODAY_V2_COPY.buildYourOwn} onPress={buildYourOwn} />
              <View style={{ alignSelf: 'flex-start' }}>
                <TextButton
                  label={`${TODAY_V2_COPY.setUpPlan} ›`}
                  onPress={() => {
                    navigation.dispatch(openYourPlan(newUuid()));
                  }}
                />
              </View>
              {session.others.map((d) => (
                <Pressable key={d.key} accessibilityRole="button" accessibilityLabel={d.name} onPress={() => { pickDay(d.key); }} style={({ pressed }) => ({ minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: pressed ? 0.7 : 1 })}>
                  <AppText variant="body">{d.name}</AppText>
                  <Icon name="chevron.right" size={14} color="text.tertiary" />
                </Pressable>
              ))}
              <View style={{ alignSelf: 'flex-start' }}>
                <TextButton label={TODAY_V2_COPY.emptyWorkout} onPress={() => void start({ kind: 'empty' })} />
              </View>
            </View>
          ) : null
        ) : segs !== null ? (
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
        {view !== null && selection !== null ? (
          <SessionCard
            view={view}
            open={selection.open}
            why={selection.why}
            moved={moved}
            busy={starting}
            dispatch={act}
            onStart={() => void startCard()}
            onEdit={() => void editCard()}
            onBackToPlan={() => void backToPlan()}
          />
        ) : null}
      </View>
    );
  })();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        // Re-renders keep the scroll position (Mix it up, a control): the ScrollView stays mounted (§2.0.2).
        contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['6'], gap: theme.space['3'] }}
      >
        <TodayHeader
          title={todayTitle(zoned.utc, zoned.tz)}
          gym={
            <GymChip
              gymName={gym?.name ?? null}
              onPress={() => {
                if (!gym) navigation.navigate('AddGym');
                else navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'GymDetail', params: { gymId: gym.id }, initial: false } });
              }}
            />
          }
          coachLabel={session?.coachLabel ?? TODAY_V2_COPY.coach}
          onCoach={() => {
            navigation.navigate('Coach', { entry: { kind: 'today' } });
          }}
          onMic={() => {
            // MERGE NOTE: the coach stream adds direct voice (listening at once); until then the sheet opens with its field.
            navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true });
          }}
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
          <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
            {session !== null && session.status !== 'no_plan' ? <SecondaryButton label={TODAY_V2_COPY.buildYourOwn} onPress={buildYourOwn} grow /> : null}
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
