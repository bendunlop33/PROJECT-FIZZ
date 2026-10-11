import { useState } from 'react';
import { Alert, View } from 'react-native';

import { resetAlertView, resetListView, resetResultView } from '../../backup/data-domain-view';
import { describeBackupError } from '../../backup/restore-view';
import { useRelaunch, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, DangerTextButton, DomainLabel, Screen, StatusLine } from '../../ui';
import { BlockingCover } from './BlockingCover';
import { SaveCopyToFiles } from './SaveCopyToFiles';

/**
 * `Reset coaching knowledge` (data-import-export §2.7, §3.6, §4.5): what
 * changes, what doesn't, `Save a copy to Files first`, then the danger
 * button and a system alert. The service backs up on this phone first and
 * never touches Your data or the coach sign-in. Unavailable while a workout
 * is unfinished (DX4, review r2 S3). Done offers Undo (one
 * rollback generation, §3.6, knowledge only); Data & backup keeps
 * `Undo last reset`. When the copy kept for Undo holds data that isn't on
 * this phone, the alert names it (review r5 B1).
 */
export function ResetKnowledgeScreen() {
  const theme = useTheme();
  const services = useServices();
  const relaunch = useRelaunch();
  const [busy, setBusy] = useState(false);
  const [line, setLineState] = useState<string | null>(null);
  const [lineTone, setLineTone] = useState<'done' | 'warning'>('warning');
  const [data, reload] = useScreenData(async (s) => {
    const [summary, blocked] = await Promise.all([s.data.summary(), s.restore.blockedBy()]);
    return { summary, blocked };
  });
  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const { summary, blocked } = data.value;
  const list = resetListView(summary);

  function undo() {
    setBusy(true);
    void services.restore
      .undo()
      .catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, error: { code: 'restore_failed' as const, message: e instanceof Error ? e.message : String(e) } }))
      .then((r) => {
        if (r.ok) {
          relaunch();
          return;
        }
        // The reset stands; Data & backup still offers Undo last reset.
        setBusy(false);
        Alert.alert('Couldn’t undo the reset', r.reason === 'workout_unfinished' ? `Finish or discard your workout first (${r.block.title}).` : describeBackupError(r.error), [{ text: 'OK', onPress: relaunch }]);
      });
  }

  function confirm() {
    const opId = services.newId();
    const now = services.now();
    const alert = resetAlertView(summary, { tz: now.tz });
    Alert.alert(alert.title, alert.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: alert.confirm,
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          setLineState(null);
          void services.data
            .resetCoachingKnowledge({ opId, stamp: summary.stamp })
            .catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, message: e instanceof Error ? e.message : String(e) }))
            .then((r) => {
              const view = resetResultView(r);
              setBusy(false);
              if (view.relaunch) {
                Alert.alert(view.line ?? '', undefined, [
                  ...(view.undo ? [{ text: 'Undo', onPress: undo }] : []),
                  { text: 'OK', onPress: relaunch },
                ]);
                return;
              }
              setLineState(view.line);
              setLineTone(view.tone);
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
      {blocked && !line ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={`Finish or discard your workout first (${blocked.title})`} /> : null}
      {line ? <StatusLine icon={lineTone === 'done' ? 'checkmark.circle.fill' : 'exclamationmark.triangle'} tone={lineTone} text={line} /> : null}
      <View style={{ marginTop: theme.space['8'] }}>
        <DangerTextButton label="Reset coaching knowledge" onPress={confirm} disabled={busy || blocked !== null} />
      </View>
      <BlockingCover visible={busy} title="Resetting coaching knowledge…" lines={[{ text: 'Your data isn’t touched', done: true }]} />
    </Screen>
  );
}
