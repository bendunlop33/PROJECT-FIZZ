import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { Switch } from 'react-native';

import { toMs } from '@fizz/domain';
import { readTextCoachState } from '@fizz/providers';

import { coachConnectionPorts } from '../../ai/coach-connection-ports';
import { profileCoachLine } from '../../ai/coach-connection-view';

import { useScreenData, useServices } from '../../shell/context';
import { loadBanners } from '../../shell/system-banners';
import { useInstallStatus } from '../../shell/useInstallStatus';
import type { ProfileStackParams } from '../../navigation/types';
import { capabilityGroups, summariseCapabilities } from '../../status/capabilities';
import { signingStatus } from '../../status/signing';
import { Group, Row, Screen, SectionHeader } from '../../ui';
import { BannerList } from '../BannerList';
import { profileSplitRow, trainingDetailsView } from '../../training/training-view';
import { openYourPlan } from '../../navigation/actions';
import { newUuid } from '../../device/runtime';
import { useProbeResults } from './useProbeResults';
import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { voiceCapability } from '../../voice/speaker';
import { voiceRowLine } from '../../voice/settings';
import { MorningReminderRow } from './MorningReminderRow';

/** (Rule 10) Profile's two data groups, with Data & backup's names. */
export const PROFILE_SECTIONS = { yourData: 'Your data', knowledge: 'Coaching knowledge' } as const;

/**
 * Profile hub skeleton (profile-and-settings.md §2.1). No primary button;
 * attention banners come from `buildSystemStatus`. Only the rows whose
 * screens exist in this build are shown.
 */
export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const rootNavigation = useNavigation();
  const services = useServices();
  const install = useInstallStatus();
  const probe = useProbeResults();
  const { prefs, update } = useDevicePrefs();
  const [data, reload] = useScreenData(async (s) => {
    const [backup, banners, pain, gyms, coach, training, planInUse] = await Promise.all([
      s.backups.getStatus(),
      loadBanners(s, install),
      s.pain.active(),
      s.gyms.list(),
      // Keychain + settings file only; no network. A read failure shows as unknown, never as connected.
      readTextCoachState(coachConnectionPorts().ports).catch(() => null),
      Promise.all([s.training.snapshot(), s.yourData.profile()]).catch(() => [null, null] as const),
      // (D7) A plan in use owns the split; a failed read is unknown (no line), never taken for no plan.
      s.plans.inUse().then((x) => x !== null, () => null),
    ]);
    const [snap, owner] = training;
    const split = snap === null || planInUse === null ? null : profileSplitRow(snap.profile, snap.mainLifts, planInUse);
    const lines = snap === null ? null : { details: trainingDetailsView(snap.profile, { nowYear: snap.nowYear, unit: owner?.preferredUnit ?? 'kg' }).summary, split };
    return { backup, banners, pain, gyms, coach, training: lines };
  });
  useEffect(() => {
    reload();
  }, [install, reload]);

  const now = services.now();
  const signing = signingStatus(install?.profileExpiresUtc ?? null, toMs(now.utc), now.tz);
  const capabilities = summariseCapabilities(capabilityGroups(probe.results, now.tz));

  return (
    <Screen>
      {data.state === 'ready' ? <BannerList banners={data.value.banners} /> : null}

      <SectionHeader title="Data" />
      <Group>
        <Row
          title="Data & backup"
          icon="externaldrive"
          subtitle={data.state === 'ready' ? data.value.backup.onPhone.line.text : null}
          secondLine={data.state === 'ready' ? data.value.backup.offPhone.line.text : null}
          onPress={() => {
            navigation.navigate('DataBackup');
          }}
        />
      </Group>

      <SectionHeader title="Gyms" />
      <Group>
        {(data.state === 'ready' ? data.value.gyms : []).map((g) => (
          <Row
            key={g.gym.id}
            title={g.gym.name}
            icon="building.2"
            subtitle={`${g.gym.isDefault ? 'Default · ' : ''}${String(g.items)} ${g.items === 1 ? 'item' : 'items'}${g.unchecked > 0 ? ` · ${String(g.unchecked)} assumed` : ''}`}
            onPress={() => {
              navigation.navigate('GymDetail', { gymId: g.gym.id });
            }}
          />
        ))}
        <Row
          title="Add gym"
          icon="plus"
          onPress={() => {
            rootNavigation.navigate('AddGym');
          }}
        />
      </Group>

      <SectionHeader title="Training" />
      <Group>
        <Row
          title="Training details"
          icon="person.text.rectangle"
          subtitle={data.state === 'ready' ? (data.value.training?.details ?? null) : null}
          onPress={() => {
            navigation.navigate('TrainingDetails');
          }}
        />
        <Row
          title="Split"
          icon="calendar"
          subtitle={data.state === 'ready' ? (data.value.training?.split?.subtitle ?? null) : null}
          onPress={() => {
            // (D7) With a plan in use the split is the plan's: Library › Your plan.
            if (data.state === 'ready' && data.value.training?.split?.opens === 'your_plan') rootNavigation.dispatch(openYourPlan(newUuid()));
            else navigation.navigate('Split');
          }}
        />
        {/* Ben, 20 Oct: `Targets hit 5 of last 6` on main lifts only, when on (this phone; default off). */}
        <Row
          title="Targets hit"
          icon="target"
          subtitle="Main lifts"
          trailing={
            <Switch
              accessibilityLabel="Targets hit"
              value={prefs.targetsHit}
              onValueChange={(on) => {
                update({ targetsHit: on });
              }}
            />
          }
        />
      </Group>

      {/* (Rule 10; Ben, 26 Oct; app review finding 13) Your data (personal) and Coaching knowledge (general) are separate groups, named as in Data & backup. */}
      <SectionHeader title={PROFILE_SECTIONS.yourData} />
      <Group>
        <Row
          title="Memory"
          icon="brain"
          onPress={() => {
            navigation.navigate('Memory');
          }}
        />
        <Row
          title="Pain flags"
          icon="exclamationmark.triangle"
          subtitle={data.state === 'ready' ? (data.value.pain.length === 0 ? 'None' : `${String(data.value.pain.length)} active: ${data.value.pain.map((f) => f.exerciseName).join(', ')}`) : null}
          onPress={() => {
            navigation.navigate('PainFlags');
          }}
        />
      </Group>

      <SectionHeader title={PROFILE_SECTIONS.knowledge} />
      <Group>
        <Row
          title="Playbook"
          icon="books.vertical"
          onPress={() => {
            navigation.navigate('Playbook');
          }}
        />
      </Group>

      <SectionHeader title="Coach" />
      <Group>
        <Row
          title="Coach connection"
          icon="bubble.left.and.text.bubble.right"
          subtitle={data.state === 'ready' ? (data.value.coach === null ? 'Couldn’t read the connection' : profileCoachLine(data.value.coach)) : null}
          onPress={() => {
            navigation.navigate('CoachConnection');
          }}
        />
      </Group>

      <SectionHeader title="Voice" />
      <Group>
        <Row
          title="Voice"
          icon="speaker.wave.2"
          subtitle={voiceRowLine(prefs.voice, voiceCapability().speech)}
          onPress={() => {
            navigation.navigate('Voice');
          }}
        />
        <MorningReminderRow
          onPress={() => {
            navigation.navigate('MorningReminder');
          }}
        />
      </Group>

      <SectionHeader title="App" />
      <Group>
        <Row
          title="App status"
          icon="checkmark.shield"
          subtitle={capabilities}
          secondLine={install ? `${install.appVersion} (${install.buildNumber}) · ${signing.state === 'unknown' ? 'signing date unknown' : signing.line.replace('Signed until', 'signed until')}` : null}
          onPress={() => {
            navigation.navigate('AppStatus');
          }}
        />
      </Group>

      <SectionHeader title="Developer" />
      <Group>
        <Row
          title="Developer"
          icon="hammer"
          subtitle="Capability probe, look"
          onPress={() => {
            navigation.navigate('Developer');
          }}
        />
      </Group>
    </Screen>
  );
}
