import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { toMs } from '@fizz/domain';

import { loadBanners } from '../shell/system-banners';
import { useInstallStatus } from '../shell/useInstallStatus';
import { useDataChanged, useScreenData, useServices } from '../shell/context';
import { newUuid } from '../device/runtime';
import { formatShortDate, formatTime } from '../format/dates';
import { plural } from '../format/numbers';
import { TIMING, useTheme } from '../theme';
import { AppText, Card, Icon, PrimaryButton, Screen, StatusLine } from '../ui';
import { BannerList } from './BannerList';

/**
 * Today, minimal for this slice (today.md): date, gym, banners, and one main
 * card: Resume an unfinished workout, or `Start empty workout`. Plans,
 * routines, check-in, This week and Next session come with later slices.
 * No AI and no network.
 */
export function TodayScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const install = useInstallStatus();
  const opId = useRef(newUuid());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, reload] = useScreenData(async (s) => {
    const [gym, active, banners] = await Promise.all([s.yourData.currentGym(), s.sessions.active(), loadBanners(s, install)]);
    return { gym, active, banners };
  });

  // Signing is read after launch and on every return to the foreground.
  useEffect(() => {
    reload();
  }, [install, reload]);

  const now = services.now();
  const nowMs = toMs(now.utc);

  async function start(gymId: string) {
    if (starting) return;
    setStarting(true);
    setError(null);
    const r = await services.sessions.startEmpty({ gymId, opId: opId.current });
    // The button stays disabled for timing.commitGuard so a double tap can't start twice.
    setTimeout(() => {
      setStarting(false);
    }, TIMING.commitGuard);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    opId.current = newUuid();
    changed();
    navigation.navigate('Workout');
  }

  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open your training data." detail={data.message} />
      </Screen>
    );
  }
  const { gym, active, banners } = data.value;
  const stale = active !== null && nowMs - toMs(active.session.lastActivityAtUtc) >= TIMING.staleWorkout;
  const logged = active?.sets.filter((s) => s.status === 'completed').length ?? 0;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], flexWrap: 'wrap' }}>
        <AppText variant="headline" accessibilityRole="header">
          {formatShortDate(nowMs, now.tz)}
        </AppText>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space['1'],
            minHeight: theme.target.min.height,
            paddingHorizontal: theme.space['3'],
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors['bg.raised'],
          }}
          accessible
          accessibilityLabel={gym ? `Gym: ${gym.name}` : 'No gym'}
        >
          <Icon name="building.2" size={16} />
          <AppText variant="label">{gym?.name ?? 'No gym'}</AppText>
        </View>
      </View>

      <BannerList banners={banners} />

      {active ? (
        <Card>
          <StatusLine
            icon={stale ? 'exclamationmark.triangle' : 'arrowtriangle.right.fill'}
            tone={stale ? 'warning' : 'info'}
            text={
              stale
                ? `Unfinished workout · ${formatShortDate(toMs(active.session.startedAt.utc), now.tz)}`
                : `In progress · started ${formatTime(toMs(active.session.startedAt.utc), now.tz)}`
            }
            detail={logged === 0 ? 'Nothing logged' : `${plural(logged, 'set', 'sets')} done`}
          />
          <PrimaryButton
            label="Resume"
            onPress={() => {
              navigation.navigate('Workout');
            }}
          />
        </Card>
      ) : (
        <Card>
          <AppText variant="title2">Nothing planned today</AppText>
          <PrimaryButton
            label="Start empty workout"
            disabled={gym === null}
            busy={starting}
            {...(gym === null ? { accessibilityHint: 'Add a gym first' } : {})}
            onPress={() => {
              if (gym) void start(gym.id);
            }}
          />
          {gym === null ? (
            <AppText variant="callout" color="text.secondary">
              Add a gym first. Workouts are tied to a gym so loads can be checked against its equipment.
            </AppText>
          ) : null}
          <AppText variant="callout" color="text.secondary">
            Routines and plans come in a later build.
          </AppText>
        </Card>
      )}

      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
    </Screen>
  );
}
