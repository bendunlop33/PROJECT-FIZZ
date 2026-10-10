import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { discardCommand, discardConfirmation, formatDuration, formatMinutes, reasonsText, scoreText, toMs, type TodayMain } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { nowMs as clockNow } from '../clock';
import { newUuid } from '../device/runtime';
import { formatShortDate, formatTime } from '../format/dates';
import type { TabParams } from '../navigation/types';
import { firstTime, useDataChanged, useLaunchInfo, useScreenData, useServices } from '../shell/context';
import { loadBanners } from '../shell/system-banners';
import { useInstallStatus } from '../shell/useInstallStatus';
import { TIMING, useTheme } from '../theme';
import { AppText, Card, Icon, LinkLine, PrimaryButton, SecondaryButton, SectionHeader, StatusLine, TextButton, Toast } from '../ui';
import { BannerList } from './BannerList';
import { createAfterDismiss } from '../workout/after-dismiss';
import { FinishSheet } from './workout/FinishSheet';

/**
 * Today (today.md) for this build: date and gym, banners, one main card
 * (Resume, the stale-workout card, Done today, or Nothing planned with
 * `Start empty workout`), the rare unlinked check-in line, and This week.
 * Routines, the weekly plan and the Ask pill come later. No AI, no network.
 * A gym is required to start (PM SP1).
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
  // The Start opId lives until a start succeeds: a double tap or retry starts one workout.
  const startOp = useRef<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; action?: string; onAction?: () => void } | null>(null);
  const [now, setNow] = useState(clockNow);
  const [finishFor, setFinishFor] = useState<SessionAggregate | null>(null);
  const [finishVisible, setFinishVisible] = useState(false);
  const [afterDismiss] = useState(() => createAfterDismiss());
  const [data, reload] = useScreenData(async (s) => {
    const [gym, view, banners, active, unlinked, last] = await Promise.all([
      s.yourData.currentGym(),
      s.today.view(),
      loadBanners(s, install),
      s.sessions.active(),
      s.checkIns.unlinked(),
      // Never blocks Today or Start (review S1): an unreadable past workout only hides the row.
      s.repeat.last().catch(() => null),
    ]);
    return { gym, view, banners, active, unlinked, last };
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

  async function start(gymId: string) {
    if (starting) return;
    setStarting(true);
    setError(null);
    setTimeout(() => {
      setStarting(false);
    }, TIMING.commitGuard);
    const gate = await services.checkIns.gate();
    if (gate.kind === 'ask') {
      navigation.navigate('CheckIn', { mode: 'start', gymId });
      return;
    }
    startOp.current ??= newUuid();
    const checkIn =
      gate.kind === 'reuse'
        ? ({ kind: 'answered', checkInId: gate.checkInId } as const)
        : gate.reason === 'off' || gate.reason === 'not_a_check_in_day'
          ? ({ kind: 'not_asked', reason: gate.reason } as const)
          : null;
    const r = await services.workout.start({ gymId, opId: startOp.current, checkIn });
    if (!r.ok) {
      setError(r.error.code === 'session_already_active' ? 'A workout is already in progress. Resume it below.' : r.error.message);
      reload();
      return;
    }
    startOp.current = null;
    changed();
    if (gate.kind === 'reuse') {
      const ci = await services.checkIns.get(gate.checkInId);
      navigation.navigate('Workout', ci ? { toast: { kind: 'check_in', text: `Using your check-in from ${formatTime(toMs(ci.recordedAt.utc), ci.recordedAt.tz)} · ${scoreText(ci.score)}`, checkInId: ci.id } } : undefined);
      return;
    }
    navigation.navigate('Workout');
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
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], padding: theme.space['4'] }}>
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
  const { gym, view, banners, active, unlinked, last } = data.value;
  // Repeat last workout / Start from a past workout (routines.md RT4): the stand-in for routines.
  const repeatRows =
    gym && last ? (
      <View style={{ gap: theme.space['2'] }}>
        <SecondaryButton
          label="Repeat last workout"
          icon="arrow.clockwise"
          accessibilityHint={`${last.exerciseNames.join(', ')}, ${formatShortDate(toMs(last.startedAtUtc), last.tz)}`}
          onPress={() => {
            navigation.navigate('Repeat', { sessionId: last.sessionId });
          }}
        />
        <AppText variant="callout" color="text.secondary" numeric>{`${last.exerciseNames.slice(0, 3).join(', ')}${last.exerciseNames.length > 3 ? ` +${String(last.exerciseNames.length - 3)}` : ''} · ${formatShortDate(toMs(last.startedAtUtc), last.tz)} · ${String(last.sets)} ${last.sets === 1 ? 'set' : 'sets'}`}</AppText>
        <TextButton
          label="Start from a past workout"
          onPress={() => {
            navigation.navigate('PastWorkouts');
          }}
        />
      </View>
    ) : null;
  const zoned = services.now();
  const main = view?.main ?? { kind: 'no_plan' as const };

  const mainCard = (() => {
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
          <Card>
            <StatusLine icon="arrowtriangle.right.fill" tone="info" text={`In progress · started ${formatTime(toMs(main.startedAtUtc), zoned.tz)}`} />
            <AppText variant="title2">{main.title}</AppText>
            {main.now ? <AppText variant="body" numeric>{`Now: ${main.now}`}</AppText> : null}
            <AppText variant="callout" color="text.secondary" numeric>{`${String(main.done)} of ${String(main.total)} sets done`}</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
              <Icon name={main.status.kind === 'paused' ? 'pause.circle.fill' : main.status.kind === 'resting' ? 'timer' : 'figure.strengthtraining.traditional'} color={main.status.kind === 'paused' ? 'status.warning' : 'text.secondary'} size={16} />
              <AppText variant="callout" numeric>
                {status}
              </AppText>
            </View>
            <PrimaryButton
              label="Resume"
              onPress={() => {
                navigation.navigate('Workout');
              }}
            />
          </Card>
        );
      }
      case 'stale':
        return (
          <Card>
            <StatusLine icon="exclamationmark.triangle" tone="warning" text={`Unfinished workout · ${formatShortDate(toMs(main.startedAtUtc), zoned.tz)}`} />
            <AppText variant="body" numeric>{`${main.title} · ${main.done === 0 ? 'Nothing logged' : `${String(main.done)} of ${String(main.total)} sets done`}`}</AppText>
            {main.lastSetAtUtc ? <AppText variant="callout" color="text.secondary" numeric>{`Last set logged at ${formatTime(toMs(main.lastSetAtUtc), zoned.tz)}`}</AppText> : null}
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
          </Card>
        );
      case 'done_today':
        return (
          <Card>
            {/* A date-only (imported) workout has no times, so no duration (rule 6). */}
            <StatusLine icon="checkmark.circle.fill" tone="done" text={main.activeMs === null ? `${main.title} done` : `${main.title} done · ${formatMinutes(main.activeMs)}`} />
            <TextButton
              label="View summary"
              onPress={() => {
                navigation.navigate('Summary', { sessionId: main.sessionId });
              }}
            />
            {gym ? <SecondaryButton label="Start another workout" onPress={() => void start(gym.id)} /> : null}
            {repeatRows}
          </Card>
        );
      case 'no_plan':
        return (
          <Card>
            <AppText variant="title2">Nothing planned today</AppText>
            {gym ? (
              <PrimaryButton label="Start empty workout" busy={starting} onPress={() => void start(gym.id)} />
            ) : (
              <>
                <PrimaryButton
                  label="Add gym"
                  onPress={() => {
                    navigation.navigate('AddGym');
                  }}
                />
                <AppText variant="callout" color="text.secondary">
                  A workout needs a gym, so loads can be checked against its equipment.
                </AppText>
              </>
            )}
            {repeatRows}
          </Card>
        );
    }
  })();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['8'], paddingBottom: theme.space['8'], gap: theme.space['5'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], flexWrap: 'wrap' }}>
            <AppText variant="headline" accessibilityRole="header">
              {formatShortDate(toMs(zoned.utc), zoned.tz)}
            </AppText>
            <LinkLine
              accessibilityLabel={gym ? `Gym: ${gym.name}. Opens its equipment.` : 'Add gym'}
              onPress={() => {
                if (!gym) navigation.navigate('AddGym');
                // The gym's equipment, to check or correct it (gym editor).
                else navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'GymDetail', params: { gymId: gym.id }, initial: false } });
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], paddingHorizontal: theme.space['3'], minHeight: theme.target.min.height, borderRadius: theme.radius.pill, backgroundColor: theme.colors['bg.raised'] }}>
                <Icon name="building.2" size={16} />
                <AppText variant="label">{gym?.name ?? 'Add gym'}</AppText>
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
          {mainCard}

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

          <View style={{ gap: theme.space['1'] }}>
            <SectionHeader title="This week" />
            <AppText variant="body" numeric>
              {view?.week.text ?? 'No workouts logged yet this week.'}
            </AppText>
          </View>
      </ScrollView>
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
            // One tested rule for every Discard (competitor-failure pack (e)): confirm whenever a set is logged.
            const ask = discardConfirmation(target);
            const go = () => {
              void services.workout.dispatch(target.session.id, discardCommand(ask, { opId: newUuid(), at: services.now() })).then((r) => {
                setFinishFor(null);
                if (!r.ok) {
                  setError(r.error.code === 'stale_version' || r.error.code === 'discard_unconfirmed' ? 'The workout changed. Check it and try again.' : `Couldn’t discard: ${r.error.message}`);
                  reload();
                  return;
                }
                changed();
                setToast({ text: 'Workout discarded' });
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
