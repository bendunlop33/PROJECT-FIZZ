import { useState } from 'react';
import { Alert, View } from 'react-native';

import { DELETE_ALERT, deleteListView, deleteResultView, offPhoneLine } from '../../backup/data-domain-view';
import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { DEFAULT_PREFS } from '../../device/prefs';
import { useRelaunch, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, DangerTextButton, DomainLabel, Screen, StatusLine } from '../../ui';
import { BlockingCover } from './BlockingCover';
import { SaveCopyToFiles } from './SaveCopyToFiles';

/**
 * `Delete my data (keep coaching knowledge)` (data-import-export §2.7, §3.6,
 * §4.5): what goes and what stays, `Save a copy to Files first`
 * (secondary), then the danger button and a system alert (two steps). The
 * service backs up on this phone first, then deletes in one switch; the app
 * relaunches into first run. The op ID is minted per confirmation, so a
 * double tap deletes once.
 */
export function DeleteMyDataScreen() {
  const theme = useTheme();
  const services = useServices();
  const relaunch = useRelaunch();
  const prefs = useDevicePrefs();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ text: string; tone: 'done' | 'warning' } | null>(null);
  const [data, reload] = useScreenData((s) => s.data.summary());
  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const summary = data.value;
  const now = services.now();
  const off = offPhoneLine(summary, { tz: now.tz });
  const list = deleteListView(summary);

  function confirm() {
    const opId = services.newId();
    Alert.alert(DELETE_ALERT.title, DELETE_ALERT.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: DELETE_ALERT.confirm,
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          setLine(null);
          void services.data
            .deleteMyData({ opId, stamp: summary.stamp })
            .catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, message: e instanceof Error ? e.message : String(e), pending: false }))
            .then((r) => {
              const view = deleteResultView(r);
              if (!view.relaunch) {
                setBusy(false);
                if (view.line) setLine({ text: view.line, tone: view.tone });
                reload();
                return;
              }
              // This phone's look and alert answers are Your data too.
              if (r.ok) prefs.update(DEFAULT_PREFS);
              if (view.line) Alert.alert(view.line, undefined, [{ text: 'OK', onPress: relaunch }]);
              else relaunch();
            });
        },
      },
    ]);
  }

  const save = <SaveCopyToFiles variant="secondary" label="Save a copy to Files first" onSaved={reload} />;
  return (
    <Screen>
      <DomainLabel domain="yourData" />
      <View style={{ gap: theme.space['1'] }}>
        {list.removed.map((t) => (
          <AppText key={t} variant="body">{`• ${t}`}</AppText>
        ))}
      </View>
      <DomainLabel domain="coachingKnowledge" />
      <AppText variant="body">{`Kept: ${list.kept}`}</AppText>
      <View style={{ gap: theme.space['2'] }}>
        {off.saveFirst ? save : null}
        <AppText variant="callout" color="text.secondary">
          {off.text}
        </AppText>
        {off.saveFirst ? null : save}
      </View>
      {line ? <StatusLine icon={line.tone === 'done' ? 'checkmark.circle.fill' : 'exclamationmark.triangle'} tone={line.tone} text={line.text} /> : null}
      <View style={{ marginTop: theme.space['8'] }}>
        <DangerTextButton label="Delete my data" onPress={confirm} disabled={busy} />
      </View>
      <BlockingCover visible={busy} title="Deleting your data…" lines={[{ text: 'Coaching knowledge kept', done: true }]} />
    </Screen>
  );
}
