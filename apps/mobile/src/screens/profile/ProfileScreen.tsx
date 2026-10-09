import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';

import { toMs } from '@fizz/domain';

import { useScreenData, useServices } from '../../shell/context';
import { loadBanners } from '../../shell/system-banners';
import { useInstallStatus } from '../../shell/useInstallStatus';
import type { ProfileStackParams } from '../../navigation/types';
import { capabilityGroups, summariseCapabilities } from '../../status/capabilities';
import { signingStatus } from '../../status/signing';
import { Group, Row, Screen, SectionHeader } from '../../ui';
import { BannerList } from '../BannerList';
import { useProbeResults } from './useProbeResults';

/**
 * Profile hub skeleton (profile-and-settings.md §2.1). No primary button;
 * attention banners come from `buildSystemStatus`. Only the rows whose
 * screens exist in this build are shown.
 */
export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const services = useServices();
  const install = useInstallStatus();
  const probe = useProbeResults();
  const [data, reload] = useScreenData(async (s) => {
    const [backup, banners, pain] = await Promise.all([s.backups.getStatus(), loadBanners(s, install), s.pain.active()]);
    return { backup, banners, pain };
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

      <SectionHeader title="Training" />
      <Group>
        <Row
          title="Pain flags"
          icon="exclamationmark.triangle"
          subtitle={data.state === 'ready' ? (data.value.pain.length === 0 ? 'None' : `${String(data.value.pain.length)} active: ${data.value.pain.map((f) => f.exerciseName).join(', ')}`) : null}
          onPress={() => {
            navigation.navigate('PainFlags');
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
