import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Share, View } from 'react-native';

import { latestVersion, MIGRATIONS } from '@fizz/persistence';
import { toMs } from '@fizz/domain';

import { clearLastError, readLastError } from '../../diagnostics/crash-capture';
import { errorOutcome, errorStatusDetail, formatErrorReport } from '../../diagnostics/error-record';
import { useDataChanged, useLaunchInfo, useScreenData, useServices } from '../../shell/context';
import { useInstallStatus } from '../../shell/useInstallStatus';
import { formatWhen } from '../../format/dates';
import { plural } from '../../format/numbers';
import type { ProfileStackParams } from '../../navigation/types';
import { capabilityGroups, type CapabilityLabel } from '../../status/capabilities';
import { signingStatus } from '../../status/signing';
import { useTheme } from '../../theme';
import { DomainLabel, Group, Row, Screen, SectionHeader, StatusLine, TextButton, type SymbolName, type Tone } from '../../ui';
import { useProbeResults } from './useProbeResults';

const CAPABILITY_STYLE: Record<CapabilityLabel, { icon: SymbolName; tone: Tone }> = {
  Working: { icon: 'checkmark.circle.fill', tone: 'done' },
  'Not working': { icon: 'exclamationmark.triangle', tone: 'warning' },
  'Not tested': { icon: 'questionmark.circle', tone: 'info' },
  'Not available': { icon: 'minus.circle', tone: 'info' },
  'Not in this build': { icon: 'minus.circle', tone: 'info' },
};

/**
 * App status (system-states.md §2.4): every current state in one place, with
 * evidence. `Working` only with a dated check. No primary button.
 */
export function AppStatusScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const services = useServices();
  const changed = useDataChanged();
  const launch = useLaunchInfo();
  const install = useInstallStatus();
  const probe = useProbeResults();
  const [checking, setChecking] = useState(false);
  // The last JS error crash capture recorded (diagnostics/crash-capture.ts), re-read whenever the screen shows.
  const [lastError, setLastError] = useState(readLastError);
  useFocusEffect(
    useCallback(() => {
      setLastError(readLastError());
    }, []),
  );
  const [data] = useScreenData(async (s) => {
    const [backup, counts] = await Promise.all([s.backups.getStatus(), s.yourData.counts()]);
    return { backup, counts, integrity: s.integrity.last() };
  });
  const now = services.now();
  const nowMs = toMs(now.utc);
  const signing = signingStatus(install?.profileExpiresUtc ?? null, nowMs, now.tz);

  async function checkAll() {
    if (checking) return;
    setChecking(true);
    await services.integrity.checkAll().catch(() => null);
    setChecking(false);
    changed();
  }

  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const { backup, counts, integrity } = data.value;
  const toDataBackup = () => {
    navigation.navigate('DataBackup');
  };

  return (
    <Screen>
      <DomainLabel domain="yourData" />
      <View style={{ gap: theme.space['2'] }}>
        <StatusLine
          icon="checkmark.circle.fill"
          tone="done"
          text="Saved on this phone"
          detail={`${plural(counts.finishedWorkouts, 'workout', 'workouts')} · ${plural(counts.loggedSets, 'set', 'sets')}`}
        />
        <StatusLine icon={backup.onPhone.line.icon} tone={backup.onPhone.line.tone} text={backup.onPhone.line.text} detail={backup.onPhone.line.detail} action={<TextButton label="Open" onPress={toDataBackup} />} />
        <StatusLine icon={backup.offPhone.line.icon} tone={backup.offPhone.line.tone} text={backup.offPhone.line.text} detail={backup.offPhone.line.detail} />
        {integrity === null ? (
          <StatusLine icon="ellipsis" tone="progress" text="Checking every record…" action={<TextButton label="Check" onPress={() => void checkAll()} disabled={checking} />} />
        ) : (
          <StatusLine
            icon={integrity.report.ok ? 'checkmark.circle.fill' : 'exclamationmark.triangle'}
            tone={integrity.report.ok ? 'done' : 'warning'}
            text={integrity.report.ok ? 'Last full check: no problems' : `Last full check: ${plural(integrity.report.issues.length, 'damaged record', 'damaged records')}`}
            detail={formatWhen(toMs(integrity.atUtc), nowMs, now.tz)}
            action={<TextButton label={checking ? 'Checking…' : 'Check'} onPress={() => void checkAll()} disabled={checking} />}
          />
        )}
      </View>

      <DomainLabel domain="coachingKnowledge" />
      <View style={{ gap: theme.space['2'] }}>
        <StatusLine
          icon={counts.exercises === 0 ? 'minus.circle' : 'checkmark.circle.fill'}
          tone={counts.exercises === 0 ? 'info' : 'done'}
          text={counts.exercises === 0 ? 'Exercise list: not in this build yet' : `Exercise list: ${plural(counts.exercises, 'exercise', 'exercises')}`}
        />
        <StatusLine icon="checkmark.circle.fill" tone="done" text={`Gym presets: ${String(services.coachingKnowledge.gymPresets().length)} built in`} />
        <StatusLine icon="minus.circle" tone="info" text="Playbook rules: not in this build yet" />
      </View>

      <SectionHeader title="This install" />
      <View style={{ gap: theme.space['2'] }}>
        <StatusLine
          icon={signing.state === 'ok' ? 'checkmark.circle.fill' : signing.state === 'unknown' ? 'minus.circle' : 'exclamationmark.triangle'}
          tone={signing.state === 'ok' ? 'done' : signing.state === 'unknown' ? 'info' : 'warning'}
          text={signing.line}
          detail={[signing.detail, install?.expiryNote].filter(Boolean).join(' ')}
        />
        {install ? (
          <StatusLine
            icon="checkmark.circle.fill"
            tone="done"
            text={`GymSmarter ${install.appVersion} · build ${install.buildNumber}`}
            detail={`App ID ${install.installedBundleId}${install.installedBundleId === install.configuredBundleId ? '' : ` (configured ${install.configuredBundleId})`}`}
          />
        ) : null}
        <StatusLine
          icon="checkmark.circle.fill"
          tone="done"
          text={`Database version ${String(launch.migration.to)} of ${String(latestVersion(MIGRATIONS))}`}
          detail={`SQLite ${launch.sqliteVersion}${launch.migration.applied.length > 0 ? ` · updated this launch from version ${String(launch.migration.from)}` : ''}`}
        />
      </View>

      <SectionHeader title="Last error" />
      <View style={{ gap: theme.space['2'] }}>
        {lastError === null ? (
          <StatusLine icon="checkmark.circle.fill" tone="done" text="No error recorded" infoLabel="About errors" info="Errors the app catches are recorded here. If the app closed and nothing is here, it was a native or animation-thread crash: try Profile › Developer › Exercise guide animations off." />
        ) : (
          <>
            <StatusLine
              icon="exclamationmark.triangle"
              tone="warning"
              text={`${errorOutcome(lastError)} · ${formatWhen(toMs(lastError.atUtc), nowMs, now.tz)}`}
              detail={errorStatusDetail(lastError)}
              action={
                <TextButton
                  label="Copy or share"
                  onPress={() => {
                    void Share.share({ message: formatErrorReport(lastError) }).catch(() => undefined);
                  }}
                />
              }
            />
            <TextButton
              label="Clear last error"
              tone="secondary"
              onPress={() => {
                clearLastError();
                setLastError(readLastError());
              }}
            />
          </>
        )}
      </View>

      {capabilityGroups(probe.results, now.tz).map((group) => (
        <View key={group.title} style={{ gap: theme.space['2'] }}>
          <SectionHeader title={group.title} />
          {group.rows.map((row) => (
            <StatusLine key={row.id} icon={CAPABILITY_STYLE[row.label].icon} tone={CAPABILITY_STYLE[row.label].tone} text={`${row.title}: ${row.label}`} detail={row.detail} />
          ))}
        </View>
      ))}

      <Group>
        <Row
          title="Run phone checks"
          icon="stethoscope"
          subtitle="Capability probe"
          onPress={() => {
            navigation.navigate('CapabilityProbe');
          }}
        />
      </Group>
    </Screen>
  );
}
