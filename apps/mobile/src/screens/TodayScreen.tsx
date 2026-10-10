import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { formatDuration, formatMinutes, reasonsText, scoreText, sparklinePoints, toMs, weekStripLabel, type LiftHighlight, type ResumeRow, type TodayMain, type WeekDay } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { useStartAlertsAsk } from '../alerts/AlertsAskSheet';
import { nowMs as clockNow } from '../clock';
import { newUuid } from '../device/runtime';
import { formatDayMonth, formatLongDate, formatShortDate, formatTime } from '../format/dates';
import type { TabParams } from '../navigation/types';
import { firstTime, useDataChanged, useLaunchInfo, useScreenData, useServices } from '../shell/context';
import { loadBanners } from '../shell/system-banners';
import { useInstallStatus } from '../shell/useInstallStatus';
import { listEnterMotion, TIMING, useTheme } from '../theme';
import { AppText, Eyebrow, FadeIn, HeroHeader, Icon, LinkLine, PrimaryButton, RuledSection, SecondaryButton, Sparkline, StatusLine, TextButton, Toast, type SymbolName } from '../ui';
import { BannerList } from './BannerList';
import { createAfterDismiss } from '../workout/after-dismiss';
import { FinishSheet } from './workout/FinishSheet';

/**
 * Today (today.md, D-Today mockup): date and gym, banners, one hero (Resume,
 * the stale-workout card, Done today, the next session, or a first workout),
 * the rare unlinked check-in line, and This week.
 *
 * First-run audit: `Start workout` always works. With no gym it first saves
 * a typical one (marked not checked, B4); with a past workout it starts the
 * next session at the Summary's targets (B2); otherwise an empty workout
 * that opens the exercise picker. Routines and the weekly plan come later.
 * No AI, no network.
 */
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
  const [now, setNow] = useState(clockNow);
  const [finishFor, setFinishFor] = useState<SessionAggregate | null>(null);
  const [finishVisible, setFinishVisible] = useState(false);
  const [afterDismiss] = useState(() => createAfterDismiss());
  const alertsAsk = useStartAlertsAsk();
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
    // Decorative history; never blocks Today either.
    const lift = await s.today.liftHighlight().catch(() => null);
    return { gym, view, banners, active, unlinked, next, lift };
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
  useEffect(() => {
    if (!handed) return;
    setToast({ text: handed });
    navigation.setParams({ toast: undefined } as never);
  }, [handed, navigation]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  /** Start: next session (`nextOf`) or an empty workout. Never leaves a dead button (audit F9). */
  async function start(nextOf: string | null) {
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
        navigation.navigate('CheckIn', { mode: 'start', gymId, ...(nextOf !== null ? { nextOf } : {}) });
        return;
      }
      const key = nextOf ?? 'empty';
      const opId = startOps.current.get(key) ?? newUuid();
      startOps.current.set(key, opId);
      const checkIn =
        gate.kind === 'reuse'
          ? ({ kind: 'answered', checkInId: gate.checkInId } as const)
          : gate.reason === 'off' || gate.reason === 'not_a_check_in_day'
            ? ({ kind: 'not_asked', reason: gate.reason } as const)
            : null;
      const r = await services.workout.start({ gymId, opId, checkIn, nextOf });
      if (!r.ok) {
        setError(r.error.code === 'session_already_active' ? 'A workout is already in progress. Resume it above.' : r.error.message);
        reload();
        return;
      }
      startOps.current.delete(key);
      changed();
      const notice = r.notice ?? null;
      if (gate.kind === 'reuse') {
        const ci = await services.checkIns.get(gate.checkInId);
        if (ci) {
          const text = `Using your check-in from ${formatTime(toMs(ci.recordedAt.utc), ci.recordedAt.tz)} · ${scoreText(ci.score)}`;
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
      const r = await services.workout.dispatch(current.session.id, { type: 'set_active_set', at: services.now(), opId: newUuid(), setId: row.firstPendingSetId, expectedVersion: current.session.version });
      if (r.ok) changed();
    }
    navigation.navigate('Workout');
  }

  async function discardEmpty(main: Extract<TodayMain, { kind: 'stale' }>) {
    const r = await services.workout.dispatch(main.sessionId, { type: 'discard', at: services.now(), opId: newUuid(), expectedVersion: main.sessionVersion });
    if (!r.ok) {
      // Review N8: a stale version reloads rather than failing the same way again.
      setError(r.error.code === 'stale_version' ? 'The workout changed. Check it and try again.' : `Couldn’t discard: ${r.error.message}`);
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
            detail={`Nothing was deleted. ${data.message}`}
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
  const { gym, view, banners, active, unlinked, next, lift } = data.value;
  const zoned = services.now();
  const main = view?.main ?? { kind: 'no_plan' as const };

  const hero = (() => {
    switch (main.kind) {
      case 'resume': {
        const status =
          main.status.kind === 'resting'
            ? toMs(main.status.deadlineUtc) <= now
              ? 'Rest over · ready for next set'
              : `Rest ${formatDuration(Math.ceil((toMs(main.status.deadlineUtc) - now) / 1000))} left`
            : main.status.kind === 'paused'
              ? 'Paused'
              : main.status.kind === 'all_done'
                ? 'All planned sets done'
                : main.status.kind === 'empty'
                  ? 'Add an exercise to start'
                  : 'Ready for next set';
        return (
          <Hero label={`In progress · started ${formatTime(toMs(main.startedAtUtc), zoned.tz)}`} title={main.title} lines={[main.now, `${String(main.done)} of ${String(main.total)} sets done · ${status}`]}>
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
          <Hero label="Done today" title={main.title} lines={[main.activeMs === null ? null : formatMinutes(main.activeMs)]}>
            <SecondaryButton
              label="View summary"
              onPress={() => {
                navigation.navigate('Summary', { sessionId: main.sessionId });
              }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['5'] }}>
              {/* Next targets from today's workout, not a repeat of it (review S1). */}
              {next ? <TextButton label="Start next session" onPress={() => void start(next.sourceSessionId)} /> : null}
              <TextButton label="Empty workout" onPress={() => void start(null)} />
            </View>
          </Hero>
        );
      case 'no_plan':
        if (next) {
          const exerciseCount = next.exercises.length;
          return (
            <Hero
              label="Up next"
              title={next.title}
              lines={[
                [next.muscles, `${String(exerciseCount)} ${exerciseCount === 1 ? 'exercise' : 'exercises'} · ${String(next.sets)} sets`].filter(Boolean).join(' · '),
                `From ${formatShortDate(toMs(next.sourceStartedAtUtc), next.tz)}, with next targets (built-in rule)`,
              ]}
            >
              <PrimaryButton label="Start workout" busy={starting} onPress={() => void start(next.sourceSessionId)} />
              {/* What Start creates, already fitted to this gym; each line says `Target` (premium-feel §2.3). */}
              <DetailList rows={next.targets.map((t, i) => ({ key: `${String(i)}:${t.exerciseName}`, title: t.exerciseName, detail: t.line }))} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['5'] }}>
                <TextButton label="Empty workout" onPress={() => void start(null)} />
                <TextButton
                  label="Past workouts"
                  onPress={() => {
                    navigation.navigate('PastWorkouts');
                  }}
                />
              </View>
            </Hero>
          );
        }
        return (
          <Hero label="Today" title="First workout" lines={['Pick an exercise and log your first set. Common lifts are at the top.']}>
            <PrimaryButton label="Start workout" busy={starting} onPress={() => void start(null)} />
            {gym ? null : (
              <AppText variant="callout" color="text.secondary">
                Uses a typical gym (barbell, dumbbells, cables, machines) until you check its equipment in Profile.
              </AppText>
            )}
          </Hero>
        );
    }
  })();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['6'], paddingBottom: theme.space['8'], gap: theme.space['6'] }}
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
            text="A restore was interrupted. Your data is as it was before."
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
            accessibilityLabel="Edit your saved check-in"
            onPress={() => {
              navigation.navigate('CheckIn', { mode: 'edit', checkInId: unlinked.id });
            }}
          >
            <AppText variant="callout" color="text.secondary" numeric>
              {`Check-in saved at ${formatTime(toMs(unlinked.recordedAt.utc), zoned.tz)}: ${scoreText(unlinked.score)}${unlinked.reasons.length ? ` · ${reasonsText(unlinked.reasons)}` : ''}. It’ll be used when you start.`}
            </AppText>
          </LinkLine>
        ) : null}

        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}

        <RuledSection title="This week">
          {view && view.week.days.length === 7 ? <WeekStrip days={view.week.days} /> : null}
          <AppText variant="callout" color="text.secondary" numeric>
            {view?.week.text ?? 'No workouts yet this week.'}
          </AppText>
        </RuledSection>

        {/* Shown in every state but Stale and First workout (premium-feel §2.1). */}
        {lift && main.kind !== 'stale' ? <LiftCard lift={lift} /> : null}
      </ScrollView>
      {alertsAsk.sheet}
      {toast ? <Toast icon="info.circle" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} /> : null}
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
            const logged = target.sets.filter((x) => x.status === 'completed').length;
            Alert.alert('Discard this workout?', `${String(logged)} logged ${logged === 1 ? 'set' : 'sets'} will be discarded. This can’t be undone.`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Discard',
                style: 'destructive',
                onPress: () => {
                  void services.workout.dispatch(target.session.id, { type: 'discard', at: services.now(), opId: newUuid(), expectedVersion: target.session.version }).then((r) => {
                    if (!r.ok) {
                      setFinishFor(null);
                      setError(r.error.code === 'stale_version' ? 'The workout changed. Check it and try again.' : `Couldn’t discard: ${r.error.message}`);
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
                },
              },
            ]);
          }}
          onStale={reload}
        />
      ) : null}
    </View>
  );
}

/** D-Today's hero: tracked label, a 40pt title, quiet lines, then the actions. */
function Hero({ label, title, lines, children }: { label: string; title: string; lines: readonly (string | null)[]; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['6'] }}>
      <HeroHeader eyebrow={label} title={title} lines={lines} />
      <View style={{ gap: theme.space['4'] }}>{children}</View>
    </View>
  );
}

/** D-Today's lift: `BENCH PRESS`, `100 kg × 8  6 Oct · up from 97.5`, a trend line. Logged sets only (rule 6). */
function LiftCard({ lift }: { lift: LiftHighlight }) {
  const theme = useTheme();
  const when = formatDayMonth(toMs(lift.performedAtUtc), lift.tz);
  const detail = [when, lift.change].filter(Boolean).join(' · ');
  return (
    <View style={{ gap: theme.space['2'] }}>
      <View accessible accessibilityLabel={`${lift.exerciseName}, last top set ${lift.text}, ${detail}`} style={{ gap: theme.space['2'] }}>
        <Eyebrow>{lift.exerciseName}</Eyebrow>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: theme.space['3'] }}>
          <AppText variant="title1" numeric style={{ fontSize: 28, lineHeight: 34, fontWeight: '500' }}>
            {lift.text}
          </AppText>
          <AppText variant="callout" color="text.secondary" numeric>
            {detail}
          </AppText>
        </View>
      </View>
      {lift.points.length >= 2 ? (
        <Sparkline
          points={(w) => sparklinePoints(lift.points, w, 40)}
          height={40}
        />
      ) : null}
    </View>
  );
}

/** This week (D-Today): a dot per day; filled = trained, ring with a centre = in progress, ringed = today. The line below says it in words. */
function WeekStrip({ days }: { days: readonly WeekDay[] }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel={weekStripLabel(days)} style={{ flexDirection: 'row' }}>
      {days.map((d) => (
        <View key={d.localDate} style={{ flex: 1, alignItems: 'center', gap: theme.space['2'] }}>
          <AppText variant="sectionLabel" color={d.today ? 'text.primary' : 'text.tertiary'} style={{ letterSpacing: 0 }}>
            {d.letter}
          </AppText>
          {/* Done = filled; in progress = ring with a 4 pt centre; today with nothing = ring (premium-feel §2.5). */}
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: d.trained ? theme.colors.accent : 'transparent',
              borderWidth: d.trained ? 0 : d.inProgress || d.today ? 1.5 : 0,
              borderColor: theme.colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {d.inProgress && !d.trained ? <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.accent }} /> : null}
          </View>
        </View>
      ))}
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
 * The hero's detail list (premium-feel §2.3): Up next targets (two lines,
 * not tappable) or Resume progress (one line with a status icon and words,
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
            <View accessible accessibilityLabel={`${r.title}. ${r.detail}`} style={{ minHeight: theme.target.min.height, justifyContent: 'center', paddingVertical: theme.space['1'] }}>
              <AppText variant="body">{r.title}</AppText>
              <AppText variant="callout" color="text.secondary" numeric>
                {r.detail}
              </AppText>
            </View>
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
