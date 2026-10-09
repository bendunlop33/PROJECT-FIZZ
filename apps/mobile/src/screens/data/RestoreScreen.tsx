import { useNavigation, useRoute, type ParamListBase, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { toMs } from '@fizz/domain';

import { haptic } from '../../device/haptics';
import { pickBackupFile } from '../../device/files';
import { backupReasonLabel, buildCheckResultView, buildRestorePreviewView, describeBackupError, restoreBackAllowed, type CheckResultView, type RestorePreviewView } from '../../backup/restore-view';
import { formatShortDate, formatTime, formatWhen } from '../../format/dates';
import { plural } from '../../format/numbers';
import type { ProfileStackParams } from '../../navigation/types';
import { useRelaunch, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Card, Group, PrimaryButton, Row, Screen, SectionHeader, StatusLine, TextButton } from '../../ui';
import { BlockingCover } from './BlockingCover';
import { SaveCopyToFiles } from './SaveCopyToFiles';

type Step =
  | { kind: 'choose' }
  | { kind: 'checking'; label: string }
  | { kind: 'error'; label: string; text: string }
  | { kind: 'checked'; label: string; view: CheckResultView }
  /** `changed`: shown after a stale restore was refused and the preview rebuilt (review S5). */
  | { kind: 'preview'; label: string; text: string; view: RestorePreviewView; changed?: string }
  | { kind: 'restoring'; view: RestorePreviewView }
  | { kind: 'done'; view: RestorePreviewView; counts: string }
  | { kind: 'undoing' };

/**
 * `Restore from a backup` and `Check a backup` (data-import-export.md §2.3,
 * §2.4). Choose a backup on this phone or a file from Files → checked in full
 * (checksum, schema, rebuilt in a scratch database, every record) → preview
 * with counts against this phone → confirm when something is replaced →
 * `BlockingCover` while the database switches → Done (the app restarts its
 * data, normal cold-start logic) with `Undo restore`.
 *
 * This build restores the whole file; per-section restore (DX11) is deferred
 * (critic-pass-1 §3.1). Also opened from Welcome before setup (onboarding
 * OB3, `fromWelcome`): restored data with a profile then skips setup at the relaunch. Restore and Undo are refused during an unfinished
 * workout (DX4); Check never changes anything.
 */
export function RestoreScreen(props: { mode?: 'restore' | 'check'; fromWelcome?: boolean } = {}) {
  const theme = useTheme();
  const services = useServices();
  const relaunch = useRelaunch();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const routeParams = useRoute<RouteProp<ProfileStackParams, 'Restore'>>().params as ProfileStackParams['Restore'] | undefined;
  const mode = props.mode ?? routeParams?.mode ?? 'restore';
  // From Welcome (onboarding OB3) the phone has no data yet: nothing to save first.
  const fromWelcome = props.fromWelcome === true;
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  // After a Welcome restore the only exits are Done (relaunch) and Undo restore (onboarding §4.5, RS2; review R2).
  const backAllowed = restoreBackAllowed(step.kind, fromWelcome);
  useEffect(() => {
    navigation.setOptions({ headerBackVisible: backAllowed, gestureEnabled: backAllowed });
  }, [navigation, backAllowed]);
  const [data] = useScreenData(async (s) => {
    const [copies, blocked, status] = await Promise.all([s.restore.copiesOnPhone(), s.restore.blockedBy(), s.backups.getStatus()]);
    return { copies, blocked, status };
  });
  const now = services.now();
  const ctx = { nowMs: toMs(now.utc), tz: now.tz };

  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const { copies, blocked, status } = data.value;
  const isRestore = mode === 'restore';
  const blockedForRestore = isRestore && blocked !== null;
  const newestGood = copies.find((c) => c.integrityOk)?.createdAtUtc ?? null;
  const lastCopy = status.offPhone.lastCopy;
  const needsCopyFirst = isRestore && !fromWelcome && (lastCopy === null || lastCopy.atUtc < (status.onPhone.lastSuccess?.createdAtUtc ?? ''));

  async function examine(label: string, read: () => Promise<string | null>) {
    try {
      await examineNow(label, read);
    } catch (e) {
      setStep({ kind: 'error', label, text: describeBackupError({ code: 'restore_failed', message: e instanceof Error ? e.message : String(e) }) });
    }
  }

  async function examineNow(label: string, read: () => Promise<string | null>) {
    setStep({ kind: 'checking', label });
    const text = await read();
    if (text === null) {
      setStep({ kind: 'error', label, text: 'That backup couldn’t be read from this phone. Nothing was changed.' });
      return;
    }
    const r = isRestore ? await services.restore.prepare(text) : await services.restore.check(text);
    if (!r.ok) {
      setStep({ kind: 'error', label, text: describeBackupError(r.error) });
      return;
    }
    if (!isRestore) {
      setStep({ kind: 'checked', label, view: buildCheckResultView(r, ctx, newestGood) });
      return;
    }
    if (!r.restorable) {
      setStep({ kind: 'error', label, text: describeBackupError({ code: 'integrity_failed', message: '', issues: r.issues }) });
      return;
    }
    setStep({ kind: 'preview', label, text, view: buildRestorePreviewView(r.preview, ctx) });
  }

  async function chooseFile() {
    const picked = await pickBackupFile().catch((e: unknown) => ({ kind: 'failed' as const, message: e instanceof Error ? e.message : String(e) }));
    if (picked.kind === 'cancelled') return;
    if (picked.kind === 'failed') {
      setStep({ kind: 'error', label: 'File', text: `Couldn’t open that file: ${picked.message}. Nothing was changed.` });
      return;
    }
    await examine(picked.name, () => Promise.resolve(picked.text));
  }

  async function restore(text: string, view: RestorePreviewView) {
    setStep({ kind: 'restoring', view });
    // Any throw dismisses the cover with the "didn't finish" state (§3.3; review S3).
    const r = await services.restore.restore(text, view.stamp).catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, error: { code: 'restore_failed' as const, message: e instanceof Error ? e.message : String(e) } }));
    if (!r.ok && r.reason === 'stale') {
      // Never applied to newer state: show the rebuilt preview; Restore (and its alert) must be confirmed again.
      const fresh = r.fresh;
      if (!fresh.ok) setStep({ kind: 'error', label: '', text: describeBackupError(fresh.error) });
      else if (!fresh.restorable) setStep({ kind: 'error', label: '', text: describeBackupError({ code: 'integrity_failed', message: '', issues: fresh.issues }) });
      else setStep({ kind: 'preview', label: '', text, view: buildRestorePreviewView(fresh.preview, ctx), changed: describeBackupError({ code: 'preview_stale', message: '' }) });
      return;
    }
    if (!r.ok) {
      setStep(
        r.reason === 'workout_unfinished'
          ? { kind: 'error', label: '', text: `Finish or discard your workout first (${r.block.title}, started ${formatTime(toMs(r.block.startedAtUtc), r.block.tz)}).` }
          : { kind: 'error', label: '', text: describeBackupError(r.error) },
      );
      return;
    }
    // Restored data with a profile skips setup: worked out at launch from the data, so Done's relaunch (or any later one) lands on Today (SP4; review R3).
    haptic('commit');
    const c = r.preview.backup.counts;
    setStep({ kind: 'done', view, counts: `${plural(c.finishedWorkouts, 'workout', 'workouts')} · ${plural(c.loggedSets, 'set', 'sets')} · ${plural(c.gyms, 'gym', 'gyms')}` });
  }

  function confirmRestore(text: string, view: RestorePreviewView) {
    if (view.confirm === null) {
      void restore(text, view);
      return;
    }
    Alert.alert(view.confirm.title, view.confirm.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', style: 'destructive', onPress: () => void restore(text, view) },
    ]);
  }

  function undo() {
    Alert.alert('Bring back your data from before this restore?', 'The restored backup is kept, so you can switch again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Undo restore',
        onPress: () => {
          setStep({ kind: 'undoing' });
          void services.restore
            .undo()
            .catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, error: { code: 'restore_failed' as const, message: e instanceof Error ? e.message : String(e) } }))
            .then((r) => {
              if (!r.ok) {
                setStep({ kind: 'error', label: '', text: r.reason === 'workout_unfinished' ? 'Finish or discard your workout first.' : describeBackupError(r.error) });
                return;
              }
              relaunch();
            });
        },
      },
    ]);
  }

  const cover =
    step.kind === 'restoring' ? (
      <BlockingCover
        visible
        title="Restoring your data"
        lines={[
          { text: 'Backup checked', done: true },
          { text: 'Switching to the restored data', done: false },
        ]}
      />
    ) : step.kind === 'undoing' ? (
      <BlockingCover visible title="Switching back…" lines={[{ text: 'Bringing back your data from before the restore', done: false }]} />
    ) : null;

  if (step.kind === 'done') {
    return (
      <Screen footer={<PrimaryButton label="Done" onPress={relaunch} />}>
        <StatusLine icon="checkmark.circle.fill" tone="done" text="Restored" />
        <AppText variant="body">{`Your data now matches the backup ${step.view.made.replace(/^Made /, 'made ')}.`}</AppText>
        <AppText variant="callout" color="text.secondary" numeric>
          {step.counts}
        </AppText>
        <AppText variant="callout" color="text.secondary">
          Done reopens GymSmarter’s data. Your previous data is kept until the next restore.
        </AppText>
        <TextButton label="Undo restore" onPress={undo} />
      </Screen>
    );
  }

  if (step.kind === 'preview' || step.kind === 'restoring') {
    const view = step.view;
    const text = step.kind === 'preview' ? step.text : '';
    return (
      <Screen
        footer={
          view.identical ? (
            <PrimaryButton label="Done" onPress={() => { navigation.goBack(); }} />
          ) : (
            <PrimaryButton label="Restore" disabled={step.kind !== 'preview'} onPress={() => { confirmRestore(text, view); }} />
          )
        }
      >
        {cover}
        <View style={{ gap: theme.space['1'] }}>
          <AppText variant="title2" accessibilityRole="header">
            {view.identical ? 'Nothing to restore' : 'Restore this backup?'}
          </AppText>
          <AppText variant="callout" numeric>
            {view.made}
          </AppText>
          <AppText variant="callout" color="text.secondary">
            {view.app}
          </AppText>
        </View>
        {step.kind === 'preview' && step.changed ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={step.changed} /> : null}
        <StatusLine icon="checkmark.circle.fill" tone="done" text="Checked: complete, no damaged records" />
        {view.identical ? (
          <AppText variant="body">This backup matches your data on this phone. Nothing to restore.</AppText>
        ) : (
          <>
            <Card>
              <View style={{ flexDirection: 'row' }}>
                <AppText variant="label" color="text.secondary" style={{ flex: 1 }}>
                  {' '}
                </AppText>
                <AppText variant="label" color="text.secondary" style={{ width: 84, textAlign: 'right' }}>
                  Backup
                </AppText>
                <AppText variant="label" color="text.secondary" style={{ width: 96, textAlign: 'right' }}>
                  This phone
                </AppText>
              </View>
              {view.rows.map((r) => (
                <View key={r.label} accessible accessibilityLabel={`${r.label}: backup ${r.backup}, this phone ${r.phone}`} style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  <AppText variant="body" style={{ flex: 1, minWidth: 120 }}>
                    {r.label}
                  </AppText>
                  <AppText variant="body" numeric style={{ width: 84, textAlign: 'right' }}>
                    {r.backup}
                  </AppText>
                  <AppText variant="body" numeric style={{ width: 96, textAlign: 'right' }}>
                    {r.phone}
                  </AppText>
                </View>
              ))}
            </Card>
            {view.warnings.map((w) => (
              <StatusLine key={w} icon="exclamationmark.triangle" tone="warning" text={w} />
            ))}
            {view.notes.map((n) => (
              <StatusLine key={n} icon="info.circle" tone="info" text={n} />
            ))}
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      {cover}
      {step.kind === 'checking' ? (
        <Card>
          <AppText variant="headline">Checking the backup…</AppText>
          <StatusLine icon="ellipsis" tone="progress" text={`Reading ${step.label}, checking its checksum and rebuilding a test copy`} />
        </Card>
      ) : null}
      {step.kind === 'error' ? (
        <Card>
          <StatusLine
            icon="exclamationmark.triangle"
            tone="warning"
            text={step.text}
            detail={newestGood && !step.text.startsWith('Finish') ? `Your newest good backup: ${formatShortDate(toMs(newestGood), now.tz)}.` : null}
          />
          <TextButton label="Choose another" onPress={() => { setStep({ kind: 'choose' }); }} />
        </Card>
      ) : null}
      {step.kind === 'checked' ? (
        <Card>
          <StatusLine icon={step.view.ok ? 'checkmark.circle.fill' : 'exclamationmark.triangle'} tone={step.view.ok ? 'done' : 'warning'} text={step.view.title} detail={step.view.lines.join('\n')} />
          <TextButton label="Check another" onPress={() => { setStep({ kind: 'choose' }); }} />
        </Card>
      ) : null}

      {step.kind === 'choose' ? (
        <>
          {blockedForRestore ? (
            <StatusLine
              icon="info.circle"
              tone="info"
              text={`Finish or discard your workout first (${blocked.title}, started ${formatTime(toMs(blocked.startedAtUtc), blocked.tz)}).`}
              detail="Restoring replaces the history your workout is using."
            />
          ) : null}
          {needsCopyFirst && !blockedForRestore ? (
            <View style={{ gap: theme.space['2'] }}>
              <AppText variant="callout" color="text.secondary">
                Restoring replaces data on this phone. Save a copy to Files first?
              </AppText>
              <SaveCopyToFiles variant="row" label="Save a copy to Files first" />
            </View>
          ) : null}
          {!isRestore ? (
            <AppText variant="callout" color="text.secondary">
              Checking rebuilds the backup in a test copy and checks every record, then throws the copy away. Nothing on this phone changes.
            </AppText>
          ) : null}
          <SectionHeader title="On this phone" />
          {copies.length === 0 ? (
            <AppText variant="callout" color="text.secondary">
              No backups on this phone yet. The first one is made after your first workout.
            </AppText>
          ) : (
            <Group>
              {copies.map((c) => (
                <Row
                  key={c.fileName}
                  title={formatWhen(toMs(c.createdAtUtc), ctx.nowMs, now.tz)}
                  subtitle={`${backupReasonLabel(c.reason)} · ${plural(c.finishedWorkouts, 'workout', 'workouts')}${c.integrityOk ? '' : ' · damaged records'}`}
                  disabled={blockedForRestore}
                  onPress={() => void examine(formatWhen(toMs(c.createdAtUtc), ctx.nowMs, now.tz), () => services.restore.readOnPhone(c.fileName))}
                />
              ))}
            </Group>
          )}
          <Group>
            <Row title="Choose another file…" icon="folder" disabled={blockedForRestore} onPress={() => void chooseFile()} accessibilityHint="Opens Files to pick a GymSmarter backup" />
          </Group>
          <AppText variant="callout" color="text.secondary">
            Backups on this phone are lost if GymSmarter is deleted or re-signed with another Apple ID. Copies you saved to Files are under Choose another file.
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}
