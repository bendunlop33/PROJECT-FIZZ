import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActionSheetIOS, Alert, View } from 'react-native';

import { toMs } from '@fizz/domain';

import { deleteLeftoverView, finishLeftoverView } from '../../backup/data-domain-view';
import { describeBackupError, rollbackConfirmMessage, rollbackRowView } from '../../backup/restore-view';
import { useDevicePrefs } from '../../device/DevicePrefsContext';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useRelaunch, useScreenData, useServices } from '../../shell/context';
import { backupKeepView, KEEP_SAVE_FAILED } from '../../backup/status';
import { formatShortDate, formatWhen } from '../../format/dates';
import { formatCount, plural } from '../../format/numbers';
import { pausedLine } from '../../import/views';
import { useTheme } from '../../theme';
import { AppText, Card, DangerTextButton, DomainLabel, Group, Row, Screen, SectionHeader, StatusLine, TextButton } from '../../ui';
import { BlockingCover } from './BlockingCover';
import { SaveCopyToFiles } from './SaveCopyToFiles';

const TONE = { done: 'done', info: 'info', warning: 'warning', progress: 'progress' } as const;

/**
 * Data & backup hub (data-import-export.md §2.1), the parts in this build:
 * the two-line status card, `Save a copy to Files`, `Back up on this phone
 * now`, the copies on this phone, the trial-run line, the quiet 30-day
 * reminder, Restore, Check a backup and Undo last restore, FitNotes import
 * and Past imports, Export, and Delete my data / Reset coaching knowledge
 * (two danger buttons, each opening its own screen). After `Continue` on an
 * unfinished delete: one warning line with `Finish deleting` (review r2 S2).
 */
export function DataBackupScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [keepFailed, setKeepFailed] = useState(false);
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const relaunch = useRelaunch();
  const prefs = useDevicePrefs();
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [data] = useScreenData(async (s) => {
    const [status, counts, blocked, undoBlocked, imports, leftover] = await Promise.all([
      s.backups.getStatus(),
      s.yourData.counts(),
      s.restore.blockedBy(),
      s.restore.undoBlockedBy(),
      s.imports.list(),
      s.data.leftover(),
    ]);
    return { status, counts, blocked, undoBlocked, imports, leftover, rollback: s.restore.rollbackTarget() };
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
  const { status, counts, blocked, undoBlocked, imports, leftover, rollback } = data.value;
  const leftoverView = leftover ? deleteLeftoverView(leftover) : null;

  function finishDeleting() {
    if (!leftoverView) return;
    Alert.alert(`${leftoverView.action}?`, leftoverView.confirmMessage, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: leftoverView.action,
        style: 'destructive',
        onPress: () => {
          setFinishing(true);
          setFinishError(null);
          void services.data
            .finishLeftover()
            .catch((e: unknown) => ({ ok: false as const, step: leftover?.step ?? ('database' as const), message: e instanceof Error ? e.message : String(e) }))
            .then((r) => {
              const view = finishLeftoverView(r);
              if (view.relaunch) {
                // Settings files may be gone: never write this phone's prefs back (as Delete).
                prefs.clear();
                relaunch();
                return;
              }
              setFinishing(false);
              setFinishError(view.line);
              changed();
            });
        },
      },
    ]);
  }
  const pausedImport = imports.find((p) => p.state === 'paused') ?? null;
  const undoRow = rollbackRowView(rollback, { nowMs: toMs(now.utc), tz: now.tz });

  function undoRestore() {
    if (!undoRow || rollback.last === null) return;
    Alert.alert(`${undoRow.title}?`, rollbackConfirmMessage(undoRow, rollback.last.reason), [
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
  const keepView = backupKeepView(status.keep);

  /** `Keep 7 / 14 / 30 / All copies` (DX9): an action sheet; applies at the next backup. */
  function chooseKeep() {
    const options = [...keepView.choices.map((c) => (c.keep === null ? 'Keep all copies' : `Keep ${c.label} copies`)), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1 }, (i) => {
      const choice = keepView.choices[i];
      if (!choice || choice.selected) return;
      setKeepFailed(false);
      void services.backups
        .setKeep(choice.keep)
        .catch(() => false)
        .then((ok) => {
          if (!ok) setKeepFailed(true);
          changed();
        });
    });
  }

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
              Before real workouts, do the trial run: log a test workout, save a copy to Files, install the next build over the top, let one weekly refresh lapse and refresh again, then restore that copy here (Restore from a backup › Choose another file…). Steps are in the SideStore guide; GymSmarter can’t check them for you.
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
      {leftoverView ? (
        <StatusLine
          icon="exclamationmark.triangle"
          tone="warning"
          text={finishError ?? leftoverView.line}
          action={<TextButton label={leftoverView.action} onPress={finishDeleting} disabled={finishing} />}
        />
      ) : null}
      <BlockingCover visible={finishing} title="Deleting…" lines={[{ text: 'Coaching knowledge kept', done: true }]} />

      <SectionHeader title="Backups on this phone" />
      <Group>
        <Row title="After each workout" subtitle={keepView.subtitle} onPress={chooseKeep} />
        <Row title={running ? 'Backing up…' : 'Back up on this phone now'} icon="iphone" onPress={() => void backUpNow()} disabled={running} />
      </Group>
      {keepFailed ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={KEEP_SAVE_FAILED} /> : null}
      {/* Ben, 11 Oct: copies are what's kept or replaced, never workouts. */}
      <AppText variant="callout" color="text.secondary">
        {keepView.line}
      </AppText>
      {/* D3, shown once and always (review S3): phone backups made after a Files copy are still at risk. */}
      <AppText variant="callout" color="text.secondary">
        Lost if the app is deleted or signed with another Apple ID. Save a copy to Files.
      </AppText>
      {runResult ? <StatusLine icon={runResult.ok ? 'iphone' : 'exclamationmark.triangle'} tone={runResult.ok ? 'done' : 'warning'} text={runResult.text} /> : null}
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
          subtitle={blocked ? `Finish or discard your workout first (${blocked.title})` : 'Phone or Files'}
          disabled={blocked !== null}
          onPress={() => {
            navigation.navigate('Restore', { mode: 'restore' });
          }}
        />
        <Row
          title="Check a backup"
          icon="checkmark.shield"
          onPress={() => {
            navigation.navigate('Restore', { mode: 'check' });
          }}
        />
        {undoRow ? (
          <Row
            title={undoRow.title}
            subtitle={undoBlocked ? `Finish or discard your workout first (${undoBlocked.title})` : blocked ? `${undoRow.subtitle}. The unfinished workout came with the restored data and stays in it.` : undoRow.subtitle}
            disabled={undoBlocked !== null || undoing}
            onPress={undoRestore}
          />
        ) : null}
      </Group>
      {undoError ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={undoError} /> : null}
      <BlockingCover visible={undoing} title="Switching back…" lines={[{ text: undoRow?.subtitle ?? 'Switching databases', done: false }]} />

      <SectionHeader title="Import" />
      <Group>
        <Row
          title="Import from FitNotes"
          icon="square.and.arrow.down"
          subtitle={blocked ? `Finish or discard your workout first (${blocked.title})` : pausedImport ? pausedLine(pausedImport) : 'FitNotes CSV'}
          onPress={() => {
            navigation.navigate('ImportIntro');
          }}
        />
        <Row
          title={`Past imports (${String(imports.length)})`}
          icon="clock.arrow.circlepath"
          onPress={() => {
            navigation.navigate('PastImports');
          }}
        />
      </Group>

      <SectionHeader title="Export" />
      <Group>
        <Row
          title="Export"
          icon="square.and.arrow.up"
          subtitle="My data or Coaching knowledge only"
          onPress={() => {
            navigation.navigate('Export');
          }}
        />
      </Group>

      <View style={{ gap: theme.space['8'], marginTop: theme.space['4'] }}>
        <DangerTextButton
          label="Delete my data (keep coaching knowledge)"
          onPress={() => {
            navigation.navigate('DeleteMyData');
          }}
        />
        <DangerTextButton
          label="Reset coaching knowledge"
          onPress={() => {
            navigation.navigate('ResetKnowledge');
          }}
        />
      </View>
    </Screen>
  );
}
