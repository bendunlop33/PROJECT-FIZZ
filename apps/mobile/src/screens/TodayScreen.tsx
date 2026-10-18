import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, View } from 'react-native';

import { AskPill } from './coach/AskPill';

import { discardCommand, discardConfirmation, doneTodayDurationLine, formatDuration, reasonsText, recentWorkoutRows, RECENT_LIMIT, scoreText, toMs, type RecentWorkoutRow, type ResumeRow, type TodayMain } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { useStartAlertsAsk } from '../alerts/AlertsAskSheet';
import { nowMs as clockNow } from '../clock';
import { newUuid } from '../device/runtime';
import { formatDayMonth, formatLongDate, formatShortDate, formatTime } from '../format/dates';
import type { TabParams } from '../navigation/types';
import { DeleteToastView } from '../history/DeleteToastView';
import { useDeleteToast } from '../history/useDeleteToast';
import { firstTime, useDataChanged, useLaunchInfo, useScreenData, useServices } from '../shell/context';
import { loadBanners } from '../shell/system-banners';
import { useInstallStatus } from '../shell/useInstallStatus';
import { listEnterMotion, TIMING, useTheme } from '../theme';
import type { OverviewTarget, RoutineRow, SessionPickerRow } from '../services/workout-services';
import { AppText, Eyebrow, FadeIn, HeroHeader, Icon, LinkLine, PrimaryButton, RuledSection, SecondaryButton, StatusLine, TextButton, Toast, type SymbolName } from '../ui';
import { hasChoice, SESSION_PICKER_COPY } from '../workout/session-picker';
import { SessionPickerSheet } from './workout/SessionPickerSheet';
import { NameSheet } from './routines/NameSheet';
import { BannerList } from './BannerList';
import { createAfterDismiss } from '../workout/after-dismiss';
import { FinishSheet } from './workout/FinishSheet';
import { LIBRARY_TOASTS } from '../workout/library-view';
import { BUILD_COPY } from '../coach/build-view';
import type { BuildBlock } from '../coach/coach-service';
import { NeedsCoachSheet } from './coach/NeedsCoachSheet';

/**
 * Today (today.md, D-Today mockup): date and gym, banners, one hero (Resume,
 * the stale-workout card, Done today, the next session, or a first workout),
 * the rare unlinked check-in line, and Recent (the last 5 workouts).
 *
 * First-run audit: `Start workout` always works. With no gym it first saves
 * a typical one (marked not checked, B4); with routines it starts the next in
 * the rotation (premium-feel §2.6, D19); with a past workout it starts the
 * next session at the Summary's targets (B2); otherwise an empty workout
 * that opens the exercise picker. Up next's Start (and its rows) and a
 * `Your routines` row open the Workout overview (workout-overview.md), whose
 * Start starts the workout; the check-in for those starts lives there.
 * Choosing another session (session-picker §2.1): `Change` on Up next opens
 * the picker sheet. A `Recent` row opens that past workout, as Past workouts
 * does (PM decision 18 Oct, pending Ben). The
 * rare pain flag check (region 4b) opens the pain flag sheet. The weekly
 * plan comes later. No AI, no network.
 */

/**
 * What a Start from Today begins directly: an empty workout. Up next and
 * routines go through the Workout overview, whose Start begins them.
 */
type StartIntent = { kind: 'empty' };

const ROUTINE_CAP = 4;
export function TodayScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<TabParams, 'Today'>>();
  const install = useInstallStatus();
  const launch = useLaunchInfo();
  // Shown once per launch (data-import-export §3.3 "Interrupted").
  const [interrupted, setInterrupted] = useState(() => launch.restoreInterrupted && firstTime('restore-interrupted'));
  // One opId per Start intent, kept until it succeeds: a double tap or retry starts one workout.
  const startOps = useRef(new Map<string, string>());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; action?: string; onAction?: () => void } | null>(null);
  // A workout deleted from its Summary lands here with its Undo toast (delete-workouts DW2).
  const deleted = useDeleteToast();
  const [now, setNow] = useState(clockNow);
  const [finishFor, setFinishFor] = useState<SessionAggregate | null>(null);
  const [finishVisible, setFinishVisible] = useState(false);
  const [afterDismiss] = useState(() => createAfterDismiss());
  const alertsAsk = useStartAlertsAsk();
  // Name sheet (rename, from a routine row's long-press) and its after-close step.
  const [renameRow, setRenameRow] = useState<RoutineRow | null>(null);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameAfter] = useState(() => createAfterDismiss());
  const [allRoutines, setAllRoutines] = useState(false);
  // The session picker (session-picker §2.2); a pick opens the overview once the sheet has gone.
  const [pickerVisible, setPickerVisible] = useState(false);
  /** `Needs the coach` (workout-builder §5.4) when `Build with coach` can't start. */
  const [needsCoach, setNeedsCoach] = useState<BuildBlock | null>(null);
  const [pickerAfter] = useState(() => createAfterDismiss());
  // One opId per rename intent (sheet open), so a double tap saves once.
  const renameOp = useRef<string>(newUuid());
  const [data, reload] = useScreenData(async (s) => {
    const [gym, view, banners, active, unlinked] = await Promise.all([
      s.yourData.currentGym(),
      s.today.view(),
      loadBanners(s, install),
      s.sessions.active(),
      s.checkIns.unlinked(),
    ]);
    // Never blocks Today or Start (review S1): an unreadable past workout only hides the card.
    const next = gym ? await s.next.preview(gym.id).catch(() => null) : null;
    // Recent: the newest finished workouts, as Past workouts lists them; never blocks Today.
    const recent = await s.history.pastWorkouts({ limit: RECENT_LIMIT }).then((p) => p.rows).catch(() => []);
    const routines = await s.routines.list().catch(() => [] as RoutineRow[]);
    // Session types for `Change` (local; null when unreadable: the routines list stays).
    const sessions = await s.sessions.list(gym?.id ?? null).catch(() => null);
    return { gym, view, banners, active, unlinked, next, recent, routines, sessions };
  });

  useEffect(() => {
    reload();
  }, [install, reload]);

  // Resume card shows live rest time from the deadline.
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
    // A routine deleted from the Workout overview: the toast keeps its Undo (a restore, versioned).
    // A coach draft discarded there (workout-builder §6.2): its Undo restores the draft.
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
    navigation.setParams({ toast: undefined, undoRoutine: undefined, undoDraft: undefined } as never);
  }, [handed, undoRoutine, undoDraft, navigation, services, changed]);

  // `Empty workout` on the Workouts list: Today's own start (gym, alerts question, check-in gate), once per nonce.
  const startEmpty = route.params?.startEmpty;
  const startedEmpty = useRef<string | null>(null);
  useEffect(() => {
    if (startEmpty === undefined || data.state !== 'ready' || startedEmpty.current === startEmpty) return;
    startedEmpty.current = startEmpty;
    navigation.setParams({ startEmpty: undefined } as never);
    void start({ kind: 'empty' });
  }, [startEmpty, data.state]);

  /** Up next or a routine: the Workout overview, which creates nothing until its Start. */
  function openOverview(target: OverviewTarget) {
    navigation.navigate('WorkoutOverview', { target });
  }

  /** A picked session: close the sheet, then open its overview (creates nothing). */
  function pickSession(row: SessionPickerRow) {
    pickerAfter.arm(() => {
      openOverview(row.target);
    });
    setPickerVisible(false);
  }
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  /**
   * `Build with coach` (workout-builder §3, §5.4): the coach sheet on a new
   * thread with the Build card; `Needs the coach` (no provider call) when
   * the coach can't answer.
   */
  async function buildWithCoach() {
    const block = await services.coach.buildBlock().catch(() => 'not_connected' as const);
    if (block !== null) {
      setNeedsCoach(block);
      return;
    }
    navigation.navigate('Coach', { entry: { kind: 'today' }, build: true });
  }

  /** Start an empty workout (First workout, `Empty workout`). Never leaves a dead button (audit F9). */
  async function start(intent: StartIntent) {
    if (starting) return;
    setStarting(true);
    setError(null);
    setTimeout(() => {
      setStarting(false);
    }, TIMING.commitGuard);
    try {
      let gymId = data.state === 'ready' ? (data.value.gym?.id ?? null) : null;
      if (gymId === null) {
        // Audit B4: no gym yet → a typical one (not checked), editable later. One tap, no second setup.
        const made = await services.setup.useTypicalGym();
        if (!made.ok || made.gymId === undefined) {
          setError(made.ok ? 'Couldn’t set up a gym. Try again.' : made.message);
          return;
        }
        gymId = made.gymId;
        changed();
      }
      // First Start ever: the one-time Rest alerts question, before the check-in; either answer continues (premium-feel §3.5).
      await alertsAsk.ensureAsked();
      const gate = await services.checkIns.gate();
      if (gate.kind === 'ask') {
        navigation.navigate('CheckIn', { mode: 'start', gymId });
        return;
      }
      const key = intent.kind;
      const opId = startOps.current.get(key) ?? newUuid();
      startOps.current.set(key, opId);
      const checkIn =
        gate.kind === 'reuse'
          ? ({ kind: 'answered', checkInId: gate.checkInId } as const)
          : gate.reason === 'off' || gate.reason === 'not_a_check_in_day'
            ? ({ kind: 'not_asked', reason: gate.reason } as const)
            : null;
      const r = await services.workout.start({ gymId, opId, checkIn });
      if (!r.ok) {
        setError(r.error.code === 'session_already_active' ? 'A workout is already in progress.' : r.error.message);
        reload();
        return;
      }
      startOps.current.delete(key);
      changed();
      const notice = r.notice ?? null;
      if (gate.kind === 'reuse') {
        const ci = await services.checkIns.get(gate.checkInId);
        if (ci) {
          const text = `Check-in ${formatTime(toMs(ci.recordedAt.utc), ci.recordedAt.tz)} · ${scoreText(ci.score)}`;
          navigation.navigate('Workout', { toast: { kind: 'check_in', text: notice === null ? text : `${text}. ${notice}`, checkInId: ci.id } });
          return;
        }
      }
      navigation.navigate('Workout', notice === null ? undefined : { toast: { kind: 'info', text: notice } });
    } catch (e) {
      setError(`Couldn’t start the workout: ${e instanceof Error ? e.message : String(e)}. Try again.`);
      reload();
    }
  }

  /** Resume on a chosen exercise: make its first unlogged set current, then open the workout. */
  async function resumeOn(row: ResumeRow) {
    const current = data.state === 'ready' ? data.value.active : null;
    if (row.firstPendingSetId !== null && current && row.status !== 'now') {
      const go = (version: number) => services.workout.dispatch(current.session.id, { type: 'set_active_set', at: services.now(), opId: newUuid(), setId: row.firstPendingSetId ?? '', expectedVersion: version });
      let r = await go(current.session.version);
      // The workout moved on since Today read it (a rest ended, a tick): read it again and retry once (review N4).
      if (!r.ok && r.error.code === 'stale_version') {
        const fresh = await services.workout.load(current.session.id).catch(() => null);
        if (fresh && fresh.aggregate.sets.some((x) => x.id === row.firstPendingSetId && x.status === 'pending')) r = await go(fresh.aggregate.session.version);
      }
      if (r.ok) changed();
    }
    navigation.navigate('Workout');
  }

  function askRename(row: RoutineRow) {
    renameOp.current = newUuid();
    setRenameRow(row);
    setRenameVisible(true);
  }

  async function saveRename(row: RoutineRow, name: string): Promise<string | null> {
    const r = await services.routines.rename({ routineId: row.id, name, expectedVersion: row.version, opId: renameOp.current });
    if (!r.ok) {
      if (r.stale) reload();
      return r.message;
    }
    const before = row.name;
    const saved = r.routine;
    renameAfter.arm(() => {
      setRenameRow(null);
      setToast({
        text: `Renamed to ${saved.name}`,
        action: 'Undo',
        onAction: () => {
          void services.routines.rename({ routineId: saved.id, name: before, expectedVersion: saved.version, opId: newUuid() }).then((u) => {
            if (!u.ok) setError(u.message);
            changed();
            setToast(null);
          });
        },
      });
    });
    setRenameVisible(false);
    changed();
    return null;
  }

  function confirmDelete(row: RoutineRow) {
    Alert.alert(`Delete ${row.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void services.routines.remove({ routineId: row.id, expectedVersion: row.version, opId: newUuid() }).then((r) => {
            if (!r.ok) {
              setError(r.message);
              reload();
              return;
            }
            const gone = r.routine;
            changed();
            setToast({
              text: LIBRARY_TOASTS.deleted(gone.name),
              action: 'Undo',
              onAction: () => {
                void services.routines.restore({ routineId: gone.id, expectedVersion: gone.version, opId: newUuid() }).then((u) => {
                  if (!u.ok) setError(u.message);
                  changed();
                  setToast(null);
                });
              },
            });
          });
        },
      },
    ]);
  }

  async function discardEmpty(main: Extract<TodayMain, { kind: 'stale' }>) {
    // Offered only when nothing is logged, so 0 logged sets are confirmed; if one was logged
    // meanwhile, the reducer refuses it (discard_unconfirmed) and Today reloads.
    const ask = { required: false, loggedSets: 0, expectedVersion: main.sessionVersion } as const;
    const r = await services.workout.dispatch(main.sessionId, discardCommand(ask, { opId: newUuid(), at: services.now() }));
    if (!r.ok) {
      // Review N8: a stale version reloads rather than failing the same way again.
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
          <StatusLine
            icon="exclamationmark.triangle"
            tone="warning"
            text={launch.recoveryError ? 'Your unfinished workout couldn’t be read.' : 'Couldn’t open your training data.'}
            detail="Data unchanged"
            info={data.message}
            infoLabel="Error details"
          />
          <SecondaryButton label="Try again" onPress={reload} />
          {/* The way out when a record can't be read (review S2): restore a backup; the current data is kept for Undo. */}
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
  const { gym, view, banners, active, unlinked, next, recent, routines, sessions } = data.value;
  const zoned = services.now();
  const checkInLine = (c: NonNullable<typeof unlinked>) => `Check-in ${formatTime(toMs(c.recordedAt.utc), zoned.tz)} · ${scoreText(c.score)}${c.reasons.length ? ` · ${reasonsText(c.reasons)}` : ''}`;
  const main = view?.main ?? { kind: 'no_plan' as const };
  const recentRows = recentWorkoutRows(recent, zoned);
  // `Change` on the Up next and Done today labels: the session picker (session-picker §2.1; review today-18oct B1).
  const changeAction = hasChoice(sessions)
    ? {
        labelAction: (
          <TextButton
            label={SESSION_PICKER_COPY.change}
            tone="secondary"
            accessibilityLabel={SESSION_PICKER_COPY.changeSession}
            onPress={() => {
              setPickerVisible(true);
            }}
          />
        ),
      }
    : {};

  const hero = (() => {
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
            {/* This workout's exercises: done / now / pending, in words (premium-feel §2.3). Tap one to resume on it. */}
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
            lines={[main.done === 0 ? 'Nothing logged' : `${String(main.done)} of ${String(main.total)} sets done`, main.lastSetAtUtc ? `Last set logged at ${formatTime(toMs(main.lastSetAtUtc), zoned.tz)}` : null]}
          >
            {main.endedAboutUtc ? (
              <PrimaryButton
                label={`Finish (ended about ${formatTime(toMs(main.endedAboutUtc), zoned.tz)})`}
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
        return (
          // A date-only (imported) workout has no times, so no duration (rule 6).
          // Change sits on the label, as on Up next: the way to start another session (review today-18oct B1).
          <Hero label="Done today" {...changeAction} title={main.title} lines={[doneTodayDurationLine(main.title, main.activeMs)]}>
            <SecondaryButton
              label="View summary"
              onPress={() => {
                navigation.navigate('Summary', { sessionId: main.sessionId });
              }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['5'] }}>
              {/* A second workout: Up next stays one tap, Change picks another (premium-feel §2.4; review today-18oct B1). */}
              {next ? (
                <TextButton
                  label="Start next session"
                  onPress={() => {
                    openOverview({ kind: 'next' });
                  }}
                />
              ) : null}
              <TextButton label="Empty workout" onPress={() => void start({ kind: 'empty' })} />
            </View>
          </Hero>
        );
      case 'no_plan':
        if (next) {
          const exerciseCount = next.exercises.length;
          const basis =
            next.routine?.basis.kind === 'only'
              ? 'Your only workout'
              : next.routine?.basis.kind === 'after'
                ? `After ${next.routine.basis.routineName} on ${formatShortDate(toMs(next.routine.basis.atUtc), next.routine.basis.tz)}`
                : next.sourceStartedAtUtc !== null
                  ? `From ${formatShortDate(toMs(next.sourceStartedAtUtc), next.tz)}`
                  : null;
          return (
            <Hero
              label="Up next"
              {...changeAction}
              title={next.title}
              lines={[
                [next.muscles, `${String(exerciseCount)} ${exerciseCount === 1 ? 'exercise' : 'exercises'}`, next.aboutMinutes !== null ? `about ${String(next.aboutMinutes)} min` : `${String(next.sets)} sets`].filter(Boolean).join(' · '),
                basis,
              ]}
            >
              <PrimaryButton
                label="Start workout"
                busy={starting}
                onPress={() => {
                  openOverview({ kind: 'next' });
                }}
              />
              {/* What Start creates, already fitted to this gym; each line says `Target` (premium-feel §2.3). A row opens the overview. */}
              <DetailList
                rows={next.targets.map((t, i) => ({
                  key: `${String(i)}:${t.exerciseName}`,
                  title: t.exerciseName,
                  detail: t.line,
                  onPress: () => {
                    openOverview({ kind: 'next' });
                  },
                }))}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['5'] }}>
                <TextButton label="Empty workout" onPress={() => void start({ kind: 'empty' })} />
                <TextButton
                  label="Past workouts"
                  onPress={() => {
                    navigation.navigate('PastWorkouts');
                  }}
                />
                {/* workout-builder §3: a text link, never a filled pill, so Today keeps one primary. */}
                <TextButton label={BUILD_COPY.link} onPress={() => void buildWithCoach()} />
              </View>
            </Hero>
          );
        }
        return (
          <Hero label="Today" title="First workout" lines={[]}>
            <PrimaryButton label="Start workout" busy={starting} onPress={() => void start({ kind: 'empty' })} />
          </Hero>
        );
    }
  })();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['6'], paddingBottom: theme.space['8'] + 56, gap: theme.space['6'] }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], flexWrap: 'wrap' }}>
          <AppText variant="sectionLabel" color="text.secondary" accessibilityRole="header" style={{ fontSize: 13 }}>
            {formatLongDate(toMs(zoned.utc), zoned.tz)}
          </AppText>
          <LinkLine
            accessibilityLabel={gym ? `Gym: ${gym.name}. Opens its equipment.` : 'Set up your gym'}
            onPress={() => {
              if (!gym) navigation.navigate('AddGym');
              // The gym's equipment, to check or correct it (gym editor).
              else navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'GymDetail', params: { gymId: gym.id }, initial: false } });
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space['4'], minHeight: 34, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.divider'] }}>
              <AppText variant="label">{`${gym?.name ?? 'Set up gym'} ▾`}</AppText>
            </View>
          </LinkLine>
        </View>

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

        {hero}

        {unlinked && main.kind !== 'resume' && main.kind !== 'stale' ? (
          <LinkLine
            // The visible time and score, read out too (review N6).
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

        {/* Region 4b (today.md, rare): a pain flag's two-weekly check. Quiet, not a banner, never a notification. */}
        {view?.painCheck ? (
          <LinkLine
            accessibilityLabel={view.painCheck.accessibilityLabel}
            onPress={() => {
              const pc = view.painCheck;
              if (pc?.kind === 'one') navigation.navigate('PainFlag', { flagId: pc.flagId });
              else navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'PainFlags', initial: false } });
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], minHeight: theme.target.min.height }}>
              <Icon name="exclamationmark.triangle" color="status.warning" size={16} />
              <AppText variant="callout" style={{ flex: 1 }}>
                {view.painCheck.text}
              </AppText>
              <Icon name="chevron.right" size={14} color="text.tertiary" />
            </View>
          </LinkLine>
        ) : null}

        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}

        {/* Your routines (premium-feel §2.1 region 6), only when the session list couldn't be read: routines stay reachable. */}
        {sessions === null && routines.length > 0 && main.kind !== 'resume' && main.kind !== 'stale' ? (
          <RuledSection title="Your workouts" gap="2">
            {(allRoutines ? routines : routines.slice(0, ROUTINE_CAP)).map((r, i) => (
              <FadeIn key={r.id} motion={i >= ROUTINE_CAP ? listEnterMotion(i - ROUTINE_CAP, theme.a11y.reduceMotion) : null}>
                <RoutineListRow
                  row={r}
                  tz={zoned.tz}
                  onPress={() => {
                    openOverview({ kind: 'routine', routineId: r.id });
                  }}
                  onLongPress={() => {
                    ActionSheetIOS.showActionSheetWithOptions({ title: r.name, options: ['Rename', 'Delete', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 }, (k) => {
                      if (k === 0) askRename(r);
                      if (k === 1) confirmDelete(r);
                    });
                  }}
                />
              </FadeIn>
            ))}
            {routines.length > ROUTINE_CAP && !allRoutines ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <TextButton
                  label="All workouts"
                  icon="chevron.right"
                  tone="secondary"
                  onPress={() => {
                    setAllRoutines(true);
                  }}
                />
              </View>
            ) : null}
          </RuledSection>
        ) : null}

        {/* The Workouts list is in the Library tab now (exercise-library EL10): Today gets nothing new and its `Workouts` link retired. */}

        {/* Recent (PM decision 18 Oct, pending Ben): replaces This week, the lift card and the Sessions rows. */}
        {recentRows.length > 0 ? (
          <RuledSection title="Recent" gap="2">
            {recentRows.map((r) => (
              <RecentRow
                key={r.sessionId}
                row={r}
                onPress={() => {
                  if (r.opens === 'summary') navigation.navigate('Summary', { sessionId: r.sessionId, back: true });
                  else navigation.navigate('Repeat', { sessionId: r.sessionId });
                }}
              />
            ))}
          </RuledSection>
        ) : null}
      </ScrollView>
      <AskPill
        onPress={() => {
          navigation.navigate('Coach', { entry: { kind: 'today' } });
        }}
      />
      {alertsAsk.sheet}
      <SessionPickerSheet
        visible={pickerVisible}
        list={sessions}
        now={zoned}
        shown={null}
        onPick={pickSession}
        onClose={() => {
          setPickerVisible(false);
        }}
        onRetry={reload}
        onEmptyWorkout={() => {
          pickerAfter.arm(() => void start({ kind: 'empty' }));
          setPickerVisible(false);
        }}
        onBuildWithCoach={() => {
          pickerAfter.arm(() => void buildWithCoach());
          setPickerVisible(false);
        }}
        onEditWorkouts={() => {
          pickerAfter.arm(() => {
            navigation.navigate('Tabs', { screen: 'Library', params: { screen: 'LibraryHome', params: { segment: 'workouts' } } });
          });
          setPickerVisible(false);
        }}
        onPastWorkouts={() => {
          pickerAfter.arm(() => {
            navigation.navigate('PastWorkouts');
          });
          setPickerVisible(false);
        }}
        onDismissed={pickerAfter.dismissed}
      />
      <NeedsCoachSheet
        block={needsCoach}
        onClose={() => {
          setNeedsCoach(null);
        }}
        onConnect={() => {
          setNeedsCoach(null);
          navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'CoachConnection' } });
        }}
        onEmptyWorkout={() => {
          setNeedsCoach(null);
          void start({ kind: 'empty' });
        }}
        onChooseSession={() => {
          setNeedsCoach(null);
          setPickerVisible(true);
        }}
      />
      {renameRow ? (
        <NameSheet
          visible={renameVisible}
          title="Rename workout"
          buttonLabel="Save name"
          initialName={renameRow.name}
          check={(n) => services.routines.checkName(n, renameRow.id)}
          onSubmit={(n) => saveRename(renameRow, n)}
          onClose={() => {
            setRenameVisible(false);
          }}
          onDismissed={renameAfter.dismissed}
        />
      ) : null}
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
            // One tested rule for every Discard (competitor-failure pack (e)): confirm whenever a set is logged.
            const ask = discardConfirmation(target);
            const go = () => {
              void services.workout.dispatch(target.session.id, discardCommand(ask, { opId: newUuid(), at: services.now() })).then((r) => {
                if (!r.ok) {
                  setFinishFor(null);
                  setError(r.error.code === 'stale_version' || r.error.code === 'discard_unconfirmed' ? 'The workout changed. Check it and try again.' : `Couldn’t discard: ${r.error.message}`);
                  reload();
                  return;
                }
                // Close the sheet first; the toast shows once it has gone (review S8).
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

/** D-Today's hero: tracked label (with `Change` on Up next), a 40pt title, quiet lines, then the actions. */
function Hero({ label, labelAction, title, lines, children }: { label: string; labelAction?: ReactNode; title: string; lines: readonly (string | null)[]; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['6'] }}>
      {labelAction ? (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'], marginBottom: -theme.space['2'] }}>
            <Eyebrow>{label}</Eyebrow>
            {labelAction}
          </View>
          <HeroHeader title={title} lines={lines} />
        </View>
      ) : (
        <HeroHeader eyebrow={label} title={title} lines={lines} />
      )}
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
  status?: ResumeRow['status'];
  onPress?: () => void;
}

/**
 * The hero's detail list (premium-feel §2.3): Up next targets (two lines;
 * a tap opens the Workout overview) or Resume progress (one line with a status icon and words,
 * ≥ 52 pt, tappable). At most 5, then `+2 more` expands in place; only the
 * rows that appear then fade in (`motion.listEnter`).
 */
function DetailList({ rows }: { rows: readonly DetailRow[] }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, DETAIL_CAP);
  const hidden = rows.length - shown.length;
  return (
    <View>
      {shown.map((r, i) => {
        const added = i >= DETAIL_CAP;
        const body =
          r.status !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${r.title}, ${ROW_WORD[r.status]}, ${r.detail}`}
              accessibilityHint="Resumes the workout on this exercise"
              onPress={r.onPress}
              style={({ pressed }) => ({
                minHeight: theme.target.workout.height,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space['3'],
                backgroundColor: pressed ? theme.colors['bg.surface'] : 'transparent',
              })}
            >
              <Icon name={ROW_ICON[r.status].icon} color={ROW_ICON[r.status].color} size={16} />
              <AppText variant="body" numberOfLines={2} color={r.status === 'pending' || r.status === 'skipped' ? 'text.secondary' : 'text.primary'} style={{ flex: 1, fontWeight: r.status === 'now' ? '600' : '400' }}>
                {r.title}
              </AppText>
              <AppText variant="callout" color="text.secondary" numeric>
                {r.detail}
              </AppText>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole={r.onPress ? 'button' : 'text'}
              accessibilityLabel={`${r.title}. ${r.detail}`}
              disabled={!r.onPress}
              onPress={r.onPress}
              style={({ pressed }) => ({ minHeight: theme.target.min.height, justifyContent: 'center', paddingVertical: theme.space['1'], backgroundColor: pressed ? theme.colors['bg.surface'] : 'transparent' })}
            >
              <AppText variant="body">{r.title}</AppText>
              <AppText variant="callout" color="text.secondary" numeric>
                {r.detail}
              </AppText>
            </Pressable>
          );
        return (
          <FadeIn key={r.key} motion={added ? listEnterMotion(i - DETAIL_CAP, theme.a11y.reduceMotion) : null}>
            {body}
          </FadeIn>
        );
      })}
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

/** A `Your routines` row (≥ 52 pt): name, then `5 exercises · 6 Oct` or `5 exercises · not done yet`, and a chevron. */
function RoutineListRow({ row, tz, onPress, onLongPress }: { row: RoutineRow; tz: string; onPress: () => void; onLongPress: () => void }) {
  const theme = useTheme();
  const count = `${String(row.exercises)} ${row.exercises === 1 ? 'exercise' : 'exercises'}`;
  const when = row.lastDone ? formatDayMonth(toMs(row.lastDone.atUtc), row.lastDone.tz || tz) : 'not done yet';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.name}, ${count}, ${row.lastDone ? `last done ${when}` : 'not done yet'}`}
      accessibilityHint="Opens the workout's overview. Touch and hold to rename or delete."
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        minHeight: theme.target.workout.height,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
        backgroundColor: pressed ? theme.colors['bg.surface'] : 'transparent',
      })}
    >
      <AppText variant="body" numberOfLines={2} style={{ flex: 1 }}>
        {row.name}
      </AppText>
      <AppText variant="callout" color="text.secondary" numeric>
        {`${count} · ${when}`}
      </AppText>
      <Icon name="chevron.right" color="text.tertiary" size={14} />
    </Pressable>
  );
}

/** A `Recent` row (≥ 52 pt): name, then `Yesterday · 16 sets`, and a chevron. Opens that past workout. */
function RecentRow({ row, onPress }: { row: RecentWorkoutRow; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.target.workout.height,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
        backgroundColor: pressed ? theme.colors['bg.surface'] : 'transparent',
      })}
    >
      <AppText variant="body" numberOfLines={2} style={{ flex: 1 }}>
        {row.title}
      </AppText>
      <AppText variant="callout" color="text.secondary" numeric>
        {`${row.when} · ${row.detail}`}
      </AppText>
      <Icon name="chevron.right" color="text.tertiary" size={14} />
    </Pressable>
  );
}
