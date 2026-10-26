import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { HEALTH_COPY, type HealthSwitch, type HealthSwitchRow } from '../../health/health-view';
import { useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { DangerTextButton, Group, InfoLine, Row, Screen, SectionHeader, StatusLine, TextButton, Toast } from '../../ui';

/**
 * Profile › Apple Health (Ben, 27 Oct; apple-health.md §2.1, §4). Each switch is Ben's; turning one on asks iOS
 * for that type only. With no HealthKit on this install (SideStore can strip it) only `Not available on this
 * install` shows, with its `Why?`. Values and actions only.
 */
export function AppleHealthScreen() {
  const theme = useTheme();
  const services = useServices();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, reload] = useScreenData((s) => s.health.screen(true));

  if (data.state !== 'ready') {
    return <Screen>{data.state === 'error' ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read Apple Health settings." action={<TextButton label="Try again" onPress={reload} />} /> : null}</Screen>;
  }
  const v = data.value;

  async function toggle(key: HealthSwitch, on: boolean) {
    setBusy(true);
    const r = await services.health.setSwitch(key, on);
    setBusy(false);
    if (!r.ok) setNotice(r.message);
    reload();
  }

  const switchRow = (r: HealthSwitchRow) => (
    <Row
      key={r.key}
      title={r.title}
      subtitle={r.detail}
      trailing={<Switch accessibilityLabel={r.title} value={r.on} disabled={busy} onValueChange={(on) => void toggle(r.key, on)} />}
      below={
        r.why !== null || r.retry ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
            {r.why !== null ? <InfoLine info={r.why} variant="callout" infoLabel="Why?" /> : null}
            {r.retry ? (
              <TextButton
                label={HEALTH_COPY.tryAgain}
                onPress={() => {
                  void services.health.syncWrites().then(reload);
                }}
              />
            ) : null}
          </View>
        ) : null
      }
    />
  );

  const remove = () => {
    Alert.alert(HEALTH_COPY.remove, undefined, [
      { text: HEALTH_COPY.cancel, style: 'cancel' },
      {
        text: HEALTH_COPY.remove_,
        style: 'destructive',
        onPress: () => {
          void services.health.removeAllOwn().then((r) => {
            setNotice(r.ok ? HEALTH_COPY.removed : r.message);
            reload();
          });
        },
      },
    ]);
  };

  return (
    <Screen>
      {notice !== null ? (
        <Toast
          text={notice}
          onDismiss={() => {
            setNotice(null);
          }}
        />
      ) : null}
      <Group>
        <Row title={HEALTH_COPY.title} icon="heart.fill" subtitle={v.line} below={v.why !== null ? <InfoLine info={v.why} variant="callout" infoLabel="Why?" /> : null} />
      </Group>
      {v.available ? (
        <>
          <SectionHeader title={HEALTH_COPY.saveTo} />
          <Group>{v.save.map(switchRow)}</Group>
          <SectionHeader title={HEALTH_COPY.readFrom} />
          <Group>{v.read.map(switchRow)}</Group>
          {v.sources.length > 0 ? (
            <>
              <SectionHeader title={HEALTH_COPY.sources} />
              <Group>
                {v.sources.map((s) => (
                  <Row key={s.name} title={s.name} subtitle={s.line} />
                ))}
              </Group>
            </>
          ) : null}
          {v.lastRead !== null || v.canReadNow ? (
            <Group>
              <Row
                title={v.lastRead ?? HEALTH_COPY.readNow}
                trailing={
                  v.canReadNow ? (
                    <TextButton
                      label={HEALTH_COPY.readNow}
                      onPress={() => {
                        void services.health.readNow().then(reload);
                        reload();
                      }}
                    />
                  ) : null
                }
              />
            </Group>
          ) : null}
          {v.canRemove ? (
            <View style={{ paddingHorizontal: theme.space['4'], paddingTop: theme.space['3'] }}>
              <DangerTextButton label={HEALTH_COPY.remove} onPress={remove} />
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
