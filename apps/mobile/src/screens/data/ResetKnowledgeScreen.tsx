import { useState } from 'react';
import { Alert, View } from 'react-native';

import { RESET_ALERT, resetListView, resetResultView } from '../../backup/data-domain-view';
import { useRelaunch, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, DangerTextButton, DomainLabel, Screen, StatusLine } from '../../ui';
import { BlockingCover } from './BlockingCover';
import { SaveCopyToFiles } from './SaveCopyToFiles';

/**
 * `Reset coaching knowledge` (data-import-export §2.7, §3.6, §4.5): what
 * changes, what doesn't, `Save a copy to Files first`, then the danger
 * button and a system alert. The service backs up on this phone first and
 * never touches Your data or the coach sign-in.
 */
export function ResetKnowledgeScreen() {
  const theme = useTheme();
  const services = useServices();
  const relaunch = useRelaunch();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [data, reload] = useScreenData((s) => s.data.summary());
  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const summary = data.value;
  const list = resetListView(summary);

  function confirm() {
    const opId = services.newId();
    Alert.alert(RESET_ALERT.title, RESET_ALERT.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: RESET_ALERT.confirm,
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          setLine(null);
          void services.data
            .resetCoachingKnowledge({ opId, stamp: summary.stamp })
            .catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, message: e instanceof Error ? e.message : String(e) }))
            .then((r) => {
              const view = resetResultView(r);
              setBusy(false);
              if (view.relaunch) {
                Alert.alert(view.line, undefined, [{ text: 'OK', onPress: relaunch }]);
                return;
              }
              setLine(view.line);
              reload();
            });
        },
      },
    ]);
  }

  return (
    <Screen>
      <DomainLabel domain="coachingKnowledge" />
      <View style={{ gap: theme.space['1'] }}>
        {list.changed.map((t) => (
          <AppText key={t} variant="body">{`• ${t}`}</AppText>
        ))}
      </View>
      <DomainLabel domain="yourData" />
      <AppText variant="body">{`Not changed: ${list.unchanged}`}</AppText>
      <SaveCopyToFiles variant="secondary" label="Save a copy to Files first" />
      {line ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={line} /> : null}
      <View style={{ marginTop: theme.space['8'] }}>
        <DangerTextButton label="Reset coaching knowledge" onPress={confirm} disabled={busy} />
      </View>
      <BlockingCover visible={busy} title="Resetting coaching knowledge…" lines={[{ text: 'Your data isn’t touched', done: true }]} />
    </Screen>
  );
}
