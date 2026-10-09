import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { toMs } from '@fizz/domain';

import { describeBackupError, rollbackRowView } from '../../backup/restore-view';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useRelaunch, useScreenData, useServices } from '../../shell/context';
import { formatShortDate, formatWhen } from '../../format/dates';
import { formatCount, plural } from '../../format/numbers';
import { useTheme } from '../../theme';
import { AppText, Card, DomainLabel, Group, Row, Screen, SectionHeader, StatusLine, TextButton } from '../../ui';
import { BlockingCover } from './BlockingCover';
import { SaveCopyToFiles } from './SaveCopyToFiles';

const TONE = { done: 'done', info: 'info', warning: 'warning', progress: 'progress' } as const;

/**
 * Data & backup hub (data-import-export.md §2.1), the parts in this build:
 * the two-line status card, `Save a copy to Files`, `Back up on this phone
 * now`, the copies on this phone, the trial-run line, the quiet 30-day
 * reminder, Restore, Check a backup and Undo last restore. Import, export and
 * delete are listed honestly as not in this build.
 */
export function DataBackupScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const relaunch = useRelaunch();
  const [data] = useScreenData(async (s) => {
    const [status, counts, blocked] = await Promise.all([s.backups.getStatus(), s.yourData.counts(), s.restore.blockedBy()]);
    return { status, counts, blocked, rollback: s.restore.rollbackTarget() };
  });
  const now = services.now();

  async function backUpNow() {
    if (running) return;
    setRunning(true);
    setRunResult(null);
    const r = await services.backups.backUpOnPhone('manual');
    setRunning(false);
    setRunResult(r.ok ? { ok: true, text: `Backed up on this phone · ${formatWhen(toMs(r.record.createdAtUtc), toMs(now.utc), now.tz)}` } : { ok: false, text: `Last backup on this phone didn’t save. ${r.error}` });
    changed();
  }

  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const { status, counts, blocked, rollback } = data.value;
  const undoRow = rollbackRowView(rollback, { nowMs: toMs(now.utc), tz: now.tz });

  function undoRestore() {
    if (!undoRow) return;
    Alert.alert(`${undoRow.title}?`, `${undoRow.subtitle}. Anything logged since then stays only in the data you switch away from, which is kept so you can switch again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: undoRow.title,
        onPress: () => {
          setUndoing(true);
          setUndoError(null);
          // Any throw dismisses the cover with a message (review S3).
          void services.restore
            .undo()
            .catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, error: { code: 'restore_failed' as const, message: e instanceof Error ? e.message : String(e) } }))
            .then((r) => {
              if (r.ok) {
                relaunch();
                return;
              }
              setUndoing(false);
              setUndoError(r.reason === 'workout_unfinished' ? `Finish or discard your workout first (${r.block.title}).` : describeBackupError(r.error));
            });
        },
      },
    ]);
  }
  const on = status.onPhone.line;
  const off = status.offPhone.line;

  return (
    <Screen>
      <Card>
        <StatusLine icon={on.icon} tone={TONE[on.tone]} text={on.text} detail={on.detail} />
        <StatusLine
          icon={off.icon}
          tone={TONE[off.tone]}
          text={off.text}
          detail={off.detail}
          action={
            status.offPhone.state === 'reminder' ? (
              <TextButton
                label="Not now"
                tone="secondary"
                onPress={() =>
                  void services.backups.dismissOffPhoneReminder().then(() => {
                    changed();
                  })
                }
              />
            ) : undefined
          }
        />
        {status.offPhone.state === 'none' ? (
          <AppText variant="callout" color="text.secondary">
            Copies on this phone are lost if Fizz is deleted or re-signed with another Apple ID.
          </AppText>
        ) : null}
        <View style={{ gap: theme.space['1'] }}>
          <DomainLabel domain="yourData" />
          <AppText variant="callout" numeric>
            {`${plural(counts.finishedWorkouts, 'workout', 'workouts')} · ${plural(counts.loggedSets, 'set', 'sets')} · ${plural(counts.gyms, 'gym', 'gyms')}`}
          </AppText>
          <DomainLabel domain="coachingKnowledge" />
          <AppText variant="callout" numeric>
            {counts.exercises === 0 ? 'Exercise list: not in this build yet · gym presets built in' : `${plural(counts.exercises, 'exercise', 'exercises')} · gym presets built in`}
          </AppText>
        </View>
        <SaveCopyToFiles variant="primary" />
        {status.trialRunDoneAtUtc === null ? (
          <View style={{ gap: theme.space['1'] }}>
            <AppText variant="callout" color="text.secondary">
              Before real workouts, do the trial run: log a test workout, save a copy to Files, install the next build over the top, let one weekly refresh lapse and refresh again, then restore that copy here (Restore from a backup › Choose another file…). Steps are in the SideStore guide; Fizz can’t check them for you.
            </AppText>
            <TextButton
              label="Mark as done"
              onPress={() =>
                void services.backups.markTrialRunDone().then(() => {
                  changed();
                })
              }
            />
          </View>
        ) : (
          <AppText variant="callout" color="text.secondary">{`Trial run done · ${formatShortDate(toMs(status.trialRunDoneAtUtc), now.tz)}`}</AppText>
        )}
      </Card>

      {status.manifestProblem ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={status.manifestProblem} /> : null}

      <SectionHeader title="Backups on this phone" />
      <Group>
        <Row title="After each workout" subtitle="On · keeps the last 14" />
        <Row title={running ? 'Backing up…' : 'Back up on this phone now'} icon="iphone" onPress={() => void backUpNow()} disabled={running} />
      </Group>
      {runResult ? <StatusLine icon={runResult.ok ? 'iphone' : 'exclamationmark.triangle'} tone={runResult.ok ? 'done' : 'warning'} text={runResult.text} /> : null}
      <AppText variant="callout" color="text.secondary">
        These are lost if Fizz is deleted or re-signed with another Apple ID.
      </AppText>
      {status.copiesOnPhone.length > 0 ? (
        <Group>
          {status.copiesOnPhone.map((f) => (
            <Row
              key={f.fileName}
              title={formatWhen(toMs(f.createdAtUtc), toMs(now.utc), now.tz)}
              subtitle={`${f.kind === 'automatic' ? 'Automatic' : 'Made by you'} · ${plural(f.finishedWorkouts, 'workout', 'workouts')}${f.integrityOk ? '' : ' · can’t be restored (damaged records)'}`}
              secondLine={`${formatCount(Math.ceil(f.textLength / 1024))} KB`}
            />
          ))}
        </Group>
      ) : null}

      <SectionHeader title="Restore" />
      <Group>
        <Row
          title="Restore from a backup"
          icon="arrow.counterclockwise"
          subtitle={blocked ? `Finish or discard your workout first (${blocked.title})` : 'From this phone or Files. You can undo it.'}
          disabled={blocked !== null}
          onPress={() => {
            navigation.navigate('Restore', { mode: 'restore' });
          }}
        />
        <Row
          title="Check a backup"
          icon="checkmark.shield"
          subtitle="Rebuilds it in a test copy. Changes nothing."
          onPress={() => {
            navigation.navigate('Restore', { mode: 'check' });
          }}
        />
        {undoRow ? <Row title={undoRow.title} subtitle={undoRow.subtitle} disabled={blocked !== null || undoing} onPress={undoRestore} /> : null}
      </Group>
      {undoError ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={undoError} /> : null}
      <BlockingCover visible={undoing} title="Switching back…" lines={[{ text: undoRow?.subtitle ?? 'Switching databases', done: false }]} />

      <SectionHeader title="Import and export" />
      <Group>
        <Row title="Import from FitNotes" subtitle="Not in this build yet" disabled />
        <Row title="Export" subtitle="Not in this build yet" disabled />
      </Group>
    </Screen>
  );
}
